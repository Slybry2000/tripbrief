// Sound design for the TripBrief film. Eleven elements, all synthesised, all
// pitched into A minor so they sit inside the score instead of on top of it.
//
//   node sfx.mjs [outDir]
import { writeWav, SR } from "./dsp.mjs";
import { mtof, pluck, fmBell, bass, kick, shaker, rim, reverb, add, stereoBuf, mixInto, highpass, lowpass, resetRnd, rnd } from "./synth.mjs";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "sfx";
mkdirSync(out, { recursive: true });
resetRnd();

const S = (t) => Math.round(t * SR);
const noise = (dur) => { const n = Math.round(dur * SR), x = new Float32Array(n); for (let i = 0; i < n; i += 1) x[i] = rnd() * 2 - 1; return x; };
const env = (x, fn) => { for (let i = 0; i < x.length; i += 1) x[i] *= fn(i / SR, x.length / SR); return x; };
const expo = (t, rate) => Math.exp(-t / rate);

// Every element gets a little of the same room the score lives in, so the
// effects and the music sound like they are in one place.
function room(buf, amount = 0.22, size = 1.0) {
  const [l, r] = reverb(buf[0], buf[1], { size, damp: 0.45, preDelay: 0.012 });
  mixInto(buf, [l, r], amount);
  return buf;
}
function finish(buf, peakDb = -9) {
  let p = 0;
  for (let c = 0; c < 2; c += 1) for (const v of buf[c]) p = Math.max(p, Math.abs(v));
  const g = Math.pow(10, peakDb / 20) / Math.max(p, 1e-9);
  for (let c = 0; c < 2; c += 1) for (let i = 0; i < buf[c].length; i += 1) buf[c][i] *= g;
  // never let an element click on or off
  const f = Math.round(0.003 * SR), n = buf[0].length;
  for (let c = 0; c < 2; c += 1) for (let i = 0; i < f; i += 1) { buf[c][i] *= i / f; buf[c][n - 1 - i] *= i / f; }
  return buf;
}
const save = (name, buf, peakDb) => { writeWav(`${out}/${name}.wav`, finish(buf, peakDb), SR); return name; };

const made = [];

// 1. tick - a cursor landing on a control. Short, wooden, no pitch to speak of.
{
  const b = stereoBuf(0.13);
  add(b, env(lowpass(highpass(noise(0.05), 1400), 5200), (t) => expo(t, 0.010)), 0, 0.9, 0);
  add(b, env(Float32Array.from({ length: S(0.09) }, (_, i) => Math.sin(2 * Math.PI * 1320 * i / SR)), (t) => expo(t, 0.012)), 0, 0.25, 0);
  made.push(save("tick", room(b, 0.10, 0.6), -11));
}

// 2. type - a short run of keystrokes, for "Type a country". Irregular spacing,
//    because evenly spaced keys sound like a machine gun.
{
  const b = stereoBuf(1.5);
  let t = 0;
  for (let i = 0; i < 11; i += 1) {
    const k = env(lowpass(highpass(noise(0.035), 1900), 6500), (u) => expo(u, 0.0065));
    add(b, k, S(t), 0.55 + rnd() * 0.35, (rnd() - 0.5) * 0.35);
    t += 0.085 + rnd() * 0.065;
  }
  made.push(save("type", room(b, 0.12, 0.6), -14));
}

// 3. whoosh - a screen change. Two noise layers moving in opposite directions.
{
  const b = stereoBuf(0.95);
  const lo = env(lowpass(noise(0.9), 800), (t) => Math.max(0, 1 - t * 1.35));
  const hi = env(lowpass(highpass(noise(0.9), 1500), 6800), (t) => Math.min(1, t * 2.4) * Math.max(0, 1 - t * 1.15));
  add(b, lo, 0, 0.9, -0.3); add(b, hi, 0, 0.5, 0.3);
  made.push(save("whoosh", room(b, 0.20, 1.1), -13));
}

// 4. send - an email leaving. Brighter and shorter than a page change, and it
//    travels left to right so three of them read as three things departing.
{
  const b = stereoBuf(0.75);
  const n = S(0.55);
  const air = env(lowpass(highpass(noise(0.55), 2200), 9000), (t) => Math.pow(Math.min(1, t * 6), 1.5) * Math.max(0, 1 - t / 0.5));
  for (let i = 0; i < n; i += 1) {
    const pan = -0.7 + 1.4 * (i / n);
    const l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
    b[0][i] += air[i] * l * 1.414 * 0.8; b[1][i] += air[i] * r * 1.414 * 0.8;
  }
  add(b, fmBell(mtof(81), 0.6, 0.30, { ratio: 3, index: 2.2, bodyDecay: 0.18 }), S(0.02), 1, 0.15);
  made.push(save("send", room(b, 0.24, 1.2), -13));
}

