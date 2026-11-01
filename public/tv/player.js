// Full-screen player for local files (HTML5 video) and trailers (YouTube embed).
import { icon } from '/shared/icons.js';
import { api } from './api.js';
import { el, esc, onSelect, confirmDialog } from './ui.js';
import * as nav from './nav.js';

let P = null; // active player state

const fmt = (s) => {
  if (!isFinite(s)) return '0:00';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

export const isOpen = () => !!P;

function shell(title, sub) {
  const root = el(`<div id="player"><div class="chrome"><div class="ptitle">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>
    <div class="bar"><div class="rail"><div class="buf"></div><div class="done"></div><div class="knob"></div></div><div class="times"><span class="cur">0:00</span><span class="rem"></span></div></div></div>
    <div class="flash"></div><div class="spinner"></div></div>`);
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('in'));
  return root;
}

function showChrome(ms = 3500) {
  if (!P) return;
  P.root.classList.add('show');
  clearTimeout(P.chromeT);
  P.chromeT = setTimeout(() => { if (P && !P.paused) P.root.classList.remove('show'); }, ms);
}
function flash(name) {
  const f = P.root.querySelector('.flash');
  f.innerHTML = icon(name);
  f.classList.add('on');
  clearTimeout(P.flashT);
  P.flashT = setTimeout(() => f.classList.remove('on'), 700);
}

export async function playFile(file, { onExit, vlcAvailable } = {}) {
  close();
  const title = file.title || file.name.replace(/\.[^.]+$/, '');
  const root = shell(title, file.sub || '');
  const v = document.createElement('video');
  v.preload = 'auto';
  v.src = `/api/media/stream?path=${encodeURIComponent(file.path)}`;
  root.prepend(v);
  P = { kind: 'file', root, v, file, onExit, paused: false, key: 'file:' + file.path };
  nav.pushLayer(root, null);
  const sp = root.querySelector('.spinner');
  const update = () => {
    if (!P || P.v !== v) return;
    const d = v.duration || 0, c = v.currentTime || 0;
    root.querySelector('.done').style.width = d ? `${(c / d) * 100}%` : '0';
    root.querySelector('.knob').style.left = d ? `${(c / d) * 100}%` : '0';
    if (v.buffered.length && d) root.querySelector('.buf').style.width = `${(v.buffered.end(v.buffered.length - 1) / d) * 100}%`;
    root.querySelector('.cur').textContent = fmt(c);
    root.querySelector('.rem').textContent = d ? '-' + fmt(d - c) : '';
  };
  v.addEventListener('timeupdate', update);
  v.addEventListener('progress', update);
  v.addEventListener('waiting', () => (sp.style.display = ''));
  v.addEventListener('playing', () => { sp.style.display = 'none'; P && (P.paused = false); });
  v.addEventListener('canplay', () => (sp.style.display = 'none'));
  v.addEventListener('ended', () => { api('/api/progress', { method: 'POST', body: { key: P.key, done: true } }).catch(() => {}); close(); });
  v.addEventListener('error', () => {
    sp.style.display = 'none';
    const unsupported = v.error && (v.error.code === 3 || v.error.code === 4);
    const msg = el(`<div class="msg"><div><b>${unsupported ? 'This file’s format can’t play here' : 'This file couldn’t be opened'}</b>
      ${unsupported ? 'The browser player handles MP4/MKV/WebM with H.264, VP9 or AV1 video. Files using HEVC/x265, DivX, AVI or DTS audio need VLC.' : 'It may have been moved, or the drive was disconnected.'}
      <div class="actions" data-group="row" style="justify-content:center;margin-top:2.4rem"></div></div></div>`);
    const acts = msg.querySelector('.actions');
    if (unsupported && vlcAvailable) acts.appendChild(onSelect(el(`<div class="btn primary f glow">${icon('play')}Open in VLC</div>`), () => { close(); api('/api/media/vlc', { method: 'POST', body: { path: file.path } }).catch(() => {}); }));
    acts.appendChild(onSelect(el(`<div class="btn f glow">Close</div>`), () => close()));
    root.appendChild(msg);
    root.classList.remove('show');
    nav.focus(acts.querySelector('.f'));
  });
  // resume?
  let start = 0;
  try {
    const pr = await api(`/api/progress?key=${encodeURIComponent(P.key)}`);
    if (pr && pr.pos > 30 && pr.dur && pr.pos < pr.dur - 60) {
      const resume = await confirmDialog({ title: 'Resume playing?', text: `You stopped at ${fmt(pr.pos)} of ${fmt(pr.dur)}.`, ok: `Resume from ${fmt(pr.pos)}`, cancel: 'Start from beginning' });
      if (resume) start = pr.pos;
    }
  } catch {}
  if (!P || P.v !== v) return;
  if (start) v.currentTime = start;
  v.play().catch(() => {});
  showChrome();
  P.saveT = setInterval(saveProgress, 10000);
}

