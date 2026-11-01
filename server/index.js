// Lumen — TV interface server. Serves the TV UI (local only), the phone remote (paired devices),
// proxies TMDB (API key never leaves this machine) and drives the system (volume, keys, apps).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Store } = require('./store');
const { attach } = require('./ws');
const qr = require('./qr');
const media = require('./media');
const { createTmdb, SERVICES } = require('./tmdb');
const { createSystem } = require('./system');

const PORT = +process.env.PORT || 8787;
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.LUMEN_DATA || path.join(ROOT, 'data');
const MOCK = process.env.LUMEN_MOCK === '1';
const SHELL = global.lumenShell || null; // set when Lumen runs as the desktop app (electron/main.js)
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '1.0.0'; } catch { return '1.0.0'; } })();
const BG_DIR = path.join(DATA, 'backgrounds');
fs.mkdirSync(BG_DIR, { recursive: true });

const store = new Store(DATA);
const S = () => store.d.settings;
const mockMod = MOCK ? require('./mock') : null;
const tmdb = createTmdb(S, { mock: mockMod && mockMod.mock, cacheFile: path.join(DATA, 'tmdb-cache.json') });
const system = createSystem(DATA);

// ---------------------------------------------------------------- helpers
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
// Lumen only answers devices on your own home network: even if a router or VPN ever passed traffic in from the
// internet, nothing outside your network can reach the remote, the pairing page or your films.
function onHomeNetwork(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  const v4 = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [x, y] = [+v4[1], +v4[2]];
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  const l = a.toLowerCase();
  if (l === '::1' || /^fe[89ab]/.test(l) || /^f[cd]/.test(l)) return true; // link-local, private (ULA)
  // a public IPv6 address in this computer's own network (same /64)
  const pre = (x) => x.split(':').slice(0, 4).join(':');
  return Object.values(os.networkInterfaces()).flat().some((i) => i && i.family === 'IPv6' && !i.internal && pre(i.address.toLowerCase()) === pre(l));
}
function deviceFor(token) {
  if (!token || typeof token !== 'string') return null;
  const h = sha(token);
  return store.d.devices.find((d) => d.tokenHash === h) || null;
}
// ---- "Watch" button link: the user's own pattern + the film's name as a slug.
// Rule: lowercase, spaces become "-". Accents are dropped, apostrophes removed,
// other punctuation treated as a space, and repeated "-" squashed to one.
function slugify(title) {
  return String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().replace(/[\s-]+/g, '-');
}
function buildWatchUrl(pattern, title, year) {
  const slug = encodeURIComponent(slugify(title));
  if (/\{(name|slug)\}/i.test(pattern)) return pattern.replace(/\{(name|slug)\}/gi, slug).replace(/\{year\}/gi, year ? String(year) : '');
  return pattern.replace(/\/*$/, '/') + slug + '/'; // movies.com → https://movies.com/the-film-name/
}
function cleanWatchPattern(raw) {
  let p = String(raw || '').trim();
  if (!p) return '';
  if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
  let u; try { u = new URL(buildWatchUrl(p, 'test film', 2000)); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
  return p.slice(0, 500);
}

// ---- the big banner on Home: a fresh shuffle of films picked for you each time (not the same trending film
// every time), or the films in one of your folders (Settings → Home Banner)
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
async function homeBanner(data) {
  const hb = S().homeBanner || {};
  if (hb.source === 'folder') {
    const f = store.d.folders.find((x) => x.id === hb.folderId);
    if (f && f.items.length) {
      const picks = shuffle(f.items.filter((i) => ['movie', 'tv'].includes(i.type))).slice(0, 12);
      const items = (await Promise.all(picks.map((i) => tmdb.brief(i.type, i.id).catch(() => null)))).filter((i) => i && i.backdrop_path);
      if (items.length) return { hero: items, heroEyebrow: f.name };
    }
  }
  const pool = [], seen = new Set();
  const add = (it) => { const k = `${it.type}:${it.id}`; if (it.backdrop_path && it.overview && !seen.has(k)) { seen.add(k); pool.push(it); } };
  const pick = (title) => data.rows.find((r) => r.title.startsWith(title))?.items || [];
  pick('Because You Viewed').slice(0, 8).forEach(add);   // picked for you (from what you've viewed)…
  const nMine = pool.length;
  [...(data.hero || []), ...pick('Popular Films').slice(0, 10), ...pick('Top Rated Films').slice(0, 10), ...pick('Trending Today').slice(0, 6)].forEach(add);
  const mine = pool.slice(0, nMine), rest = pool.slice(nMine);
  return { hero: shuffle([...shuffle(mine).slice(0, 4), ...shuffle(rest)]).slice(0, 10), heroEyebrow: 'Recommended for You' };
}

// ---- the Watch buttons: one per Watch website. A film opened from Continue Watching goes back to the same site.
const watchLinks = () => (S().watchLinks || []).filter((w) => w && w.pattern);
const findWatchLink = (id) => watchLinks().find((w) => w.id === id) || watchLinks()[0] || null;
function syncWatchLinks() { const l = watchLinks(); S().watchLink = l[0] ? { pattern: l[0].pattern, name: l[0].name || '' } : { pattern: '', name: '' }; }
// a page you found yourself for a film (after "not found"): used instead of the made-up address from then on
const overrideKey = (linkId, it, title) => `${linkId}|${it ? `${it.type}:${it.id}` : 't:' + String(title || '').toLowerCase().trim()}`;
function saveOverride(linkId, it, title, u) {
  const k = overrideKey(linkId, it, title), o = store.d.linkOverrides || (store.d.linkOverrides = {});
  if (u) o[k] = String(u).slice(0, 1000); else delete o[k];
  store.save(); broadcastTv({ t: 'watching-changed' });
}
function watchTarget(b, resumeOverride = null) {
  const wl = findWatchLink(b.linkId);
  const title = b.title.slice(0, 200);
  const it = b.item && Number.isInteger(b.item.id) && ['movie', 'tv'].includes(b.item.type) ? b.item : null;
  const saved = (store.d.linkOverrides || {})[overrideKey(wl.id, it, title)];
  const wurl = saved || buildWatchUrl(wl.pattern, title, Number.isInteger(b.year) ? b.year : null);
  const key = it ? `${it.type}:${it.id}` : null;
  if (key && watchLinks().length > 1) { (store.d.filmSites || (store.d.filmSites = {}))[key] = wl.id; store.save(); } // next time, that film's Watch button uses this site
  const prev = key && store.d.watching.find((w) => w.key === key);
  // resume only on the site you were watching it on
  const resumeAt = resumeOverride ?? (prev && (!prev.linkId || prev.linkId === wl.id) ? prev.t : 0);
  return { url: wurl, label: title, watch: true, assist: {
    block: S().blockPopups !== false, autoplay: S().autoPlay !== false,
    cover: coverFor(title, `Opening on ${wl.name || hostOf(wurl)}${resumeAt > 60 ? ` · resuming at ${clock(resumeAt)}` : ''}`, it?.backdrop_path),
    resumeAt,
    onProgress: key ? (p) => saveWatching(key, it, title, b.year, p, wl.id) : null,
    saveLabel: title,
    onSaveLink: (u) => { saveOverride(wl.id, it, title, u); console.log(`[watch] saved your page for ${title}`); },
    // sound but no picture while software decoding was on → switch it off and reopen at the same moment
    onNoPicture: (p, wasSoftware) => {
      if (!wasSoftware) return;
      S().softwareDecode = false; store.save(); broadcastTv({ t: 'settings-changed' });
      console.log('[watch] no picture with software decoding — reopening with normal decoding');
      setTimeout(() => openTarget(watchTarget({ ...b, linkId: wl.id }, Math.max(0, (p.t || 0) - 3))), 300);
    },
  } };
}
// One browser for every website, so you sign in once (iPlayer, Channel 4, the Watch site…) and it's remembered:
// Brave when it's installed (ad blocking built in), otherwise Edge — unless you chose Edge in Settings.
const webBrowser = () => (S().webBrowserChoice === 'edge' || !system.info().brave ? 'edge' : 'brave');
function openTarget(target) {
  // The Watch button always uses Brave when it's installed (Brave Shields blocks ads); other sites follow the setting.
  return system.openWeb(target.url, { label: target.label, youtube: target.youtube, assist: target.assist || null, setup: !!target.setup,
    smoothSkip: S().softwareDecode === true, browser: target.setup ? webBrowser() : webBrowser() });
}

// ---- sleep timer: after the time you pick, the sound fades out over the last minute, then whatever is playing
// stops, the screen goes off and the volume goes back to where it was (so it's normal next time).
let sleep = null; // { at, timer, fadeT, restore }
const sleepInfo = () => (sleep ? { at: sleep.at, left: Math.max(0, Math.round((sleep.at - Date.now()) / 1000)) } : null);
function setSleep(minutes) {
  if (sleep) { clearTimeout(sleep.timer); clearTimeout(sleep.fadeT); clearInterval(sleep.fadeI); sleep = null; }
  const mins = Number(minutes);
  if (Number.isFinite(mins) && mins > 0 && mins <= 360) {
    const at = Date.now() + mins * 60e3;
    sleep = { at };
    sleep.fadeT = setTimeout(startSleepFade, Math.max(0, at - Date.now() - 60e3));
    sleep.timer = setTimeout(sleepNow, Math.max(0, at - Date.now()));
  }
  broadcastTv({ t: 'sleep', sleep: sleepInfo() }); pushState();
  return sleepInfo();
}
async function startSleepFade() {
  if (!sleep) return;
  try {
    const v = await system.getVolume(); sleep.restore = v.level;
    const steps = 20, from = v.level; let i = 0;
    sleep.fadeI = setInterval(() => { i++; system.setVolume(from * Math.max(0, 1 - i / steps)).catch(() => {}); if (i >= steps) clearInterval(sleep?.fadeI); }, 3000);
  } catch {}
}
async function sleepNow() {
  const restore = sleep?.restore; clearInterval(sleep?.fadeI); sleep = null;
  console.log('[sleep] time is up');
  system.closeExternal();
  broadcastTv({ t: 'sleep-now' }); pushState();
  setTimeout(() => system.screenOff?.(), 2500);
  if (restore !== undefined) setTimeout(() => system.setVolume(restore).then(() => refreshVolume()).catch(() => {}), 4000);
}

// ---- Continue Watching: progress reported by the watch helper while a film plays in the browser
const ACCENTS = { white: '#ffffff', amber: '#ffc970', rose: '#ffa0b6', mint: '#80e8ba', sky: '#82c6ff', lilac: '#c4acff', red: '#ff453a', scarlet: '#ff2a1a', crimson: '#dc143c', cherry: '#b3001b', coral: '#ff7262' };
const accentRgb = () => { const a = S().accent || 'white', h = ACCENTS[a] || (/^#[0-9a-f]{6}$/i.test(a) ? a : '#ffffff'), n = parseInt(h.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };
const coverFor = (title, sub, backdrop = null) => ({ title, sub, accent: accentRgb(), backdrop: backdrop && !MOCK ? `https://image.tmdb.org/t/p/w1280${backdrop}` : null });
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'the website'; } };
const clock = (t) => { t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
let watchBroadcastT = 0;
function saveWatching(key, it, title, year, { t, d }, linkId = null) {
  if (!(d > 60) || !(t >= 0)) return;
  const list = store.d.watching;
  const i = list.findIndex((w) => w.key === key);
  const finished = t / d > 0.94 || d - t < 150;
  if (finished) { if (i >= 0) list.splice(i, 1); }
  else if (t > 60) {
    const entry = { key, id: it.id, type: it.type, title, year: Number.isInteger(year) ? year : null, poster_path: it.poster_path || null, backdrop_path: it.backdrop_path || null, t, d, linkId, updatedAt: Date.now() };
    if (i >= 0) list.splice(i, 1);
    list.unshift(entry);
    list.length = Math.min(list.length, 30);
  } else return;
  store.save();
  if (Date.now() - watchBroadcastT > 30000 || finished) { watchBroadcastT = Date.now(); broadcastTv({ t: 'watching-changed' }); }
}

function auth(req, url) {
  if (isLocal(req)) return { role: 'local' };
  const dev = deviceFor(req.headers['x-lumen-token'] || url.searchParams.get('t'));
  if (dev) { dev.lastSeen = Date.now(); return { role: 'remote', device: dev }; }
  return null;
}
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (/vethernet|virtualbox|vmware|docker|wsl|loopback|hyper-v|tailscale|zerotier/i.test(name)) continue;
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  const score = (a) => (a.address.startsWith('192.168.') ? 0 : a.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a.address) ? 2 : 3) + (/wi-?fi|wlan|wireless/i.test(a.name) ? -0.5 : 0);
  return out.sort((a, b) => score(a) - score(b));
}
const lanHost = () => S().lanHost || (lanAddresses()[0] || {}).address || 'localhost';

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body) || typeof body === 'string';
  res.writeHead(status, { 'content-type': isBuf ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(isBuf ? body : JSON.stringify(body));
}
const fail = (res, e) => send(res, e.status || 500, { error: e.message || 'Something went wrong' });

function readBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function json(req) {
  const b = await readBody(req);
  if (!b.length) return {};
  try { return JSON.parse(b.toString('utf8')); } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
function serveFile(res, file, cache = 'no-cache') {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': cache });
    fs.createReadStream(file).pipe(res);
  });
}
function serveStatic(res, base, rel) {
  const file = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (!file.startsWith(base + path.sep) && file !== base) return send(res, 403, 'Forbidden');
  serveFile(res, file);
}

// item sanitiser for folders/recent (never trust client blobs wholesale)
function cleanItem(i) {
  if (!i || !Number.isFinite(+i.id) || !['movie', 'tv'].includes(i.type)) throw Object.assign(new Error('Invalid item'), { status: 400 });
  const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : null);
  return { id: +i.id, type: i.type, title: str(i.title, 200) || 'Untitled', year: Number.isFinite(+i.year) ? +i.year : null, poster_path: str(i.poster_path), backdrop_path: str(i.backdrop_path) };
}

// Fill in artwork for preset folder items once a key is available.
let resolving = null;
function resolveFolderArt() {
  if (resolving || (!S().tmdbKey && !MOCK)) return resolving;
  const missing = store.d.folders.flatMap((f) => f.items.filter((i) => !i.poster_path && !i.artChecked));
  if (!missing.length) return null;
  resolving = (async () => {
    let changed = false;
    for (const it of missing) {
      try {
        const d = await tmdb.lookup(it.type, it.id);
        Object.assign(it, { title: d.title, year: d.year, poster_path: d.poster_path, backdrop_path: d.backdrop_path, artChecked: true });
        changed = true;
      } catch (e) { if (e.status === 401 || e.status === 412 || e.status === 503) break; it.artChecked = true; }
    }
    if (changed) { store.save(); broadcastTv({ t: 'folders-changed' }); }
  })().finally(() => { resolving = null; });
  return resolving;
}

// ---------------------------------------------------------------- live state & sockets
const tvs = new Set(), remotes = new Set();
const live = { view: 'home', textInput: false, inPlayer: false, external: null, volume: null };
const broadcastTv = (m) => tvs.forEach((w) => w.send(m));
const broadcastRemotes = (m) => remotes.forEach((w) => w.send(m));
const remoteState = () => ({ t: 'state', tvConnected: tvs.size > 0, view: live.view, textInput: live.textInput, inPlayer: live.inPlayer, external: system.external ? { kind: system.external.kind, label: system.external.label } : null, volume: live.volume, deviceName: S().deviceName, accent: accentRgb(), brightness: S().brightness?.level ?? 100, sleep: sleepInfo() });
const pushState = () => broadcastRemotes(remoteState());

system.on('external', (ext) => { live.external = ext; broadcastTv({ t: 'external', external: ext }); pushState(); });

async function refreshVolume() { try { live.volume = await system.getVolume(); } catch (e) { live.volume = null; } return live.volume; }
// ---- Brightness 1-100. Lumen dims what it shows itself (its screens and the websites it opens), which works
// on any TV at every level. Optionally it also asks the TV for its own backlight (DDC/CI) where allowed.
const dimFactor = (level) => 0.1 + 0.9 * ((Math.max(1, Math.min(100, level)) - 1) / 99); // 1 → 10% light, 100 → full
let hwBusy = false, hwPending = null;
async function pushHwBrightness() {
  if (hwBusy) return; hwBusy = true;
  try { while (hwPending != null) { const v = hwPending; hwPending = null; await system.setBrightness(v).catch(() => null); } }
  finally { hwBusy = false; }
}
function setBrightness(level) {
  const s = S(); const L = Math.round(Math.max(1, Math.min(100, Number(level) || 100)));
  s.brightness = { ...(s.brightness || { hw: false }), level: L };
  store.save();
  const f = dimFactor(L);
  system.brightness = f;
  system.external?.guard?.setBrightness?.(f); // a website that's open now dims straight away
  if (s.brightness.hw) { hwPending = L; pushHwBrightness(); }
  broadcastTv({ t: 'brightness', level: L, factor: f });
  pushState();
  return L;
}

// Quick repeated presses (or holding the button) are added together and sent as one step,
// so the volume never lags behind a backlog of commands.
let volPending = 0, volBusy = null;
function stepVolumeCoalesced(d) {
  volPending += d;
  if (!volBusy) volBusy = (async () => {
    let st;
    try { while (Math.abs(volPending) > 1e-6) { const step = volPending; volPending = 0; st = await system.stepVolume(Math.max(-1, Math.min(1, step))); } }
    finally { volBusy = null; }
    return st;
  })();
  return volBusy;
}
async function volumeAction(a, v) {
  let st;
  if (a === 'up' || a === 'down') {
    try { st = await stepVolumeCoalesced(a === 'up' ? 0.04 : -0.04); }
    catch { volPending = 0; st = await system.stepVolume(a === 'up' ? 0.04 : -0.04); } // one retry if the helper hiccuped
    if (!st) st = await system.getVolume();
  }
  else if (a === 'mute') st = await system.toggleMute();
  else if (a === 'set') st = await system.setVolume(+v);
  else st = await system.getVolume();
  live.volume = { level: st.level, muted: st.muted };
  broadcastTv({ t: 'volume', ...live.volume });
  pushState();
  return live.volume;
}

// Keys from the phone go to the TV page, or to the OS when an external app has the screen.
const EXT_KEYS = {
  web: { up: 'up', down: 'down', left: 'left', right: 'right', select: 'enter', back: 'browserback', playpause: 'mediaplaypause' },
  youtube: { up: 'up', down: 'down', left: 'left', right: 'right', select: 'enter', back: 'escape', playpause: 'mediaplaypause' },
  vlc: { up: 'up', down: 'down', left: 'altleft', right: 'altright', select: 'space', back: null, playpause: 'space' },
};
async function handleKey(k) {
  if (system.external) {
    if (k === 'home' || k === 'main' || (k === 'back' && system.external.kind === 'vlc')) { system.closeExternal(); return; }
    const vk = (EXT_KEYS[system.external.kind] || EXT_KEYS.web)[k];
    if (vk) await system.key(vk).catch((e) => console.error('key', e.message));
    return;
  }
  if (k === 'main' && !tvs.size) { system.launchTv(`http://localhost:${PORT}/tv/`); return; }
  if (k === 'main') system.focusTv();
  broadcastTv({ t: 'key', k });
}

async function onRemoteMessage(m, ws) {
  try {
    switch (m.t) {
      case 'key': if (['up', 'down', 'left', 'right', 'select', 'back', 'home', 'playpause', 'main', 'menu'].includes(m.k)) await handleKey(m.k); break;
      case 'ping': ws.send({ t: 'pong' }); break; // the phone checks the connection is still alive
      case 'bright': setBrightness(Number.isFinite(m.v) ? m.v : (S().brightness?.level ?? 100) + (Number(m.d) || 0)); break;
      case 'vol': await volumeAction(m.a, m.v); break;
      case 'text':
        if (typeof m.v !== 'string') break;
        if (system.external) { if (m.append) await system.type(m.append.slice(0, 200)); if (m.backspace) await system.key('backspace'); }
        else broadcastTv({ t: 'text', v: m.v.slice(0, 200), submit: !!m.submit });
        break;
      case 'mouse': await system.mouseMove(Math.max(-400, Math.min(400, +m.dx || 0)), Math.max(-400, Math.min(400, +m.dy || 0))); break;
      case 'click': await system.click(m.b); break;
      case 'scroll': await system.scroll(Math.max(-1200, Math.min(1200, +m.dy || 0))); break;
      case 'hello': ws.send(remoteState()); break;
    }
  } catch (e) { ws.send({ t: 'error', error: e.message }); }
}

// ---------------------------------------------------------------- pairing
let pairing = null; // { code, expires, attempts }
const failures = new Map(); // ip -> [timestamps]
function startPairing() {
  pairing = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), expires: Date.now() + 5 * 60e3, attempts: 0 };
  const url = `http://${lanHost()}:${PORT}/remote/?code=${pairing.code}`;
  return { code: pairing.code, url, host: `${lanHost()}:${PORT}`, expires: pairing.expires, qr: qr.toSvg(url, { dark: '#000', light: '#fff' }), addresses: lanAddresses() };
}

// ---------------------------------------------------------------- routes
async function route(req, res) {
  if (!onHomeNetwork(req.socket.remoteAddress)) return send(res, 403, { error: 'Lumen only answers devices on your home network.' });
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const m = req.method;

  // ---- pages
  if (p === '/' ) { res.writeHead(302, { location: isLocal(req) ? '/tv/' : '/remote/' }); return res.end(); }
  if (p === '/tv' || p === '/remote' || p === '/setup') { res.writeHead(301, { location: p + '/' }); return res.end(); }
  if (p.startsWith('/tv/') || p.startsWith('/setup/')) {
    if (!isLocal(req)) return send(res, 403, 'The TV interface is only available on this computer.');
    return serveStatic(res, PUBLIC, p.endsWith('/') ? p + 'index.html' : p);
  }
  if (p === '/phone') return send(res, 302, '', { location: '/phone/' });
  if (p.startsWith('/remote/') || p.startsWith('/phone/') || p.startsWith('/shared/')) return serveStatic(res, PUBLIC, p.endsWith('/') ? p + 'index.html' : p);
  if (p.startsWith('/mock-img/') && MOCK) {
    const file = path.basename(p);
    return send(res, 200, mockMod.mockImage(file), { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=3600' });
  }

  // ---- pairing (unauthenticated by design, rate limited)
  if (p === '/api/pair' && m === 'POST') {
    const ip = req.socket.remoteAddress;
    const recent = (failures.get(ip) || []).filter((t) => Date.now() - t < 10 * 60e3);
    if (recent.length >= 8) return send(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
    const body = await json(req);
    const ok = pairing && Date.now() < pairing.expires && pairing.attempts < 5 && typeof body.code === 'string' && body.code.length === 6 &&
      crypto.timingSafeEqual(Buffer.from(body.code), Buffer.from(pairing.code));
    if (!ok) {
      if (pairing) pairing.attempts++;
      recent.push(Date.now()); failures.set(ip, recent);
      return send(res, 403, { error: pairing && Date.now() < pairing.expires ? 'That code is not right.' : 'Pairing code expired. Open Remote on the TV for a new one.' });
    }
    pairing = null;
    const token = crypto.randomBytes(32).toString('base64url');
    const dev = { id: crypto.randomUUID(), name: (typeof body.name === 'string' && body.name.slice(0, 40)) || 'iPhone', tokenHash: sha(token), createdAt: Date.now(), lastSeen: Date.now() };
    store.d.devices.push(dev); store.save();
    broadcastTv({ t: 'paired', name: dev.name });
    return send(res, 200, { token, deviceId: dev.id, deviceName: S().deviceName });
  }

  if (!p.startsWith('/api/') && !p.startsWith('/bg/')) return send(res, 404, 'Not found');
  const who = auth(req, url);
  if (!who) return send(res, 401, { error: 'Not paired' });
  const local = who.role === 'local';
  const localOnly = () => { if (!local) throw Object.assign(new Error('Only available on the TV computer'), { status: 403 }); };

  if (p.startsWith('/bg/')) return serveStatic(res, BG_DIR, decodeURIComponent(p.slice(4)));
  if (p === '/api/sleep' && m === 'GET') return send(res, 200, { sleep: sleepInfo() });
  if (p === '/api/sleep' && m === 'POST') { const b = await json(req); return send(res, 200, { sleep: setSleep(b.minutes) }); }

  // ---- config & settings
  if (p === '/api/config' && m === 'GET') {
    const s = S();
    return send(res, 200, {
      version: VERSION, app: SHELL && local ? SHELL.info() : null, root: local ? ROOT : undefined, hasKey: !!s.tmdbKey || MOCK, mock: MOCK, imageBase: MOCK ? '/mock-img' : 'https://image.tmdb.org/t/p',
      region: s.region, deviceName: s.deviceName, services: s.services, serviceNames: Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, v.name])),
      background: s.background, showClock: s.showClock, reduceMotion: s.reduceMotion, shortcuts: s.shortcuts, watchLink: s.watchLink, watchLinks: watchLinks(), accentRgb: accentRgb(), homeBanner: s.homeBanner, homeBannerName: s.homeBanner?.source === 'folder' ? (store.d.folders.find((f) => f.id === s.homeBanner.folderId)?.name || null) : null, webBrowserInUse: webBrowser(), userName: s.userName, accent: s.accent, sound: s.sound, brightness: s.brightness, blockPopups: s.blockPopups, autoPlay: s.autoPlay, softwareDecode: s.softwareDecode === true, intro: s.intro, webBrowser: s.webBrowser, lanHost: lanHost(), port: PORT, system: system.info(),
      keyHint: s.tmdbKey ? '••••' + s.tmdbKey.slice(-4) : '',
    });
  }
  if (p === '/api/settings' && m === 'POST') {
    const b = await json(req), s = S();
    if (typeof b.tmdbKey === 'string') {
      const k = b.tmdbKey.trim();
      if (k && !/^[A-Za-z0-9._-]{20,400}$/.test(k)) return send(res, 400, { error: 'That does not look like a TMDB key.' });
      const old = s.tmdbKey; s.tmdbKey = k; tmdb.clear();
      if (k) { try { await tmdb.testKey(); } catch (e) { s.tmdbKey = old; tmdb.clear(); return send(res, e.status === 401 ? 400 : 502, { error: e.status === 401 ? 'TMDB rejected that key. Check you copied the whole "API Read Access Token" or "API Key".' : e.message }); } }
    }
    if (typeof b.region === 'string' && /^[A-Z]{2}$/.test(b.region)) { s.region = b.region; tmdb.clear(); }
    if (typeof b.deviceName === 'string') s.deviceName = b.deviceName.slice(0, 40) || 'Living Room TV';
    if (typeof b.lanHost === 'string') s.lanHost = b.lanHost.replace(/[^0-9a-zA-Z.:-]/g, '').slice(0, 64);
    if (b.services && typeof b.services === 'object') for (const k of Object.keys(SERVICES)) if (typeof b.services[k] === 'boolean') s.services[k] = b.services[k];
    if (b.background && typeof b.background === 'object') {
      const mode = ['artwork', 'custom', 'black', 'graphite'].includes(b.background.mode) ? b.background.mode : s.background.mode;
      const image = b.background.image === null ? null : (store.d.backgrounds.find((x) => x.id === b.background.image) ? b.background.image : s.background.image);
      s.background = { mode, image };
      broadcastTv({ t: 'bg-changed' });
    }
    if (b.homeBanner && typeof b.homeBanner === 'object') {
      const src = b.homeBanner.source === 'folder' && store.d.folders.some((f) => f.id === b.homeBanner.folderId) ? 'folder' : 'recommended';
      s.homeBanner = { source: src, folderId: src === 'folder' ? b.homeBanner.folderId : null };
    }
    if (Array.isArray(b.watchLinks)) {           // the whole list (TV Settings → Watch Buttons)
      const out = [];
      for (const w of b.watchLinks.slice(0, 8)) {
        if (!w || typeof w.pattern !== 'string') continue;
        const pat = cleanWatchPattern(w.pattern);
        if (pat === null) return send(res, 400, { error: `“${String(w.pattern).slice(0, 40)}” is not a valid web address. Example: example.com/movie/` });
        if (!pat) continue;
        const id = typeof w.id === 'string' && /^[\w-]{1,20}$/.test(w.id) ? w.id : 'w' + Date.now().toString(36) + out.length;
        out.push({ id, pattern: pat, name: typeof w.name === 'string' ? w.name.trim().slice(0, 30) : '' });
      }
      s.watchLinks = out; syncWatchLinks();
    }
    if (b.watchLink && typeof b.watchLink === 'object') { // older remotes: edits the first Watch website
      const list = [...watchLinks()];
      const first = { ...(list[0] || { id: 'w1', pattern: '', name: '' }) };
      if (typeof b.watchLink.pattern === 'string') {
        const pat = cleanWatchPattern(b.watchLink.pattern);
        if (pat === null) return send(res, 400, { error: 'That web address is not valid. Example: https://example.com/movie/' });
        first.pattern = pat;
      }
      if (typeof b.watchLink.name === 'string') first.name = b.watchLink.name.trim().slice(0, 30);
      if (first.pattern) list[0] = first; else list.shift();
      s.watchLinks = list; syncWatchLinks();
    }
    if (['edge', 'brave'].includes(b.webBrowser)) { s.webBrowser = b.webBrowser; s.webBrowserChoice = b.webBrowser; }
    if (b.intro && typeof b.intro === 'object') { s.intro = { ...(s.intro || { anim: true, sound: true }) }; for (const k of ['anim', 'sound']) if (typeof b.intro[k] === 'boolean') s.intro[k] = b.intro[k]; }
    if (b.brightness && typeof b.brightness === 'object') {
      if (typeof b.brightness.hw === 'boolean') s.brightness = { ...(s.brightness || { level: 100 }), hw: b.brightness.hw };
      if (Number.isFinite(b.brightness.level)) setBrightness(b.brightness.level);
      else setBrightness(s.brightness.level);
    }
    if (typeof b.softwareDecode === 'boolean') s.softwareDecode = b.softwareDecode;
    if (typeof b.blockPopups === 'boolean') s.blockPopups = b.blockPopups;
    if (typeof b.autoPlay === 'boolean') s.autoPlay = b.autoPlay;
    if (typeof b.userName === 'string') s.userName = b.userName.trim().slice(0, 24);
    if (typeof b.accent === 'string' && (ACCENTS[b.accent] || /^#[0-9a-f]{6}$/i.test(b.accent))) s.accent = b.accent.toLowerCase();
    if (b.sound && typeof b.sound === 'object') {
      const snd = { ...(s.sound || { on: true, style: 'soft', volume: 0.6 }) };
      if (typeof b.sound.on === 'boolean') snd.on = b.sound.on;
      if (['soft', 'crisp', 'glass', 'arcade', 'marimba', 'cosmic', 'bubble'].includes(b.sound.style)) snd.style = b.sound.style;
      if (typeof b.sound.volume === 'number' && b.sound.volume >= 0 && b.sound.volume <= 1) snd.volume = b.sound.volume;
      s.sound = snd;
    }
    if (typeof b.showClock === 'boolean') s.showClock = b.showClock;
    if (typeof b.reduceMotion === 'boolean') s.reduceMotion = b.reduceMotion;
    store.save();
    resolveFolderArt();
    broadcastTv({ t: 'settings-changed' });
    pushState(); // phones pick up name/colour changes
    return send(res, 200, { ok: true });
  }

  // ---- website shortcuts ("Add a website")
  if (p === '/api/shortcuts' && m === 'POST') {
    const b = await json(req);
    let u; try { u = new URL(String(b.url || '').trim().match(/^https?:\/\//i) ? String(b.url).trim() : 'https://' + String(b.url || '').trim()); } catch { return send(res, 400, { error: 'That web address is not valid.' }); }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return send(res, 400, { error: 'That web address is not valid.' });
    const name = (typeof b.name === 'string' && b.name.trim().slice(0, 30)) || u.hostname.replace(/^www\./, '');
    const sc = { id: crypto.randomUUID(), name, url: u.href };
    S().shortcuts.push(sc); store.save(); broadcastTv({ t: 'settings-changed' });
    return send(res, 200, sc);
  }
  let mm;
  if ((mm = p.match(/^\/api\/shortcuts\/([\w-]+)$/)) && m === 'DELETE') {
    S().shortcuts = S().shortcuts.filter((x) => x.id !== mm[1]); store.save(); broadcastTv({ t: 'settings-changed' });
    return send(res, 200, { ok: true });
  }

  // ---- catalogue
  if ((mm = p.match(/^\/api\/section\/(home|movies|tv|free|recent)$/))) {
    const ctx = {};
    if (mm[1] === 'home') { ctx.recent = store.d.recent.slice(0, 20); ctx.because = store.d.recent[0] || null; }
    if (mm[1] === 'recent') {
      ctx.folderAdds = store.d.folders.flatMap((f) => f.items).filter((i) => i.poster_path).sort((a, b) => b.addedAt - a.addedAt).slice(0, 20);
      const files = await media.recentVideos(store.d.mediaFolders, 20).catch(() => []);
      ctx.media = files.map((f) => ({ ...f, type: 'file', title: f.name.replace(/\.[^.]+$/, '') }));
    }
    const data = await tmdb.section(mm[1], ctx);
    if (mm[1] === 'home') return send(res, 200, { ...data, ...(await homeBanner(data)) });
    return send(res, 200, data);
  }
  if ((mm = p.match(/^\/api\/details\/(movie|tv)\/(\d+)$/))) return send(res, 200, await tmdb.details(mm[1], +mm[2]));
  if ((mm = p.match(/^\/api\/season\/(\d+)\/(\d+)$/))) return send(res, 200, await tmdb.season(+mm[1], +mm[2]));
  if ((mm = p.match(/^\/api\/collection\/(\d+)$/))) return send(res, 200, await tmdb.collection(+mm[1]));
  if (p === '/api/search') return send(res, 200, { results: await tmdb.search((url.searchParams.get('q') || '').slice(0, 100)) });

  // ---- folders
  if (p === '/api/folders' && m === 'GET') { resolveFolderArt(); return send(res, 200, { folders: store.d.folders }); }
  if (p === '/api/folders' && m === 'POST') {
    const b = await json(req);
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
    if (!name) return send(res, 400, { error: 'Give the folder a name.' });
    if (store.d.folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) return send(res, 409, { error: `You already have a folder called “${name}”.` });
    const items = Array.isArray(b.items) ? b.items.slice(0, 200).map(cleanItem).map((i, n) => ({ ...i, addedAt: Date.now() + n })) : [];
    const f = { id: crypto.randomUUID(), name, createdAt: Date.now(), items };
    store.d.folders.push(f); store.save(); broadcastTv({ t: 'folders-changed' });
    return send(res, 200, f);
  }
  if ((mm = p.match(/^\/api\/folders\/([\w-]+)$/))) {
    const f = store.d.folders.find((x) => x.id === mm[1]);
    if (!f) return send(res, 404, { error: 'Folder not found' });
    if (m === 'DELETE') { store.d.folders = store.d.folders.filter((x) => x !== f); store.save(); broadcastTv({ t: 'folders-changed' }); return send(res, 200, { ok: true }); }
    if (m === 'PATCH') {
      const b = await json(req); const name = typeof b.name === 'string' ? b.name.trim().slice(0, 40) : '';
      if (!name) return send(res, 400, { error: 'Give the folder a name.' });
      f.name = name; store.save(); broadcastTv({ t: 'folders-changed' }); return send(res, 200, f);
    }
    if (m === 'GET') return send(res, 200, f);
  }
  if ((mm = p.match(/^\/api\/folders\/([\w-]+)\/items$/)) && m === 'POST') {
    const f = store.d.folders.find((x) => x.id === mm[1]);
    if (!f) return send(res, 404, { error: 'Folder not found' });
    const it = cleanItem((await json(req)).item);
    if (f.items.some((x) => x.id === it.id && x.type === it.type)) return send(res, 200, { ok: true, already: true });
    f.items.push({ ...it, addedAt: Date.now() }); store.save(); broadcastTv({ t: 'folders-changed' });
    return send(res, 200, { ok: true });
  }
  if ((mm = p.match(/^\/api\/folders\/([\w-]+)\/items\/(movie|tv)\/(\d+)$/)) && m === 'DELETE') {
    const f = store.d.folders.find((x) => x.id === mm[1]);
    if (!f) return send(res, 404, { error: 'Folder not found' });
    f.items = f.items.filter((x) => !(x.type === mm[2] && x.id === +mm[3])); store.save(); broadcastTv({ t: 'folders-changed' });
    return send(res, 200, { ok: true });
  }

  // ---- recently viewed & playback progress
  if (p === '/api/recent' && m === 'GET') return send(res, 200, { items: store.d.recent });
  if (p === '/api/recent' && m === 'POST') {
    const it = cleanItem((await json(req)).item);
    store.d.recent = [{ ...it, viewedAt: Date.now() }, ...store.d.recent.filter((x) => !(x.id === it.id && x.type === it.type))].slice(0, 40);
    store.save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/recent' && m === 'DELETE') { store.d.recent = []; store.save(); return send(res, 200, { ok: true }); }
  if (p === '/api/watching' && m === 'GET') return send(res, 200, { items: store.d.watching });
  if ((mm = p.match(/^\/api\/watching\/(movie|tv):(\d+)$/)) && m === 'DELETE') {
    store.d.watching = store.d.watching.filter((w) => w.key !== `${mm[1]}:${mm[2]}`); store.save(); broadcastTv({ t: 'watching-changed' });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/progress' && m === 'POST') {
    const b = await json(req);
    if (typeof b.key !== 'string') return send(res, 400, { error: 'bad key' });
    const k = sha(b.key).slice(0, 24);
    if (b.done) delete store.d.progress[k]; else store.d.progress[k] = { pos: +b.pos || 0, dur: +b.dur || 0, t: Date.now() };
    const keys = Object.keys(store.d.progress);
    if (keys.length > 300) keys.sort((a, c) => store.d.progress[a].t - store.d.progress[c].t).slice(0, keys.length - 300).forEach((x) => delete store.d.progress[x]);
    store.save(); return send(res, 200, { ok: true });
  }
  if (p === '/api/progress' && m === 'GET') { const k = sha(url.searchParams.get('key') || '').slice(0, 24); return send(res, 200, store.d.progress[k] || null); }

  // ---- local media (TV computer only)
  if (p.startsWith('/api/media/')) {
    localOnly();
    if (p === '/api/media/roots') return send(res, 200, { roots: await media.roots(store.d.mediaFolders), pinned: store.d.mediaFolders, vlc: system.info().vlc });
    if (p === '/api/media/list') return send(res, 200, await media.list(url.searchParams.get('path')));
    if (p === '/api/media/stream') return media.stream(req, res, url.searchParams.get('path'));
    if (p === '/api/media/recent') return send(res, 200, { items: await media.recentVideos(store.d.mediaFolders, 40) });
    if (p === '/api/media/match') { try { return send(res, 200, await tmdb.matchFile(url.searchParams.get('name') || '')); } catch { return send(res, 200, null); } }
    if (p === '/api/media/pin' && m === 'POST') {
      const dir = media.checkPath((await json(req)).path);
      if (!dir) return send(res, 400, { error: 'Bad path' });
      if (!store.d.mediaFolders.includes(dir)) store.d.mediaFolders.push(dir);
      store.save(); return send(res, 200, { pinned: store.d.mediaFolders });
    }
    if (p === '/api/media/unpin' && m === 'POST') {
      const dir = (await json(req)).path; store.d.mediaFolders = store.d.mediaFolders.filter((x) => x !== dir);
      store.save(); return send(res, 200, { pinned: store.d.mediaFolders });
    }
    if (p === '/api/media/vlc' && m === 'POST') {
      const b = await json(req); const file = media.checkPath(b.path);
      if (!file || !media.isVideo(file) || !fs.existsSync(file)) return send(res, 400, { error: 'File not found' });
      return send(res, 200, system.openVlc(file, path.basename(file)));
    }
  }

  // ---- backgrounds
  if (p === '/api/backgrounds' && m === 'GET') return send(res, 200, { backgrounds: store.d.backgrounds, current: S().background });
  if (p === '/api/backgrounds' && m === 'POST') {
    const type = (req.headers['content-type'] || '').split(';')[0];
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[type];
    if (!ext) return send(res, 415, { error: 'Use a JPEG, PNG, WebP or GIF image. (iPhone HEIC photos: choose “Most Compatible” or take a screenshot.)' });
    const body = await readBody(req, 30 << 20);
    const id = crypto.randomUUID();
    fs.writeFileSync(path.join(BG_DIR, id + ext), body);
    const name = decodeURIComponent(req.headers['x-filename'] || 'Background').replace(/\.[^.]+$/, '').slice(0, 40);
    const bg = { id, file: id + ext, name, addedAt: Date.now() };
    store.d.backgrounds.push(bg);
    S().background = { mode: 'custom', image: id };
    store.save(); broadcastTv({ t: 'bg-changed' });
    return send(res, 200, bg);
  }
  if ((mm = p.match(/^\/api\/backgrounds\/([\w-]+)$/)) && m === 'DELETE') {
    const bg = store.d.backgrounds.find((x) => x.id === mm[1]);
    if (!bg) return send(res, 404, { error: 'Not found' });
    try { fs.unlinkSync(path.join(BG_DIR, bg.file)); } catch {}
    store.d.backgrounds = store.d.backgrounds.filter((x) => x !== bg);
    if (S().background.image === bg.id) S().background = { mode: 'artwork', image: null };
    store.save(); broadcastTv({ t: 'bg-changed' });
    return send(res, 200, { ok: true });
  }

  // ---- system: volume, external apps, pairing admin
  if (p === '/api/volume') {
    if (m === 'POST') { const b = await json(req); return send(res, 200, await volumeAction(b.a, b.v)); }
    return send(res, 200, await refreshVolume());
  }
  if (p === '/api/open' && m === 'POST') {
    const b = await json(req);
    let target;
    if (b.service && SERVICES[b.service]) target = { url: b.query ? SERVICES[b.service].url(b.query) : SERVICES[b.service].home, label: SERVICES[b.service].name, youtube: b.service === 'youtube' };
    else if (b.shortcut) {
      const sc = S().shortcuts.find((x) => x.id === b.shortcut);
      if (sc) target = { url: sc.url, label: sc.name, assist: S().blockPopups !== false ? { block: true, autoplay: false, cover: coverFor(sc.name, 'Opening…') } : null };
    }
    else if (b.adblockSetup) target = { url: 'https://chromewebstore.google.com/category/extensions/productivity/privacy', label: 'Ad blocker set-up', setup: true, watch: true };
    else if (b.watchLink && typeof b.title === 'string' && findWatchLink(b.linkId)) target = watchTarget(b);
    else if (b.youtubeVideo && /^[\w-]{6,20}$/.test(b.youtubeVideo)) target = { url: `https://www.youtube.com/tv#/watch?v=${b.youtubeVideo}`, label: 'YouTube', youtube: true };
    if (!target) return send(res, 400, { error: 'Unknown destination' });
    // The Watch button always uses Brave when it's installed (Brave Shields blocks ads); other sites follow the setting.
    return send(res, 200, openTarget(target));
  }
  // ---- the phone's Now Playing screen: what's on the TV, and play / pause / skip
  if (p === '/api/playback' && m === 'GET') {
    const ext = system.external, g = ext?.guard;
    return send(res, 200, { open: !!ext, kind: ext?.kind || null, label: ext?.label || null, controllable: !!g?.playing?.(), canSave: !!g?.canSave?.(), status: g?.status?.() || null });
  }
  if (p === '/api/playback' && m === 'POST') {
    const b = await json(req), g = system.external?.guard;
    if (!['toggle', 'play', 'pause', 'seek', 'seekTo'].includes(b.cmd)) return send(res, 400, { error: 'Unknown command' });
    if (!g?.playing?.()) return send(res, 409, { error: 'Nothing is playing on the TV' });
    return send(res, 200, { status: await g.control(b.cmd, b.arg) });
  }
  // ---- watching on the phone: the film's address on a Watch website, and whether that site lets Lumen show it
  // inside its own screen (sites say so themselves; when they don't allow it, the phone opens the browser instead)
  const itemFrom = (q) => { const t = q.get('type'), id = parseInt(q.get('id'), 10); return ['movie', 'tv'].includes(t) && Number.isInteger(id) ? { type: t, id } : null; };
  if (p === '/api/watch-url' && m === 'GET') {
    const w = findWatchLink(url.searchParams.get('link')); const title = (url.searchParams.get('title') || '').slice(0, 200);
    if (!w || !title) return send(res, 400, { error: 'No Watch website set' });
    const y = parseInt(url.searchParams.get('year'), 10);
    const saved = (store.d.linkOverrides || {})[overrideKey(w.id, itemFrom(url.searchParams), title)];
    return send(res, 200, { url: saved || buildWatchUrl(w.pattern, title, Number.isInteger(y) ? y : null), saved: !!saved, name: w.name || hostOf(w.pattern) });
  }
  // which Watch websites have a page you saved for this film; forget one (or save one from the phone)
  if (p === '/api/film-site' && m === 'GET') {
    const it = itemFrom(url.searchParams); const id = it && (store.d.filmSites || {})[`${it.type}:${it.id}`];
    return send(res, 200, { linkId: id && watchLinks().some((w) => w.id === id) ? id : null });
  }
  if (p === '/api/watch-saved' && m === 'GET') {
    const it = itemFrom(url.searchParams), title = url.searchParams.get('title') || '';
    return send(res, 200, { saved: watchLinks().filter((w) => (store.d.linkOverrides || {})[overrideKey(w.id, it, title)]).map((w) => w.id) });
  }
  if (p === '/api/watch-saved' && m === 'POST') {
    const b = await json(req), w = findWatchLink(b.linkId);
    const it = b.item && ['movie', 'tv'].includes(b.item.type) && Number.isInteger(b.item.id) ? { type: b.item.type, id: b.item.id } : null;
    if (!w || (!it && typeof b.title !== 'string')) return send(res, 400, { error: 'Unknown film' });
    if (b.url !== null && !/^https?:\/\//i.test(String(b.url || ''))) return send(res, 400, { error: 'Bad address' });
    saveOverride(w.id, it, b.title, b.url);
    return send(res, 200, { ok: true });
  }
  // "Use this page" from the phone while you browse the website on the TV
  if (p === '/api/playback/save-link' && m === 'POST') {
    const g = system.external?.guard;
    if (!g?.saveCurrent) return send(res, 409, { error: 'No Watch website is open on the TV' });
    const u = await g.saveCurrent();
    return u ? send(res, 200, { ok: true, url: u }) : send(res, 409, { error: 'Couldn’t read the page that’s open' });
  }
  if (p === '/api/embeddable' && m === 'GET') {
    const target = url.searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(target)) return send(res, 400, { error: 'Bad address' });
    try {
      const r = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' } });
      const xfo = (r.headers.get('x-frame-options') || '').toLowerCase();
      const csp = (r.headers.get('content-security-policy') || '').toLowerCase();
      const fa = (csp.match(/frame-ancestors([^;]*)/) || [])[1];
      const blocked = /deny|sameorigin/.test(xfo) || (fa !== undefined && !/\*/.test(fa));
      try { r.body?.cancel(); } catch {}
      return send(res, 200, { ok: !blocked && r.ok, status: r.status, url: r.url });
    } catch { return send(res, 200, { ok: false, status: 0, url: target }); }
  }
  if (p === '/api/close-external' && m === 'POST') { system.closeExternal(); return send(res, 200, { ok: true }); }
  // "Lumen" shortcut while Lumen is already running: just bring it up (no restart)
  if (p === '/api/show' && m === 'POST') { localOnly(); await handleKey('main'); return send(res, 200, { ok: true }); }
  // Settings → Update Lumen: look for a newer Lumen-TV zip in Downloads, and install it
  // Lumen as a desktop app: the app checks for and installs updates itself (GitHub releases, or a download in Downloads)
  if (SHELL && p === '/api/update/check' && m === 'GET') { localOnly(); return send(res, 200, await SHELL.checkUpdate()); }
  if (SHELL && p === '/api/update/run' && m === 'POST') { localOnly(); const b = await json(req); send(res, 200, { ok: true }); setTimeout(() => SHELL.installUpdate(b), 500); return; }
  if (SHELL && p === '/api/app' && m === 'GET') { localOnly(); return send(res, 200, SHELL.info()); }
  if (SHELL && p === '/api/app' && m === 'POST') { localOnly(); const b = await json(req); return send(res, 200, SHELL.set(b)); }
  if (p === '/api/update/check' && m === 'GET') {
    localOnly();
    if (process.platform !== 'win32') return send(res, 200, { supported: false, installed: VERSION });
    const out = await new Promise((r) => require('child_process').execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'windows', 'update-lumen.ps1'), '-Check'], { windowsHide: true, timeout: 20000 }, (e, so) => r(so || '')));
    try { return send(res, 200, { supported: true, ...JSON.parse(out.trim().split('\n').pop()) }); } catch { return send(res, 200, { supported: true, found: false, installed: VERSION }); }
  }
  if (p === '/api/update/run' && m === 'POST') {
    localOnly();
    if (process.platform !== 'win32') return send(res, 400, { error: 'Updating from Settings works on Windows' });
    const b = await json(req);
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', path.join(ROOT, 'windows', 'update-lumen.ps1'), '-Quiet'];
    if (typeof b.zip === 'string' && /\.zip$/i.test(b.zip)) args.push('-Zip', b.zip);
    send(res, 200, { ok: true });
    // runs on its own: it closes Lumen, copies the new files and starts Lumen again
    setTimeout(() => require('child_process').spawn('powershell.exe', args, { detached: true, stdio: 'ignore', windowsHide: true }).unref(), 800);
    return;
  }
  if (p === '/api/quit' && m === 'POST') { // the TV's close button: same as "Stop Lumen"
    localOnly();
    send(res, 200, { ok: true });
    setTimeout(() => { store.saveNow(); tmdb.flush(); system.closeExternal(true); system.quit(); }, 150); // the TV asks only once its goodbye has finished
    return;
  }
  if (p === '/api/pair/start' && m === 'POST') { localOnly(); return send(res, 200, startPairing()); }
  if (p === '/api/devices' && m === 'GET') { localOnly(); return send(res, 200, { devices: store.d.devices.map(({ tokenHash, ...d }) => d) }); }
  if ((mm = p.match(/^\/api\/devices\/([\w-]+)$/)) && m === 'DELETE') {
    localOnly();
    store.d.devices = store.d.devices.filter((d) => d.id !== mm[1]); store.save();
    for (const w of remotes) if (w.meta?.device?.id === mm[1]) w.close();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me' && m === 'DELETE' && who.device) {
    store.d.devices = store.d.devices.filter((d) => d.id !== who.device.id); store.save();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/me' && m === 'GET') return send(res, 200, { role: who.role, device: who.device ? { id: who.device.id, name: who.device.name } : null, deviceName: S().deviceName });
  if (p === '/api/test/system-log' && MOCK) return send(res, 200, { log: system.log || [], external: system.external });

  return send(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => { if (!res.headersSent) fail(res, e); else res.destroy(); if (!e.status) console.error(e); });
});

