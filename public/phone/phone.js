// Lumen on your phone — browse everything with touch, start films on the TV (and control them from here), or
// watch on the phone inside Lumen when the website allows it. Uses the same pairing as the Lumen Remote.
import { icon } from '/shared/icons.js';

const TOKEN_KEY = 'lumen.token';
// Lumen Web / Lumen Browser: the same app running on the phone by itself, with no laptop (see web/backend.js)
const WEB = window.LUMEN_WEB || null;
const NATIVE = window.LumenNative || null; // inside the Lumen Browser app for Android
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ANDROID = /Android/i.test(navigator.userAgent);
const token = WEB ? 'web' : localStorage.getItem(TOKEN_KEY);
if (!token) location.replace('/remote/?next=phone');

const app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
let cfg = { imageBase: 'https://image.tmdb.org/t/p', watchLinks: [] };
const img = (p, size = 'w342') => (p ? `${cfg.imageBase}/${size}${p}` : null);

async function api(path, opts = {}) {
  if (WEB) return WEB.api(path, opts);
  const headers = { 'x-lumen-token': token || '' };
  let body = opts.body;
  if (body) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
  const res = await fetch(path, { method: opts.method || 'GET', headers, body });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401) { localStorage.removeItem(TOKEN_KEY); location.replace('/remote/?next=phone'); throw new Error('Not paired'); }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}
const cache = new Map();
const cached = (k, fn, ms = 3 * 60e3) => { const c = cache.get(k); if (c && Date.now() - c.t < ms) return c.p; const p = fn(); cache.set(k, { t: Date.now(), p }); p.catch(() => cache.delete(k)); return p; };

function toast(msg, ic = 'check') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el(`<div class="toast">${icon(ic)}<span>${esc(msg)}</span></div>`);
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
// a light tap you can feel: Android vibrates; on iPhone (iOS 18+), toggling a hidden switch gives a haptic tick
let hapticLabel = null;
const haptic = () => {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticLabel) { hapticLabel = document.createElement('label'); hapticLabel.style.cssText = 'position:fixed;left:-99px;top:0;opacity:0;pointer-events:none'; hapticLabel.innerHTML = '<input type="checkbox" switch>'; document.body.appendChild(hapticLabel); }
    hapticLabel.click();
  } catch {}
};