function saveProgress() {
  if (!P || P.kind !== 'file' || !P.v.duration) return;
  api('/api/progress', { method: 'POST', body: { key: P.key, pos: P.v.currentTime, dur: P.v.duration } }).catch(() => {});
}

export function playTrailer(key, title, { onExit, onExternal } = {}) {
  close();
  const root = shell(title, 'Trailer');
  root.querySelector('.bar').remove();
  const f = document.createElement('iframe');
  f.allow = 'autoplay; encrypted-media; fullscreen';
  f.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1&controls=0&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&iv_load_policy=3&origin=${encodeURIComponent(location.origin)}`;
  root.prepend(f);
  // A clear layer over the trailer: YouTube shows its big play/pause button whenever the (hidden) mouse pointer
  // rests over the video, so it never gets to see the pointer. Clicking still plays/pauses, via Lumen.
  const shield = document.createElement('div'); shield.className = 'yt-shield';
  f.after(shield);
  P = { kind: 'yt', root, f, onExit, paused: false };
  shield.addEventListener('click', () => { if (P?.kind === 'yt') { P.paused = !P.paused; P.cmd(P.paused ? 'pauseVideo' : 'playVideo'); flash(P.paused ? 'pause' : 'play'); showChrome(); } });
  nav.pushLayer(root, null);
  const sp = root.querySelector('.spinner');
  const cmd = (func, args = []) => f.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
  P.cmd = cmd;
  f.addEventListener('load', () => {
    f.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*');
    setTimeout(() => (sp.style.display = 'none'), 1200);
  });
  P.onMsg = (e) => {
    if (!P || P.kind !== 'yt' || e.source !== f.contentWindow) return;
    let d; try { d = JSON.parse(e.data); } catch { return; }
    if (d.event === 'onStateChange' && d.info === 0) close();
    if (d.event === 'infoDelivery' && d.info?.playerState === 0) close();
    if (d.event === 'onError') {
      sp.style.display = 'none';
      const msg = el(`<div class="msg"><div><b>This trailer can’t play inside the TV interface</b>The video’s owner only allows it on YouTube itself.<div class="actions" data-group="row" style="justify-content:center;margin-top:2.4rem"></div></div></div>`);
      const acts = msg.querySelector('.actions');
      if (onExternal) acts.appendChild(onSelect(el(`<div class="btn primary f glow">Watch on YouTube</div>`), () => { close(); onExternal(); }));
      acts.appendChild(onSelect(el(`<div class="btn f glow">Close</div>`), () => close()));
      root.appendChild(msg);
      nav.focus(acts.querySelector('.f'));
    }
  };
  addEventListener('message', P.onMsg);
  showChrome(3000);
}

export function close() {
  if (!P) return;
  const p = P;
  if (p.kind === 'file') { saveProgress(); clearInterval(p.saveT); p.v.pause(); p.v.removeAttribute('src'); p.v.load(); }
  if (p.onMsg) removeEventListener('message', p.onMsg);
  P = null;
  p.root.classList.remove('in');
  setTimeout(() => p.root.remove(), 420);
  nav.popLayer();
  p.onExit?.();
}

// Returns true if the player consumed the key.
export function handleKey(k) {
  if (!P) return false;
  const errorShown = P.root.querySelector('.msg');
  if (errorShown) { if (k === 'back') { close(); return true; } return false; }
  if (P.kind === 'file') {
    const v = P.v;
    if (k === 'select' || k === 'playpause') { if (v.paused) { v.play(); P.paused = false; flash('play'); } else { v.pause(); P.paused = true; flash('pause'); } showChrome(); }
    else if (k === 'left') { v.currentTime = Math.max(0, v.currentTime - 10); flash('rewind'); showChrome(); }
    else if (k === 'right') { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); flash('forward'); showChrome(); }
    else if (k === 'up' || k === 'down') showChrome(5000);
    else if (k === 'back') close();
    else return false;
    return true;
  }
  if (P.kind === 'yt') {
    if (k === 'select' || k === 'playpause') { P.paused = !P.paused; P.cmd(P.paused ? 'pauseVideo' : 'playVideo'); flash(P.paused ? 'pause' : 'play'); showChrome(); }
    else if (k === 'back') close();
    else if (k === 'up' || k === 'down' || k === 'left' || k === 'right') showChrome();
    else return false;
    return true;
  }
  return false;
}
