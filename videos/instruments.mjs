// The instruments "Incoming" (videos/score.mjs) is written for.
//
// Kept separate from videos/synth.mjs on purpose: videos/sfx.mjs imports the
// whole of synth.mjs to build the twelve sound elements, and nothing here
// should be able to change a single sample of those. This file only adds.
//
// Everything returns a mono Float32Array of one note, the same contract as
// synth.mjs, so the score can place them with synth.mjs's own add().
//
//   feltPiano    struck string: inharmonic partials, per-partial decay, a
//                two-stage soundboard aftersound, hammer noise, two strings
//   bowedString  additive bowed string: one shared phase with vibrato and an
//                onset scoop, per-partial drift, bow noise, three body modes
//   harp         Karplus-Strong with a fractional (allpass) delay, so the
//                pitch is right rather than rounded to the nearest sample
//   vibes        four inharmonic bar modes with a tremolo
//   sympathetic  a bank of undamped strings, driven by whatever you feed it.
//                This is the piano's sustain pedal and the harp's neighbours,
//                and it is the thing that stops either sounding like a set of
//                unrelated one-shot samples.
//   hall         8-line feedback delay network with a Householder matrix
import { SR } from "./dsp.mjs";

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const TAU = Math.PI * 2;

// A separate RNG from synth.mjs's, so adding notes here can never move a
// sample of the sound effects.
let seed = 0x5bf03635;
export const rndi = () => {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
};
export const resetInstruments = () => { seed = 0x5bf03635; };

// ------------------------------------------------------------------ biquads
export function biquad(type, f0, Q, gainDb = 0, sr = SR) {
  const A = Math.pow(10, gainDb / 40);
  const w = TAU * f0 / sr, cw = Math.cos(w), sw = Math.sin(w);
  const al = sw / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lp") { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === "hp") { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === "bp") { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
  else if (type === "peak") { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
  else if (type === "lowshelf") {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s);
    a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s;
  } else if (type === "highshelf") {
    const s = 2 * Math.sqrt(A) * al;
    b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s);
    a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s;
  } else throw new Error(type);
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

export function applyBiquad(buf, c) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const x = buf[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
}

// ========================================================= FELT GRAND PIANO ==
/**
 * A struck string. Stiffness stretches the partials off the harmonic series,
 * the high ones decay first (which is why a piano note changes colour as it
 * rings), the hammer contact point puts a null on every eighth partial, and
 * two strings a couple of cents apart give the slow beat a single oscillator
 * cannot. A soft strike is dark: that is the felt.
 */
export function feltPiano(midi, vel = 0.4, { maxSeconds = 13 } = {}) {
  const f0 = mtof(midi);
  const B = 3.2e-5 * Math.pow(2, (midi - 33) / 17);
  const maxK = Math.min(24, Math.floor((SR * 0.44) / f0));
  const tau1 = 9.4 * Math.exp(-(midi - 30) / 34);
  const bright = 0.88 + vel * 1.75;
  const amp = Math.pow(vel, 1.55) * 0.5;
  const n = Math.round(Math.min(maxSeconds, tau1 * 2.2 + 0.8) * SR);
  const out = new Float32Array(n);
  if (maxK < 1) return out;

  const strings = midi > 47 ? 2 : 1;
  for (let s = 0; s < strings; s += 1) {
    const cents = strings === 1 ? 0 : (s === 0 ? -1 : 1) * (0.7 + rndi() * 1.6);
    const fs = f0 * Math.pow(2, cents / 1200);
    for (let k = 1; k <= maxK; k += 1) {
      const fk = fs * k * Math.sqrt(1 + B * k * k);
      if (fk > SR * 0.45) break;
      const comb = Math.abs(Math.sin(Math.PI * k / 8.4));
      // cosine taper over the top of the series: a hard stop draws a straight
      // horizontal edge on a spectrogram, which no instrument does
      const u = Math.max(0, (k - maxK * 0.6) / (maxK * 0.4));
      const taper = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, u));
      const ak = (amp / strings) * comb * taper * Math.pow(k, -1.0) * Math.exp(-(k - 1) / bright / 4.6);
      if (ak < 1.2e-5) continue;
      const tk = tau1 / (1 + 0.62 * Math.pow(k - 1, 0.92));
      const tFast = tk * 0.30, tSlow = tk * 1.45;          // string, then soundboard
      const gSlow = 0.26 * Math.exp(-(k - 1) / 6);
      const w = TAU * fk / SR, ph = rndi() * 0.4;
      const attack = 0.0032;                      // hammer contact time
      for (let i = 0; i < n; i += 1) {
        const tt = i / SR;
        const env = ((1 - gSlow) * Math.exp(-tt / tFast) + gSlow * Math.exp(-tt / tSlow))
          * (1 - Math.exp(-tt / attack));
        // The attack ramp is zero at t=0, so this test has to wait until the
        // note has actually started. Testing it from the first sample breaks
        // out of every partial immediately and leaves nothing but the hammer
        // thud - which is what this instrument was doing until it was
        // measured against a single note instead of against a whole mix.
        if (tt > attack * 8 && env < 1e-5) break;
        out[i] += ak * env * Math.sin(w * i + ph);
      }
    }
  }
  // Hammer felt. Without it every note starts out of nowhere and the
  // instrument reads as an organ.
  const nl = Math.round(0.030 * SR);
  const noise = new Float32Array(nl);
  for (let i = 0; i < nl; i += 1) noise[i] = (rndi() * 2 - 1) * Math.exp(-i / SR / 0.0075);
  applyBiquad(noise, biquad("lp", Math.min(5200, f0 * 9), 0.7));
  applyBiquad(noise, biquad("hp", f0 * 0.8, 0.7));
  const ng = Math.pow(vel, 1.9) * 0.10;
  for (let i = 0; i < nl && i < n; i += 1) out[i] += noise[i] * ng;
  // never end on a discontinuity
  const fade = Math.round(1.2 * SR);
  for (let i = Math.max(0, n - fade); i < n; i += 1) out[i] *= (n - i) / fade;
  return out;
}

