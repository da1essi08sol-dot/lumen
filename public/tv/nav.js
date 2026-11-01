// Focus engine for remote control navigation.
// Focusables carry class "f". They live inside "groups" ([data-group="row|col|grid"]).
// Moving inside a group is index based; leaving a group picks the nearest group in that direction.
// Layers (modals) trap focus; only the top layer is navigable.

const layers = [];          // stack of root elements
let current = null;
const memory = new WeakMap(); // group -> last focused element

export function pushLayer(root, initial) {
  if (current) memory.set(layerKey(), current);
  layers.push(root);
  focus(initial || firstIn(root));
}
export function popLayer() {
  layers.pop();
  const back = memory.get(layerKey());
  if (back && back.isConnected) focus(back, { silentScroll: true });
  else focus(firstIn(top()));
}
export function setBaseLayer(root, initial) {
  layers.length = 0; layers.push(root);
  if (initial !== false) focus(initial || firstIn(root));
}
export const top = () => layers[layers.length - 1];
const layerKey = () => top() || document.body;
export const focused = () => current;
export const layerDepth = () => layers.length;

function visible(el) {
  if (!el || !el.isConnected || el.closest('[hidden], [hidden-nav], .under, .leaving, .skeleton') || el.classList.contains('disabled')) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}
export function firstIn(root) {
  if (!root) return null;
  const pref = root.querySelector('.f.autofocus');
  if (pref && visible(pref)) return pref;
  for (const el of root.querySelectorAll('.f')) if (visible(el) && inTop(el)) return el;
  return null;
}
function inTop(el) {
  const t = top();
  return t ? t.contains(el) : true;
}

export function focus(el, opts = {}) {
  if (!el || el === current) { if (el) el.dispatchEvent(new CustomEvent('nav-refocus', { bubbles: true })); return; }
  const prev = current;
  if (prev) prev.classList.remove('focused');
  current = el;
  el.classList.add('focused');
  const g = el.closest('[data-group]');
  if (g) memory.set(g, el);
  el.dispatchEvent(new CustomEvent('nav-focus', { bubbles: true, detail: { prev, ...opts } }));
}

function groupItems(g) {
  return [...g.querySelectorAll('.f')].filter((el) => el.closest('[data-group]') === g && visible(el));
}
function groupsInLayer() {
  const root = top() || document.body;
  return [...root.querySelectorAll('[data-group]')].filter((g) => visible(g) && groupItems(g).length);
}
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

function columnsOf(items) {
  if (items.length < 2) return 1;
  const top0 = items[0].offsetTop;
  let n = 0; for (const it of items) { if (Math.abs(it.offsetTop - top0) < 4) n++; else break; }
  return Math.max(1, n);
}

export function move(dir) {
  const t = top();
  if (!current || !current.isConnected || !inTop(current) || !visible(current)) { focus(firstIn(t)); return true; }
  const g = current.closest('[data-group]');
  if (g) {
    const type = g.dataset.group;
    const items = groupItems(g);
    const i = items.indexOf(current);
    let next = null;
    if (type === 'row') { if (dir === 'left') next = items[i - 1]; if (dir === 'right') next = items[i + 1]; }
    else if (type === 'col') { if (dir === 'up') next = items[i - 1]; if (dir === 'down') next = items[i + 1]; }
    else if (type === 'grid') {
      const cols = columnsOf(items);
      if (dir === 'left' && i % cols) next = items[i - 1];
      if (dir === 'right' && (i + 1) % cols && i + 1 < items.length) next = items[i + 1];
      if (dir === 'up') next = items[i - cols];
      if (dir === 'down') next = items[i + cols] || (Math.floor(i / cols) < Math.floor((items.length - 1) / cols) ? items[items.length - 1] : null);
    }
    if (next) { focus(next); return true; }
    if (g.dataset.wrap === 'none-' + dir) return false; // explicit stop
  }
  // leave the group: nearest group in direction, by group rect
  const from = (g || current).getBoundingClientRect();
  const cur = current.getBoundingClientRect();
  const cc = center(cur);
  let best = null, bestScore = Infinity;
  for (const og of groupsInLayer()) {
    if (og === g) continue;
    const r = og.getBoundingClientRect();
    let primary, overlap;
    if (dir === 'down') { if (r.top < from.bottom - 4) continue; primary = r.top - from.bottom; overlap = Math.max(0, Math.min(r.right, from.right) - Math.max(r.left, from.left)); }
    else if (dir === 'up') { if (r.bottom > from.top + 4) continue; primary = from.top - r.bottom; overlap = Math.max(0, Math.min(r.right, from.right) - Math.max(r.left, from.left)); }
    else if (dir === 'right') { if (r.left < from.right - 4) continue; primary = r.left - from.right; overlap = Math.max(0, Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top)); }
    else { if (r.right > from.left + 4) continue; primary = from.left - r.right; overlap = Math.max(0, Math.min(r.bottom, from.bottom) - Math.max(r.top, from.top)); }
    const rc = center(r);
    const ortho = dir === 'up' || dir === 'down' ? Math.abs(rc.x - cc.x) : Math.abs(rc.y - cc.y);
    const score = primary * 2 + (overlap > 0 ? 0 : 1000 + ortho);
    if (score < bestScore) { bestScore = score; best = og; }
  }
  if (!best) return false;
  focus(entryFor(best, cc, dir));
  return true;
}

function entryFor(g, cc, dir) {
  const items = groupItems(g);
  const remembered = memory.get(g);
  if (g.dataset.memory !== 'off' && remembered && items.includes(remembered)) {
    const r = remembered.getBoundingClientRect();
    if (r.right > 0 && r.left < innerWidth) return remembered;
  }
  if (g.dataset.group === 'col' && (dir === 'left' || dir === 'right')) {
    return items.reduce((a, b) => (Math.abs(center(b.getBoundingClientRect()).y - cc.y) < Math.abs(center(a.getBoundingClientRect()).y - cc.y) ? b : a));
  }
  if (g.dataset.group === 'col') return dir === 'up' ? items[items.length - 1] : items[0];
  let cand = items;
  if (g.dataset.group === 'grid') {
    const cols = columnsOf(items);
    cand = dir === 'up' ? items.slice(Math.floor((items.length - 1) / cols) * cols) : items.slice(0, cols);
  }
  return cand.reduce((a, b) => {
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const da = ra.right < 0 || ra.left > innerWidth ? 1e6 : Math.abs(center(ra).x - cc.x);
    const db = rb.right < 0 || rb.left > innerWidth ? 1e6 : Math.abs(center(rb).x - cc.x);
    return db < da ? b : a;
  });
}

// Keep the focused item inside its row's viewport by translating the row track.
export function scrollRowTo(el, { pad = 0 } = {}) {
  const track = el.closest('.track');
  if (!track) return;
  const vp = track.parentElement;
  const vw = vp.clientWidth;
  const left = el.offsetLeft, right = left + el.offsetWidth;
  let tx = -(+track.dataset.tx || 0);
  const maxTx = Math.max(0, track.scrollWidth - vw);
  const edge = pad || Math.round(vw * 0.06);
  if (left - tx < edge) tx = left - edge;
  else if (right - tx > vw - edge) tx = right - vw + edge;
  tx = Math.max(0, Math.min(maxTx, tx));
  track.dataset.tx = String(-tx);
  track.style.transform = `translate3d(${-tx}px,0,0)`;
}
