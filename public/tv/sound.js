// Lumen UI sounds — synthesised live with Web Audio (no files to load), so they're instant and tiny.
// Three styles share the same events: move, select, back, bump (edge reached), open, toggle, key, swipe.

let ctx = null, master = null, wet = null;
const state = { on: true, style: 'soft', volume: 0.6 };

export function configure({ on, style, volume } = {}) {
  if (typeof on === 'boolean') state.on = on;
  if (style) state.style = style;
  if (typeof volume === 'number') state.volume = volume;
  if (master) master.gain.value = state.volume * 0.5;
}

export const settings = () => ({ ...state });

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain(); master.gain.value = state.volume * 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    // a short, soft "room" so sounds feel round rather than clinical
    wet = ctx.createGain(); wet.gain.value = 0.18;
    const conv = ctx.createConvolver(); conv.buffer = roomImpulse(0.55);
    wet.connect(conv).connect(master);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
function roomImpulse(sec) {
  const len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
  return b;
}
// unlock audio on the first key press / click (browsers require a gesture unless autoplay is allowed)
addEventListener('keydown', () => audio(), { once: true, capture: true });
addEventListener('pointerdown', () => audio(), { once: true, capture: true });

// one enveloped oscillator
function tone({ f = 880, f2 = null, type = 'sine', dur = 0.08, gain = 0.2, attack = 0.004, delay = 0, room = true, q = null }) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + 0.005 + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  if (q) { const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = q; node.connect(lp); node = lp; }
  node.connect(g); g.connect(master); if (room) g.connect(wet);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise({ dur = 0.25, from = 400, to = 3000, gain = 0.06, delay = 0 }) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + 0.005 + delay;
  const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource(); src.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(from, t); bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.35); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g); g.connect(master); g.connect(wet);
  src.start(t); src.stop(t + dur + 0.02);
}
const jitter = (f) => f * (1 + (Math.random() - 0.5) * 0.03); // tiny variation so repeats don't feel robotic

