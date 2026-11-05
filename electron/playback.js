// Dedicated in-app Chromium playback surface for Lumen on Windows.
// The persistent Electron session replaces the external Brave/Edge process for Watch playback.
'use strict';

const { session: electronSession } = require('electron');
const { site } = require('../server/system/guard');

const { isBlockedRequest } = require('./request-filter');

const PLAYBACK_PROBE = `(() => {
  const visible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
  const videos = [...document.querySelectorAll('video')].filter(v => (v.duration || 0) > 60);
  const v = videos.sort((a,b) => (b.currentTime || 0) - (a.currentTime || 0))[0] || document.querySelector('video');

  // Streaming sites use many different player skins. Prefer explicit player controls,
  // then fall back to a visible, clearly-labelled play button.
  const findPlayControl = () => {
    const selectors = [
      '.jw-display-icon-container','.jw-icon-play','.jw-icon-display','.jw-display',
      '.vjs-big-play-button','.vjs-play-control','.plyr__control--overlaid',
      '.plyr__control[data-plyr="play"]','.fp-play','.fp-ui','.dplayer-play-icon',
      '.artplayer-app .art-control-play','.play-button','.play-btn',
      'button[aria-label*="play" i]','[role="button"][aria-label*="play" i]',
      '[title*="play" i]','[data-testid*="play" i]',
      'button[class*="play" i]','[class*="big-play" i]'
    ];
    for (const selector of selectors) {
      const el = [...document.querySelectorAll(selector)].find(visible);
      if (el && !el.disabled) return el;
    }
    const candidates = [...document.querySelectorAll('button,[role="button"],a,div,span')].filter(visible);
    const labelled = candidates.find(el => {
      if (el.disabled || el.closest('[aria-hidden="true"]')) return false;
      const label = [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), el.className]
        .filter(x => typeof x === 'string').join(' ').trim();
      if (!label || label.length > 90 || /playlist|playback.?rate|display/i.test(label)) return false;
      return /(^|\\W)(play|start|resume|watch)(\\W|$)|big.?play|play.?button/i.test(label);
    });
    if (labelled) return labelled;
    // Some players use a central poster overlay with no accessible text.
    let centre = document.elementFromPoint(Math.floor(innerWidth / 2), Math.floor(innerHeight / 2));
    for (let depth = 0; centre && depth < 6; depth++, centre = centre.parentElement) {
      const cls = String(centre.className || '');
      const role = centre.getAttribute && centre.getAttribute('role');
      const cursor = getComputedStyle(centre).cursor;
      if (visible(centre) && (role === 'button' || cursor === 'pointer') && /play|start|overlay|poster|control/i.test(cls)) return centre;
    }
    return null;
  };
  const clickPlayControl = () => {
    if (Date.now() - (window.__lumenLastUiPlayAttempt || 0) < 1800) return false;
    const el = findPlayControl();
    if (!el) return false;
    window.__lumenLastUiPlayAttempt = Date.now();
    try {
      const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
      if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      if (typeof PointerEvent === 'function') el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse', isPrimary: true }));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.click();
      return true;
    } catch { return false; }
  };

  if (!v) return { found: false, clicked: clickPlayControl(), error: 0 };

  let clicked = false;
  if (v.paused && (!window.__lumenLastPlayAttempt || Date.now() - window.__lumenLastPlayAttempt > 1800)) {
    window.__lumenLastPlayAttempt = Date.now();
    try {
      const p = v.play();
      if (p && p.catch) p.catch(() => {});
    } catch {}
    clicked = clickPlayControl();
  }

  const playing = !v.paused && v.currentTime > 0.2;
  const error = v.error ? Number(v.error.code) || 1 : 0;
  if (!window.__lumenPlaybackFill) {
    window.__lumenPlaybackFill = true;
    const box = v.closest('.jwplayer,.video-js,.plyr,.html5-video-player,.art-video-player,.dplayer,[class*="player" i]') || v;
    const css = {position:'fixed',inset:'0',width:'100vw',height:'100vh',maxWidth:'none',maxHeight:'none',margin:'0',padding:'0',border:'0',transform:'none',zIndex:'2147483646',background:'#000'};
    for (const [k,val] of Object.entries(css)) box.style.setProperty(k,val,'important');
    if (box !== v) { v.style.setProperty('width','100%','important'); v.style.setProperty('height','100%','important'); v.style.setProperty('object-fit','contain','important'); }
    document.documentElement.style.setProperty('overflow','hidden','important');
    document.body && document.body.style.setProperty('overflow','hidden','important');
  }
  return { found: true, playing, clicked, error, t: Number(v.currentTime)||0, d: Number(v.duration)||0, paused: !!v.paused };
})()`;