attach(server, '/ws', (req, url) => {
  if (!onHomeNetwork(req.socket.remoteAddress)) return null;
  if (url.searchParams.get('role') === 'tv') return isLocal(req) ? { role: 'tv' } : null;
  const dev = deviceFor(url.searchParams.get('t'));
  return dev ? { role: 'remote', device: dev } : null;
}, (ws, meta) => {
  ws.meta = meta;
  attach.sockets.add(ws);
  if (meta.role === 'tv') {
    tvs.add(ws);
    refreshVolume().then(() => { ws.send({ t: 'hello', remotes: remotes.size, volume: live.volume, external: live.external, sleep: sleepInfo() }); pushState(); });
    ws.on('message', (m) => {
      if (m.t === 'state') { live.view = String(m.view || '').slice(0, 40); live.textInput = !!m.textInput; live.inPlayer = !!m.inPlayer; pushState(); }
    });
    ws.on('close', () => { tvs.delete(ws); attach.sockets.delete(ws); pushState(); });
  } else {
    remotes.add(ws);
    meta.device.lastSeen = Date.now(); store.save();
    broadcastTv({ t: 'remotes', count: remotes.size, name: meta.device.name });
    refreshVolume().then(() => ws.send(remoteState()));
    ws.on('message', (m) => onRemoteMessage(m, ws));
    ws.on('close', () => { remotes.delete(ws); attach.sockets.delete(ws); broadcastTv({ t: 'remotes', count: remotes.size }); });
  }
});

