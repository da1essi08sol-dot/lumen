// UI building blocks: cards, rows, hero, modals, on-screen keyboard, toast, HUDs.
import { icon } from '/shared/icons.js';
import { img } from './api.js';
import * as nav from './nav.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

// select handlers
const handlers = new WeakMap();
export const onSelect = (node, fn) => { handlers.set(node, fn); return node; };
export const selectHandler = (node) => handlers.get(node);
// item data bound to cards (for ambient background, folders, etc.)
export const itemOf = new WeakMap();

export const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize);
const hueOf = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

export function fallbackArt(title, sub) {
  return `<div class="fallback" style="--h:${hueOf(title)}"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
}

// <img> that fades in when loaded and swaps to a generated poster on failure
export function artImg(src, title, sub, alt = '') {
  if (!src) return fallbackArt(title, sub);
  return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" onload="this.classList.add('ok')" onerror="this.outerHTML=window.__fallback(this)" data-t="${esc(title)}" data-s="${esc(sub || '')}">`;
}
window.__fallback = (imgEl) => fallbackArt(imgEl.dataset.t, imgEl.dataset.s);

const yearType = (it) => [it.year, it.type === 'tv' ? 'TV' : it.type === 'movie' ? 'Film' : ''].filter(Boolean).join(' · ');

export function posterCard(it, { onPick, capAlways = false, extraClass = '' } = {}) {
  let inner;
  if (it.poster_path) inner = artImg(img(it.poster_path, 'w342'), it.title, yearType(it), it.title);
  else if (it.backdrop_path) inner = `<img src="${esc(img(it.backdrop_path, 'w780'))}" alt="" loading="lazy" onload="this.classList.add('ok')" onerror="this.remove()"><div class="fallback bd-title" style="--h:0"><b>${esc(it.title)}</b><span>${esc(yearType(it))}</span></div>`;
  else inner = fallbackArt(it.title, yearType(it));
  const card = el(`<div class="card poster f ${capAlways ? 'cap-always' : ''} ${extraClass}"><div class="art">${inner}<div class="sheen"></div><div class="remove-badge">${icon('minus')}</div></div><div class="cap">${esc(it.title)}${it.year ? `<small>${it.year}</small>` : ''}</div></div>`);
  itemOf.set(card, it);
  if (onPick) onSelect(card, () => onPick(it, card));
  return card;
}

export function wideCard(it, { onPick, sub = '', badge = '', progress = null } = {}) {
  const src = it.backdrop_path ? img(it.backdrop_path, 'w780') : null;
  const card = el(`<div class="card wide f cap-always"><div class="art">${artImg(src, it.title, sub || yearType(it))}${badge ? `<div class="badge-type">${esc(badge)}</div>` : ''}${progress != null ? `<div class="progress"><i style="width:${Math.round(progress * 100)}%"></i></div>` : ''}<div class="sheen"></div></div><div class="cap">${esc(it.title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div></div>`);
  itemOf.set(card, it);
  if (onPick) onSelect(card, () => onPick(it, card));
  return card;
}

export function row(title, cards, { sub = '', cls = '' } = {}) {
  const r = el(`<section class="row ${cls}"><h2>${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</h2><div class="vp" data-group="row"><div class="track" data-tx="0"></div></div></section>`);
  const track = r.querySelector('.track');
  cards.forEach((c) => track.appendChild(c));
  return r;
}

export function skeletonRows(n = 3, kind = 'poster') {
  const wrap = el('<div class="rows skeleton"></div>');
  for (let i = 0; i < n; i++) {
    const cards = Array.from({ length: 9 }, () => el(`<div class="card ${kind}"><div class="art"></div></div>`));
    wrap.appendChild(row(' ', cards));
  }
  return wrap;
}

export function metaLine(d) {
  const bits = [];
  if (d.type) bits.push(d.type === 'tv' ? 'TV Show' : 'Film');
  if (d.year) bits.push(String(d.year));
  if (d.runtime) bits.push(d.type === 'tv' ? `${d.runtime} min episodes` : `${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m`);
  if (d.number_of_seasons) bits.push(`${d.number_of_seasons} Season${d.number_of_seasons > 1 ? 's' : ''}`);
  if (d.genres?.length) bits.push(d.genres.slice(0, 3).join(', '));
  let html = bits.map(esc).join('<span class="dot"></span>');
  if (d.certification) html += `<span class="cert">${esc(d.certification)}</span>`;
  if (d.vote_average) html += `<span class="star">${icon('star')}${d.vote_average.toFixed(1)}</span>`;
  return `<div class="meta">${html}</div>`;
}

