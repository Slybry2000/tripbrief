// Builds a musical pad bed: four chords with real harmonic partials, chorus
// detune, stereo spread and slow swells, crossfaded into one piece.
//
// The bed it replaces was two sine tones a fifth apart with no harmonics and no
// change from start to end, which measured, and sounded, like a test tone.
//
//   node videos/make-bed.mjs <seconds> <outfile>
import { spawnSync } from "node:child_process";

const LEN = Number(process.argv[2] ?? 145);
const OUT = process.argv[3] ?? "bed.wav";
const CHORD = 46;         // each chord segment length (overlap 9s x3 -> 46*4-27 = 157 -> trimmed)
const XF = 9;             // crossfade seconds

// note -> [fundamental Hz]. Am9 / Fmaj9 / Cmaj9 / Am9(high voicing)
const chords = [
  [110.00, 164.81, 220.00, 261.63, 493.88],      // Am9  (A2 E3 A3 C4 B4)
  [ 87.31, 130.81, 174.61, 220.00, 329.63],      // Fmaj9 (F2 C3 F3 A3 E4)
  [130.81, 196.00, 261.63, 329.63, 392.00],      // Cmaj (C3 G3 C4 E4 G4)
  [110.00, 164.81, 261.63, 329.63, 440.00],      // Am    (A2 E3 C4 E4 A4)
];

// One voice = fundamental + 2nd and 3rd partials, plus a detuned twin (chorus).
const voice = (f, amp, detune) => {
  const parts = [];
  for (const [mul, gain] of [[1, 1], [2, 0.22], [3, 0.10], [4, 0.04]]) {
    parts.push(`${(amp * gain).toFixed(4)}*sin(2*PI*${(f * mul * detune).toFixed(3)}*t)`);
  }
  return parts.join("+");
};

// Left and right get opposite detune, so the chord beats slowly across the stereo field.
// The two lowest notes stay dead centre (identical in both channels) so the bed
// survives a phone speaker; only the upper voices are detuned apart for width.
const side = (freqs, detune) =>
  freqs.map((f, i) => voice(f, 0.30 / (1 + i * 0.45), i < 2 ? 1 : detune)).join("+");

const args = ["-y", "-loglevel", "error"];
const filters = [];
chords.forEach((freqs, i) => {
  args.push("-f", "lavfi", "-i",
    `aevalsrc='${side(freqs, 0.9985)}'|'${side(freqs, 1.0015)}':s=48000:d=${CHORD}`);
  // Slow breathing swell (period is prime-ish so chords never pulse in lockstep),
  // a warm lowpass, a gentle high shelf cut, and fades for the crossfade joints.
  filters.push(
    `[${i}:a]volume='0.62+0.38*sin(2*PI*t/${19 + i * 3}+${i})':eval=frame,` +
    `lowpass=f=${1600 + i * 120}:poles=2,highpass=f=70,` +
    `afade=t=in:st=0:d=${XF},afade=t=out:st=${CHORD - XF}:d=${XF}[c${i}]`);
});
// Air layer: filtered brown noise, moving, very low - gives the pad a room.
args.push("-f", "lavfi", "-i", `anoisesrc=color=brown:amplitude=0.6:duration=${LEN}`);
filters.push(`[4:a]bandpass=f=420:width_type=o:w=2.6,volume='0.5+0.5*sin(2*PI*t/31)':eval=frame,volume=0.10,aformat=channel_layouts=stereo,stereotools=mlev=0.7:slev=1.4[air]`);

filters.push(`[c0][c1]acrossfade=d=${XF}:c1=tri:c2=tri[x1]`);
filters.push(`[x1][c2]acrossfade=d=${XF}:c1=tri:c2=tri[x2]`);
filters.push(`[x2][c3]acrossfade=d=${XF}:c1=tri:c2=tri[pad]`);
filters.push(`[pad][air]amix=inputs=2:normalize=0,` +
  `atrim=0:${LEN},asetpts=N/SR/TB,` +
  // Voice pocket: leave room where speech fundamentals and consonants live.
  `equalizer=f=300:width_type=o:w=1.2:g=-3,equalizer=f=2500:width_type=o:w=1.5:g=-4,` +
  `afade=t=in:st=0:d=4,afade=t=out:st=${LEN - 6}:d=6,` +
  `alimiter=limit=0.5:level=disabled,aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[bed]`);

args.push("-filter_complex", filters.join(";"), "-map", "[bed]", "-t", String(LEN), OUT);
const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
process.stdout.write(r.stdout + r.stderr);
console.log("exit", r.status);