// ---- the three styles
const STYLES = {
  // warm, rounded taps — the default
  soft: {
    move: (dir) => tone({ f: jitter(dir === 'up' || dir === 'down' ? 620 : 740), f2: 540, dur: 0.07, gain: 0.16, q: 2600 }),
    select: () => { tone({ f: 660, dur: 0.16, gain: 0.2, type: 'triangle', q: 3000 }); tone({ f: 990, dur: 0.22, gain: 0.12, delay: 0.045, q: 3500 }); },
    back: () => { tone({ f: 700, f2: 420, dur: 0.14, gain: 0.16, q: 2400 }); },
    bump: () => tone({ f: 150, f2: 110, dur: 0.11, gain: 0.32, type: 'triangle', room: false, q: 900 }),
    open: () => { noise({ dur: 0.28, from: 500, to: 2600, gain: 0.05 }); tone({ f: 880, dur: 0.3, gain: 0.08, delay: 0.1 }); tone({ f: 1320, dur: 0.34, gain: 0.05, delay: 0.16 }); },
    toggle: (on) => tone({ f: on ? 520 : 780, f2: on ? 780 : 520, dur: 0.1, gain: 0.15, q: 2800 }),
    key: () => tone({ f: jitter(1200), f2: 900, dur: 0.035, gain: 0.08, room: false, q: 4000 }),
    swipe: () => noise({ dur: 0.22, from: 900, to: 300, gain: 0.05 }),
  },
  // short, precise clicks, a bit like a premium remote
  crisp: {
    move: () => tone({ f: jitter(2100), f2: 1700, dur: 0.025, gain: 0.12, type: 'square', room: false, q: 5000 }),
    select: () => { tone({ f: 1500, dur: 0.04, gain: 0.14, type: 'square', room: false, q: 5000 }); tone({ f: 2200, dur: 0.06, gain: 0.08, delay: 0.035, type: 'square', room: false, q: 6000 }); },
    back: () => tone({ f: 1400, f2: 900, dur: 0.05, gain: 0.12, type: 'square', room: false, q: 4000 }),
    bump: () => tone({ f: 220, dur: 0.06, gain: 0.25, type: 'square', room: false, q: 700 }),
    open: () => { tone({ f: 1200, dur: 0.05, gain: 0.1, type: 'square', room: false, q: 5000 }); tone({ f: 1800, dur: 0.08, gain: 0.08, delay: 0.05, type: 'square', room: false, q: 6000 }); },
    toggle: (on) => tone({ f: on ? 1600 : 1100, dur: 0.04, gain: 0.12, type: 'square', room: false, q: 5000 }),
    key: () => tone({ f: jitter(2600), dur: 0.02, gain: 0.07, type: 'square', room: false, q: 6000 }),
    swipe: () => noise({ dur: 0.12, from: 2500, to: 900, gain: 0.04 }),
  },
  // glassy chimes — more musical
  glass: {
    move: (dir) => { const n = [1047, 1175, 1319, 1568][Math.floor(Math.random() * 4)]; tone({ f: dir === 'up' || dir === 'down' ? n * 0.75 : n, dur: 0.28, gain: 0.07, attack: 0.002 }); },
    select: () => [1047, 1319, 1568].forEach((f, i) => tone({ f, dur: 0.45, gain: 0.08, delay: i * 0.05, attack: 0.002 })),
    back: () => [1319, 988].forEach((f, i) => tone({ f, dur: 0.3, gain: 0.08, delay: i * 0.06, attack: 0.002 })),
    bump: () => tone({ f: 392, dur: 0.2, gain: 0.14, type: 'triangle', attack: 0.002, q: 1500 }),
    open: () => [784, 1047, 1319, 1760].forEach((f, i) => tone({ f, dur: 0.6, gain: 0.06, delay: i * 0.06, attack: 0.002 })),
    toggle: (on) => tone({ f: on ? 1568 : 1047, dur: 0.3, gain: 0.08, attack: 0.002 }),
    key: () => tone({ f: jitter(2093), dur: 0.12, gain: 0.04, attack: 0.002 }),
    swipe: () => noise({ dur: 0.3, from: 3000, to: 800, gain: 0.035 }),
  },
  // 8-bit game console blips
  arcade: {
    move: (dir) => tone({ f: jitter(dir === 'up' || dir === 'down' ? 660 : 880), dur: 0.05, gain: 0.07, type: 'square', room: false, attack: 0.001 }),
    select: () => [523, 659, 784].forEach((f, i) => tone({ f, dur: 0.06, gain: 0.07, type: 'square', delay: i * 0.045, room: false, attack: 0.001 })),
    back: () => [784, 523].forEach((f, i) => tone({ f, dur: 0.06, gain: 0.07, type: 'square', delay: i * 0.05, room: false, attack: 0.001 })),
    bump: () => tone({ f: 110, f2: 70, dur: 0.12, gain: 0.12, type: 'square', room: false, attack: 0.001 }),
    open: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.07, gain: 0.07, type: 'square', delay: i * 0.05, room: false, attack: 0.001 })),
    toggle: (on) => tone({ f: on ? 988 : 659, dur: 0.07, gain: 0.07, type: 'square', room: false, attack: 0.001 }),
    key: () => tone({ f: jitter(1319), dur: 0.03, gain: 0.05, type: 'square', room: false, attack: 0.001 }),
    swipe: () => tone({ f: 1200, f2: 300, dur: 0.12, gain: 0.05, type: 'square', room: false, attack: 0.001 }),
  },
  // warm wooden mallets
  marimba: {
    move: (dir) => { const f = jitter(dir === 'up' || dir === 'down' ? 523 : 659); tone({ f, dur: 0.22, gain: 0.16, attack: 0.002 }); tone({ f: f * 4, dur: 0.05, gain: 0.03, attack: 0.001, room: false }); },
    select: () => [523, 784].forEach((f, i) => { tone({ f, dur: 0.35, gain: 0.16, delay: i * 0.07, attack: 0.002 }); tone({ f: f * 4, dur: 0.06, gain: 0.03, delay: i * 0.07, attack: 0.001, room: false }); }),
    back: () => [659, 440].forEach((f, i) => tone({ f, dur: 0.3, gain: 0.15, delay: i * 0.07, attack: 0.002 })),
    bump: () => tone({ f: 196, dur: 0.25, gain: 0.2, attack: 0.002, q: 1200 }),
    open: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.4, gain: 0.13, delay: i * 0.06, attack: 0.002 })),
    toggle: (on) => tone({ f: on ? 784 : 523, dur: 0.3, gain: 0.15, attack: 0.002 }),
    key: () => tone({ f: jitter(1047), dur: 0.12, gain: 0.07, attack: 0.002 }),
    swipe: () => [784, 659, 523].forEach((f, i) => tone({ f, dur: 0.18, gain: 0.08, delay: i * 0.035, attack: 0.002 })),
  },
  // spacey synth swooshes
  cosmic: {
    move: (dir) => tone({ f: jitter(dir === 'up' || dir === 'down' ? 330 : 440), f2: dir === 'up' || dir === 'right' ? 660 : 220, dur: 0.16, gain: 0.07, type: 'sawtooth', q: 1800 }),
    select: () => { tone({ f: 220, f2: 880, dur: 0.3, gain: 0.07, type: 'sawtooth', q: 2400 }); tone({ f: 1320, dur: 0.5, gain: 0.04, delay: 0.12 }); },
    back: () => tone({ f: 660, f2: 165, dur: 0.28, gain: 0.07, type: 'sawtooth', q: 1600 }),
    bump: () => tone({ f: 90, f2: 60, dur: 0.25, gain: 0.18, q: 600 }),
    open: () => { noise({ dur: 0.5, from: 300, to: 5000, gain: 0.05 }); tone({ f: 110, f2: 880, dur: 0.6, gain: 0.07, type: 'sawtooth', q: 2600 }); },
    toggle: (on) => tone({ f: on ? 330 : 660, f2: on ? 660 : 330, dur: 0.2, gain: 0.07, type: 'sawtooth', q: 2000 }),
    key: () => tone({ f: jitter(1760), dur: 0.08, gain: 0.03 }),
    swipe: () => noise({ dur: 0.35, from: 4000, to: 400, gain: 0.05 }),
  },
  // playful bubbles
  bubble: {
    move: () => tone({ f: jitter(500), f2: 1100, dur: 0.07, gain: 0.12, attack: 0.002, room: false }),
    select: () => [0, 0.06].forEach((d, i) => tone({ f: 600 + i * 300, f2: 1400 + i * 400, dur: 0.08, gain: 0.12, delay: d, attack: 0.002 })),
    back: () => tone({ f: 1200, f2: 450, dur: 0.1, gain: 0.12, attack: 0.002 }),
    bump: () => tone({ f: 260, f2: 160, dur: 0.12, gain: 0.18, attack: 0.002, room: false }),
    open: () => [0, 0.05, 0.1].forEach((d, i) => tone({ f: 500 + i * 250, f2: 1300 + i * 350, dur: 0.09, gain: 0.1, delay: d, attack: 0.002 })),
    toggle: (on) => tone({ f: on ? 600 : 1200, f2: on ? 1300 : 500, dur: 0.09, gain: 0.12, attack: 0.002 }),
    key: () => tone({ f: jitter(900), f2: 1500, dur: 0.04, gain: 0.07, attack: 0.002, room: false }),
    swipe: () => [0, 0.04, 0.08].forEach((d) => tone({ f: jitter(700), f2: 1400, dur: 0.05, gain: 0.06, delay: d, attack: 0.002, room: false })),
  },
};
export const STYLE_NAMES = { soft: 'Soft', crisp: 'Crisp', glass: 'Glass', arcade: 'Arcade', marimba: 'Marimba', cosmic: 'Cosmic', bubble: 'Bubble' };

