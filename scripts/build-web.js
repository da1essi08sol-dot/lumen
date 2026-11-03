// Builds Lumen Web (the phone app that runs on its own) into dist-web/: the phone app, its styles and fonts,
// the on-phone backend, and Lumen's TMDB code turned into a browser module.
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, process.argv[2] || 'dist-web');
const pkg = require(path.join(ROOT, 'package.json'));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'shared', 'fonts'), { recursive: true });
const cp = (from, to) => fs.copyFileSync(path.join(ROOT, from), path.join(OUT, to));
const rel = (s) => s.replace(/(['"(])\/shared\//g, '$1./shared/');
for (const f of ['index.html', 'manifest.webmanifest', 'backend.js']) cp(`web/${f}`, f);
fs.writeFileSync(path.join(OUT, 'sw.js'), fs.readFileSync(path.join(ROOT, 'web/sw.js'), 'utf8').replace('__VERSION__', pkg.version + '-' + Date.now()));
fs.writeFileSync(path.join(OUT, 'phone.js'), rel(fs.readFileSync(path.join(ROOT, 'public/phone/phone.js'), 'utf8')));
cp('public/phone/phone.css', 'phone.css');
cp('public/shared/icons.js', 'shared/icons.js');
cp('public/shared/theme-phone.css', 'shared/theme-phone.css');
fs.writeFileSync(path.join(OUT, 'shared/fonts.css'), fs.readFileSync(path.join(ROOT, 'public/shared/fonts.css'), 'utf8').replace(/url\('\/shared\/fonts\//g, "url('fonts/"));
fs.writeFileSync(path.join(OUT, 'shared/theme-phone.css'), fs.readFileSync(path.join(ROOT, 'public/shared/theme-phone.css'), 'utf8').replace(/url\('\/shared\/fonts\//g, "url('fonts/"));
for (const f of fs.readdirSync(path.join(ROOT, 'public/shared/fonts'))) cp(`public/shared/fonts/${f}`, `shared/fonts/${f}`);
const tm = fs.readFileSync(path.join(ROOT, 'server/tmdb.js'), 'utf8').replace(/^'use strict';/m, '');
fs.writeFileSync(path.join(OUT, 'tmdb.js'), `// generated from server/tmdb.js by scripts/build-web.js\nconst module = { exports: {} };\nconst require = () => { throw new Error('not in the browser'); };\n${tm}\nexport { createTmdb, TmdbError, SERVICES };\n`);
for (const n of [180, 192, 512]) { const f = path.join(ROOT, 'web', `icon-${n}.png`); if (fs.existsSync(f)) fs.copyFileSync(f, path.join(OUT, `icon-${n}.png`)); }
// the full TV interface (Lumen on a TV through Lumen Browser for iPhone, or on a phone turned sideways), at tv/,
// running on the same on-phone backend — so it shares the phone's library, settings and Continue Watching
fs.mkdirSync(path.join(OUT, 'tv', 'sounds'), { recursive: true });
const tvRel = (s) => s.replace(/(['"`(])\/shared\//g, '$1../shared/').replace(/(['"`(])\/tv\//g, '$1./');
for (const f of fs.readdirSync(path.join(ROOT, 'public/tv'))) {
  const src = path.join(ROOT, 'public/tv', f);
  if (fs.statSync(src).isDirectory()) continue;
  if (/\.(js|css)$/.test(f)) fs.writeFileSync(path.join(OUT, 'tv', f), tvRel(fs.readFileSync(src, 'utf8')));
}
for (const f of fs.readdirSync(path.join(ROOT, 'public/tv/sounds'))) cp(`public/tv/sounds/${f}`, `tv/sounds/${f}`);
for (const f of ['loading.js', 'logo.svg', 'theme-tv.css']) {
  const src = path.join(ROOT, 'public/shared', f);
  if (/\.(js|css)$/.test(f)) fs.writeFileSync(path.join(OUT, 'shared', f), fs.readFileSync(src, 'utf8').replace(/url\('\/shared\/fonts\//g, "url('fonts/").replace(/(['"`(])\/shared\//g, '$1./'));
  else cp(`public/shared/${f}`, `shared/${f}`);
}
fs.writeFileSync(path.join(OUT, 'tv', 'index.html'), fs.readFileSync(path.join(ROOT, 'public/tv/index.html'), 'utf8')
  .replace(/href="\/shared\//g, 'href="../shared/')
  .replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="theme-color" content="#000000">\n<link rel="manifest" href="../manifest.webmanifest">\n<link rel="apple-touch-icon" href="../icon-180.png">')
  .replace('<script type="module" src="app.js"></script>', '<script type="module">\n  import * as backend from \'../backend.js\';\n  window.LUMEN_WEB = backend;\n  await import(\'./app.js\');\n</script>'));
// the QR code maker, for pairing a remote with the iPhone app
fs.writeFileSync(path.join(OUT, 'qr.js'), `// generated from server/qr.js by scripts/build-web.js\nconst module = { exports: {} };\n${fs.readFileSync(path.join(ROOT, 'server/qr.js'), 'utf8').replace(/^'use strict';/m, '')}\nexport { encode, toSvg };\n`);
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
console.log('Lumen Web built in', path.relative(ROOT, OUT));
