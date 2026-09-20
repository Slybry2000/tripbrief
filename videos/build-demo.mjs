// Turns the raw recording into the submission file. The product runs at its own
// speed in the recording; the two stretches where a person would wait (the place
// lookup, and the operators writing back) are sped up so the whole thing fits
// under three minutes. Nothing else is cut or re-ordered.
//
// When videos/<take>/vo.json exists (see gen-vo.mjs), each narration line is
// placed on the moment its caption appears, over a quiet ambient bed.
//
//   node videos/build-demo.mjs videos/take4 [--no-music]
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "videos/out";
const music = !process.argv.includes("--no-music");
const raw = join(dir, "raw.webm");
const outFile = join(dir, "tripbrief-demo.mp4");
if (!existsSync(raw)) throw new Error(`No recording at ${raw}`);
const markers = JSON.parse(readFileSync(join(dir, "markers.json"), "utf8"));

const seconds = (file) => {
  try {
    execFileSync("ffmpeg", ["-i", file, "-hide_banner"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const found = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(error.stderr ?? ""));
    if (found) return Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]);
  }
  throw new Error(`Could not measure ${file}`);
};

const duration = seconds(raw);
// The recorder's clock starts a moment before the video does; align on the end.
const shift = duration - markers.total;
const mark = (value) => Math.max(0, Math.min(duration, value + shift));
const spans = [
  { from: 0, to: mark(markers.lookupStart), speed: 1 },
  { from: mark(markers.lookupStart), to: mark(markers.lookupEnd), speed: 4 },
  { from: mark(markers.lookupEnd), to: mark(markers.waitStart), speed: 1 },
  { from: mark(markers.waitStart), to: mark(markers.waitEnd), speed: 6 },
  { from: mark(markers.waitEnd), to: duration, speed: 1 },
].filter((span) => span.to - span.from > 0.2);
const finalLength = spans.reduce((total, span) => total + (span.to - span.from) / span.speed, 0);

// Where a moment in the recording lands once the waits are sped up.
const toFinal = (rawTime) => {
  const point = mark(rawTime);
  let out = 0;
  for (const span of spans) {
    if (point >= span.to) out += (span.to - span.from) / span.speed;
    else { if (point > span.from) out += (point - span.from) / span.speed; break; }
  }
  return out;
};

const parts = spans.map((span, index) =>
  `[0:v]trim=start=${span.from.toFixed(2)}:end=${span.to.toFixed(2)},setpts=(PTS-STARTPTS)/${span.speed}[v${index}]`,
);
const filters = [...parts, `${spans.map((_, index) => `[v${index}]`).join("")}concat=n=${spans.length}:v=1:a=0[out]`];
const args = ["-y", "-i", raw];

const voFile = join(dir, "vo.json");
const narration = existsSync(voFile) ? JSON.parse(readFileSync(voFile, "utf8")) : [];
const placed = narration
  .map((line) => ({ ...line, start: toFinal(line.at) + 0.12 }))
  .sort((a, b) => a.start - b.start)
  .map((line, index, all) => {
    // A line never runs into the next one: if it would, it is spoken slightly
    // faster, up to a quarter again, and only then allowed to overlap.
    const room = (all[index + 1]?.start ?? finalLength) - line.start - 0.25;
    const tempo = line.seconds > room && room > 0.5 ? Math.min(1.35, line.seconds / room) : 1;
    return { ...line, tempo, room };
  });

if (placed.length) {
  placed.forEach((line, index) => {
    args.push("-i", line.file);
    const chain = [
      `[${index + 1}:a]aresample=48000`,
      line.tempo > 1 ? `atempo=${line.tempo.toFixed(3)}` : null,
      `adelay=${Math.round(line.start * 1000)}|${Math.round(line.start * 1000)}`,
      "volume=1.0",
    ].filter(Boolean).join(",");
    filters.push(`${chain}[a${index}]`);
  });
  if (music) {
    // A quiet room tone: two low sines and a little brown noise, well under the
    // voice. It is there to stop the silence, not to be listened to.
    args.push("-f", "lavfi", "-i", `sine=frequency=110:duration=${finalLength.toFixed(2)}`);
    args.push("-f", "lavfi", "-i", `sine=frequency=164.81:duration=${finalLength.toFixed(2)}`);
    args.push("-f", "lavfi", "-i", `anoisesrc=color=brown:duration=${finalLength.toFixed(2)}`);
    const first = placed.length + 1;
    filters.push(`[${first}:a]volume=0.035,tremolo=f=0.12:d=0.4[m1]`);
    filters.push(`[${first + 1}:a]volume=0.022,tremolo=f=0.11:d=0.5[m2]`);
    filters.push(`[${first + 2}:a]volume=0.012,lowpass=f=700[m3]`);
    filters.push(`[m1][m2][m3]amix=inputs=3:normalize=0,lowpass=f=1200,afade=t=in:st=0:d=2,afade=t=out:st=${(finalLength - 3).toFixed(2)}:d=3[bed]`);
  }
  const voices = placed.map((_, index) => `[a${index}]`).join("");
  filters.push(`${voices}${music ? "[bed]" : ""}amix=inputs=${placed.length + (music ? 1 : 0)}:normalize=0:dropout_transition=0,alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[mix]`);
}

args.push("-filter_complex", filters.join(";"), "-map", "[out]");
if (placed.length) args.push("-map", "[mix]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
args.push("-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", finalLength.toFixed(2), outFile);
execFileSync("ffmpeg", args, { stdio: "inherit" });

console.log(JSON.stringify({
  raw: Number(duration.toFixed(1)),
  final: Number(finalLength.toFixed(1)),
  narrationLines: placed.length,
  tightest: placed.length ? Number(Math.min(...placed.map((line) => line.room)).toFixed(2)) : null,
  spedUp: placed.filter((line) => line.tempo > 1).length,
  outFile,
}, null, 2));
