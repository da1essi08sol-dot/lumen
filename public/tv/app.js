// Lumen TV — application shell, views and remote handling.
import { icon } from '/shared/icons.js';
import { api, cfg, img, cached, invalidate, connect } from './api.js';
import * as nav from './nav.js';
import * as ui from './ui.js';
import * as player from './player.js';
import * as sound from './sound.js';
import { loadingHtml, logoMark as mark, wallUrl, backgroundCss, solidCss, LOADING_CSS } from '/shared/loading.js';
const logoMark = (o) => mark(o);
// the logo's own styling (also used by the start-up intro and goodbye on this page)
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: LOADING_CSS }));

const { el, esc, onSelect, itemOf } = ui;

const TABS = [['search', 'Search', 'search'], ['home', 'Home'], ['movies', 'Movies'], ['tv', 'TV Shows'], ['free', 'Free to Watch'], ['recent', 'Recently Added'], ['library', 'My Library']];
const app = { tab: null, stack: [], remotes: 0, external: null, backgrounds: [], lastArt: '' };
const $ = (s, r = document) => r.querySelector(s);
const stage = $('#stage'), topbar = $('#topbar');
let ws;

// ======================================================================= boot
async function boot() {
  buildTopbar();
  await loadConfig();
  ws = connect(onServer, (up) => { if (!up) ui.toast('Reconnecting to the TV server…', 'wifi'); else sendState(); });
  tick(); setInterval(tick, 15000);
  nav.setBaseLayer($('#app'), false);
  const intro = cfg.intro?.anim !== false ? playIntro() : null; // Home loads underneath while the intro plays
  switchTab('home', { focusContent: true });
  await intro;
}

// ======================================================================= update Lumen
async function updateLumen() {
  if (cfg.app) return updateApp();
  ui.toast('Looking for a new version in Downloads…', 'search');
  let u; try { u = await api('/api/update/check'); } catch (e) { return ui.toast(e.message, 'info'); }
  if (!u.supported) return ui.confirmDialog({ title: 'Update Lumen', text: 'On the Windows laptop: download the new Lumen-TV.zip, then double-click “Update Lumen” on the desktop.', ok: 'OK', cancel: 'Close' });
  if (!u.found) return ui.confirmDialog({ title: 'No update downloaded yet', text: `You have version ${u.installed}. Download the new Lumen-TV.zip on this laptop (it goes into Downloads), then come back here and press Update Lumen again.`, ok: 'OK', cancel: 'Close' });
  if (!u.newer) return ui.confirmDialog({ title: 'You’re up to date', text: `Lumen ${u.installed} is the newest version you’ve downloaded.`, ok: 'OK', cancel: 'Close' });
  const ok = await ui.confirmDialog({ title: `Update to version ${u.version}?`, text: `Lumen closes for a few seconds, puts in the new version (your settings, pairing and Continue Watching stay as they are) and opens again by itself.`, ok: 'Update Now' });
  if (!ok) return;
  const x = introScene('bye up', `<p>Updating to version ${esc(u.version)}…</p>`);
  document.body.appendChild(x);
  try { await api('/api/update/run', { method: 'POST', body: { zip: u.zip } }); } catch (e) { x.remove(); ui.toast(e.message, 'info'); }
}

// Lumen as a desktop app: new versions come from GitHub by themselves, or from an installer in Downloads
async function updateApp() {
  ui.toast('Checking for a new version…', 'search');
  let u; try { u = await api('/api/update/check'); } catch (e) { return ui.toast(e.message, 'info'); }
  if (!u.found) return ui.confirmDialog({ title: 'You’re up to date', text: `Lumen ${u.installed} is the newest version.${u.note ? ' ' + u.note : ''}`, ok: 'OK', cancel: 'Close' });
  const ok = await ui.confirmDialog({ title: `Update to Lumen ${u.version}?`, text: `${u.source === 'github' ? 'It downloads now. ' : ''}Lumen closes for a few seconds, puts in the new version and opens again by itself. Your settings, folders, sign-ins and Continue Watching stay as they are.`, ok: 'Update Now' });
  if (!ok) return;
  const x = introScene('bye up', `<p class="upd">Getting Lumen ${esc(u.version)} ready…</p>`);
  document.body.appendChild(x);
  try { await api('/api/update/run', { method: 'POST', body: {} }); } catch (e) { x.remove(); ui.toast(e.message, 'info'); }
}

// ---- sleep timer: a small countdown at the top while it's set; when it ends everything stops and the screen goes dark
let sleepState = null, sleepTick = null;
function setSleepBadge(info) {
  sleepState = info ? { at: Date.now() + info.left * 1000 } : null;
  let b = $('#sleepBadge');
  if (!b) { b = el(`<div id="sleepBadge" class="sleep-badge">${icon('sunLow')}<span></span></div>`); document.body.appendChild(b); }
  clearInterval(sleepTick);
  const draw = () => { if (!sleepState) return b.classList.remove('on'); const m = Math.max(0, Math.ceil((sleepState.at - Date.now()) / 60000)); b.querySelector('span').textContent = `Sleep in ${m} min`; b.classList.add('on'); };
  draw(); if (sleepState) sleepTick = setInterval(draw, 15000);
}
const sleepLabel = () => (sleepState ? `${Math.max(1, Math.ceil((sleepState.at - Date.now()) / 60000))} min left` : 'Off');
async function sleepDialog() {
  const opts = [[0, 'Off'], [15, '15 minutes'], [30, '30 minutes'], [45, '45 minutes'], [60, '1 hour'], [90, '1 hour 30'], [120, '2 hours']];
  const pick = await choose('Sleep Timer', opts.map(([m, l]) => [String(m), l]));
  if (pick === null || pick === undefined) return;
  try { const r = await api('/api/sleep', { method: 'POST', body: { minutes: +pick } }); setSleepBadge(r.sleep); ui.toast(r.sleep ? `Lumen will sleep in ${pick} minutes` : 'Sleep timer off', 'check'); }
  catch (e) { ui.toast(e.message, 'info'); }
}
function sleepNow() {
  setSleepBadge(null);
  if (player.isOpen()) player.close();
  ui.modalStack.slice().reverse().forEach((m) => m.close?.());
  const s = el(`<div id="sleeping" style="position:fixed;inset:0;z-index:2147483001;background:#000;display:grid;place-items:center;color:rgba(243,241,236,.5);font-size:1.6rem;opacity:0;transition:opacity 2s"><div>Sleep timer finished. Press any button to wake Lumen.</div></div>`);
  document.body.appendChild(s); requestAnimationFrame(() => (s.style.opacity = 1));
  app.sleeping = s;
}

// the start-up / closing scene: your colour as a flat background, a 3D floor stretching away to the horizon,
// and the LumenTV writing standing on it with a soft shadow beneath. `extra` goes under the logo.
function introScene(cls = '', extra = '') {
  return el(`<div id="intro" class="xb ${cls}" style="--solid:${solidCss(accentRgbNow())}">
    <div class="bg"></div><div class="floor"></div><div class="horizon"></div>
    <div class="stand"><div class="mark">${logoMark()}</div><div class="shadow"></div>${extra}</div></div>`);
}

// ======================================================================= close Lumen
async function quitLumen() {
  const ok = await ui.confirmDialog({ title: 'Close Lumen?', text: 'This stops Lumen on this laptop and closes the TV screen and any open website — the same as “Stop Lumen”. To start it again, use “Start Lumen” on the laptop.', ok: 'Close Lumen', danger: true });
  if (!ok) return;
  // goodbye: your shutdown sound plays, your colour fills the screen, the writing rises up from below onto the
  // floor, and everything fades to black, reaching black as the sound ends — then Lumen closes.
  const x = introScene('bye', `<p>See you soon${cfg.userName ? ', ' + esc(cfg.userName) : ''}</p>`);
  x.insertAdjacentHTML('beforeend', '<div class="black"></div>');
  document.body.appendChild(x);
  let plan = { length: sound.INTRO_LENGTH, beats: [] };
  try { plan = await sound.outroPlan(cfg.intro?.sound !== false); } catch {}
  const T = plan.length;
  // the fade starts at the same moment as the sound and runs for exactly its length; Lumen closes when it ends
  const fade = x.querySelector('.black').animate([{ opacity: 0 }, { opacity: 1 }], { duration: T * 1000, easing: 'cubic-bezier(.55,0,.75,.35)', fill: 'forwards' });
  requestAnimationFrame(() => requestAnimationFrame(() => x.classList.add('go', 'up')));   // colour in, writing rises
  setTimeout(async () => {                              // by the clock, not by screen frames: closes exactly at the end of the sound
    fade.finish();
    try { await api('/api/quit', { method: 'POST' }); } catch {}
    try { window.close(); } catch {}                     // the TV window closes as the sound ends
    setTimeout(() => { const p = x.querySelector('p'); if (p) { p.textContent = 'Lumen is closed. You can close this window.'; fade.cancel(); x.querySelector('.black').style.opacity = '.85'; } }, 5000);
  }, T * 1000);
}

// ======================================================================= LumenTV intro
// Three beats: "Lu", "men", then "TV" with a bloom of light; it holds with the last note and fades as the
// sound fades, so the picture and the sound end together. Any key skips it.
function playIntro() {
  return new Promise((resolve) => {
    const x = introScene();
    document.body.appendChild(x);
    requestAnimationFrame(() => requestAnimationFrame(() => x.classList.add('go')));   // your colour fills the screen
    // then, as the sound starts, the writing rises from below the screen up onto the floor while it fades in; near
    // the end of the sound the whole scene fades into the menu. Everything runs on the sound's own timing.
    const timers = [], m = x.querySelector('.mark');
    let plan = null;
    sound.introPlan(0.5, cfg.intro?.sound !== false).catch(() => null).then((p) => {
      plan = p;
      if (done) { p?.stop?.(0.3); return; }
      p ||= { lead: 0.5, beats: sound.INTRO.beats, fadeFrom: 2, end: sound.INTRO_LENGTH };
      const lead = p.lead;                                          // the sound starts `lead` s from now
      const at = (sec, fn) => timers.push(setTimeout(fn, Math.max(0, (lead + sec) * 1000)));
      at(0, () => x.classList.add('up'));                         // the writing rises with the sound
      at(p.fadeFrom, () => { x.style.transition = `opacity ${Math.max(0.3, p.end - p.fadeFrom).toFixed(2)}s linear`; x.classList.add('fadeout'); });
      at(cfg.reduceMotion ? 1.6 : p.end, () => finish(false));  // …and gone exactly when the sound has died away
    });
    let done = false;
    const finish = (skipped) => {
      if (done) return; done = true;
      timers.forEach(clearTimeout); removeEventListener('keydown', skip, true);
      if (skipped) { x.style.transition = 'opacity .4s ease'; x.classList.add('fadeout'); plan?.stop?.(0.4); }   // the sound fades with it
      setTimeout(() => { x.remove(); resolve(); }, skipped ? 420 : 40);
    };
    const skip = (e) => { e.preventDefault(); e.stopImmediatePropagation(); finish(true); };
    addEventListener('keydown', skip, true);
  });
}

async function loadConfig() {
  try {
    Object.assign(cfg, await api('/api/config'));
    document.documentElement.classList.toggle('rm', !!cfg.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches); // Lumen's setting, or Windows' own
    sound.configure(cfg.sound || {});
    applyPersonal(); tick();
    applyBrightness(cfg.brightness?.level ?? 100);
    $('#clock').style.visibility = cfg.showClock ? '' : 'hidden';
    if (cfg.background?.mode === 'custom') app.backgrounds = (await api('/api/backgrounds')).backgrounds;
    applyBackground();
  } catch (e) { console.error(e); }
}