// ---------------------------------------------------------------- pieces
const fmtTime = (s) => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const fmtLeft = (w) => { const m = Math.max(1, Math.round((w.d - w.t) / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`; };
const art = (src, title, cls = '') => (src
  ? `<img src="${esc(src)}" alt="" loading="lazy" class="${cls}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'fallback',textContent:${esc(JSON.stringify(title || ''))}}))">`
  : `<div class="fallback">${esc(title || '')}</div>`);
const metaBits = (d) => [d.type === 'tv' ? 'TV' : 'Film', d.year, d.runtime ? `${Math.floor(d.runtime / 60) ? Math.floor(d.runtime / 60) + ' h ' : ''}${d.runtime % 60} min` : null, d.vote_average ? `★ ${(+d.vote_average).toFixed(1)}` : null].filter(Boolean);

function posterCard(it) {
  const c = el(`<button class="poster"><div class="art">${art(img(it.poster_path), it.title)}</div><div class="cap">${esc(it.title)}</div></button>`);
  c.onclick = () => { haptic(); openDetail(it); };
  return c;
}
function wideCard(w) {
  const c = el(`<button class="wide"><div class="art">${art(img(w.backdrop_path, 'w780'), w.title)}<div class="bar2"><i style="width:${Math.round((w.d ? w.t / w.d : 0) * 100)}%"></i></div></div>
    <div class="cap">${esc(w.title)}<small>${esc(fmtLeft(w))}</small></div></button>`);
  c.onclick = () => { haptic(); openDetail(w); };
  return c;
}
function row(title, cards, sub = '') {
  const r = el(`<section class="row"><h3>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h3><div class="scroll"></div></section>`);
  r.querySelector('.scroll').append(...cards);
  return r;
}
function hero(items, eyebrow) {
  const h = el(`<section class="hero"><div class="track">${items.map((it) => `<div class="slide">${art(img(it.backdrop_path, 'w1280'), it.title)}
    <div class="copy"><div class="eyebrow">${esc(eyebrow)}</div><h2>${esc(it.title)}</h2><div class="meta">${esc(metaBits(it).join(' · '))}</div>
    <div class="btns"><button class="btn primary sm" data-open>${icon('info')}Details</button></div></div></div>`).join('')}</div>
    <div class="dots">${items.map(() => '<i></i>').join('')}</div></section>`);
  const track = h.querySelector('.track'), dots = [...h.querySelectorAll('.dots i')];
  h.querySelectorAll('[data-open]').forEach((b, i) => (b.onclick = () => openDetail(items[i])));
  h.querySelectorAll('.slide').forEach((s, i) => (s.onclick = (e) => { if (!e.target.closest('button')) openDetail(items[i]); }));
  const cur = () => Math.round(track.scrollLeft / track.clientWidth);
  const mark = () => dots.forEach((d, i) => d.classList.toggle('on', i === cur()));
  track.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true });
  mark();
  let touching = false;
  track.addEventListener('touchstart', () => (touching = true), { passive: true });
  track.addEventListener('touchend', () => setTimeout(() => (touching = false), 4000), { passive: true });
  const timer = setInterval(() => {
    if (!h.isConnected) return clearInterval(timer);
    if (touching || document.hidden || document.querySelector('.view.sub')) return;
    track.scrollTo({ left: ((cur() + 1) % items.length) * track.clientWidth, behavior: 'smooth' });
  }, 7000);
  return h;
}
const skeleton = () => el(`<div><div class="sk" style="margin:4px 0 0;border-radius:0;aspect-ratio:4/5;max-height:60vh"></div>${[0, 1].map(() => `<div style="margin:24px 20px 10px"><div class="sk" style="width:40%;height:18px"></div></div><div style="display:flex;gap:10px;padding:0 20px;overflow:hidden">${[0, 1, 2, 3].map(() => '<div class="sk" style="flex:0 0 31vw;aspect-ratio:2/3"></div>').join('')}</div>`).join('')}</div>`);
const errorBox = (e, retry) => { const b = el(`<div class="err">Couldn’t load this.<br><small>${esc(e.message)}</small><br><button class="btn sm">Try Again</button></div>`); b.querySelector('button').onclick = retry; return b; };

// ---------------------------------------------------------------- sheets
function sheet(html, setup) {
  const scrim = el('<div class="scrim"></div>'), s = el(`<div class="sheet"><div class="grab"></div>${html}</div>`);
  const close = () => { scrim.remove(); s.remove(); };
  scrim.onclick = close;
  document.body.append(scrim, s);
  setup?.(s, close);
  return close;
}
async function folderSheet(item) {
  const folders = await api('/api/folders').then((r) => r.folders).catch(() => []);
  sheet(`<h4>Add to Folder</h4><p>${esc(item.title)}</p>
    ${folders.map((f) => `<button class="opt" data-id="${esc(f.id)}">${icon('folder')}${esc(f.name)}<small>${f.items.some((x) => x.id === item.id && x.type === item.type) ? 'Added' : f.items.length}</small></button>`).join('')}
    <button class="opt" data-new>${icon('folderPlus')}New Folder…</button>`, (s, close) => {
    const it = { id: item.id, type: item.type, title: item.title, year: item.year || null, poster_path: item.poster_path || null, backdrop_path: item.backdrop_path || null };
    s.querySelectorAll('[data-id]').forEach((b) => (b.onclick = async () => {
      try { await api(`/api/folders/${b.dataset.id}/items`, { method: 'POST', body: { item: it } }); close(); toast(`Added to ${b.textContent.replace(/\d+$|Added$/, '').trim()}`); cache.delete('folders'); } catch (e) { toast(e.message, 'info'); }
    }));
    s.querySelector('[data-new]').onclick = () => { close(); newFolderSheet([it]); };
  });
}
function newFolderSheet(items = []) {
  sheet(`<h4>New Folder</h4><input class="field" id="fname" placeholder="Folder name" maxlength="40"><button class="btn primary" id="fmake" style="width:100%">Create</button>`, (s, close) => {
    const inp = s.querySelector('#fname'); setTimeout(() => inp.focus(), 100);
    s.querySelector('#fmake').onclick = async () => {
      if (!inp.value.trim()) return;
      try { await api('/api/folders', { method: 'POST', body: { name: inp.value.trim(), items } }); close(); toast(`Created ${inp.value.trim()}`); cache.delete('folders'); if (tab === 'library') showTab('library'); } catch (e) { toast(e.message, 'info'); }
    };
  });
}

// ---------------------------------------------------------------- sub views (film page, folder, viewer) with Back
const subs = [];
function pushSub(v) {
  document.body.appendChild(v); subs.push(v);
  history.pushState({ sub: subs.length }, '');
  document.body.style.overflow = 'hidden';
}
function popSub() {
  const v = subs.pop(); if (!v) return;
  v.classList.add('out'); setTimeout(() => v.remove(), 240);
  v.onclose?.();
  if (!subs.length) document.body.style.overflow = '';
}
// Back can jump several pages at once (closeSubs), so close every page above where history now is
addEventListener('popstate', (e) => { const keep = e.state?.sub || 0; do popSub(); while (subs.length > keep); });
// close every film page, folder and viewer: one history step back per page, done in one go
function closeSubs() { if (subs.length) history.go(-subs.length); }
const back = () => history.back();

// ---------------------------------------------------------------- film page
function openDetail(item) {
  if (!item || !['movie', 'tv'].includes(item.type)) return;
  const v = el(`<div class="view sub detail"><button class="back" aria-label="Back">${icon('back')}</button><div class="bd">${item.backdrop_path ? `<img src="${esc(img(item.backdrop_path, 'w1280'))}" alt="">` : ''}</div>
    <div class="body"><h1>${esc(item.title || '')}</h1><div class="sk" style="height:14px;width:60%;margin-top:10px"></div></div></div>`);
  v.querySelector('.back').onclick = back;
  pushSub(v);
  load();
  async function load() {
    let d, watching = [], saved = [];
    try {
      [d, watching] = await Promise.all([cached(`d:${item.type}:${item.id}`, () => api(`/api/details/${item.type}/${item.id}`), 30 * 60e3), api('/api/watching').then((r) => r.items).catch(() => [])]);
      saved = await api(`/api/watch-saved?type=${d.type}&id=${d.id}&title=${encodeURIComponent(d.title)}`).then((r) => r.saved).catch(() => []);
    } catch (e) { v.querySelector('.body').append(errorBox(e, () => { v.remove(); subs.pop(); openDetail(item); })); return; }
    if (!v.isConnected) return;
    if (d.backdrop_path && !item.backdrop_path) v.querySelector('.bd').innerHTML = `<img src="${esc(img(d.backdrop_path, 'w1280'))}" alt="">`;
    const resume = watching.find((w) => w.id === d.id && w.type === d.type);
    const links = (cfg.watchLinks || []).filter((w) => w.pattern);
    const name = (w) => w.name || w.pattern.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    const body = v.querySelector('.body');
    body.innerHTML = `${d.logo_path ? `<img class="logo" src="${esc(img(d.logo_path, 'w500'))}" alt="${esc(d.title)}">` : `<h1>${esc(d.title)}</h1>`}
      <div class="meta">${metaBits(d).map(esc).join('<span>·</span>')}${d.certification ? `<span class="cert">${esc(d.certification)}</span>` : ''}</div>
      ${d.genres?.length ? `<div class="meta" style="margin-top:6px">${esc(d.genres.slice(0, 3).join(' · '))}</div>` : ''}
      ${d.tagline ? `<p class="tagline">${esc(d.tagline)}</p>` : ''}
      <p class="overview clamp">${esc(d.overview || 'No description available.')}</p>
      <div class="watchlist"></div>
      <div class="btns extras"></div>
      <div class="more-rows"></div>
      <p class="note">${WEB ? esc(watchNote()) : `“On TV” starts it on ${esc(cfg.deviceName || 'the TV')} and turns this phone into its controls. “Here” plays it on this phone inside Lumen when the website allows it — otherwise it opens in your browser.`}</p>`;
    const ov = body.querySelector('.overview');
    if (ov.scrollHeight > ov.clientHeight + 4) { const m = el('<button class="more">More</button>'); m.onclick = () => { ov.classList.remove('clamp'); m.remove(); }; ov.after(m); }
    const wl = body.querySelector('.watchlist');
    const it = { id: d.id, type: d.type, poster_path: d.poster_path || null, backdrop_path: d.backdrop_path || null };
    const main = (resume && links.find((w) => w.id === resume.linkId)) || links[0];
    if (WEB) {
      const lastSite = await api(`/api/film-site?type=${d.type}&id=${d.id}`).then((r) => links.find((w) => w.id === r.linkId)).catch(() => null);
      const first = (resume && links.find((w) => w.id === resume.linkId)) || lastSite || links[0];
      for (const w of [first, ...links.filter((x) => x !== first)].filter(Boolean)) {
        const res = resume && resume.linkId === w.id;
        const r = el(`<div class="wl ${w === first ? 'main' : ''}"><div class="lbl"><b>${res ? `Resume on ${esc(name(w))}` : `Watch on ${esc(name(w))}`}</b><small>${res ? esc(fmtLeft(resume)) : esc(watchHint())}</small></div>
          <button class="btn ${w === first ? 'primary' : ''} sm" data-w>${icon('play')}Watch</button></div>`);
        r.querySelector('[data-w]').onclick = async () => {
          try { const q = new URLSearchParams({ link: w.id, title: d.title, year: d.year || '', type: d.type, id: d.id }); const u = await api(`/api/watch-url?${q}`); watchOut(u.url, d, name(w), w.id, res ? resume.t : 0); }
          catch (e) { toast(e.message, 'info'); }
        };
        wl.appendChild(r);
      }
      for (const p of d.providers?.free || []) {
        const r = el(`<div class="wl">${p.logo_path ? `<img class="plogo" src="${esc(img(p.logo_path, 'w92'))}" alt="">` : ''}<div class="lbl"><b>Free on ${esc(p.name)}</b><small>Opens ${esc(p.name)}</small></div><button class="btn sm" data-w>${icon('play')}Open</button></div>`);
        r.querySelector('[data-w]').onclick = () => watchOut(p.url, d, p.name, null, 0);
        wl.appendChild(r);
      }
      if (!links.length && !d.providers?.free?.length) { const r = el(`<div class="wl"><div class="lbl"><b>No Watch website yet</b><small>Add one in Settings and every film gets a Watch button</small></div><button class="btn sm">${icon('settings')}Settings</button></div>`); r.querySelector('button').onclick = () => { closeSubs(); showTab('settings'); }; wl.appendChild(r); }
    }
    for (const w of WEB ? [] : links) {
      const isMain = w === main, res = isMain && resume;
      const r = el(`<div class="wl ${isMain ? 'main' : ''}"><div class="lbl"><b>${res ? `Resume on ${esc(name(w))}` : `Watch on ${esc(name(w))}`}</b><small>${res ? esc(fmtLeft(resume)) : saved.includes(w.id) ? 'Uses the page you saved' : esc(name(w))}</small></div>
        <button class="btn ${isMain ? 'primary' : ''} sm" data-tv>${icon('tv')}On TV</button><button class="btn sm" data-here>${icon('play')}Here</button></div>`);
      r.querySelector('[data-tv]').onclick = () => playOnTv({ watchLink: true, linkId: w.id, title: d.title, year: d.year || null, item: it }, d.title);
      r.querySelector('[data-here]').onclick = async () => {
        try { const q = new URLSearchParams({ link: w.id, title: d.title, year: d.year || '', type: d.type, id: d.id }); const u = await api(`/api/watch-url?${q}`); openViewer(u.url, `${d.title}`, name(w)); }
        catch (e) { toast(e.message, 'info'); }
      };
      wl.appendChild(r);
    }
    for (const p of WEB ? [] : d.providers?.free || []) {
      const r = el(`<div class="wl">${p.logo_path ? `<img class="plogo" src="${esc(img(p.logo_path, 'w92'))}" alt="">` : ''}<div class="lbl"><b>Free on ${esc(p.name)}</b><small>Opens ${esc(p.name)}</small></div>
        <button class="btn sm" data-tv>${icon('tv')}On TV</button><button class="btn sm" data-here>${icon('play')}Here</button></div>`);
      r.querySelector('[data-tv]').onclick = () => playOnTv({ service: p.service, query: d.title }, p.name);
      r.querySelector('[data-here]').onclick = () => openViewer(p.url, d.title, p.name);
      wl.appendChild(r);
    }
    if (!WEB && !links.length && !d.providers?.free?.length) wl.appendChild(el(`<div class="wl"><div class="lbl"><b>No Watch website set</b><small>Add one on the TV: Settings › Watch Buttons</small></div></div>`));
    const ex = body.querySelector('.extras');
    if (d.trailer) {
      const t = el(`<button class="btn sm">${icon('play')}Trailer</button>`);
      t.onclick = () => WEB ? openViewer(`https://www.youtube-nocookie.com/embed/${d.trailer.key}?autoplay=1&playsinline=1&rel=0`, `${d.title} — Trailer`, 'YouTube', true) : sheet(`<h4>Trailer</h4><p>${esc(d.title)}</p><button class="opt" data-here>${icon('play')}Play here</button><button class="opt" data-tv>${icon('tv')}Play on the TV</button>`, (s, close) => {
        s.querySelector('[data-here]').onclick = () => { close(); openViewer(`https://www.youtube-nocookie.com/embed/${d.trailer.key}?autoplay=1&playsinline=1&rel=0`, `${d.title} — Trailer`, 'YouTube', true); };
        s.querySelector('[data-tv]').onclick = () => { close(); playOnTv({ youtubeVideo: d.trailer.key }, 'the trailer'); };
      });
      ex.appendChild(t);
    }
    const f = el(`<button class="btn sm">${icon('folderPlus')}Add to Folder</button>`); f.onclick = () => folderSheet(d); ex.appendChild(f);
    if (saved.length) {
      const fs = el(`<button class="btn sm">${icon('link')}Forget Saved Page</button>`);
      fs.onclick = async () => { for (const id of saved) await api('/api/watch-saved', { method: 'POST', body: { linkId: id, item: { type: d.type, id: d.id }, title: d.title, url: null } }).catch(() => {}); fs.remove(); toast('Saved page forgotten'); cache.clear(); };
      ex.appendChild(fs);
    }
    const more = body.querySelector('.more-rows');
    if (d.type === 'tv' && d.seasons?.length) more.appendChild(el(`<div><div class="section-h">${d.number_of_seasons || d.seasons.length} Season${(d.number_of_seasons || d.seasons.length) > 1 ? 's' : ''}</div>
      <div class="meta">${d.seasons.map((s) => esc(s.name || `Season ${s.season_number}`)).join(' · ')}</div></div>`));
    if (d.cast?.length) more.appendChild(el(`<div><div class="section-h">Cast</div><div class="cast">${d.cast.slice(0, 16).map((c) => `<div class="p"><div class="face">${c.profile_path ? `<img src="${esc(img(c.profile_path, 'w185'))}" alt="" loading="lazy">` : esc((c.name || '?')[0])}</div><b>${esc(c.name)}</b>${esc(c.character || '')}</div>`).join('')}</div></div>`));
    if (d.collection?.parts?.length > 1) { const r = row(d.collection.name || 'Collection', d.collection.parts.map(posterCard)); r.style.margin = '22px -20px 0'; more.appendChild(r); }
    if (d.recommendations?.length) { const r = row('More Like This', d.recommendations.map(posterCard)); r.style.margin = '22px -20px 0'; more.appendChild(r); }
  }
}

