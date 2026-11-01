// Lumen as a desktop app. One program does everything: it runs Lumen's server (for the phone remote and the
// TV screen), shows the TV screen in its own full-screen window, sits in the system tray, starts with Windows
// if you want, and keeps itself up to date.
'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const IS_WIN = process.platform === 'win32';
const TEST = process.env.LUMEN_APP_TEST === '1'; // automated checks: no tray, no update checks

app.setName('Lumen');
if (IS_WIN) app.setAppUserModelId('tv.lumen.app');

// Only one Lumen at a time. Opening it again just brings the TV screen back.
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

// ---- where things are kept: your settings, sign-ins and Continue Watching live outside the program folder,
// so installing, updating or reinstalling Lumen never touches them.
const BASE = path.join(IS_WIN ? (process.env.LOCALAPPDATA || app.getPath('appData')) : app.getPath('appData'), 'Lumen');
const DATA = process.env.LUMEN_DATA || path.join(BASE, 'data');
fs.mkdirSync(DATA, { recursive: true });
app.setPath('userData', path.join(BASE, 'app'));
app.setAppLogsPath(path.join(BASE, 'logs'));
process.env.LUMEN_DATA = DATA;

const LOG = path.join(BASE, 'lumen.log');
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}\n`;
  try { fs.appendFileSync(LOG, line); } catch {}
  process.stdout.write?.(line);
}
try { if (fs.statSync(LOG).size > 2e6) fs.renameSync(LOG, LOG + '.old'); } catch {}

// the app's own small settings (which screen is the TV)
const PREFS = path.join(BASE, 'app-settings.json');
let prefs = {}; try { prefs = JSON.parse(fs.readFileSync(PREFS, 'utf8')); } catch {}
const savePrefs = () => { try { fs.writeFileSync(PREFS, JSON.stringify(prefs, null, 2)); } catch {} };

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---- bring over settings from the older, folder-based Lumen (1.x) the first time
const migrate = require('./migrate');
const oldRoot = (process.argv.find((a) => a.startsWith('--old-root=')) || '').slice(11) || null;
const migrated = migrate.run({ DATA, oldRoot, log, shell });
const autostartFromOld = process.argv.includes('--enable-autostart') || !!migrated?.autostart;

// ---- updates
const updater = require('./updater')({ app, pkg, log, broadcast: (m) => server?.broadcastTv(m) });

let win = null, tray = null, quitting = false, port = null, server = null;

function tvDisplay() {
  const all = screen.getAllDisplays();
  return all.find((d) => String(d.id) === String(prefs.displayId)) || screen.getPrimaryDisplay();
}

function createWindow() {
  if (win) return win;
  const d = tvDisplay();
  win = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    fullscreen: !TEST, frame: TEST, autoHideMenuBar: true, show: false, title: 'Lumen',
    backgroundColor: '#050507', icon: path.join(ROOT, 'build', IS_WIN ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  win.removeMenu();
  win.loadURL(`http://localhost:${port}/tv/`);
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  // automated checks: save a picture of the TV screen, then close
  if (TEST && process.env.LUMEN_KEYS) win.webContents.once('did-finish-load', () => {
    const keys = process.env.LUMEN_KEYS.split(',').filter(Boolean);
    keys.forEach((k, i) => setTimeout(() => {
      if (k.startsWith('wait')) return;
      for (const type of ['keyDown', 'keyUp']) win?.webContents.sendInputEvent({ type, keyCode: k });
    }, 5500 + i * 450));
  });
  if (TEST && process.env.LUMEN_SHOT) win.webContents.once('did-finish-load', () => setTimeout(async () => {
    try { fs.writeFileSync(process.env.LUMEN_SHOT, (await win.webContents.capturePage()).toPNG()); log('saved', process.env.LUMEN_SHOT); } catch (e) { log('shot failed', e.message); }
    if (process.env.LUMEN_SHOT_QUIT !== '0') quit();
  }, +process.env.LUMEN_SHOT_DELAY || 7000));
  // the TV screen stays on Lumen: links never take it to other websites (those open in Lumen's browser)
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://localhost:${port}/`)) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('render-process-gone', (_e, info) => { log('TV screen stopped:', info.reason, '— reloading'); setTimeout(() => win?.reload(), 800); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F5') { win.reload(); e.preventDefault(); }
    if (input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
  // Alt+F4 or closing the window only hides the TV screen: the phone remote keeps working and
  // "Show Lumen" brings it straight back. Quit Lumen from the tray icon or the power button.
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  return win;
}

function showTv() {
  if (!port) return;
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  if (!TEST) win.setFullScreen(true);
  win.focus(); win.moveTop?.();
}
function hideTv() { if (win && !win.isMinimized()) win.minimize(); }

function moveToDisplay(id) {
  prefs.displayId = id; savePrefs();
  if (!win) return;
  const d = tvDisplay();
  win.setFullScreen(false);
  win.setBounds(d.bounds);
  setTimeout(() => win?.setFullScreen(true), 200);
}

