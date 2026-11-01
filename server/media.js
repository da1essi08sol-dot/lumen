// Local media: drive discovery, folder listing, HTTP range streaming.
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const VIDEO = new Set(['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.wmv', '.mpg', '.mpeg', '.ts', '.m2ts', '.flv', '.3gp', '.ogv']);
// Chromium/Edge can usually decode these containers when the codecs are H.264/VP9/AV1 + AAC/Opus.
const PLAYABLE = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov', '.ogv']);
const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/mp4', '.ogv': 'video/ogg' };
const HIDDEN = new Set(['$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'programdata', 'appdata', 'node_modules', 'recovery', '$windows.~bt', 'msocache']);

const isVideo = (p) => VIDEO.has(path.extname(p).toLowerCase());

async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }

async function roots(extra = []) {
  const out = [];
  const home = os.homedir();
  for (const [name, p] of [['Videos', path.join(home, 'Videos')], ['Downloads', path.join(home, 'Downloads')], ['Desktop', path.join(home, 'Desktop')]]) {
    if (await exists(p)) out.push({ name, path: p, kind: 'place' });
  }
  if (process.platform === 'win32') {
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const found = await Promise.all(letters.map((l) => exists(`${l}:\\`)));
    letters.forEach((l, i) => { if (found[i]) out.push({ name: l === 'C' ? 'This Laptop (C:)' : `Drive ${l}:`, path: `${l}:\\`, kind: l === 'C' ? 'disk' : 'drive' }); });
  } else {
    for (const base of ['/media', '/mnt', `/media/${os.userInfo().username}`, '/run/media/' + os.userInfo().username]) {
      try { for (const e of await fsp.readdir(base, { withFileTypes: true })) if (e.isDirectory()) out.push({ name: e.name, path: path.join(base, e.name), kind: 'drive' }); } catch {}
    }
  }
  for (const p of extra) if (!out.some((o) => o.path === p) && (await exists(p))) out.unshift({ name: path.basename(p) || p, path: p, kind: 'pinned' });
  return out;
}

function checkPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || !path.isAbsolute(p)) return null;
  return path.resolve(p);
}

async function list(dir) {
  const d = checkPath(dir);
  if (!d) throw Object.assign(new Error('Bad path'), { status: 400 });
  const ents = await fsp.readdir(d, { withFileTypes: true });
  const out = [];
  await Promise.all(ents.map(async (e) => {
    if (e.name.startsWith('.') || e.name.startsWith('$') || HIDDEN.has(e.name.toLowerCase())) return;
    const p = path.join(d, e.name);
    if (e.isDirectory()) out.push({ name: e.name, path: p, kind: 'dir' });
    else if (e.isFile() && isVideo(e.name)) {
      let st = null; try { st = await fsp.stat(p); } catch {}
      out.push({ name: e.name, path: p, kind: 'video', size: st?.size || 0, mtime: st?.mtimeMs || 0, playable: PLAYABLE.has(path.extname(e.name).toLowerCase()) });
    }
  }));
  out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.kind === 'dir' ? -1 : 1));
  const parent = path.dirname(d);
  return { path: d, parent: parent !== d ? parent : null, entries: out };
}

let recentCache = { t: 0, key: '', items: [] };
async function recentVideos(folders, limit = 30) {
  const key = folders.join('|');
  if (Date.now() - recentCache.t < 60e3 && recentCache.key === key) return recentCache.items;
  const found = [];
  async function walk(dir, depth) {
    if (depth > 4 || found.length > 2000) return;
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name.startsWith('$') || HIDDEN.has(e.name.toLowerCase())) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (isVideo(e.name)) { try { const st = await fsp.stat(p); found.push({ name: e.name, path: p, kind: 'video', size: st.size, mtime: st.mtimeMs, playable: PLAYABLE.has(path.extname(e.name).toLowerCase()) }); } catch {} }
    }
  }
  for (const f of folders) await walk(f, 0);
  found.sort((a, b) => b.mtime - a.mtime);
  recentCache = { t: Date.now(), key, items: found.slice(0, limit) };
  return recentCache.items;
}

