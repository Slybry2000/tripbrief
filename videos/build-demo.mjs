// Turns the raw recording into the submission file.
//
// Picture: the single take is cut into the shots the recorder marked, each with
// its own framing and at most one slow push (videos/shots.mjs). The two
// stretches where a person would wait are sped up; nothing else is cut or
// re-ordered, and a sped-up shot never moves the camera.
//
// Sound: each narration line is gain-matched and placed on the moment its
// caption appears, over a musical bed that ducks under the voice, with a few
// sound-design events on the clicks and the arriving replies. Loudness is
// normalised in two passes, because a single pass is a live ramp that misses
// its own target.
//
//   node videos/build-demo.mjs videos/take6 [--no-music] [--no-sfx]
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { assembleXfade, shotLength } from "./shots.mjs";

const dir = process.argv[2] ?? "videos/out";
const music = !process.argv.includes("--no-music");
const useSfx = !process.argv.includes("--no-sfx");
const raw = join(dir, "raw.webm");
const outFile = join(dir, "tripbrief-demo.mp4");
if (!existsSync(raw)) throw new Error(`No recording at ${raw}`);
const markers = JSON.parse(readFileSync(join(dir, "markers.json"), "utf8"));

const TAIL = 3;          // held on the end card, so the last line never clips
const VOICE_TARGET = -18; // LUFS per line, before the bus
const assets = "videos/assets";

const ff = (args) => {
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  return { text: String(result.stdout ?? "") + String(result.stderr ?? ""), code: result.status };
};

const seconds = (file) => {
  const { text } = ff(["-i", file, "-hide_banner"]);
  const found = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(text);
  if (!found) throw new Error(`Could not measure ${file}`);
  return Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]);
};

const duration = seconds(raw);
// The recorder's clock starts a moment before the video does; align on the end.
const shift = duration - markers.total;
const mark = (value) => Math.max(0, Math.min(duration, value + shift));

// ------------------------------------------------------------------- picture
// The stretches a viewer should not have to sit through, and how much faster.
const fast = [
  { from: mark(markers.lookupStart), to: mark(markers.lookupEnd), speed: 4 },
  { from: mark(markers.waitStart), to: mark(markers.waitEnd), speed: 6 },
].filter((span) => span.to - span.from > 1);

const speedAt = (time) => fast.find((span) => time >= span.from && time < span.to)?.speed ?? 1;

// Each marked shot runs until the next one. Where a shot crosses into or out of
// a sped-up stretch it is split there, because one shot cannot have two speeds.
const shots = [];
markers.shots.forEach((entry, index) => {
  const from = mark(entry.at);
  const to = index + 1 < markers.shots.length ? mark(markers.shots[index + 1].at) : duration;
  if (to - from < 0.25) return;
  const cuts = [from, to];
  for (const span of fast) {
    for (const edge of [span.from, span.to]) if (edge > from && edge < to) cuts.push(edge);
  }
  cuts.sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const piece = { from: cuts[i], to: cuts[i + 1], speed: speedAt(cuts[i] + 0.01), name: entry.name };
    const first = i === 0;
    // A push only on the first piece of a shot, and never while sped up.
    const moving = first && piece.speed === 1;
    shots.push({
      ...piece,
      z0: moving ? entry.z0 : entry.z1 ?? 1,
      z1: moving ? entry.z1 : entry.z1 ?? 1,
      cx: entry.cx ?? 0.5,
      cy: entry.cy ?? 0.5,
      xfadeIn: first ? entry.xfadeIn ?? 0 : 0,
    });
  }
});
if (!shots.length) throw new Error("No shots in markers.json - record with the current recorder.");
// Four seconds of the finished comparison, reused at the very front as a
// flash-forward. Nothing is staged for it: the grid it opens on is the one the
// take goes on to build. Marked as a duplicate so the narration, which is
// placed by where a moment first appears, is not dragged to the front with it.
if (markers.coldOpen) {
  shots.unshift({
    from: mark(markers.coldOpen.from), to: mark(markers.coldOpen.to),
    speed: 1, z0: 1.0, z1: 1.03, cx: 0.5, cy: 0.45, name: "cold-open", dup: true,
  });
  shots[1].xfadeIn = 0.5;
}
shots[0].xfadeIn = 0;