// ---------------------------------------------------------------- Lumen Web: where Watch goes
// Inside Lumen Browser (Android): its own browser blocks ads and pop-ups, presses play and fills the screen.
// On an iPhone: the Brave app (its Shields block ads). Anywhere else: a new tab.
const watchHint = () => (NATIVE ? 'Ad-free, full screen' : IOS ? 'Opens in Brave, which blocks ads' : ANDROID ? 'Opens in Lumen Browser' : 'Opens in a new tab');
const watchNote = () => (NATIVE ? 'Lumen Browser blocks ads and pop-ups, starts the film and fills the screen. ' + (IOS ? 'Tap the screen and press ✕ to come back to Lumen.' : 'Press Back to come back to Lumen.')
  : IOS ? 'Watch opens the film in Brave, a free browser whose Shields block ads and pop-ups. Tap the video’s full-screen button there.'
  : ANDROID ? 'Watch opens the film in Lumen Browser, which blocks ads and pop-ups and goes full screen by itself. It’s free: Settings › Get Lumen Browser.'
  : 'Watch opens the film in a new tab.');
const APK_URL = 'https://github.com/da1essi08sol-dot/lumen/releases/tag/android-latest';
function watchOut(url, d, site, linkId, resumeAt) {
  haptic();
  const item = { id: d.id, type: d.type, title: d.title, year: d.year || null, poster_path: d.poster_path || null, backdrop_path: d.backdrop_path || null, linkId, resumeAt: resumeAt || 0 };
  if (NATIVE) { NATIVE.watch(url, JSON.stringify(item)); return; }
  if (IOS) { openInBrave(url, site); return; }
  if (ANDROID) { location.href = `intent://watch?url=${encodeURIComponent(url)}#Intent;scheme=lumenbrowser;package=tv.lumen.browser;S.browser_fallback_url=${encodeURIComponent(url)};end`; return; }
  window.open(url, '_blank', 'noopener');
}