// ---------------- hero (auto-rotating featured titles) ----------------
export function hero(items, { eyebrow = 'Trending', greet = '', onOpen, onFolder, onSlide }) {
  const h = el(`<section class="hero" data-top="1"><div class="bd"></div><div class="bd"></div>
    <div class="copy">${greet ? `<div class="greet">${greet}</div>` : ''}<div class="eyebrow"></div><h1></h1><div class="metaw"></div><p class="overview"></p>
    <div class="actions" data-group="row"></div></div><div class="dots">${items.map(() => '<i></i>').join('')}</div></section>`);
  const bds = h.querySelectorAll('.bd'), copy = h.querySelector('.copy'), dots = h.querySelectorAll('.dots i');
  const actions = h.querySelector('.actions');
  const details = onSelect(el(`<div class="btn primary f glow autofocus">${icon('info')}<span>Details</span></div>`), () => onOpen(items[idx]));
  const folder = onSelect(el(`<div class="btn f glow">${icon('folderPlus')}<span>Add to Folder</span></div>`), () => onFolder(items[idx]));
  actions.append(details, folder);
  let idx = -1, flip = 0, timer = null;
  const show = (i, instant) => {
    idx = (i + items.length) % items.length;
    const it = items[idx];
    const layer = bds[flip ^= 1], other = bds[flip ^ 1];
    const src = img(it.backdrop_path, 'w1280');
    const pre = new Image();
    pre.onload = pre.onerror = () => { layer.style.backgroundImage = `url("${src}")`; layer.classList.add('on'); other.classList.remove('on'); };
    pre.src = src;
    copy.classList.add('swap');
    setTimeout(() => {
      h.querySelector('.eyebrow').textContent = eyebrow;
      h.querySelector('h1').textContent = it.title;
      h.querySelector('.metaw').innerHTML = metaLine(it);
      h.querySelector('.overview').textContent = it.overview || '';
      itemOf.set(details, it); itemOf.set(folder, it);
      copy.classList.remove('swap');
    }, instant ? 0 : 320);
    dots.forEach((d, j) => d.classList.toggle('on', j === idx));
    onSlide?.(it);
  };
  const restart = () => { clearInterval(timer); timer = setInterval(() => { if (h.isConnected && !h.closest('.under')) show(idx + 1); }, 9000); };
  h.next = () => { show(idx + 1); restart(); };
  h.prev = () => { show(idx - 1); restart(); };
  h.stop = () => clearInterval(timer);
  if (items.length) { show(0, true); restart(); }
  return h;
}

// ---------------- modal sheets ----------------
export function modal(contentHtml, { wide = false, onClose } = {}) {
  const m = el(`<div class="modal"><div class="sheet ${wide ? 'sheet-wide' : ''}">${contentHtml}</div></div>`);
  document.body.appendChild(m);
  requestAnimationFrame(() => requestAnimationFrame(() => m.classList.add('in')));
  m.close = () => {
    if (m.closed) return; m.closed = true;
    m.classList.remove('in');
    nav.popLayer();
    modalStack.splice(modalStack.indexOf(m), 1);
    setTimeout(() => m.remove(), 380);
    onClose?.();
  };
  modalStack.push(m);
  m.open = (initial) => nav.pushLayer(m, initial);
  return m;
}
export const modalStack = [];
export const topModal = () => modalStack[modalStack.length - 1];

