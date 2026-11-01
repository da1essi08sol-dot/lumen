// LumenTV logo + loading screen. One template used in four places: the TV's "opening" screen, the browser's
// first page, the cover laid over a website while it loads, and (via logoSvg/backgroundCss) the start-up intro.
// Everything is self-contained (own class names, inline styles) so a website's own CSS can't break it.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The mark: a ring of white light with a soft glow inside — simple, like a lens catching the light.
// spin: a brighter streak travels round the ring (for loading).
export function logoSvg({ size = 120, spin = false, id = 'l' } = {}) {
  return `<svg class="lmn-logo${spin ? ' lmn-spin' : ''}" width="${size}" height="${size}" viewBox="0 0 120 120" aria-hidden="true">
  <defs>
    <filter id="${id}b" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="7"/></filter>
    <radialGradient id="${id}c" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".7" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
  </defs>
  <circle cx="60" cy="60" r="38" fill="url(#${id}c)"/>
  <circle class="lmn-halo" cx="60" cy="60" r="40" fill="none" stroke="#fff" stroke-width="9" filter="url(#${id}b)" opacity=".75"/>
  <circle class="lmn-ring" cx="60" cy="60" r="40" fill="none" stroke="#fff" stroke-width="6"/>
  ${spin ? `<g class="lmn-arc"><circle cx="60" cy="60" r="40" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-dasharray="46 400" transform="rotate(-90 60 60)" filter="url(#${id}b)"/>
  <circle cx="60" cy="60" r="40" fill="none" stroke="#fff" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="46 400" transform="rotate(-90 60 60)"/></g>` : ''}
</svg>`;
}

// The background in your chosen colour: rich in the middle, deeper at the edges. Very light colours
// (like Moonlight) are deepened more, so the white logo and text always stand out.
export function backgroundCss(accent = '255,255,255') {
  const [r, g, b] = String(accent).split(',').map(Number);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const k = lum > 0.6 ? 0.42 : lum > 0.4 ? 0.62 : 0.8;
  const mix = (f) => `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
  return `radial-gradient(120% 95% at 50% 42%, ${mix(k)} 0%, ${mix(k * 0.55)} 55%, ${mix(k * 0.22)} 100%)`;
}

// One flat colour for the start-up and closing screens: your colour, deepened a little if it's very light so
// the white writing always reads.
export function solidCss(accent = '255,255,255') {
  const [r, g, b] = String(accent).split(',').map(Number);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const k = lum > 0.6 ? 0.5 : lum > 0.4 ? 0.72 : 1;
  return `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
}

// The LumenTV logo: the name itself, in glowing white. split: each letter in its own <i> (for the start-up animation).
export function logoMark({ split = false, cls = '' } = {}) {
  const letters = (w) => (split ? [...w].map((c, i) => `<i style="--i:${i}">${c}</i>`).join('') : w);
  return `<div class="lmn-mark ${cls}"><span class="lmn-w1">${letters('Lumen')}</span><span class="lmn-w2">${letters('TV')}</span></div>`;
}