// ---------------------------------------------------------------- watching on the phone, inside Lumen
// Hands a website to the Brave app on the iPhone (its Shields block ads, trackers and pop-ups).
// If Brave isn't installed, iOS stays on Lumen, so after a moment Lumen offers the App Store or Safari.
function openInBrave(url, site = 'the website') {
  haptic();
  let left = false;
  const gone = () => { if (document.hidden) left = true; };
  document.addEventListener('visibilitychange', gone);
  location.href = `brave://open-url?url=${encodeURIComponent(url)}`;
  setTimeout(() => {
    document.removeEventListener('visibilitychange', gone);
    if (left || document.hidden) return;
    const v = el(`<div class="view sub" style="display:flex;flex-direction:column;justify-content:center;padding:calc(var(--top) + 20px) 24px calc(28px + var(--bot))">
      <div class="empty"><b>Brave didn’t open</b>It may not be installed on this iPhone. It’s free, and its Shields block ads and pop-ups on ${esc(site)}.<br><br>
      <a class="btn primary" style="text-decoration:none" href="https://apps.apple.com/app/brave-private-web-browser/id1052879175" target="_blank" rel="noopener">${icon('globe')}Get Brave from the App Store</a><br><br>
      <button class="btn sm" data-s>Open in Safari instead</button><br><br><button class="btn sm back">Back to Lumen</button></div></div>`);
    v.querySelector('.back').onclick = back;
    v.querySelector('[data-s]').onclick = () => { back(); window.open(url, '_blank', 'noopener'); };
    pushSub(v);
  }, 1600);
}
async function openViewer(url, title, site, trusted = false) {
  const v = el(`<div class="view sub" style="display:flex;flex-direction:column;padding-bottom:0">
    <div class="bar" style="position:relative"><button class="back" aria-label="Close" style="position:static;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.12)">${icon('close')}</button>
      <div style="flex:1;min-width:0"><div style="font-weight:750;font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div><div style="font-size:12px;color:var(--ink-3)">${esc(site)}</div></div>
      <button class="btn sm" data-brave>${icon('globe')}Brave</button></div>
    <div class="frame" style="flex:1;position:relative;background:#000"><div class="empty"><b>Opening ${esc(site)}…</b></div></div></div>`);
  v.querySelector('.back').onclick = back;
  v.querySelector('[data-brave]').onclick = () => openInBrave(url, site);
  pushSub(v);
  const box = v.querySelector('.frame');
  let ok = trusted;
  if (!ok) { try { ok = (await api(`/api/embeddable?url=${encodeURIComponent(url)}`)).ok; } catch { ok = false; } }
  if (!v.isConnected) return;
  if (!ok) {
    box.innerHTML = `<div class="empty"><b>${esc(site)} doesn’t allow being shown inside other apps</b>Open it in Brave, which blocks the ads and pop-ups. Come back to Lumen when you’re done.<br><br><button class="btn primary" data-b>${icon('globe')}Open in Brave</button><br><br><button class="btn sm" data-s>Open in Safari instead</button></div>`;
    box.querySelector('[data-b]').onclick = () => openInBrave(url, site);
    box.querySelector('[data-s]').onclick = () => window.open(url, '_blank', 'noopener');
    return;
  }
  // shown inside Lumen; the website can't open pop-ups or take over the screen from in here
  box.innerHTML = '';
  const f = el('<iframe style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="origin"></iframe>');
  if (!trusted) f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-presentation');
  f.src = url;
  box.appendChild(f);
}