async function stream(req, res, file) {
  const p = checkPath(file);
  if (!p || !isVideo(p)) { res.writeHead(400); return res.end('Not a video'); }
  let st; try { st = await fsp.stat(p); } catch { res.writeHead(404); return res.end('Not found'); }
  const type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? +m[1] : 0, end = m && m[2] ? +m[2] : st.size - 1;
    if (m && !m[1] && m[2]) { start = st.size - +m[2]; end = st.size - 1; }
    if (start >= st.size || end >= st.size || start > end) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${st.size}`, 'content-length': end - start + 1 });
    fs.createReadStream(p, { start, end }).on('error', () => res.destroy()).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': st.size });
    fs.createReadStream(p).on('error', () => res.destroy()).pipe(res);
  }
}

// ---- subtitles: .srt / .vtt files next to a video ("Film.srt", "Film.en.srt", "Film.English.vtt", or a Subs folder)
const SUB_EXT = new Set(['.srt', '.vtt']);
const LANGS = { en: 'English', eng: 'English', english: 'English', fr: 'French', fre: 'French', fra: 'French', french: 'French', de: 'German', ger: 'German', deu: 'German', german: 'German',
  es: 'Spanish', spa: 'Spanish', spanish: 'Spanish', it: 'Italian', ita: 'Italian', italian: 'Italian', nl: 'Dutch', dut: 'Dutch', dutch: 'Dutch', pt: 'Portuguese', por: 'Portuguese',
  pl: 'Polish', pol: 'Polish', sv: 'Swedish', swe: 'Swedish', da: 'Danish', dan: 'Danish', no: 'Norwegian', nor: 'Norwegian', fi: 'Finnish', fin: 'Finnish', ja: 'Japanese', jpn: 'Japanese',
  zh: 'Chinese', chi: 'Chinese', ko: 'Korean', kor: 'Korean', ar: 'Arabic', ara: 'Arabic', hi: 'Hindi', hin: 'Hindi', ru: 'Russian', rus: 'Russian', tr: 'Turkish', tur: 'Turkish' };
const stem = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();
async function subtitles(video) {
  const v = checkPath(video);
  if (!v || !isVideo(v)) return [];
  const dir = path.dirname(v), base = stem(path.basename(v));
  const out = [];
  // when the video is alone in its folder, every subtitle file there (or in its Subs folder) is for it
  let alone = false; try { alone = (await fsp.readdir(dir)).filter(isVideo).length <= 1; } catch {}
  const consider = async (folder) => {
    let ents = []; try { ents = await fsp.readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isFile() || !SUB_EXT.has(path.extname(e.name).toLowerCase())) continue;
      const s = stem(e.name);
      if (!(s === base || s.startsWith(base + '.') || alone)) continue;
      const tags = s.startsWith(base) ? s.slice(base.length).split('.').filter(Boolean) : s.split(/[._ -]/);
      const lang = tags.map((t) => LANGS[t]).find(Boolean);
      const extra = tags.includes('forced') ? ' (forced)' : tags.includes('sdh') || tags.includes('hi') ? ' (SDH)' : '';
      out.push({ path: path.join(folder, e.name), label: `${lang || (s === base ? 'Subtitles' : e.name)}${extra}`, lang: lang || '' });
    }
  };
  await consider(dir);
  for (const sub of ['Subs', 'subs', 'Subtitles', 'subtitles']) await consider(path.join(dir, sub));
  const seen = new Set();
  return out.filter((s) => { const k = process.platform === 'win32' ? s.path.toLowerCase() : s.path; return !seen.has(k) && seen.add(k); }).sort((a, b) => a.label.localeCompare(b.label));
}
// a subtitle file, always as WebVTT (what the video player reads); SRT is converted on the fly
async function subtitleVtt(file) {
  const p = checkPath(file);
  if (!p || !SUB_EXT.has(path.extname(p).toLowerCase())) throw Object.assign(new Error('Not a subtitle file'), { status: 400 });
  const st = await fsp.stat(p);
  if (st.size > 5e6) throw Object.assign(new Error('Subtitle file is too big'), { status: 400 });
  let t = (await fsp.readFile(p)).toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^WEBVTT/.test(t)) return t;
  t = t.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2').replace(/^\d+\n(?=\d\d:\d\d)/gm, '');
  return 'WEBVTT\n\n' + t.trim() + '\n';
}
// the next video in the same folder (in name order, so episode 2 follows episode 1)
async function nextVideo(video) {
  const v = checkPath(video);
  if (!v) return null;
  const { entries } = await list(path.dirname(v));
  const vids = entries.filter((e) => e.kind === 'video');
  const i = vids.findIndex((e) => path.resolve(e.path) === v);
  return i >= 0 && i < vids.length - 1 ? vids[i + 1] : null;
}

module.exports = { roots, list, stream, recentVideos, isVideo, checkPath, subtitles, subtitleVtt, nextVideo };
