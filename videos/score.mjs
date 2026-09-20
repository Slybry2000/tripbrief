// "Signal" - the score for the TripBrief demo film.
//
// 84 BPM, A minor, 50 bars. The tempo is chosen so the film's two most
// important frames land on downbeats: the money shot at 105.72s is bar 38
// (105.71s) and the end card at 131.30s is bar 47 (131.43s).
//
// Nine sections with their own instrumentation, so the music has an arc
// instead of one continuous texture:
//   open    bars  1-4   pad, sub, a single plucked figure
//   brief   bars  5-10  + eighth-note plucks, shaker
//   search  bars 11-14  + kick, walking bass
//   LIFT    bars 15-19  full band, the theme enters on the bell
//   send    bars 20-27  sustained energy, the theme develops
//   wait    bars 28-30  everything strips away but a rising, unresolved pad
//   land    bars 31-37  full return, theme an octave up, brightest point
//   MONEY   bars 38-42  drums and bell out; a held suspension under the voice
//   rebuild bars 43-46  the band comes back
//   end     bars 47-50  the theme once more, halving in density, resolving to Am
//
//   node score.mjs [out.wav]
import { writeWav, SR, db, rms } from "./dsp.mjs";
import { mtof, pluck, fmBell, padVoice, bass, kick, shaker, rim, reverb, add, stereoBuf, mixInto, highpass, lowpass, resetRnd, rnd } from "./synth.mjs";

// The tempo is taken from the film rather than fixed, so the money shot lands
// on bar 38 whatever a given take's timings turn out to be. Fixed, the score
// drifts out of step with the picture every time the film is re-recorded.
//
//   node videos/score.mjs out.wav --money=<seconds> --len=<seconds>
const arg = (name, fallback) => {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? Number(found.split("=")[1]) : fallback;
};
const BARS = 50;
const MONEY_BAR = 38;
const BEAT = arg("money", 105.71) / ((MONEY_BAR - 1) * 4);
const BPM = 60 / BEAT;
const BAR = BEAT * 4;
const LEN = Math.max(BARS * BAR + 6, arg("len", 0) + 1);
const barAt = (bar, beat = 0) => (bar - 1) * BAR + beat * BEAT;

resetRnd();

// ------------------------------------------------------- harmony, voice-led
// Four upper voices per chord, chosen so that between any two neighbouring
// chords at most two voices move, and never by more than a tone. That is what
// makes the progression sound written rather than transposed.
const V = {
  Am:    [57, 60, 64, 69],   // A3 C4 E4 A4
  F:     [57, 60, 65, 69],   // F/A  - only E4 -> F4 moves
  C:     [55, 60, 64, 67],   // C/G  - A3 -> G3, A4 -> G4
  G:     [55, 59, 62, 67],   // C4 -> B3, E4 -> D4
  Em:    [55, 59, 64, 67],   // D4 -> E4
  Dm:    [57, 62, 65, 69],
  Asus2: [57, 59, 64, 69],   // the unresolved colour
  E:     [56, 59, 64, 71],   // G#3 - the leading tone, held under the wait
  Fmaj7: [57, 60, 64, 65],   // only the top voice moves out of Am
};
// An octave higher than they "should" be: below about 80 Hz nothing a viewer
// watches this on can reproduce it, and it only eats headroom.
const ROOT = { Am: 45, F: 41, C: 48, G: 43, Em: 40, Dm: 50, Asus2: 45, E: 40, Fmaj7: 41 };

