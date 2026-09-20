// Writes a subtitle track for the finished film from the narration that was
// actually spoken and where it was actually placed.
//
//   node videos/make-srt.mjs videos/take8
//
// This exists because the submission site reads a transcript from the video:
// a page it can scrape, such as a YouTube link with captions, is read, and a
// bare .mp4 is recorded as unsupported. Uploading with this track is the
// difference between the film being read and being skipped.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2] ?? "videos/out";
const markers = JSON.parse(readFileSync(join(dir, "markers.json"), "utf8"));
const narration = JSON.parse(readFileSync(join(dir, "vo.json"), "utf8"));
const film = join(dir, "tripbrief-demo.mp4");
if (!existsSync(film)) throw new Error(`No film at ${film}. Build it first.`);

const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", film], { encoding: "utf8" });
const length = Number(probe.trim());

// The same placement the build uses, so the subtitles sit where the voice does.
const raw = join(dir, "raw.webm");
let shift = 0;
try {
  execFileSync("ffmpeg", ["-i", raw, "-hide_banner"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  const found = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(String(error.stderr ?? ""));
  if (found) shift = (Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3])) - markers.total;
}

const clock = (value) => {
  const whole = Math.max(0, value);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = Math.floor(whole % 60);
  const ms = Math.round((whole - Math.floor(whole)) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

// vo.json carries each line's raw time; the finished starts are recomputed the
// same way the build does it, from the shot list in markers.json.
const placedFile = join(dir, "placed.json");
const placed = existsSync(placedFile)
  ? JSON.parse(readFileSync(placedFile, "utf8"))
  : narration.map((line) => ({ ...line, start: null }));

if (placed.some((line) => line.start === null)) {
  console.warn("No placed.json: falling back to raw marker times, which ignores the speed-ups.");
  for (const line of placed) line.start = Math.max(0, line.at + shift);
}

const blocks = placed
  .slice()
  .sort((a, b) => a.start - b.start)
  .map((line, index, all) => {
    const end = Math.min(all[index + 1]?.start ?? length, line.start + line.seconds + 0.4, length);
    return `${index + 1}\n${clock(line.start)} --> ${clock(end)}\n${line.text}\n`;
  });

const out = join(dir, "tripbrief-demo.srt");
writeFileSync(out, blocks.join("\n"), "utf8");
console.log(JSON.stringify({ out, cues: blocks.length, filmLength: Number(length.toFixed(1)) }, null, 2));
