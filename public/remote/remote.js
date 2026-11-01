// Lumen Remote — companion web app for iPhone.
import { icon } from '/shared/icons.js';

const app = document.getElementById('app');
const TOKEN_KEY = 'lumen.token';
let token = localStorage.getItem(TOKEN_KEY);
let ws = null, state = { tvConnected: false, volume: null, external: null, deviceName: 'TV' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const headers = { 'x-lumen-token': token || '' };
  let body = opts.body;
  if (body && !(body instanceof Blob)) { headers['content-type'] = 'application/json'; body = JSON.stringify(body); }
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await fetch(path, { method: opts.method || 'GET', headers, body });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401) { unpaired(); throw new Error('This phone is no longer paired.'); }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

// ===================================================================== pairing
function pairingScreen(paired = false) {
  const code = new URLSearchParams(location.search).get('code') || '';
  app.innerHTML = `<div class="pairing">
    <div class="logo"><i></i></div>
    ${paired ? `<h1>You’re paired</h1><p>This iPhone now controls <b>${esc(state.deviceName)}</b>.</p>
      <button class="big" id="start">Start Remote</button>` : `
    <h1>Lumen Remote</h1>
    <p>Enter the 6-digit code shown on your TV. Your iPhone and the TV laptop must be on the same Wi-Fi.</p>
    <input class="field code" id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" value="${esc(code.replace(/\D/g, '').slice(0, 6))}">
    <input class="field" id="name" placeholder="Name this phone" value="iPhone" maxlength="40">
    <button class="big" id="pair">Pair</button>
    <div class="msg" id="msg"></div>`}
  </div>`;
  if (paired) { document.getElementById('start').onclick = () => { if (new URLSearchParams(location.search).get('next') === 'phone') { location.href = '/phone/'; return; } history.replaceState(null, '', '/remote/'); startRemote(); }; return; }
  const btn = document.getElementById('pair'), msg = document.getElementById('msg'), inp = document.getElementById('code');
  const check = () => (btn.disabled = inp.value.replace(/\D/g, '').length !== 6);
  inp.addEventListener('input', () => { inp.value = inp.value.replace(/\D/g, '').slice(0, 6); check(); });
  check();
  btn.onclick = async () => {
    btn.disabled = true; msg.className = 'msg'; msg.textContent = 'Pairing…';
    try {
      const res = await fetch('/api/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: inp.value, name: document.getElementById('name').value.trim() || 'iPhone' }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Pairing failed');
      token = data.token; localStorage.setItem(TOKEN_KEY, token);
      state.deviceName = data.deviceName;
      pairingScreen(true);
    } catch (e) { msg.className = 'msg err'; msg.textContent = e.message; check(); }
  };
}
function unpaired() {
  token = null; localStorage.removeItem(TOKEN_KEY);
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  pairingScreen();
}

// ===================================================================== connection
let delay = 600;
function connect() {
  if (!token) return;
  const sock = new WebSocket(`ws://${location.host}/ws?t=${encodeURIComponent(token)}`);
  ws = sock;
  let opened = false;
  sock.onopen = () => { opened = true; delay = 600; lastHeard = Date.now(); sock.send(JSON.stringify({ t: 'hello' })); flushOutbox(); render(); };
  sock.onmessage = (e) => { lastHeard = Date.now(); const m = JSON.parse(e.data); if (m.t === 'state') { state = { ...state, ...m }; render(); } if (m.t === 'error') flashMsg(m.error); };
  sock.onclose = async () => {
    if (ws !== sock) return;
    ws = null; state.tvConnected = false; render();
    if (!opened) { try { await api('/api/me'); } catch { return; } } // 401 -> unpaired() already called
    setTimeout(connect, delay); delay = Math.min(delay * 1.7, 5000);
  };
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && token) { if (!ws || ws.readyState > 1) { delay = 300; connect(); } else ping(); } });

