// Offline stand-in for TMDB, used only for development/testing (LUMEN_MOCK=1).
// Invented titles and generated artwork — no real catalogue data.
'use strict';

const WORDS = ['Northern', 'Quiet', 'Glass', 'Silver', 'Hollow', 'Last', 'Midnight', 'Paper', 'Iron', 'Velvet', 'Distant', 'Golden', 'Broken', 'Salt', 'Winter', 'Ember'];
const NOUNS = ['Harbour', 'Signal', 'Orchard', 'Frontier', 'Station', 'Kingdom', 'Tide', 'Archive', 'Comet', 'Garden', 'Lantern', 'Meridian', 'Canyon', 'Echo', 'Atlas', 'Voyage'];
const HUES = [210, 25, 160, 280, 0, 45, 190, 320, 120, 260];

function rnd(seed) { let x = seed * 9301 + 49297; return () => ((x = (x * 9301 + 49297) % 233280) / 233280); }
function title(id) { const r = rnd(id); return `The ${WORDS[Math.floor(r() * WORDS.length)]} ${NOUNS[Math.floor(r() * NOUNS.length)]}`; }

const PLOTS = [
  (t) => `When the lights of ${t} go out, two strangers have one night to find the way home.`,
  (t) => `A retired cartographer is pulled back for one last journey, to the edge of ${t}.`,
  (t) => `Three generations of one family, one summer, and the secret buried at ${t}.`,
  (t) => `A radio operator hears a voice that shouldn't exist, and follows it to ${t}.`,
  (t) => `Out of fuel and out of time, the crew of a cargo ship drift toward ${t}.`,
  (t) => `Two rival chefs, one restaurant, and a review that could close ${t} for good.`,
  (t) => `A young astronomer discovers that ${t} is moving, and nobody believes her.`,
  (t) => `In a town that forgets everything at midnight, one girl starts writing it down.`,
];
const TAGS = ['Some places remember you.', 'Every map ends somewhere.', 'Hold on to the light.', 'The tide always turns.', 'Nothing stays buried forever.', 'Look up.'];
const FIRST = ['Ava', 'Theo', 'Maya', 'Idris', 'Nora', 'Felix', 'Lena', 'Kit', 'Ruth', 'Omar', 'June', 'Ezra'];
const LAST = ['Hart', 'Okafor', 'Lindqvist', 'Moreau', 'Reyes', 'Calloway', 'Sato', 'Byrne', 'Vance', 'Adeyemi', 'Holt', 'Marlow'];
const person = (i, seed) => `${FIRST[(i * 7 + seed) % FIRST.length]} ${LAST[(i * 5 + seed * 3) % LAST.length]}`;

