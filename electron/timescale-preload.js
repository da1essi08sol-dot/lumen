// Filming only (LUMEN_TIMESCALE): runs the TV page's clock and timers slower than real time, so that
// a slow computer can draw every frame; the recording is sped back up afterwards for smooth 60 fps video.
'use strict';
const R = Number(process.env.LUMEN_TIMESCALE);
if (R > 0 && R < 1) {
  const pn = performance.now.bind(performance), dn = Date.now, base = pn(), dbase = dn();
  performance.now = () => base + (pn() - base) * R;
  Date.now = () => dbase + (dn() - dbase) * R;
  const st = window.setTimeout.bind(window), si = window.setInterval.bind(window), raf = window.requestAnimationFrame.bind(window);
  window.setTimeout = (fn, ms = 0, ...a) => st(fn, (+ms || 0) / R, ...a);
  window.setInterval = (fn, ms = 0, ...a) => si(fn, (+ms || 0) / R, ...a);
  window.requestAnimationFrame = (cb) => raf((ts) => cb(base + (ts - base) * R));
}
