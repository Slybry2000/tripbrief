// Voice bake-off. Generates one test line with several voices and several
// instruction wordings, then measures each: duration, words per minute,
// pause count and length, loudness, and high-frequency content.
//
//   set OPENAI_API_KEY=... && node voice-bakeoff.mjs
//
// NOTE: response_format is "wav". The current pipeline asks for mp3 and then
// re-encodes it, which in take5 dropped the files to 32 kbps mono.
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const key = process.env.OPENAI_API_KEY?.trim();
if (!key) { console.error("OPENAI_API_KEY is not set - nothing generated."); process.exit(1); }
mkdirSync("bakeoff", { recursive: true });

// A line with a list, a proper noun and a clause break - the shapes that expose
// a voice's phrasing. 14 words.
const LINE = "Firecrawl reads each company's own site, and ranks them on what they claim.";

const voices = ["sage", "nova", "alloy", "ballad", "ash", "verse"];
const instructions = {
  A_current: "Warm, clear and confident, like a designer showing a colleague work they are proud of. Speak at a natural working pace, about 165 words per minute: brisk enough to keep moving, never rushed or breathless. Light, even emphasis, short pauses only at commas, no long pauses, no announcer energy, no trailing silence.",
  B_brisk: "Brisk, warm product narration. Move quickly and do not linger: clip the ends of sentences, keep pauses under a fifth of a second, never pause for effect. Sound like someone talking a colleague through a screen they know well, slightly ahead of the beat. No announcer tone, no gravitas, no trailing silence.",
  C_conversational: "Speak like a smart friend explaining something they built, mid-conversation. Natural, unhurried but never slow, with real sentence melody: lift into the important word, drop away at the end. Small breaths between sentences, no dramatic pauses, no reading-aloud cadence.",
  D_tight: "Read this as a single confident thought, quickly and evenly, with no pause anywhere except one short beat at the comma. Energetic, light, no gravitas, no trailing air at the end.",
};

const run = (a) => { const r = spawnSync("ffmpeg", a, { encoding: "utf8" }); return String(r.stdout) + String(r.stderr); };
const measure = (file) => {
  const st = run(["-hide_banner", "-nostats", "-i", file, "-af", "astats=metadata=1:reset=0,ebur128", "-f", "null", "-"]);
  const tail = st.slice(st.lastIndexOf("Summary"));
  const sil = run(["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-38dB:d=0.10", "-f", "null", "-"]);
  const pauses = [...sil.matchAll(/silence_duration: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const dur = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).stdout);
  const air = run(["-hide_banner", "-nostats", "-i", file, "-af",
    "highpass=f=6000:poles=2,highpass=f=6000:poles=2,astats=metadata=1:reset=0", "-f", "null", "-"]);
  const words = LINE.split(/\s+/).length;
  const pauseTotal = pauses.reduce((a, b) => a + b, 0);
  return {
    dur, wpm: words / (dur / 60), artic: words / ((dur - pauseTotal) / 60),
    nPause: pauses.length, pauseTotal, longest: pauses.length ? Math.max(...pauses) : 0,
    lufs: (/ {4}I: +(-?[0-9.]+)/.exec(tail) ?? [])[1],
    peak: (/Peak level dB: (-?[0-9.]+)/.exec(st) ?? [])[1],
    air6k: (/RMS level dB: (-?[0-9.]+)/.exec(air) ?? [])[1],
  };
};

const rows = [];
for (const voice of voices) {
  for (const [tag, instr] of Object.entries(instructions)) {
    const file = `bakeoff/${voice}-${tag}.wav`;
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: LINE, instructions: instr, response_format: "wav" }),
    });
    if (!res.ok) { console.error(voice, tag, res.status, (await res.text()).slice(0, 160)); continue; }
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    rows.push({ voice, tag, ...measure(file) });
    const r = rows.at(-1);
    console.log(`${voice.padEnd(7)} ${tag.padEnd(17)} dur=${r.dur.toFixed(2)}s  wpm=${r.wpm.toFixed(0)}  artic=${r.artic.toFixed(0)}  ` +
      `pauses=${r.nPause} (${r.pauseTotal.toFixed(2)}s, longest ${r.longest.toFixed(2)}s)  LUFS=${r.lufs}  >6kHz=${r.air6k}dB`);
  }
}
console.log("\nfastest:", [...rows].sort((a, b) => a.dur - b.dur).slice(0, 3).map((r) => `${r.voice}/${r.tag} ${r.dur.toFixed(2)}s`).join("  "));
console.log("least dead air:", [...rows].sort((a, b) => a.pauseTotal - b.pauseTotal).slice(0, 3).map((r) => `${r.voice}/${r.tag} ${r.pauseTotal.toFixed(2)}s`).join("  "));
writeFileSync("bakeoff/results.json", JSON.stringify(rows, null, 2));
