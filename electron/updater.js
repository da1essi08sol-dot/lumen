// Keeping Lumen up to date.
//
// Two places a new version can come from:
//   1. GitHub releases (automatic): set "updateRepo" in package.json → "lumen" to "your-name/lumen".
//      Lumen then checks by itself every few hours and offers the new version on the TV.
//   2. Your Downloads folder: a "Lumen-Setup-<version>.exe" or "Lumen-<version>-win.zip" you downloaded or
//      were sent. Works with no account at all.
// Installing: the app saves everything, closes, the new version is put in place, and Lumen opens again.
// Your settings live in a separate folder, so an update never touches them.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

const NAME_RE = /^Lumen[-_ ](?:Setup[-_ ])?v?(\d+\.\d+\.\d+)(?:[-_ ]win(?:dows)?)?(?:[-_ ]x64)?(?: \(\d+\))?\.(exe|zip)$/i;

function cmp(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0), pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
}

module.exports = function createUpdater({ app, pkg, log, broadcast }) {
  const repo = String(pkg.lumen?.updateRepo || process.env.LUMEN_UPDATE_REPO || '').trim();
  const validRepo = /^[\w.-]+\/[\w.-]+$/.test(repo);
  let last = null, lastAt = 0, busy = false, timer = null, announced = null;

  function describe() {
    return { github: validRepo ? repo : null, downloads: true, installing: busy };
  }

  async function fromGithub() {
    if (!validRepo) return null;
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { 'user-agent': `Lumen/${pkg.version}`, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    const rel = await r.json();
    const version = String(rel.tag_name || '').replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) return null;
    const assets = rel.assets || [];
    const asset = (process.platform === 'win32'
      ? assets.find((a) => /setup.*\.exe$/i.test(a.name)) || assets.find((a) => /win.*\.zip$/i.test(a.name))
      : null);
    if (!asset) return null;
    return { source: 'github', version, name: asset.name, url: asset.browser_download_url, size: asset.size, notes: String(rel.body || '').slice(0, 2000) };
  }

  function fromDownloads() {
    let dir; try { dir = app.getPath('downloads'); } catch { return null; }
    let best = null;
    let files = []; try { files = fs.readdirSync(dir); } catch {}
    for (const f of files) {
      const m = f.match(NAME_RE); if (!m) continue;
      if (!best || cmp(m[1], best.version) > 0) best = { source: 'downloads', version: m[1], name: f, file: path.join(dir, f) };
    }
    return best;
  }

  async function check(force = false) {
    if (!force && last && Date.now() - lastAt < 10 * 60e3) return last;
    let note = '';
    const found = [];
    try { const g = await fromGithub(); if (g) found.push(g); } catch (e) { note = `Couldn’t reach GitHub (${e.message}).`; }
    const d = fromDownloads(); if (d) found.push(d);
    const newest = found.filter((f) => cmp(f.version, pkg.version) > 0).sort((a, b) => cmp(b.version, a.version) || (a.source === 'downloads' ? -1 : 1))[0];
    last = newest
      ? { supported: true, installed: pkg.version, found: true, version: newest.version, source: newest.source, name: newest.name, notes: newest.notes || '', zip: newest.name, _c: newest }
      : { supported: true, installed: pkg.version, found: false, note: note || (validRepo ? '' : 'Automatic updates are not set up yet; Lumen looks in your Downloads folder.') };
    lastAt = Date.now();
    const { _c, ...pub } = last;
    return pub;
  }

  function download(url, to, size) {
    return new Promise(async (resolve, reject) => {
      try {
        const r = await fetch(url, { headers: { 'user-agent': `Lumen/${pkg.version}` }, redirect: 'follow' });
        if (!r.ok || !r.body) throw new Error(`download failed (${r.status})`);
        const total = +r.headers.get('content-length') || size || 0;
        const out = fs.createWriteStream(to);
        let got = 0, shown = 0;
        for await (const chunk of r.body) {
          out.write(chunk); got += chunk.length;
          const p = total ? Math.floor((got / total) * 100) : 0;
          if (p !== shown) { shown = p; broadcast({ t: 'update-progress', p }); }
        }
        out.end(() => resolve(to));
      } catch (e) { reject(e); }
    });
  }

  // put the new version in place: an installer runs by itself; a zip is unpacked and its installer run
  async function install(_b, beforeQuit) {
    if (busy) return; busy = true;
    try {
      const c = (await check(true), last?._c);
      if (!c) { busy = false; broadcast({ t: 'update-failed', error: 'No newer version found' }); return; }
      if (process.platform !== 'win32') { busy = false; broadcast({ t: 'update-failed', error: 'Updating is only built in on Windows' }); return; }
      const work = path.join(os.tmpdir(), `lumen-update-${c.version}`);
      fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
      let file = c.file;
      if (c.source === 'github') { broadcast({ t: 'update-progress', p: 0 }); file = await download(c.url, path.join(work, c.name), c.size); }
      log(`installing Lumen ${c.version} from ${file}`);
      broadcast({ t: 'update-installing', version: c.version });
      if (/\.exe$/i.test(file)) {
        // the installer made by GitHub (electron-builder): runs silently and opens Lumen when done
        beforeQuit?.();
        spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        setTimeout(() => app.exit(0), 400);
        return;
      }
      // a Lumen zip: unpack it, then its installer waits for Lumen to close, copies the new files and reopens Lumen
      await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${file.replace(/'/g, "''")}' -DestinationPath '${work.replace(/'/g, "''")}' -Force`],
      { windowsHide: true, timeout: 180000 }, (e) => (e ? rej(e) : res())));
      const script = findFile(work, 'install.ps1');
      if (!script) throw new Error('That zip doesn’t contain a Lumen installer');
      beforeQuit?.();
      spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-Quiet', '-Update'],
        { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setTimeout(() => app.exit(0), 400);
    } catch (e) {
      busy = false; log('update failed:', e.message);
      broadcast({ t: 'update-failed', error: e.message });
    }
  }

  function findFile(dir, name, depth = 0) {
    if (depth > 3) return null;
    let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const e of list) if (e.isFile() && e.name.toLowerCase() === name) return path.join(dir, e.name);
    for (const e of list) if (e.isDirectory()) { const f = findFile(path.join(dir, e.name), name, depth + 1); if (f) return f; }
    return null;
  }

  // check a little after start-up, then every 6 hours; the TV shows a note when there's a new version
  function start() {
    if (process.env.LUMEN_APP_TEST === '1' || timer) return;
    const tick = async () => {
      try {
        const r = await check(true);
        if (r.found && announced !== r.version) { announced = r.version; broadcast({ t: 'update-available', version: r.version, source: r.source }); }
      } catch {}
    };
    setTimeout(tick, 45e3);
    timer = setInterval(tick, 6 * 3600e3);
  }

  return { check, install, start, describe, cmp };
};