// ======================================================= KARPLUS-STRONG HARP ==
/**
 * The delay line is a fractional number of samples long, using a one-pole
 * allpass, so the pitch is actually right instead of rounded to the nearest
 * sample - which at 880 Hz is a third of a semitone out.
 */
export function harp(midi, vel = 0.4, { damping = 0.36, decay = 0.9970, pos = 0.19, body = true, maxSeconds = 7 } = {}) {
  const f0 = mtof(midi);
  const N = SR / f0 - 0.5;
  const L = Math.max(2, Math.floor(N));
  const frac = N - L;
  const c = (1 - frac) / (1 + frac);
  const buf = new Float32Array(L);
  const ex = new Float32Array(L);
  for (let i = 0; i < L; i += 1) ex[i] = rndi() * 2 - 1;
  applyBiquad(ex, biquad("lp", Math.min(6500, f0 * 14), 0.6));
  const off = Math.max(1, Math.round(L * pos));
  for (let i = 0; i < L; i += 1) buf[i] = ex[i] - ex[(i + off) % L] * 0.85;   // pick position
  let peak = 0; for (let i = 0; i < L; i += 1) peak = Math.max(peak, Math.abs(buf[i]));
  const amp = Math.pow(vel, 1.5) * 0.42 / (peak || 1);
  for (let i = 0; i < L; i += 1) buf[i] *= amp;

  const n = Math.round(Math.min(maxSeconds, 6 / (1 - decay) / 800) * SR);
  const out = new Float32Array(n);
  let lastLp = 0, lastIn = 0, lastAp = 0, p = 0;
  for (let i = 0; i < n; i += 1) {
    const x = buf[p];
    out[i] = x;
    const lp = damping * x + (1 - damping) * lastLp; lastLp = lp;
    const ap = -c * lp + lastIn + c * lastAp; lastIn = lp; lastAp = ap;
    buf[p] = ap * decay;
    p = (p + 1) % L;
  }
  if (body) {
    applyBiquad(out, biquad("peak", 196, 1.2, 3.0));
    applyBiquad(out, biquad("peak", 430, 1.6, 2.0));
    applyBiquad(out, biquad("peak", 2400, 1.0, -2.0));
  }
  const fade = Math.round(0.05 * SR);
  for (let i = Math.max(0, n - fade); i < n; i += 1) out[i] *= (n - i) / fade;
  return out;
}

