// Minimal DSP toolkit: WAV in/out, FFT, and the measures used to judge whether
// a piece of audio behaves like music or like a signal generator.
import { readFileSync, writeFileSync } from "node:fs";

export const SR = 48000;

// ------------------------------------------------------------------- wav i/o
export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a RIFF file: " + path);
  let pos = 12, fmt = null, data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") fmt = { format: b.readUInt16LE(body), channels: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    if (id === "data") data = { start: body, size: Math.min(size, b.length - body) };
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("missing fmt/data: " + path);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.size / (bytes * fmt.channels));
  const ch = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < fmt.channels; c += 1) {
      const o = data.start + (i * fmt.channels + c) * bytes;
      let v;
      if (fmt.format === 3 && fmt.bits === 32) v = b.readFloatLE(o);
      else if (fmt.bits === 16) v = b.readInt16LE(o) / 32768;
      else if (fmt.bits === 24) v = ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) << 8 >> 8) / 8388608;
      else if (fmt.bits === 32) v = b.readInt32LE(o) / 2147483648;
      else throw new Error("unsupported bit depth " + fmt.bits);
      ch[c][i] = v;
    }
  }
  return { rate: fmt.rate, channels: ch };
}

export function writeWav(path, channels, rate = SR) {
  const n = channels[0].length, nc = channels.length;
  const b = Buffer.alloc(44 + n * nc * 4);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(36 + n * nc * 4, 4); b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii"); b.writeUInt32LE(16, 16); b.writeUInt16LE(3, 20);   // IEEE float
  b.writeUInt16LE(nc, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * nc * 4, 28);
  b.writeUInt16LE(nc * 4, 32); b.writeUInt16LE(32, 34);
  b.write("data", 36, "ascii"); b.writeUInt32LE(n * nc * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i += 1) for (let c = 0; c < nc; c += 1) { b.writeFloatLE(channels[c][i], o); o += 4; }
  writeFileSync(path, b);
}

// ---------------------------------------------------------------------- fft
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// Magnitude spectrogram. Hann window, 2048 / 512.
export function spectrogram(x, rate = SR, N = 2048, hop = 512) {
  const win = new Float32Array(N);
  for (let i = 0; i < N; i += 1) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const frames = [];
  for (let s = 0; s + N <= x.length; s += hop) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i += 1) re[i] = x[s + i] * win[i];
    fft(re, im);
    const mag = new Float32Array(N / 2);
    for (let k = 0; k < N / 2; k += 1) mag[k] = Math.hypot(re[k], im[k]);
    frames.push(mag);
  }
  return { frames, hop, binHz: rate / N };
}

// ------------------------------------------------------------------ measures
// Spectral flux: how much the spectrum changes frame to frame. A held tone is
// near zero; notes being played produce peaks.
export function fluxCurve(frames) {
  const out = new Float32Array(frames.length);
  for (let t = 1; t < frames.length; t += 1) {
    let s = 0;
    for (let k = 0; k < frames[t].length; k += 1) {
      const d = frames[t][k] - frames[t - 1][k];
      if (d > 0) s += d;                       // half-wave rectified: onsets only
    }
    out[t] = s;
  }
  return out;
}

// Note onsets per minute, by peak-picking the flux curve above an adaptive median.
export function onsets(flux, hop, rate = SR, sensitivity = 1.6) {
  const win = 43;                              // ~0.45 s median window
  const peaks = [];
  for (let t = 2; t < flux.length - 1; t += 1) {
    const a = Math.max(0, t - win), b = Math.min(flux.length, t + win);
    const local = Array.from(flux.slice(a, b)).sort((p, q) => p - q);
    const med = local[Math.floor(local.length / 2)];
    const thr = med * sensitivity + 1e-9;
    if (flux[t] > thr && flux[t] >= flux[t - 1] && flux[t] > flux[t + 1]) {
      const time = t * hop / rate;
      if (!peaks.length || time - peaks.at(-1) > 0.06) peaks.push(time);
    }
  }
  return peaks;
}

export function rms(x, from = 0, to = x.length) {
  let s = 0; for (let i = from; i < to; i += 1) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}
export const db = (v) => 20 * Math.log10(Math.max(v, 1e-12));

// Spectral centroid per frame, in Hz.
export function centroid(frames, binHz) {
  return frames.map((m) => {
    let num = 0, den = 0;
    for (let k = 1; k < m.length; k += 1) { num += k * binHz * m[k]; den += m[k]; }
    return den > 0 ? num / den : 0;
  });
}

export function stats(values) {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return { min: 0, p10: 0, med: 0, p90: 0, max: 0, mean: 0, sd: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  const at = (p) => v[Math.min(v.length - 1, Math.floor(v.length * p))];
  return { min: v[0], p10: at(0.1), med: at(0.5), p90: at(0.9), max: v.at(-1), mean, sd };
}