// ---------------------------------------------------------------- playing on the TV, controlled from here
async function playOnTv(body, what) {
  haptic();
  try { await api('/api/open', { method: 'POST', body }); toast(`Starting ${what} on ${cfg.deviceName || 'the TV'}`, 'tv'); setTimeout(() => openNowPlaying(), 600); }
  catch (e) { toast(e.message, 'info'); }
}
let pb = { open: false }, pbAt = 0, pbTimer = null;
async function pollPlayback() {
  try { pb = await api('/api/playback'); pbAt = Date.now(); } catch { pb = { open: false }; }
  drawMini(); drawNowPlaying();
}
function startPolling() { clearInterval(pbTimer); pollPlayback(); pbTimer = setInterval(() => { if (!document.hidden) pollPlayback(); }, 2500); }
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollPlayback(); });
const nowT = () => { const s = pb.status; if (!s) return 0; return s.paused ? s.t : s.t + (Date.now() - pbAt) / 1000; };
async function control(cmd, arg) {
  haptic();
  try { const r = await api('/api/playback', { method: 'POST', body: { cmd, arg } }); if (r.status) { pb.status = r.status; pbAt = Date.now(); } drawMini(); drawNowPlaying(); }
  catch (e) { toast(e.message, 'info'); }
}
function drawMini() {
  let m = document.querySelector('.mini');
  if (!pb.open) { m?.remove(); return; }
  if (!m) {
    m = el(`<button class="mini" style="position:fixed;left:10px;right:10px;bottom:calc(70px + var(--bot));z-index:19;display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:16px;background:rgba(40,40,44,.92);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);box-shadow:0 10px 30px rgba(0,0,0,.5);text-align:left">
      <span style="width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:rgba(var(--acc),.25);color:rgb(var(--acc))">${icon('tv')}</span>
      <span style="flex:1;min-width:0"><b style="display:block;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" class="mt"></b><small style="color:var(--ink-3);font-size:12px" class="ms"></small></span>
      <span class="mp" style="width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.12)"></span></button>`);
    m.onclick = (e) => { if (e.target.closest('.mp')) { if (pb.controllable) control('toggle'); return; } openNowPlaying(); };
    document.body.appendChild(m);
  }
  m.querySelector('.mt').textContent = pb.label || 'On the TV';
  m.querySelector('.ms').textContent = pb.controllable && pb.status ? `${fmtTime(nowT())} / ${fmtTime(pb.status.d)}` : 'On the TV';
  m.querySelector('.mp').innerHTML = pb.controllable ? icon(pb.status?.paused ? 'play' : 'pause') : icon('chevron');
}
let npView = null;
function openNowPlaying() {
  if (npView?.isConnected) return;
  const v = el(`<div class="view sub" style="display:flex;flex-direction:column;padding:calc(var(--top) + 14px) 22px calc(28px + var(--bot))">
    <button class="back" aria-label="Close Now Playing" style="align-self:flex-start;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.1);transform:rotate(-90deg)">${icon('back')}</button>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:22px">
      <div style="text-align:center"><div style="font-size:12px;font-weight:750;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)">Now Playing on ${esc(cfg.deviceName || 'the TV')}</div>
        <div class="np-title" style="font-size:28px;font-weight:850;letter-spacing:-.025em;margin-top:8px;text-wrap:balance"></div><div class="np-sub" style="color:var(--ink-3);margin-top:6px;font-size:14px"></div></div>
      <div class="np-ctrl">
        <div class="np-scrub" style="position:relative;height:30px;touch-action:none"><div style="position:absolute;left:0;right:0;top:13px;height:5px;border-radius:5px;background:rgba(255,255,255,.18)"><i class="np-fill" style="display:block;height:100%;border-radius:5px;background:rgb(var(--acc));width:0"></i></div></div>
        <div style="display:flex;justify-content:space-between;font-size:12.5px;color:var(--ink-3);font-variant-numeric:tabular-nums"><span class="np-t">0:00</span><span class="np-d">0:00</span></div>
        <div style="display:flex;justify-content:center;align-items:center;gap:26px;margin-top:18px">
          <button data-c="-30" aria-label="Back 30 seconds" style="font-size:12px;font-weight:700;color:var(--ink-2);display:grid;place-items:center;gap:2px">${icon('rewind')}30</button>
          <button data-c="-10" aria-label="Back 10 seconds" style="width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.1);display:grid;place-items:center;font-size:11px;font-weight:700">${icon('rewind')}</button>
          <button data-c="toggle" class="np-pp" aria-label="Play or pause" style="width:78px;height:78px;border-radius:50%;background:rgb(var(--acc));color:var(--acc-ink);display:grid;place-items:center"></button>
          <button data-c="10" aria-label="Forward 10 seconds" style="width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.1);display:grid;place-items:center;font-size:11px;font-weight:700">${icon('forward')}</button>
          <button data-c="30" aria-label="Forward 30 seconds" style="font-size:12px;font-weight:700;color:var(--ink-2);display:grid;place-items:center;gap:2px">${icon('forward')}30</button>
        </div>
      </div>
      <div class="np-wait empty" style="display:none;padding:10px"></div>
      <div style="display:flex;justify-content:center;gap:12px;margin-top:6px">
        <button class="btn sm" data-v="down" aria-label="Volume down">${icon('volDown')}</button><button class="btn sm" data-v="mute" aria-label="Mute">${icon('mute')}</button><button class="btn sm" data-v="up" aria-label="Volume up">${icon('volUp')}</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
        <button class="btn np-save" style="display:none">${icon('link')}Use this page for the film</button>
        <button class="btn" data-sleep>${icon('sunLow')}<span>Sleep timer: Off</span></button>
        <button class="btn" data-stop>${icon('close')}Stop &amp; Back to Lumen</button>
        <a class="btn" href="/remote/" style="text-decoration:none;color:inherit">${icon('remote')}Open the Remote</a>
      </div>
    </div></div>`);
  npView = v;
  v.querySelector('.back').onclick = back;
  v.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => (b.dataset.c === 'toggle' ? control('toggle') : control('seek', +b.dataset.c))));
  v.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { haptic(); api('/api/volume', { method: 'POST', body: { a: b.dataset.v } }).catch((e) => toast(e.message, 'info')); }));
  v.querySelector('[data-stop]').onclick = async () => { haptic(); await api('/api/close-external', { method: 'POST' }).catch(() => {}); pb = { open: false }; drawMini(); back(); toast('Stopped'); };
  // sleep timer: each tap moves to the next time (Off, 15, 30, 45, 60, 90, 120 minutes)
  const sleepBtn = v.querySelector('[data-sleep]');
  const STEPS = [0, 15, 30, 45, 60, 90, 120];
  let sleepAt = null;
  const drawSleep = () => { const m = sleepAt ? Math.max(1, Math.ceil((sleepAt - Date.now()) / 60000)) : 0; sleepBtn.querySelector('span').textContent = m ? `Sleep timer: ${m} min left` : 'Sleep timer: Off'; };
  api('/api/sleep').then((r) => { sleepAt = r.sleep ? Date.now() + r.sleep.left * 1000 : null; drawSleep(); }).catch(() => {});
  sleepBtn.onclick = async () => {
    haptic();
    const cur = sleepAt ? Math.ceil((sleepAt - Date.now()) / 60000) : 0;
    const next = STEPS.find((x) => x > cur + 1) ?? 0;
    try { const r = await api('/api/sleep', { method: 'POST', body: { minutes: next } }); sleepAt = r.sleep ? Date.now() + r.sleep.left * 1000 : null; drawSleep(); toast(next ? `The TV will sleep in ${next} minutes` : 'Sleep timer off', 'check'); }
    catch (e) { toast(e.message, 'info'); }
  };
  v.querySelector('.np-save').onclick = async () => { try { await api('/api/playback/save-link', { method: 'POST' }); toast('Saved — this film now opens on that page'); cache.clear(); } catch (e) { toast(e.message, 'info'); } };
  // drag the bar to jump
  const scrub = v.querySelector('.np-scrub');
  let drag = null;
  const frac = (e) => { const r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, ((e.touches?.[0] || e).clientX - r.left) / r.width)); };
  const move = (e) => { if (drag === null || !pb.status) return; drag = frac(e); v.querySelector('.np-fill').style.width = `${drag * 100}%`; v.querySelector('.np-t').textContent = fmtTime(drag * pb.status.d); };
  scrub.addEventListener('pointerdown', (e) => { if (!pb.controllable) return; drag = frac(e); scrub.setPointerCapture(e.pointerId); move(e); });
  scrub.addEventListener('pointermove', move);
  scrub.addEventListener('pointerup', () => { if (drag !== null && pb.status) control('seekTo', drag * pb.status.d); drag = null; });
  pushSub(v);
  v.onclose = () => { npView = null; };
  const tick = setInterval(() => { if (!v.isConnected) return clearInterval(tick); if (drag === null) drawNowPlaying(); }, 500);
  pollPlayback();
}
function drawNowPlaying() {
  const v = npView; if (!v?.isConnected) return;
  v.querySelector('.np-title').textContent = pb.open ? (pb.label || 'On the TV') : 'Nothing playing';
  v.querySelector('.np-sub').textContent = pb.open ? (pb.controllable ? (pb.status?.paused ? 'Paused' : 'Playing') : 'Getting it ready on the TV…') : 'Pick something to watch and choose “On TV”.';
  const c = pb.open && pb.controllable && pb.status;
  v.querySelector('.np-ctrl').style.opacity = c ? 1 : 0.35;
  v.querySelector('.np-ctrl').style.pointerEvents = c ? '' : 'none';
  v.querySelector('.np-save').style.display = pb.canSave ? '' : 'none';
  v.querySelector('[data-stop]').style.display = pb.open ? '' : 'none';
  if (c) {
    const t = nowT(), d = pb.status.d || 1;
    v.querySelector('.np-fill').style.width = `${Math.min(100, (t / d) * 100)}%`;
    v.querySelector('.np-t').textContent = fmtTime(t); v.querySelector('.np-d').textContent = `-${fmtTime(d - t)}`;
  }
  v.querySelector('.np-pp').innerHTML = icon(c && !pb.status.paused ? 'pause' : 'play');
}

