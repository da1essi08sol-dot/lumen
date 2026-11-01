// Offline stand-in for TMDB, used only for development/testing (LUMEN_MOCK=1).
// Invented titles and generated artwork — no real catalogue data.
'use strict';

const WORDS = ['Northern', 'Quiet', 'Glass', 'Silver', 'Hollow', 'Last', 'Midnight', 'Paper', 'Iron', 'Velvet', 'Distant', 'Golden', 'Broken', 'Salt', 'Winter', 'Ember'];
const NOUNS = ['Harbour', 'Signal', 'Orchard', 'Frontier', 'Station', 'Kingdom', 'Tide', 'Archive', 'Comet', 'Garden', 'Lantern', 'Meridian', 'Canyon', 'Echo', 'Atlas', 'Voyage'];
const HUES = [210, 25, 160, 280, 0, 45, 190, 320, 120, 260];

function rnd(seed) { let x = seed * 9301 + 49297; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); }
function title(id) { const r = rnd(id); return `The ${WORDS[Math.floor(r() * WORDS.length)]} ${NOUNS[Math.floor(r() * NOUNS.length)]}`; }

function item(id, type) {
  const r = rnd(id);
  const year = 1980 + Math.floor(r() * 46);
  const t = title(id);
  const base = {
    id, poster_path: id % 17 === 0 ? null : `/mock/p-${id}.svg`, backdrop_path: `/mock/b-${id}.svg`,
    overview: `A ${['sweeping', 'tense', 'tender', 'witty', 'haunting'][id % 5]} story set around ${t.toLowerCase()}. Placeholder text for offline testing.`,
    vote_average: 5 + Math.round(r() * 40) / 10, vote_count: 500, popularity: 100 - (id % 100), media_type: type,
  };
  return type === 'movie' ? { ...base, title: t, release_date: `${year}-0${1 + (id % 9)}-1${id % 9}` } : { ...base, name: t + ' (Series)', first_air_date: `${year}-03-01` };
}

function page(seed, type, n = 20) { return { page: 1, results: Array.from({ length: n }, (_, i) => item(seed * 100 + i + 1, type === 'all' ? (i % 3 ? 'movie' : 'tv') : type)) }; }

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 900 + 1; }

