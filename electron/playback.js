// Dedicated in-app Chromium playback surface for Lumen on Windows.
// The persistent Electron session replaces the external Brave/Edge process for Watch playback.
'use strict';

const { session: electronSession } = require('electron');
const { site } = require('../server/system/guard');

const { isBlockedRequest } = require('./request-filter');

const PLAYBACK_PROBE = `(() => {
  const videos = [...document.querySelectorAll('video')].filter(v => (v.duration || 0) > 60);
  const v = videos.sort((a,b) => (b.currentTime || 0) - (a.currentTime || 0))[0] || document.querySelector('video');
  if (!v) {
    const selectors = ['.jw-display-icon-display','.jw-icon-display','.vjs-big-play-button','.plyr__control--overlaid','.fp-play','.play-button','.play-btn','button[aria-label*="play" i]','[class*="big-play" i]'];
    if (!window.__lumenNoVideoClickAttempted) { window.__lumenNoVideoClickAttempted = true; for (const s of selectors) { const el = document.querySelector(s); if (el && el.getClientRects().length) { try { el.click(); } catch {} break; } } }
    return { found: false };
  }
  if (v.paused && !window.__lumenAutoPlayAttempted) { window.__lumenAutoPlayAttempted = true; try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch {} }
  const playing = !v.paused && v.currentTime > 0.2;
  if (playing && !window.__lumenPlaybackFill) {
    window.__lumenPlaybackFill = true;
    const box = v.closest('.jwplayer,.video-js,.plyr,.html5-video-player,.art-video-player,.dplayer,[class*="player" i]') || v;
    const css = {position:'fixed',inset:'0',width:'100vw',height:'100vh',maxWidth:'none',maxHeight:'none',margin:'0',padding:'0',border:'0',transform:'none',zIndex:'2147483646',background:'#000'};
    for (const [k,val] of Object.entries(css)) box.style.setProperty(k,val,'important');
    if (box !== v) { v.style.setProperty('width','100%','important'); v.style.setProperty('height','100%','important'); v.style.setProperty('object-fit','contain','important'); }
    document.documentElement.style.setProperty('overflow','hidden','important');
    document.body && document.body.style.setProperty('overflow','hidden','important');
  }
  return { found: true, playing, t: Number(v.currentTime)||0, d: Number(v.duration)||0, paused: !!v.paused };
})()`;

const STATUS_JS = `(() => { const v=[...document.querySelectorAll('video')].filter(x=>(x.duration||0)>60).sort((a,b)=>b.currentTime-a.currentTime)[0]; return v?{t:v.currentTime,d:v.duration,paused:v.paused}:null; })()`;