function tick() {
  const now = new Date();
  $('#clock').innerHTML = `<span class="t">${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span><span class="d">${now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>`;
  document.querySelectorAll('.hero .greet').forEach((g) => (g.innerHTML = greeting())); // follows the time of day and name changes
}
// ---- brightness 1-100: a dimming layer over everything Lumen shows (websites are dimmed by the server)
const dimFactor = (L) => 0.1 + 0.9 * ((Math.max(1, Math.min(100, L)) - 1) / 99); // same curve as the server
function applyBrightness(level) {
  let d = document.getElementById('dim');
  if (!d) { d = el('<div id="dim"></div>'); document.body.appendChild(d); }
  d.style.opacity = (1 - dimFactor(level)).toFixed(3);
  const v = document.querySelector('[data-setting="brightness"] .val'); if (v) v.innerHTML = brightVal(level);
}
const brightVal = (L) => `<span class="bmini"><i style="width:${L}%"></i></span>${L}%`;
function brightnessDialog() { return new Promise((done) => { // resolves when the dialog closes
  let L = cfg.brightness?.level ?? 100, sendT = null;
  const m = ui.modal(`<h2>Brightness</h2><p>Dims everything Lumen shows, including films playing in websites. Your phone’s Remote tab has a brightness bar too.</p>
    <div class="bright-big"><span class="num"></span><div class="bar"><i></i></div></div>
    <div class="actions" data-group="row"></div><div class="actions presets" data-group="row"></div>`, { wide: true, onClose: done });
  const draw = () => { m.querySelector('.num').textContent = L + '%'; m.querySelector('.bar i').style.width = L + '%'; };
  const set = (v) => {
    L = Math.max(1, Math.min(100, Math.round(v))); draw(); applyBrightness(L);
    clearTimeout(sendT); sendT = setTimeout(() => api('/api/settings', { method: 'POST', body: { brightness: { level: L } } }).catch(() => {}), 120);
  };
  const a = m.querySelectorAll('.actions');
  const minus = onSelect(el(`<div class="btn f glow square" title="Darker">${icon('minus')}</div>`), () => set(L - 1));
  const plus = onSelect(el(`<div class="btn f glow square" title="Brighter">${icon('plus')}</div>`), () => set(L + 1));
  a[0].append(onSelect(el(`<div class="btn f glow">−10</div>`), () => set(L - 10)), minus, plus, onSelect(el(`<div class="btn f glow">+10</div>`), () => set(L + 10)),
    onSelect(el(`<div class="btn primary f glow">Done</div>`), () => m.close()));
  for (const p of [1, 25, 50, 75, 100]) a[1].appendChild(onSelect(el(`<div class="btn f glow small">${p}%</div>`), () => set(p)));
  draw(); m.open(plus);
}); }

const accentRgbNow = () => getComputedStyle(document.documentElement).getPropertyValue('--acc').replace(/\s/g, '') || '255,255,255';

// ---- personal: accent colour + greeting
export const ACCENTS = {
  white: ['Moonlight', '#ffffff'], amber: ['Amber', '#ffc970'], rose: ['Rose', '#ffa0b6'], mint: ['Mint', '#80e8ba'], sky: ['Sky', '#82c6ff'], lilac: ['Lilac', '#c4acff'],
  red: ['Red', '#ff453a'], scarlet: ['Scarlet', '#ff2a1a'], crimson: ['Crimson', '#dc143c'], cherry: ['Cherry', '#b3001b'], coral: ['Coral', '#ff7262'],
};
const accentHex = (a) => (/^#[0-9a-f]{6}$/i.test(a || '') ? a : (ACCENTS[a] || ACCENTS.white)[1]);
const accentName = (a) => (/^#/.test(a || '') ? `Custom ${a.toUpperCase()}` : (ACCENTS[a] || ACCENTS.white)[0]);
function applyPersonal() {
  const hex = accentHex(cfg.accent), n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const root = document.documentElement;
  root.style.setProperty('--acc', `${r}, ${g}, ${b}`);
  root.style.setProperty('--acc-ink', lum > 0.55 ? '#000' : '#fff'); // dark reds get white text
  root.dataset.accent = cfg.accent === 'white' || !cfg.accent ? 'white' : 'custom';
  root.dataset.font = FONTS.some(([k]) => k === cfg.font) ? cfg.font : 'classic';
}

// ---- fonts (Settings › Personal › Fonts): the look of every title, previewed on a small copy of Home
const FONTS = [['classic', 'Classic', 'The original Lumen look'], ['cinema', 'Cinema', 'Tall, condensed and heavy'], ['bold', 'Bold', 'The same new type, full width'],
  ['signage', 'Signage', 'Narrow, like a road sign'], ['serif', 'Serif', 'Like a film poster']];
const fontName = (k) => (FONTS.find(([x]) => x === k) || FONTS[0])[1];
async function fontDialog() {
  let d = null; try { d = await cached('section:home', () => api('/api/section/home'), 3 * 60e3); } catch {}
  const hero = d?.hero?.find((i) => i.backdrop_path) || null;
  const thumbs = (d?.rows || []).flatMap((r) => r.items || []).filter((i) => i.backdrop_path).slice(0, 6);
  const cur = cfg.font || 'classic';
  return new Promise((done) => {
    const m = ui.modal(`<h2>Fonts</h2><p>Move left and right to try each one on Home. Press OK to use it.</p>
      <div class="fp" data-fp="${esc(cur)}">${hero ? `<div class="fp-bd" style="background-image:url('${esc(img(hero.backdrop_path, 'w1280'))}')"></div>` : ''}
        <div class="fp-copy"><div class="fp-greet">${esc(greeting().replace(/<[^>]+>/g, ''))}</div>
          <div class="fp-title">${esc(hero?.title || 'The Golden Lantern')}</div>
          <div class="fp-meta">${hero ? `${hero.type === 'tv' ? 'TV Show' : 'Film'}${hero.year ? ` · ${hero.year}` : ''}${hero.vote_average ? ` · ★ ${(+hero.vote_average).toFixed(1)}` : ''}` : 'Film · 2011 · ★ 7.5'}</div>
          <div class="fp-btns"><span>Details</span><span>Add to Folder</span></div></div>
        <div class="fp-row"><b>Trending Today</b><div>${(thumbs.length ? thumbs : Array(6).fill(null)).map((t) => `<i${t ? ` style="background-image:url('${esc(img(t.backdrop_path, 'w300'))}')"` : ''}></i>`).join('')}</div></div>
      </div>
      <div class="fp-pick" data-group="row"></div>`, { wide: true, onClose: () => done() });
    const box = m.querySelector('.fp'), pick = m.querySelector('.fp-pick');
    let first = null;
    for (const [k, name, sub] of FONTS) {
      const b = onSelect(el(`<div class="setting f" data-fp="${k}" data-k="${k}"><span><span style="font-family:var(--tf);font-weight:var(--tw);font-stretch:var(--tst);font-size:1.7rem;letter-spacing:var(--tls)">${esc(name)}</span><span class="sub">${esc(sub)}${k === cur ? ' · in use' : ''}</span></span></div>`), async () => {
        cfg.font = k; applyPersonal();
        await api('/api/settings', { method: 'POST', body: { font: k } }).catch((e) => ui.toast(e.message, 'info'));
        ui.toast(`Fonts: ${name}`, 'check'); m.close();
      });
      b.addEventListener('nav-focus', () => (box.dataset.fp = k));
      pick.appendChild(b); if (k === cur) first = b;
    }
    m.open(first);
  });
}
function greeting() {
  const h = new Date().getHours();
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
  return cfg.userName ? `${part}, <b>${esc(cfg.userName)}</b>` : part;
}
// a row of films from your own folders, reshuffled each day
async function libraryPicks() {
  const folders = await cached('lib:folders', () => api('/api/folders').then((r) => r.folders), 60e3).catch(() => []);
  const all = folders.flatMap((f) => f.items).filter((i) => i.poster_path);
  const seen = new Set(), items = all.filter((i) => { const k = i.type + i.id; if (seen.has(k)) return false; seen.add(k); return true; });
  let seed = Math.floor(Date.now() / 864e5);
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  return items.slice(0, 20);
}

// ======================================================================= top bar
function buildTopbar() {
  const tabs = $('#tabs');
  for (const [key, label, ic] of TABS) {
    const t = el(`<div class="tab f ${ic ? 'icon-only' : ''}" data-tab="${key}" role="button" aria-label="${esc(label)}">${ic ? icon(ic) : esc(label)}</div>`);
    onSelect(t, () => switchTab(key, { focusContent: true }));
    tabs.appendChild(t);
  }
  // top-left: close Lumen (same as running "Stop Lumen")
  $('#sysleft').appendChild(onSelect(el(`<div class="round f glow" id="quitBtn" title="Close Lumen" role="button" aria-label="Close Lumen">${icon('power')}</div>`), quitLumen));
  const sys = $('#sysbtns');
  sys.appendChild(onSelect(el(`<div class="round f glow" id="remoteBtn" role="button" aria-label="Pair a phone remote">${icon('remote')}<span class="badge"></span></div>`), openPairing));
  sys.appendChild(onSelect(el(`<div class="round f glow" data-tab="settings" role="button" aria-label="Settings">${icon('settings')}</div>`), () => switchTab('settings', { focusContent: true })));
  let t;
  tabs.addEventListener('nav-focus', (e) => {
    clearTimeout(t);
    const key = e.target.dataset.tab;
    t = setTimeout(() => { if (nav.focused() === e.target && key !== app.tab) switchTab(key); }, 320);
  });
}
function markTab() {
  document.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === app.tab));
}
function updateTopbar() {
  const v = currentView();
  const away = app.stack.length > 0 || (v && +v.dataset.ty > 0);
  topbar.classList.toggle('away', !!away);
  if (away) topbar.setAttribute('hidden-nav', ''); else topbar.removeAttribute('hidden-nav');
}

// ======================================================================= views & routing
const currentView = () => (app.stack.length ? app.stack[app.stack.length - 1].el : app.tabView);

function viewShell(cls = '') {
  const v = el(`<section class="view ${cls}" data-ty="0"><div class="scroller"></div></section>`);
  v.scroller = v.querySelector('.scroller');
  return v;
}
function mount(v) {
  stage.appendChild(v);
  requestAnimationFrame(() => requestAnimationFrame(() => v.classList.add('in')));
}
function unmount(v) {
  if (!v) return;
  v.classList.add('leaving'); v.classList.remove('in');
  v.hero?.stop?.();
  setTimeout(() => v.remove(), 450);
}

function switchTab(key, { focusContent = false } = {}) {
  if (key === app.tab && !app.stack.length && app.tabView) {
    if (focusContent) app.tabView.ready.then(() => nav.focus(nav.firstIn(app.tabView)));
    return;
  }
  for (const s of app.stack.splice(0)) unmount(s.el);
  unmount(app.tabView);
  app.tab = key;
  markTab();
  const v = (VIEWS[key] || VIEWS.home)();
  app.tabView = v;
  mount(v);
  updateTopbar();
  sendState();
  if (focusContent) v.ready.then(() => { if (app.tabView === v && !app.stack.length) nav.focus(nav.firstIn(v) || $('.tab.active')); });
}

function push(v) {
  const prev = currentView();
  app.stack.push({ el: v, prevFocus: nav.focused(), prev });
  prev?.classList.add('under');
  mount(v);
  updateTopbar();
  sendState();
  v.ready.then(() => { if (currentView() === v) nav.focus(nav.firstIn(v)); });
}
function pop() {
  const s = app.stack.pop();
  if (!s) return;
  unmount(s.el);
  const back = currentView();
  back?.classList.remove('under');
  if (s.prevFocus?.isConnected && !s.prevFocus.closest('.leaving')) nav.focus(s.prevFocus);
  else nav.focus(nav.firstIn(back));
  back?.onReturn?.(); // may re-render in place; it restores focus from the path captured above
  updateTopbar();
  sendState();
}

// keep the focused block in view: vertical page scrolling + horizontal rows
function offsetWithin(node, anc) { let y = 0; while (node && node !== anc) { y += node.offsetTop; node = node.offsetParent; } return y; }
document.addEventListener('nav-focus', (e) => {
  const t = e.target;
  if (e.detail?.mouse) { // hovering: highlight only, don't move anything under the pointer
    document.querySelectorAll('.row.active').forEach((r) => r.classList.remove('active'));
    t.closest('.row')?.classList.add('active');
    const it = itemOf.get(t); if (it?.backdrop_path) setArt(img(it.backdrop_path, 'w300'));
    return;
  }
  nav.scrollRowTo(t);
  document.querySelectorAll('.row.active').forEach((r) => r.classList.remove('active'));
  t.closest('.row')?.classList.add('active');
  const v = t.closest('.view');
  if (v && v.scroller && !v.dataset.noscroll) {
    const fs = ui.rem();
    let target = 0;
    if (!t.closest('[data-top]')) {
      const block = t.closest('.row, .episode, .setting, .vblock') || t;
      const anchor = (+v.dataset.anchor || 30) * fs;
      target = offsetWithin(block, v.scroller) - anchor;
      const max = v.scroller.scrollHeight - innerHeight;
      target = Math.max(0, Math.min(target, Math.max(0, max)));
    }
    v.dataset.ty = String(target);
    v.scroller.style.transform = `translate3d(0,${-target}px,0)`;
  }
  // scroll lists inside modal sheets
  const ls = t.closest('.list-scroll');
  if (ls) {
    const inner = ls.firstElementChild, fs = ui.rem();
    const y = offsetWithin(t, inner) - ls.clientHeight / 2 + t.offsetHeight / 2;
    inner.style.transform = `translateY(${-Math.max(0, Math.min(y, inner.scrollHeight - ls.clientHeight))}px)`;
  }
  updateTopbar();
  const it = itemOf.get(t);
  if (it?.backdrop_path) setArt(img(it.backdrop_path, 'w300'));
  sendState();
});