const chords = {};
const put = (from, to, name) => { for (let b = from; b <= to; b += 1) chords[b] = name; };
put(1, 2, "Am"); put(3, 3, "F"); put(4, 4, "G");
put(5, 5, "Am"); put(6, 6, "F"); put(7, 7, "C"); put(8, 8, "G"); put(9, 9, "Am"); put(10, 10, "F");
put(11, 11, "C"); put(12, 12, "G"); put(13, 13, "Am"); put(14, 14, "F");
put(15, 15, "Am"); put(16, 16, "F"); put(17, 17, "C"); put(18, 18, "G"); put(19, 19, "Am");
put(20, 20, "Am"); put(21, 21, "Em"); put(22, 22, "F"); put(23, 23, "C");
put(24, 24, "Dm"); put(25, 25, "Am"); put(26, 26, "F"); put(27, 27, "G");
put(28, 29, "Asus2"); put(30, 30, "E");
put(31, 31, "Am"); put(32, 32, "F"); put(33, 33, "C"); put(34, 34, "G");
put(35, 35, "Am"); put(36, 36, "F"); put(37, 37, "G");
put(38, 39, "Asus2"); put(40, 41, "Fmaj7"); put(42, 42, "C");
put(43, 43, "Am"); put(44, 44, "F"); put(45, 45, "C"); put(46, 46, "G");
put(47, 47, "Am"); put(48, 48, "F"); put(49, 49, "C"); put(50, 50, "Am");

// ------------------------------------------------------------------ sections
// `level` is the section's place in the dynamic arc, in dB. This is the
// difference between a score and a loop: the quiet sections are actually quiet.
const sections = [
  { name: "open",    from: 1,  to: 4,  level: -10.5, pad: 0.34, plucks: "sparse", perc: "none",   bassPat: "whole" },
  { name: "brief",   from: 5,  to: 10, level: -7.0,  pad: 0.42, plucks: "eighth", perc: "shaker", bassPat: "half" },
  { name: "search",  from: 11, to: 14, level: -4.5,  pad: 0.48, plucks: "eighth", perc: "light",  bassPat: "half" },
  { name: "LIFT",    from: 15, to: 19, level: 0,     pad: 0.60, plucks: "six",    perc: "full",   bassPat: "eighth" },
  { name: "send",    from: 20, to: 27, level: -3.0,  pad: 0.55, plucks: "eighth", perc: "full",   bassPat: "half" },
  { name: "wait",    from: 28, to: 30, level: -9.0,  pad: 0.50, plucks: "none",   perc: "none",   bassPat: "whole" },
  { name: "land",    from: 31, to: 37, level: +1.0,  pad: 0.62, plucks: "six",    perc: "full",   bassPat: "eighth" },
  { name: "MONEY",   from: 38, to: 42, level: -11.0, pad: 0.46, plucks: "sparse", perc: "none",   bassPat: "whole" },
  { name: "rebuild", from: 43, to: 46, level: -4.0,  pad: 0.55, plucks: "eighth", perc: "light",  bassPat: "half" },
  { name: "end",     from: 47, to: 50, level: -0.5,  pad: 0.62, plucks: "half",   perc: "tail",   bassPat: "whole" },
];
const sectionAt = (bar) => sections.find((s) => bar >= s.from && bar <= s.to);

// -------------------------------------------------------------- the theme
// One phrase, stated three times: quietly at the lift, an octave up when the
// replies land, and slowed down over the end card.
const THEME = [                       // [bar offset, beat, midi, length in beats]
  [0, 0,   76, 2],   // E5
  [0, 2.5, 81, 1.5], // A5
  [1, 0,   79, 1.5], // G5
  [1, 2,   76, 2],   // E5
  [2, 0,   79, 1],   // G5
  [2, 1,   76, 1],   // E5
  [2, 2,   72, 2],   // C5
  [3, 0,   74, 1.5], // D5
  [3, 2,   71, 2],   // B4
  [4, 0,   69, 4],   // A4 - home
];

// ----------------------------------------------------------------- the busses
const padBus = stereoBuf(LEN), pluckBus = stereoBuf(LEN), bellBus = stereoBuf(LEN);
const bassBus = stereoBuf(LEN), drumBus = stereoBuf(LEN), airBus = stereoBuf(LEN);
const S = (t) => Math.round(t * SR);