// Phones put Wi-Fi to sleep, which can leave a connection that looks open but is dead. We check it
// every few seconds and reconnect straight away — and presses made in the meantime wait and are sent
// as soon as the connection is back, instead of being lost (this is what made volume "sometimes" fail).
let lastHeard = 0, outbox = [];
function ping() {
  if (!ws || ws.readyState !== 1) return;
  const sock = ws, sent = Date.now();
  sock.send(JSON.stringify({ t: 'ping' }));
  setTimeout(() => { if (ws === sock && lastHeard < sent) { sock.onclose?.(); try { sock.close(); } catch {} } }, 2500);
}
setInterval(() => { if (!document.hidden) ping(); }, 6000);
function flushOutbox() {
  const now = Date.now(), items = outbox.filter((o) => now - o.at < 4000); outbox = [];
  for (const o of items) ws.send(JSON.stringify(o.m));
}
const send = (m) => {
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; }
  outbox.push({ m, at: Date.now() }); if (outbox.length > 20) outbox.shift();
  if (token && (!ws || ws.readyState > 1)) { delay = 200; connect(); }
  return false;
};

// ===================================================================== shell
let tab = 'remote';
const TABS = [['browse', 'Browse', 'grid'], ['remote', 'Remote', 'remote'], ['keyboard', 'Keyboard', 'keyboard'], ['trackpad', 'Trackpad', 'trackpad'], ['backgrounds', 'Backgrounds', 'image'], ['setup', 'Setup', 'settings']];
function startRemote() {
  app.innerHTML = `<div class="head"><div><div class="tv"><span class="dot"></span><span class="name"></span></div><div class="sub"></div></div></div>
    <div id="bannerSlot"></div>
    ${TABS.map(([k]) => `<div class="screen" data-s="${k}"></div>`).join('')}
    <nav class="tabbar">${TABS.map(([k, l, ic]) => `<button data-t="${k}">${icon(ic)}<span>${l}</span></button>`).join('')}</nav>`;
  app.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => showTab(b.dataset.t)));
  buildRemote(); buildKeyboard(); buildTrackpad();
  showTab('remote');
  connect();
}
function showTab(t) {
  if (t === 'browse') { location.href = '/phone/'; return; }   // the whole of Lumen with touch (public/phone)
  tab = t;
  app.querySelectorAll('.screen').forEach((s) => s.classList.toggle('on', s.dataset.s === t));
  app.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
  if (t === 'backgrounds') buildBackgrounds();
  if (t === 'setup') buildSetup();
  if (t === 'keyboard') setTimeout(() => document.getElementById('kbInput')?.focus(), 50);
}
function render() {
  const n = app.querySelector('.head .name'); if (!n) return;
  n.textContent = state.deviceName || 'TV';
  app.querySelector('.head .dot').classList.toggle('on', !!(ws && state.tvConnected));
  app.querySelector('.head .sub').textContent = !ws ? 'Connecting…' : state.tvConnected ? (state.external ? `${state.external.label} is on screen` : 'Connected') : 'TV interface is closed — tap “Show Lumen”';
  if (!app.querySelector('.vtrack.drag:not(.btrack)')) drawVolume();
  if (!app.querySelector('.btrack.drag')) drawBrightness();
  if (state.font) document.documentElement.dataset.font = state.font; // and its fonts
  if (state.accent) { // follow the TV's colour
    const [r, g, b] = state.accent.split(',').map(Number);
    document.documentElement.style.setProperty('--acc', `${r},${g},${b}`);
    document.documentElement.style.setProperty('--acc-ink', (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55 ? '#000' : '#fff');
  }
  app.querySelector('.head .dot').classList.toggle('warn', !ws);
  const slot = document.getElementById('bannerSlot');
  if (state.external) {
    slot.innerHTML = `<div class="banner">${icon('globe')}<span><b>${esc(state.external.label)}</b> is open. Arrows and OK work; use Trackpad to point.</span><button id="closeExt">Back to Lumen</button></div>`;
    document.getElementById('closeExt').onclick = () => send({ t: 'key', k: 'main' });
  } else slot.innerHTML = '';
}
let msgT;
function flashMsg(text) {
  const s = app.querySelector('.head .sub'); if (!s) return;
  s.textContent = text; clearTimeout(msgT); msgT = setTimeout(render, 2500);
}

// a light tap you can feel. Android: vibrate. iPhone (iOS 18+): Safari gives a haptic tick when a
// switch control toggles, so we toggle a hidden one. Older iPhones simply stay silent.
let hapticLabel = null;
function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.style.cssText = 'position:fixed;left:-99px;top:0;width:1px;height:1px;overflow:hidden;opacity:0';
      hapticLabel.innerHTML = '<input type="checkbox" switch>';
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch {}
}