function mock(path, params) {
  let m;
  if (path === '/configuration') return { images: {} };
  if ((m = path.match(/^\/watch\/providers\/(movie|tv)$/))) return { results: [
    { provider_id: 38, provider_name: 'BBC iPlayer', logo_path: '/mock/l-38.svg' }, { provider_id: 41, provider_name: 'ITVX', logo_path: '/mock/l-41.svg' },
    { provider_id: 103, provider_name: 'Channel 4', logo_path: '/mock/l-103.svg' }, { provider_id: 333, provider_name: 'My5', logo_path: '/mock/l-333.svg' },
    { provider_id: 192, provider_name: 'YouTube', logo_path: '/mock/l-192.svg' }, { provider_id: 73, provider_name: 'Tubi TV', logo_path: '/mock/l-73.svg' },
    { provider_id: 300, provider_name: 'Pluto TV', logo_path: '/mock/l-300.svg' }, { provider_id: 8, provider_name: 'Netflix', logo_path: '/mock/l-8.svg' }] };
  if ((m = path.match(/^\/trending\/(all|movie|tv)\/(day|week)$/))) return page(hash(path), m[1]);
  if ((m = path.match(/^\/(movie|tv)\/(popular|top_rated|now_playing|upcoming|on_the_air)$/))) return page(hash(path), m[1]);
  if ((m = path.match(/^\/discover\/(movie|tv)$/))) return page(hash(path + JSON.stringify(params)), m[1]);
  if ((m = path.match(/^\/search\/(multi|movie|tv)$/))) {
    const q = (params.query || '').toLowerCase();
    const res = page(7, 'all', 60).results.filter((r) => (r.title || r.name).toLowerCase().includes(q));
    return { results: res.length ? res : page(hash(q), 'all', 8).results };
  }
  if ((m = path.match(/^\/(movie|tv)\/(\d+)\/recommendations$/))) return page(hash(path), m[1]);
  if ((m = path.match(/^\/collection\/(\d+)$/))) return { id: +m[1], name: 'Mock Collection', parts: page(+m[1], 'movie', 5).results };
  if ((m = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/))) return { name: `Season ${m[2]}`, overview: 'Placeholder season.', poster_path: `/mock/p-${m[1]}${m[2]}.svg`,
    episodes: Array.from({ length: 8 }, (_, i) => ({ episode_number: i + 1, name: `Episode ${i + 1}`, overview: 'Placeholder episode synopsis for testing.', still_path: `/mock/b-${+m[1] + i}.svg`, runtime: 45, air_date: '2024-01-01' })) };
  if ((m = path.match(/^\/(movie|tv)\/(\d+)$/))) {
    const id = +m[2], type = m[1], it = item(id, type);
    return { ...it, tagline: 'A placeholder tagline.', runtime: 90 + (id % 60), episode_run_time: [45], number_of_seasons: 3,
      genres: [{ name: 'Drama' }, { name: 'Adventure' }],
      seasons: type === 'tv' ? [1, 2, 3].map((n) => ({ season_number: n, name: `Season ${n}`, poster_path: `/mock/p-${id + n}.svg`, episode_count: 8, air_date: '2020-01-01' })) : [],
      belongs_to_collection: id % 2 ? { id: 10, name: 'Mock Collection' } : null,
      videos: { results: [{ site: 'YouTube', type: 'Trailer', official: true, key: 'M7lc1UVf-VE', name: 'Trailer' }] },
      credits: { cast: Array.from({ length: 10 }, (_, i) => ({ name: `Actor ${i + 1}`, character: `Role ${i + 1}`, profile_path: i % 3 ? `/mock/c-${i}.svg` : null })) },
      aggregate_credits: { cast: Array.from({ length: 8 }, (_, i) => ({ name: `Actor ${i + 1}`, roles: [{ character: `Role ${i + 1}` }], profile_path: null })) },
      recommendations: page(hash(path) + 3, type, 12),
      release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ certification: '12A' }] }] },
      content_ratings: { results: [{ iso_3166_1: 'GB', rating: '15' }] },
      images: { logos: [] },
      'watch/providers': { results: { GB: { link: 'https://www.themoviedb.org/', flatrate: id % 3 ? [{ provider_name: 'BBC iPlayer', logo_path: '/mock/l-38.svg' }, { provider_name: 'Netflix', logo_path: '/mock/l-8.svg' }] : [{ provider_name: 'Netflix', logo_path: '/mock/l-8.svg' }], ads: id % 4 === 0 ? [{ provider_name: 'Channel 4', logo_path: '/mock/l-103.svg' }] : [] } } },
    };
  }
  throw Object.assign(new Error('mock: unhandled ' + path), { status: 404 });
}

function mockImage(file) {
  const id = +(file.match(/(\d+)/) || [0, 1])[1];
  const h = HUES[id % HUES.length];
  if (file.startsWith('l-')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="hsl(${h} 40% 30%)"/><text x="50" y="62" font-family="sans-serif" font-size="30" fill="#fff" text-anchor="middle">${id}</text></svg>`;
  if (file.startsWith('c-')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect width="100" height="150" fill="hsl(${h} 15% 35%)"/><circle cx="50" cy="55" r="22" fill="hsl(${h} 10% 55%)"/><rect x="18" y="88" width="64" height="62" rx="30" fill="hsl(${h} 10% 55%)"/></svg>`;
  const back = file.startsWith('b-');
  const [w, hh] = back ? [1280, 720] : [500, 750];
  const t = title(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hh}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h} 45% 32%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360} 50% 10%)"/></linearGradient></defs><rect width="${w}" height="${hh}" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${hh * 0.35}" r="${hh * 0.22}" fill="hsl(${h} 60% 70% / .25)"/>${back ? '' : `<text x="40" y="${hh - 90}" font-family="Georgia,serif" font-size="44" fill="#fff">${t.split(' ').slice(0, 2).join(' ')}</text><text x="40" y="${hh - 40}" font-family="Georgia,serif" font-size="44" fill="#fff">${t.split(' ').slice(2).join(' ')}</text>`}</svg>`;
}

module.exports = { mock, mockImage };