function createPlayback({ BrowserWindow, getBounds, showTv, log = () => {} }) {
  let active = null;

  function open({ url, label = '', youtube = false, assist = null, onClosed = () => {} }) {
    if (active) active.controller?.closeBrowser();
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Lumen Browser only opens HTTP and HTTPS websites.');

    const ses = electronSession.fromPartition('persist:lumen-watch');
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: isBlockedRequest(details.url) }));
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

    const bounds = getBounds();
    const win = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      fullscreen: true, frame: false, show: false, backgroundColor: '#000000',
      autoHideMenuBar: true, skipTaskbar: true,
      webPreferences: {
        partition: 'persist:lumen-watch', contextIsolation: true, sandbox: true,
        nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false,
        backgroundThrottling: false, spellcheck: false
      }
    });
    win.removeMenu();
    if (youtube) win.webContents.setUserAgent('Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36');

    const state = {
      win, label, url, closed: false, revealed: false, timer: null, poll: null,
      progress: null, lastProgressSaved: 0, resumeApplied: false, playerFrame: null, hasVideo: false, allowed: new Set([site(url)]), graceUntil: Date.now() + 10000,
      stats: { popups: 0, redirects: 0, playing: false }, pointer: { x: Math.round(bounds.width / 2), y: Math.round(bounds.height / 2) }
    };
    active = state;

    const safeTitle = String(assist?.cover?.title || label || 'Lumen').replace(/[&<>"]/g, '');
    const coverHtml = '<!doctype html><html><head><meta charset="utf-8"><style>' +
      '*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#050507;color:#fff;font-family:Segoe UI,Arial,sans-serif}' +
      'body{display:grid;place-items:center;background:radial-gradient(ellipse at 50% 65%,#24212b 0%,#09090d 58%,#030305 100%)}' +
      'main{text-align:center;padding:48px}.brand{font-size:14px;letter-spacing:.42em;text-transform:uppercase;opacity:.62}' +
      'h1{font-size:clamp(30px,5vw,64px);font-weight:650;margin:28px 0 12px}p{font-size:18px;opacity:.65}' +
      '.spin{width:34px;height:34px;border:2px solid #ffffff30;border-top-color:#fff;border-radius:50%;margin:36px auto 0;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}' +
      '</style></head><body><main><div class="brand">Lumen</div><h1>' + safeTitle + '</h1><p>Preparing playback…</p><div class="spin"></div></main></body></html>';
    const cover = new BrowserWindow({
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      fullscreen: true, frame: false, show: false, focusable: false, skipTaskbar: true,
      alwaysOnTop: true, backgroundColor: '#050507',
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false }
    });
    cover.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(coverHtml)).catch(() => {});

    const reveal = () => {
      if (state.revealed || state.closed) return;
      state.revealed = true;
      clearTimeout(state.timer);
      try { if (!cover.isDestroyed()) cover.close(); } catch {}
      try { if (!win.isDestroyed()) { win.show(); win.focus(); win.setAlwaysOnTop(true, 'screen-saver'); } } catch {}
    };
    const close = () => {
      if (state.closed) return;
      state.closed = true;
      clearTimeout(state.timer); clearInterval(state.poll);
      try { if (!cover.isDestroyed()) cover.close(); } catch {}
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
      if (active === state) active = null;
      onClosed();
      showTv();
    };

    win.webContents.setWindowOpenHandler(() => {
      state.stats.popups++;
      log('[browser] blocked pop-up from ' + win.webContents.getURL());
      return { action: 'deny' };
    });
    const allowNavigation = (event, target) => {
      let next;
      try { next = new URL(target); } catch { event.preventDefault(); return; }
      if (!['http:', 'https:'].includes(next.protocol)) { event.preventDefault(); return; }
      const nextSite = site(target);
      if (Date.now() <= state.graceUntil) { state.allowed.add(nextSite); return; }
      if (!state.allowed.has(nextSite)) {
        state.stats.redirects++;
        event.preventDefault();
        log('[browser] blocked top-level redirect to ' + next.hostname);
      }
    };
    win.webContents.on('will-navigate', (event, target) => allowNavigation(event, target));
    win.webContents.on('will-redirect', (event, target) => allowNavigation(event, target));
    win.webContents.on('will-prevent-unload', (event) => event.preventDefault());
    win.on('closed', close);

    const evaluate = (js, frame = null) => {
      if (state.closed || win.isDestroyed()) return Promise.resolve(null);
      const target = frame || win.webContents.mainFrame;
      return target.executeJavaScript(js, true).catch(() => null);
    };
    const poll = async () => {
      if (state.closed || win.isDestroyed()) return;
      let frames = [];
      try { frames = win.webContents.mainFrame.framesInSubtree || [win.webContents.mainFrame]; } catch {}
      for (const frame of frames) {
        const result = await evaluate(PLAYBACK_PROBE, frame);
        if (state.closed) return;
        if (result?.found && result.d > 60) {
          state.playerFrame = frame;
          state.hasVideo = true;
          if (!state.resumeApplied) {
            state.resumeApplied = true;
            const resumeAt = Math.max(0, Number(assist?.resumeAt) || 0);
            if (resumeAt > 60) await evaluate('(function(){const v=[...document.querySelectorAll(\'video\')].filter(x=>(x.duration||0)>60).sort((a,b)=>b.currentTime-a.currentTime)[0];if(v&&v.currentTime<'+resumeAt+'-30){v.currentTime=Math.min(v.duration-1,'+resumeAt+');return true}return false})()', frame);
          }
          state.progress = { t: result.t, d: result.d, paused: result.paused, at: Date.now() };
          if (assist?.onProgress && Date.now() - state.lastProgressSaved >= 10000) { state.lastProgressSaved = Date.now(); assist.onProgress({ t: result.t, d: result.d }); }
          if (result.playing) { state.stats.playing = true; reveal(); }
          break;
        }
      }
    };
    state.poll = setInterval(poll, 1500);
    state.timer = setTimeout(reveal, 25000);
    win.webContents.on('did-finish-load', () => { if (youtube) reveal(); poll(); });
    win.webContents.on('render-process-gone', (_e, details) => { log('[browser] renderer exited: ' + details.reason); close(); });
    win.webContents.on('did-fail-load', (_e, code, description, failedUrl, isMainFrame) => {
      if (isMainFrame && code !== -3) log('[browser] load failed (' + code + '): ' + description + ' ' + failedUrl);
    });
    win.once('ready-to-show', () => {
      if (state.closed) return;
      win.show(); win.focus(); win.setAlwaysOnTop(true, 'screen-saver');
      cover.show(); cover.setAlwaysOnTop(true, 'screen-saver');
    });
    win.loadURL(url).catch((e) => { log('[browser] ' + e.message); reveal(); });

    const controller = {
      closeBrowser: async () => { close(); return true; },
      stop: () => { clearInterval(state.poll); clearTimeout(state.timer); },
      setBrightness: async (factor) => evaluate("document.documentElement.style.filter='brightness(" + Math.max(.1, Math.min(1, Number(factor) || 1)) + ")'"),
      status: () => state.progress ? { ...state.progress, t: state.progress.paused ? state.progress.t : state.progress.t + (Date.now() - state.progress.at) / 1000 } : null,
      playing: () => !!state.hasVideo,
      canSave: () => true,
      saveCurrent: async () => win.isDestroyed() ? null : win.webContents.getURL(),
      key: async (key) => {
        if (win.isDestroyed()) return false;
        if (key === 'browserback') { if (win.webContents.canGoBack()) win.webContents.goBack(); return true; }
        if (key === 'mediaplaypause') return controller.control('toggle');
        const map = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', enter: 'Enter', escape: 'Escape', space: ' ', backspace: 'Backspace', tab: 'Tab', f11: 'F11', altleft: 'Alt+ArrowLeft', altright: 'Alt+ArrowRight' };
        const keyCode = map[String(key).toLowerCase()] || key;
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        return true;
      },
      type: async (value) => { if (!win.isDestroyed()) win.webContents.insertText(String(value).slice(0, 500)); },
      mouseMove: async (dx, dy) => { if (!win.isDestroyed()) { state.pointer.x = Math.max(0, Math.min(bounds.width, state.pointer.x + (Number(dx)||0))); state.pointer.y = Math.max(0, Math.min(bounds.height, state.pointer.y + (Number(dy)||0))); win.webContents.sendInputEvent({ type: 'mouseMove', x: state.pointer.x, y: state.pointer.y }); } },
      click: async (button = 'left') => { if (!win.isDestroyed()) { win.webContents.sendInputEvent({ type: 'mouseDown', x: state.pointer.x, y: state.pointer.y, button, clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x: state.pointer.x, y: state.pointer.y, button, clickCount: 1 }); } },
      stats: state.stats,
      allowed: state.allowed,
      control: async (cmd, arg = 0) => {
        const n = Math.max(-86400, Math.min(86400, Number(arg) || 0));
        const js = "(async()=>{const v=[...document.querySelectorAll('video')].filter(x=>(x.duration||0)>60).sort((a,b)=>b.currentTime-a.currentTime)[0];if(!v)return null;const c=" +
          JSON.stringify(cmd) + ";if(c==='toggle'){if(v.paused)await v.play().catch(()=>{});else v.pause()}else if(c==='play')await v.play().catch(()=>{});else if(c==='pause')v.pause();else if(c==='seek')v.currentTime=Math.max(0,Math.min(v.duration-1,v.currentTime+" +
          n + "));else if(c==='seekTo')v.currentTime=Math.max(0,Math.min(v.duration-1," + n + "));return {t:v.currentTime,d:v.duration,paused:v.paused}})()";
        const r = await evaluate(js, state.playerFrame);
        if (r) state.progress = { ...r, at: Date.now() };
        return controller.status();
      }
    };
    state.controller = controller;
    return controller;
  }

  function close() { if (active?.controller) return active.controller.closeBrowser(); return false; }
  return { open, close, isOpen: () => !!active };
}

module.exports = { createPlayback };
