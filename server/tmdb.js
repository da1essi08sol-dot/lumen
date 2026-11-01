// TMDB access: the API key stays on the server; the TV page only ever sees normalised data.
'use strict';

const BASE = 'https://api.themoviedb.org/3';

// Free UK services we can actually open. Matched against TMDB provider names at runtime,
// because provider IDs differ by region and change over time.
const SERVICES = {
  iplayer:  { name: 'BBC iPlayer', match: /^bbc iplayer$/i, url: (q) => `https://www.bbc.co.uk/iplayer/search?q=${encodeURIComponent(q)}`, home: 'https://www.bbc.co.uk/iplayer' },
  itvx:     { name: 'ITVX', match: /^itvx$/i, url: () => 'https://www.itv.com/watch', home: 'https://www.itv.com/watch' },
  channel4: { name: 'Channel 4', match: /^channel 4$/i, url: (q) => `https://www.channel4.com/search?q=${encodeURIComponent(q)}`, home: 'https://www.channel4.com' },
  my5:      { name: 'My5', match: /^(my5|channel 5|5)$/i, url: () => 'https://www.channel5.com', home: 'https://www.channel5.com' },
  youtube:  { name: 'YouTube', match: /^youtube( free)?$/i, freeOnly: true, url: (q) => `https://www.youtube.com/tv#/search?q=${encodeURIComponent(q)}`, home: 'https://www.youtube.com/tv' },
  tubi:     { name: 'Tubi', match: /^tubi( tv)?$/i, url: (q) => `https://tubitv.com/search/${encodeURIComponent(q)}`, home: 'https://tubitv.com' },
  pluto:    { name: 'Pluto TV', match: /^pluto tv$/i, url: () => 'https://pluto.tv/on-demand', home: 'https://pluto.tv/on-demand' },
};

const MOVIE_GENRES = [[28, 'Action'], [35, 'Comedy'], [878, 'Science Fiction'], [12, 'Adventure'], [10751, 'Family'], [27, 'Horror'], [18, 'Drama'], [16, 'Animation'], [53, 'Thriller'], [99, 'Documentary']];
const TV_GENRES = [[18, 'Drama'], [35, 'Comedy'], [80, 'Crime'], [10765, 'Sci-Fi & Fantasy'], [99, 'Documentary'], [10759, 'Action & Adventure'], [10762, 'Kids'], [10764, 'Reality']];

class TmdbError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