// press-and-hold with auto-repeat and press feedback
// Repeats while held. Built so a repeat can never get stuck: a second touch, a missed "finger lifted"
// or switching apps all stop it, and there's a cap on how many repeats one press can make.
// (A stuck repeat is what sent the volume all the way to 0 or 100.)
const holds = new Set();
const stopAllHolds = () => holds.forEach((s) => s());
['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'blur'].forEach((ev) => addEventListener(ev, stopAllHolds, true));
document.addEventListener('visibilitychange', stopAllHolds);
function holdable(node, fire, { repeat = 130, initial = 380, cls = 'pressed', target = node, max = 60 } = {}) {
  let t1 = null, t2 = null, count = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; target.classList.remove(cls); };
  holds.add(stop);
  node.addEventListener('pointerdown', (e) => {
    e.preventDefault(); stop(); count = 0;
    try { node.setPointerCapture(e.pointerId); } catch {}
    target.classList.add(cls); haptic(); fire();
    if (repeat) t1 = setTimeout(() => { t2 = setInterval(() => { if (++count > max) return stop(); fire(); }, repeat); }, initial);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => node.addEventListener(ev, stop));
}

// ===================================================================== remote screen
function buildRemote() {
  const s = app.querySelector('[data-s="remote"]');
  s.classList.add('remote');
  const chev = (deg) => icon('chevron').replace('<svg', `<svg style="transform:rotate(${deg}deg)"`);
  s.innerHTML = `
    <div class="dpad">
      <div class="ring"></div><div class="glowseg"></div>
      <div class="seg up">${chev(-90)}</div>
      <div class="seg down">${chev(90)}</div>
      <div class="seg left">${chev(180)}</div>
      <div class="seg right">${chev(0)}</div>
      <div class="ok"><span>OK</span></div>
    </div>
    <div class="actions">
      <button class="act" data-k="back"><span class="disc">${icon('back')}</span><small>Back</small></button>
      <button class="act" data-k="home"><span class="disc">${icon('home')}</span><small>Home</small></button>
      <button class="act" data-k="playpause"><span class="disc">${icon('playpause')}</span><small>Play</small></button>
      <button class="act" data-k="menu"><span class="disc">${icon('more')}</span><small>Options</small></button>
    </div>
    <div class="volbar">
      <button class="vbtn" data-v="down" aria-label="Volume down">${icon('volDown')}</button>
      <div class="vtrack" aria-label="Volume — tap or drag to set, hold to mute"><div class="vfill"></div><div class="vknob"></div><span class="vnum">–</span></div>
      <button class="vbtn" data-v="up" aria-label="Volume up">${icon('volUp')}</button>
    </div>
    <div class="volbar brightbar">
      <button class="vbtn" data-b="-5" aria-label="Darker">${icon('sunLow')}</button>
      <div class="vtrack btrack" aria-label="Brightness — tap or drag to set"><div class="vfill"></div><div class="vknob"></div><span class="vnum">–</span></div>
      <button class="vbtn" data-b="5" aria-label="Brighter">${icon('sunHigh')}</button>
    </div>
    <button class="main-btn">${icon('tv')}Show Lumen</button>`;
  const dpad = s.querySelector('.dpad');
  for (const d of ['up', 'down', 'left', 'right']) {
    const seg = s.querySelector('.seg.' + d);
    holdable(seg, () => { send({ t: 'key', k: d }); ripple(dpad, d); }, { repeat: 140, target: dpad, cls: 'p-' + d });
  }
  holdable(s.querySelector('.ok'), () => { send({ t: 'key', k: 'select' }); ripple(dpad, 'ok'); }, { repeat: 0 });
  s.querySelectorAll('.act[data-k]').forEach((b) => holdable(b, () => send({ t: 'key', k: b.dataset.k }), { repeat: 0 }));
  s.querySelectorAll('.vbtn[data-v]').forEach((b) => holdable(b, () => { send({ t: 'vol', a: b.dataset.v }); nudgeVolume(b.dataset.v === 'up' ? 0.04 : -0.04); }, { repeat: 180, initial: 450, max: 10 }));
  holdable(s.querySelector('.main-btn'), () => send({ t: 'key', k: 'main' }), { repeat: 0 });
  // tap or drag the volume bar to set it; press and hold the bar (without moving) to mute
  const track = s.querySelector('.vtrack:not(.btrack)');
  let dragging = false, lastSent = 0, pendingV = null, sendT = null;
  const setFrom = (x) => {
    const r = track.getBoundingClientRect(), v = Math.max(0, Math.min(1, (x - r.left) / r.width));
    state.volume = { level: v, muted: false }; drawVolume(true);
    pendingV = v; const now = Date.now();
    const flush = () => { if (pendingV != null) { send({ t: 'vol', a: 'set', v: Math.round(pendingV * 100) / 100 }); pendingV = null; lastSent = Date.now(); } };
    clearTimeout(sendT); if (now - lastSent > 90) flush(); else sendT = setTimeout(flush, 90);
  };
  let downX = 0, moved = false, muteT = null, muted = false;
  track.addEventListener('pointerdown', (e) => {
    e.preventDefault(); try { track.setPointerCapture(e.pointerId); } catch {}
    dragging = true; moved = false; muted = false; downX = e.clientX; track.classList.add('drag'); haptic();
    muteT = setTimeout(() => { if (dragging && !moved) { muted = true; haptic(); send({ t: 'vol', a: 'mute' }); track.classList.add('hold'); } }, 600);
  });
  track.addEventListener('pointermove', (e) => { if (!dragging || muted) return; if (Math.abs(e.clientX - downX) > 8) { moved = true; clearTimeout(muteT); } if (moved) setFrom(e.clientX); });
  const end = (e) => {
    clearTimeout(muteT); track.classList.remove('hold');
    if (!dragging) return; dragging = false; track.classList.remove('drag');
    if (!muted) setFrom(moved ? e.clientX : downX); // a tap sets the volume to where you touched
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', () => { clearTimeout(muteT); dragging = false; track.classList.remove('drag', 'hold'); });
  // swipe on the d-pad also works, like a touch surface
  let sx, sy;
  dpad.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  dpad.addEventListener('touchmove', (e) => {
    const t = e.touches[0], dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.hypot(dx, dy) > 46) { haptic(); const k = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); send({ t: 'key', k }); ripple(dpad, k); sx = t.clientX; sy = t.clientY; }
  }, { passive: true });
  // brightness bar: tap or drag to set any level 1-100; hold the sun buttons to step
  const bt = s.querySelector('.btrack');
  const bFrom = (x) => { const r = bt.getBoundingClientRect(); return Math.max(1, Math.min(100, Math.round(((x - r.left) / r.width) * 100))); };
  let bDrag = false, bLast = 0, bT = null, bPend = null;
  const bSend = (v) => { state.brightness = v; drawBrightness(); bPend = v; const go = () => { if (bPend != null) { send({ t: 'bright', v: bPend }); bPend = null; bLast = Date.now(); } };
    clearTimeout(bT); if (Date.now() - bLast > 90) go(); else bT = setTimeout(go, 90); };
  bt.addEventListener('pointerdown', (e) => { e.preventDefault(); try { bt.setPointerCapture(e.pointerId); } catch {} bDrag = true; bt.classList.add('drag'); haptic(); bSend(bFrom(e.clientX)); });
  bt.addEventListener('pointermove', (e) => { if (bDrag) bSend(bFrom(e.clientX)); });
  const bEnd = (e) => { if (!bDrag) return; bDrag = false; bt.classList.remove('drag'); bSend(bFrom(e.clientX)); };
  bt.addEventListener('pointerup', bEnd); bt.addEventListener('pointercancel', () => { bDrag = false; bt.classList.remove('drag'); });
  s.querySelectorAll('[data-b]').forEach((b) => holdable(b, () => bSend(Math.max(1, Math.min(100, (state.brightness ?? 100) + Number(b.dataset.b)))), { repeat: 160, initial: 400, max: 20 }));
  drawVolume(); drawBrightness();
}
function drawBrightness() {
  const s = app.querySelector('.brightbar'); if (!s) return;
  const L = state.brightness ?? 100;
  s.querySelector('.vfill').style.width = L + '%';
  s.querySelector('.vknob').style.left = L + '%';
  s.querySelector('.vnum').textContent = L + '%';
}
// a ring of light that spreads from where you pressed
function ripple(dpad, where) {
  const r = document.createElement('i'); r.className = 'ripple r-' + where; dpad.appendChild(r);
  setTimeout(() => r.remove(), 650);
}
// show the change at once, then let the TV's real volume correct it
function nudgeVolume(d) {
  const v = state.volume || { level: 0.5, muted: false };
  state.volume = { level: Math.max(0, Math.min(1, v.level + d)), muted: false }; drawVolume(true);
}
function drawVolume(live) {
  const s = app.querySelector('.volbar:not(.brightbar)'); if (!s) return;
  const v = state.volume, pct = v && !v.muted ? Math.round(v.level * 100) : 0;
  s.querySelector('.vfill').style.width = pct + '%';
  s.querySelector('.vknob').style.left = pct + '%';
  s.querySelector('.vnum').textContent = !v ? 'Volume' : v.muted ? 'Muted' : pct;
  s.classList.toggle('muted', !!(v && v.muted));
  if (live) s.classList.add('live'), clearTimeout(drawVolume.t), (drawVolume.t = setTimeout(() => s.classList.remove('live'), 900));
}