for (let bar = 1; bar <= BARS; bar += 1) {
  const sec = sectionAt(bar);
  const name = chords[bar];
  const notes = V[name];
  const root = ROOT[name];
  const t0 = barAt(bar);
  const nextSame = chords[bar + 1] === name;

  // ---- pad: one note per voice per bar, overlapping into the next bar so the
  // chord change is a real voice movement rather than a crossfade.
  notes.forEach((m, v) => {
    const len = BAR * (nextSame ? 1.9 : 1.25);
    const pan = (v - 1.5) / 1.5 * 0.55;
    const open = sec.name === "wait" ? 0.35 + 0.65 * ((bar - 28) / 3) : sec.pad + 0.3;
    add(padBus, padVoice(mtof(m), len, 0.16 * sec.pad, { detune: 8, open, q: 1.15 }), S(t0), 1, pan);
  });

  // ---- bass
  const bassHits = { whole: [0], half: [0, 2], eighth: [0, 1.5, 2, 3.5] }[sec.bassPat] ?? [0];
  for (const beat of bassHits) {
    const len = sec.bassPat === "whole" ? BAR * 1.05 : BEAT * 1.6;
    add(bassBus, bass(mtof(root), len, 0.32), S(t0 + beat * BEAT), 1, 0);
  }

  // ---- plucks: the arpeggio is taken from the actual chord voicing, so the
  // pattern moves with the voice leading instead of being transposed.
  const arp = [...notes, notes[2] + 12, notes[3] + 12, notes[2] + 12];
  const patterns = {
    none: [],
    sparse: [0, 2],
    half: [0, 2],
    // Syncopated rather than dense: a figure with a hole in it reads as music,
    // a straight run of eighths reads as an arpeggiator.
    eighth: [0, 0.75, 1.5, 2, 2.75, 3.5],
    six: [0, 0.5, 0.75, 1.5, 2, 2.5, 2.75, 3.5],
  };
  const pat = patterns[sec.plucks] ?? [];
  pat.forEach((beat, i) => {
    const m = arp[(i + bar) % arp.length] + (sec.plucks === "sparse" || sec.plucks === "half" ? 12 : 0);
    const accent = beat % 1 === 0 ? 1 : 0.62;
    const vel = (sec.plucks === "sparse" ? 0.30 : 0.22) * accent * (0.85 + rnd() * 0.3);
    const pan = ((i % 4) - 1.5) / 1.5 * 0.42;
    // human timing: a few milliseconds of drift, never quantised dead
    const jitter = (rnd() - 0.5) * 0.012;
    add(pluckBus, pluck(mtof(m), 2.2, vel, { damp: 0.45, bright: 0.55 + rnd() * 0.15 }), S(t0 + beat * BEAT + jitter), 1, pan);
  });

  // ---- percussion
  if (sec.perc !== "none") {
    const kicks = sec.perc === "full" ? [0, 2.5] : sec.perc === "light" ? [0] : sec.perc === "tail" ? (bar <= 48 ? [0] : []) : [];
    for (const beat of kicks) add(drumBus, kick(0.26), S(t0 + beat * BEAT), 1, 0);
    const shakes = sec.perc === "full" ? [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 0.75, 2.75] :
      sec.perc === "shaker" ? [1, 3] : sec.perc === "light" ? [0.5, 1.5, 2.5, 3.5] :
      sec.perc === "tail" ? (bar <= 48 ? [1, 3] : []) : [];
    for (const beat of shakes) {
      const vel = (beat % 1 === 0 ? 0.30 : 0.19) * (0.8 + rnd() * 0.4);
      add(drumBus, shaker(vel), S(t0 + beat * BEAT + (rnd() - 0.5) * 0.010), 1, (rnd() - 0.5) * 0.5);
    }
    if (sec.perc === "full" && bar % 4 === 3) add(drumBus, rim(0.22), S(t0 + 3.5 * BEAT), 1, -0.35);
  }
}