// ======================================================================= ambient background
const amb = { layers: [...document.querySelectorAll('#ambient .layer')], flip: 0, key: '' };
let artT;
function setArt(url) { app.lastArt = url; if ((cfg.background?.mode || 'artwork') !== 'artwork') return; clearTimeout(artT); artT = setTimeout(() => setAmbient(url, 'art'), 260); }
function setAmbient(url, cls) {
  const key = cls + '|' + url;
  if (key === amb.key) return;
  amb.key = key;
  const l = amb.layers[(amb.flip ^= 1)], o = amb.layers[amb.flip ^ 1];
  const go = () => { if (amb.key !== key) return; l.className = 'layer ' + cls; l.style.backgroundImage = url ? `url("${url}")` : ''; requestAnimationFrame(() => { l.classList.add('on'); o.classList.remove('on'); }); };
  if (url) { const i = new Image(); i.src = url; (i.decode ? i.decode() : Promise.reject()).then(go, go); } else go(); // decoded first, so the fade never stutters
}
function applyBackground() {
  const b = cfg.background || { mode: 'artwork' };
  if (b.mode === 'custom') { const bg = app.backgrounds.find((x) => x.id === b.image); setAmbient(bg ? `/bg/${bg.file}` : '', bg ? 'custom' : 'graphite'); }
  else if (b.mode === 'graphite') setAmbient('', 'graphite');
  else if (b.mode === 'black') setAmbient('', 'black');
  else setAmbient(app.lastArt, 'art');
}