/** The same string, damped hard and plucked near the bridge: an upright bass. */
export const pizzBass = (midi, vel = 0.32) => {
  const out = harp(midi, vel, { damping: 0.70, decay: 0.9944, pos: 0.12, body: false, maxSeconds: 4 });
  applyBiquad(out, biquad("peak", 72, 1.1, 4.0));
  applyBiquad(out, biquad("peak", 180, 1.4, 2.0));
  applyBiquad(out, biquad("peak", 1600, 0.9, -5.0));
  return out;
};

// ============================================================ BOWED STRINGS ==
/**
 * All the partials ride one phase, so vibrato bends the whole spectrum
 * together the way a finger on a string does, and each partial then gets its
 * own slow drift, which is the difference between a section and an organ.
 * The partials are generated by Chebyshev recurrence off that one phase, so
 * twenty-six of them cost about as much as two.
 */
export function bowedString(midi, dur, amp = 0.1, {
  attack = 0.7, release = 2.0, vib = 0.0030, vibHz = 4.7, partials = 26, tilt = 1.12, swell = 0,
} = {}) {
  const f0 = mtof(midi);
  const total = Math.round((dur + release) * SR);
  const out = new Float32Array(total);
  const n = Math.min(partials, Math.floor(SR * 0.44 / f0));
  if (n < 1) return out;
  const ak = new Float64Array(n + 1), dR = new Float64Array(n + 1), dP = new Float64Array(n + 1);
  let norm = 0;
  for (let k = 1; k <= n; k += 1) {
    const u = Math.max(0, (k - n * 0.62) / (n * 0.38));
    const taper = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, u));
    ak[k] = Math.pow(k, -tilt) * (1 + 0.28 * Math.sin(k * 1.7 + 0.6)) * taper;
    norm += ak[k];
    dR[k] = (0.055 + rndi() * 0.19) * TAU / SR;
    dP[k] = rndi() * TAU;
  }
  for (let k = 1; k <= n; k += 1) ak[k] = ak[k] / norm * amp;

  const envAt = (tt) => {
    if (tt < attack) return 0.5 - 0.5 * Math.cos(Math.PI * tt / attack);
    if (tt < dur) return 1;
    const u = (tt - dur) / release;
    return u >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * u);
  };

  const vp = rndi() * TAU, sp = rndi() * TAU;
  let phase = rndi() * TAU;
  const sw = TAU * f0 / SR;
  for (let i = 0; i < total; i += 1) {
    const tt = i / SR;
    let env = envAt(tt);
    if (env <= 0) continue;
    if (swell) env *= 1 + swell * Math.sin(TAU * tt / 9.3 + sp);
    const vd = vib * Math.min(1, tt / 1.1);
    // the first moment of a bowed note is a few cents flat and settles; an
    // oscillator started at exactly the right frequency never is
    const scoop = tt < 0.16 ? -0.0022 * (1 - tt / 0.16) ** 2 : 0;
    phase += sw * (1 + scoop + vd * Math.sin(TAU * vibHz * tt + vp));
    const s1 = Math.sin(phase), two = 2 * Math.cos(phase);
    let sm1 = 0, s = s1, acc = ak[1] * s1;
    for (let k = 2; k <= n; k += 1) {
      const sk = two * s - sm1;
      sm1 = s; s = sk;
      acc += ak[k] * sk * (1 + 0.11 * Math.sin(dR[k] * i + dP[k]));
    }
    out[i] = acc * env;
  }
  // bow noise on the envelope: the scrape that tells the ear it is bowed
  const nb = new Float32Array(total);
  for (let i = 0; i < total; i += 1) nb[i] = rndi() * 2 - 1;
  applyBiquad(nb, biquad("bp", Math.min(4200, f0 * 7), 0.8));
  applyBiquad(nb, biquad("bp", Math.min(2400, f0 * 4), 1.1));
  for (let i = 0; i < total; i += 1) out[i] += nb[i] * envAt(i / SR) * amp * 0.085;
  // body
  applyBiquad(out, biquad("peak", 228, 1.8, 2.1));
  applyBiquad(out, biquad("peak", 305, 2.4, 1.5));
  applyBiquad(out, biquad("peak", 468, 2.0, 1.4));
  applyBiquad(out, biquad("peak", 1180, 1.4, -2.0));
  applyBiquad(out, biquad("hp", 55, 0.7));
  return out;
}

