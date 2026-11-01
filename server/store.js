// Tiny JSON-file store with debounced, atomic writes.
'use strict';
const fs = require('fs');
const path = require('path');

function defaults() {
  return {
    version: 1,
    settings: {
      tmdbKey: '',
      region: 'GB',
      language: 'en-GB',
      deviceName: 'Living Room TV',
      lanHost: '',
      services: { youtube: true, iplayer: true, itvx: true, channel4: true, my5: true, tubi: true, pluto: true },
      shortcuts: [],
      watchLink: { pattern: '', name: '' }, // the first of watchLinks (kept for older remotes)
      watchLinks: [], // every Watch website: [{ id, pattern, name }] — each film shows a button for each
      userName: '',
      accent: 'white',
      font: 'classic', // Settings › Personal › Fonts
      sound: { on: true, style: 'soft', volume: 0.6 },
      blockPopups: true,
      softwareDecode: false, // replaces the old 'smoothSkip', which was on by default and could hide the picture
      intro: { anim: true, sound: true },
      brightness: { level: 100, hw: false },
      autoPlay: true,
      webBrowser: 'edge',
      background: { mode: 'artwork', image: null },
      showClock: true,
      screensaver: true,
      homeBanner: { source: 'recommended', folderId: null }, // the big banner on Home: recommended films, or one of your folders
      reduceMotion: false,
    },
    folders: [], // new installs start with an empty library (existing settings keep their folders)
    recent: [],
    watching: [],
    linkOverrides: {}, // pages you picked yourself for a film on a Watch website: { 'linkId|movie:123': url }
    filmSites: {},     // the Watch website you last used for each film: { 'movie:123': linkId }
    progress: {},
    mediaFolders: [],
    devices: [],
    backgrounds: [],
  };
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'store.json');
    fs.mkdirSync(dir, { recursive: true });
    let loaded = null;
    try { loaded = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') {
        // Corrupt file: keep a copy, start fresh rather than crashing the TV.
        try { fs.copyFileSync(this.file, this.file + '.corrupt-' + Date.now()); } catch {}
      }
    }
    this.data = loaded ? deepMerge(defaults(), loaded) : defaults();
    if (loaded) { // arrays are replaced wholesale by deepMerge; keep the user's
      for (const k of ['folders', 'recent', 'watching', 'mediaFolders', 'devices', 'backgrounds']) if (Array.isArray(loaded[k])) this.data[k] = loaded[k];
    }
    // one Watch website (older versions) → the list of Watch websites
    const st = this.data.settings;
    if (!Array.isArray(st.watchLinks)) st.watchLinks = [];
    if (!st.watchLinks.length && st.watchLink?.pattern) st.watchLinks = [{ id: 'w1', pattern: st.watchLink.pattern, name: st.watchLink.name || '' }];
    this._timer = null;
    this.saveNow();
  }
  get d() { return this.data; }
  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 250);
  }
  saveNow() {
    clearTimeout(this._timer);
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
