// Platform layer: real system volume, OS key/mouse injection, external app windows.
'use strict';
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { startGuard, prepareGuard, loadingPageUrl, GUARD_ARGS } = require('./guard');

const TV_UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';

function firstExisting(list) { return list.find((p) => p && fs.existsSync(p)) || null; }

// ---------------- Windows ----------------
class WindowsSystem extends EventEmitter {
  constructor(dataDir) {
    super();
    this.name = 'windows';
    this.dataDir = dataDir;
    this.jobs = new Map(); this.seq = 0; // numbered commands: each reply is matched to its own command
    this.external = null;
    this._startHelper();
    const pf = process.env.ProgramFiles || 'C:\\Program Files', pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', la = process.env.LOCALAPPDATA || '';
    this.browser = firstExisting([`${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${la}\\Google\\Chrome\\Application\\chrome.exe`]);
    this.vlc = firstExisting([`${pf}\\VideoLAN\\VLC\\vlc.exe`, `${pf86}\\VideoLAN\\VLC\\vlc.exe`]);
    this.brave = firstExisting([`${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${pf86}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${la}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`]);
  }
  _startHelper() {
    const script = path.join(__dirname, 'win-helper.ps1');
    this.ready = false;
    this.helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    this.helper.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) { this.ready = true; continue; }
        const job = this.jobs.get(msg.id); // a late reply to a command we gave up on is simply ignored
        if (!job) continue;
        this.jobs.delete(msg.id);
        msg.ok === false ? job.reject(new Error(msg.error || 'helper error')) : job.resolve(msg);
      }
    });
    this.helper.stderr.on('data', (d) => console.error('[win-helper]', d.toString().trim()));
    this.helper.on('exit', (code) => {
      console.error('[win-helper] exited', code, '- restarting in 2s');
      for (const j of this.jobs.values()) j.reject(new Error('helper exited'));
      this.jobs.clear();
      setTimeout(() => this._startHelper(), 2000);
    });
  }
  cmd(line) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.jobs.set(id, { resolve, reject });
      try { this.helper.stdin.write(`#${id} ${line}\n`); } catch (e) { this.jobs.delete(id); reject(e); return; }
      setTimeout(() => { if (this.jobs.has(id)) { this.jobs.delete(id); reject(new Error('helper timeout')); } }, 4000);
    });
  }
  getVolume() { return this.cmd('GETVOL'); }
  setVolume(v) { return this.cmd(`SETVOL ${Math.max(0, Math.min(1, v)).toFixed(3)}`); }
  stepVolume(d) { return this.cmd(`VOLSTEP ${d.toFixed(3)}`); }
  toggleMute() { return this.cmd('MUTE'); }
  setBrightness(pct) { return this.cmd(`BRIGHT ${Math.round(pct)}`); } // backlight over DDC/CI; {screens: n}
  key(k) { return this.cmd(`KEY ${k}`); }
  type(text) { return this.cmd(`TYPE ${Buffer.from(text, 'utf8').toString('base64')}`); }
  mouseMove(dx, dy) { return this.cmd(`MOVE ${Math.round(dx)} ${Math.round(dy)}`); }
  click(b) { return this.cmd(`CLICK ${b === 'right' ? 'right' : 'left'}`); }
  scroll(dy) { return this.cmd(`SCROLL ${Math.round(dy)}`); }
  focusTv() { return this.cmd('FOCUS Lumen').catch(() => {}); }
  screenOff() { return this.cmd('SCREENOFF').catch(() => {}); }
  minimizeTv() { return this.cmd('MINIMIZE Lumen').catch(() => {}); }

  _launch(exe, args, kind, label) {
    this.closeExternal(true);
    const child = spawn(exe, args, { detached: false, stdio: 'ignore' });
    const ext = { child, kind, label, pid: child.pid };
    this.external = ext;
    child.on('exit', () => { ext.exited = true; if (this.external === ext) { this.external = null; this.emit('external', null); this.focusTv(); } });
    child.on('error', (e) => { console.error('launch failed', e.message); if (this.external === ext) { this.external = null; this.emit('external', null); this.focusTv(); } });
    this.emit('external', { kind, label });
    // Bring the app to the front first, and only then step Lumen's window aside, so the desktop never flashes.
    this._bringToFront(ext, 0);
    return { kind, label };
  }
  _bringToFront(ext, tries) {
    if (this.external !== ext) return;
    const minimizeLumen = () => this.minimizeTv();
    if (tries > 25) { minimizeLumen(); return; }
    this.cmd(`FOCUSPID ${ext.pid}`).then((r) => { if (r.focused) setTimeout(minimizeLumen, 300); else setTimeout(() => this._bringToFront(ext, tries + 1), 250); })
      .catch(() => setTimeout(() => this._bringToFront(ext, tries + 1), 250));
  }
  openWeb(url, { label = '', youtube = false, browser = 'edge', assist = null, setup = false, smoothSkip = true } = {}) {
    // Normal Watch playback is hosted inside Lumen's own Electron Chromium surface.
    // The extension-install/setup flow remains in the user's external browser.
    const shell = global.lumenShell;
    if (!setup && shell?.openPlayback) {
      this.closeExternal(true);
      const ext = { child: null, kind: youtube ? 'youtube' : 'web', label, pid: null, guard: null };
      const controller = shell.openPlayback({
        url, label, youtube, assist,
        onClosed: () => {
          if (this.external === ext) { this.external = null; this.emit('external', null); }
        }
      });
      ext.guard = controller;
      this.external = ext;
      this.emit('external', { kind: ext.kind, label });
      return { kind: ext.kind, label };
    }
    const useBrave = browser === 'brave' && this.brave;
    const exe = useBrave ? this.brave : this.browser;
    if (!exe) throw Object.assign(new Error('Microsoft Edge or Chrome was not found'), { status: 500 });
    // Dedicated profile per browser: its own process tree, so Home on the remote can close it cleanly.
    const profile = path.join(this.dataDir, useBrave ? 'web-profile-brave' : 'web-profile');
    // setup: an ordinary browser window (address bar, extensions menu) on the same profile, to install an ad blocker
    // assist: Lumen's watch helper (loading screen, pop-up/redirect blocking, auto-play, progress) — see guard.js
    const first = assist && !setup ? loadingPageUrl(assist.cover, url) : url;
    const args = [setup ? url : `--app=${first}`, setup ? '--start-maximized' : '--start-fullscreen', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate',
      '--disable-direct-composition-video-overlays']; // stops full-screen video going black after skipping (see guard.js)
    // Software video decoding (off unless chosen in Settings): avoids a graphics-driver fault where skipping
    // turns the picture black — but some formats (e.g. H.265/HEVC) can't be decoded this way at all, giving
    // sound with no picture. Lumen notices that and switches it back off by itself (see onNoPicture).
    if (smoothSkip) args.push('--disable-accelerated-video-decode', '--disable-gpu-memory-buffer-video-frames');
    if (youtube) args.push(`--user-agent=${TV_UA}`);
    if (assist && !setup) { prepareGuard(profile); args.push(...GUARD_ARGS); }
    const r = this._launch(exe, args, youtube ? 'youtube' : 'web', label);
    if (assist && !setup && this.external) this.external.guard = startGuard({ ...assist, onNoPicture: assist.onNoPicture ? (p) => assist.onNoPicture(p, smoothSkip) : null, brightness: this.brightness ?? 1, userDataDir: profile, startUrl: url, onChoice: (c) => { if (c === 'back') this.closeExternal(); }, log: (m) => console.log('[watch]', m) });
    return r;
  }
  openVlc(file, label) {
    if (!this.vlc) throw Object.assign(new Error('VLC is not installed'), { status: 404 });
    return this._launch(this.vlc, ['--fullscreen', '--play-and-exit', '--no-video-title-show', '--qt-minimal-view', file], 'vlc', label);
  }
  closeExternal(silent) {
    const ext = this.external;
    if (!ext) return false;
    this.external = null;
    // Close the browser properly first, so it writes your sign-ins to disk (a forced close can lose them);
    // only if it hasn't closed after a few seconds is it forced.
    if (ext.guard?.closeBrowser) {
      Promise.resolve(ext.guard.closeBrowser()).catch((e) => console.error('[browser] close:', e.message)).finally(() => ext.guard?.stop?.());
      if (!silent) { this.emit('external', null); }
      return true;
    }
    const force = () => { if (!ext.exited) execFile('taskkill', ['/PID', String(ext.pid), '/T', '/F'], { windowsHide: true }, () => {}); };
    const polite = () => execFile('taskkill', ['/PID', String(ext.pid), '/T'], { windowsHide: true }, () => {});
    Promise.resolve(ext.guard?.closeBrowser?.()).then((ok) => { if (!ok) polite(); }).catch(polite).finally(() => ext.guard?.stop());
    setTimeout(force, ext.kind === 'vlc' ? 1500 : 3500);
    if (!silent) setTimeout(() => this.focusTv(), 400);
    if (!silent) { this.emit('external', null); setTimeout(() => this.focusTv(), 700); }
    return true;
  }
  launchTv(url) {
    if (!this.browser) return false;
    spawn(this.browser, [`--kiosk`, url, '--edge-kiosk-type=fullscreen', `--user-data-dir=${path.join(this.dataDir, 'tv-profile')}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  quit() {
    try {
      const script = path.join(__dirname, '..', '..', 'windows', 'start-lumen.ps1');
      spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, '-stop'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {}
    setTimeout(() => process.exit(0), 4000); // in case the script couldn't run
  }
  info() { return { platform: 'windows', browser: !!this.browser, brave: !!this.brave, vlc: !!this.vlc, helper: this.ready }; }
}

// ---------------- Linux (for a future mini PC; best effort) ----------------
class LinuxSystem extends EventEmitter {
  constructor(dataDir) {
    super();
    this.name = 'linux';
    this.dataDir = dataDir;
    this.external = null;
    const which = (b) => { for (const d of (process.env.PATH || '').split(':')) { const p = path.join(d, b); if (fs.existsSync(p)) return p; } return null; };
    this.browser = which('chromium') || which('chromium-browser') || which('google-chrome') || which('microsoft-edge');
    this.vlc = which('vlc');
    this.xdotool = which('xdotool');
    this.pactl = which('pactl');
    this.brave = which('brave-browser') || which('brave');
  }
  _run(cmd, args) { return new Promise((res, rej) => execFile(cmd, args, (e, out) => (e ? rej(e) : res(out)))); }
  async getVolume() {
    if (!this.pactl) throw new Error('pactl not found');
    const v = await this._run(this.pactl, ['get-sink-volume', '@DEFAULT_SINK@']);
    const m = await this._run(this.pactl, ['get-sink-mute', '@DEFAULT_SINK@']);
    return { level: (+(v.match(/(\d+)%/) || [0, 0])[1]) / 100, muted: /yes/.test(m) };
  }
  async setVolume(v) { await this._run(this.pactl, ['set-sink-volume', '@DEFAULT_SINK@', `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`]); await this._run(this.pactl, ['set-sink-mute', '@DEFAULT_SINK@', '0']); return this.getVolume(); }
  async stepVolume(d) { const s = await this.getVolume(); return this.setVolume(s.level + d); }
  async toggleMute() { await this._run(this.pactl, ['set-sink-mute', '@DEFAULT_SINK@', 'toggle']); return this.getVolume(); }
  _xd(args) { if (!this.xdotool) return Promise.reject(new Error('xdotool not installed')); return this._run(this.xdotool, args); }
  key(k) {
    const map = { up: 'Up', down: 'Down', left: 'Left', right: 'Right', enter: 'Return', escape: 'Escape', space: 'space', backspace: 'BackSpace', tab: 'Tab', f11: 'F11', browserback: 'alt+Left', altleft: 'alt+Left', altright: 'alt+Right', mediaplaypause: 'XF86AudioPlay' };
    return this._xd(['key', map[k] || k]);
  }
  type(t) { return this._xd(['type', '--delay', '20', t]); }
  mouseMove(dx, dy) { return this._xd(['mousemove_relative', '--', String(Math.round(dx)), String(Math.round(dy))]); }
  click(b) { return this._xd(['click', b === 'right' ? '3' : '1']); }
  scroll(dy) { return this._xd(['click', '--repeat', String(Math.max(1, Math.round(Math.abs(dy) / 120))), dy > 0 ? '4' : '5']); }
  focusTv() { return this._xd(['search', '--name', 'Lumen', 'windowactivate']).catch(() => {}); }
  minimizeTv() { return this._xd(['search', '--name', '^Lumen$', 'windowminimize']).catch(() => {}); }
  screenOff() { return this._run('xset', ['dpms', 'force', 'off']).catch(() => {}); }
  _launch(exe, args, kind, label) {
    this.closeExternal(true);
    const child = spawn(exe, args, { stdio: 'ignore' });
    const ext = { child, kind, label };
    this.external = ext;
    child.on('exit', () => { if (this.external === ext) { this.external = null; this.emit('external', null); this.focusTv(); } });
    child.on('error', () => { if (this.external === ext) { this.external = null; this.emit('external', null); } });
    this.emit('external', { kind, label });
    this.minimizeTv();
    return { kind, label };
  }
  openWeb(url, { label = '', youtube = false, browser = 'edge', assist = null, setup = false, smoothSkip = true } = {}) {
    const useBrave = browser === 'brave' && this.brave;
    const exe = useBrave ? this.brave : this.browser;
    if (!exe) throw Object.assign(new Error('No Chromium-based browser found'), { status: 500 });
    const profile = path.join(this.dataDir, useBrave ? 'web-profile-brave' : 'web-profile');
    // assist: Lumen's watch helper (loading screen, pop-up/redirect blocking, auto-play, progress) — see guard.js
    const first = assist && !setup ? loadingPageUrl(assist.cover, url) : url;
    const args = [setup ? url : `--app=${first}`, setup ? '--start-maximized' : '--start-fullscreen', `--user-data-dir=${profile}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required'];
    if (smoothSkip) args.push('--disable-accelerated-video-decode');
    if (youtube) args.push(`--user-agent=${TV_UA}`);
    if (assist && !setup) { prepareGuard(profile); args.push(...GUARD_ARGS); }
    const r = this._launch(exe, args, youtube ? 'youtube' : 'web', label);
    if (assist && !setup && this.external) this.external.guard = startGuard({ ...assist, onNoPicture: assist.onNoPicture ? (p) => assist.onNoPicture(p, smoothSkip) : null, brightness: this.brightness ?? 1, userDataDir: profile, startUrl: url, onChoice: (c) => { if (c === 'back') this.closeExternal(); }, log: (m) => console.log('[watch]', m) });
    return r;
  }
  openVlc(file, label) {
    if (!this.vlc) throw Object.assign(new Error('VLC is not installed'), { status: 404 });
    return this._launch(this.vlc, ['--fullscreen', '--play-and-exit', file], 'vlc', label);
  }
  closeExternal(silent) {
    const ext = this.external; if (!ext) return false;
    this.external = null;
    Promise.resolve(ext.guard?.closeBrowser?.()).catch(() => {}).finally(() => { ext.guard?.stop(); setTimeout(() => { try { ext.child.kill(); } catch {} }, 1500); });
    if (!silent) { this.emit('external', null); setTimeout(() => this.focusTv(), 600); }
    return true;
  }
  launchTv(url) {
    if (!this.browser) return false;
    spawn(this.browser, ['--kiosk', url, `--user-data-dir=${path.join(this.dataDir, 'tv-profile')}`, '--autoplay-policy=no-user-gesture-required'], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  quit() { setTimeout(() => process.exit(0), 300); }
  async setBrightness() { return { screens: 0 }; }
  info() { return { platform: 'linux', browser: !!this.browser, brave: !!this.brave, vlc: !!this.vlc, helper: !!(this.xdotool && this.pactl) }; }
}

// ---------------- Test double ----------------
class MockSystem extends EventEmitter {
  constructor() { super(); this.name = 'mock'; this.level = 0.4; this.muted = false; this.log = []; this.external = null; }
  async getVolume() { return { level: this.level, muted: this.muted }; }
  async setVolume(v) { this.level = Math.max(0, Math.min(1, v)); this.muted = false; return this.getVolume(); }
  async stepVolume(d) { return this.setVolume(Math.round((this.level + d) * 1000) / 1000); }
  async toggleMute() { this.muted = !this.muted; return this.getVolume(); }
  async key(k) { this.log.push(['key', k]); }
  async type(t) { this.log.push(['type', t]); }
  async mouseMove(dx, dy) { this.log.push(['move', dx, dy]); }
  async click(b) { this.log.push(['click', b]); }
  async scroll(dy) { this.log.push(['scroll', dy]); }
  async focusTv() {}
  async minimizeTv() {}
  async screenOff() { this.log.push(['screenOff']); }
  openWeb(url, { label = '', youtube = false, browser = 'edge' } = {}) { this.external = { kind: youtube ? 'youtube' : 'web', label, url }; this.log.push(['open', url, browser]); this.emit('external', this.external); return this.external; }
  openVlc(file, label) { this.external = { kind: 'vlc', label }; this.emit('external', this.external); return this.external; }
  closeExternal() { const had = !!this.external; this.external = null; if (had) this.emit('external', null); return had; }
  launchTv() { this.log.push(['launchTv']); return true; }
  quit() { this.log.push(['quit']); this.quitCalled = true; }
  async setBrightness(p) { this.log.push(['bright', p]); return { screens: 0 }; }
  info() { return { platform: 'mock', browser: true, brave: true, vlc: false, helper: true }; }
}

function createSystem(dataDir) {
  let sys;
  if (process.env.LUMEN_SYSTEM === 'mock') sys = new MockSystem();
  else if (process.platform === 'win32') sys = new WindowsSystem(dataDir);
  else if (process.platform === 'linux') sys = new LinuxSystem(dataDir);
  else sys = new MockSystem();
  // Lumen as a desktop app: its own window is the TV screen, so showing, hiding and quitting go through the app.
  const shell = global.lumenShell;
  if (shell) {
    sys.focusTv = async () => shell.showTv();
    sys.minimizeTv = async () => shell.hideTv();
    sys.launchTv = () => { shell.showTv(); return true; };
    sys.quit = () => shell.quit();
  }
  return sys;
}

module.exports = { createSystem };