function setAutostart(on) {
  try { app.setLoginItemSettings({ openAtLogin: !!on, args: ['--autostart'] }); } catch (e) { log('autostart:', e.message); }
}
const autostartOn = () => { try { return app.getLoginItemSettings({ args: ['--autostart'] }).openAtLogin; } catch { return false; } };

function quit() { quitting = true; app.quit(); }

// ---- what the server can ask of the app (see server/index.js and server/system/index.js)
global.lumenShell = {
  showTv, hideTv, quit,
  serverReady(p) { port = p; log(`Lumen ${pkg.version} running on port ${p}`); createWindow(); updater.start(); },
  serverFailed(e) {
    log('server could not start:', e.code || e.message);
    if (e.code !== 'EADDRINUSE') { dialog.showErrorBox('Lumen could not start', String(e.message || e)); return quit(); }
    // usually the older Lumen (1.x) is still running in the background
    const choice = dialog.showMessageBoxSync({ type: 'warning', title: 'Lumen', buttons: ['Close it and start Lumen', 'Cancel'], defaultId: 0, cancelId: 1,
      message: 'Another copy of Lumen is already running', detail: 'This is usually the older version of Lumen. Lumen can close it and start the new one.' });
    if (choice !== 0) return quit();
    stopOldServer(() => { app.relaunch(); quitting = true; app.exit(0); });
  },
  checkUpdate: () => updater.check(),
  installUpdate: (b) => updater.install(b, () => { quitting = true; server?.flush(); server?.closeExternal(true); }),
  info: () => ({ version: pkg.version, autostart: autostartOn(), updates: updater.describe(), platform: process.platform, displays: screen.getAllDisplays().length }),
  set(b) {
    if (typeof b.autostart === 'boolean') setAutostart(b.autostart);
    return this.info();
  },
};

function stopOldServer(done) {
  if (!IS_WIN) return done();
  const ps = `Get-NetTCPConnection -LocalPort ${process.env.PORT || 8787} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -ne ${process.pid}) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }`;
  execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000 }, () => setTimeout(done, 600));
}

// ---- tray icon: the one place to find Lumen on the laptop
function buildTray() {
  if (TEST) return;
  const icon = nativeImage.createFromPath(path.join(ROOT, 'build', IS_WIN ? 'icon.ico' : 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Lumen');
  tray.on('click', showTv);
  const refresh = () => {
    const displays = screen.getAllDisplays();
    const cur = tvDisplay();
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Lumen', click: showTv },
      ...(displays.length > 1 ? [{ label: 'Show Lumen on', submenu: displays.map((d, i) => ({
        label: `${d.label || `Screen ${i + 1}`} (${d.size.width}×${d.size.height})${d.id === screen.getPrimaryDisplay().id ? ' — main' : ''}`,
        type: 'radio', checked: d.id === cur.id, click: () => moveToDisplay(d.id) })) }] : []),
      { type: 'separator' },
      { label: 'Start Lumen when I sign in', type: 'checkbox', checked: autostartOn(), click: (mi) => setAutostart(mi.checked) },
      { label: 'Check for updates', click: async () => {
        const r = await updater.check(true);
        if (!r.found) return dialog.showMessageBox({ title: 'Lumen', message: `Lumen ${pkg.version} is up to date.`, detail: r.note || '' });
        const c = await dialog.showMessageBox({ title: 'Lumen', message: `Lumen ${r.version} is ready to install`, buttons: ['Install now', 'Later'], defaultId: 0, cancelId: 1 });
        if (c.response === 0) global.lumenShell.installUpdate({});
      } },
      { label: 'Import settings from an older Lumen…', click: importOld },
      { label: 'Open Lumen’s data folder', click: () => shell.openPath(DATA) },
      { type: 'separator' },
      { label: `Quit Lumen (${pkg.version})`, click: () => { server?.closeExternal(true); quit(); } },
    ]));
  };
  refresh();
  screen.on('display-added', refresh); screen.on('display-removed', refresh);
  tray.on('right-click', refresh);
}

async function importOld() {
  const r = await dialog.showOpenDialog({ title: 'Choose your old Lumen folder', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return;
  const res = migrate.importFrom(r.filePaths[0], DATA, log);
  if (!res.ok) return dialog.showMessageBox({ type: 'warning', title: 'Lumen', message: 'No Lumen settings were found in that folder', detail: 'Choose the Lumen folder itself (the one that contains a "data" folder).' });
  await dialog.showMessageBox({ title: 'Lumen', message: 'Your settings were imported', detail: 'Lumen will now restart to use them.' });
  // app.exit skips the usual save on quit, so the imported settings aren't overwritten by the current ones
  quitting = true; app.relaunch(); app.exit(0);
}

app.on('second-instance', () => showTv());
app.on('window-all-closed', (e) => { /* keep running in the tray */ });
app.on('before-quit', () => { quitting = true; try { server?.flush(); server?.closeExternal(true); } catch {} });

app.whenReady().then(() => {
  if (autostartFromOld) setAutostart(true);
  buildTray();
  // the server runs inside the app; it calls serverReady() when it's listening
  server = require('../server/index.js');
});