// ======================================================================= shared actions
window.__lumenOpen = (it) => openDetail(it);   // (used by Lumen's own tests)
function openDetail(item) {
  if (item.type === 'file') return playLocal(item);
  push(detailView(item));
}
async function openService(service, query, label) {
  ui.toast(`Opening ${label || cfg.serviceNames?.[service] || 'website'}…`, 'globe');
  try { await api('/api/open', { method: 'POST', body: { service, query } }); }
  catch (e) { ui.toast(e.message, 'info'); }
}
async function openShortcut(sc) {
  ui.toast(`Opening ${sc.name}…`, 'globe');
  try { await api('/api/open', { method: 'POST', body: { shortcut: sc.id } }); } catch (e) { ui.toast(e.message, 'info'); }
}
// ---- "Watch" button: opens the link pattern from Settings with the film's name added.
// Same rule as the server: lowercase, spaces → "-" (punctuation dropped).
const slugify = (t) => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim().replace(/[\s-]+/g, '-');
const watchUrl = (pattern, title, year) => /\{(name|slug)\}/i.test(pattern)
  ? pattern.replace(/\{(name|slug)\}/gi, slugify(title)).replace(/\{year\}/gi, year || '')
  : pattern.replace(/\/*$/, '/') + slugify(title) + '/';
// ---- Watch buttons: one for each Watch website you add (Settings → Watch Buttons)
const watchLinks = () => (cfg.watchLinks || []).filter((w) => w.pattern);
const hostName = (pat) => (pat || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
const linkName = (w) => w.name || hostName(w.pattern);
const findLink = (id) => watchLinks().find((w) => w.id === id) || watchLinks()[0] || null;
const watchLabel = (w) => (!w ? 'Watch' : watchLinks().length > 1 || w.name ? `Watch on ${linkName(w)}` : 'Watch');
async function saveWatchLinks(list, msg) {
  try { await api('/api/settings', { method: 'POST', body: { watchLinks: list } }); await loadConfig(); if (msg) ui.toast(msg, 'check'); return true; }
  catch (e) { ui.toast(e.message, 'info'); return false; }
}
const PATTERN_HELP = 'Type the website. The film’s name is added in lowercase with spaces as “-” and a / at the end. Example: movies.com opens movies.com/the-dark-knight/. To put the name somewhere else, write {name} where it goes (and {year} for the year).';
async function addWatchLink() {
  const pat = await ui.promptDialog({ title: 'Add a Watch Website', text: PATTERN_HELP, placeholder: 'example.com/movie/', ok: 'Next', mono: true });
  if (!pat || !pat.trim()) return;
  const name = await ui.promptDialog({ allowEmpty: true, title: 'Button Name', text: 'Shown on every film as “Watch on …”.', value: hostName(pat.trim()).split('.')[0].replace(/^./, (c) => c.toUpperCase()), placeholder: 'Site name', ok: 'Add' });
  if (name === null || name === undefined) return;
  await saveWatchLinks([...watchLinks(), { pattern: pat.trim(), name: name.trim() }], `Added “Watch on ${name.trim() || hostName(pat)}”`);
}
async function editWatchLink(w) {
  const pat = await ui.promptDialog({ allowEmpty: true, title: `Watch on ${linkName(w)}`, text: PATTERN_HELP + ' Clear it to remove this button.', value: w.pattern, placeholder: 'example.com/movie/', ok: 'Next', mono: true });
  if (pat === null || pat === undefined) return;
  if (!pat.trim()) {
    const ok = await ui.confirmDialog({ title: `Remove “Watch on ${linkName(w)}”?`, text: 'The button is taken off every film.', ok: 'Remove', danger: true });
    if (ok) await saveWatchLinks(watchLinks().filter((x) => x.id !== w.id), 'Watch button removed');
    return;
  }
  const name = await ui.promptDialog({ allowEmpty: true, title: 'Button Name', text: 'Shown on every film as “Watch on …”.', value: w.name || '', placeholder: hostName(pat), ok: 'Save' });
  if (name === null || name === undefined) return;
  await saveWatchLinks(watchLinks().map((x) => (x.id === w.id ? { id: w.id, pattern: pat.trim(), name: name.trim() } : x)), 'Watch button saved');
}
async function openWatch(title, year, it = null, linkId = null) {
  const w = findLink(linkId);
  if (!w) return; // no Watch website set: do nothing
  showOpening(title, it, w);   // the loading screen starts here and carries on in the browser, so it's one smooth step
  const item = it && it.id ? { id: it.id, type: it.type, poster_path: it.poster_path || null, backdrop_path: it.backdrop_path || null } : null;
  try { await api('/api/open', { method: 'POST', body: { watchLink: true, linkId: w.id, title, year: year ? +year : null, item } }); }
  catch (e) { setExternal(null); ui.toast(e.message, 'info'); }
}
// ---- Continue Watching (progress is saved while a film plays on your Watch website)
const fmtLeft = (w) => { const m = Math.max(1, Math.round((w.d - w.t) / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min left` : `${m} min left`; };
const watchingList = () => cached('watching', () => api('/api/watching').then((r) => r.items), 60e3).catch(() => []);
function continueRow(items) {
  const cards = items.map((w) => ui.wideCard(w, { sub: fmtLeft(w), progress: w.d ? w.t / w.d : 0, onPick: () => openWatch(w.title, w.year, w, w.linkId) }));
  return ui.row('Continue Watching', cards, { sub: 'Picks up where you left off · Menu removes one' });
}
async function playLocal(file) {
  const roots = await api('/api/media/roots').catch(() => ({ vlc: false }));
  if (!file.playable && roots.vlc) { ui.toast('Opening in VLC…', 'film'); return api('/api/media/vlc', { method: 'POST', body: { path: file.path } }).catch((e) => ui.toast(e.message, 'info')); }
  player.playFile(file, { vlcAvailable: roots.vlc, onExit: () => sendState() });
  sendState();
}
const cardOpts = { onPick: (it) => openDetail(it) };
const posterRow = (title, items, opts = {}) => ui.row(title, items.map((it) => ui.posterCard(it, cardOpts)), opts);

function fileCard(f) {
  const title = f.title || f.name.replace(/\.[^.]+$/, '');
  const c = ui.wideCard({ ...f, title, backdrop_path: null }, { onPick: () => playLocal(f), sub: f.playable ? '' : 'Plays in VLC', badge: (f.name.split('.').pop() || '').toUpperCase() });
  matchArt(f, c);
  return c;
}
// look up TMDB artwork for a local file name, a few at a time
const matchQ = []; let matching = 0;
function matchArt(f, card) {
  if (!cfg.hasKey) return;
  matchQ.push([f, card]); pump();
}
function pump() {
  while (matching < 3 && matchQ.length) {
    const [f, card] = matchQ.shift(); matching++;
    cached('match:' + f.name, () => api(`/api/media/match?name=${encodeURIComponent(f.name)}`), 24 * 3600e3)
      .then((m) => {
        if (!m || !card.isConnected) return;
        const art = card.querySelector('.art');
        if (m.backdrop_path) art.insertAdjacentHTML('afterbegin', `<img src="${esc(img(m.backdrop_path, 'w780'))}" style="position:absolute;inset:0;z-index:0" onload="this.classList.add('ok')" onerror="this.remove()">`);
        const fb = art.querySelector('.fallback'); if (fb && m.backdrop_path) fb.classList.add('bd-title'), (fb.style.zIndex = 1);
        const cap = card.querySelector('.cap'); if (cap) cap.firstChild.textContent = m.title;
        if (fb) fb.querySelector('b').textContent = m.title;
        itemOf.set(card, { ...m, type: 'file' });
      }).catch(() => {}).finally(() => { matching--; pump(); });
  }
}

// ======================================================================= folders
async function folderDialog(item) {
  if (!item) return;
  let folders;
  try { folders = (await api('/api/folders')).folders; } catch (e) { return ui.toast(e.message, 'info'); }
  const m = ui.modal(`<h2>Add to Folder</h2><p>${esc(item.title)}${item.year ? ` (${item.year})` : ''}</p><div class="list-scroll"><div class="inner list" data-group="col"></div></div><div class="actions" data-group="row"></div>`);
  const list = m.querySelector('.list');
  const has = (f) => f.items.some((x) => x.id === item.id && x.type === item.type);
  const render = (focusId) => {
    list.innerHTML = '';
    let focusEl = null;
    for (const f of folders) {
      const r = el(`<div class="setting f"><span>${icon('folder')} ${esc(f.name)}</span><span class="val">${has(f) ? `${icon('check')} Added` : `${f.items.length} title${f.items.length === 1 ? '' : 's'}`}</span></div>`);
      r.firstElementChild.style.cssText = 'display:flex;gap:.8rem;align-items:center';
      onSelect(r, async () => {
        try {
          if (has(f)) { await api(`/api/folders/${f.id}/items/${item.type}/${item.id}`, { method: 'DELETE' }); f.items = f.items.filter((x) => !(x.id === item.id && x.type === item.type)); ui.toast(`Removed from ${f.name}`, 'minus'); }
          else { await api(`/api/folders/${f.id}/items`, { method: 'POST', body: { item } }); f.items.push({ ...item }); ui.toast(`Added to ${f.name}`); }
          render(f.id);
        } catch (e) { ui.toast(e.message, 'info'); }
      });
      if (f.id === focusId) focusEl = r;
      list.appendChild(r);
    }
    const nw = onSelect(el(`<div class="setting f"><span style="display:flex;gap:.8rem;align-items:center">${icon('folderPlus')} New Folder…</span><span class="val">${icon('chevron')}</span></div>`), async () => {
      const name = await ui.promptDialog({ title: 'New Folder', text: `“${item.title}” will be added to it.`, placeholder: 'Folder name', ok: 'Create' });
      if (!name) return;
      try { const f = await api('/api/folders', { method: 'POST', body: { name, items: [item] } }); folders.push(f); ui.toast(`Created ${f.name}`); render(f.id); }
      catch (e) { ui.toast(e.message, 'info'); }
    });
    list.appendChild(nw);
    if (focusEl) nav.focus(focusEl);
    else if (focusId === undefined && !nav.focused()?.closest('.modal')) nav.focus(list.querySelector('.f'));
  };
  m.querySelector('.actions').appendChild(onSelect(el(`<div class="btn f glow">Done</div>`), () => m.close()));
  m.open();
  render();
  nav.focus(list.querySelector('.f'));
}

function folderTile(f) {
  const arts = f.items.filter((i) => i.poster_path).slice(0, 3);
  const stack = arts.length ? `<div class="stack">${arts.map((a) => `<img src="${esc(img(a.poster_path, 'w342'))}" style="width:100%;height:100%;object-fit:cover" loading="lazy">`).join('')}</div>` : ui.fallbackArt('', '');
  const c = el(`<div class="card wide folder-tile f"><div class="art">${stack}<div class="shade"></div><div class="label">${icon('folder')}<b>${esc(f.name)}</b><span>${f.items.length} title${f.items.length === 1 ? '' : 's'}</span></div><div class="sheen"></div></div></div>`);
  return onSelect(c, () => push(folderView(f.id)));
}

// ======================================================================= view: section (home/movies/tv)
function errorBox(e, retry) {
  const keyIssue = e.status === 401 || e.status === 412;
  const b = el(`<div class="error-box">${icon(keyIssue ? 'key' : 'wifi')}<h2>${keyIssue ? 'TMDB key needed' : 'Couldn’t load this'}</h2><p>${esc(e.message)}</p><div class="actions" data-group="row"></div></div>`);
  const a = b.querySelector('.actions');
  a.appendChild(onSelect(el(`<div class="btn primary f glow autofocus">Try Again</div>`), retry));
  a.appendChild(onSelect(el(`<div class="btn f glow">Settings</div>`), () => switchTab('settings', { focusContent: true })));
  return b;
}

function welcome() {
  const w = el(`<div class="welcome vblock"><h1>Welcome to Lumen</h1>
    <p>Film posters, descriptions and recommendations come from The Movie Database (TMDB). It needs a free API key, which takes about five minutes to get.</p>
    <div class="steps">
      <div class="step"><i>1</i><b>Make a free account</b><span>On any device, go to <code>themoviedb.org/signup</code> and verify your email.</span></div>
      <div class="step"><i>2</i><b>Request an API key</b><span>Open <code>themoviedb.org/settings/api</code>, choose <code>Create → Developer</code>, describe it as a personal TV interface.</span></div>
      <div class="step"><i>3</i><b>Paste it here</b><span>On this laptop open <code>localhost:${cfg.port || 8787}/setup</code>, or on your iPhone remote use the <code>Setup</code> tab.</span></div>
    </div><div class="actions" data-group="row"></div></div>`);
  const a = w.querySelector('.actions');
  a.appendChild(onSelect(el(`<div class="btn primary f glow autofocus">${icon('remote')}Pair iPhone Remote</div>`), openPairing));
  a.appendChild(onSelect(el(`<div class="btn f glow">${icon('keyboard')}Type Key with Remote</div>`), enterKeyDialog));
  a.appendChild(onSelect(el(`<div class="btn f glow">${icon('folder')}My Library</div>`), () => switchTab('library', { focusContent: true })));
  return w;
}

function sectionView(name, eyebrow) {
  const v = viewShell();
  let resolve; v.ready = new Promise((r) => (resolve = r));
  const s = v.scroller;
  if (!cfg.hasKey) { s.appendChild(welcome()); resolve(); return v; }
  s.append(el('<div class="pad-top"></div>'), ui.skeletonRows(3));
  const load = async () => {
    try {
      const data = await cached('section:' + name, () => api(`/api/section/${name}`), name === 'home' ? 3 * 60e3 : 10 * 60e3);
      s.innerHTML = '';
      if (data.hero?.length) {
        const h = ui.hero(data.hero, { eyebrow: data.heroEyebrow || eyebrow, greet: name === 'home' ? greeting() : '', onOpen: openDetail, onFolder: folderDialog, onSlide: (it) => setArt(img(it.backdrop_path, 'w300')) });
        v.hero = h; s.appendChild(h);
      } else s.appendChild(el('<div class="pad-top"></div>'));
      const rows = el('<div class="rows"></div>');
      if (name === 'free') rows.appendChild(servicesRow(data.services || []));
      const picks = name === 'home' ? await libraryPicks() : [];
      if (name === 'home') { const cw = await watchingList(); if (cw.length) rows.appendChild(continueRow(cw)); }
      const picksAt = data.rows[0]?.title === 'Recently Viewed' ? 1 : 0; // straight after Recently Viewed
      data.rows.forEach((r, i) => {
        if (picks.length >= 4 && i === picksAt) rows.appendChild(posterRow(cfg.userName ? `Picked for ${cfg.userName} from Your Library` : 'Picked from Your Library', picks));
        if (r.local) rows.appendChild(ui.row(r.title, r.items.map(fileCard)));
        else rows.appendChild(posterRow(r.title, r.items, { sub: r.service ? 'Free' : '' }));
      });
      if (!data.rows.length && name !== 'free') rows.appendChild(el(`<div class="empty"><b>Nothing here yet</b>TMDB returned no titles for this section.</div>`));
      if (name === 'free' && !data.rows.length) rows.appendChild(el(`<div class="empty vblock"><b>No free titles found</b>TMDB has no free listings for your enabled services in ${esc(cfg.region)} right now. The service buttons above still open each app.</div>`));
      s.appendChild(rows);
    } catch (e) {
      s.innerHTML = '';
      s.appendChild(errorBox(e, () => { invalidate('section:' + name); s.innerHTML = ''; s.append(el('<div class="pad-top"></div>'), ui.skeletonRows(3)); load().then(() => nav.focus(nav.firstIn(v))); }));
    }
    resolve();
  };
  load();
  return v;
}

function servicesRow(services) {
  const cards = services.map((sv) => {
    const logo = sv.logo ? `<img class="slogo" src="${esc(img(sv.logo, 'w154'))}" alt="" onerror="this.remove()">` : icon('tv');
    return onSelect(el(`<div class="card tile service f"><div class="art">${logo}<span class="sname">${esc(sv.name)}</span><div class="sheen"></div></div></div>`), () => openService(sv.key, null, sv.name));
  });
  for (const sc of cfg.shortcuts || []) cards.push(onSelect(el(`<div class="card tile service f"><div class="art">${icon('globe')}<span class="sname">${esc(sc.name)}</span><div class="sheen"></div></div></div>`), () => openShortcut(sc)));
  cards.push(onSelect(el(`<div class="card tile action f"><div class="art">${icon('plus')}<span class="sname">Add a Website</span><div class="sheen"></div></div></div>`), addWebsite));
  return ui.row('Apps', cards, { sub: 'Opens full screen — press Home on the remote to come back' });
}

async function addWebsite() {
  const url = await ui.promptDialog({ title: 'Add a Website', text: 'Type the web address. Tip: it’s much faster to type on your iPhone remote’s Keyboard tab.', placeholder: 'example.com', ok: 'Next', mono: true });
  if (!url) return;
  const name = await ui.promptDialog({ title: 'Name This Tile', placeholder: 'Name', value: url.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/.]/)[0].replace(/^./, (c) => c.toUpperCase()), ok: 'Add' });
  if (!name) return;
  try { await api('/api/shortcuts', { method: 'POST', body: { url, name } }); await loadConfig(); ui.toast(`Added ${name}`); refreshCurrent(); }
  catch (e) { ui.toast(e.message, 'info'); }
}

// ======================================================================= view: detail
function detailView(item) {
  const v = viewShell('detail');
  v.dataset.anchor = '24';
  let resolve; v.ready = new Promise((r) => (resolve = r));
  const bd = el('<div class="bdrop"></div>');
  v.prepend(bd);
  const setBd = (p) => { if (!p) return; const i = new Image(); i.onload = () => { bd.style.backgroundImage = `url("${img(p, 'w1280')}")`; bd.classList.add('on'); }; i.src = img(p, 'w1280'); };
  setBd(item.backdrop_path);
  const s = v.scroller;
  s.appendChild(el(`<div class="top" data-top="1"><h1>${esc(item.title)}</h1><div class="spinner" style="margin-top:2rem"></div></div>`));
  if (item.type === 'movie' || item.type === 'tv') api('/api/recent', { method: 'POST', body: { item } }).then(() => invalidate('section:home')).catch(() => {});
  (async () => {
    let d;
    try { d = await cached(`d:${item.type}:${item.id}`, () => api(`/api/details/${item.type}/${item.id}`), 30 * 60e3); }
    catch (e) { s.innerHTML = ''; s.appendChild(errorBox(e, () => { pop(); openDetail(item); })); resolve(); return; }
    if (!item.backdrop_path) setBd(d.backdrop_path);
    const light = { id: d.id, type: d.type, title: d.title, year: d.year, poster_path: d.poster_path, backdrop_path: d.backdrop_path, overview: d.overview, vote_average: d.vote_average };
    const folders = await api('/api/folders').then((r) => r.folders).catch(() => []);
    const inF = folders.filter((f) => f.items.some((x) => x.id === d.id && x.type === d.type)).map((f) => f.name);
    const top = el(`<div class="top" data-top="1">
      ${d.logo_path ? `<img class="logo" src="${esc(img(d.logo_path, 'w500'))}" alt="${esc(d.title)}" onerror="this.outerHTML='<h1>${esc(d.title).replace(/'/g, '&#39;')}</h1>'">` : `<h1>${esc(d.title)}</h1>`}
      ${ui.metaLine(d)}
      ${d.tagline ? `<p class="tagline">${esc(d.tagline)}</p>` : ''}
      <p class="overview">${esc(d.overview || 'No description available.')}</p>
      <div class="actions" data-group="row"></div>
      <div class="avail"></div>
      ${inF.length ? `<div class="in-folders">${icon('folder')}In ${inF.map(esc).join(', ')}</div>` : ''}
    </div>`);
    const acts = top.querySelector('.actions');
    const resume = (await watchingList()).find((w) => w.id === d.id && w.type === d.type);
    // one Watch button per Watch website; the first (or the one you were watching on) is the big one
    const links = watchLinks(), rl = resume ? findLink(resume.linkId) : null;
    // the site you used last time for this film comes first
    const last = links.length > 1 && !rl ? await api(`/api/film-site?type=${d.type}&id=${d.id}`).then((r) => links.find((w) => w.id === r.linkId)).catch(() => null) : null;
    const main = rl || last || links[0] || null;
    acts.appendChild(onSelect(el(`<div class="btn primary autofocus f glow">${icon('play')}${resume && rl ? `Resume${links.length > 1 ? ` on ${esc(linkName(rl))}` : ''} · ${esc(fmtLeft(resume))}` : esc(watchLabel(main))}</div>`), () => openWatch(d.title, d.year, d, main?.id)));
    for (const w of links) if (w !== main) acts.appendChild(onSelect(el(`<div class="btn f glow">${icon('play')}${esc(watchLabel(w))}</div>`), () => openWatch(d.title, d.year, d, w.id)));
    // a page you saved yourself for this film (after "not found") — offer to forget it
    api(`/api/watch-saved?type=${d.type}&id=${d.id}&title=${encodeURIComponent(d.title)}`).then(({ saved }) => {
      if (!saved?.length) return;
      acts.appendChild(onSelect(el(`<div class="btn f glow">${icon('link')}Forget Saved Page</div>`), async () => {
        const ok = await ui.confirmDialog({ title: 'Forget the page you saved?', text: `Watch will go back to the usual address for ${d.title}.`, ok: 'Forget It' });
        if (!ok) return;
        for (const id of saved) await api('/api/watch-saved', { method: 'POST', body: { linkId: id, item: { type: d.type, id: d.id }, title: d.title, url: null } }).catch(() => {});
        ui.toast('Saved page forgotten', 'check');
      }));
    }).catch(() => {});
    d.providers.free.slice(0, 2).forEach((p, i) => acts.appendChild(onSelect(el(`<div class="btn f glow">${p.logo_path ? `<img class="plogo" src="${esc(img(p.logo_path, 'w92'))}" alt="">` : icon('play')}Watch on ${esc(p.name)}</div>`), () => openService(p.service, d.title, p.name))));
    if (d.trailer) acts.appendChild(onSelect(el(`<div class="btn f glow">${icon('play')}Trailer</div>`), () => { player.playTrailer(d.trailer.key, d.title, { onExit: sendState, onExternal: () => api('/api/open', { method: 'POST', body: { youtubeVideo: d.trailer.key } }) }); sendState(); }));
    acts.appendChild(onSelect(el(`<div class="btn f glow">${icon('folderPlus')}Add to Folder</div>`), async () => { await folderDialog(light); }));
    if (d.youtubeSearch && !d.providers.free.some((p) => p.service === 'youtube')) acts.appendChild(onSelect(el(`<div class="btn f glow">${icon('search')}Search YouTube</div>`), () => openService('youtube', `${d.title} ${d.year || ''} full ${d.type === 'movie' ? 'movie' : 'episodes'}`, 'YouTube')));
    const av = top.querySelector('.avail');
    if (d.providers.free.length) av.appendChild(el(`<div class="line"><span class="lbl">Free on</span>${d.providers.free.map((p) => `${p.logo_path ? `<img src="${esc(img(p.logo_path, 'w92'))}" alt="">` : ''}<span>${esc(p.name)}</span>`).join('')}</div>`));
    else av.appendChild(el(`<div class="line"><span class="lbl">Free on</span><span class="muted">Not on your free services in ${esc(cfg.region)} right now${d.trailer ? ' — the trailer is available' : ''}</span></div>`));
    if (d.providers.paid.length) av.appendChild(el(`<div class="line"><span class="lbl">Paid only</span><span class="muted">${d.providers.paid.map(esc).join(' · ')}</span></div>`));
    av.appendChild(el(`<div class="line"><span class="muted" style="font-size:.95rem">Availability from TMDB/JustWatch for ${esc(cfg.region)}. Artwork and details: TMDB.</span></div>`));
    s.innerHTML = '';
    s.appendChild(top);
    const rows = el('<div class="rows"></div>');
    if (d.type === 'tv' && d.seasons.length) {
      rows.appendChild(ui.row('Seasons', d.seasons.map((se) => {
        const c = ui.posterCard({ id: se.season_number, type: 'season', title: se.name, year: se.air_date ? +se.air_date.slice(0, 4) : null, poster_path: se.poster_path || d.poster_path }, { capAlways: true });
        return onSelect(c, () => push(seasonView(d, se)));
      })));
    }
    if (d.collection) {
      const crow = ui.row(d.collection.name, [], { sub: 'Collection' });
      rows.appendChild(crow);
      api(`/api/collection/${d.collection.id}`).then((col) => {
        const track = crow.querySelector('.track');
        col.items.forEach((it) => track.appendChild(ui.posterCard(it, { ...cardOpts, capAlways: true })));
        track.appendChild(onSelect(el(`<div class="card poster action f" style="display:grid;place-items:center"><div class="art" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:rgba(40,40,44,.7);border:1px solid var(--line)">${icon('folderPlus')}<span style="font-size:1.2rem;font-weight:600;text-align:center;padding:0 1rem">Save as Folder</span></div></div>`), async () => {
          const name = col.name.replace(/\s*Collection$/i, '');
          try { await api('/api/folders', { method: 'POST', body: { name, items: col.items } }); ui.toast(`Created folder “${name}”`); invalidate('lib'); }
          catch (e) { ui.toast(e.message, 'info'); }
        }));
      }).catch(() => crow.remove());
    }
    if (d.cast.length) rows.appendChild(ui.row('Cast', d.cast.map((c) => {
      const card = el(`<div class="card person f cap-always"><div class="art">${ui.artImg(img(c.profile_path, 'w185'), c.name.split(' ').map((w) => w[0]).join(''), '')}<div class="sheen"></div></div><div class="cap">${esc(c.name)}<small>${esc(c.character)}</small></div></div>`);
      return card;
    })));
    if (d.recommendations.length) rows.appendChild(posterRow('More Like This', d.recommendations));
    s.appendChild(rows);
    resolve();
  })();
  return v;
}

function seasonView(show, se) {
  const v = viewShell('detail');
  v.dataset.anchor = '22';
  let resolve; v.ready = new Promise((r) => (resolve = r));
  const bd = el('<div class="bdrop on"></div>');
  if (show.backdrop_path) bd.style.backgroundImage = `url("${img(show.backdrop_path, 'w1280')}")`;
  v.prepend(bd);
  const s = v.scroller;
  s.appendChild(el(`<div class="page-head vblock" style="padding-top:8rem"><div><div class="crumbs">${esc(show.title)}</div><h1>${esc(se.name)}</h1><p>${se.episode_count} episodes</p></div></div>`));
  (async () => {
    try {
      const data = await api(`/api/season/${show.id}/${se.season_number}`);
      const watch = show.providers.free[0];
      const list = el('<div class="episodes" data-group="col"></div>');
      for (const ep of data.episodes) {
        const e = el(`<div class="episode f"><div class="still">${ui.artImg(img(ep.still_path, 'w300'), `Episode ${ep.episode_number}`, '')}</div><div><h3><small>${ep.episode_number}</small>${esc(ep.name)}</h3><p>${esc(ep.overview || '')}</p></div></div>`);
        e.querySelector('img')?.classList.add('ok');
        onSelect(e, () => (watch ? openService(watch.service, show.title, watch.name) : ui.toast('Not on your free services', 'info')));
        list.appendChild(e);
      }
      s.appendChild(list);
      if (watch) s.appendChild(el(`<p class="vblock" style="padding:2rem var(--side);color:var(--ink-3);font-size:1.15rem">Selecting an episode opens ${esc(watch.name)} at ${esc(show.title)}.</p>`));
    } catch (e) { s.appendChild(errorBox(e, () => { pop(); push(seasonView(show, se)); })); }
    resolve();
  })();
  return v;
}

// ======================================================================= view: search
function searchView() {
  const v = viewShell();
  v.dataset.anchor = '14';
  const s = v.scroller;
  let resolve; v.ready = new Promise((r) => (resolve = r));
  s.appendChild(el('<div class="pad-top"></div>'));
  if (!cfg.hasKey) { s.appendChild(welcome()); resolve(); return v; }
  const top = el('<div class="search-top" data-top="1"></div>');
  const results = el('<div class="grid-wrap vblock"></div>');
  let t, lastQ = '';
  const run = async (q) => {
    lastQ = q;
    if (!q.trim()) { results.innerHTML = `<div class="empty"><b>Search films and TV</b>Use the keyboard above, or type on your iPhone remote.</div>`; return; }
    try {
      const { results: rs } = await cached('search:' + q.toLowerCase(), () => api(`/api/search?q=${encodeURIComponent(q)}`), 10 * 60e3);
      if (q !== lastQ) return;
      results.innerHTML = '';
      if (!rs.length) { results.innerHTML = `<div class="empty"><b>No results for “${esc(q)}”</b>Try a shorter title.</div>`; return; }
      const g = el('<div class="grid" data-group="grid"></div>');
      rs.slice(0, 42).forEach((it) => g.appendChild(ui.posterCard(it, { ...cardOpts, capAlways: true })));
      results.appendChild(g);
    } catch (e) { results.innerHTML = `<div class="empty"><b>Search failed</b>${esc(e.message)}</div>`; }
  };
  const k = ui.keyboard({ placeholder: 'Search films and TV shows', onChange: (q) => { clearTimeout(t); t = setTimeout(() => run(q), 350); }, onSubmit: (q) => { clearTimeout(t); run(q).then(() => { const f = results.querySelector('.f'); if (f) nav.focus(f); }); }, submitLabel: 'Search' });
  top.appendChild(k);
  ui.textTarget.current = k;
  s.append(top, results);
  run('');
  v.onReturn = () => { ui.textTarget.current = k; };
  resolve();
  return v;
}

// ======================================================================= view: library & folders
function libraryView() {
  const v = viewShell();
  let resolve; v.ready = new Promise((r) => (resolve = r));
  const s = v.scroller;
  let seq = 0;
  const render = async (keep) => {
    const my = ++seq;
    const path = keep ? focusPath(v) : null;
    const [{ folders }, { items: recent }, media] = await Promise.all([
      api('/api/folders'), api('/api/recent'), api('/api/media/roots').catch(() => ({ roots: [] })),
    ]).catch((e) => { s.innerHTML = ''; s.appendChild(errorBox(e, () => render())); return [{ folders: [] }, { items: [] }, { roots: [] }]; });
    const recentFiles = await api('/api/media/recent').then((r) => r.items).catch(() => []);
    if (my !== seq) return;
    s.innerHTML = '';
    s.appendChild(el(`<div class="page-head vblock" style="padding-top:10rem"><div><h1>My Library</h1><p>Your folders, history and the videos on this laptop and its drives.</p></div></div>`));
    const rows = el('<div class="rows"></div>');
    const fcards = folders.map(folderTile);
    fcards.push(onSelect(el(`<div class="card wide f action tile" style="width:24rem;height:13.5rem"><div class="art">${icon('folderPlus')}<span class="sname">New Folder</span><div class="sheen"></div></div></div>`), async () => {
      const name = await ui.promptDialog({ title: 'New Folder', placeholder: 'Folder name', ok: 'Create' });
      if (!name) return;
      try { const f = await api('/api/folders', { method: 'POST', body: { name } }); ui.toast(`Created ${f.name}`); push(folderView(f.id)); }
      catch (e) { ui.toast(e.message, 'info'); }
    }));
    rows.appendChild(ui.row('Folders', fcards, { sub: `${folders.length}` }));
    if (recent.length) rows.appendChild(posterRow('Recently Viewed', recent));
    const places = (media.roots || []).map((r) => onSelect(el(`<div class="card tile action f"><div class="art">${icon(r.kind === 'disk' ? 'laptop' : r.kind === 'drive' ? 'drive' : r.kind === 'pinned' ? 'star' : 'folder')}<span class="sname">${esc(r.name)}</span><div class="sheen"></div></div></div>`), () => push(browseView(r.path, r.name))));
    if (places.length) rows.appendChild(ui.row('Videos on This Computer', places, { sub: 'Laptop, USB and external drives' }));
    if (recentFiles.length) rows.appendChild(ui.row('Recently Added Videos', recentFiles.slice(0, 20).map(fileCard)));
    s.appendChild(rows);
    if (path) restoreFocus(v, path);
    resolve();
  };
  render();
  v.onReturn = () => render(true);
  v.refresh = () => render(true);
  return v;
}

function folderView(id) {
  const v = viewShell();
  v.dataset.anchor = '20';
  let resolve; v.ready = new Promise((r) => (resolve = r));
  const s = v.scroller;
  let editing = false, f, seq = 0;
  const render = async (keep) => {
    const my = ++seq;
    const path = keep ? focusPath(v) : null;
    try { f = await api(`/api/folders/${id}`); } catch (e) { if (e.status === 404) { if (currentView() === v) pop(); return; } s.innerHTML = ''; s.appendChild(errorBox(e, () => render())); resolve(); return; }
    if (my !== seq) return;
    s.innerHTML = '';
    const head = el(`<div class="page-head vblock" data-top="1" style="padding-top:8rem"><div><div class="crumbs">My Library · Folder</div><h1>${esc(f.name)}</h1><p>${f.items.length} title${f.items.length === 1 ? '' : 's'}${editing ? ' — select a title to remove it' : ''}</p></div><div class="actions" data-group="row"></div></div>`);
    const a = head.querySelector('.actions');
    if (f.items.length) a.appendChild(onSelect(el(`<div class="btn f glow ${editing ? 'primary' : ''}">${icon(editing ? 'check' : 'edit')}${editing ? 'Done' : 'Remove Titles'}</div>`), () => { editing = !editing; render(true); }));
    a.appendChild(onSelect(el(`<div class="btn f glow">${icon('edit')}Rename</div>`), async () => {
      const name = await ui.promptDialog({ title: 'Rename Folder', value: f.name, ok: 'Rename' });
      if (!name) return;
      try { await api(`/api/folders/${id}`, { method: 'PATCH', body: { name } }); ui.toast('Renamed'); render(true); } catch (e) { ui.toast(e.message, 'info'); }
    }));
    a.appendChild(onSelect(el(`<div class="btn danger f glow">${icon('trash')}Delete Folder</div>`), async () => {
      const ok = await ui.confirmDialog({ title: `Delete “${f.name}”?`, text: 'The folder is removed. The films themselves stay in the catalogue, and you can make the folder again any time.', ok: 'Delete', danger: true });
      if (!ok) return;
      try { await api(`/api/folders/${id}`, { method: 'DELETE' }); ui.toast(`Deleted ${f.name}`, 'trash'); pop(); } catch (e) { ui.toast(e.message, 'info'); }
    }));
    s.appendChild(head);
    const wrap = el(`<div class="grid-wrap ${editing ? 'editing' : ''}"></div>`);
    if (!f.items.length) wrap.appendChild(el(`<div class="empty"><b>This folder is empty</b>Open any film or show and choose <b style="display:inline;font-size:inherit">Add to Folder</b>.</div>`));
    else {
      const g = el('<div class="grid" data-group="grid"></div>');
      for (const it of f.items) {
        const c = ui.posterCard(it, { capAlways: true });
        onSelect(c, async () => {
          if (!editing) return openDetail(it);
          try {
            await api(`/api/folders/${id}/items/${it.type}/${it.id}`, { method: 'DELETE' });
            c.style.transition = 'opacity .3s, transform .3s'; c.style.opacity = '0'; c.style.transform = 'scale(.9)';
            ui.toast(`Removed ${it.title}`, 'minus');
            setTimeout(() => render(true), 300);
          } catch (e) { ui.toast(e.message, 'info'); }
        });
        g.appendChild(c);
      }
      wrap.appendChild(g);
    }
    s.appendChild(wrap);
    if (path) restoreFocus(v, path);
    resolve();
  };
  render();
  v.onReturn = () => render(true);
  v.refresh = () => render(true);
  return v;
}

function browseView(dir, label) {
  const v = viewShell();
  v.dataset.anchor = '20';
  let resolve; v.ready = new Promise((r) => (resolve = r));
  const s = v.scroller;
  (async () => {
    let data, roots;
    try { [data, roots] = await Promise.all([api(`/api/media/list?path=${encodeURIComponent(dir)}`), api('/api/media/roots')]); }
    catch (e) { s.appendChild(errorBox(e, () => { pop(); push(browseView(dir, label)); })); resolve(); return; }
    const pinned = roots.pinned.includes(data.path);
    const head = el(`<div class="page-head vblock" data-top="1" style="padding-top:8rem"><div><div class="crumbs">${esc(data.path)}</div><h1>${esc(label || data.path.split(/[\\/]/).filter(Boolean).pop() || data.path)}</h1><p>${data.entries.filter((e) => e.kind === 'dir').length} folders · ${data.entries.filter((e) => e.kind === 'video').length} videos</p></div><div class="actions" data-group="row"></div></div>`);
    const a = head.querySelector('.actions');
    const pin = onSelect(el(`<div class="btn f glow">${icon(pinned ? 'minus' : 'star')}<span>${pinned ? 'Remove from Library' : 'Add to Library'}</span></div>`), async () => {
      const now = pin.dataset.p === '1';
      await api(now ? '/api/media/unpin' : '/api/media/pin', { method: 'POST', body: { path: data.path } });
      pin.dataset.p = now ? '0' : '1';
      pin.innerHTML = `${icon(now ? 'star' : 'minus')}<span>${now ? 'Add to Library' : 'Remove from Library'}</span>`;
      ui.toast(now ? 'Removed from My Library' : 'Added to My Library — new videos here show in Recently Added');
    });
    pin.dataset.p = pinned ? '1' : '0';
    a.appendChild(pin);
    s.appendChild(head);
    const wrap = el('<div class="grid-wrap"></div>');
    if (!data.entries.length) wrap.appendChild(el(`<div class="empty"><b>No videos or folders here</b>Lumen shows folders and video files (MP4, MKV, WebM, MOV, AVI…).</div>`));
    else {
      const g = el('<div class="grid wide-grid" data-group="grid"></div>');
      for (const e of data.entries.slice(0, 400)) {
        if (e.kind === 'dir') g.appendChild(onSelect(el(`<div class="card wide f cap-always"><div class="art" style="display:grid;place-items:center;background:rgba(40,40,44,.6);border:1px solid var(--line)">${icon('folder')}<div class="sheen"></div></div><div class="cap">${esc(e.name)}</div></div>`), () => push(browseView(e.path, e.name))));
        else g.appendChild(fileCard(e));
      }
      g.querySelectorAll('.art > .ic').forEach((i) => (i.style.cssText = 'width:3rem;height:3rem;color:var(--ink-3)'));
      wrap.appendChild(g);
    }
    s.appendChild(wrap);
    resolve();
  })();
  return v;
}

// ======================================================================= view: settings
function settingsView() {
  const v = viewShell();
  v.dataset.anchor = '34';
  let resolve; v.ready = new Promise((r) => (resolve = r));
  const s = v.scroller;
  let seq = 0;
  const render = async (keep) => {
    const my = ++seq;
    const path = keep ? focusPath(v) : null;
    await loadConfig();
    const [devs, bgs, roots] = await Promise.all([api('/api/devices').catch(() => ({ devices: [] })), api('/api/backgrounds').catch(() => ({ backgrounds: [] })), api('/api/media/roots').catch(() => ({ pinned: [] }))]);
    if (my !== seq) return;
    app.backgrounds = bgs.backgrounds;
    s.innerHTML = '';
    const box = el(`<div class="settings vblock"><div class="page-head" style="padding:10rem 0 0 1.6rem"><div><h1>Settings</h1></div></div></div>`);
    const list = el('<div data-group="col"></div>');
    const sec = (t) => list.appendChild(el(`<h3>${esc(t)}</h3>`));
    const item = (label, value, fn, sub = '') => {
      const r = el(`<div class="setting f"><span>${esc(label)}${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</span><span class="val">${value}</span></div>`);
      if (fn) onSelect(r, async () => { await fn(); render(true); });
      list.appendChild(r); return r;
    };
    const tog = (on) => `<span class="toggle ${on ? 'on' : ''}"></span>`;
    const save = (body) => api('/api/settings', { method: 'POST', body }).then(() => invalidate('section:')).catch((e) => ui.toast(e.message, 'info'));

    sec('Personal');
    item('Your Name', esc(cfg.userName || 'Not set'), async () => {
      const n = await ui.promptDialog({ allowEmpty: true, title: 'Your Name', text: 'Lumen greets you on Home and picks films for you by name.', value: cfg.userName || '', placeholder: 'Name', ok: 'Save' });
      if (n !== null && n !== undefined) await save({ userName: n });
    }, 'Used for the greeting on Home');
    const keys = Object.keys(ACCENTS);
    item('Colour', `<span class="swatch"></span>${esc(accentName(cfg.accent))}`, async () => {
      const next = keys[(keys.indexOf(cfg.accent) + 1) % keys.length]; // a custom colour moves on to the first preset
      cfg.accent = next; applyPersonal(); await save({ accent: next });
    }, 'Press to try the next: Moonlight, Amber, Rose, Mint, Sky, Lilac, Red, Scarlet, Crimson, Cherry, Coral');
    item('Fonts', esc(fontName(cfg.font)), fontDialog, 'The look of titles across Lumen, with a preview of Home');
    item('Custom Colour', esc(/^#/.test(cfg.accent || '') ? cfg.accent.toUpperCase() : 'Hex code'), async () => {
      let v = await ui.promptDialog({ title: 'Custom Colour', text: 'Type a hex colour code, e.g. #B3001B for a deep red. Easier: the colour wheel on your phone’s Setup tab.', value: /^#/.test(cfg.accent || '') ? cfg.accent : '#', placeholder: '#B3001B', ok: 'Use Colour', mono: true });
      if (!v) return;
      v = '#' + v.replace(/[^0-9a-f]/gi, '').slice(0, 6);
      if (v.length === 4) v = '#' + [...v.slice(1)].map((c) => c + c).join(''); // #F03 → #FF0033
      if (!/^#[0-9a-f]{6}$/i.test(v)) return ui.toast('That isn’t a hex colour — try something like #B3001B', 'info');
      cfg.accent = v.toLowerCase(); applyPersonal(); await save({ accent: cfg.accent });
    }, 'Any colour you like, as a hex code');
    const snd = { on: true, style: 'soft', volume: 0.6, ...(cfg.sound || {}) };
    const setSound = async (patch) => { Object.assign(snd, patch); cfg.sound = { ...snd }; sound.configure(snd); await save({ sound: patch }); };
    const intro = { anim: true, sound: true, ...(cfg.intro || {}) };
    item('Start-up Animation', tog(intro.anim), () => save({ intro: { anim: !intro.anim } }), 'The LumenTV logo when Lumen opens');
    item('Start-up Sound', tog(intro.sound), () => save({ intro: { sound: !intro.sound } }), 'Plays with the start-up animation');
    item('Play Start-up Now', icon('play'), async () => { await playIntro(); }, 'See and hear it again');
    item('Sounds', tog(snd.on), () => setSound({ on: !snd.on }), 'Little sounds as you move and select');
    if (snd.on) {
      const styles = Object.keys(sound.STYLE_NAMES);
      item('Sound Style', esc(sound.STYLE_NAMES[snd.style] || 'Soft'), async () => { await setSound({ style: styles[(styles.indexOf(snd.style) + 1) % styles.length] }); sound.play('select'); }, 'Soft · Crisp · Glass · Arcade · Marimba · Cosmic · Bubble — each press plays the next');
      const vols = [0.25, 0.45, 0.6, 0.8, 1];
      const vi = Math.max(0, vols.findIndex((v) => Math.abs(v - snd.volume) < 0.01));
      item('Sound Volume', `<span class="vol-dots">${vols.map((_, i) => `<i class="${i <= vi ? 'on' : ''}" style="height:${0.6 + i * 0.25}rem"></i>`).join('')}</span>`, async () => { await setSound({ volume: vols[(vi + 1) % vols.length] }); sound.play('select'); }, 'Only Lumen’s sounds — the TV volume is separate');
    }

    sec('Display');
    const br = { level: 100, hw: false, ...(cfg.brightness || {}) };
    item('Brightness', brightVal(br.level), brightnessDialog, 'Any level from 1 to 100 — also on your phone’s Remote tab').dataset.setting = 'brightness';
    // the big banner at the top of Home: films picked for you (a fresh mix each time), or one of your folders
    item('Home Banner', cfg.homeBannerName ? `Folder: ${esc(cfg.homeBannerName)}` : 'Recommended Films', async () => {
      const folders = await api('/api/folders').then((r) => r.folders.filter((f) => f.items.length)).catch(() => []);
      const opts = [{ source: 'recommended', folderId: null }, ...folders.map((f) => ({ source: 'folder', folderId: f.id }))];
      const cur = opts.findIndex((o) => o.source === (cfg.homeBanner?.source || 'recommended') && (o.source !== 'folder' || o.folderId === cfg.homeBanner.folderId));
      await save({ homeBanner: opts[(Math.max(0, cur) + 1) % opts.length] });
      invalidate('section:home');
    }, 'Press to switch between films picked for you (a fresh mix each time) and each of your folders');
    item('Also Use the TV’s Own Backlight', tog(br.hw), () => save({ brightness: { hw: !br.hw } }), 'Only some TVs allow this over HDMI. Lumen’s own dimming always works');

    sec('General');
    item('Sleep Timer', esc(sleepLabel()), sleepDialog, 'Fades the sound out, stops what’s playing and turns the screen off. Also on your phone’s Now Playing');
    item('TV Name', esc(cfg.deviceName), async () => { const n = await ui.promptDialog({ title: 'TV Name', value: cfg.deviceName }); if (n) await save({ deviceName: n }); }, 'Shown on your iPhone remote');
    item('TMDB API Key', cfg.mock ? 'Demo data' : cfg.keyHint ? esc(cfg.keyHint) : 'Not set', enterKeyDialog, 'Easiest to paste on your phone (Setup tab) or at localhost:' + cfg.port + '/setup');
    const regions = ['GB', 'IE', 'US', 'CA', 'AU'];
    item('Region', esc(cfg.region), async () => { await save({ region: regions[(regions.indexOf(cfg.region) + 1) % regions.length] }); }, 'Controls which free services and age ratings are shown');
    item('Show Clock', tog(cfg.showClock), () => save({ showClock: !cfg.showClock }));
    item('Reduce Motion', tog(cfg.reduceMotion), () => save({ reduceMotion: !cfg.reduceMotion }));
    item('Screensaver', tog(cfg.screensaver !== false), () => save({ screensaver: cfg.screensaver === false }), 'After 10 minutes with nothing happening, film artwork drifts across the screen with the time');

    sec('Background');
    const modes = [['artwork', 'Film Artwork'], ['custom', 'My Picture'], ['graphite', 'Graphite'], ['black', 'Black']];
    const cur = modes.find((m) => m[0] === cfg.background.mode) || modes[0];
    item('Style', esc(cur[1]), async () => {
      let next = modes[(modes.indexOf(cur) + 1) % modes.length];
      if (next[0] === 'custom' && !app.backgrounds.length) next = modes[2];
      await save({ background: { mode: next[0], image: next[0] === 'custom' ? cfg.background.image || app.backgrounds[0]?.id : cfg.background.image } });
    }, 'Film Artwork follows whatever you highlight');
    for (const bg of app.backgrounds) {
      const active = cfg.background.mode === 'custom' && cfg.background.image === bg.id;
      item(bg.name || 'Picture', active ? `${icon('check')} In use` : 'Use', async () => {
        const choice = await choose(bg.name || 'Picture', [['use', 'Use as Background'], ['delete', 'Delete Picture']]);
        if (choice === 'use') await save({ background: { mode: 'custom', image: bg.id } });
        if (choice === 'delete') { await api(`/api/backgrounds/${bg.id}`, { method: 'DELETE' }); ui.toast('Picture deleted', 'trash'); }
      });
    }
    item('Add a Picture', icon('image'), async () => ui.confirmDialog({ title: 'Add a background picture', text: `On your iPhone remote, open the Backgrounds tab and choose a photo. Or on this laptop, open localhost:${cfg.port}/setup and upload one. It appears here straight away.`, ok: 'OK', cancel: 'Close' }), 'Upload from your iPhone or this laptop');

    sec('Free Services');
    for (const [k, name] of Object.entries(cfg.serviceNames || {})) item(name, tog(cfg.services[k]), () => save({ services: { [k]: !cfg.services[k] } }));
    item('Open Websites In', cfg.webBrowserInUse === 'brave' ? 'Brave' : 'Microsoft Edge', async () => {
      if (cfg.webBrowserInUse !== 'brave' && !cfg.system?.brave) return ui.toast('Brave isn’t installed on this computer', 'info');
      await save({ webBrowser: cfg.webBrowserInUse === 'brave' ? 'edge' : 'brave' });
    }, 'Every website and the Watch button use this one browser, so you only sign in once. Switching browser means signing in again');

    sec('Watch Buttons');
    for (const w of watchLinks()) item(`Watch on ${esc(linkName(w))}`, esc(w.pattern.replace(/^https?:\/\//, '').slice(0, 40)), () => editWatchLink(w),
      `e.g. The Dark Knight opens ${esc(watchUrl(w.pattern, 'The Dark Knight', 2008).replace(/^https?:\/\//, ''))}`);
    item('Add a Watch Website', icon('plus'), addWatchLink, watchLinks().length ? 'Every film gets a “Watch on …” button for each website' : 'Every film gets a Watch button that opens this website + the film’s name. None set: no Watch button');
    item('Press Play & Full Screen', tog(cfg.autoPlay !== false), () => save({ autoPlay: cfg.autoPlay === false }), 'Starts the film by itself and fills the screen, behind a loading screen');
    item('Software Video Decoding', tog(cfg.softwareDecode === true), () => save({ softwareDecode: cfg.softwareDecode !== true }), 'Only if skipping still turns the picture black. If a film then has sound but no picture, Lumen turns this off and reopens it');
    item('Block Pop-ups & Redirects', tog(cfg.blockPopups !== false), () => save({ blockPopups: cfg.blockPopups === false }), 'Stops ads opening new windows or taking over the page');
    item('Add an Ad-blocker Extension', icon('plus'), async () => {
      const ok = await ui.confirmDialog({ title: 'Add an ad blocker', text: 'Lumen’s own Brave opens in a normal window on its extension store. Install the same ad blocker you use in your own Brave (use the phone’s Trackpad and Keyboard tabs), then press Home on the remote. It stays installed for everything Lumen opens.', ok: 'Open Brave', cancel: 'Not now' });
      if (ok) api('/api/open', { method: 'POST', body: { adblockSetup: true } }).catch((e) => ui.toast(e.message, 'info'));
    }, 'Lumen’s Brave is separate from your own, so extensions need adding once');
    sec('Website Tiles');
    for (const sc of cfg.shortcuts || []) item(sc.name, esc(sc.url.replace(/^https?:\/\//, '').slice(0, 40)), async () => {
      const ok = await ui.confirmDialog({ title: `Remove “${sc.name}”?`, text: 'The tile is removed from Free to Watch.', ok: 'Remove', danger: true });
      if (ok) await api(`/api/shortcuts/${sc.id}`, { method: 'DELETE' });
    });
    item('Add a Website', icon('plus'), addWebsite, 'Shown as a tile in Free to Watch');

    sec('iPhone Remotes');
    for (const d of devs.devices) item(d.name, `Last used ${ago(d.lastSeen)}`, async () => {
      const ok = await ui.confirmDialog({ title: `Unpair ${d.name}?`, text: 'It will need to scan the code again to control this TV.', ok: 'Unpair', danger: true });
      if (ok) await api(`/api/devices/${d.id}`, { method: 'DELETE' });
    });
    item('Pair a Remote', icon('remote'), openPairing, `Phone address: ${cfg.lanHost}:${cfg.port}`);

    sec('Video Folders');
    for (const p of roots.pinned || []) item(p, 'Remove', async () => { await api('/api/media/unpin', { method: 'POST', body: { path: p } }); });
    item('Browse Drives', icon('drive'), () => switchTab('library', { focusContent: true }), 'Add folders from My Library → Videos on This Computer');

    if (cfg.app) {
      sec('This Computer');
      item('Start Lumen When I Sign In', tog(cfg.app.autostart), async () => { await api('/api/app', { method: 'POST', body: { autostart: !cfg.app.autostart } }).catch((e) => ui.toast(e.message, 'info')); }, 'Lumen opens on the TV whenever this computer starts');
      item('Updates', cfg.app.updates?.github ? 'Automatic' : 'From Downloads', null, cfg.app.updates?.github ? 'Lumen checks for new versions every few hours and tells you here' : 'Put a new Lumen installer in Downloads, then press Update Lumen');
    }
    sec('About');
    item('Recently Viewed', 'Clear', async () => { const ok = await ui.confirmDialog({ title: 'Clear recently viewed?', text: 'Your folders are not affected.', ok: 'Clear', danger: true }); if (ok) { await api('/api/recent', { method: 'DELETE' }); invalidate('section:home'); ui.toast('Cleared'); } });
    item('System', esc(`${cfg.system?.platform || '?'} · volume ${cfg.system?.helper ? 'ready' : 'starting'} · VLC ${cfg.system?.vlc ? 'found' : 'not installed'}`), null);
    item('Update Lumen', icon('download') || 'Check', updateLumen, cfg.app ? 'Checks for a new version now. Your settings are kept' : 'Download the new Lumen-TV.zip on this laptop, then press here — your settings are kept');
    item('Privacy', 'Read', () => ui.confirmDialog({ title: 'Lumen and your privacy', text: 'Lumen has no account, adverts, analytics or tracking, and sets no cookies. Your settings, folders, Continue Watching and paired phones stay on this computer. Lumen only contacts TMDB (film details and posters), GitHub (updates), YouTube (trailers) and the websites you open. The full details are in PRIVACY.md on Lumen’s GitHub page.', ok: 'OK', cancel: 'Close' }), 'What Lumen keeps, and who it talks to');
    item('Lumen', `Version ${esc(cfg.version || '1.0')}`, null, 'Film data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.');
    box.appendChild(list);
    s.appendChild(box);
    if (path) restoreFocus(v, path);
    resolve();
  };
  render();
  v.refresh = () => render(true);
  return v;
}
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 2 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

function choose(title, options) {
  return new Promise((resolve) => {
    let res = null;
    const m = ui.modal(`<h2>${esc(title)}</h2><div class="list" data-group="col" style="margin-top:1.4rem"></div>`, { onClose: () => resolve(res) });
    const l = m.querySelector('.list');
    for (const [k, label] of [...options, ['', 'Cancel']]) l.appendChild(onSelect(el(`<div class="setting f">${esc(label)}</div>`), () => { res = k || null; m.close(); }));
    m.open();
  });
}

async function enterKeyDialog() {
  const key = await ui.promptDialog({ title: 'TMDB API Key', text: 'Paste is much easier: on your iPhone remote open Setup, or on this laptop go to localhost:' + (cfg.port || 8787) + '/setup. Both the “API Key” and the longer “API Read Access Token” work.', placeholder: 'API key', ok: 'Save', mono: true });
  if (!key) return;
  try { await api('/api/settings', { method: 'POST', body: { tmdbKey: key } }); invalidate(); await loadConfig(); ui.toast('TMDB connected'); switchTab('home', { focusContent: true }); }
  catch (e) { ui.toast(e.message, 'info'); }
}

// focus path helpers so in-place re-renders keep your place
function focusPath(v) {
  const f = nav.focused(); if (!f || !v.contains(f)) return null;
  const groups = [...v.querySelectorAll('[data-group]')];
  const g = f.closest('[data-group]');
  return [groups.indexOf(g), [...g.querySelectorAll('.f')].indexOf(f)];
}
function restoreFocus(v, [gi, ii]) {
  if (v !== currentView() || ui.topModal()) return; // never steal focus from a view on top or an open dialog
  const groups = [...v.querySelectorAll('[data-group]')];
  const g = groups[Math.min(gi, groups.length - 1)];
  if (!g) return nav.focus(nav.firstIn(v));
  const items = g.querySelectorAll('.f');
  nav.focus(items[Math.min(ii, items.length - 1)] || nav.firstIn(v));
}
function refreshCurrent() {
  const v = currentView();
  if (v?.refresh) v.refresh();
  else if (!app.stack.length) { const tab = app.tab; app.tab = null; invalidate('section:'); switchTab(tab, { focusContent: true }); }
}

// ======================================================================= pairing
let pairModal = null;
async function openPairing() {
  if (pairModal) return;
  let p;
  try { p = await api('/api/pair/start', { method: 'POST' }); } catch (e) { return ui.toast(e.message, 'info'); }
  pairModal = ui.modal(`<h2>Use Your iPhone as a Remote</h2><p>Your phone and this laptop need to be on the same Wi-Fi.</p>
    <div class="pair"><div class="qr">${p.qr}</div><div><ol><li>Open the <b>Camera</b> on your iPhone</li><li>Point it at this code and tap the link</li><li>Tap <b>Pair</b> — then <b>Start Remote</b></li></ol>
    <div class="code">${p.code}</div><div class="addr">Or open ${esc(p.host)}/remote in Safari and enter this code · expires in 5 minutes</div></div></div>
    <div class="actions" data-group="row"></div>`, { wide: true, onClose: () => { pairModal = null; clearTimeout(exp); } });
  pairModal.querySelector('.actions').appendChild(onSelect(el(`<div class="btn f glow">Done</div>`), () => pairModal.close()));
  const exp = setTimeout(() => { if (pairModal) { pairModal.close(); openPairing(); } }, p.expires - Date.now() - 1000);
  pairModal.open();
}

// ======================================================================= remote & keyboard input
const KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'select', NumpadEnter: 'select', Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back', MediaPlayPause: 'playpause', MediaPlay: 'playpause', MediaPause: 'playpause', Home: 'home', BrowserHome: 'home', ContextMenu: 'menu' };
let lastMove = 0;
addEventListener('keydown', (e) => {
  document.body.classList.remove('mouse');
  const tt = ui.textTarget.current;
  const typing = tt && tt.isConnected && !tt.closest('.under, .leaving') && (!ui.topModal() || ui.topModal().contains(tt)) && !player.isOpen();
  if (typing && e.key.length === 1 && !e.ctrlKey && !e.altKey && e.key !== ' ' ) { tt.setValue(tt.getValue() + e.key); e.preventDefault(); return; }
  if (typing && e.key === ' ' && !player.isOpen()) { tt.setValue(tt.getValue() + ' '); e.preventDefault(); return; }
  if (typing && e.key === 'Backspace' && tt.getValue()) { tt.setValue(tt.getValue().slice(0, -1)); e.preventDefault(); return; }
  let k = KEYS[e.key];
  if (e.key === ' ') k = player.isOpen() ? 'playpause' : 'select';
  if (!k) return;
  e.preventDefault();
  if (['up', 'down', 'left', 'right'].includes(k) && e.repeat && performance.now() - lastMove < 90) return;
  lastMove = performance.now();
  dispatch(k);
});
navigator.mediaSession && ['play', 'pause'].forEach((a) => { try { navigator.mediaSession.setActionHandler(a, () => dispatch('playpause')); } catch {} });

// holding a direction: focus moves get much quicker, so the highlight never lags behind the remote
let lastMoveAt = 0, fastT = null;
function noteMove() {
  const now = performance.now();
  if (now - lastMoveAt < 170) { document.documentElement.classList.add('fast-nav'); clearTimeout(fastT); fastT = setTimeout(() => document.documentElement.classList.remove('fast-nav'), 260); }
  lastMoveAt = now;
}
function dispatch(k) {
  idle.poke();
  if (idle.wake()) return; // the screensaver swallows the press that wakes it
  if (['up', 'down', 'left', 'right'].includes(k)) noteMove();
  if (app.sleeping) { app.sleeping.remove(); app.sleeping = null; return; } // any button wakes Lumen after the sleep timer
  if (k === 'home' || k === 'main') return goHome(k === 'main');
  if (app.external) { if (k === 'back') api('/api/close-external', { method: 'POST' }).catch(() => {}); return; }
  if (player.isOpen() && !ui.topModal() && player.handleKey(k)) return; // dialogs (e.g. Resume?) get keys first
  if (['up', 'down', 'left', 'right'].includes(k)) {
    const moved = nav.move(k);
    if (moved) { sound.play('move', k); return; }
    const h = nav.focused()?.closest('.hero');
    if (h && (k === 'right' || k === 'left')) { k === 'right' ? h.next() : h.prev(); sound.play('swipe'); return; }
    sound.play('bump'); bumpFx(nav.focused(), k); // reached the edge: a soft thud and a little nudge
    return;
  }
  if (k === 'select') {
    const f = nav.focused(); const fn = f && ui.selectHandler(f);
    if (!fn) { sound.play('bump'); return; }
    pressFx(f);
    const depth = app.stack.length, modal = ui.topModal(), tog = f.querySelector('.toggle');
    fn();
    if (f.classList.contains('key')) sound.play('key');
    else if (tog) sound.play('toggle', !tog.classList.contains('on'));
    else if (app.stack.length > depth || ui.topModal() !== modal) sound.play('open');
    else sound.play('select');
    return;
  }
  if (k === 'back') { sound.play('back'); return goBack(); }
  if (k === 'menu' || k === 'playpause') {
    const it = itemOf.get(nav.focused());
    if (k === 'menu' && it?.key && nav.focused().closest('.row')?.querySelector('h2')?.textContent.startsWith('Continue Watching')) {
      api(`/api/watching/${it.key}`, { method: 'DELETE' }).then(() => ui.toast(`Removed ${it.title} from Continue Watching`)).catch(() => {});
      return;
    }
    if (k === 'menu' && it && it.type !== 'file') folderDialog(it);
  }
}

// ---- physical feedback: a press squish + glow flash, and an edge nudge
function pressFx(f) {
  if (cfg.reduceMotion) return;
  f.animate([{ scale: 1 }, { scale: 0.94, offset: 0.35 }, { scale: 1.015, offset: 0.75 }, { scale: 1 }], { duration: 300, easing: 'cubic-bezier(.3,.7,.4,1)' });
  f.classList.remove('pressed'); void f.offsetWidth; f.classList.add('pressed');
  setTimeout(() => f.classList.remove('pressed'), 450);
}
function bumpFx(f, dir) {
  if (!f || cfg.reduceMotion) return;
  const d = 9, [x, y] = { left: [-d, 0], right: [d, 0], up: [0, -d], down: [0, d] }[dir] || [0, 0];
  f.animate([{ translate: '0 0' }, { translate: `${x}px ${y}px`, offset: 0.3 }, { translate: `${-x * 0.3}px ${-y * 0.3}px`, offset: 0.7 }, { translate: '0 0' }], { duration: 340, easing: 'ease-out' });
}

function goBack() {
  const m = ui.topModal();
  if (m) return m.close();
  if (app.stack.length) return pop();
  const f = nav.focused();
  if (f && !f.closest('#topbar')) {
    const v = currentView(); if (v) { v.dataset.ty = '0'; v.scroller.style.transform = ''; }
    nav.focus($(`#tabs [data-tab="${app.tab}"]`) || $('#sysbtns [data-tab="settings"]'));
    return;
  }
  if (app.tab !== 'home') { switchTab('home'); nav.focus($('#tabs [data-tab="home"]')); }
}

function goHome(main) {
  while (ui.topModal()) ui.topModal().close();
  if (player.isOpen()) player.close();
  if (app.external) api('/api/close-external', { method: 'POST' }).catch(() => {});
  if (app.tab === 'home' && !app.stack.length) {
    const v = currentView(); if (v) { v.dataset.ty = '0'; v.scroller.style.transform = ''; }
    nav.focus(nav.firstIn(v) || $('#tabs [data-tab="home"]'));
    updateTopbar();
    return;
  }
  switchTab('home', { focusContent: true });
}

// ---------------- mouse & scroll wheel ----------------
// Hover highlights without moving the page; the wheel steps through rows (Shift or sideways = along a row).
let idleT;
addEventListener('mousemove', (e) => {
  document.body.classList.add('mouse');
  clearTimeout(idleT); idleT = setTimeout(() => document.body.classList.remove('mouse'), 3500);
  if (app.external || player.isOpen()) return;
  const f = e.target.closest?.('.f');
  if (f && f !== nav.focused() && (!ui.topModal() || ui.topModal().contains(f)) && !f.closest('.under, .leaving')) nav.focus(f, { mouse: true });
}, { passive: true });
addEventListener('click', (e) => {
  const f = e.target.closest('.f'); if (!f) return;
  nav.focus(f, { mouse: true }); const fn = ui.selectHandler(f); fn && fn();
});
let wheelAcc = { x: 0, y: 0 }, wheelT = 0;
addEventListener('wheel', (e) => {
  e.preventDefault();
  if (app.external) return;
  document.body.classList.add('mouse');
  const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
  const d = e.deltaMode === 1 ? 40 : 1; // lines -> pixels
  if (sideways) wheelAcc.x += (e.shiftKey ? e.deltaY : e.deltaX) * d; else wheelAcc.y += e.deltaY * d;
  const now = performance.now();
  if (now - wheelT < 110) return;
  const step = 50;
  let k = null;
  if (Math.abs(wheelAcc.x) >= step) k = wheelAcc.x > 0 ? 'right' : 'left';
  else if (Math.abs(wheelAcc.y) >= step) k = wheelAcc.y > 0 ? 'down' : 'up';
  if (!k) return;
  wheelAcc = { x: 0, y: 0 }; wheelT = now;
  if (player.isOpen() && !ui.topModal()) { player.handleKey(k === 'up' || k === 'left' ? 'left' : 'right'); return; } // wheel seeks in videos
  // if the pointer is over a row, sideways scrolling should move along *that* row
  const hoverRow = e.target.closest?.('[data-group="row"]');
  if (sideways && hoverRow && !hoverRow.contains(nav.focused())) { const first = hoverRow.querySelector('.f'); if (first) nav.focus(first); }
  dispatch(k);
}, { passive: false });

// ======================================================================= server messages
function onServer(m) {
  switch (m.t) {
    case 'hello': app.remotes = m.remotes; $('#remoteBtn').classList.toggle('has-remote', m.remotes > 0); setExternal(m.external); setSleepBadge(m.sleep); break;
    case 'sleep': setSleepBadge(m.sleep); break;
    case 'sleep-now': sleepNow(); break;
    case 'update-available': ui.toast(`Lumen ${m.version} is ready to install — Settings › Update Lumen`, 'download'); break;
    case 'update-progress': { const u = $('#intro .upd'); if (u) u.textContent = `Downloading… ${m.p}%`; break; }
    case 'update-installing': { const u = $('#intro .upd'); if (u) u.textContent = `Installing Lumen ${m.version}…`; break; }
    case 'update-failed': $('#intro')?.remove(); ui.toast(`Update didn’t work: ${m.error}`, 'info'); break;
    case 'key': dispatch(m.k); break;
    case 'text': {
      const tt = ui.textTarget.current;
      if (tt && tt.isConnected && !tt.closest('.under, .leaving')) tt.setValue(m.v, m.submit);
      else if (m.v) { switchTab('search', { focusContent: true }); setTimeout(() => ui.textTarget.current?.setValue(m.v, m.submit), 450); }
      break;
    }
    case 'volume': ui.showVolume(m.level, m.muted); break;
    case 'paired': if (pairModal) pairModal.close(); ui.toast(`${m.name} is now your remote`, 'remote'); break;
    case 'remotes': {
      if (m.count > app.remotes && m.name) ui.toast(`${m.name} connected`, 'remote');
      app.remotes = m.count; $('#remoteBtn').classList.toggle('has-remote', m.count > 0); break;
    }
    case 'external': setExternal(m.external); break;
    case 'brightness': cfg.brightness = { ...(cfg.brightness || {}), level: m.level }; applyBrightness(m.level); break;
    case 'watching-changed': invalidate('watching'); invalidate('section:home'); if (app.tab === 'home' && !app.stack.length && !app.external) refreshCurrent(); break;
    case 'folders-changed': {
      invalidate('lib');
      const v = currentView(); // only the visible view refreshes; hidden ones refresh when you go back to them
      if (v?.refresh && !ui.topModal() && !player.isOpen()) v.refresh();
      break;
    }
    case 'bg-changed': case 'settings-changed': loadConfig().then(() => { if (app.tab === 'settings' && !app.stack.length && !ui.topModal()) app.tabView.refresh?.(); }); break;
  }
}
function showOpening(title, it = null, w = null) {
  const x = $('#external');
  const where = w ? linkName(w) : '';
  x.innerHTML = loadingHtml({ title, sub: `Opening on ${where}`, accent: accentRgbNow(), stage: 'Opening', hint: 'Press Home on your remote to cancel' });
  x.classList.add('on'); x.dataset.opening = '1';
  app.external = app.external || { kind: 'web', label: title, opening: true };
}
function setExternal(ext) {
  app.external = ext;
  const x = $('#external');
  if (ext && x.dataset.opening) { x.classList.add('on'); sendState(); return; } // keep the loading screen showing
  const wasOpen = !!x.classList.contains('on');
  delete x.dataset.opening;
  if (!ext && wasOpen && app.tab === 'home' && !app.stack.length) { invalidate('watching'); invalidate('section:home'); setTimeout(refreshCurrent, 300); } // back from a film: update Continue Watching
  if (ext) { x.innerHTML = `<div>${icon(ext.kind === 'vlc' ? 'film' : 'globe')}<h2>${esc(ext.label || 'App')} is on screen</h2><p>Press <b>Home</b> on your remote to come back to Lumen.<br>Use the iPhone’s Trackpad and Keyboard tabs to control the website.</p></div>`; x.classList.add('on'); }
  else x.classList.remove('on');
  sendState();
}

// ---- game controllers (Xbox, PlayStation…): the D-pad or left stick moves, A selects, B goes back
const PAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right', 0: 'select', 1: 'back', 2: 'playpause', 3: 'menu', 9: 'home', 8: 'back' };
const padState = new Map();
function pollPads() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const now = performance.now();
  for (const gp of pads) {
    const held = new Set();
    for (const [b, k] of Object.entries(PAD)) if (gp.buttons[b]?.pressed) held.add(k);
    const [x = 0, y = 0] = gp.axes;
    if (y < -0.55) held.add('up'); if (y > 0.55) held.add('down'); if (x < -0.55) held.add('left'); if (x > 0.55) held.add('right');
    for (const k of held) {
      const id = gp.index + ':' + k, st = padState.get(id);
      const repeats = ['up', 'down', 'left', 'right'].includes(k);
      if (!st) { padState.set(id, { next: now + 380 }); document.body.classList.remove('mouse'); dispatch(k); }
      else if (repeats && now >= st.next) { st.next = now + 110; dispatch(k); }
    }
    for (const id of [...padState.keys()]) if (id.startsWith(gp.index + ':') && !held.has(id.split(':')[1])) padState.delete(id);
  }
  requestAnimationFrame(pollPads);
}
addEventListener('gamepadconnected', (e) => ui.toast(`${(e.gamepad.id || 'Controller').replace(/\(.*\)/, '').trim() || 'Controller'} connected`, 'remote'));
requestAnimationFrame(pollPads);

// ---- screensaver: after a while with nothing happening, film artwork drifts slowly across the screen with the
// time on top. Any press brings Lumen back exactly as it was. Not while a film or website is playing.
const idle = (() => {
  let last = Date.now(), on = null, timer = null;
  const mins = () => (cfg.screensaver === false ? 0 : 10);
  async function start() {
    if (on || app.external || player.isOpen() || app.sleeping || ui.topModal() || !mins()) return;
    let pics = [];
    try { const d = await cached('section:home', () => api('/api/section/home'), 3 * 60e3); pics = [...(d.hero || []), ...d.rows.flatMap((r) => r.items || [])].filter((i) => i.backdrop_path).map((i) => ({ src: img(i.backdrop_path, 'w1280'), title: i.title })); } catch {}
    if (!pics.length || on) return;
    pics = pics.filter((p, i) => pics.findIndex((q) => q.src === p.src) === i).sort(() => Math.random() - 0.5).slice(0, 24);
    on = el(`<div id="saver" style="position:fixed;inset:0;z-index:150;background:#000;opacity:0;transition:opacity 1.6s ease;overflow:hidden">
      <div class="s-a" style="position:absolute;inset:-6%;background:center/cover;opacity:0;transition:opacity 2.4s ease"></div>
      <div class="s-b" style="position:absolute;inset:-6%;background:center/cover;opacity:0;transition:opacity 2.4s ease"></div>
      <div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.75),rgba(0,0,0,0) 45%)"></div>
      <div style="position:absolute;left:var(--side);bottom:5rem"><div class="s-t" style="font-size:6rem;font-weight:700;font-stretch:80%;line-height:1;font-variant-numeric:tabular-nums"></div><div class="s-n" style="font-size:1.5rem;color:var(--ink-2);margin-top:.6rem"></div></div></div>`);
    document.body.appendChild(on);
    requestAnimationFrame(() => (on.style.opacity = 1));
    let i = 0, flip = 0;
    const show = async () => {
      if (!on) return;
      const p = pics[i++ % pics.length];
      const im = new Image(); im.src = p.src; try { await im.decode(); } catch {}
      if (!on) return;
      const a = on.querySelector(flip ? '.s-b' : '.s-a'), b = on.querySelector(flip ? '.s-a' : '.s-b'); flip ^= 1;
      a.style.backgroundImage = `url("${p.src}")`;
      // a slow drift (transform only, so it stays smooth)
      a.animate([{ transform: 'scale(1.02) translate(-1.5%, 0)' }, { transform: 'scale(1.1) translate(1.5%, -1%)' }], { duration: 16000, easing: 'linear', fill: 'forwards' });
      a.style.opacity = 1; b.style.opacity = 0;
      on.querySelector('.s-n').textContent = p.title || '';
    };
    const clock = () => { if (on) on.querySelector('.s-t').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
    clock(); show();
    on.timers = [setInterval(show, 12000), setInterval(clock, 10000)];
  }
  function wake() {
    if (!on) return false;
    const s = on; on = null; s.timers.forEach(clearInterval);
    s.style.transition = 'opacity .45s ease'; s.style.opacity = 0; setTimeout(() => s.remove(), 500);
    return true;
  }
  function poke() { last = Date.now(); }
  setInterval(() => { if (mins() && Date.now() - last > mins() * 60e3) start(); }, 20000);
  addEventListener('mousemove', () => { poke(); wake(); });
  return { poke, wake };
})();

// ---- when a film stays highlighted for a moment, Lumen fetches its details and artwork, so opening it is instant
let prefetchT = null;
document.addEventListener('nav-focus', (e) => {
  clearTimeout(prefetchT);
  const it = itemOf.get(e.target);
  if (!it || !['movie', 'tv'].includes(it.type) || !it.id) return;
  prefetchT = setTimeout(() => {
    cached(`d:${it.type}:${it.id}`, () => api(`/api/details/${it.type}/${it.id}`), 30 * 60e3).catch(() => {});
    if (it.backdrop_path) { const i = new Image(); i.src = img(it.backdrop_path, 'w1280'); i.decode?.().catch(() => {}); }
  }, 350);
});

function sendState() {
  const tt = ui.textTarget.current;
  ws?.send({ t: 'state', view: app.stack.length ? 'detail' : app.tab, textInput: !!(tt && tt.isConnected && !tt.closest('.under, .leaving')), inPlayer: player.isOpen() });
}

// ======================================================================= registry
const VIEWS = {
  home: () => sectionView('home', 'Trending This Week'),
  movies: () => sectionView('movies', 'Trending Film'),
  tv: () => sectionView('tv', 'Trending TV'),
  free: () => sectionView('free', 'Free to Watch'),
  recent: () => sectionView('recent', 'New Release'),
  library: libraryView,
  search: searchView,
  settings: settingsView,
};

boot();