// Listen on IPv6 + IPv4 together. Windows resolves "localhost" to ::1 first; with an IPv4-only server every
// new connection waited ~2 s before falling back — a big part of the slow start.
function warmUp() { // fill the cache for the first screens so they appear immediately
  if (!S().tmdbKey && !MOCK) return;
  const ctx = { recent: store.d.recent.slice(0, 20), because: store.d.recent[0] || null };
  tmdb.section('home', ctx).then(() => Promise.all(['movies', 'tv', 'free'].map((n) => tmdb.section(n).catch(() => {})))).catch(() => {});
}
server.on('error', (e) => {
  if ((e.code === 'EAFNOSUPPORT' || e.code === 'EADDRNOTAVAIL') && !server.listening) server.listen(PORT, '0.0.0.0', warmUp);
  else if (SHELL) SHELL.serverFailed(e);
  else { console.error(e); process.exit(1); }
});
server.listen(PORT, '::', () => {
  warmUp();
  system.brightness = dimFactor(S().brightness?.level ?? 100);
  if (S().brightness?.hw) setBrightness(S().brightness.level);
  console.log(`Lumen running.\n  TV:     http://localhost:${PORT}/tv/\n  Setup:  http://localhost:${PORT}/setup/\n  Phone:  http://${lanHost()}:${PORT}/remote/  (pair from the TV first)`);
  if (MOCK) console.log('  (mock TMDB data)');
  resolveFolderArt();
  SHELL?.serverReady(PORT);
});

// for the desktop app: save everything before it closes
module.exports = { port: PORT, flush: () => { store.saveNow(); tmdb.flush(); }, closeExternal: (silent) => system.closeExternal(silent), broadcastTv: (m) => broadcastTv(m), version: VERSION };

process.on('SIGINT', () => { store.saveNow(); tmdb.flush(); system.closeExternal(true); process.exit(0); });
process.on('SIGTERM', () => { store.saveNow(); tmdb.flush(); process.exit(0); });