// ---- the LumenTV start-up sound: three deep, heavy bass notes rising root → fifth → octave, each with a warm
// string section swelling in over it (legato, so it flows rather than blips). The last note opens into a full,
// lush string chord that holds for a second and fades into a soft hall. Built so it can be played forwards
// (start-up) or rendered and played backwards (closing — the reverb tail becomes a rising swell).
export const INTRO = { beats: [0, 0.4, 0.8], hold: 0.5, fade: 0.9, tail: 0.6 };
export const INTRO_LENGTH = INTRO.beats[2] + INTRO.hold + INTRO.fade + INTRO.tail; // ≈ 2.8 s including the reverb
function scheduleIntro(ac, out, t0) {
  const sr = ac.sampleRate;
  // a big, soft hall (smooth decay, slightly darker as it fades) so the strings sound like a real room
  const irLen = Math.floor(sr * 1.5), ir = ac.createBuffer(2, irLen, sr);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0;
    for (let i = 0; i < irLen; i++) { const x = i / irLen, k = 0.5 - 0.42 * x; lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - x, 3) * (i < sr * 0.02 ? i / (sr * 0.02) : 1); } }
  const verb = ac.createConvolver(); verb.buffer = ir;
  const wet = ac.createGain(); wet.gain.value = 0.4; wet.connect(verb).connect(out);
  const dry = ac.createGain(); dry.gain.value = 0.85; dry.connect(out);
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);                       // MIDI note → Hz
  const B = INTRO.beats.map((at) => t0 + at), tHold = B[2] + INTRO.hold, tEnd = tHold + INTRO.fade;

  // 1 · the bass: a pure, round sub note with a soft (not clicky) start, plus a quiet warm overtone so small
  //     TV speakers still carry it. A1 → E2 → A2.
  [33, 40, 45].forEach((m, i) => {
    const f = hz(m), t = B[i], last = i === 2, end = last ? tEnd : B[i + 1] + 0.35;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(last ? 0.9 : 0.8, t + 0.03);
    if (last) { g.gain.linearRampToValueAtTime(0.7, t + 0.25); g.gain.linearRampToValueAtTime(0.62, tHold); g.gain.exponentialRampToValueAtTime(0.02, end - 0.15); g.gain.linearRampToValueAtTime(0, end); }
    else { g.gain.linearRampToValueAtTime(0.6, end - 0.3); g.gain.linearRampToValueAtTime(0.0001, end); }  // sustains, then hands over
    const sub = ac.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(f * 1.03, t); sub.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    const warm = ac.createOscillator(), wg = ac.createGain(), wl = ac.createBiquadFilter();
    warm.type = 'triangle'; warm.frequency.value = f * 2; wg.gain.value = 0.55; wl.type = 'lowpass'; wl.frequency.value = 420; wl.Q.value = 0.5;
    // a touch of warm saturation: adds the harmonics that make deep bass felt even on small speakers
    const sat = ac.createWaveShaper(), cv = new Float32Array(1024); for (let k = 0; k < 1024; k++) { const x = k / 511.5 - 1; cv[k] = Math.tanh(x * 1.8) / Math.tanh(1.8); } sat.curve = cv;
    const pre = ac.createGain(); pre.gain.value = 1; sub.connect(pre); warm.connect(wl).connect(wg).connect(pre); pre.connect(sat).connect(g);
    g.connect(dry); const gw = ac.createGain(); gw.gain.value = 0.18; g.connect(gw).connect(wet);
    [sub, warm].forEach((o) => { o.start(t); o.stop(end + 0.05); });
  });

  // 2 · the strings: each note is a small ensemble (several slightly detuned bowed voices spread across the
  //     stereo field), with a slow bow-in, a gentle late vibrato and a soft, dark tone.
  const chords = [
    [57, 64],                    // A3 E4           — open, calm
    [56, 59, 64, 71],            // G#3 B3 E4 B4     — lifts
    [57, 61, 64, 71, 73, 76],    // A3 C#4 E4 B4 C#5 E5 — the full, warm bloom (A add9)
  ];
  const voice = (m, t, peak, end, last, k) => {
    const f = hz(m), g = ac.createGain(), lp = ac.createBiquadFilter(), hp = ac.createBiquadFilter();
    lp.type = 'lowpass'; lp.Q.value = 0.4; hp.type = 'highpass'; hp.frequency.value = 160; hp.Q.value = 0.5;
    const att = last ? 0.18 : 0.1;
    lp.frequency.setValueAtTime(700, t); lp.frequency.linearRampToValueAtTime(last ? 2600 : 1900, t + att + 0.15);
    lp.frequency.setTargetAtTime(1400, last ? tHold : t + att + 0.2, 0.6);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + att);
    if (last) { g.gain.setValueAtTime(peak, t + att); g.gain.linearRampToValueAtTime(peak * 0.85, tHold); g.gain.exponentialRampToValueAtTime(peak * 0.03, end - 0.15); g.gain.linearRampToValueAtTime(0, end); }
    else { g.gain.setValueAtTime(peak, end - 0.25); g.gain.linearRampToValueAtTime(0.0001, end); }   // crossfades into the next chord
    // shared vibrato for this note, fading in after the bow settles
    const vib = ac.createOscillator(), vd = ac.createGain(); vib.frequency.value = 5.1 + k * 0.17;
    vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(f * 0.004, t + att + 0.3); vib.connect(vd);
    const detune = [-9, -3, 3, 9], pans = [-0.6, -0.2, 0.2, 0.6];
    detune.forEach((c, j) => {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = c + (k % 2 ? 2 : -2);
      vd.connect(o.frequency);
      const vg = ac.createGain(); vg.gain.value = 1.5;
      let n = o.connect(vg);
      if (ac.createStereoPanner) { const pn = ac.createStereoPanner(); pn.pan.value = pans[(j + k) % 4]; n = n.connect(pn); }
      n.connect(hp); o.start(t); o.stop(end + 0.05);
    });
    hp.connect(lp).connect(g); g.connect(dry); g.connect(wet);
    vib.start(t); vib.stop(end + 0.05);
  };
  chords.forEach((notes, i) => {
    const last = i === 2, t = B[i], end = last ? tEnd : B[i + 1] + 0.3;
    const peak = (last ? 0.05 : 0.055) * (last ? 1 : 1.1);
    notes.forEach((m, k) => voice(m, t, peak * (m > 70 ? 0.7 : 1), end, last, k));
  });

  // 3 · a low cello line doubling the bass an octave up, so the rise is felt as one smooth gesture
  [45, 52, 57].forEach((m, i) => { const last = i === 2; voice(m, B[i], 0.035, last ? tEnd : B[i + 1] + 0.3, last, 7 + i); });
}
// start-up: play it (after `delay` seconds). Returns the seconds until the first beat.
export function intro(delay = 0.05) {
  const a = audio(); if (!a) return delay;
  const t0 = a.currentTime + delay;
  const bus = a.createGain(); bus.gain.value = Math.max(0.15, state.volume) * 0.6; bus.connect(a.destination);
  scheduleIntro(a, bus, t0);
  return delay;
}
// closing: the same sound rendered, then played backwards
export async function outro() {
  const a = audio(); if (!a) return 0;
  const sr = a.sampleRate, len = Math.ceil((INTRO_LENGTH + 0.1) * sr);
  const off = new OfflineAudioContext(2, len, sr);
  const bus = off.createGain(); bus.gain.value = Math.max(0.15, state.volume) * 0.6; bus.connect(off.destination);
  scheduleIntro(off, bus, 0.02);
  const buf = await off.startRendering();
  for (let c = 0; c < buf.numberOfChannels; c++) buf.getChannelData(c).reverse();
  const src = a.createBufferSource(); src.buffer = buf; src.connect(a.destination);
  src.start(a.currentTime + 0.02);
  return buf.duration;
}

