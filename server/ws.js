// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close). No dependencies.
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class Socket extends EventEmitter {
  constructor(sock) {
    super();
    this.sock = sock;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.alive = true;
    sock.setNoDelay(true);
    sock.on('data', (d) => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  _closed() { if (this.open) { this.open = false; this.emit('close'); } }
  _data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { this.close(); return; } // 1 MB cap; remotes send tiny messages
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const m = this.buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
      }
      this.buf = this.buf.subarray(need);
      this._frame(fin, op, payload);
    }
  }
  _frame(fin, op, payload) {
    if (op === 0x8) { this.close(); return; }
    if (op === 0x9) { this._send(0xA, payload); return; }
    if (op === 0xA) { this.alive = true; return; }
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      this.frags.push(payload);
      if (fin) {
        const msg = Buffer.concat(this.frags).toString('utf8');
        this.frags = [];
        let parsed; try { parsed = JSON.parse(msg); } catch { return; }
        this.emit('message', parsed);
      }
    }
  }
  _send(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.sock.write(Buffer.concat([head, payload])); } catch { this._closed(); }
  }
  send(obj) { this._send(0x1, Buffer.from(JSON.stringify(obj))); }
  ping() { this._send(0x9, Buffer.alloc(0)); }
  close() {
    if (!this.open) return;
    this._send(0x8, Buffer.alloc(0));
    this.open = false;
    try { this.sock.end(); } catch {}
    this.emit('close');
  }
}

// Attach to an http.Server. `accept(req)` returns metadata or null to reject.
function attach(server, pathname, accept, onConnection) {
  server.on('upgrade', (req, sock) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== pathname || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
    const meta = accept(req, url);
    if (!meta) { sock.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); sock.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { sock.destroy(); return; }
    const accepted = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accepted}\r\n\r\n`);
    const ws = new Socket(sock);
    onConnection(ws, meta);
  });
  // Heartbeat: drop dead connections (phone locked, Wi-Fi dropped) within ~30s.
  setInterval(() => {
    for (const ws of attach.sockets) {
      if (!ws.alive) { ws.close(); continue; }
      ws.alive = false; ws.ping();
    }
  }, 15000).unref();
}
attach.sockets = new Set();

module.exports = { attach, Socket };