// 5/6/7. arrive-1/2/3 - a reply landing. A soft body thump plus a bell, tuned
//    A, C, E, so three arrivals in a row spell out the chord the score is on.
[["arrive-1", 69], ["arrive-2", 72], ["arrive-3", 76]].forEach(([name, midi]) => {
  const b = stereoBuf(2.2);
  add(b, env(lowpass(noise(0.12), 320), (t) => expo(t, 0.030)), 0, 0.55, 0);
  add(b, bass(mtof(midi - 24), 0.5, 0.35), 0, 1, 0);
  add(b, fmBell(mtof(midi + 12), 1.9, 0.42, { ratio: 3.51, index: 3.4, bodyDecay: 0.55 }), S(0.012), 1, 0.12);
  add(b, fmBell(mtof(midi + 24), 1.4, 0.13, { ratio: 2.0, index: 1.6, bodyDecay: 0.32 }), S(0.012), 1, -0.22);
  made.push(save(name, room(b, 0.34, 1.4), -10));
});

// 8. populate - data filling a card in. A rising granular shimmer that
//    resolves onto a note, rather than a whoosh with nothing at the end of it.
{
  const b = stereoBuf(1.6);
  for (let i = 0; i < 26; i += 1) {
    const t = Math.pow(i / 26, 0.75) * 0.75;
    const midi = 69 + [0, 3, 7, 12, 14][i % 5] + (i > 13 ? 12 : 0);
    add(b, pluck(mtof(midi), 0.7, 0.10 + 0.10 * (i / 26), { damp: 0.55, bright: 0.8 }), S(t), 1, (rnd() - 0.5) * 0.8);
  }
  add(b, fmBell(mtof(88), 1.1, 0.16, { ratio: 3, index: 2.4, bodyDecay: 0.34 }), S(0.78), 1, 0);
  made.push(save("populate", room(b, 0.30, 1.3), -14));
}

// 9. scroll - a light texture for a list moving under the cursor.
{
  const b = stereoBuf(1.1);
  for (let i = 0; i < 9; i += 1) add(b, shaker(0.30 + rnd() * 0.2, { decay: 0.020, lo: 2600, hi: 7000 }), S(i * 0.105 + rnd() * 0.012), 1, (rnd() - 0.5) * 0.6);
  made.push(save("scroll", room(b, 0.14, 0.8), -18));
}

// 10. confirm - a choice made. Two notes up a fourth: the smallest gesture that
//     reads as "yes" rather than "something happened".
{
  const b = stereoBuf(1.8);
  add(b, fmBell(mtof(76), 0.9, 0.34, { ratio: 3, index: 2.6, bodyDecay: 0.30 }), 0, 1, -0.1);
  add(b, fmBell(mtof(81), 1.5, 0.40, { ratio: 3, index: 2.4, bodyDecay: 0.55 }), S(0.13), 1, 0.1);
  add(b, bass(mtof(45), 0.7, 0.22), 0, 1, 0);
  made.push(save("confirm", room(b, 0.32, 1.3), -11));
}

// 11. reveal - under the money shot. A two-second rise, a soft low seal, and an
//     A-minor chord that the score can carry on from. No cymbal, no impact
//     crash: the point of this shot is the evidence, not the drama.
{
  const b = stereoBuf(4.2);
  const rise = env(lowpass(highpass(noise(2.25), 600), 4200), (t) => Math.pow(t / 2.2, 2.6));
  add(b, rise, 0, 0.55, -0.25); add(b, rise, S(0.03), 0.5, 0.25);
  add(b, kick(0.42, { f0: 120, f1: 55, decay: 0.34 }), S(2.0), 1, 0);
  for (const [m, pan, g] of [[57, -0.3, 0.22], [60, 0.05, 0.18], [64, 0.3, 0.16], [69, -0.1, 0.13]]) {
    add(b, pluck(mtof(m), 2.0, g, { damp: 0.5, bright: 0.5 }), S(2.0 + rnd() * 0.02), 1, pan);
  }
  add(b, fmBell(mtof(81), 2.1, 0.20, { ratio: 3, index: 2.0, bodyDecay: 0.85 }), S(2.02), 1, 0);
  made.push(save("reveal", room(b, 0.38, 1.6), -9));
}

// 12. seal - the end card settling. One low note and a long room tail.
{
  const b = stereoBuf(3.4);
  add(b, kick(0.5, { f0: 130, f1: 52, decay: 0.42 }), 0, 1, 0);
  add(b, bass(mtof(45), 2.4, 0.30), 0, 1, 0);
  add(b, fmBell(mtof(69), 2.8, 0.22, { ratio: 3, index: 1.8, bodyDecay: 1.3 }), S(0.02), 1, 0);
  made.push(save("seal", room(b, 0.42, 1.8), -11));
}

console.log(`wrote ${made.length} elements to ${out}/: ${made.join(", ")}`);