// ================================================================ VIBRAPHONE ==
export function vibes(midi, vel = 0.35, { trem = 3.2 } = {}) {
  const f0 = mtof(midi);
  const n = Math.round(5.6 * SR);
  const out = new Float32Array(n);
  const modes = [[1, 1, 5.2], [3.932, 0.30, 2.0], [9.538, 0.13, 0.85], [16.69, 0.05, 0.4]];
  const amp = Math.pow(vel, 1.5) * 0.30;
  const tp = rndi() * TAU;
  for (const [ratio, a, tau] of modes) {
    const f = f0 * ratio;
    if (f > SR * 0.45) continue;
    const w = TAU * f / SR;
    for (let i = 0; i < n; i += 1) {
      const tt = i / SR;
      let e = Math.exp(-tt / tau) * (1 - Math.exp(-tt / 0.0015));
      if (tt > 0.012 && e < 1e-5) break;          // not before the bar speaks
      if (ratio < 4) e *= 1 - 0.22 * (0.5 - 0.5 * Math.cos(TAU * trem * tt + tp));
      out[i] += amp * a * e * Math.sin(w * i);
    }
  }
  const fade = Math.round(0.1 * SR);
  for (let i = n - fade; i < n; i += 1) out[i] *= (n - i) / fade;
  return out;
}

// ========================================= SYMPATHETIC STRINGS (THE PEDAL) ==
/**
 * The piano's sustain pedal, modelled as what it physically is: a set of
 * strings with their dampers lifted, standing there being driven through the
 * soundboard by every note that is struck. Each one is a delay line tuned to
 * its own pitch with a damping filter in the loop - a Karplus-Strong string
 * that is never plucked, only leaned on.
 *
 * This is what was missing. Without it every piano note is an isolated
 * one-shot and the instrument does not sound like one box: struck notes do
 * not leave a halo, and a chord does not keep ringing after the hands come
 * off it. The same bank is fed by the harp, because a harp's strings couple
 * to each other for the same reason.
 *
 * `coupling` is how hard the soundboard drives the strings; `rt60` is how
 * long an excited string takes to fall 60 dB.
 */
export function sympathetic(x, midis, { coupling = 0.055, rt60 = 2.6, damp = 2600, spread = 0.0 } = {}) {
  const n = x.length;
  const out = new Float32Array(n);
  const strings = midis.map((m) => {
    const f = mtof(m + (rndi() - 0.5) * spread);
    const N = SR / f - 0.5;
    const L = Math.max(2, Math.floor(N));
    const frac = N - L;
    return {
      buf: new Float32Array(L), L, p: 0,
      c: (1 - frac) / (1 + frac),
      // feedback per round trip for the wanted decay
      g: Math.pow(10, (-3 * L) / (rt60 * SR)),
      // low strings are driven harder and ring longer, as they do in a piano
      drive: coupling * Math.pow(2, (60 - m) / 42),
      lastLp: 0, lastIn: 0, lastAp: 0,
    };
  });
  const a = Math.exp(-TAU * damp / SR);          // one-pole damping in each loop
  for (let i = 0; i < n; i += 1) {
    const inp = x[i];
    let acc = 0;
    for (let s = 0; s < strings.length; s += 1) {
      const st = strings[s];
      const y = st.buf[st.p];
      acc += y;
      const lp = y * (1 - a) + st.lastLp * a; st.lastLp = lp;
      const ap = -st.c * lp + st.lastIn + st.c * st.lastAp; st.lastIn = lp; st.lastAp = ap;
      st.buf[st.p] = ap * st.g + inp * st.drive;
      st.p = (st.p + 1) % st.L;
    }
    out[i] = acc;
  }
  // The halo is not the note: keep it out of the fundamental region so it
  // reads as resonance rather than as a second, blurrier piano.
  applyBiquad(out, biquad("hp", 150, 0.7));
  applyBiquad(out, biquad("lp", 5200, 0.7));
  return out;
}

// ====================================================================== ROOM ==
/**
 * Eight delay lines, Householder feedback (orthogonal, so the tail does not
 * colour), a one-pole lowpass inside each loop so the room darkens as it
 * decays, two lines whose length wanders slightly so the tail never settles
 * into a pitch, and a short asymmetric early-reflection tap set that gives
 * the room a size. Bigger and later than synth.mjs's four-line reverb, which
 * stays for the sound effects.
 */