// ---------------------------------------------------------------- tabs
let tab = 'home';
const TABS = [['home', 'Home', 'home'], ['movies', 'Films', 'film'], ['tv', 'TV Shows', 'tv'], ['search', 'Search', 'search'], ['library', 'Library', 'folder'], WEB ? ['settings', 'Settings', 'settings'] : ['remote', 'Remote', 'remote']];
function shell() {
  app.innerHTML = `<main id="main"></main><nav class="tabbar">${TABS.map(([k, l, ic]) => `<button data-t="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>`;
  app.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => { haptic(); if (b.dataset.t === 'remote') { location.href = '/remote/'; return; } closeSubs(); showTab(b.dataset.t, b.dataset.t === tab); }));
}
function showTab(t, again = false) {
  tab = t;
  app.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  if (again) { scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const main = document.getElementById('main');
  main.innerHTML = '';
  const v = el('<div class="view"></div>');
  main.appendChild(v);
  scrollTo(0, 0);
  ({ home: () => sectionView(v, 'home', cfg.userName ? `${greeting()}, ${cfg.userName}` : greeting()), movies: () => sectionView(v, 'movies', 'Films'), tv: () => sectionView(v, 'tv', 'TV Shows'), search: () => searchView(v), library: () => libraryView(v), settings: () => settingsView(v) })[t]();
}
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
const topBar = (title, right = '') => el(`<div class="bar">${title === 'brand' ? '<div class="brand"><b>Lumen</b><span>TV</span></div>' : `<h1>${esc(title)}</h1>`}${right}</div>`);

async function sectionView(v, name, title) {
  v.appendChild(topBar(name === 'home' ? 'brand' : title, name === 'home' && !WEB ? `<div class="pill"><span class="dot ${pb.open ? 'on' : ''}"></span>${esc(cfg.deviceName || 'TV')}</div>` : ''));
  const sk = skeleton(); v.appendChild(sk);
  try {
    const [data, watching] = await Promise.all([cached('section:' + name, () => api(`/api/section/${name}`)), name === 'home' ? api('/api/watching').then((r) => r.items).catch(() => []) : []]);
    sk.remove();
    if (name === 'home') v.appendChild(el(`<div style="padding:0 20px 6px;font-size:15px;color:var(--ink-2);font-weight:600">${esc(title)}</div>`));
    if (data.hero?.length) v.appendChild(hero(data.hero, data.heroEyebrow || (name === 'home' ? 'Recommended for You' : title)));
    if (watching.length) v.appendChild(row('Continue Watching', watching.map(wideCard)));
    for (const r of data.rows || []) if (r.items?.length) v.appendChild(row(r.title, r.items.map(posterCard)));
  } catch (e) { sk.remove(); v.appendChild(errorBox(e, () => showTab(name))); }
}

function searchView(v) {
  v.appendChild(topBar('Search'));
  const box = el(`<label class="searchbox">${icon('search')}<input type="search" placeholder="Films, shows, people…" enterkeyhint="search" autocomplete="off"></label>`);
  const out = el('<div></div>');
  v.append(box, out);
  const inp = box.querySelector('input');
  out.innerHTML = '<div class="empty"><b>Find anything</b>Search films and TV shows, then watch on the TV or right here.</div>';
  let t = null, n = 0;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const q = inp.value.trim();
    if (!q) { out.innerHTML = '<div class="empty"><b>Find anything</b>Search films and TV shows, then watch on the TV or right here.</div>'; return; }
    t = setTimeout(async () => {
      const my = ++n;
      try {
        const r = await api(`/api/search?q=${encodeURIComponent(q)}`);
        if (my !== n) return;
        const items = (r.results || []).filter((x) => ['movie', 'tv'].includes(x.type));
        out.innerHTML = items.length ? '' : `<div class="empty"><b>No results</b>Nothing found for “${esc(q)}”.</div>`;
        if (items.length) { const g = el('<div class="grid"></div>'); g.append(...items.map(posterCard)); out.appendChild(g); }
      } catch (e) { out.innerHTML = ''; out.appendChild(errorBox(e, () => inp.dispatchEvent(new Event('input')))); }
    }, 320);
  });
  setTimeout(() => inp.focus(), 150);
}