function item(id, type) {
  const r = rnd(id);
  const year = 1980 + Math.floor(r() * 46);
  const t = title(id);
  const base = {
    id, poster_path: id % 17 === 0 ? null : `/mock/p-${id}.svg`, backdrop_path: `/mock/b-${id}.svg`,
    overview: PLOTS[id % PLOTS.length](t.replace(/^The /, 'the ')),
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
  if ((m = path.match(/^\/collection\/(\d+)$/))) return { id: +m[1], name: `${title(+m[1]).replace(/^The /, 'The ')} Collection`, parts: page(+m[1], 'movie', 5).results };
  if ((m = path.match(/^\/tv\/(\d+)\/season\/(\d+)$/))) return { name: `Season ${m[2]}`, overview: 'The story continues.', poster_path: `/mock/p-${m[1]}${m[2]}.svg`,
    episodes: Array.from({ length: 8 }, (_, i) => ({ episode_number: i + 1, name: ['Arrival', 'The Map Room', 'Low Tide', 'Signal', 'Lanterns', 'The Crossing', 'Embers', 'Homecoming'][i], overview: PLOTS[(+m[1] + i) % PLOTS.length]('the coast'), still_path: `/mock/b-${+m[1] + i}.svg`, runtime: 45, air_date: '2024-01-01' })) };
  if ((m = path.match(/^\/(movie|tv)\/(\d+)$/))) {
    const id = +m[2], type = m[1], it = item(id, type);
    return { ...it, tagline: TAGS[id % TAGS.length], runtime: 90 + (id % 60), episode_run_time: [45], number_of_seasons: 3,
      genres: [{ name: 'Drama' }, { name: 'Adventure' }],
      seasons: type === 'tv' ? [1, 2, 3].map((n) => ({ season_number: n, name: `Season ${n}`, poster_path: `/mock/p-${id + n}.svg`, episode_count: 8, air_date: '2020-01-01' })) : [],
      belongs_to_collection: id % 2 ? { id: 10, name: `${title(10)} Collection` } : null,
      videos: { results: [{ site: 'YouTube', type: 'Trailer', official: true, key: 'M7lc1UVf-VE', name: 'Trailer' }] },
      credits: { cast: Array.from({ length: 10 }, (_, i) => ({ name: person(i, id), character: FIRST[(i * 3 + id + 5) % FIRST.length], profile_path: i % 3 ? `/mock/c-${i}.svg` : null })) },
      aggregate_credits: { cast: Array.from({ length: 8 }, (_, i) => ({ name: person(i, id), roles: [{ character: FIRST[(i * 3 + id + 5) % FIRST.length] }], profile_path: null })) },
      recommendations: page(hash(path) + 3, type, 12),
      release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ certification: '12A' }] }] },
      content_ratings: { results: [{ iso_3166_1: 'GB', rating: '15' }] },
      images: { logos: [] },
      'watch/providers': { results: { GB: { link: 'https://www.themoviedb.org/', flatrate: id % 3 ? [{ provider_name: 'BBC iPlayer', logo_path: '/mock/l-38.svg' }, { provider_name: 'Netflix', logo_path: '/mock/l-8.svg' }] : [{ provider_name: 'Netflix', logo_path: '/mock/l-8.svg' }], ads: id % 4 === 0 ? [{ provider_name: 'Channel 4', logo_path: '/mock/l-103.svg' }] : [] } } },
    };
  }
  throw Object.assign(new Error('mock: unhandled ' + path), { status: 404 });
}