// ---- your own start-up / closing sounds: public/tv/sounds/startup.mp3 and shutdown.mp3. If they're there,
// Lumen uses them instead of the built-in sound. Each file is analysed when it loads, so the logo pulses on the
// sound's own hits and Lumen opens (or closes) right as the sound has died away — whatever file you use.
const files = {};
function analyse(buf) {
  const sr = buf.sampleRate, ch = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  const hop = Math.floor(sr * 0.01), win = Math.floor(sr * 0.03), db = [];
  let peak = 0;
  for (let i = 0; i + win < buf.length; i += hop) {
    let sum = 0; for (let k = i; k < i + win; k++) for (const d of ch) { sum += d[k] * d[k]; peak = Math.max(peak, Math.abs(d[k])); }
    db.push(10 * Math.log10(sum / win / ch.length + 1e-12));
  }
  const top = Math.max(...db);
  let endF = db.length - 1; while (endF > 0 && db[endF] < top - 36) endF--;      // where it has faded away
  const end = Math.min(buf.duration, (endF + 1) * 0.01 + 0.05);
  // where it has gone completely quiet (for the closing sound, which should be heard right to the end)
  let tailF = db.length - 1; while (tailF > 0 && db[tailF] < top - 58) tailF--;
  const tail = Math.min(buf.duration, (tailF + 1) * 0.01 + 0.1);
  const beats = [];                                                               // the hits: sudden rises in loudness
  for (let i = 10, armed = true; i < db.length - 10 && i * 0.01 < end * 0.7; i++) {
    const rise = db[i] - Math.min(...db.slice(i - 10, i));
    if (armed && rise > 6) {
      const peakDb = Math.max(...db.slice(i, i + 10)), t = Math.max(0, (i - 1) * 0.01);
      if (peakDb > top - 10 && (!beats.length || t - beats[beats.length - 1] > 0.2)) beats.push(+t.toFixed(2));
      armed = false; if (beats.length === 4) break;
    } else if (rise < 3) armed = true;
  }
  if (!beats.length) beats.push(0);
  return { buf, beats, end, tail, peak };
}
async function loadFile(name) {
  if (name in files) return files[name];
  files[name] = (async () => {
    try {
      const a = audio(); if (!a) return null;
      const r = await fetch(`/tv/sounds/${name}.mp3`, { cache: 'no-cache' }); if (!r.ok) return null;
      return analyse(await a.decodeAudioData(await r.arrayBuffer()));
    } catch { return null; }
  })();
  return files[name];
}
loadFile('startup'); loadFile('shutdown');                                        // get them ready straight away
// plays a file `delay` s from now; with fadeFrom/end (seconds into the sound) it fades smoothly to silence by `end`.
// Returns stop(sec): fade out over `sec` seconds from now (used when the intro is skipped).
function playFile(f, delay, fadeFrom = null, end = null) {
  const a = audio(), src = a.createBufferSource(), g = a.createGain(), t0 = a.currentTime + delay;
  const level = Math.min(1, 0.95 / (f.peak || 1)) * Math.max(0.2, Math.min(1, state.volume * 1.4));
  g.gain.setValueAtTime(level, t0);
  if (end != null) {
    g.gain.setValueAtTime(level, t0 + fadeFrom);
    g.gain.linearRampToValueAtTime(level * 0.35, t0 + fadeFrom + (end - fadeFrom) * 0.5);
    g.gain.linearRampToValueAtTime(0, t0 + end);
  }
  src.buffer = f.buf; src.connect(g).connect(a.destination); src.start(t0);
  if (end != null) src.stop(t0 + end + 0.05);
  return (sec = 0.4) => { try { const now = a.currentTime; g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.linearRampToValueAtTime(0, now + sec); src.stop(now + sec + 0.05); } catch {} };
}
// start-up: what to play and when. → { lead, beats, fadeFrom, end, stop } in seconds from now. The intro lasts
// until a little after the sound's last hit; over its last stretch the sound fades out while the picture fades
// into the menu, so both arrive at the menu together.
export async function introPlan(lead = 0.5, withSound = true) {
  const f = await loadFile('startup');
  if (f) {
    const lastHit = f.beats[f.beats.length - 1];
    const end = +Math.min(f.end, lastHit + 1.9).toFixed(2), fadeFrom = +Math.min(end - 0.6, lastHit + 0.5).toFixed(2);
    const stop = withSound ? playFile(f, lead, fadeFrom, end) : null;
    return { lead, beats: f.beats, fadeFrom, end, stop };
  }
  if (withSound) intro(lead);
  return { lead, beats: INTRO.beats, fadeFrom: INTRO.beats[2] + INTRO.hold + INTRO.fade * 0.35, end: INTRO_LENGTH };
}
// closing: your shutdown sound if you have one (else the start-up sound backwards). → { length, beats }
export async function outroPlan(withSound = true) {
  const f = await loadFile('shutdown');
  if (f) { if (withSound) playFile(f, 0.02); return { length: (f.tail || f.end) + 0.25, beats: f.beats }; }   // Lumen closes once the sound has fully finished
  const T = withSound ? await outro() : INTRO_LENGTH;
  return { length: T || INTRO_LENGTH, beats: INTRO.beats.map((b) => (T || INTRO_LENGTH) - 0.02 - b) };
}

let last = 0;
export function play(name, arg) {
  if (!state.on || document.hidden) return;
  const now = performance.now();
  if (name === 'move' && now - last < 28) return; // held-down arrows: don't machine-gun
  last = now;
  try { (STYLES[state.style] || STYLES.soft)[name]?.(arg); } catch {}
}

// the start-up sound as audio data (used for checking it, and for the backwards closing sound)
export async function renderIntro(sr = 44100) {
  const off = new OfflineAudioContext(2, Math.ceil((INTRO_LENGTH + 0.1) * sr), sr);
  const bus = off.createGain(); bus.gain.value = 0.6; bus.connect(off.destination);
  scheduleIntro(off, bus, 0.02);
  return off.startRendering();
}