// Switch to the next recognisable host-provided source only after playback has failed/stalled.
const SOURCE_SWITCH_JS = `(() => {
  const names = /vidsync|vidfast|vidplay|vidsrc|filemoon|streamtape|upcloud|voe|doodstream|mixdrop|streamwish|vidhide|vidcloud|closeload|streamhub/i;
  const els = [...document.querySelectorAll('button,a,[role="button"],li,div')].filter(el => {
    if (!el.getClientRects().length) return false;
    const t = (el.innerText || el.getAttribute('aria-label') || el.title || '').trim();
    return t && t.length < 70 && names.test(t) && !el.querySelector('button,a,[role="button"]');
  });
  const unique = [...new Set(els)];
  const labels = unique.map(el => (el.innerText || el.getAttribute('aria-label') || el.title || '').trim());
  const current = unique.findIndex(el =>
    el.getAttribute('aria-pressed') === 'true' ||
    el.getAttribute('aria-selected') === 'true' ||
    el.getAttribute('aria-current') === 'true' ||
    /(^|\\s)(active|selected|current)(\\s|$)/i.test(String(el.className || ''))
  );
  // Never guess which source is active: that can switch away from a working stream.
  if (!unique.length || current < 0) return { switched:false, labels, reason:'active source not identified' };
  const index = current + 1;
  if (index >= unique.length) return { switched:false, labels, reason:'no next source' };
  window.__lumenSourceIndex = index;
  unique[index].click();
  return { switched:true, label:labels[index], index, total:unique.length };
})()`;

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
      fullscreen: true, kiosk: true, frame: false, show: false, backgroundColor: '#000000',
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
      progress: null, lastProgressSaved: 0, resumeApplied: false, playerFrame: null, hasVideo: false, lastVideoTime: 0, lastProgressAt: Date.now(), sourceAttempts: 0, lastSourceSwitchAt: 0, centreClickIndex: 0, lastCentreClickAt: 0, allowed: new Set([site(url)]), graceUntil: Date.now() + 10000,
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
    // Escape is the universal Lumen Back action. Never leave the viewer trapped in a site.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (input.key === 'F11') {
        event.preventDefault();
        try { win.setKiosk(true); win.setFullScreen(true); win.focus(); } catch {}
      }
    });
    win.on('closed', close);

    const evaluate = (js, frame = null) => {
      if (state.closed || win.isDestroyed()) return Promise.resolve(null);
      const target = frame || win.webContents.mainFrame;
      return target.executeJavaScript(js, true).catch(() => null);
    };
    // A streaming player is often nested several iframes deep. Expand each iframe
    // ancestor too, otherwise the video fills only a small rectangle inside the site.
    const expandFrameAncestors = async (frame) => {
      let child = frame;
      for (let depth = 0; depth < 5 && child?.parent; depth++) {
        const parent = child.parent;
        let host = '';
        try { host = new URL(child.url).hostname; } catch {}
        const js = `(() => {
          const frames = [...document.querySelectorAll('iframe')];
          const matches = frames.filter(f => { try { return new URL(f.src, location.href).hostname === ${JSON.stringify(host)}; } catch { return false; } });
          const f = (matches.length ? matches : frames).sort((a,b) => b.getBoundingClientRect().width*b.getBoundingClientRect().height - a.getBoundingClientRect().width*a.getBoundingClientRect().height)[0];
          if (!f) return false;
          Object.assign(f.style, {position:'fixed',inset:'0',width:'100vw',height:'100vh',maxWidth:'none',maxHeight:'none',margin:'0',padding:'0',border:'0',zIndex:'2147483647',background:'#000'});
          document.documentElement.style.setProperty('overflow','hidden','important');
          document.body && document.body.style.setProperty('overflow','hidden','important');
          return true;
        })()`;
        await evaluate(js, parent);
        child = parent;
      }
    };
    // Fallback for players whose Play control cannot be identified from their DOM.
    // Electron input events target the actual webContents (including embedded frames),
    // unlike page-script .click() calls which some custom players ignore.
    const centreClickPoints = [
      [0, 0],
      [-70, 0], [70, 0], [0, -70], [0, 70],
      [-120, 0], [120, 0], [0, -120], [0, 120],
      [-70, -70], [70, -70], [-70, 70], [70, 70]
    ];
    const tryCentreClick = () => {
      if (state.closed || state.revealed || state.stats.playing) return false;
      const now = Date.now();
      if (now - state.startedAt < 2500 || now - state.lastCentreClickAt < 1100) return false;
      if (state.centreClickIndex >= centreClickPoints.length) return false;
      const { width, height } = win.getContentBounds();
      const [dx, dy] = centreClickPoints[state.centreClickIndex++];
      const x = Math.max(1, Math.min(width - 2, Math.round(width / 2 + dx)));
      const y = Math.max(1, Math.min(height - 2, Math.round(height / 2 + dy)));
      state.lastCentreClickAt = now;
      try {
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        log('[browser] tried centre Play click ' + state.centreClickIndex + '/' + centreClickPoints.length + ' at ' + x + ',' + y);
        return true;
      } catch (e) {
        log('[browser] centre Play click failed: ' + e.message);
        return false;
      }
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
          if (frame !== win.webContents.mainFrame) await expandFrameAncestors(frame);
          if (!state.resumeApplied) {
            state.resumeApplied = true;
            const resumeAt = Math.max(0, Number(assist?.resumeAt) || 0);
            if (resumeAt > 60) await evaluate('(function(){const v=[...document.querySelectorAll(\'video\')].filter(x=>(x.duration||0)>60).sort((a,b)=>b.currentTime-a.currentTime)[0];if(v&&v.currentTime<'+resumeAt+'-30){v.currentTime=Math.min(v.duration-1,'+resumeAt+');return true}return false})()', frame);
          }
          if (Number(result.t) > state.lastVideoTime + 0.35) {
            state.lastVideoTime = Number(result.t);
            state.lastProgressAt = Date.now();
          }
          state.progress = { t: result.t, d: result.d, paused: result.paused, at: Date.now() };
          // Keep the Lumen cover over the site until video playback actually starts.
          // Finding a paused player is not enough: exposing it leaves the website visible.
          if (result.playing) {
            state.stats.playing = true;
            reveal();
          }
          if (assist?.onProgress && Date.now() - state.lastProgressSaved >= 10000) { state.lastProgressSaved = Date.now(); assist.onProgress({ t: result.t, d: result.d }); }
          if (result.playing) state.stats.playing = true;
          // A paused player is not proof that its source is broken. Only fail over after
          // an explicit media error, or a stream that was playing and then genuinely stalls.
          const mediaError = Number(result.error) > 0;
          const stalled = state.stats.playing && !result.paused && Date.now() - state.lastProgressAt > 30000;
          if ((mediaError || stalled) && state.sourceAttempts < 5 && Date.now() - state.lastSourceSwitchAt > 10000) {
            const switched = await evaluate(SOURCE_SWITCH_JS, frame);
            if (switched?.switched) {
              state.sourceAttempts++;
              state.lastSourceSwitchAt = Date.now();
              state.lastProgressAt = Date.now();
              state.lastVideoTime = 0;
              state.hasVideo = false;
              state.playerFrame = null;
              state.resumeApplied = false;
              state.stats.playing = false;
              state.stats.sourceSwitches = state.sourceAttempts;
              log('[browser] trying alternate source after media failure: ' + switched.label);
            }
          }
          break;
        }
      }
      // Sweep a small area around the centre only while playback has not started.
      // Stop on the first confirmed playing state; never click over an active film.
      tryCentreClick();
    };
    state.startedAt = Date.now();
    state.poll = setInterval(poll, 1500);
    // Keep the website hidden until playback actually starts. If a player is found
    // but remains paused, explain what is happening instead of leaving a blank spinner.
    state.timer = setTimeout(() => {
      if (state.closed || state.revealed) return;
      try {
        if (!cover.isDestroyed()) cover.webContents.executeJavaScript(
          "document.querySelector('p').textContent='The player has not started yet. Lumen is still trying Play. Press OK to retry, or Back to return.'"
        ).catch(() => {});
      } catch {}
    }, 12000);
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
        if (String(key).toLowerCase() === 'home' || String(key).toLowerCase() === 'browserhome') { close(); return true; }
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