const { graph, length } = assembleXfade(shots);
const finalLength = length + TAIL;

// Where a moment in the recording lands in the finished cut. Walks the shots in
// order, so it accounts for the speed-ups and the dissolves together.
const toFinal = (rawTime) => {
  const point = mark(rawTime);
  let out = 0;
  for (const shot of shots) {
    out -= shot.xfadeIn ?? 0;
    // A reused stretch occupies time but is not where a moment belongs.
    if (shot.dup) { out += shotLength(shot); continue; }
    if (point >= shot.to) { out += shotLength(shot); continue; }
    if (point > shot.from) return Math.max(0, out + (point - shot.from) / shot.speed);
    return Math.max(0, out);
  }
  return Math.max(0, out);
};

// --------------------------------------------------------------------- sound
const voFile = join(dir, "vo.json");
const narration = existsSync(voFile) ? JSON.parse(readFileSync(voFile, "utf8")) : [];
const placed = narration
  .map((line) => ({ ...line, start: toFinal(line.at) + 0.12 }))
  .sort((a, b) => a.start - b.start);

// Every line is gain-matched to the same loudness before the bus, which removes
// the level swing between lines without a compressor pumping to do it.
for (const line of placed) {
  const { text } = ff(["-hide_banner", "-nostats", "-i", line.file, "-af", "ebur128", "-f", "null", "-"]);
  const summary = text.slice(text.lastIndexOf("Summary"));
  const measured = Number((/ {4}I: +(-?[0-9.]+)/.exec(summary) ?? [])[1]);
  line.gain = Number.isFinite(measured) ? VOICE_TARGET - measured : 0;
}

// Lines that would run into the next one. Nothing is time-stretched to fix it:
// the line is rewritten in voiceover.json instead, and this is the check.
const crowded = placed
  .map((line, index) => ({
    text: line.text,
    room: Number((((placed[index + 1]?.start ?? finalLength) - line.start) - line.seconds).toFixed(2)),
  }))
  .filter((line) => line.room < 0.3);

// Where the film's own moments land in the finished cut. Everything the score
// and the sound design hang on comes from here, so nothing is a hand-entered
// time that goes stale the next time the film is recorded.
const shotStart = (name) => {
  const found = shots.find((shot) => shot.name === name && !shot.dup);
  return found ? toFinal(found.from) : null;
};
const cues = {
  moneyShot: markers.moneyShot ? toFinal(markers.moneyShot.at) : finalLength * 0.72,
  lookupStart: markers.lookupStart !== undefined ? toFinal(markers.lookupStart) : null,
  lookupEnd: markers.lookupEnd !== undefined ? toFinal(markers.lookupEnd) : null,
  waitStart: markers.waitStart !== undefined ? toFinal(markers.waitStart) : null,
  waitEnd: markers.waitEnd !== undefined ? toFinal(markers.waitEnd) : null,
  operators: shotStart("operators"),
  send: shotStart("send-demo"),
  gridScroll: shotStart("grid-scroll"),
  selected: shotStart("selected"),
  endCard: shotStart("end"),
};

// Written here rather than at the end of the build, because the score is
// rendered in the middle of it and reads both files. Written at the end, a
// fresh take's first build scored itself against the previous take's cues.
// They are pure functions of what has already been computed, so nothing is
// lost by writing them early - and a render that fails no longer takes the
// cue list down with it.
writeFileSync(join(dir, "cues.json"), JSON.stringify({ length: Number(finalLength.toFixed(3)), ...cues }, null, 2));
writeFileSync(join(dir, "placed.json"), JSON.stringify(
  placed.map((line) => ({ index: line.index, start: Number(line.start.toFixed(3)), seconds: line.seconds, text: line.text })),
  null, 2));

