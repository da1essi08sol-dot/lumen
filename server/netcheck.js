'use strict';
const os = require('os');

// Lumen only answers devices on your own home network: even if a router or VPN ever passed traffic in from the
// internet, nothing outside your network can reach the remote, the pairing page or your films.
function onHomeNetwork(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '');
  const v4 = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [x, y] = [+v4[1], +v4[2]];
    return x === 127 || x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168) || (x === 169 && y === 254) || (x === 100 && y >= 64 && y <= 127);
  }
  const l = a.toLowerCase();
  if (l === '::1' || /^fe[89ab]/.test(l) || /^f[cd]/.test(l)) return true; // link-local, private (ULA)
  // a public IPv6 address in this computer's own network (same /64)
  const pre = (x) => x.split(':').slice(0, 4).join(':');
  return Object.values(os.networkInterfaces()).flat().some((i) => i && i.family === 'IPv6' && !i.internal && pre(i.address.toLowerCase()) === pre(l));
}

module.exports = { onHomeNetwork };