// ===================================================================== keyboard screen
function buildKeyboard() {
  const s = app.querySelector('[data-s="keyboard"]');
  s.classList.add('pane');
  s.innerHTML = `<h2>Keyboard</h2><p class="hint">Type here and it appears on the TV — in Search, in dialogs, or in a website that’s open.</p>
    <input class="field" id="kbInput" placeholder="Start typing…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">
    <div class="row2"><button class="pill primary" id="kbGo">${icon('search')}Search</button><button class="pill" id="kbClear">Clear</button></div>`;
  const inp = s.querySelector('#kbInput');
  let last = '';
  const push = (submit) => {
    const v = inp.value;
    if (state.external) {
      // websites get real keystrokes: send only what changed
      if (v.startsWith(last)) { const add = v.slice(last.length); if (add) send({ t: 'text', v, append: add }); }
      else { for (let i = 0; i < last.length - v.length && i < 50; i++) send({ t: 'text', v, backspace: true }); if (!last.startsWith(v)) send({ t: 'text', v, append: v }); }
      if (submit) send({ t: 'key', k: 'select' });
    } else send({ t: 'text', v, submit });
    last = v;
  };
  inp.addEventListener('input', () => push(false));
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); push(true); inp.blur(); } });
  s.querySelector('#kbGo').onclick = () => push(true);
  s.querySelector('#kbClear').onclick = () => { inp.value = ''; push(false); inp.focus(); };
}

