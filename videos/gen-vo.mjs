// Speaks each caption with OpenAI text to speech, one file per line, and
// measures it. The narration is written in videos/voiceover.json; the timings
// come from the recording's markers.
//
//   OPENAI_API_KEY=... node videos/gen-vo.mjs videos/take6
//
// Everything stays lossless end to end. An earlier version asked the API for
// mp3 and then re-encoded each file through ffmpeg to trim the silence, with
// no codec given. libmp3lame defaults to 32 kbps on a 24 kHz mono stream, so
// every shipped line had its top octave destroyed: the 10 kHz band measured
// 25 dB down against the original. That is what made the voice sound dull and
// slightly swirly on the sibilants.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "videos/out";
const voDir = join(dir, "vo");
mkdirSync(voDir, { recursive: true });
const key = process.env.OPENAI_API_KEY?.trim();
if (!key) throw new Error("OPENAI_API_KEY is not set");

const script = JSON.parse(readFileSync("videos/voiceover.json", "utf8"));
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

const out = [];
const missing = [];
for (const [index, caption] of markers.captions.entries()) {
  const spoken = script.lines[caption.text];
  if (!spoken) missing.push(caption.text);
  const line = spoken ?? caption.text;
  const file = join(voDir, `${String(index).padStart(2, "0")}.wav`);
  if (!existsSync(file)) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: script.voice,
        input: line,
        instructions: script.instructions,
        response_format: "wav",
      }),
    });
    if (!response.ok) throw new Error(`Speech failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    const rawFile = `${file}.raw.wav`;
    writeFileSync(rawFile, Buffer.from(await response.arrayBuffer()));
    // Silence at either end is dead air on the timeline, so it is cut here.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawFile,
      "-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak,areverse,silenceremove=start_periods=1:start_silence=0.08:start_threshold=-45dB:detection=peak,areverse",
      "-c:a", "pcm_s16le", file], { stdio: "inherit" });
  }
  const length = seconds(file);
  const words = line.trim().split(/\s+/).length;
  out.push({ index, at: caption.at, kicker: caption.kicker ?? "", text: line, file, seconds: length, words });
  console.log(`${String(index).padStart(2, "0")} ${length.toFixed(1)}s ${Math.round((words / length) * 60)}wpm  ${line.slice(0, 58)}`);
}
if (missing.length) {
  console.warn(`\n${missing.length} caption(s) had no written line and were spoken as written:`);
  for (const text of missing) console.warn(`  ${text}`);
}
writeFileSync(join(dir, "vo.json"), JSON.stringify(out, null, 2));