async function libraryView(v) {
  v.appendChild(topBar('Library'));
  try {
    const [watching, folders] = await Promise.all([api('/api/watching').then((r) => r.items).catch(() => []), api('/api/folders').then((r) => r.folders)]);
    if (watching.length) v.appendChild(row('Continue Watching', watching.map(wideCard)));
    v.appendChild(el('<div class="section-h" style="margin:22px 20px 10px">Folders</div>'));
    const tiles = el('<div class="tiles"></div>');
    for (const f of folders) {
      const pics = f.items.map((i) => i.poster_path || i.backdrop_path).filter(Boolean).slice(0, 4);
      const t = el(`<button class="tile"><div class="mosaic ${pics.length < 4 ? 'one' : ''}">${pics.length >= 4 ? pics.map((p) => `<img src="${esc(img(p, 'w185'))}" alt="" loading="lazy">`).join('') : pics[0] ? `<img src="${esc(img(pics[0], 'w342'))}" alt="" style="object-fit:cover">` : `<div class="fallback">${esc(f.name)}</div>`}</div>
        <div class="t">${esc(f.name)}<small>${f.items.length} title${f.items.length === 1 ? '' : 's'}</small></div></button>`);
      t.onclick = () => openFolder(f);
      tiles.appendChild(t);
    }
    const add = el(`<button class="tile add">${icon('folderPlus')}New Folder</button>`); add.onclick = () => newFolderSheet();
    tiles.appendChild(add);
    v.appendChild(tiles);
    if (!WEB) v.appendChild(transferCard());
  } catch (e) { v.appendChild(errorBox(e, () => showTab('library'))); }
}
// ---------------------------------------------------------------- moving to Lumen Web (no laptop)
const WEB_URL = 'https://da1essi08sol-dot.github.io/lumen/';
const b64u = (str) => btoa(String.fromCharCode(...new TextEncoder().encode(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (str) => new TextDecoder().decode(Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
function transferCard() {
  const c = el(`<section class="ws-card" style="margin:26px 20px 30px"><h3>Use Lumen without the laptop</h3>
    <p>Lumen also runs on this phone by itself. This copies your TMDB key, Watch websites, folders and Continue Watching across.</p>
    <button class="btn primary" id="tr" style="width:100%">Copy My Lumen</button><p class="small" id="trm"></p></section>`);
  c.querySelector('#tr').onclick = async () => {
    try {
      const link = WEB_URL + '#import=' + b64u(JSON.stringify(await api('/api/transfer')));
      // the laptop's page isn't https, where phones often have no clipboard API: fall back to a hidden text box
      let copied = false; try { await navigator.clipboard.writeText(link); copied = true; } catch {}
      if (!copied) { const ta = el('<textarea readonly style="position:fixed;opacity:0;top:0"></textarea>'); ta.value = link; document.body.appendChild(ta); ta.focus(); ta.setSelectionRange(0, link.length); try { copied = document.execCommand('copy'); } catch {} ta.remove(); }
      if (!copied) throw new Error('Couldn’t copy. Try again.');
      c.querySelector('#trm').innerHTML = `Copied. Open <b>Lumen</b> from your home screen (or <a href="${esc(link)}" target="_blank" rel="noopener">open it here</a>), go to <b>Settings › Bring from your laptop</b> and tap <b>Paste and Bring Across</b>.`;
      toast('Copied');
    } catch (e) { toast(e.message || 'Couldn’t copy. Update Lumen on the laptop first.'); }
  };
  return c;
}
async function importTransfer(text) {
  const m = String(text || '').trim().match(/(?:#import=)?([A-Za-z0-9_-]{20,})\s*$/);
  if (!m) throw new Error('Copy it again from Lumen on your laptop (Library › Use Lumen without the laptop).');
  let data; try { data = JSON.parse(unb64u(m[1])); } catch { throw new Error('That code looks cut short. Copy it again from your laptop.'); }
  const r = await api('/api/import', { method: 'POST', body: data });
  cfg = { ...cfg, ...(await api('/api/config')) }; applyLook(); cache.clear();
  toast(`Brought across: ${r.websites} Watch website${r.websites === 1 ? '' : 's'}, ${r.folders} folder${r.folders === 1 ? '' : 's'}`);
}
function openFolder(f) {
  const v = el(`<div class="view sub"><div class="bar"><button class="back" aria-label="Back" style="width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.12)">${icon('back')}</button><h1 style="font-size:24px">${esc(f.name)}</h1></div><div class="grid"></div></div>`);
  v.querySelector('.back').onclick = back;
  const g = v.querySelector('.grid');
  if (!f.items.length) g.replaceWith(el('<div class="empty"><b>Nothing here yet</b>Open a film and press “Add to Folder”.</div>'));
  else g.append(...[...f.items].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).map(posterCard));
  pushSub(v);
}

// ---------------------------------------------------------------- Lumen Web settings (no laptop)
const ACCENT_SWATCHES = [['white', '#f2f2f2'], ['amber', '#ffc970'], ['rose', '#ffa0b6'], ['mint', '#80e8ba'], ['sky', '#82c6ff'], ['lilac', '#c4acff'], ['red', '#ff453a'], ['crimson', '#dc143c'], ['coral', '#ff7262']];
const FONT_CHOICES = [['classic', 'Classic'], ['cinema', 'Cinema'], ['bold', 'Bold'], ['signage', 'Signage'], ['serif', 'Serif']];
const REGIONS = [['GB', 'United Kingdom'], ['IE', 'Ireland'], ['US', 'United States'], ['CA', 'Canada'], ['AU', 'Australia'], ['NZ', 'New Zealand']];
function applyLook() {
  document.documentElement.dataset.font = cfg.font || 'classic';
  if (cfg.accentRgb) {
    const [r, g, b] = cfg.accentRgb.split(',').map(Number);
    document.documentElement.style.setProperty('--acc', `${r},${g},${b}`);
    document.documentElement.style.setProperty('--acc-ink', (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#000' : '#fff');
  }
}
async function saveSettings(body, msg) {
  try { await api('/api/settings', { method: 'POST', body }); cfg = { ...cfg, ...(await api('/api/config')) }; applyLook(); cache.clear(); if (msg) toast(msg); return true; }
  catch (e) { toast(e.message, 'info'); return false; }
}
function settingsView(v) {
  v.appendChild(topBar(cfg.hasKey ? 'Settings' : 'Welcome'));
  const box = el('<div class="ws"></div>'); v.appendChild(box);
  const key = el(`<section class="ws-card">
    ${cfg.hasKey ? '<h3>TMDB key</h3><p>Lumen gets posters and film details from The Movie Database.</p>' : `<h3>Welcome to Lumen</h3>
      <p>Lumen needs a free key from The Movie Database (TMDB) for posters and film details. It takes about five minutes:</p>
      <ol><li>Make a free account at <a href="https://www.themoviedb.org/signup" target="_blank" rel="noopener">themoviedb.org/signup</a> and confirm your email.</li>
      <li>Open <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noopener">Settings › API</a>, choose <b>Create › Developer</b>, and describe it as a personal TV app.</li>
      <li>Copy the <b>API Read Access Token</b> (or the API Key) and paste it here.</li></ol>`}
    <input class="field" id="tk" placeholder="${cfg.hasKey ? esc(cfg.keyHint) + ' (saved)' : 'Paste your TMDB key'}" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button class="btn primary" id="tks" style="width:100%">${cfg.hasKey ? 'Change Key' : 'Start Lumen'}</button>
    <p class="small">Your key stays on this phone.</p></section>`);
  key.querySelector('#tks').onclick = async () => {
    const val = key.querySelector('#tk').value.trim(); if (!val) return;
    const b = key.querySelector('#tks'); b.disabled = true; b.textContent = 'Checking…';
    const ok = await saveSettings({ tmdbKey: val }, 'Key saved');
    b.disabled = false; b.textContent = cfg.hasKey ? 'Change Key' : 'Start Lumen';
    if (ok) showTab('home');
  };
  box.appendChild(key);
  if (!cfg.hasKey) return;
  // Watch websites
  const links = [...(cfg.watchLinks || [])];
  const wsec = el(`<section class="ws-card"><h3>Watch websites</h3><p>Every film gets a Watch button for each website. The film’s name is added to the address: <b>example.com/movie/</b> opens <b>example.com/movie/the-dark-knight/</b>. Put <b>{name}</b> anywhere else in the address to place it yourself.</p><div class="wlist"></div>
    <input class="field" id="wp" placeholder="Website address, e.g. example.com/movie/" autocapitalize="off" autocomplete="off" spellcheck="false" inputmode="url">
    <input class="field" id="wn" placeholder="Button name (optional)">
    <button class="btn" id="wa" style="width:100%">${icon('plus')}Add Website</button></section>`);
  const wl = wsec.querySelector('.wlist');
  const drawLinks = () => {
    wl.innerHTML = links.length ? '' : '<p class="small">None yet.</p>';
    links.forEach((w, i) => { const r = el(`<div class="wrow"><div><b>${esc(w.name || w.pattern.replace(/^https?:\/\//, '').split('/')[0])}</b><small>${esc(w.pattern.replace(/^https?:\/\//, ''))}</small></div><button class="btn sm" aria-label="Remove">${icon('trash')}</button></div>`);
      r.querySelector('button').onclick = async () => { links.splice(i, 1); if (await saveSettings({ watchLinks: links }, 'Removed')) drawLinks(); }; wl.appendChild(r); });
  };
  drawLinks();
  wsec.querySelector('#wa').onclick = async () => {
    const pat = wsec.querySelector('#wp').value.trim(); if (!pat) return;
    links.push({ pattern: pat, name: wsec.querySelector('#wn').value.trim() });
    if (await saveSettings({ watchLinks: links }, 'Website added')) { links.splice(0, links.length, ...cfg.watchLinks); wsec.querySelector('#wp').value = ''; wsec.querySelector('#wn').value = ''; drawLinks(); } else links.pop();
  };
  box.appendChild(wsec);
  // how films open on this phone
  const get = el(`<section class="ws-card"><h3>Ad-free watching</h3>${NATIVE ? '<p>You’re in Lumen Browser: it blocks ads, trackers and pop-ups, starts the film and fills the screen by itself.</p>'
    : IOS ? '<p>On iPhone, Watch opens films in <b>Brave</b>, a free browser that blocks ads and pop-ups. Tap the video’s full-screen button there.</p><a class="btn" href="https://apps.apple.com/app/brave-private-web-browser/id1052879175" target="_blank" rel="noopener">Get Brave (free)</a><p style="margin-top:14px">Or get <b>Lumen Browser for iPhone</b>, which also stops pop-ups and redirects. It isn’t on the App Store, so it’s installed with AltStore and a Windows PC.</p><a class="btn" href="https://github.com/da1essi08sol-dot/lumen/blob/main/ios/README.md" target="_blank" rel="noopener">How to Install Lumen Browser</a>'
    : ANDROID ? `<p>Get <b>Lumen Browser</b>, the free Android app: it blocks ads and pop-ups, starts the film and goes full screen by itself.</p><a class="btn primary" href="${APK_URL}" target="_blank" rel="noopener">${icon('download') || ''}Get Lumen Browser</a>`
    : '<p>On a computer, install <b>Lumen</b> for Windows for the full TV experience.</p><a class="btn" href="https://github.com/da1essi08sol-dot/lumen/releases/latest" target="_blank" rel="noopener">Get Lumen for Windows</a>'}</section>`);
  box.appendChild(get);
  // you
  const me = el(`<section class="ws-card"><h3>You</h3><input class="field" id="un" placeholder="Your name (for the greeting)" value="${esc(cfg.userName || '')}">
    <label class="small" style="display:block;margin:6px 0">Region</label><select class="field" id="rg">${REGIONS.map(([k, n]) => `<option value="${k}" ${cfg.region === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
    <button class="btn" id="mes" style="width:100%">Save</button></section>`);
  me.querySelector('#mes').onclick = () => saveSettings({ userName: me.querySelector('#un').value, region: me.querySelector('#rg').value }, 'Saved');
  box.appendChild(me);
  // look
  const look = el(`<section class="ws-card"><h3>Colour</h3><div class="sw">${ACCENT_SWATCHES.map(([k, c]) => `<button data-acc="${k}" class="${(cfg.accent || 'white') === k ? 'on' : ''}" style="background:${c}" aria-label="${k}"></button>`).join('')}</div>
    <h3 style="margin-top:18px">Fonts</h3><div class="fchips">${FONT_CHOICES.map(([k, n]) => `<button data-font="${k}" data-fp="${k}" class="${(cfg.font || 'classic') === k ? 'on' : ''}"><span>${n}</span></button>`).join('')}</div></section>`);
  look.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = async () => { haptic(); await saveSettings({ accent: b.dataset.acc }); look.querySelectorAll('[data-acc]').forEach((x) => x.classList.toggle('on', x === b)); }));
  look.querySelectorAll('[data-font]').forEach((b) => (b.onclick = async () => { haptic(); await saveSettings({ font: b.dataset.font }); look.querySelectorAll('[data-font]').forEach((x) => x.classList.toggle('on', x === b)); }));
  box.appendChild(look);
  const tr = el(`<section class="ws-card"><h3>Bring from your laptop</h3>
    <p>On your laptop's phone page (Lumen's remote), open <b>Library</b> and tap <b>Copy My Lumen</b>. Then come back here.</p>
    <button class="btn primary" id="tp" style="width:100%">Paste and Bring Across</button>
    <details style="margin-top:10px"><summary class="small">Paste didn't work?</summary><textarea class="field" id="tt" rows="3" placeholder="Paste the copied link here" style="margin-top:8px"></textarea><button class="btn" id="tb" style="width:100%">Bring Across</button></details></section>`);
  const doImport = async (text) => { try { await importTransfer(text); showTab('settings'); } catch (e) { toast(e.message); } };
  tr.querySelector('#tp').onclick = async () => { let t = ''; try { t = await navigator.clipboard.readText(); } catch { tr.querySelector('details').open = true; tr.querySelector('#tt').focus(); return; } doImport(t); };
  tr.querySelector('#tb').onclick = () => doImport(tr.querySelector('#tt').value);
  box.appendChild(tr);
  box.appendChild(el(`<section class="ws-card"><h3>About</h3><p>Lumen keeps your settings, folders and Continue Watching on this phone. There’s no account, no adverts and no tracking.</p>
    <p class="small">Film data and images: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB. <a href="https://github.com/da1essi08sol-dot/lumen/blob/main/PRIVACY.md" target="_blank" rel="noopener">Privacy</a></p></section>`));
}

// iPhone Safari ignores user-scalable=no, so stop pinch zoom here too (touch-action in phone.css stops double-tap zoom)
for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------- start
async function start() {
  try { cfg = { ...cfg, ...(await api('/api/config')) }; } catch (e) { app.innerHTML = ''; app.appendChild(errorBox(e, start)); return; }
  applyLook();
  shell();
  if (WEB && location.hash.startsWith('#import=')) { const h = location.hash; history.replaceState(null, '', location.pathname); try { await importTransfer(h); } catch (e) { toast(e.message); } }
  if (WEB && !cfg.hasKey) { showTab('settings'); return; }
  showTab('home');
  if (!WEB) startPolling();
}
// Lumen Browser tells the page when a film it played has finished, so Continue Watching is up to date
window.lumenRefresh = () => { cache.clear(); if (!subs.length) showTab(tab); };
if (token) start();