// ===================================================================== trackpad screen
function buildTrackpad() {
  const s = app.querySelector('[data-s="trackpad"]');
  s.innerHTML = `<div class="pad">Drag to move the pointer<br>Tap to click · two fingers to scroll<div class="touch"></div></div>
    <div class="clicks"><button class="pill" id="lclick">Click</button><button class="pill" id="rclick">Right-click</button></div>`;
  const pad = s.querySelector('.pad'), dot = s.querySelector('.touch');
  let last = null, start = null, moved = 0, acc = { x: 0, y: 0 }, raf = 0, scrollAcc = 0, fingers = 0;
  const flush = () => {
    raf = 0;
    if (Math.abs(acc.x) >= 1 || Math.abs(acc.y) >= 1) { send({ t: 'mouse', dx: Math.round(acc.x), dy: Math.round(acc.y) }); acc = { x: 0, y: 0 }; }
    if (Math.abs(scrollAcc) >= 40) { send({ t: 'scroll', dy: Math.round(-scrollAcc * 3) }); scrollAcc = 0; }
  };
  pad.addEventListener('touchstart', (e) => {
    e.preventDefault(); fingers = e.touches.length;
    const t = e.touches[0]; last = { x: t.clientX, y: t.clientY, time: performance.now() }; start = { ...last }; moved = 0;
    const r = pad.getBoundingClientRect(); dot.style.left = t.clientX - r.left + 'px'; dot.style.top = t.clientY - r.top + 'px'; dot.classList.add('on');
  }, { passive: false });
  pad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const t = e.touches[0], now = performance.now();
    const dx = t.clientX - last.x, dy = t.clientY - last.y, dt = Math.max(1, now - last.time);
    const speed = Math.hypot(dx, dy) / dt; // px per ms -> acceleration
    const gain = 1.6 + Math.min(3.2, speed * 2.4);
    moved += Math.hypot(dx, dy);
    if (e.touches.length >= 2) scrollAcc += dy; else { acc.x += dx * gain; acc.y += dy * gain; }
    last = { x: t.clientX, y: t.clientY, time: now };
    const r = pad.getBoundingClientRect(); dot.style.left = t.clientX - r.left + 'px'; dot.style.top = t.clientY - r.top + 'px';
    if (!raf) raf = requestAnimationFrame(flush);
  }, { passive: false });
  pad.addEventListener('touchend', (e) => {
    e.preventDefault(); dot.classList.remove('on');
    if (e.touches.length) return;
    if (moved < 8 && performance.now() - start.time < 300) send({ t: 'click', b: fingers >= 2 ? 'right' : 'left' });
  }, { passive: false });
  s.querySelector('#lclick').onclick = () => send({ t: 'click', b: 'left' });
  s.querySelector('#rclick').onclick = () => send({ t: 'click', b: 'right' });
}