function createTmdb(getSettings, { mock = null, cacheFile = null } = {}) {
  const cache = new Map();
  const inflight = new Map();
  // The cache is kept on disk so Lumen opens instantly: saved answers are shown straight away
  // (even if a bit old) and refreshed quietly in the background.
  const STALE_OK = 7 * 864e5;
  let saveT = null;
  if (cacheFile && !mock) {
    try { for (const [k, v] of JSON.parse(require('fs').readFileSync(cacheFile, 'utf8'))) cache.set(k, v); } catch {}
  }
  function persistSoon() {
    if (!cacheFile || mock || saveT) return;
    saveT = setTimeout(persistNow, 15000);
  }
  function persistNow() {
    clearTimeout(saveT); saveT = null;
    if (!cacheFile || mock) return;
    try {
      const fs = require('fs');
      const entries = [...cache.entries()].filter(([, v]) => Date.now() - v.t < STALE_OK).slice(-400);
      fs.writeFileSync(cacheFile + '.tmp', JSON.stringify(entries)); fs.renameSync(cacheFile + '.tmp', cacheFile);
    } catch (e) { console.error('cache save failed', e.message); }
  }

  async function get(path, params = {}, ttl = 15 * 60e3) {
    const s = getSettings();
    if (!mock && !s.tmdbKey) throw new TmdbError('No TMDB API key set', 412);
    const qs = new URLSearchParams({ language: s.language || 'en-GB', ...params });
    const key = path + '?' + qs;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.data;
    if (hit && Date.now() - hit.t < STALE_OK && hit.key === s.tmdbKey.slice(-6)) { // old but usable: answer now, refresh behind the scenes
      if (!inflight.has(key)) fetchFresh(path, qs, key, s).catch(() => {});
      return hit.data;
    }
    if (inflight.has(key)) return inflight.get(key);
    return fetchFresh(path, qs, key, s);
  }

  function fetchFresh(path, qs, key, s) {
    const p = (async () => {
      let data;
      if (mock) data = mock(path, Object.fromEntries(qs));
      else {
        const k = s.tmdbKey.trim();
        const headers = { accept: 'application/json' };
        if (k.startsWith('eyJ')) headers.authorization = `Bearer ${k}`; else qs.set('api_key', k);
        let res;
        try { res = await fetch(`${BASE}${path}?${qs}`, { headers, signal: AbortSignal.timeout(10000) }); }
        catch (e) { throw new TmdbError('Could not reach TMDB — check the internet connection', 503); }
        if (res.status === 401) throw new TmdbError('TMDB rejected the API key', 401);
        if (res.status === 404) throw new TmdbError('Not found', 404);
        if (!res.ok) throw new TmdbError(`TMDB error ${res.status}`, 502);
        data = await res.json();
      }
      cache.delete(key); cache.set(key, { t: Date.now(), data, key: (s.tmdbKey || '').slice(-6) });
      if (cache.size > 800) cache.delete(cache.keys().next().value);
      persistSoon();
      return data;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  const norm = (r, type) => {
    const t = type || r.media_type || (r.title !== undefined ? 'movie' : 'tv');
    const date = r.release_date || r.first_air_date || '';
    return {
      id: r.id, type: t, title: r.title || r.name || 'Untitled', year: date ? +date.slice(0, 4) : null,
      overview: r.overview || '', poster_path: r.poster_path || null, backdrop_path: r.backdrop_path || null,
      vote_average: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    };
  };
  const list = (data, type) => (data.results || []).filter((r) => (r.media_type || type) !== 'person').map((r) => norm(r, type));
  const safe = (p) => p.catch(() => null);

  // ---- provider resolution (cached per region) ----
  let providerMap = null; // { movie: {service: [ids]}, tv: {...} }
  async function providers() {
    if (providerMap && Date.now() - providerMap.t < 24 * 3600e3) return providerMap;
    const region = getSettings().region || 'GB';
    const out = { t: Date.now(), movie: {}, tv: {} };
    for (const kind of ['movie', 'tv']) {
      const d = await safe(get(`/watch/providers/${kind}`, { watch_region: region }, 24 * 3600e3));
      for (const p of d?.results || []) {
        for (const [svc, def] of Object.entries(SERVICES)) {
          if (def.match.test(p.provider_name.trim())) (out[kind][svc] ||= []).push({ id: p.provider_id, logo: p.logo_path });
        }
      }
    }
    providerMap = out;
    return out;
  }

  function serviceOf(name) {
    for (const [svc, def] of Object.entries(SERVICES)) if (def.match.test(name.trim())) return svc;
    return null;
  }

  async function freeRow(kind, svc, extra = {}) {
    const pm = await providers();
    const ids = (pm[kind][svc] || []).map((p) => p.id);
    if (!ids.length) return [];
    const s = getSettings();
    const d = await safe(get(`/discover/${kind}`, {
      watch_region: s.region || 'GB', with_watch_providers: ids.join('|'),
      with_watch_monetization_types: SERVICES[svc].freeOnly ? 'free|ads' : 'free|ads|flatrate',
      sort_by: 'popularity.desc', 'vote_count.gte': '5', ...extra,
    }));
    return d ? list(d, kind) : [];
  }

  const enabledServices = () => Object.entries(getSettings().services || {}).filter(([, on]) => on).map(([k]) => k).filter((k) => SERVICES[k]);

  // ---- section builders ----
  const row = (title, items, extra = {}) => ({ title, items: (items || []).filter((i) => i.poster_path || i.backdrop_path || i.title), ...extra });
  const heroFrom = (items) => (items || []).filter((i) => i.backdrop_path).slice(0, 6);

  async function section(name, ctx = {}) {
    const region = getSettings().region || 'GB';
    if (name === 'home') {
      const [trendWeek, trendDay, popM, popT, top, freeM] = await Promise.all([
        safe(get('/trending/all/week')), safe(get('/trending/all/day')), safe(get('/movie/popular', { region })),
        safe(get('/tv/popular')), safe(get('/movie/top_rated', { region })),
        enabledServices().length ? freeRow('movie', enabledServices()[0]) : [],
      ]);
      if (!trendWeek && !trendDay && !popM) throw new TmdbError('Could not load from TMDB', 503);
      const rows = [];
      if (ctx.recent?.length) rows.push(row('Recently Viewed', ctx.recent));
      rows.push(row('Trending Today', trendDay && list(trendDay)));
      if (ctx.because) {
        const rec = await safe(get(`/${ctx.because.type}/${ctx.because.id}/recommendations`));
        if (rec?.results?.length) rows.push(row(`Because You Viewed ${ctx.because.title}`, list(rec, ctx.because.type)));
      }
      rows.push(row('Popular Films', popM && list(popM, 'movie')));
      if (freeM?.length) rows.push(row(`Free on ${SERVICES[enabledServices()[0]].name}`, freeM, { link: 'free' }));
      rows.push(row('Popular TV', popT && list(popT, 'tv')));
      rows.push(row('Top Rated Films', top && list(top, 'movie')));
      return { hero: heroFrom(trendWeek && list(trendWeek)), rows: rows.filter((r) => r.items.length) };
    }
    if (name === 'movies' || name === 'tv') {
      const kind = name === 'movies' ? 'movie' : 'tv';
      const base = kind === 'movie'
        ? [['Trending', '/trending/movie/day'], ['In Cinemas Now', '/movie/now_playing'], ['Popular', '/movie/popular'], ['Top Rated', '/movie/top_rated'], ['Coming Soon', '/movie/upcoming']]
        : [['Trending', '/trending/tv/day'], ['Airing This Week', '/tv/on_the_air'], ['Popular', '/tv/popular'], ['Top Rated', '/tv/top_rated']];
      const genres = kind === 'movie' ? MOVIE_GENRES : TV_GENRES;
      const [hero, ...rest] = await Promise.all([
        safe(get(`/trending/${kind}/week`)),
        ...base.map(([, p]) => safe(get(p, kind === 'movie' ? { region } : {}))),
        ...genres.map(([g]) => safe(get(`/discover/${kind}`, { with_genres: String(g), sort_by: 'popularity.desc', 'vote_count.gte': '50' }))),
      ]);
      if (!hero && rest.every((r) => !r)) throw new TmdbError('Could not load from TMDB', 503);
      const rows = [...base.map(([t]) => t), ...genres.map(([, t]) => t)].map((t, i) => row(t, rest[i] && list(rest[i], kind)));
      return { hero: heroFrom(hero && list(hero, kind)), rows: rows.filter((r) => r.items.length) };
    }
    if (name === 'free') {
      const svcs = enabledServices();
      const pm = await providers();
      const jobs = [];
      for (const svc of svcs) for (const kind of ['movie', 'tv']) jobs.push([svc, kind]);
      const res = await Promise.all(jobs.map(([svc, kind]) => freeRow(kind, svc)));
      const rows = jobs.map(([svc, kind], i) => row(`${kind === 'movie' ? 'Films' : 'TV'} on ${SERVICES[svc].name}`, res[i], { service: svc }));
      const services = svcs.map((svc) => ({ key: svc, name: SERVICES[svc].name, logo: (pm.movie[svc] || pm.tv[svc] || [])[0]?.logo || null, url: SERVICES[svc].home }));
      return { hero: heroFrom(rows.flatMap((r) => r.items).slice(0, 20)), services, rows: rows.filter((r) => r.items.length) };
    }
    if (name === 'recent') {
      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
      const svcs = enabledServices();
      const [newM, newTv, ...freeNew] = await Promise.all([
        safe(get('/discover/movie', { region, sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today, 'primary_release_date.gte': monthAgo, 'vote_count.gte': '10', with_release_type: '2|3|4' })),
        safe(get('/tv/on_the_air')),
        ...svcs.map((svc) => freeRow('movie', svc, { sort_by: 'primary_release_date.desc', 'primary_release_date.lte': today })),
      ]);
      const rows = [];
      if (ctx.media?.length) rows.push(row('New in Your Media', ctx.media, { local: true }));
      if (ctx.folderAdds?.length) rows.push(row('Recently Added to Your Folders', ctx.folderAdds));
      svcs.forEach((svc, i) => rows.push(row(`Latest Films on ${SERVICES[svc].name}`, freeNew[i], { service: svc })));
      rows.push(row('New Film Releases', newM && list(newM, 'movie')));
      rows.push(row('New Episodes This Week', newTv && list(newTv, 'tv')));
      const nonEmpty = rows.filter((r) => r.items.length);
      if (!nonEmpty.length && !newM) throw new TmdbError('Could not load from TMDB', 503);
      return { hero: heroFrom((newM && list(newM, 'movie')) || []), rows: nonEmpty };
    }
    throw new TmdbError('Unknown section', 404);
  }

  // one film/show, in the same shape as the rows (for the home banner's folder option)
  async function brief(type, id) { const d = await safe(get(`/${type}/${id}`)); return d ? norm(d, type) : null; }
  async function details(type, id) {
    const s = getSettings();
    const region = s.region || 'GB';
    const append = type === 'movie'
      ? 'videos,credits,recommendations,release_dates,images,watch/providers'
      : 'videos,aggregate_credits,recommendations,content_ratings,images,watch/providers';
    const d = await get(`/${type}/${id}`, { append_to_response: append, include_image_language: 'en,null' }, 6 * 3600e3);
    const vids = (d.videos?.results || []).filter((v) => v.site === 'YouTube');
    const trailer = vids.find((v) => v.type === 'Trailer' && v.official) || vids.find((v) => v.type === 'Trailer') || vids.find((v) => v.type === 'Teaser') || null;
    let cert = null;
    if (type === 'movie') {
      const r = (d.release_dates?.results || []).find((x) => x.iso_3166_1 === region) || (d.release_dates?.results || []).find((x) => x.iso_3166_1 === 'US');
      cert = r?.release_dates?.map((x) => x.certification).find(Boolean) || null;
    } else {
      cert = ((d.content_ratings?.results || []).find((x) => x.iso_3166_1 === region) || {}).rating || null;
    }
    const logo = (d.images?.logos || []).find((l) => l.iso_639_1 === 'en') || (d.images?.logos || [])[0];
    const wp = d['watch/providers']?.results?.[region] || {};
    const enabled = s.services || {};
    const free = [], paid = [], seen = new Set();
    const addFree = (p, viaFlat) => {
      const svc = serviceOf(p.provider_name);
      if (!svc || !enabled[svc] || seen.has(svc)) return false;
      if (viaFlat && SERVICES[svc].freeOnly) return false;
      seen.add(svc);
      free.push({ service: svc, name: SERVICES[svc].name, logo_path: p.logo_path, url: SERVICES[svc].url(d.title || d.name) });
      return true;
    };
    for (const p of [...(wp.free || []), ...(wp.ads || [])]) addFree(p, false);
    for (const p of wp.flatrate || []) if (!addFree(p, true) && !serviceOf(p.provider_name)) paid.push(p.provider_name);
    for (const p of [...(wp.rent || []), ...(wp.buy || [])]) if (!paid.includes(p.provider_name) && !seen.has(serviceOf(p.provider_name))) paid.push(p.provider_name);
    const cast = (type === 'movie' ? d.credits?.cast : d.aggregate_credits?.cast) || [];
    const date = d.release_date || d.first_air_date || '';
    return {
      id: d.id, type, title: d.title || d.name, tagline: d.tagline || '', overview: d.overview || '',
      year: date ? +date.slice(0, 4) : null, date,
      runtime: d.runtime || (d.episode_run_time || [])[0] || null,
      genres: (d.genres || []).map((g) => g.name),
      vote_average: d.vote_average ? Math.round(d.vote_average * 10) / 10 : null,
      certification: cert,
      poster_path: d.poster_path, backdrop_path: d.backdrop_path, logo_path: logo?.file_path || null,
      trailer: trailer ? { key: trailer.key, name: trailer.name } : null,
      cast: cast.slice(0, 18).map((c) => ({ name: c.name, character: c.character || c.roles?.[0]?.character || '', profile_path: c.profile_path })),
      recommendations: list(d.recommendations || {}, type).slice(0, 20),
      collection: d.belongs_to_collection ? { id: d.belongs_to_collection.id, name: d.belongs_to_collection.name } : null,
      seasons: (d.seasons || []).filter((x) => x.season_number > 0).map((x) => ({ season_number: x.season_number, name: x.name, poster_path: x.poster_path, episode_count: x.episode_count, air_date: x.air_date })),
      number_of_seasons: d.number_of_seasons || null,
      providers: { free, paid: paid.slice(0, 6), link: wp.link || null },
      youtubeSearch: enabled.youtube ? SERVICES.youtube.url(`${d.title || d.name} ${date.slice(0, 4)} full ${type === 'movie' ? 'movie' : 'episodes'}`) : null,
    };
  }

  async function season(id, n) {
    const d = await get(`/tv/${id}/season/${n}`, {}, 6 * 3600e3);
    return {
      name: d.name, overview: d.overview, poster_path: d.poster_path,
      episodes: (d.episodes || []).map((e) => ({ episode_number: e.episode_number, name: e.name, overview: e.overview, still_path: e.still_path, runtime: e.runtime, air_date: e.air_date })),
    };
  }

  async function collection(id) {
    const d = await get(`/collection/${id}`, {}, 24 * 3600e3);
    return { id: d.id, name: d.name, items: list({ results: d.parts || [] }, 'movie').sort((a, b) => (a.year || 9999) - (b.year || 9999)) };
  }

  async function search(q) {
    if (!q.trim()) return [];
    const d = await get('/search/multi', { query: q, include_adult: 'false' }, 10 * 60e3);
    return list(d).filter((i) => i.type === 'movie' || i.type === 'tv');
  }

  async function lookup(type, id) { // light item for folders
    const d = await get(`/${type}/${id}`, {}, 24 * 3600e3);
    return norm(d, type);
  }

  async function matchFile(name) { // "The.Matrix.1999.1080p.mkv" -> TMDB item
    const clean = name.replace(/\.[^.]+$/, '').replace(/[._]+/g, ' ');
    const m = clean.match(/^(.*?)[\s(\[]*((?:19|20)\d{2})(?:[\s)\]]|$)/);
    const title = (m ? m[1] : clean.replace(/\b(1080p|720p|2160p|4k|x264|x265|hevc|bluray|web-?dl|webrip|hdr|dvdrip)\b.*$/i, '')).trim();
    const tv = /\bS\d{1,2}E\d{1,2}\b/i.test(clean);
    if (!title) return null;
    const params = { query: tv ? title.replace(/\bS\d{1,2}E\d{1,2}\b.*$/i, '').trim() : title };
    if (m && !tv) params.year = m[2];
    const d = await get(`/search/${tv ? 'tv' : 'movie'}`, params, 24 * 3600e3);
    // Only accept a result whose title genuinely matches the file name — never relabel a home video with a guess.
    const simp = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '');
    const q = simp(params.query);
    const r = (d.results || []).slice(0, 5).find((x) => {
      const t = [x.title, x.name, x.original_title, x.original_name].filter(Boolean).map(simp);
      const yearOk = !params.year || String(x.release_date || x.first_air_date || '').startsWith(params.year);
      return q.length >= 2 && yearOk && t.some((s) => s === q);
    });
    return r ? norm(r, tv ? 'tv' : 'movie') : null;
  }

  async function testKey() { await get('/configuration', {}, 0); return true; }

  return { get, section, details, brief, season, collection, search, lookup, matchFile, testKey, SERVICES, clear: () => { cache.clear(); providerMap = null; persistSoon(); }, flush: persistNow };
}

module.exports = { createTmdb, TmdbError, SERVICES };
