// Speaks each caption with OpenAI text to speech, one file per line, and
// measures it. The narration is written in videos/voiceover.json; the timings
// come from the recording's markers.
//
//   OPENAI_API_KEY=... node videos/gen-vo.mjs videos/take4
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? "videos/take4";
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
for (const [index, caption] of markers.captions.entries()) {
  const spoken = script.lines[caption.text] ?? caption.text;
  const file = join(voDir, `${String(index).padStart(2, "0")}.mp3`);
  if (!existsSync(file)) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: script.voice, input: spoken, instructions: script.instructions, response_format: "mp3" }),
    });
    if (!response.ok) throw new Error(`Speech failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    const rawFile = `${file}.raw.mp3`;
    writeFileSync(rawFile, Buffer.from(await response.arrayBuffer()));
    // Silence at either end is dead air on the timeline, so it is cut here.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", rawFile,
      "-af", "silenceremove=start_periods=1:start_silence=0.05:start_threshold=-45dB:detection=peak,areverse,silenceremove=start_periods=1:start_silence=0.08:start_threshold=-45dB:detection=peak,areverse",
      file], { stdio: "inherit" });
  }
  out.push({ index, at: caption.at, text: spoken, file, seconds: seconds(file) });
  console.log(`${String(index).padStart(2, "0")} ${out.at(-1).seconds.toFixed(1)}s  ${spoken.slice(0, 60)}`);
}
writeFileSync(join(dir, "vo.json"), JSON.stringify(out, null, 2));
