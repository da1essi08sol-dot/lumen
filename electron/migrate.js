// Bringing settings over from the older Lumen (1.x), which kept everything in a "data" folder next to its files.
// Runs once, the first time the app starts with no settings of its own. Copies (never moves) the old data,
// so the old Lumen folder is left exactly as it was.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// browser caches are big and rebuilt by themselves; sign-ins and settings are what matter
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'GrShaderCache', 'ShaderCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'CacheStorage', 'ScriptCache', 'Crashpad', 'tv-profile']);

function dataDirOf(dir) {
  if (!dir) return null;
  for (const c of [path.join(dir, 'data'), dir]) {
    try { if (fs.existsSync(path.join(c, 'store.json'))) return c; } catch {}
  }
  return null;
}

function copyData(from, to, log) {
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, {
    recursive: true, force: false, errorOnExist: false,
    filter: (src) => {
      const b = path.basename(src);
      if (SKIP.has(b)) return false;
      if (/^(lumen\.log|.*\.tmp|.*\.lock|SingletonLock|SingletonSocket|SingletonCookie|lockfile)$/i.test(b)) return false;
      return true;
    },
  });
  log(`imported settings from ${from}`);
}

// where an older Lumen is likely to be: wherever its shortcuts point, or the usual folders
function candidates(shell) {
  const out = [];
  const home = os.homedir();
  const appdata = process.env.APPDATA || '';
  const lnks = [
    path.join(home, 'Desktop', 'Lumen.lnk'), path.join(home, 'OneDrive', 'Desktop', 'Lumen.lnk'),
    path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Lumen', 'Lumen.lnk'),
    path.join(appdata, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Lumen.lnk'),
  ];
  if (process.platform === 'win32' && shell?.readShortcutLink) {
    for (const l of lnks) {
      try {
        const s = shell.readShortcutLink(l);
        const m = String(s.args || '').match(/"?([^"]+?)\\windows\\Start Lumen\.vbs"?/i);
        if (m) out.push(m[1]);
      } catch {}
    }
  }
  for (const base of [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents'), path.join(home, 'Desktop'), path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'Downloads'), home, 'C:\\']) {
    out.push(path.join(base, 'Lumen'), path.join(base, 'Lumen-TV', 'Lumen'), path.join(base, 'Lumen-TV'));
  }
  return [...new Set(out)];
}

// was the older Lumen set to start when you sign in? (its startup shortcut ran "Start Lumen.vbs")
function oldAutostart(shell) {
  if (process.platform !== 'win32' || !shell?.readShortcutLink) return false;
  const l = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Lumen.lnk');
  try { return /Start Lumen\.vbs/i.test(shell.readShortcutLink(l).args || ''); } catch { return false; }
}

function run({ DATA, oldRoot, log, shell }) {
  try {
    if (fs.existsSync(path.join(DATA, 'store.json'))) return null; // already has its own settings
    const auto = oldAutostart(shell);
    const list = oldRoot ? [oldRoot, ...candidates(shell)] : candidates(shell);
    for (const c of list) {
      const d = dataDirOf(c);
      if (!d || path.resolve(d) === path.resolve(DATA)) continue;
      copyData(d, DATA, log);
      return { from: d, autostart: auto };
    }
    return auto ? { autostart: true } : null;
  } catch (e) { log('import of older settings failed:', e.message); return null; }
}

function importFrom(dir, DATA, log) {
  const d = dataDirOf(dir);
  if (!d) return { ok: false };
  try {
    for (const f of ['store.json', 'tmdb-cache.json']) { try { fs.rmSync(path.join(DATA, f), { force: true }); } catch {} }
    copyData(d, DATA, log);
    return { ok: true, from: d };
  } catch (e) { log('import failed:', e.message); return { ok: false, error: e.message }; }
}

module.exports = { run, importFrom, dataDirOf };