// diagonal "LumenTV LumenTV …" wallpaper, as a tiled SVG
export function wallUrl(opacity = 0.09) {
  const t = (x, y) => `<text x='${x}' y='${y}' font-family='Segoe UI Variable Display,Segoe UI,Helvetica,Arial,sans-serif' font-weight='800' font-size='44' letter-spacing='-1' fill='white' fill-opacity='${opacity}'>Lumen<tspan font-weight='300'>TV</tspan></text>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='440' height='150'>${t(0, 55)}${t(220, 130)}</svg>`;
  // fully encoded (quotes too) so it can sit inside any style attribute
  return `url(data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
}

export const LOADING_CSS = `
.lmn-load{position:fixed;inset:0;z-index:2147483647;overflow:hidden;display:grid;place-items:center;
  font-family:"Segoe UI Variable Display","Segoe UI",-apple-system,system-ui,sans-serif;color:#fff;transition:opacity .7s ease;cursor:none;-webkit-font-smoothing:antialiased;text-align:center;line-height:1.2;letter-spacing:normal}
.lmn-load *{box-sizing:border-box}
.lmn-wall{position:absolute;left:-60%;top:-60%;width:220%;height:220%;transform:rotate(-24deg);background-size:440px 150px;animation:lmnDrift 50s linear infinite}
@keyframes lmnDrift{to{background-position:440px 150px}}
.lmn-glow{position:absolute;inset:0;background:radial-gradient(30% 34% at 50% 44%,rgba(255,255,255,.16),transparent 70%)}
.lmn-mid{position:relative;display:flex;flex-direction:column;align-items:center;padding:0 6vw}
.lmn-mark{display:flex;align-items:baseline;gap:.08em;font-size:clamp(46px,6.2vw,104px);line-height:1;letter-spacing:-.04em;color:#fff;
  text-shadow:0 0 .18em rgba(255,255,255,.75),0 0 .55em rgba(255,255,255,.4),0 0 1.4em rgba(255,255,255,.22);white-space:nowrap}
.lmn-mark i{font-style:normal;display:inline-block}
.lmn-w1{font-weight:800}.lmn-w2{font-weight:300}
.lmn-mid>.lmn-mark{animation:lmnBreathe 2.6s ease-in-out infinite}
@keyframes lmnBreathe{50%{text-shadow:0 0 .1em rgba(255,255,255,.5),0 0 .3em rgba(255,255,255,.2),0 0 .8em rgba(255,255,255,.1)}}
.lmn-logo{overflow:visible;filter:drop-shadow(0 0 18px rgba(255,255,255,.55)) drop-shadow(0 0 60px rgba(255,255,255,.25))}
.lmn-halo{animation:lmnBreathe 2.6s ease-in-out infinite}
@keyframes lmnBreathe{50%{opacity:.35}}
.lmn-spin .lmn-arc{transform-origin:60px 60px;animation:lmnSpin 1.4s cubic-bezier(.45,.1,.55,.9) infinite}
@keyframes lmnSpin{to{transform:rotate(360deg)}}
.lmn-title{margin-top:44px;font-size:clamp(28px,4.2vw,64px);font-weight:750;letter-spacing:-.025em;max-width:80vw;text-wrap:balance;text-shadow:0 4px 30px rgba(0,0,0,.35)}
.lmn-sub{margin-top:14px;font-size:clamp(15px,1.45vw,22px);color:rgba(255,255,255,.72)}
.lmn-stage{margin-top:30px;font-size:clamp(13px,1.1vw,17px);font-weight:650;letter-spacing:.16em;text-transform:uppercase;color:rgba(255,255,255,.9);min-height:1.3em}
.lmn-bar{margin-top:14px;width:min(320px,40vw);height:4px;border-radius:4px;background:rgba(255,255,255,.18);overflow:hidden}
.lmn-bar i{display:block;width:40%;height:100%;border-radius:4px;background:linear-gradient(90deg,transparent,#fff,transparent);animation:lmnBar 1.4s ease-in-out infinite}
@keyframes lmnBar{from{transform:translateX(-100%)}to{transform:translateX(250%)}}
.lmn-brand{position:absolute;left:4vw;bottom:4vh;display:flex;align-items:center;gap:12px;font-size:20px;font-weight:800;letter-spacing:-.01em}
.lmn-brand .lmn-logo{filter:drop-shadow(0 0 8px rgba(255,255,255,.6))}
.lmn-brand b{font-weight:300}
.lmn-hint{position:absolute;right:4vw;bottom:4.4vh;font-size:15px;color:rgba(255,255,255,.55)}
.lmn-choice{display:none;margin-top:34px;gap:18px;justify-content:center}
.lmn-load.lmn-ask .lmn-choice{display:flex}
.lmn-load.lmn-ask .lmn-bar,.lmn-load.lmn-ask .lmn-stage{display:none}
.lmn-load.lmn-ask .lmn-arc{display:none}
.lmn-btn{font:inherit;font-size:clamp(15px,1.35vw,21px);font-weight:700;padding:16px 30px;border-radius:999px;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:#fff;transition:transform .35s cubic-bezier(.34,1.4,.64,1),background .25s,color .25s,box-shadow .35s}
.lmn-btn.on{background:#fff;color:#111;border-color:transparent;transform:scale(1.07);box-shadow:0 0 0 2px rgba(255,255,255,.4),0 0 40px rgba(255,255,255,.45)}
`;

export function loadingHtml({ title = '', sub = '', accent = '255,255,255', stage = 'Getting it ready', hint = 'Press Home on your remote to go back' } = {}) {
  return `<div class="lmn-load" id="__lumen_cover" style="background:${backgroundCss(accent)}">
  <div class="lmn-wall" style="background-image:${wallUrl()}"></div>
  <div class="lmn-glow"></div>
  <div class="lmn-mid">
    ${logoMark()}
    <div class="lmn-title">${esc(title)}</div>
    <div class="lmn-sub">${esc(sub)}</div>
    <div class="lmn-stage">${esc(stage)}</div>
    <div class="lmn-bar"><i></i></div>
    <div class="lmn-choice"><button class="lmn-btn on" data-c="site">Open the website anyway</button><button class="lmn-btn" data-c="back">Back to Lumen</button></div>
  </div>
  <div class="lmn-hint">${esc(hint)}</div>
  <style>${LOADING_CSS}</style>
</div>`;
}
