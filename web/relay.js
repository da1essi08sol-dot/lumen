// Phone remotes for Lumen Web with no laptop and no app. The TV page (a phone showing Lumen's TV look, on its own or
// mirrored to the TV) talks to the remote phone directly over WebRTC (PeerJS). PeerJS's free public server only
// introduces the two phones to each other; key presses then go phone to phone. Pairing works like the laptop's:
// a 6-digit code (5 tries, 5 minutes), then a random token the remote keeps. It acts as window.LumenBox, the same
// door the iPhone app uses, so the backend needs nothing else.
const KEYS = ['up', 'down', 'left', 'right', 'select', 'back', 'home', 'playpause', 'main', 'menu'];
const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map((x) => (x % 36).toString(36)).join(''); };
const peerOpts = () => ({ debug: 0, ...get('lumen.peer', {}) }); // lumen.peer: a different PeerJS server (tests)
const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s); });

export function startRelay(backend) {
  if (window.LumenBox) return; // the iPhone app does this itself
  let id = get('lumen.tvId', null);
  if (!id) { id = 'lumen-tv-' + rand(16); put('lumen.tvId', id); }
  let devices = get('lumen.remotes', []); // { id, name, token, createdAt, lastSeen }
  const saveDevs = () => put('lumen.remotes', devices);
  let pairing = null, peer = null, live = { view: 'home', textInput: false, inPlayer: false };
  const conns = new Set(); // remotes with their remote screen open
  const notify = backend.notify;

  const state = () => ({ t: 'state', tvConnected: true, ...live, external: null, volume: null, sleep: null, ...backend.remoteLook() });
  const pushState = () => { const s = state(); conns.forEach((c) => { try { c.send(s); } catch {} }); };
  const count = (name) => notify({ t: 'remotes', count: conns.size, name });

  window.LumenBox = {
    web: true, host: '',
    get devices() { return devices.map(({ id, name, createdAt, lastSeen }) => ({ id, name, createdAt, lastSeen })); },
    remoteUrl: (code) => new URL(`../remote/?tv=${encodeURIComponent(id)}&code=${code}`, location.href).href,
    post(m) {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'pairing') pairing = { code: m.code, expires: m.expires, attempts: 0 };
      else if (m.t === 'unpair') {
        devices = devices.filter((d) => d.id !== m.id); saveDevs();
        conns.forEach((c) => { if (c.dev?.id === m.id) { try { c.send({ t: 'ws-denied' }); c.close(); } catch {} conns.delete(c); } });
        count();
      } else if (m.t === 'state') { live = { view: m.view, textInput: !!m.textInput, inPlayer: !!m.inPlayer }; pushState(); }
      else if (m.t === 'brightness' || m.t === 'settings') pushState();
    },
  };
  // the TV's colour, name or brightness changed: tell the remotes
  addEventListener('lumen-server', (e) => { if (['brightness', 'settings', 'config'].includes(e.detail?.t)) pushState(); });

  const byToken = (t) => (typeof t === 'string' && t.length > 20 && devices.find((d) => d.token === t)) || null;
  async function onApi(c, d) {
    const reply = (status, data) => { try { c.send({ rid: d.rid, status, data }); } catch {} };
    const path = String(d.api || ''), method = String(d.method || 'GET').toUpperCase(), body = d.body;
    if (path === '/api/pair' && method === 'POST') {
      const ok = pairing && Date.now() < pairing.expires && pairing.attempts < 5 && body && body.code === pairing.code;
      if (!ok) {
        if (pairing) pairing.attempts++;
        return reply(403, { error: pairing && Date.now() < pairing.expires && pairing.attempts < 5 ? 'That code is not right.' : 'Pairing code expired. Open Pair a Remote on the TV for a new one.' });
      }
      pairing = null;
      const dev = { id: crypto.randomUUID(), name: (typeof body.name === 'string' && body.name.trim().slice(0, 40)) || 'iPhone', token: rand(40), createdAt: Date.now(), lastSeen: Date.now() };
      devices.push(dev); saveDevs();
      notify({ t: 'paired', name: dev.name });
      return reply(200, { token: dev.token, deviceId: dev.id, deviceName: backend.remoteLook().deviceName });
    }
    const dev = byToken(d.token);
    if (!dev) return reply(401, { error: 'This phone is no longer paired.' });
    dev.lastSeen = Date.now(); saveDevs();
    if (path === '/api/me') {
      if (method === 'DELETE') { window.LumenBox.post({ t: 'unpair', id: dev.id }); return reply(200, { ok: true }); }
      return reply(200, { device: { id: dev.id, name: dev.name } });
    }
    if (path === '/api/volume') return reply(200, null);
    if (path.startsWith('/api/backgrounds') && method !== 'GET') return reply(400, { error: 'Pictures can’t be added on Lumen Web.' });
    try { reply(200, await backend.api(path, { method, body })); }
    catch (e) { reply(e.status || 400, { error: e.message || 'Something went wrong' }); }
  }
  function onSocket(c, m) {
    switch (m.t) {
      case 'key': if (KEYS.includes(m.k)) notify({ t: 'key', k: m.k }); break;
      case 'text': if (typeof m.v === 'string') notify({ t: 'text', v: m.v.slice(0, 200), submit: !!m.submit }); break;
      case 'bright': {
        const cur = backend.remoteLook().brightness, v = Number.isFinite(m.v) ? m.v : cur + (Number(m.d) || 0);
        backend.api('/api/settings', { method: 'POST', body: { brightness: { level: v } } }).then(pushState, () => {}); break;
      }
      case 'ping': c.send({ t: 'pong' }); break;
      case 'hello': case 'vol': c.send(state()); break;
    }
  }
  function onConn(c) {
    c.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      if (d.rid != null) { onApi(c, d); return; }
      if (d.t === 'ws') {
        const dev = byToken(d.token);
        if (!dev) { c.send({ t: 'ws-denied' }); return; }
        c.dev = dev; dev.lastSeen = Date.now(); saveDevs();
        conns.add(c); c.send({ t: 'ws-open' }); c.send(state()); count(dev.name); return;
      }
      if (c.dev && conns.has(c)) onSocket(c, d);
    });
    const gone = () => { if (conns.delete(c)) count(); };
    c.on('close', gone); c.on('error', gone);
  }

  let retry = 0;
  function open() {
    try { peer?.destroy(); } catch {}
    peer = new window.Peer(id, peerOpts());
    peer.on('open', () => { retry = 0; });
    peer.on('connection', onConn);
    peer.on('disconnected', () => { setTimeout(() => { if (peer && !peer.destroyed && peer.disconnected) try { peer.reconnect(); } catch {} }, 1500); });
    peer.on('error', (e) => {
      // the id is still held by this page's last visit (it frees in a few seconds), or the network dropped
      if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) setTimeout(open, Math.min(2000 * ++retry, 15000));
    });
  }
  loadScript(new URL('./vendor/peerjs.min.js', import.meta.url).href).then(open).catch((e) => console.warn('remote', e.message));
  // coming back to the page after the phone slept or Safari paused it
  document.addEventListener('visibilitychange', () => { if (!document.hidden && window.Peer && (!peer || peer.destroyed || peer.disconnected)) open(); });
}