const sfx = [];
if (useSfx) {
  const add = (time, name, gain) => { if (time !== null && time !== undefined) sfx.push([time, `${name}.wav`, gain]); };
  for (const time of markers.clicks ?? []) add(toFinal(time), "tick", -9);
  for (const shot of shots) if (shot.xfadeIn) add(Math.max(0, toFinal(shot.from) - 0.15), "whoosh", -12);
  // The country being typed, and the two places where data fills a card in.
  if (cues.lookupStart !== null) add(cues.lookupStart - 2.0, "type", -7);
  add(cues.lookupEnd, "populate", -10);
  add(cues.operators, "populate", -11);
  // Three requests leaving, then three replies landing, tuned A, C and E so the
  // arrivals spell out the chord the score is sitting on.
  if (cues.waitStart !== null) for (const [i, gap] of [-1.5, -0.95, -0.4].entries()) add(cues.waitStart + gap, "send", -11 + i * 0);
  // Only the last one. The score writes its own struck chord on the frame the
  // counter flips, and three bells in front of it is clutter; this one stays
  // for the low body the score has nothing like.
  add(cues.waitEnd, "arrive-3", -7);
  // The reveal's two-second rise is started early so its rise fills the
  // decrescendo into the money shot. Its hit is kept well down, because it
  // lands on the instant the score pulls back to almost nothing.
  add(cues.moneyShot - 2.0, "reveal", -16);
  add(cues.gridScroll, "scroll", -12);
  add(cues.selected, "confirm", -9);
  // Under the score's own cadence, not over it.
  add(cues.endCard, "seal", -15);
}
const sfxUsable = sfx
  .filter(([time, file]) => time >= 0 && time < finalLength - 0.3 && existsSync(join(assets, file)))
  .sort((a, b) => a[0] - b[0]);

// ------------------------------------------------------------------ assemble
const args = ["-y", "-i", raw];
const filters = [graph];
// The end card is held past the last shot so the closing line has room to
// finish. The previous cut ran 0.75s past the file and lost its last three
// words mid-syllable.
filters.push(`[out]tpad=stop_mode=clone:stop_duration=${TAIL}[vout]`);

let input = 1;
const voiceLabels = [];
for (const line of placed) {
  args.push("-i", line.file);
  filters.push(
    `[${input}:a]aresample=48000:resampler=soxr,aformat=channel_layouts=mono,` +
    `volume=${line.gain.toFixed(2)}dB,highpass=f=85,` +
    `equalizer=f=250:width_type=o:w=1.1:g=-2,` +
    `equalizer=f=3200:width_type=o:w=1.4:g=2,` +
    `adelay=${Math.round(line.start * 1000)}:all=1[v${input}]`,
  );
  voiceLabels.push(`[v${input}]`);
  input += 1;
}

const busParts = [];
if (voiceLabels.length) {
  filters.push(
    `${voiceLabels.join("")}amix=inputs=${voiceLabels.length}:normalize=0:dropout_transition=0,` +
    `acompressor=threshold=-20dB:ratio=2.5:attack=8:release=180:makeup=2,` +
    `deesser=i=0.35:m=0.5:f=0.25,aformat=channel_layouts=stereo[vox]`,
  );
  filters.push(music ? `[vox]asplit=2[voxout][keyraw]` : `[vox]anull[voxout]`);
  // sidechaincompress stops when its key stops, not when its input does, so
  // the music died the instant the last word ended and the film finished on a
  // second of digital silence. The key is padded to the full length instead.
  if (music) filters.push(`[keyraw]apad=whole_dur=${finalLength.toFixed(2)}[key]`);
  busParts.push("[voxout]");
}

if (music) {
  // The score is written to this film: its tempo is set so the money shot
  // falls on a downbeat, and its arc lifts where the operators are found and
  // drops almost to nothing where the comparison has to be read.
  const bed = join(dir, "score.wav");
  if (!existsSync(bed)) {
    execFileSync("node", ["videos/score.mjs", bed,
      `--cues=${join(dir, "cues.json")}`, `--lines=${join(dir, "placed.json")}`,
      `--money=${cues.moneyShot.toFixed(3)}`, `--len=${finalLength.toFixed(2)}`], { stdio: "inherit" });
  }
  args.push("-i", bed);
  // -10 rather than -19, and a gentler duck below: the score has 26 dB of
  // written dynamic range and no drums, so its average level is far lower
  // than its peak. At -19 with a 9:1 duck it measured 35.6 dB under the
  // voice, which is not quiet, it is absent. At -10 with 4:1 it sits 16 to
  // 20 dB under in the talky sections and still gets out of the way.
  filters.push(`[${input}:a]volume=-10dB,atrim=0:${finalLength.toFixed(2)},asetpts=N/SR/TB[bedraw]`);
  input += 1;
  if (voiceLabels.length) {
    // The bed gets out of the way under speech rather than sitting at a fixed
    // level underneath it.
    filters.push(`[bedraw][key]sidechaincompress=threshold=0.04:ratio=4:attack=20:release=320:makeup=1:level_sc=1[bedduck]`);
    busParts.push("[bedduck]");
  } else busParts.push("[bedraw]");
}

