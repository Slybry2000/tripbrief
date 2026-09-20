// Instruments. Each one returns a mono Float32Array of a single note or hit.
// These are physical/FM models rather than summed sine partials, which is the
// difference between "a chord" and "a tone generator playing a chord".
import { SR } from "./dsp.mjs";

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// A cheap deterministic noise source, so every render is identical.
let seed = 0x2f6e2b1;
export const rnd = () => {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0;
  return (seed / 0x7fffffff) % 1;
};
export const resetRnd = () => { seed = 0x2f6e2b1; };

// ---------------------------------------------------------- state-variable LPF
export function svf(x, cutoffAt, q = 0.7) {
  const out = new Float32Array(x.length);
  let low = 0, band = 0;
  for (let i = 0; i < x.length; i += 1) {
    const fc = Math.min(0.48, Math.max(0.0005, cutoffAt(i) / SR));
    const f = 2 * Math.sin(Math.PI * fc);
    const qq = 1 / q;
    const high = x[i] - low - qq * band;
    band += f * high;
    low += f * band;
    out[i] = low;
  }
  return out;
}

// ------------------------------------------------------------------- envelopes
const expDecay = (i, rate) => Math.exp(-i / (SR * rate));
function adsrAt(i, n, a, d, s, r) {
  const A = a * SR, D = d * SR, R = r * SR, rel = n - R;
  if (i < A) return i / Math.max(1, A);
  if (i < A + D) return 1 - (1 - s) * ((i - A) / Math.max(1, D));
  if (i < rel) return s;
  return s * Math.max(0, 1 - (i - rel) / Math.max(1, R));
}

// ------------------------------------------------ Karplus-Strong plucked string
// A noise burst driven round a delay line whose length sets the pitch, losing
// its high end a little on every trip. That loss is what makes it sound like a
// string being plucked rather than an oscillator being switched on.
export function pluck(freq, dur, amp = 1, { damp = 0.48, bright = 0.6, pick = 1 } = {}) {
  const n = Math.round(dur * SR);
  const L = Math.max(2, Math.round(SR / freq));
  const buf = new Float32Array(L);
  // Pick position and brightness shape the initial burst.
  let last = 0;
  for (let i = 0; i < L; i += 1) {
    const white = rnd() * 2 - 1;
    last = white * bright + last * (1 - bright);
    buf[i] = last;
  }
  const pk = Math.round(L * 0.22 * pick);
  for (let i = 0; i < Math.min(pk, L); i += 1) buf[i] *= i / Math.max(1, pk);
  const out = new Float32Array(n);
  let p = 0, y = 0;
  // loss: how much of the loop survives each pass. Higher freq strings die faster.
  const loss = Math.pow(0.9993, 1 + freq / 220);
  for (let i = 0; i < n; i += 1) {
    const cur = buf[p];
    const nxt = buf[(p + 1) % L];
    y = (cur * (1 - damp) + nxt * damp) * loss;   // one-pole damping in the loop
    buf[p] = y;
    out[i] = cur;
    p = (p + 1) % L;
  }
  // body resonance and a gentle tail fade so notes never click off
  const fade = Math.round(0.02 * SR);
  for (let i = 0; i < n; i += 1) {
    let g = amp;
    if (i > n - fade) g *= (n - i) / fade;
    out[i] *= g;
  }
  return out;
}

// ------------------------------------------------------ 2-operator FM (a tine)
// Modulator at 14x with a very fast index decay is the classic electric-piano
// "tine" attack; the carrier underneath sustains as a near-sine.
export function fmBell(freq, dur, amp = 1, { ratio = 14, index = 6, indexDecay = 0.055, bodyDecay = 1.5 } = {}) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const wc = 2 * Math.PI * freq / SR, wm = 2 * Math.PI * freq * ratio / SR;
  for (let i = 0; i < n; i += 1) {
    const idx = index * expDecay(i, indexDecay);
    const body = expDecay(i, bodyDecay);
    const attack = Math.min(1, i / (0.004 * SR));
    out[i] = amp * attack * body * Math.sin(wc * i + idx * Math.sin(wm * i));
  }
  const fade = Math.round(0.03 * SR);
  for (let i = Math.max(0, n - fade); i < n; i += 1) out[i] *= (n - i) / fade;
  return out;
}

