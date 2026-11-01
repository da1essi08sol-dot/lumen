// Watch helper for websites Lumen opens (the Watch button and website tiles).
//
// Lumen starts the browser with a private control port that only this computer can reach, and uses it to:
//   • block pop-ups: closes any extra window/tab the site tries to open;
//   • block redirects: cancels attempts to move the main page to a different website
//     (video players embedded from other websites are left alone, so playback still works);
//   • show a loading screen over the site until the film is playing;
//   • press play for you, then make the video fill the screen;
//   • report how far through the film you are, and jump back to where you left off.
// For the first few seconds the page may redirect freely (sites often hop to a mirror address);
// whichever sites it lands on during that time are allowed too.
'use strict';
const fs = require('fs');
const path = require('path');

const SLD = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ltd', 'plc', 'me']);
function site(u) {
  let h; try { h = new URL(u).hostname.toLowerCase(); } catch { return ''; }
  if (/^[\d.]+$/.test(h) || h.includes(':')) return h; // IP address
  const p = h.replace(/^www\./, '').split('.');
  if (p.length > 2 && p[p.length - 1].length === 2 && SLD.has(p[p.length - 2])) return p.slice(-3).join('.');
  return p.slice(-2).join('.');
}
const escHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- the loading screen: the shared LumenTV design (public/shared/loading.js), loaded once at start-up
// Read as plain text and run here, rather than import()-ed: older Node.js versions on Windows can't import
// this file, and then the website showed the old loading screen.
let tpl = null;
try {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shared', 'loading.js'), 'utf8').replace(/^export /gm, '');
  tpl = new Function(src + '\nreturn { loadingHtml, logoSvg, wallUrl, LOADING_CSS };')();
} catch (e) { console.error('loading screen template:', e.message); }
function coverHtml(opts) {
  if (tpl) return tpl.loadingHtml(opts);
  return `<div id="__lumen_cover" style="position:fixed;inset:0;z-index:2147483647;background:#000;display:grid;place-items:center;color:#fff;font:700 48px system-ui;text-align:center">${escHtml(opts.title)}</div>`;
}
function loadingPageUrl(opts, realUrl) {
  // If the helper can't connect for some reason, the page carries on to the site by itself after 10 s.
  const html = `<!doctype html><meta charset="utf-8"><title>${escHtml(opts.title)}</title><body style="margin:0;background:#050507">${coverHtml(opts)}
    <script>setTimeout(function(){location.replace(${JSON.stringify(realUrl)})},10000)</script>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}
// injected into the site's main page: keeps the loading cover on top until Lumen reveals the page.
// It can also ask "film not found — open the website anyway, or go back?" (arrows + OK on the remote).
function coverScript(opts, maxMs) {
  return `(() => { if (window.top !== window || window.__lumenCover) return; window.__lumenCover = 1;
  const html = ${JSON.stringify(coverHtml(opts))}; let done = false, asking = false, sel = 0;
  const make = () => { if (done || !document.documentElement || document.getElementById('__lumen_cover')) return;
    const t = document.createElement('div'); t.innerHTML = html; const d = t.firstElementChild; if (!d) return;
    d.style.pointerEvents = asking ? 'auto' : 'none'; if (asking) d.classList.add('lmn-ask');
    document.documentElement.appendChild(d); wire(d); };
  const cover = () => document.getElementById('__lumen_cover');
  const btns = () => [...(cover()?.querySelectorAll('.lmn-btn') || [])];
  const mark = () => btns().forEach((b, i) => b.classList.toggle('on', i === sel));
  const pick = (c) => { asking = false; if (window.lumenChoice) window.lumenChoice(c); };
  const wire = (d) => d.querySelectorAll('.lmn-btn').forEach((b) => b.addEventListener('click', () => pick(b.dataset.c)));
  const obs = new MutationObserver(make); obs.observe(document, { childList: true, subtree: true }); make();
  window.__lumenStage = (t) => { const e = cover()?.querySelector('.lmn-stage'); if (e) e.textContent = t; };
  window.__lumenReveal = () => { if (done) return; done = true; asking = false; obs.disconnect(); const d = cover(); if (d) { d.style.opacity = '0'; setTimeout(() => d.remove(), 800); } };
  window.__lumenAsk = (title, sub) => { const d = cover(); if (!d) return; asking = true; sel = 0; clearTimeout(window.__lumenMax);
    d.classList.add('lmn-ask'); d.style.pointerEvents = 'auto';
    d.querySelector('.lmn-title').textContent = title; d.querySelector('.lmn-sub').textContent = sub; mark(); };
  addEventListener('keydown', (e) => {
    if (asking) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { sel = sel ? 0 : 1; mark(); }
      else if (e.key === 'Enter' || e.key === ' ') pick(btns()[sel]?.dataset.c);
      else if (e.key === 'Escape' || e.key === 'Backspace') pick('back');
      e.preventDefault(); e.stopImmediatePropagation(); return;
    }
    window.__lumenReveal();
  }, true);
  window.__lumenMax = setTimeout(() => { if (!asking) window.__lumenReveal(); }, ${maxMs});
})();`;
}

// run inside each frame: is a film playing? if not, try to start it
const PLAY_JS = `(() => {
  const vids = [...document.querySelectorAll('video')];
  const playing = vids.find((v) => !v.paused && v.currentTime > 0.3 && (v.duration || 0) > 60);
  if (playing) return { s: 'playing', t: playing.currentTime, d: playing.duration };
  const v = vids.find((v) => v.currentSrc || v.src || v.querySelector('source'));
  if (v && v.paused) { const p = v.play(); if (p) p.catch(() => {}); return { s: 'started' }; }
  const sel = ['.jw-display-icon-display', '.jw-icon-display', '.vjs-big-play-button', '.plyr__control--overlaid', '.fp-play', '.play-button', '.play-btn', '.btn-play', '#play', '.playbtn', 'button[aria-label*="play" i]', '[class*="play-button" i]', '[class*="playbutton" i]', '[class*="big-play" i]'];
  for (const s of sel) { const el = document.querySelector(s); if (el && el.getClientRects().length) { el.click(); return { s: 'clicked' }; } }
  return { s: vids.length ? 'video' : 'none' };
})()`;
// Is the video actually showing pictures? (Sound can play while the picture can't be decoded.)
const PICTURE_JS = `(() => { const v = [...document.querySelectorAll('video')].find((v) => !v.paused && (v.duration || 0) > 60); if (!v) return null;
  const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
  return { w: v.videoWidth, frames: q ? q.totalVideoFrames : -1, t: v.currentTime }; })()`;
const PROGRESS_JS = `(() => { const v = [...document.querySelectorAll('video')].filter((v) => (v.duration || 0) > 60).sort((a, b) => b.currentTime - a.currentTime)[0];
  return v ? { t: v.currentTime, d: v.duration, p: v.paused } : null; })()`;
const seekJs = (t) => `(() => { const v = [...document.querySelectorAll('video')].find((v) => (v.duration || 0) > 60); if (!v) return false; if (v.currentTime < ${t} - 30) v.currentTime = ${t}; return true; })()`;
// Real full screen of the whole player (video + its own controls), so nothing of the page covers the picture.
// Resolves true/false: whether full screen actually happened (a site's frame may not be allowed to).
const FULLSCREEN_JS = `(async () => { const v = [...document.querySelectorAll('video')].find((v) => !v.paused) || document.querySelector('video'); if (!v) return false;
  if (document.fullscreenElement) return true;
  const box = v.closest('.jwplayer, .video-js, .plyr, .html5-video-player, .art-video-player, .dplayer, .vjs-tech-wrapper, [class*="player" i]') || v;
  try { await (box.requestFullscreen || box.webkitRequestFullscreen).call(box); } catch { try { await v.requestFullscreen(); } catch { return false; } }
  return !!document.fullscreenElement; })()`;
// If the player's frame isn't allowed to go full screen itself, put the frame (the whole player) full screen instead.
const FULLSCREEN_IFRAME_JS = `(async () => { if (document.fullscreenElement) return true;
  const big = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const f = [...document.querySelectorAll('iframe')].filter((e) => big(e) > 40000).sort((a, b) => big(b) - big(a))[0]; if (!f) return false;
  try { await f.requestFullscreen(); } catch { return false; } return !!document.fullscreenElement; })()`;
// Skipping forward in full screen can leave a black picture with the sound still playing: Windows shows
// full-screen video as a graphics "overlay", and some drivers lose it when the video jumps. Every time a
// video skips (or restarts after buffering) we nudge it to redraw, which brings the picture straight back.
const REPAINT_JS = `(() => { if (window.__lumenRepaint) return true; window.__lumenRepaint = 1;
  const nudge = (e) => { const v = e.target; if (!(v instanceof HTMLVideoElement)) return;
    v.style.setProperty('opacity', '0.999', 'important'); v.style.setProperty('transform', 'translateZ(0)');
    setTimeout(() => { v.style.removeProperty('opacity'); v.style.removeProperty('transform'); }, 80);
    // (leaving and re-entering full screen after a skip is done from outside the page — see watchForSkips) };
  document.addEventListener('seeked', nudge, true); return true; })()`;
// Brightness: dims the whole page (and anything shown full screen) by a factor 0.1–1.
const dimJs = (f) => `(() => { const f = ${Number(f).toFixed(3)};
  const apply = () => { const root = document.documentElement; if (!root) return false;
    let s = document.getElementById('__lumen_dim');
    if (!s) { s = document.createElement('style'); s.id = '__lumen_dim'; root.appendChild(s); }
    s.textContent = f >= 0.999 ? '' : 'html{filter:brightness(' + f + ')!important}:fullscreen{filter:brightness(' + f + ')!important}'; return true; };
  if (!apply()) document.addEventListener('readystatechange', apply, { once: true }); })()`;
// ---- Filling the screen without "full screen" mode. The browser window already covers the whole TV, so Lumen
// stretches the player over the window instead of asking the page for full screen. It looks the same, but nothing
// can get stuck in full screen (that's what made the picture go black after skipping or resuming, with only the
// browser's X able to undo it), and the player's own buttons keep working.
// role 'player': the document the film plays in — stretch the player (video + its own controls) over it.
// role 'host':   a page that holds the player's frame — stretch that frame over it.
const FILL_JS = (role) => `(() => {
  const big = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  let box = null, v = null;
  if (${JSON.stringify(role)} === 'player') {
    const vids = [...document.querySelectorAll('video')];
    v = vids.find((x) => !x.paused && (x.duration || 0) > 60) || vids.find((x) => (x.duration || 0) > 60) || vids[0];
    if (v) box = v.closest('.jwplayer, .video-js, .plyr, .html5-video-player, .art-video-player, .dplayer, .vjs-tech-wrapper, [class*="player" i]') || v;
  } else box = [...document.querySelectorAll('iframe')].filter((e) => big(e) > 40000).sort((a, b) => big(b) - big(a))[0];
  if (!box) return 'none';
  if (!document.getElementById('__lumen_fill')) { const st = document.createElement('style'); st.id = '__lumen_fill';
    st.textContent = 'html,body{overflow:hidden!important;background:#000!important}'; (document.head || document.documentElement).appendChild(st); }
  for (const e of document.querySelectorAll('[data-lumen-fill]')) if (e !== box) { e.removeAttribute('data-lumen-fill'); e.setAttribute('style', e.dataset.lumenOld || ''); }
  if (!box.hasAttribute('data-lumen-fill')) { box.dataset.lumenOld = box.getAttribute('style') || ''; box.setAttribute('data-lumen-fill', '1'); }
  const css = { position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none', 'min-width': '0', 'min-height': '0',
    margin: '0', padding: '0', border: '0', transform: 'none', 'z-index': '2147483646', background: '#000' };
  for (const [k, val] of Object.entries(css)) box.style.setProperty(k, val, 'important');
  // a parent with a transform/filter would trap "fixed" inside it — clear those up the chain
  for (let a = box.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const cs = getComputedStyle(a); if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || /paint|layout|strict|content/.test(cs.contain)) {
      a.style.setProperty('transform', 'none', 'important'); a.style.setProperty('filter', 'none', 'important'); a.style.setProperty('perspective', 'none', 'important'); a.style.setProperty('contain', 'none', 'important'); } }
  if (v && box !== v) for (const [k, val] of Object.entries({ width: '100%', height: '100%', 'max-height': 'none', 'object-fit': 'contain' })) v.style.setProperty(k, val, 'important');
  return box.tagName.toLowerCase(); })()`;
// Bring a lost picture back: leave real full screen if the site (or you) entered it, then make the video redraw
// itself from scratch (hide it for two frames and show it again). Harmless if the picture was fine.
const REPAIR_JS = `(async () => {
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
  const v = [...document.querySelectorAll('video')].find((x) => (x.duration || 0) > 60); if (!v) return false;
  const two = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  v.style.setProperty('visibility', 'hidden', 'important'); await two();
  v.style.removeProperty('visibility'); v.style.setProperty('transform', 'translateZ(0)'); await two();
  v.style.removeProperty('transform'); return true; })()`;
const EXIT_FS_JS = 'document.fullscreenElement ? document.exitFullscreen().then(() => true, () => false) : false';

// tiny screenshot (PNG) → how bright the screen is. Used to notice a black picture while the film plays.
function pngStats(buf) {
  try {
    const zlib = require('zlib');
    let off = 8, w = 0, h = 0, ct = 0; const idat = [];
    while (off < buf.length) {
      const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; if (data[8] !== 8) return null; }
      else if (type === 'IDAT') idat.push(data); else if (type === 'IEND') break;
      off += 12 + len;
    }
    const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0; if (!bpp || !w || !h) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(stride * h);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
        let p = a; if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1; else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } else if (f === 0) p = 0;
        row[i] = (src[i] + p) & 255;
      }
    }
    let sum = 0, lit = 0, n = 0;
    for (let i = 0; i < px.length; i += bpp) { const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; sum += l; if (l > 28) lit++; n++; }
    return { mean: sum / n, lit: lit / n };
  } catch { return null; }
}

// in the main page: if real full screen didn't happen, stretch the player over the whole window
const THEATRE_JS = (inMain) => `(() => { if (document.fullscreenElement) return 'fs';
  const big = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
  const c = ${inMain ? `[...document.querySelectorAll('video')].find((v) => !v.paused)` : `[...document.querySelectorAll('iframe')].filter((e) => big(e) > 40000).sort((a, b) => big(b) - big(a))[0]`};
  if (!c) return 'none';
  const st = document.createElement('style'); st.textContent = 'html,body{overflow:hidden!important;background:#000!important}'; document.head.appendChild(st);
  c.setAttribute('style', 'position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;z-index:2147483646!important;background:#000!important;border:0!important;margin:0!important;object-fit:contain!important');
  return 'theatre'; })()`;

/**
 * options: block (pop-ups/redirects), autoplay, cover {title, sub, accent}, resumeAt (seconds),
 *          onProgress({t, d}), log
 */
function startGuard({ userDataDir, startUrl, block = true, autoplay = false, cover = null, resumeAt = 0, onProgress = null, onChoice = null, onNoPicture = null, onSaveLink = null, saveLabel = '', brightness = 1, graceMs = 8000, log = () => {} }) {
  let dimScriptId = null;
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  let ws = null, stopped = false, mainTarget = null, mainSession = null, msgId = 0, progT = null, playT = null;
  const pending = new Map();
  const frames = new Map(); // sessionId -> targetId (main page + embedded players)
  const popupSessions = new Set();
  const allowed = new Set([site(startUrl)]);
  let graceUntil = Infinity; // free movement until the real site's page has loaded (see onLoaded)
  const stats = { popups: 0, redirects: 0, playing: false };

  const send = (method, params = {}, sessionId) => new Promise((resolve) => {
    if (!ws || ws.readyState !== 1) return resolve(null);
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 5000);
  });
  // background reads (position, progress) don't pretend to be a key press — some players flash their controls
  // when they think you touched them
  const peek = (sessionId, expression) => send('Runtime.evaluate', { expression, returnByValue: true }, sessionId).then((r) => r?.result?.result?.value ?? null);
  const evaluate = (sessionId, expression, awaitPromise = false) => send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true, awaitPromise }, sessionId).then((r) => r?.result?.result?.value ?? null);

  async function attachMain(targetId) {
    const r = await send('Target.attachToTarget', { targetId, flatten: true });
    mainSession = r?.result?.sessionId;
    if (!mainSession) return;
    frames.set(mainSession, targetId);
    if (block) await send('Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] }, mainSession);
    await send('Page.enable', {}, mainSession);
    await send('Network.enable', {}, mainSession); // to notice "page not found"
    await send('Runtime.enable', {}, mainSession);
    await send('Runtime.addBinding', { name: 'lumenChoice' }, mainSession); // the cover's two buttons call back here
    await setBrightness(brightness);
    if (cover) await send('Page.addScriptToEvaluateOnNewDocument', { source: coverScript(cover, autoplay ? 30000 : 9000) }, mainSession);
    // embedded players live in their own frames: attach to them too, so we can press play inside them
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, mainSession);
    navigated = true;
    stage(autoplay ? 'Finding the film' : 'Opening');
    await send('Page.navigate', { url: startUrl }, mainSession); // leave the loading page for the real site
    setTimeout(onLoaded, graceMs + 4000); // in case the page never reports that it has loaded
  }

  // The site may hop addresses freely until its page has loaded; after that, it's locked to those sites.
  let loaded = false, navigated = false, notFound = false, browsing = false;
  async function onLoaded() {
    if (loaded || stopped) return;
    loaded = true;
    graceUntil = Date.now() + 1000;
    // "page not found": a 404 from the server, or a page that says so (many sites answer 200 with an error page)
    if (!notFound && mainSession) notFound = !!(await evaluate(mainSession, `(() => {
      const t = (document.title + ' ' + [...document.querySelectorAll('h1,h2')].slice(0, 3).map((h) => h.textContent).join(' ')).toLowerCase();
      const says = /\b404\b|not found|page not found|doesn.?t exist|no longer available|nothing (was )?found/.test(t);
      const player = document.querySelector('video, iframe[src*="embed"], iframe[allowfullscreen], .jwplayer, .video-js, .plyr');
      return says && !player; })()`));
    if (notFound) return askNotFound();
    if (autoplay) { stage('Pressing play'); playT = setTimeout(() => playLoop(0), 2000); }
    else setTimeout(reveal, 1500);
  }
  function askNotFound() {
    if (stopped || browsing) return;
    clearTimeout(playT);
    log('film page not found');
    stage('Not found');
    setTimeout(() => { if (!stopped && mainSession && !browsing) evaluate(mainSession, `window.__lumenAsk && window.__lumenAsk(${JSON.stringify(`Couldn’t find ${cover?.title || 'this film'}`)}, ${JSON.stringify(`It isn’t at that address on ${new URL(startUrl).hostname.replace(/^www\./, '')}. Open the website to search for it yourself, or go back.`)})`); }, 2000);
  }
  // While you look for the film yourself, a small button lets you keep the page you found: from then on that
  // film's Watch button goes straight there.
  const SAVE_PILL_JS = (label) => `(() => { if (window.top !== window || document.getElementById('__lumen_save')) return;
    const add = () => { if (!document.body || document.getElementById('__lumen_save')) return;
      const b = document.createElement('button'); b.id = '__lumen_save';
      b.textContent = '★  Use this page for ' + ${JSON.stringify(String(saveLabel || 'this film').slice(0, 60))};
      b.setAttribute('style', 'all:initial;position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:14px 22px;border-radius:999px;background:#fff;color:#111;font:700 17px/1.2 Segoe UI,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.45);cursor:pointer');
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); if (window.lumenSave) window.lumenSave(location.href); b.textContent = '✓  Saved — this film now opens here'; setTimeout(() => b.remove(), 3500); };
      document.body.appendChild(b);
      document.addEventListener('fullscreenchange', () => { b.style.display = document.fullscreenElement ? 'none' : ''; }); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add(); })()`;
  let pillId = null;
  async function offerSave() {
    if (!onSaveLink || !mainSession) return;
    await send('Runtime.addBinding', { name: 'lumenSave' }, mainSession);
    const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: SAVE_PILL_JS(saveLabel) }, mainSession);
    pillId = r?.result?.identifier || null;
  }
  async function saveCurrent() {
    if (!onSaveLink || !mainSession) return null;
    const u = await peek(mainSession, 'location.href');
    if (!/^https?:/.test(u || '')) return null;
    onSaveLink(u); return u;
  }
  function onChoiceMade(c) {
    if (c === 'site') { // go to the website's home page and hand over, so you can search it yourself
      browsing = true; stats.playing = true; clearTimeout(playT);
      offerSave().then(() => send('Page.navigate', { url: new URL(startUrl).origin + '/' }, mainSession)).then(() => setTimeout(reveal, 1200));
    } else onChoice?.('back');
  }

  // brightness can change while the website is open (from Settings or the phone)
  async function setBrightness(f) {
    brightness = f;
    if (!mainSession) return;
    if (dimScriptId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: dimScriptId }, mainSession);
    const r = await send('Page.addScriptToEvaluateOnNewDocument', { source: dimJs(f) }, mainSession);
    dimScriptId = r?.result?.identifier || null;
    evaluate(mainSession, dimJs(f));
  }

  const stage = (t) => { if (mainSession) evaluate(mainSession, `window.__lumenStage && window.__lumenStage(${JSON.stringify(t)})`); };
  function reveal() { if (mainSession) evaluate(mainSession, 'window.__lumenReveal && window.__lumenReveal()'); }

  async function playLoop(n) {
    if (stopped || stats.playing) return;
    if (n >= 12) { log('could not start the video by itself'); reveal(); return; }
    let found = null;
    for (const [sid] of frames) {
      const r = await evaluate(sid, PLAY_JS);
      if (r?.s === 'playing') { found = sid; break; }
    }
    if (found) return onPlaying(found);
    // every few tries, a real click in the middle of the screen, where players usually are
    if (n >= 2 && n % 2 === 0 && mainSession) {
      const m = await evaluate(mainSession, '[innerWidth, innerHeight]');
      if (m) for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: Math.round(m[0] / 2), y: Math.round(m[1] / 2), button: 'left', clickCount: 1 }, mainSession);
    }
    playT = setTimeout(() => playLoop(n + 1), 1500);
  }

  // sample twice, 3 s apart: time moving but no frames drawn (or no picture size) = sound without picture
  async function checkPicture(sid) {
    await new Promise((r) => setTimeout(r, 2500));
    const a = await evaluate(sid, PICTURE_JS); if (!a || stopped) return;
    await new Promise((r) => setTimeout(r, 3000));
    const b = await evaluate(sid, PICTURE_JS); if (!b || stopped) return;
    const timeMoved = b.t - a.t > 1.5;
    const noFrames = b.w === 0 || (b.frames >= 0 && b.frames - a.frames < 3);
    if (timeMoved && noFrames) { log('sound but no picture'); onNoPicture({ t: b.t }); }
  }

  // Fill the screen: the player inside its own page, and every page around it stretches the frame it's in.
  let playSid = null, skipT = null, lastFix = 0, lastJump = 0;
  async function fill() {
    if (!playSid) return 'none';
    const r = await evaluate(playSid, FILL_JS('player'));
    for (const [s] of frames) if (s !== playSid) {
      const holds = await evaluate(s, `[...document.querySelectorAll('iframe')].some((e) => { const r = e.getBoundingClientRect(); return r.width * r.height > 40000; })`);
      if (holds) await evaluate(s, FILL_JS('host'));
    }
    return r;
  }
  // Fix a black picture: leave full screen everywhere (the site's own, or one you pressed), redraw the video, and
  // fill the screen again — the same as the fix by hand, but automatic.
  async function repair(why) {
    if (stopped || !playSid || Date.now() - lastFix < 2500) return;
    lastFix = Date.now();
    for (const [s] of frames) if (s !== playSid) evaluate(s, EXIT_FS_JS, true);
    await evaluate(playSid, REPAIR_JS, true);
    await fill();
    log(`picture: refreshed (${why})`);
  }
  // Notice skips without touching the page: the player itself reports when its position jumps (any skip or fast
  // forward, however it was made), so Lumen does nothing at all while the film simply plays.
  const SEEK_WATCH_JS = `(() => { if (window.__lumenSeekWatch) return true; window.__lumenSeekWatch = 1;
    let last = 0, from = null;
    const film = (v) => v instanceof HTMLVideoElement && (v.duration || 0) > 60;
    document.addEventListener('timeupdate', (e) => { if (film(e.target) && from === null) last = e.target.currentTime; }, true);
    document.addEventListener('seeking', (e) => { if (film(e.target) && from === null) from = last; }, true);
    document.addEventListener('seeked', (e) => { const v = e.target; if (!film(v)) return;
      const jump = Math.abs(v.currentTime - (from ?? last)); from = null; last = v.currentTime;
      if (jump > 2.5 && window.lumenSeek) window.lumenSeek(String(Math.round(jump))); }, true);
    return true; })()`;
  async function watchForSkips(sid) {
    await send('Runtime.enable', {}, sid);
    await send('Runtime.addBinding', { name: 'lumenSeek' }, sid);
    await peek(sid, SEEK_WATCH_JS);
  }
  function onSeek() { lastJump = Date.now(); setTimeout(() => repair('skip'), 350); checkAfterJump(); }

  // And check the picture itself — but only just after a skip or resume, which is when it can go black. Taking a
  // screenshot makes the video flicker for an instant on some graphics drivers, so Lumen doesn't keep checking
  // while the film simply plays: one look about 3 s after each jump, and another only if that one was black.
  let checkT = null;
  async function isBlack() {
    const m = await evaluate(mainSession, '[innerWidth, innerHeight]'); if (!m) return false;
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, clip: { x: 0, y: 0, width: m[0], height: m[1], scale: 0.04 } }, mainSession);
    const st = shot?.result?.data ? pngStats(Buffer.from(shot.result.data, 'base64')) : null;
    return !!st && st.mean < 6 && st.lit < 0.004;
  }
  function checkAfterJump(tries = 2) {
    clearTimeout(checkT);
    checkT = setTimeout(async () => {
      if (stopped || !mainSession || !playSid) return;
      const p = await peek(playSid, PROGRESS_JS); if (!p || p.p) return;
      if (await isBlack()) { await repair('black picture'); if (tries > 1) checkAfterJump(tries - 1); }
    }, 3000);
  }

  // ---- what's playing, for the phone's Now Playing screen (the phone counts the seconds in between itself)
  let last = null;
  async function readStatus() {
    if (stopped || !playSid) return last;
    const p = await peek(playSid, PROGRESS_JS);
    if (p && p.d > 60) { last = { t: p.t, d: p.d, paused: !!p.p, at: Date.now() }; onProgress?.({ t: p.t, d: p.d }); }
    return last;
  }
  // play / pause / skip from the phone
  async function control(cmd, arg = 0) {
    if (!playSid) return null;
    const n = Number(arg) || 0;
    const js = `(async () => { const v = [...document.querySelectorAll('video')].filter((x) => (x.duration || 0) > 60).sort((a, b) => b.currentTime - a.currentTime)[0]; if (!v) return null;
      const c = ${JSON.stringify(cmd)};
      if (c === 'toggle') { if (v.paused) await v.play().catch(() => {}); else v.pause(); }
      else if (c === 'play') await v.play().catch(() => {});
      else if (c === 'pause') v.pause();
      else if (c === 'seek') v.currentTime = Math.max(0, Math.min(v.duration - 1, v.currentTime + ${n}));
      else if (c === 'seekTo') v.currentTime = Math.max(0, Math.min(v.duration - 1, ${n}));
      return { t: v.currentTime, d: v.duration, paused: v.paused }; })()`;
    const r = await evaluate(playSid, js, true);
    if (r) last = { ...r, at: Date.now() };
    return last;
  }

  async function onPlaying(sid) {
    stats.playing = true;
    log('film is playing');
    stage('Enjoy the film');
    playSid = sid;
    if (resumeAt > 60) { const ok = await evaluate(sid, seekJs(Math.floor(resumeAt))); if (ok) lastJump = Date.now(); }
    // fill the screen with the player (no "full screen" mode — see FILL_JS)
    for (const [s] of frames) evaluate(s, EXIT_FS_JS, true);
    const r = await fill();
    log(r !== 'none' ? `filled the screen (${r})` : 'could not find the player to fill the screen');
    setTimeout(reveal, 300);
    setTimeout(() => repair('start'), resumeAt > 60 ? 1200 : 2500);   // a fresh picture after the resume jump
    setTimeout(fill, 4000);                                            // sites sometimes re-layout once playing
    watchForSkips(sid);
    checkAfterJump();                                                 // once, after the start / resume
    if (onNoPicture) checkPicture(sid);
    progT = setInterval(readStatus, 10000);   // every 10 s: saves Continue Watching, and keeps the phone's Now Playing right
    readStatus();
  }

  function onEvent(m) {
    if (m.method === 'Target.targetCreated') {
      const t = m.params.targetInfo;
      if (t.type !== 'page') return;
      if (!mainTarget) { mainTarget = t.targetId; attachMain(t.targetId); return; }
      if (t.targetId !== mainTarget && block) send('Target.closeTarget', { targetId: t.targetId }); // a pop-up (backup)
      return;
    }
    if (m.method === 'Target.attachedToTarget' && !m.sessionId) { // browser level: a new window/tab
      const t = m.params.targetInfo;
      const sid = m.params.sessionId;
      if (t.type === 'page' && mainTarget && t.targetId !== mainTarget) {
        // A pop-up. Refuse everything it asks for, let it go (keeping it frozen would also freeze the
        // player that opened it), then close it — so the ad never loads or shows.
        stats.popups++; log(`blocked pop-up ${t.url || ''}`);
        popupSessions.add(sid);
        // Sent together, not one after another: the browser handles them in order anyway, and waiting for a
        // reply to the first could hold the pop-up — and the player that opened it — frozen for seconds.
        send('Fetch.enable', { patterns: [{ urlPattern: '*' }] }, sid);
        send('Runtime.runIfWaitingForDebugger', {}, sid);
        send('Target.closeTarget', { targetId: t.targetId });
      } else send('Runtime.runIfWaitingForDebugger', {}, sid);
      return;
    }
    if (m.method === 'Target.attachedToTarget' && m.sessionId) { // an embedded frame (e.g. the video player)
      const sid = m.params.sessionId;
      frames.set(sid, m.params.targetInfo.targetId);
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sid);
      send('Runtime.runIfWaitingForDebugger', {}, sid);
      return;
    }
    if (m.method === 'Target.detachedFromTarget') { frames.delete(m.params.sessionId); return; }
    if (m.method === 'Page.loadEventFired' && m.sessionId === mainSession && navigated) { onLoaded(); return; }
    if (m.method === 'Network.responseReceived' && m.sessionId === mainSession && m.params.type === 'Document' && m.params.frameId === mainTarget && !loaded && m.params.response.status >= 400) { notFound = true; return; }
    if (m.method === 'Runtime.bindingCalled' && m.params.name === 'lumenChoice') { onChoiceMade(m.params.payload); return; }
    if (m.method === 'Runtime.bindingCalled' && m.params.name === 'lumenSeek') { onSeek(); return; }
    if (m.method === 'Runtime.bindingCalled' && m.params.name === 'lumenSave' && m.sessionId === mainSession) { const u = String(m.params.payload || ''); if (/^https?:/.test(u)) onSaveLink?.(u); return; }
    if (m.method === 'Fetch.requestPaused' && popupSessions.has(m.sessionId)) { send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }, m.sessionId); return; }
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, frameId, request } = m.params;
      const s = site(request.url);
      const isMain = frameId === mainTarget;
      let ok = !isMain || !/^https?:/i.test(request.url) || allowed.has(s);
      if (!ok && Date.now() < graceUntil) { allowed.add(s); ok = true; }
      if (ok) send('Fetch.continueRequest', { requestId }, m.sessionId);
      else {
        stats.redirects++; log(`blocked redirect to ${request.url}`);
        // "Aborted" cancels the navigation without an error page, so the film page stays put
        send('Fetch.failRequest', { requestId, errorReason: 'Aborted' }, m.sessionId);
      }
    }
  }

  async function connect() {
    // the browser writes its control port to DevToolsActivePort once it's running
    let line = null;
    for (let i = 0; i < 150 && !stopped; i++) {
      try { const t = fs.readFileSync(portFile, 'utf8').split('\n'); if (t[0] && t[1]) { line = t; break; } } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!line || stopped) return;
    if (typeof WebSocket !== 'function') { log('the watch helper needs Node.js 22 or newer'); return; }
    ws = new WebSocket(`ws://127.0.0.1:${line[0].trim()}${line[1].trim()}`);
    ws.addEventListener('message', (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method) onEvent(m);
    });
    ws.addEventListener('close', () => { ws = null; clearInterval(progT); clearInterval(skipT); clearTimeout(checkT); clearTimeout(playT); });
    ws.addEventListener('error', () => {});
    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    await send('Target.setDiscoverTargets', { discover: true }); // existing pages arrive as targetCreated events
    // new windows are paused before they load anything, so a pop-up ad is closed before it can even start
    if (block) await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  }

  connect().catch((e) => log('helper: ' + e.message));
  // closes the browser the proper way, so it saves sign-ins/cookies to disk first (a forced close can lose them)
  async function closeBrowser() { if (!ws || ws.readyState !== 1) return false; await send('Browser.close'); return true; }
  return { saveCurrent, canSave: () => !!onSaveLink && (browsing || !!playSid), status: () => (last ? { ...last, t: last.paused ? last.t : last.t + (Date.now() - last.at) / 1000 } : null), control, playing: () => !!playSid, stop() { stopped = true; clearInterval(progT); clearInterval(skipT); clearTimeout(checkT); clearTimeout(playT); try { ws?.close(); } catch {} }, closeBrowser, setBrightness, stats, allowed };
}

// Call before launching the browser: a leftover port file from last time would point at a closed browser.
function prepareGuard(userDataDir) { try { fs.unlinkSync(path.join(userDataDir, 'DevToolsActivePort')); } catch {} }
// --remote-debugging-port=0 picks a free port that only this computer can reach.
const GUARD_ARGS = ['--remote-debugging-port=0'];

module.exports = { startGuard, prepareGuard, loadingPageUrl, site, GUARD_ARGS };