// ===================================================================== backgrounds screen
async function buildBackgrounds() {
  const s = app.querySelector('[data-s="backgrounds"]');
  s.classList.add('pane');
  s.innerHTML = `<h2>Backgrounds</h2><p class="hint">Choose a photo to use behind the TV interface.</p><div class="msg">Loading…</div>`;
  let data;
  try { data = await api('/api/backgrounds'); } catch (e) { s.querySelector('.msg').textContent = e.message; return; }
  const cur = data.current;
  const modes = [['artwork', 'Artwork'], ['custom', 'Picture'], ['graphite', 'Graphite'], ['black', 'Black']];
  s.innerHTML = `<h2>Backgrounds</h2>
    <div class="seg-ctl">${modes.map(([k, l]) => `<button data-m="${k}" class="${cur.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="upload">${icon('image')}<span>Add a photo</span><input type="file" accept="image/*" id="file"></label>
    <div class="msg" id="bgmsg"></div>
    <div class="thumbs">${data.backgrounds.map((b) => `<div class="thumb ${cur.mode === 'custom' && cur.image === b.id ? 'on' : ''}" data-id="${b.id}" style="background-image:url('/bg/${encodeURIComponent(b.file)}?t=${encodeURIComponent(token)}')"><button class="x" data-del="${b.id}">${icon('close')}</button></div>`).join('')}</div>`;
  const msg = s.querySelector('#bgmsg');
  s.querySelectorAll('[data-m]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.m === 'custom' && !data.backgrounds.length) { msg.textContent = 'Add a photo first.'; return; }
    await api('/api/settings', { method: 'POST', body: { background: { mode: b.dataset.m, image: b.dataset.m === 'custom' ? (cur.image || data.backgrounds[0]?.id) : cur.image } } });
    buildBackgrounds();
  }));
  s.querySelectorAll('.thumb').forEach((t) => (t.onclick = async (e) => {
    if (e.target.closest('[data-del]')) return;
    await api('/api/settings', { method: 'POST', body: { background: { mode: 'custom', image: t.dataset.id } } });
    buildBackgrounds();
  }));
  s.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('Delete this background?')) return;
    await api(`/api/backgrounds/${b.dataset.del}`, { method: 'DELETE' }); buildBackgrounds();
  }));
  s.querySelector('#file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    msg.className = 'msg'; msg.textContent = 'Preparing photo…';
    try {
      const blob = await toJpeg(f, 2560);
      msg.textContent = 'Uploading…';
      await api('/api/backgrounds', { method: 'POST', body: blob, headers: { 'content-type': 'image/jpeg', 'x-filename': encodeURIComponent(f.name || 'Photo') } });
      buildBackgrounds();
    } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
  };
}
// Re-encode in the browser: converts iPhone HEIC to JPEG and shrinks big photos before upload.
function toJpeg(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that photo'))), 'image/jpeg', 0.9);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t a photo this phone can read')); };
    im.src = url;
  });
}

// ===================================================================== setup screen
async function buildSetup() {
  const s = app.querySelector('[data-s="setup"]');
  s.classList.add('pane');
  let cfg;
  try { cfg = await api('/api/config'); } catch (e) { s.innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
  s.innerHTML = `<h2>Setup</h2>
    <div class="label">TMDB API key</div>
    <p class="hint">${cfg.hasKey && !cfg.mock ? `Saved (${esc(cfg.keyHint)}). Paste a new one to replace it.` : 'Paste the API Key or the API Read Access Token from themoviedb.org/settings/api.'}</p>
    <input class="field" id="key" placeholder="Paste key here" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
    <div class="row2"><button class="pill primary" id="saveKey">Save Key</button></div><div class="msg" id="keymsg"></div>
    <div class="label">Free services</div>
    <div class="group">${Object.entries(cfg.serviceNames).map(([k, n]) => `<div class="item"><span>${esc(n)}</span><button class="sw ${cfg.services[k] ? 'on' : ''}" data-svc="${k}"></button></div>`).join('')}
      <div class="item"><span>Open websites in Brave</span><button class="sw ${cfg.webBrowser === 'brave' ? 'on' : ''}" id="brave"></button></div></div>
    <div class="label">Personal</div>
    <p class="hint">Lumen greets you by name on Home. The colour tints the highlights on the TV.</p>
    <input class="field" id="uName" placeholder="Your name" value="${esc(cfg.userName || '')}" autocomplete="off">
    <div class="accents">${[['white', '#f2f2f2'], ['amber', '#ffc970'], ['rose', '#ffa0b6'], ['mint', '#80e8ba'], ['sky', '#82c6ff'], ['lilac', '#c4acff'], ['red', '#ff453a'], ['scarlet', '#ff2a1a'], ['crimson', '#dc143c'], ['cherry', '#b3001b'], ['coral', '#ff7262']].map(([k, c]) => `<button class="acc ${(cfg.accent || 'white') === k ? 'on' : ''}" data-acc="${k}" style="background:${c}" aria-label="${k}"></button>`).join('')}
      <label class="acc wheel ${/^#/.test(cfg.accent || '') ? 'on' : ''}" aria-label="Any colour" ${/^#/.test(cfg.accent || '') ? `style="background:${esc(cfg.accent)}"` : ''}><input type="color" id="accPick" value="${/^#/.test(cfg.accent || '') ? esc(cfg.accent) : '#b3001b'}"></label></div>
    <div class="group"><div class="item"><span>Sounds on the TV</span><button class="sw ${cfg.sound?.on !== false ? 'on' : ''}" id="sndOn"></button></div></div>
    <div class="row2"><button class="pill primary" id="saveName">Save Name</button></div><div class="msg" id="namemsg"></div>
    <div class="label">Watch button</div>
    <p class="hint">Every film gets a Watch button that opens this address with the film’s name added — lowercase, spaces as “-”. a / is added at the end. Example: <b>movies.com</b> opens movies.com/the-dark-knight/. It opens full screen in Brave (ad blocker on) if Brave is installed. Use {name} to put the name mid-address, {year} for the year. Leave empty and Watch does nothing.</p>
    <input class="field" id="wlPattern" placeholder="movies.com" value="${esc(cfg.watchLink?.pattern || '')}" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false">
    <input class="field" id="wlName" placeholder="Button name (optional)" value="${esc(cfg.watchLink?.name || '')}">
    <div class="row2"><button class="pill primary" id="saveWl">Save Watch Link</button></div><div class="msg" id="wlmsg"></div>
    <div class="label">Website tiles</div>
    <div class="group">${(cfg.shortcuts || []).map((sc) => `<div class="item"><span>${esc(sc.name)}</span><span class="v">${esc(sc.url.replace(/^https?:\/\//, ''))}</span><button class="pill danger" data-delsc="${sc.id}" style="height:34px;padding:0 12px">Remove</button></div>`).join('') || '<div class="item"><span class="v">None yet</span></div>'}</div>
    <input class="field" id="scName" placeholder="Tile name">
    <input class="field" id="scUrl" placeholder="Web address" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false">
    <div class="row2"><button class="pill" id="addSc">${icon('plus')}Add Website</button></div><div class="msg" id="scmsg"></div>
    <div class="label">This phone</div>
    <div class="row2"><button class="pill danger" id="unpair">Unpair This iPhone</button></div>
    <p class="hint" style="margin-top:6px">Tip: Share → Add to Home Screen gives a full-screen remote. You’ll pair once more from the Home Screen icon.</p>`;
  s.querySelector('#saveKey').onclick = async () => {
    const m = s.querySelector('#keymsg'); m.className = 'msg'; m.textContent = 'Checking with TMDB…';
    try { await api('/api/settings', { method: 'POST', body: { tmdbKey: s.querySelector('#key').value.trim() } }); m.textContent = 'Saved — the TV is loading films now.'; s.querySelector('#key').value = ''; }
    catch (e) { m.className = 'msg err'; m.textContent = e.message; }
  };
  s.querySelectorAll('[data-svc]').forEach((b) => (b.onclick = async () => { b.classList.toggle('on'); await api('/api/settings', { method: 'POST', body: { services: { [b.dataset.svc]: b.classList.contains('on') } } }).catch(() => b.classList.toggle('on')); }));
  s.querySelector('#brave').onclick = async (e) => {
    const b = e.currentTarget; const on = !b.classList.contains('on');
    if (on && !cfg.system?.brave) { flashMsg('Brave isn’t installed on the TV laptop'); return; }
    b.classList.toggle('on', on); await api('/api/settings', { method: 'POST', body: { webBrowser: on ? 'brave' : 'edge' } });
  };
  s.querySelector('#saveName').onclick = async () => {
    const m = s.querySelector('#namemsg'); m.className = 'msg';
    try { await api('/api/settings', { method: 'POST', body: { userName: s.querySelector('#uName').value } }); m.textContent = 'Saved — say hello to your TV.'; }
    catch (e) { m.className = 'msg err'; m.textContent = e.message; }
  };
  const pick = s.querySelector('#accPick'), wheel = s.querySelector('.acc.wheel');
  let pickT; // the colour wheel: the TV follows along as you drag
  pick.oninput = () => {
    s.querySelectorAll('.acc').forEach((x) => x.classList.toggle('on', x === wheel)); wheel.style.background = pick.value;
    clearTimeout(pickT); pickT = setTimeout(() => api('/api/settings', { method: 'POST', body: { accent: pick.value } }).catch(() => {}), 150);
  };
  s.querySelectorAll('[data-acc]').forEach((b) => (b.onclick = async () => {
    s.querySelectorAll('.acc').forEach((x) => x.classList.toggle('on', x === b)); wheel.style.background = '';
    await api('/api/settings', { method: 'POST', body: { accent: b.dataset.acc } }).catch(() => {});
  }));
  s.querySelector('#sndOn').onclick = async (e) => {
    const b = e.currentTarget; b.classList.toggle('on');
    await api('/api/settings', { method: 'POST', body: { sound: { on: b.classList.contains('on') } } }).catch(() => b.classList.toggle('on'));
  };
  s.querySelector('#saveWl').onclick = async () => {
    const m = s.querySelector('#wlmsg'); m.className = 'msg';
    try { await api('/api/settings', { method: 'POST', body: { watchLink: { pattern: s.querySelector('#wlPattern').value, name: s.querySelector('#wlName').value } } }); m.textContent = 'Saved — open any film on the TV and press Watch.'; }
    catch (e) { m.className = 'msg err'; m.textContent = e.message; }
  };
  s.querySelectorAll('[data-delsc]').forEach((b) => (b.onclick = async () => { await api(`/api/shortcuts/${b.dataset.delsc}`, { method: 'DELETE' }); buildSetup(); }));
  s.querySelector('#addSc').onclick = async () => {
    const m = s.querySelector('#scmsg'); m.className = 'msg';
    try { await api('/api/shortcuts', { method: 'POST', body: { name: s.querySelector('#scName').value, url: s.querySelector('#scUrl').value } }); buildSetup(); }
    catch (e) { m.className = 'msg err'; m.textContent = e.message; }
  };
  s.querySelector('#unpair').onclick = async () => {
    if (!confirm('Unpair this iPhone? You can pair again from the TV.')) return;
    await api('/api/me', { method: 'DELETE' }).catch(() => {});
    unpaired();
  };
}

// ===================================================================== start
const params = new URLSearchParams(location.search);
if (params.get('code') || !token) pairingScreen();
else startRemote();
