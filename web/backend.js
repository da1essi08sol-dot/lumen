// Lumen Web: everything the phone app normally asks the laptop for, done on the phone itself.
// Film data comes straight from TMDB (with your own free key); your settings, folders and
// Continue Watching are kept in this browser's storage. Nothing is sent anywhere else.
import { createTmdb, SERVICES } from './tmdb.js';

const KEY = 'lumen.web.v1';
const ACCENTS = { white: '#ffffff', amber: '#ffc970', rose: '#ffa0b6', mint: '#80e8ba', sky: '#82c6ff', lilac: '#c4acff', red: '#ff453a', scarlet: '#ff2a1a', crimson: '#dc143c', cherry: '#b3001b', coral: '#ff7262' };
export const ACCENT_LIST = Object.entries(ACCENTS);
export const FONTS = ['classic', 'cinema', 'bold', 'signage', 'serif'];
const blank = () => ({
  settings: { tmdbKey: '', region: 'GB', language: 'en-GB', userName: '', accent: 'white', font: 'classic', watchLinks: [],
    services: { youtube: true, iplayer: true, itvx: true, channel4: true, my5: true, tubi: true, pluto: true } },
  folders: [], recent: [], watching: [], filmSites: {},
});
let db;
try { db = { ...blank(), ...JSON.parse(localStorage.getItem(KEY) || '{}') }; db.settings = { ...blank().settings, ...(db.settings || {}) }; } catch { db = blank(); }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
const S = () => db.settings;
const tmdb = createTmdb(S);

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const cleanItem = (i) => ({ id: +i.id, type: i.type === 'tv' ? 'tv' : 'movie', title: String(i.title || '').slice(0, 200), year: Number.isInteger(+i.year) ? +i.year : null, poster_path: i.poster_path || null, backdrop_path: i.backdrop_path || null });
const accentRgb = () => { const a = S().accent || 'white', h = ACCENTS[a] || (/^#[0-9a-f]{6}$/i.test(a) ? a : '#ffffff'), n = parseInt(h.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };

// the Watch website address for a film: the pattern plus the film's name (same rules as Lumen on the laptop)
const slugify = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().replace(/[\s-]+/g, '-');
export function buildWatchUrl(pattern, title, year) {
  const slug = encodeURIComponent(slugify(title));
  if (/\{(name|slug)\}/i.test(pattern)) return pattern.replace(/\{(name|slug)\}/gi, slug).replace(/\{year\}/gi, year ? String(year) : '');
  return pattern.replace(/\/*$/, '/') + slug + '/';
}
export function cleanWatchPattern(raw) {
  let p = String(raw || '').trim(); if (!p) return '';
  if (!/^https?:\/\//i.test(p)) p = 'https://' + p;
  try { const u = new URL(buildWatchUrl(p, 'test film', 2000)); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null; } catch { return null; }
  return p.slice(0, 500);
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'the website'; } };

// progress reported by Lumen Browser (Android) while a film plays, for Continue Watching
export function saveProgress({ id, type, title, year, poster_path, backdrop_path, t, d, linkId }) {
  if (!(d > 60) || !(t >= 0) || !id) return;
  const key = `${type}:${id}`, list = db.watching, i = list.findIndex((w) => w.key === key);
  if (i >= 0) list.splice(i, 1);
  if (!(t / d > 0.94 || d - t < 150) && t > 60) list.unshift({ key, ...cleanItem({ id, type, title, year, poster_path, backdrop_path }), t, d, linkId: linkId || null, updatedAt: Date.now() });
  db.watching = list.slice(0, 30); save();
}

export async function api(path, opts = {}) {
  const url = new URL(path, 'https://lumen.local'); const p = url.pathname, m = (opts.method || 'GET').toUpperCase(), b = opts.body || {};
  let mm;
  if (p === '/api/config') return { web: true, imageBase: 'https://image.tmdb.org/t/p', hasKey: !!S().tmdbKey, keyHint: S().tmdbKey ? '…' + S().tmdbKey.slice(-4) : '', region: S().region,
    watchLinks: S().watchLinks, userName: S().userName, accent: S().accent, accentRgb: accentRgb(), font: S().font, services: S().services, serviceNames: Object.fromEntries(Object.entries(SERVICES).map(([k, v]) => [k, v.name])) };
  if (p === '/api/settings' && m === 'POST') {
    const s = S();
    if (typeof b.tmdbKey === 'string') {
      const k = b.tmdbKey.trim();
      if (k) { const old = s.tmdbKey; s.tmdbKey = k; try { await tmdb.section('movies'); } catch (e) { s.tmdbKey = old; throw err(e.status === 401 ? 'TMDB didn’t accept that key. Check it and try again.' : e.message); } }
      else s.tmdbKey = '';
    }
    if (typeof b.userName === 'string') s.userName = b.userName.trim().slice(0, 24);
    if (typeof b.region === 'string' && /^[A-Z]{2}$/.test(b.region)) s.region = b.region;
    if (typeof b.accent === 'string' && (ACCENTS[b.accent] || /^#[0-9a-f]{6}$/i.test(b.accent))) s.accent = b.accent;
    if (FONTS.includes(b.font)) s.font = b.font;
    if (Array.isArray(b.watchLinks)) {
      const out = [];
      for (const w of b.watchLinks.slice(0, 8)) { const pat = cleanWatchPattern(w.pattern); if (pat === null) throw err(`“${String(w.pattern).slice(0, 40)}” isn’t a web address. Example: example.com/movie/`); if (pat) out.push({ id: w.id || 'w' + uid().slice(0, 8), pattern: pat, name: String(w.name || '').trim().slice(0, 30) }); }
      s.watchLinks = out;
    }
    if (b.services && typeof b.services === 'object') for (const k of Object.keys(SERVICES)) if (typeof b.services[k] === 'boolean') s.services[k] = b.services[k];
    save(); return { ok: true };
  }
  if ((mm = p.match(/^\/api\/section\/(home|movies|tv|free|recent)$/))) {
    const ctx = mm[1] === 'home' ? { recent: db.recent.slice(0, 20), because: db.recent[0] || null } : mm[1] === 'recent' ? { folderAdds: db.folders.flatMap((f) => f.items).filter((i) => i.poster_path).sort((a, c) => c.addedAt - a.addedAt).slice(0, 20), media: [] } : {};
    const data = await tmdb.section(mm[1], ctx);
    if (mm[1] === 'home' && data.hero) data.heroEyebrow = 'Recommended for you';
    return data;
  }
  if ((mm = p.match(/^\/api\/details\/(movie|tv)\/(\d+)$/))) {
    const d = await tmdb.details(mm[1], +mm[2]);
    db.recent = [{ ...cleanItem(d), viewedAt: Date.now() }, ...db.recent.filter((x) => !(x.id === d.id && x.type === d.type))].slice(0, 40); save();
    return d;
  }
  if ((mm = p.match(/^\/api\/collection\/(\d+)$/))) return tmdb.collection(+mm[1]);
  if ((mm = p.match(/^\/api\/season\/(\d+)\/(\d+)$/))) return tmdb.season(+mm[1], +mm[2]);
  if (p === '/api/search') return { results: await tmdb.search((url.searchParams.get('q') || '').slice(0, 100)) };
  // bringing everything across from Lumen on the laptop (its phone page makes the code: Library › Use Lumen without the laptop)
  if (p === '/api/import' && m === 'POST') {
    const t = b; if (!t || t.lumenTransfer !== 1) throw err('That isn’t a Lumen transfer code. Copy it again from Lumen on your laptop.');
    const s = S(), from = t.settings || {};
    if (from.tmdbKey) { const old = s.tmdbKey; s.tmdbKey = String(from.tmdbKey).trim(); try { await tmdb.section('movies'); } catch (e) { s.tmdbKey = old; if (!old) throw err('The TMDB key from your laptop didn’t work here. Paste your key above instead.'); } }
    if (/^[A-Z]{2}$/.test(from.region || '')) s.region = from.region;
    if (from.userName) s.userName = String(from.userName).slice(0, 40);
    if (from.accent) s.accent = from.accent;
    if (FONTS.includes(from.font)) s.font = from.font;
    if (from.services && typeof from.services === 'object') s.services = { ...s.services, ...from.services };
    for (const w of Array.isArray(from.watchLinks) ? from.watchLinks : []) {
      const pat = cleanWatchPattern(w && w.pattern); if (!pat || s.watchLinks.some((x) => x.pattern === pat) || s.watchLinks.length >= 8) continue;
      s.watchLinks.push({ id: typeof w.id === 'string' ? w.id.slice(0, 60) : uid(), pattern: pat, name: String(w.name || hostOf(pat)).slice(0, 40) });
    }
    let films = 0;
    for (const f of Array.isArray(t.folders) ? t.folders : []) {
      const name = String(f.name || '').trim().slice(0, 40); if (!name) continue;
      let mine = db.folders.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!mine) { mine = { id: uid(), name, items: [], createdAt: Date.now() }; db.folders.push(mine); }
      for (const i of Array.isArray(f.items) ? f.items : []) { const c = cleanItem(i); if (!c.id || mine.items.some((x) => x.id === c.id && x.type === c.type)) continue; mine.items.push({ ...c, addedAt: +i.addedAt || Date.now() }); films++; }
    }
    const keyOf = (i) => `${i.type}:${i.id}`;
    const merge = (mineList, theirs, max) => { const seen = new Set(mineList.map(keyOf)); return [...mineList, ...(Array.isArray(theirs) ? theirs : []).filter((i) => i && +i.id && !seen.has(keyOf(i)))].slice(0, max); };
    db.recent = merge(db.recent, t.recent, 40);
    db.watching = merge(db.watching, (t.watching || []).map((w) => ({ ...w, key: keyOf(w) })), 30);
    if (t.filmSites && typeof t.filmSites === 'object') db.filmSites = { ...t.filmSites, ...db.filmSites };
    save();
    return { ok: true, websites: s.watchLinks.length, folders: db.folders.length, films };
  }
  if (p === '/api/folders' && m === 'GET') return { folders: db.folders };
  if (p === '/api/folders' && m === 'POST') {
    const name = String(b.name || '').trim().slice(0, 40); if (!name) throw err('Give the folder a name.');
    if (db.folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) throw err(`You already have a folder called “${name}”.`, 409);
    const f = { id: uid(), name, createdAt: Date.now(), items: (b.items || []).slice(0, 200).map(cleanItem).map((i, n) => ({ ...i, addedAt: Date.now() + n })) };
    db.folders.push(f); save(); return f;
  }
  if ((mm = p.match(/^\/api\/folders\/([\w-]+)$/))) {
    const f = db.folders.find((x) => x.id === mm[1]); if (!f) throw err('Folder not found', 404);
    if (m === 'DELETE') { db.folders = db.folders.filter((x) => x !== f); save(); return { ok: true }; }
    if (m === 'PATCH') { const name = String(b.name || '').trim().slice(0, 40); if (!name) throw err('Give the folder a name.'); f.name = name; save(); return f; }
    return f;
  }
  if ((mm = p.match(/^\/api\/folders\/([\w-]+)\/items$/)) && m === 'POST') {
    const f = db.folders.find((x) => x.id === mm[1]); if (!f) throw err('Folder not found', 404);
    const it = cleanItem(b.item); if (!f.items.some((x) => x.id === it.id && x.type === it.type)) { f.items.push({ ...it, addedAt: Date.now() }); save(); }
    return { ok: true };
  }
  if ((mm = p.match(/^\/api\/folders\/([\w-]+)\/items\/(movie|tv)\/(\d+)$/)) && m === 'DELETE') {
    const f = db.folders.find((x) => x.id === mm[1]); if (f) { f.items = f.items.filter((x) => !(x.type === mm[2] && x.id === +mm[3])); save(); }
    return { ok: true };
  }
  if (p === '/api/watching' && m === 'GET') return { items: db.watching };
  if ((mm = p.match(/^\/api\/watching\/(movie|tv):(\d+)$/)) && m === 'DELETE') { db.watching = db.watching.filter((w) => w.key !== `${mm[1]}:${mm[2]}`); save(); return { ok: true }; }
  if (p === '/api/watch-url') {
    const links = S().watchLinks, w = links.find((x) => x.id === url.searchParams.get('link')) || links[0];
    if (!w) throw err('Add a Watch website in Settings first.');
    const y = parseInt(url.searchParams.get('year'), 10), type = url.searchParams.get('type'), id = url.searchParams.get('id');
    if (id) { db.filmSites[`${type}:${id}`] = w.id; save(); }
    return { url: buildWatchUrl(w.pattern, url.searchParams.get('title') || '', Number.isInteger(y) ? y : null), name: w.name || hostOf(w.pattern), linkId: w.id };
  }
  if (p === '/api/film-site') return { linkId: db.filmSites[`${url.searchParams.get('type')}:${url.searchParams.get('id')}`] || null };
  if (p === '/api/watch-saved') return { saved: [] };
  if (p === '/api/export') return JSON.parse(JSON.stringify({ ...db, settings: { ...db.settings, tmdbKey: '' } }));
  throw err('That needs Lumen on a computer', 404);
}