// Generated artwork: a small landscape per film (mountains, sea, city, desert, space or forest) in its own colours.
function scene(id, w, hh) {
  const r = rnd(id * 7 + 3), h = HUES[id % HUES.length], h2 = (h + 30 + Math.floor(r() * 60)) % 360;
  const kind = id % 6, sunX = w * (0.25 + r() * 0.5), sunY = hh * (0.22 + r() * 0.2), sunR = Math.min(w, hh) * (0.07 + r() * 0.08);
  const sky = `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h2} 55% 9%)"/><stop offset=".55" stop-color="hsl(${h} 55% 28%)"/><stop offset="1" stop-color="hsl(${(h + 20) % 360} 70% 62%)"/></linearGradient>`;
  const glow = `<radialGradient id="gl" cx="${sunX / w}" cy="${sunY / hh}" r=".55"><stop offset="0" stop-color="hsl(${(h + 30) % 360} 90% 82% / .55)"/><stop offset="1" stop-color="hsl(${h} 90% 70% / 0)"/></radialGradient>`;
  let out = `<defs>${sky}${glow}</defs><rect width="${w}" height="${hh}" fill="url(#s)"/><rect width="${w}" height="${hh}" fill="url(#gl)"/>`;
  const stars = () => Array.from({ length: 70 }, () => `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * hh * 0.55).toFixed(0)}" r="${(r() * 1.6 + .3).toFixed(1)}" fill="#fff" opacity="${(r() * .7 + .2).toFixed(2)}"/>`).join('');
  const ridge = (base, amp, col, n = 9) => { let d = `M0 ${hh} L0 ${base}`; for (let i = 0; i <= n; i++) d += ` L${(w * i) / n} ${(base - r() * amp).toFixed(0)}`; return `<path d="${d} L${w} ${hh} Z" fill="${col}"/>`; };
  const sun = `<circle cx="${sunX}" cy="${sunY}" r="${sunR}" fill="hsl(${(h + 35) % 360} 95% 88%)"/>`;
  if (kind === 0) out += stars() + sun + ridge(hh * .62, hh * .2, `hsl(${h} 35% 22%)`) + ridge(hh * .74, hh * .14, `hsl(${h} 40% 14%)`) + ridge(hh * .86, hh * .1, `hsl(${h} 45% 7%)`);
  if (kind === 1) { const sea = hh * .64; out += sun + `<rect y="${sea}" width="${w}" height="${hh - sea}" fill="hsl(${h} 50% 12%)"/>` + Array.from({ length: 14 }, (_, i) => `<rect x="${sunX - sunR * (1.4 - i * .07)}" y="${sea + 6 + i * (hh - sea) / 15}" width="${sunR * 2 * (1.4 - i * .07)}" height="3" fill="hsl(${(h + 35) % 360} 95% 85%)" opacity="${(.7 - i * .045).toFixed(2)}"/>`).join(''); }
  if (kind === 2) { out += stars() + sun; let x = 0; while (x < w) { const bw = w * (.04 + r() * .06), bh = hh * (.18 + r() * .38); out += `<rect x="${x.toFixed(0)}" y="${(hh - bh).toFixed(0)}" width="${bw.toFixed(0)}" height="${bh.toFixed(0)}" fill="hsl(${h} 30% ${8 + r() * 6}%)"/>`; for (let k = 0; k < 6; k++) out += `<rect x="${(x + r() * bw * .8).toFixed(0)}" y="${(hh - bh + r() * bh * .9).toFixed(0)}" width="${Math.max(2, w / 300)}" height="${Math.max(3, hh / 160)}" fill="hsl(45 100% 75%)" opacity=".8"/>`; x += bw + 2; } }
  if (kind === 3) out += sun + ridge(hh * .7, hh * .08, `hsl(${(h + 20) % 360} 55% 38%)`, 4) + ridge(hh * .8, hh * .07, `hsl(${(h + 20) % 360} 50% 24%)`, 3) + ridge(hh * .9, hh * .05, `hsl(${h} 50% 12%)`, 3);
  if (kind === 4) { out += stars() + stars() + `<circle cx="${w * .62}" cy="${hh * .78}" r="${hh * .55}" fill="hsl(${h} 45% 22%)"/><circle cx="${w * .62}" cy="${hh * .78}" r="${hh * .55}" fill="none" stroke="hsl(${(h + 35) % 360} 90% 80%)" stroke-width="${hh / 160}" opacity=".7"/>` + `<ellipse cx="${w * .62}" cy="${hh * .5}" rx="${hh * .95}" ry="${hh * .06}" fill="none" stroke="hsl(${(h + 35) % 360} 80% 85% / .45)" stroke-width="${hh / 90}"/>`; }
  if (kind === 5) { out += sun + ridge(hh * .66, hh * .1, `hsl(${h} 30% 20%)`); for (let i = 0; i < 26; i++) { const x = r() * w, tw = w * (.02 + r() * .025), ty = hh * (.55 + r() * .3); out += `<path d="M${x.toFixed(0)} ${ty.toFixed(0)} L${(x + tw).toFixed(0)} ${hh} L${(x - tw).toFixed(0)} ${hh} Z" fill="hsl(${h} 40% ${6 + r() * 6}%)"/>`; } }
  return out + `<rect width="${w}" height="${hh}" fill="url(#gl)" opacity=".35"/>`;
}
function mockImage(file) {
  const id = +(file.match(/(\d+)/) || [0, 1])[1];
  const h = HUES[id % HUES.length];
  if (file.startsWith('l-')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="hsl(${h} 40% 30%)"/><text x="50" y="62" font-family="Bricolage Grotesque, sans-serif" font-weight="700" font-size="30" fill="#fff" text-anchor="middle">${String(id).slice(0, 2)}</text></svg>`;
  if (file.startsWith('c-')) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h} 25% 40%)"/><stop offset="1" stop-color="hsl(${h} 30% 18%)"/></linearGradient></defs><rect width="100" height="150" fill="url(#p)"/><circle cx="50" cy="58" r="22" fill="hsl(${h} 15% 70% / .55)"/><rect x="16" y="90" width="68" height="62" rx="30" fill="hsl(${h} 15% 70% / .55)"/></svg>`;
  const back = file.startsWith('b-');
  const [w, hh] = back ? [1280, 720] : [500, 750];
  const t = title(id).toUpperCase().replace(/^THE /, '');
  const poster = back ? '' : `<rect width="${w}" height="${hh}" fill="url(#fade)"/><text x="${w / 2}" y="${hh - 150}" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-size="26" letter-spacing="8" fill="#fff" opacity=".8">THE</text>` +
    t.split(' ').map((wd, i) => `<text x="${w / 2}" y="${hh - 92 + i * 62}" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-stretch="condensed" font-size="64" fill="#fff">${wd}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${hh}">${scene(id, w, hh)}${back ? '' : `<defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".85"/></linearGradient></defs>`}${poster}</svg>`;
}

module.exports = { mock, mockImage };