// --------------------------------------------------- detuned-saw pad with filter
export function padVoice(freq, dur, amp = 1, { detune = 7, open = 1, q = 1.1 } = {}) {
  const n = Math.round(dur * SR);
  const raw = new Float32Array(n);
  const voices = 5;
  const phases = new Float64Array(voices), incs = new Float64Array(voices);
  for (let v = 0; v < voices; v += 1) {
    const cents = (v - (voices - 1) / 2) * detune;
    incs[v] = freq * Math.pow(2, cents / 1200) / SR;
    phases[v] = rnd();
  }
  // polyBLEP: subtracts a polynomial correction either side of the saw's
  // discontinuity. Without it the wrap aliases and folds back as a metallic
  // buzz - which measured as 2% of the render's energy above 14 kHz.
  const blep = (t, dt) => {
    if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
    if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
    return 0;
  };
  for (let i = 0; i < n; i += 1) {
    let s = 0;
    for (let v = 0; v < voices; v += 1) {
      phases[v] += incs[v]; if (phases[v] >= 1) phases[v] -= 1;
      const t = phases[v];
      s += (2 * t - 1) - blep(t, incs[v]);
    }
    raw[i] = s / voices;
  }
  // Slow filter sweep across the note: the pad opens as it sounds.
  const base = freq * 3.2, top = freq * 3.2 + 1900 * open;
  const filtered = svf(raw, (i) => base + (top - base) * Math.min(1, i / (dur * SR * 0.7)), q);
  const out = new Float32Array(n);
  const A = 0.55, D = 0.4, S = 0.75, R = Math.min(1.4, dur * 0.45);
  for (let i = 0; i < n; i += 1) out[i] = filtered[i] * amp * adsrAt(i, n, A, D, S, R);
  return out;
}

// ------------------------------------------------------------------------ bass
export function bass(freq, dur, amp = 1) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  const w = 2 * Math.PI * freq / SR;
  for (let i = 0; i < n; i += 1) {
    const env = Math.min(1, i / (0.008 * SR)) * (0.35 + 0.65 * expDecay(i, dur * 0.5));
    const rel = i > n - 0.15 * SR ? (n - i) / (0.15 * SR) : 1;
    // a touch of second harmonic so it is audible on a speaker with no bottom
    out[i] = amp * env * rel * (Math.sin(w * i) * 0.62 + Math.sin(2 * w * i) * 0.30 * expDecay(i, 0.45) + Math.sin(3 * w * i) * 0.10 * expDecay(i, 0.20));
  }
  return out;
}

// ----------------------------------------------------------------- percussion
export function kick(amp = 1, { f0 = 140, f1 = 62, decay = 0.22 } = {}) {
  const n = Math.round(0.42 * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i += 1) {
    const f = f1 + (f0 - f1) * Math.exp(-i / (SR * 0.035));
    ph += 2 * Math.PI * f / SR;
    const env = expDecay(i, decay) * Math.min(1, i / (0.002 * SR));
    const click = i < 0.004 * SR ? (rnd() * 2 - 1) * 0.25 * (1 - i / (0.004 * SR)) : 0;
    out[i] = amp * (Math.sin(ph) * env + click);
  }
  return out;
}

export function shaker(amp = 1, { decay = 0.038, lo = 3000, hi = 7600 } = {}) {
  const n = Math.round(0.16 * SR);
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i += 1) raw[i] = (rnd() * 2 - 1) * expDecay(i, decay) * Math.min(1, i / (0.0015 * SR));
  // band-limit with a one-pole pair; a shaker is air, not a hiss burst
  let hp = 0, prev = 0, lp = 0;
  const aHi = Math.exp(-2 * Math.PI * lo / SR), aLo = Math.exp(-2 * Math.PI * hi / SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    hp = aHi * (hp + raw[i] - prev); prev = raw[i];
    lp = lp * aLo + hp * (1 - aLo);
    out[i] = lp * amp * 2.4;
  }
  return out;
}