export function hall(inL, inR, { rt60 = 3.1, damp = 4600, preDelay = 0.030, width = 1.15 } = {}) {
  const n = inL.length;
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const lens = [1381, 1607, 1867, 2131, 2377, 2707, 3049, 3391];
  const lines = lens.map((L) => new Float32Array(L + 8));
  const idx = new Int32Array(8);
  const g = lens.map((L) => Math.pow(10, (-3 * L) / (rt60 * SR)));
  const lpA = Math.exp(-TAU * damp / SR);
  const lpState = new Float64Array(8);
  const modHz = [0.11, 0.17, 0, 0, 0.13, 0, 0, 0.19];
  const modPh = [0, 1.7, 0, 0, 3.1, 0, 0, 5.0];

  const mkAp = (spec) => spec.map(([L, k]) => ({ buf: new Float32Array(L), i: 0, k }));
  const dL = mkAp([[113, 0.7], [251, 0.7], [389, 0.62], [619, 0.58]]);
  const dR = mkAp([[127, 0.7], [269, 0.7], [401, 0.62], [641, 0.58]]);
  const runAp = (chain, x) => {
    let v = x;
    for (const ap of chain) {
      const d = ap.buf[ap.i];
      const y = -ap.k * v + d;
      ap.buf[ap.i] = v + ap.k * y;
      ap.i = (ap.i + 1) % ap.buf.length;
      v = y;
    }
    return v;
  };

  const pd = Math.round(preDelay * SR);
  const pdL = new Float32Array(pd + 1), pdR = new Float32Array(pd + 1);
  let pdi = 0;
  const erT = [0.0091, 0.0137, 0.0191, 0.0263, 0.0341, 0.0437];
  const erG = [0.42, -0.34, 0.29, -0.23, 0.18, -0.14];
  const erS = erT.map((x) => Math.round(x * SR));
  const erS2 = erT.map((x) => Math.round(x * SR * 1.17));
  const s = new Float64Array(8), y = new Float64Array(8);

  for (let i = 0; i < n; i += 1) {
    let eL = 0, eR = 0;
    for (let k = 0; k < erS.length; k += 1) {
      const a = i - erS[k], b = i - erS2[k];
      if (a >= 0) eL += inL[a] * erG[k];
      if (b >= 0) eR += inR[b] * erG[k];
    }
    const tL = pdL[pdi], tR = pdR[pdi];
    pdL[pdi] = inL[i]; pdR[pdi] = inR[i];
    pdi = (pdi + 1) % (pd + 1);
    const xL = runAp(dL, tL), xR = runAp(dR, tR);

    for (let k = 0; k < 8; k += 1) {
      const line = lines[k], L = lens[k], len = line.length;
      const rp = idx[k] - L;
      if (modHz[k]) {
        const rf = rp + 2.4 * Math.sin(TAU * modHz[k] * i / SR + modPh[k]);
        const r0 = Math.floor(rf), fr = rf - r0;
        const a = line[((r0 % len) + len) % len], b = line[(((r0 + 1) % len) + len) % len];
        s[k] = a + (b - a) * fr;
      } else s[k] = line[((rp % len) + len) % len];
      lpState[k] = s[k] * (1 - lpA) + lpState[k] * lpA;
      s[k] = lpState[k] * g[k];
    }
    let sum = 0;
    for (let k = 0; k < 8; k += 1) sum += s[k];
    sum *= 2 / 8;                                   // Householder: y = x - (2/N) sum(x)
    for (let k = 0; k < 8; k += 1) y[k] = s[k] - sum;
    for (let k = 0; k < 8; k += 1) {
      lines[k][idx[k] % lines[k].length] = y[k] + (k % 2 === 0 ? xL : xR) * 0.36;
      idx[k] = (idx[k] + 1) % lines[k].length;
    }
    outL[i] = eL * 0.5 + (s[0] - s[3] + s[4] - s[7]) * 0.30;
    outR[i] = eR * 0.5 + (s[1] - s[2] + s[5] - s[6]) * 0.30;
  }
  applyBiquad(outL, biquad("hp", 140, 0.7));
  applyBiquad(outR, biquad("hp", 140, 0.7));
  applyBiquad(outL, biquad("lp", 8400, 0.6));
  applyBiquad(outR, biquad("lp", 8400, 0.6));
  if (width !== 1) {
    for (let i = 0; i < n; i += 1) {
      const m = (outL[i] + outR[i]) * 0.5, sd = (outL[i] - outR[i]) * 0.5 * width;
      outL[i] = m + sd; outR[i] = m - sd;
    }
  }
  return [outL, outR];
}