// ---- the theme, three statements
const statements = [
  { bar: 15, octave: 0,  gain: 0.20, ratio: 14, spread: 0.18 },
  { bar: 31, octave: 12, gain: 0.17, ratio: 11, spread: -0.18 },
  { bar: 47, octave: 0,  gain: 0.23, ratio: 14, spread: 0.0, slow: true },
];
for (const st of statements) {
  for (const [barOff, beat, midi, lenBeats] of THEME) {
    // the end statement halves in density: it stretches over the same bars but
    // only the long notes survive, which reads as a ritardando without one.
    if (st.slow && lenBeats < 1.5) continue;
    const t = barAt(st.bar + barOff, beat);
    const len = Math.min(lenBeats * BEAT * 2.2, 4.5);
    add(bellBus, fmBell(mtof(midi + st.octave), len, st.gain, { ratio: st.ratio, index: 5.4, bodyDecay: len * 0.55 }), S(t), 1, st.spread);
    // a quiet octave-below double thickens the top statement
    if (st.octave) add(bellBus, fmBell(mtof(midi), len, st.gain * 0.45, { ratio: 7, index: 3.2, bodyDecay: len * 0.5 }), S(t), 1, -st.spread);
  }
}

// ---- air: a breath of filtered noise that swells through the wait and lifts
// into the arrival, so the strip-down still has movement in it.
{
  const n = Math.round(LEN * SR);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) raw[i] = rnd() * 2 - 1;
  const swellStart = barAt(28), swellEnd = barAt(31);
  const shaped = lowpass(highpass(raw, 500), 3400);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    let g = 0.006 + 0.004 * Math.sin(2 * Math.PI * t / 23);
    if (t >= swellStart && t < swellEnd) g += 0.075 * Math.pow((t - swellStart) / (swellEnd - swellStart), 2.4);
    if (t >= swellEnd && t < swellEnd + 1.6) g += 0.075 * Math.max(0, 1 - (t - swellEnd) / 1.6);
    shaped[i] *= g;
  }
  for (let i = 0; i < n; i += 1) { airBus[0][i] += shaped[i]; airBus[1][i] += shaped[i] * 0.82; }
}

// ------------------------------------------------- the arc (mix automation)
// A gain curve that follows the sections, ramping over one bar at each change
// so the film never hears a level jump. This is the arc; everything above is
// only the arrangement.
function arcGain(t) {
  const bar = t / BAR + 1;
  const cur = sectionAt(Math.max(1, Math.min(BARS, Math.floor(bar)))) ?? sections.at(-1);
  const prev = sections[Math.max(0, sections.indexOf(cur) - 1)];
  const intoSection = bar - cur.from;
  const ramp = 1.0;                       // one bar to move between levels
  const levelDb = intoSection < ramp && cur !== prev
    ? prev.level + (cur.level - prev.level) * (intoSection / ramp)
    : cur.level;
  return Math.pow(10, levelDb / 20);
}
for (const buf of [padBus, pluckBus, bellBus, bassBus, drumBus]) {
  for (let i = 0; i < buf[0].length; i += 1) {
    const g = arcGain(i / SR);
    buf[0][i] *= g; buf[1][i] *= g;
  }
}

// ------------------------------------------------------------------- the mix
// Different reverb sends per instrument: the bass stays dry and centred, the
// plucks and bell sit back in the room, the pad is almost all room.
const wet = stereoBuf(LEN);
const send = (buf, amount) => { for (let c = 0; c < 2; c += 1) for (let i = 0; i < wet[c].length; i += 1) wet[c][i] += buf[c][i] * amount; };
send(padBus, 0.55); send(pluckBus, 0.40); send(bellBus, 0.50); send(drumBus, 0.12); send(bassBus, 0.02);
const [rvL, rvR] = reverb(wet[0], wet[1], { size: 1.35, damp: 0.42, preDelay: 0.024 });