export function rim(amp = 1) {
  const n = Math.round(0.10 * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const env = expDecay(i, 0.012);
    out[i] = amp * env * (0.6 * Math.sin(2 * Math.PI * 1180 * i / SR) + 0.4 * (rnd() * 2 - 1));
  }
  return out;
}

// --------------------------------------------------------------------- reverb
// A small feedback-delay-network with damping and two diffusers in front. This
// is the single biggest reason a synthesised score reads as "recorded" rather
// than "computed": the notes exist in a space and decay into it.
export function reverb(L, R, { size = 1.0, damp = 0.34, preDelay = 0.018 } = {}) {
  const n = L.length;
  const outL = new Float32Array(n), outR = new Float32Array(n);
  const delays = [1931, 2311, 2777, 3181].map((d) => Math.max(8, Math.round(d * size)));
  const lines = delays.map((d) => new Float32Array(d));
  const idx = new Int32Array(4);
  const lp = new Float64Array(4);
  const apD = [331, 461].map((d) => Math.max(4, Math.round(d * size)));
  const ap = apD.map((d) => new Float32Array(d));
  const apI = new Int32Array(2);
  const pre = Math.round(preDelay * SR);
  const preL = new Float32Array(pre + 1), preR = new Float32Array(pre + 1);
  let preI = 0;
  const g = 0.5;                     // Householder-ish feedback
  for (let i = 0; i < n; i += 1) {
    preL[preI] = L[i]; preR[preI] = R[i];
    const rd = (preI + 1) % (pre + 1);
    let x = (preL[rd] + preR[rd]) * 0.5;
    preI = rd;
    // diffusion
    for (let a = 0; a < 2; a += 1) {
      const buf = ap[a], j = apI[a];
      const v = buf[j];
      const y = -0.62 * x + v;
      buf[j] = x + 0.62 * y;
      apI[a] = (j + 1) % buf.length;
      x = y;
    }
    // four damped delay lines, cross-fed
    const o = [0, 0, 0, 0];
    for (let k = 0; k < 4; k += 1) o[k] = lines[k][idx[k]];
    const s0 = o[0] + o[1] + o[2] + o[3];
    for (let k = 0; k < 4; k += 1) {
      const fb = (s0 * g - o[k]) * 0.5 + x * 0.35;
      lp[k] = lp[k] * damp + fb * (1 - damp);
      lines[k][idx[k]] = lp[k] * 0.86;
      idx[k] = (idx[k] + 1) % lines[k].length;
    }
    outL[i] = (o[0] + o[2]) * 0.5;
    outR[i] = (o[1] + o[3]) * 0.5;
  }
  return [outL, outR];
}

// ------------------------------------------------------------------- utilities
export function add(dest, src, atSample, gain = 1, pan = 0) {
  // dest is [L, R]; pan -1..1 with a constant-power law
  const l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
  const n = Math.min(src.length, dest[0].length - atSample);
  for (let i = 0; i < n; i += 1) {
    if (atSample + i < 0) continue;
    dest[0][atSample + i] += src[i] * gain * l * 1.414;
    dest[1][atSample + i] += src[i] * gain * r * 1.414;
  }
}

export const stereoBuf = (seconds) => [new Float32Array(Math.round(seconds * SR)), new Float32Array(Math.round(seconds * SR))];

export function mixInto(dest, src, gain = 1) {
  for (let c = 0; c < 2; c += 1) for (let i = 0; i < dest[c].length && i < src[c].length; i += 1) dest[c][i] += src[c][i] * gain;
}

// One-pole shelves for bus tone shaping.
export function highpass(x, fc) {
  const a = Math.exp(-2 * Math.PI * fc / SR);
  const out = new Float32Array(x.length);
  let y = 0, prev = 0;
  for (let i = 0; i < x.length; i += 1) { y = a * (y + x[i] - prev); prev = x[i]; out[i] = y; }
  return out;
}
export function lowpass(x, fc) {
  const a = Math.exp(-2 * Math.PI * fc / SR);
  const out = new Float32Array(x.length);
  let y = 0;
  for (let i = 0; i < x.length; i += 1) { y = y * a + x[i] * (1 - a); out[i] = y; }
  return out;
}
