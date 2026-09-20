// Turns the raw recording into the submission file. The product runs at its own
// speed in the recording; the two stretches where a person would wait (the place
// lookup, and the operators writing back) are sped up so the whole thing fits
// under three minutes. Nothing else is cut or re-ordered.
//
//   node videos/build-demo.mjs videos/out
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "videos/out";
const raw = join(dir, "raw.webm");
const outFile = join(dir, "tripbrief-demo.mp4");
if (!existsSync(raw)) throw new Error(`No recording at ${raw}`);
const markers = JSON.parse(readFileSync(join(dir, "markers.json"), "utf8"));

const probe = (file) =>
  Number(execFileSync("ffmpeg", ["-i", file, "-hide_banner"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) || 0);
const duration = (() => {
  try { probe(raw); } catch (error) {
    const found = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(error.stderr ?? ""));
    if (found) return Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]);
  }
  throw new Error("Could not read the recording's duration");
})();

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

const parts = spans.map((span, index) =>
  `[0:v]trim=start=${span.from.toFixed(2)}:end=${span.to.toFixed(2)},setpts=(PTS-STARTPTS)/${span.speed}[v${index}]`,
);
const filter = `${parts.join(";")};${spans.map((_, index) => `[v${index}]`).join("")}concat=n=${spans.length}:v=1:a=0[out]`;
const expected = spans.reduce((total, span) => total + (span.to - span.from) / span.speed, 0);

execFileSync("ffmpeg", [
  "-y", "-i", raw,
  "-filter_complex", filter,
  "-map", "[out]",
  "-r", "30",
  "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  outFile,
], { stdio: "inherit" });

console.log(JSON.stringify({ raw: Number(duration.toFixed(1)), final: Number(expected.toFixed(1)), spans, outFile }, null, 2));