const mix = stereoBuf(LEN);
mixInto(mix, padBus, 1.0);
mixInto(mix, pluckBus, 1.0);
mixInto(mix, bellBus, 1.0);
mixInto(mix, bassBus, 1.0);
// The percussion and the air layer are band-limited before they reach the mix,
// so the shakers read as breath rather than sizzle over the narration.
for (let c = 0; c < 2; c += 1) { drumBus[c] = lowpass(drumBus[c], 9000); airBus[c] = lowpass(airBus[c], 6500); }
mixInto(mix, drumBus, 1.0);
mixInto(mix, airBus, 1.0);
mixInto(mix, [rvL, rvR], 0.62);

// Bus tone: roll off the sub the film's voice does not need, and take the
// 2-4 kHz consonant band down a little so the narration always wins.
for (let c = 0; c < 2; c += 1) {
  let x = highpass(highpass(mix[c], 62), 62);
  const dip = lowpass(highpass(x, 1800), 4500);
  for (let i = 0; i < x.length; i += 1) x[i] -= dip[i] * 0.42;
  mix[c] = x;
}

// Final shape: fade in over the first bar, fade the tail out.
const n = mix[0].length;
const fadeIn = Math.round(1.2 * SR), tailStart = Math.round((BARS * BAR + 0.5) * SR);
for (let i = 0; i < n; i += 1) {
  let g = 1;
  if (i < fadeIn) g *= i / fadeIn;
  if (i > tailStart) g *= Math.max(0, 1 - (i - tailStart) / (n - tailStart));
  mix[0][i] *= g; mix[1][i] *= g;
}
// Peaks first, level second. A single 3.6 ms transient stack (a kick, a pluck
// and a bell landing on the same sample) was setting the peak and costing 17 dB
// of headroom, so the bus is driven into a soft saturator that rounds those
// spikes off, and only then normalised.
{
  // set the working level from the body of the signal, not its loudest sample
  const sample = [];
  for (let i = 0; i < n; i += 997) sample.push(Math.max(Math.abs(mix[0][i]), Math.abs(mix[1][i])));
  sample.sort((a, b) => a - b);
  const p95 = sample[Math.floor(sample.length * 0.95)] || 1e-6;
  const drive = 0.42 / p95;
  const ceiling = 0.86;
  for (let c = 0; c < 2; c += 1) for (let i = 0; i < n; i += 1) {
    mix[c][i] = ceiling * Math.tanh(mix[c][i] * drive / ceiling);
  }
}
let peak = 0;
for (let c = 0; c < 2; c += 1) for (let i = 0; i < n; i += 1) peak = Math.max(peak, Math.abs(mix[c][i]));
const norm = Math.pow(10, -6 / 20) / Math.max(peak, 1e-9);
for (let c = 0; c < 2; c += 1) for (let i = 0; i < n; i += 1) mix[c][i] *= norm;

const out = process.argv[2] ?? "score.wav";
writeWav(out, mix, SR);

console.log(`${out}  ${(n / SR).toFixed(2)}s  ${BPM.toFixed(1)} BPM  ${BARS} bars  money bar at ${((MONEY_BAR - 1) * BAR).toFixed(2)}s  peak ${db(peak * norm).toFixed(1)} dBFS`);
console.log("\nsection levels (RMS, dB) - the arc:");
for (const s of sections) {
  const a = Math.round(barAt(s.from) * SR), b = Math.min(n, Math.round(barAt(s.to + 1) * SR));
  const mono = Float32Array.from(mix[0].slice(a, b), (v, i) => (v + mix[1][a + i]) / 2);
  console.log(`  ${s.name.padEnd(8)} bars ${String(s.from).padStart(2)}-${String(s.to).padStart(2)}  ` +
    `${barAt(s.from).toFixed(1).padStart(6)}s  ${db(rms(mono)).toFixed(1).padStart(6)} dB`);
}
// The one alignment that has to be exact, checked rather than assumed.
const moneyAt = arg("money", 105.71);
console.log(`\nmoney shot: film ${moneyAt.toFixed(2)}s, bar ${MONEY_BAR} at ${barAt(MONEY_BAR).toFixed(2)}s, off by ${(barAt(MONEY_BAR) - moneyAt).toFixed(3)}s`);