export function confirmDialog({ title, text, ok = 'OK', danger = false, cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    const m = modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="actions" data-group="row"></div>`, { onClose: () => resolve(result) });
    let result = false;
    const a = m.querySelector('.actions');
    const c = onSelect(el(`<div class="btn f glow">${esc(cancel)}</div>`), () => m.close());
    const o = onSelect(el(`<div class="btn f glow ${danger ? 'danger' : 'primary'}">${esc(ok)}</div>`), () => { result = true; m.close(); });
    a.append(c, o);
    m.open(danger ? c : o);
  });
}

// ---------------- on-screen keyboard ----------------
// Shared target so the phone's keyboard can type into whatever field is active.
export const textTarget = { current: null };

export function keyboard({ value = '', placeholder = '', onChange, onSubmit, submitLabel = 'Done', mono = false }) {
  const root = el(`<div class="kbw"><div class="kb-field">${icon('search')}<div class="txt"></div></div><div class="kb"></div>
    <div class="kb-hint">${icon('remote')}You can also type on your iPhone — open the Keyboard tab on the remote.</div></div>`);
  if (!placeholder.toLowerCase().includes('search')) root.querySelector('.kb-field .ic').outerHTML = icon('keyboard');
  const kb = root.querySelector('.kb'), txt = root.querySelector('.txt');
  let val = value;
  const render = () => {
    txt.innerHTML = val ? `<span${mono ? ' style="font-family:Consolas,monospace;font-size:1.5rem"' : ''}>${esc(val)}</span><span class="caret"></span>` : `<span class="caret"></span><span class="ph">${esc(placeholder)}</span>`;
  };
  const set = (v, fire = true) => { val = v.slice(0, 200); render(); if (fire) onChange?.(val); };
  const lines = mono ? ['abcdefghijklm', 'nopqrstuvwxyz', '0123456789.-_', 'ABCDEFGHIJKLM', 'NOPQRSTUVWXYZ'] : ['abcdefghijklm', 'nopqrstuvwxyz', '1234567890&\'-'];
  const keys = el('<div class="keys" data-group="grid"></div>');
  for (const line of lines) for (const ch of line) keys.appendChild(onSelect(el(`<div class="key f">${esc(ch)}</div>`), () => set(val + ch)));
  kb.appendChild(keys);
  const fn = el('<div class="fn" data-group="row"></div>');
  fn.append(
    onSelect(el(`<div class="key f">Space</div>`), () => set(val + ' ')),
    onSelect(el(`<div class="key f">${icon('back')}Delete</div>`), () => set(val.slice(0, -1))),
    onSelect(el(`<div class="key f">Clear</div>`), () => set('')),
  );
  if (onSubmit) fn.appendChild(onSelect(el(`<div class="key f" style="color:var(--ink)">${icon('check')}${esc(submitLabel)}</div>`), () => onSubmit(val)));
  kb.appendChild(fn);
  render();
  root.setValue = (v, submit) => { set(v); if (submit && onSubmit) onSubmit(val); };
  root.getValue = () => val;
  root.firstKey = () => keys.querySelector('.f');
  root.addEventListener('nav-focus', () => { textTarget.current = root; });
  return root;
}

export function promptDialog({ title, text = '', value = '', placeholder = '', ok = 'Save', mono = false, allowEmpty = false }) {
  return new Promise((resolve) => {
    let result = null;
    const m = modal(`<h2>${esc(title)}</h2>${text ? `<p>${esc(text)}</p>` : ''}<div class="slot"></div>`, { wide: true, onClose: () => { if (textTarget.current === k) textTarget.current = null; resolve(result); } });
    const k = keyboard({ value, placeholder, submitLabel: ok, mono, onSubmit: (v) => { if (v.trim() || allowEmpty) { result = v.trim(); m.close(); } } }); // allowEmpty: saving nothing clears the setting
    m.querySelector('.slot').appendChild(k);
    textTarget.current = k;
    m.open(k.firstKey());
  });
}

// ---------------- toast & volume ----------------
let toastTimer;
export function toast(msg, ic = 'check') {
  const t = document.getElementById('toast');
  t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
let volTimer;
export function showVolume(level, muted) {
  const v = document.getElementById('volume');
  const pct = Math.round((level || 0) * 100);
  v.innerHTML = `${icon(muted || pct === 0 ? 'mute' : pct < 50 ? 'volDown' : 'volUp')}<div class="lvl"><i style="height:${muted ? 0 : pct}%"></i></div><div class="num">${muted ? 'Mute' : pct}</div>`;
  v.classList.add('on');
  clearTimeout(volTimer);
  volTimer = setTimeout(() => v.classList.remove('on'), 1800);
}