if (sfxUsable.length) {
  const labels = [];
  for (const [time, file, gain] of sfxUsable) {
    args.push("-i", join(assets, file));
    filters.push(`[${input}:a]volume=${gain}dB,adelay=${Math.round(time * 1000)}:all=1[e${input}]`);
    labels.push(`[e${input}]`);
    input += 1;
  }
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[sfxbus]`);
  busParts.push("[sfxbus]");
}

const hasAudio = busParts.length > 0;
if (hasAudio) {
  filters.push(
    `${busParts.join("")}${busParts.length > 1 ? `amix=inputs=${busParts.length}:normalize=0:dropout_transition=0,` : "anull,"}` +
    `atrim=0:${finalLength.toFixed(2)},asetpts=N/SR/TB,` +
    `afade=t=out:st=${(finalLength - 2.5).toFixed(2)}:d=2.5,` +
    `alimiter=limit=0.89:level=disabled:attack=5:release=60,` +
    `aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[premix]`,
  );
}

const silent = join(dir, "picture.mp4");
const premix = join(dir, "premix.wav");
// The graph runs to tens of thousands of characters, which is past what
// Windows will accept on a command line, so it goes in a file.
const graphFile = join(dir, "filtergraph.txt");
writeFileSync(graphFile, filters.join(";\n"));
args.push("-/filter_complex", graphFile, "-map", "[vout]");
args.push("-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
  "-x264-params", "keyint=60:min-keyint=30",
  "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
  "-t", finalLength.toFixed(2), silent);
if (hasAudio) args.push("-map", "[premix]", "-t", finalLength.toFixed(2), premix);
const render = ff(args);
if (render.code !== 0) {
  console.error(render.text.split("\n").slice(-25).join("\n"));
  throw new Error(`ffmpeg failed (${render.code})`);
}

let loudness = null;
if (hasAudio) {
  // Two passes: measure, then apply with the measured values. One pass is a
  // live ramp, and left the previous cut 3.2 LU under its own target.
  const { text } = ff(["-hide_banner", "-nostats", "-i", premix, "-af",
    "loudnorm=I=-14:TP=-1.5:LRA=9:print_format=json", "-f", "null", "-"]);
  const report = JSON.parse(text.slice(text.lastIndexOf("{"), text.lastIndexOf("}") + 1));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-i", premix,
    "-af", `loudnorm=I=-14:TP=-1.5:LRA=9:measured_I=${report.input_i}:measured_TP=${report.input_tp}:measured_LRA=${report.input_lra}:measured_thresh=${report.input_thresh}:offset=${report.target_offset}:linear=true,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", outFile], { stdio: "inherit" });
  const check = ff(["-hide_banner", "-nostats", "-i", outFile, "-af", "ebur128=peak=true", "-f", "null", "-"]).text;
  const summary = check.slice(check.lastIndexOf("Summary"));
  const read = (key) => Number((new RegExp(`${key}: +(-?[0-9.]+)`).exec(summary) ?? [])[1]);
  loudness = { integrated: read("I"), lra: read("LRA"), truePeak: read("Peak") };
  rmSync(premix, { force: true });
} else {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", silent, "-c", "copy", "-movflags", "+faststart", outFile], { stdio: "inherit" });
}
rmSync(silent, { force: true });

console.log(JSON.stringify({
  raw: Number(duration.toFixed(1)),
  final: Number(finalLength.toFixed(1)),
  shots: shots.length,
  spedUp: shots.filter((shot) => shot.speed > 1).length,
  pushes: shots.filter((shot) => shot.z0 !== shot.z1).length,
  narrationLines: placed.length,
  crowded,
  soundEvents: sfxUsable.length,
  loudness,
  outFile,
}, null, 2));
