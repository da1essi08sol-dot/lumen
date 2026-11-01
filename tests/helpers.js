// Starts a real Lumen server with test data (no TMDB, no Windows calls) for the API tests.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-test-'));
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port), LUMEN_DATA: data, LUMEN_MOCK: '1', LUMEN_SYSTEM: 'mock' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start:\n' + out)), 15000);
    child.stdout.on('data', (d) => { out += d; if (out.includes('Lumen running')) { clearTimeout(t); resolve(); } });
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (c) => reject(new Error(`server exited (${c}):\n${out}`)));
  });
  const base = `http://127.0.0.1:${port}`;
  const api = async (p, { method = 'GET', body, host = '127.0.0.1', headers = {} } = {}) => {
    const r = await fetch(`http://${host}:${port}${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text };
  };
  return { port, base, data, api, stop: () => { child.kill(); fs.rmSync(data, { recursive: true, force: true }); } };
}

// an IPv4 address of this machine that isn't loopback (to test how Lumen treats other devices)
function otherAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return null;
}

module.exports = { startServer, otherAddress };
