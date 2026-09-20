// "Incoming" - the score for the TripBrief demo film.
//
//   node videos/score.mjs out.wav --cues=videos/takeN/cues.json
//   node videos/score.mjs out.wav --money=115.263 --len=151.47     (fallback)
//
// D Dorian. Felt piano, bowed strings, harp, pizzicato bass and vibraphone,
// with the piano's sustain pedal modelled as a bank of undamped strings
// (videos/instruments.mjs). No drums: the film is warm cream, deep green and
// a serif, and it is making an argument, not an announcement.
//
// NOTHING IN THIS FILE IS A TIMESTAMP.
//
// The score reads videos/takeN/cues.json for the film's own moments and
// videos/takeN/placed.json for where every narration line landed, and then:
//
//   * searches for the tempo, in a band where this arrangement works, that
//     puts the most beats on the most cues. It reports what it found and how
//     far off each cue it is.
//   * changes chord once per narration line while somebody is speaking, and
//     every two beats while nobody is, so the harmonic rhythm follows the
//     film rather than a bar count.
//   * takes its dynamic arc from the named cues, so the lift lands where the
//     operators are found and the pull-back covers the money shot whatever
//     second they happen to fall on.
//
// The film has been re-recorded three times while this was being written.
// That is why.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeWav, SR, db, rms } from "./dsp.mjs";
import { add, stereoBuf, mixInto } from "./synth.mjs";
import {
  mtof, feltPiano, harp, pizzBass, bowedString, vibes, sympathetic, hall,
  biquad, applyBiquad, rndi, resetInstruments,
} from "./instruments.mjs";

// ------------------------------------------------------------------- inputs
const OUT = process.argv[2] ?? "score.wav";
const arg = (name, fallback) => {
  const found = process.argv.find((item) => item.startsWith(`--${name}=`));
  return found ? found.split("=")[1] : fallback;
};
const num = (name, fallback) => {
  const v = arg(name, null);
  return v === null ? fallback : Number(v);
};

const near = dirname(OUT);
const cuesPath = arg("cues", join(near, "cues.json"));
const linesPath = arg("lines", join(near, "placed.json"));

// cues.json is the contract. If it is not there yet - the very first build of
// a fresh take, before build-demo has written it - the score still renders
// from --money and --len, with the rest of the arc placed proportionally.
const haveCues = existsSync(cuesPath);
const file = haveCues ? JSON.parse(readFileSync(cuesPath, "utf8")) : {};
const LEN = Number((file.length ?? num("len", 151.47)).toFixed(3));
const cues = {
  moneyShot: file.moneyShot ?? num("money", LEN * 0.761),
  lookupStart: file.lookupStart ?? LEN * 0.241,
  lookupEnd: file.lookupEnd ?? LEN * 0.243,
  operators: file.operators ?? LEN * 0.296,
  send: file.send ?? LEN * 0.468,
  waitStart: file.waitStart ?? LEN * 0.542,
  waitEnd: file.waitEnd ?? LEN * 0.592,
  gridScroll: file.gridScroll ?? LEN * 0.819,
  selected: file.selected ?? LEN * 0.886,
  endCard: file.endCard ?? LEN * 0.935,
};

// placed.json gives every spoken line's start and length. The score needs it
// for two things it cannot guess: where the harmony is allowed to move, and
// where the last words are, so it can be finished before them.
const lines = existsSync(linesPath)
  ? JSON.parse(readFileSync(linesPath, "utf8"))
    .map((l) => ({ start: l.start, end: l.start + l.seconds }))
    .sort((a, b) => a.start - b.start)
  : [];
const hasLines = lines.length > 2;
const firstVoice = hasLines ? lines[0].start : 3.5;
const lastVoice = hasLines ? lines.at(-1) : { start: cues.endCard, end: LEN - 2.5 };
const linesIn = (a, b) => lines.filter((l) => l.start >= a - 0.25 && l.start < b - 0.25);
const lastLineBefore = (t) => lines.filter((l) => l.start < t).at(-1) ?? { start: t - 3.3, end: t };

// =============================================================== THE TEMPO ==
// Searched, not chosen. Every cue the film reports, plus every line start at a
// lower weight, against every tempo in the band this arrangement sits in; the
// winner is the one with the least weighted distance from a cue to a beat.
//
// The other way to do this is to derive one beat length from one cue - which
// guarantees that cue and leaves the other twenty wherever they fall.
const WEIGHTED = [
  [cues.operators, 4], [cues.waitEnd, 4], [cues.moneyShot, 4], [cues.endCard, 4],
  [cues.waitStart, 3], [cues.selected, 3],
  [cues.lookupEnd, 2], [cues.send, 2], [cues.gridScroll, 2], [firstVoice, 2],
  ...lines.map((l) => [l.start, 1]),
].filter(([t]) => Number.isFinite(t) && t > 0);

let best = null;
for (let bpm = 62; bpm <= 72.0001; bpm += 0.05) {
  const beat = 60 / bpm;
  let sum = 0, weight = 0;
  for (const [t, w] of WEIGHTED) {
    const d = Math.abs(t / beat - Math.round(t / beat)) * beat;
    sum += w * d; weight += w;
  }
  const score = sum / weight;
  if (!best || score < best.score) best = { bpm: Number(bpm.toFixed(2)), beat, score };
}
const BPM = best.bpm;
const BEAT = best.beat;
const BAR = BEAT * 4;
/** seconds -> the nearest beat, in seconds. Chord changes land here. */
const snap = (t) => Math.round(t / BEAT) * BEAT;
const beatsBetween = (a, b) => Math.max(0, Math.round((b - a) / BEAT));

resetInstruments();

// ============================================================== THE HARMONY ==
// D Dorian: D E F G A B C. The one harmonic idea is that the mode's major IV -
// G, with a B natural sounding against a D minor tonic - is withheld until the
// operators are found, spent on that cut, and spent once more at the top of
// the build. Nothing else in the piece is brighter.
const P = { A1: 33, C2: 36, D2: 38, E2: 40, F2: 41, G2: 43, A2: 45, C3: 48, D3: 50, E3: 52, F3: 53, G3: 55, A3: 57, B3: 59, C4: 60, D4: 62, E4: 64, F4: 65, G4: 67, A4: 69, B4: 71, C5: 72, D5: 74, E5: 76, F5: 77, G5: 79, A5: 81, B5: 83, D6: 86 };

// Voicings follow a rule that came out of measuring the narration, not out of
// taste: this voice puts 42% of its energy in 160-320 Hz and 27% in 320-640,
// so the strings keep their root below 135 Hz and their colour tones above
// 290 Hz and leave the tenth in between to the speaker. An open voicing with
// a hole in the middle. The exception is the build, where nobody is talking
// and the strings close up into the midrange and take their weight back.
const CH = {
  Dm9:    [P.D2, P.A2, P.D4, P.F4, P.A4],
  Dm:     [P.D2, P.A2, P.D4],
  Am7:    [P.A2, P.E4, P.G4, P.C5],
  Cmaj9:  [P.C3, P.E4, P.G4, P.B4],
  Cmaj9b: [P.C3, P.E4, P.G4, P.B4, P.D5],
  Fmaj9:  [P.F2, P.C3, P.E4, P.A4, P.C5],
  Fmaj9b: [P.F2, P.C3, P.A4, P.C5, P.E5],
  G69:    [P.G2, P.D3, P.D4, P.B4, P.E5],
  // closed voicings, for the build only
  cAm7:   [P.A2, P.E3, P.G3, P.C4],
  cEm7:   [P.E3, P.B3, P.D4, P.G4],
  cDm9:   [P.D3, P.A3, P.C4, P.E4],
  cG69:   [P.G2, P.D3, P.B3, P.E4],
  cCmaj9: [P.C3, P.G3, P.E4, P.B4],
  // filled out again for the end card, where the last words are already past
  eCmaj9: [P.C3, P.G3, P.E4, P.G4, P.B4],
  eFmaj9: [P.F2, P.C3, P.A3, P.E4, P.A4],
  eDm9:   [P.D2, P.A2, P.D3, P.F3, P.A3],
};
// what the harp runs through, per chord
const ARP = {
  Dm9: [P.D4, P.F4, P.A4, P.C5, P.E5], Am7: [P.A3, P.C4, P.E4, P.G4, P.A4, P.C5, P.E5],
  Cmaj9: [P.C4, P.E4, P.G4, P.B4, P.D5, P.E5], Cmaj9b: [P.C4, P.E4, P.G4, P.B4, P.D5],
  Fmaj9: [P.F3, P.A3, P.C4, P.E4, P.G4, P.A4], Fmaj9b: [P.F3, P.A3, P.C4, P.E4, P.A4],
  G69: [P.G3, P.B3, P.D4, P.E4, P.A4, P.B4, P.D5], Dm: [P.D4, P.F4, P.A4, P.C5],
  cAm7: [P.A3, P.C4, P.E4, P.G4, P.A4], cEm7: [P.B3, P.D4, P.E4, P.G4, P.B4],
  cDm9: [P.A3, P.C4, P.D4, P.F4, P.A4], cG69: [P.B3, P.D4, P.E4, P.G4, P.B4],
  cCmaj9: [P.C4, P.E4, P.G4, P.B4, P.D5],
};
const ROOT = { Dm9: P.D2, Dm: P.D2, Am7: P.A1, Cmaj9: P.C2, Cmaj9b: P.C2, Fmaj9: P.F2, Fmaj9b: P.F2, G69: P.G2, cAm7: P.A1, cEm7: P.E2, cDm9: P.D2, cG69: P.G2, cCmaj9: P.C2 };

// The three-note theme: A, C, D. Stated alone under the title, reharmonised
// over Cmaj9 among the operators, brought back when the trip is picked, and
// played in octaves on the end card.
const THEME = [P.A4, P.C5, P.D5];

// ================================================================ THE PLAN ==
// Sections are spans between named cues, never between timestamps. Each one
// says how loud it is, what is playing, and which chords the lines inside it
// get. This is the whole score; everything below just renders it.
const LIFT_BARS = 2;
const plan = [];
const push = (name, from, to, opts) => { if (to > from + 0.15) plan.push({ name, from, to, ...opts }); };

// A flash-forward: the film opens on the finished comparison for four seconds
// before the title. The music opens the same way - the last two notes of the
// theme, out of context, over the chord the piece will end on - and then the
// title card starts the piece properly.
const hasColdOpen = firstVoice > 2.5;
if (hasColdOpen) push("coldOpen", 0, firstVoice, { level: -6.5, chords: ["Dm9"], texture: "fragment" });

// The lines before the country is looked up: the title, the form being filled
// in, and then the one that starts the typing. Taken by position within that
// span rather than by index, because a line was inserted into the middle of
// the film between two takes and indices from the front are only safe until
// somebody does that at the front.
const briefLines = linesIn(firstVoice, cues.lookupStart);
const typingLine = briefLines.length > 2 ? briefLines.at(-1).start : cues.lookupStart - BAR * 2;
push("title", firstVoice, briefLines[1]?.start ?? typingLine,
  { level: -10.5, chords: ["Dm"], texture: "solo" });
// The dullest picture in the film gets the stillest music: the harmony barely
// moves while the form is filled in, and the piano plays four notes.
push("brief", briefLines[1]?.start ?? typingLine, typingLine,
  { level: -9, chords: ["Dm9", "Dm9", "Am7"], texture: "still" });
push("typing", typingLine, cues.lookupEnd, { level: -8.5, chords: ["Cmaj9"], texture: "typing" });
push("place", cues.lookupEnd, cues.operators, { level: -7.5, chords: ["Fmaj9"], texture: "warm" });
// The lift. Everything the first forty seconds has been holding back.
push("LIFT", cues.operators, cues.operators + LIFT_BARS * BAR,
  { level: -4, chords: ["G69"], texture: "lift" });
push("list", cues.operators + LIFT_BARS * BAR, cues.send,
  { level: -6.5, chords: ["Am7", "Cmaj9b", "Dm9", "Fmaj9"], texture: "arp" });
const pulseFrom = lastLineBefore(cues.waitStart).start;
push("demo", cues.send, pulseFrom, { level: -8.5, chords: ["Cmaj9", "Am7"], texture: "calm" });
// A pulse, for the first time in the film: from here the music is on its own.
push("pulse", pulseFrom, cues.waitStart, { level: -7.5, chords: ["cAm7"], texture: "pulse" });
push("BUILD", cues.waitStart, cues.waitEnd, { level: -2.5, chords: null, texture: "build" });
push("land", cues.waitEnd, linesIn(cues.waitEnd, cues.moneyShot)[1]?.start ?? cues.moneyShot,
  { level: -8.5, chords: ["Fmaj9b"], texture: "exhale" });
push("replies", linesIn(cues.waitEnd, cues.moneyShot)[1]?.start ?? cues.moneyShot, cues.moneyShot,
  { level: -10, chords: ["Fmaj9b", "Dm9", "Dm"], texture: "thin" });
// The argument of the film is made here and the voice has to own it, so the
// score does the hardest thing it can, which is very nearly stop.
push("MONEY", cues.moneyShot, cues.selected, { level: -12, chords: null, texture: "money" });
push("return", cues.selected, cues.endCard, { level: -11, chords: ["Dm9", "Cmaj9b"], texture: "theme" });
push("end", cues.endCard, LEN, { level: -3.5, chords: null, texture: "end" });

const sectionAt = (t) => plan.find((s) => t >= s.from && t < s.to) ?? plan.at(-1);

// ------------------------------------------------ chords, one per spoken line
// While someone is speaking the harmony changes on their line, snapped to the
// nearest beat. A section with more lines than chords cycles; a section with
// no lines in it gets one chord at its own start.
const changes = [];
for (const sec of plan) {
  if (!sec.chords) continue;
  const inside = linesIn(sec.from, sec.to);
  const anchors = (inside.length ? [sec.from, ...inside.map((l) => l.start)] : [sec.from]).sort((a, b) => a - b);
  // drop an anchor that is within half a bar of the previous one
  const kept = [];
  for (const a of anchors) if (!kept.length || a - kept.at(-1) > BAR * 0.5) kept.push(a);
  // A long section with fewer lines than chords would otherwise sit on one
  // chord for twenty seconds. Split its widest gap on a bar line until the
  // progression has somewhere to go, but never closer than two bars apart.
  while (kept.length < sec.chords.length) {
    let widest = -1, gap = 0;
    for (let i = 0; i < kept.length; i += 1) {
      const g = (kept[i + 1] ?? sec.to) - kept[i];
      if (g > gap) { gap = g; widest = i; }
    }
    if (gap < BAR * 2) break;
    kept.splice(widest + 1, 0, kept[widest] + Math.round(gap / 2 / BAR) * BAR);
  }
  kept.forEach((a, i) => changes.push({ at: snap(a), chord: sec.chords[i % sec.chords.length], sec }));
}
changes.sort((a, b) => a.at - b.at);

// ===================================================================== BUSES ==
const pianoBus = stereoBuf(LEN + 2), harpBus = stereoBuf(LEN + 2), bowBus = stereoBuf(LEN + 2);
const bassBus = stereoBuf(LEN + 2), bellBus = stereoBuf(LEN + 2);
const S = (t) => Math.round(t * SR);

// Struck notes are nudged off the grid and off each other's dynamics. A player
// lands near the beat, slightly late, and never repeats a velocity exactly.
const humanT = (t) => t + (rndi() - 0.35) * 0.044;
const humanV = (v) => v * (1 + (rndi() - 0.5) * 0.18);
const keyNote = (t, midi, vel, pan = 0) => add(pianoBus, feltPiano(midi, humanV(vel)), S(humanT(t)), 1, pan);
const roll = (t, midis, vel, spread = 0.024) => midis.forEach((m, i) =>
  add(pianoBus, feltPiano(m, vel * (0.82 + 0.30 * (i / Math.max(1, midis.length - 1)))),
    S(t + i * spread + (rndi() - 0.5) * 0.010), 1, (i - midis.length / 2) * 0.05));
const pluckNote = (t, midi, vel, pan) => add(harpBus, harp(midi, vel), S(t + (rndi() - 0.5) * 0.008), 1, pan);
const bassNote = (t, midi, vel) => add(bassBus, pizzBass(midi, humanV(vel)), S(humanT(t)), 1, 0);
const bellNote = (t, midi, vel, pan) => add(bellBus, vibes(midi, vel), S(t), 1, pan);

/** One chord of bowed strings: two players per voice, a few cents apart. */
const pad = (t, dur, midis, amp, attack) => midis.forEach((m, i) => {
  const wide = ((i / Math.max(1, midis.length - 1)) * 1.5 - 0.75) * 0.72;
  for (const [cents, side] of [[-3.6, -0.13], [3.1, 0.13]]) {
    add(bowBus, bowedString(m + cents / 100, dur, amp * (m < 48 ? 1.10 : 0.92) / Math.SQRT2, {
      attack: attack + i * 0.12, release: 2.2, swell: 0.10,
      vib: m < 46 ? 0.0018 : 0.0032, vibHz: 4.42 + (rndi() - 0.5) * 0.9,
      partials: m < 46 ? 36 : 26,
    }), S(t), 1, wide + side);
  }
});

const arpRun = (from, to, midis, perBeat, vel) => {
  const seq = [...midis, ...midis.slice(1, -1).reverse()];
  let i = 0;
  for (let t = from; t < to - 1e-6; t += BEAT / perBeat) {
    const onBeat = Math.abs(t / BEAT - Math.round(t / BEAT)) < 1e-3;
    pluckNote(t, seq[i % seq.length], vel * (onBeat ? 1.2 : 1) * (0.9 + rndi() * 0.16),
      0.22 + ((i % 3) - 1) * 0.10);
    i += 1;
  }
};

// ============================================================== THE WRITING ==
// The pad follows the chord changes, each holding into the next so the strings
// never stop. The first draft of this score left five holes at section joins
// where one chord had released before the next had spoken, and they were the
// loudest thing in it.
const OVERLAP = BEAT * 1.4;
changes.forEach((c, i) => {
  // A chord holds until the next one has spoken, but never past the end of
  // its own section: the section after "thin" is the money shot, and a pad
  // bleeding sixteen seconds into that would undo the one decision the score
  // is built around.
  const next = Math.min(changes[i + 1]?.at ?? Infinity, c.sec.to);
  const attack = { lift: 0.55, build: 0.5, pulse: 0.6, end: 0.35, typing: 1.6, still: 2.4, solo: 3.2 }[c.sec.texture] ?? 1.2;
  pad(c.at, Math.min(next + OVERLAP, c.at + 16) - c.at, CH[c.chord], 0.055, attack);
});

for (const sec of plan) {
  const inside = changes.filter((c) => c.at >= sec.from - 0.3 && c.at < sec.to);
  const first = inside[0];
  const bars = (sec.to - sec.from) / BAR;

  if (sec.texture === "fragment") {
    // the last two notes of the theme, out of context
    keyNote(sec.from + BEAT * 0.6, THEME[1], 0.17, 0.12);
    keyNote(sec.from + BEAT * 2.0, THEME[2], 0.20, 0.02);
    bellNote(sec.from + BEAT * 2.0, THEME[2] + 12, 0.08, 0.25);
  }

  if (sec.texture === "solo") {
    // the theme, stated once, alone, so it can be recognised three more times
    roll(sec.from + BEAT * 0.5, [P.D3, P.A3], 0.19);
    THEME.forEach((m, i) => keyNote(sec.from + BEAT * (2.0 + i * 1.8), m, [0.23, 0.21, 0.26][i], [0.10, 0.16, 0.05][i]));
    keyNote(sec.from + BEAT * 7.4, P.F4, 0.15, -0.12);
    keyNote(sec.from + BEAT * 9.6, P.E4, 0.14, 0);
  }

  if (sec.texture === "still") {
    for (const c of inside) {
      roll(c.at, CH[c.chord].slice(0, 2), 0.16, 0.05);
      keyNote(c.at + BAR * 1.0, CH[c.chord].at(-1), 0.14, 0.08);
    }
  }

  if (sec.texture === "typing") {
    // the first rhythm in the piece, and deliberately an uneven one
    const pattern = [0, 0.5, 1, 2, 2.5, 3, 3.33, 4, 4.5, 5, 6, 6.5];
    for (const [i, b] of pattern.entries()) {
      const t = sec.from + b * BEAT;
      if (t > sec.to + BAR) break;
      keyNote(t, i % 3 === 2 ? P.E4 : P.G4, 0.095 + (i % 4) * 0.012, 0.25);
    }
  }

  if (sec.texture === "warm") {
    // first warmth, and the piano climbs for the first time
    [P.F4, P.A4, P.C5, P.E5].forEach((m, i) => keyNote(sec.from + i * BAR * 0.55, m, 0.20 + i * 0.005, -0.10 + i * 0.09));
    // a harp note plants the instrument, so the arpeggio at the lift is not new
    pluckNote(sec.from + BAR * 1.2, P.C5, 0.17, 0.30);
    pluckNote(sec.from + BAR * 1.75, P.A4, 0.16, 0.30);
  }

  if (sec.texture === "lift") {
    roll(sec.from, [P.G3, P.B3, P.D4, P.E4, P.A4], 0.42, 0.020);
    arpRun(sec.from, sec.to, ARP.G69, 2, 0.28);
    keyNote(sec.from + BAR * 0.5, P.B4, 0.30, 0.20);
    bellNote(sec.from, P.B5, 0.13, 0.30);
  }

  if (sec.texture === "arp") {
    // the lift settles rather than climbing further
    inside.forEach((c, i) => {
      const next = inside[i + 1]?.at ?? sec.to;
      arpRun(c.at, Math.min(next, c.at + BAR * 2.6), ARP[c.chord] ?? ARP.Am7, 2, 0.19 - i * 0.012);
      if (i === 1) THEME.forEach((m, k) => keyNote(c.at + k * BEAT * 1.5, m, [0.24, 0.22, 0.26][k], k * 0.06));
      else keyNote(c.at, CH[c.chord][2], 0.20, -0.12 + i * 0.08);
    });
  }

  if (sec.texture === "calm") {
    inside.forEach((c, i) => {
      keyNote(c.at, CH[c.chord].at(-1), 0.17, 0.12 - i * 0.14);
      keyNote(c.at + BAR * 0.9, CH[c.chord][2], 0.14, -0.05);
    });
    bassNote(sec.from + BAR * 0.8, P.D2, 0.20);
  }

  if (sec.texture === "pulse") {
    const n = Math.max(2, beatsBetween(sec.from, sec.to));
    for (let b = 0; b < n; b += 1) bassNote(sec.from + b * BEAT, b === 2 ? P.E2 : P.A1, 0.26);
    THEME.forEach((m, i) => keyNote(sec.from + i * BEAT * 1.3, m - 12, [0.20, 0.19, 0.21][i], -0.10 + i * 0.05));
    arpRun(Math.max(sec.from, sec.to - BEAT * 2), sec.to, ARP.cAm7, 2, 0.15);
  }

  if (sec.texture === "build") {
    // The one stretch with no narration over it, and the one dead hole in the
    // picture: the wait, at six times speed. The harmonic rhythm doubles to a
    // chord every two beats, the bass climbs, and the harp subdivides 2 -> 3
    // -> 4 without the tempo moving, which tightens without hurrying. It ends
    // on Cmaj9 however many chords fit, so the landing always resolves.
    const SEQ = ["cAm7", "cEm7", "cDm9", "cG69", "cCmaj9"];
    const RATE = [2, 2, 3, 4, 4];
    const slots = Math.max(2, Math.min(SEQ.length, Math.floor(beatsBetween(sec.from, sec.to) / 2)));
    const seq = SEQ.slice(SEQ.length - slots), rate = RATE.slice(RATE.length - slots);
    const step = (sec.to - sec.from) / slots;
    seq.forEach((name, i) => {
      const t = snap(sec.from + i * step), tEnd = i + 1 < slots ? snap(sec.from + (i + 1) * step) : sec.to;
      pad(t, tEnd - t + BEAT * 1.4, CH[name], 0.058 + i * 0.010, 0.5);
      arpRun(t, tEnd, ARP[name], rate[i], 0.16 + i * 0.037);
      for (let b = t; b < tEnd - 1e-6; b += BEAT) bassNote(b, ROOT[name], 0.26 + i * 0.026);
      keyNote(t, ARP[name].at(-1), 0.19 + i * 0.030, ((i % 3) - 1) * 0.16);
    });
  }

  if (sec.texture === "exhale") {
    // The one accent in the score that is not on the beat grid: it is on the
    // frame the counter reaches 3 of 3. Everything that has been running for
    // the last eight seconds stops on it. The release is the point, not the
    // hit.
    [P.C5, P.E5, P.G5, P.B5, P.D6].forEach((m, i) =>
      bellNote(cues.waitEnd + i * 0.016, m, 0.34 - i * 0.024, (i - 2) * 0.18));
    bellNote(cues.waitEnd + 0.30, P.C4, 0.17, 0);
    if (first) roll(first.at, [P.F3, P.C4, P.E4], 0.20, 0.05);
    keyNote(sec.from + BAR * 1.1, P.A4, 0.16, 0.10);
    keyNote(sec.from + BAR * 2.0, P.F4, 0.13, -0.10);
  }

  if (sec.texture === "thin") {
    // three replies, three notes, and then a long decrescendo that is really a
    // ramp into the silence of the money shot
    [P.A5, P.F5, P.C5].forEach((m, i) => bellNote(sec.from + i * BAR * 0.62, m, 0.15 - i * 0.008, -0.3 + i * 0.3));
    inside.forEach((c, i) => keyNote(c.at, [P.D4, P.A3, P.F3][i % 3], 0.15 - i * 0.03, -0.05 + i * 0.07));
  }

  if (sec.texture === "money") {
    // A bare bowed fifth, D and A, and eighteen seconds with two events in
    // them. At two thirds an E is added, so the chord becomes a Dm(add9) and
    // still has no third; near the end that E moves up to F, which is the
    // third arriving just in time to make the return sound prepared rather
    // than sudden. No piano, no harp, no bell, no bass.
    const span = sec.to - sec.from;
    add(bowBus, bowedString(P.D2, span, 0.029, { attack: 3.2, release: 3.0, swell: 0.17, vib: 0.0014, partials: 30 }), S(sec.from), 1, -0.25);
    add(bowBus, bowedString(P.A4, span, 0.0158, { attack: 3.8, release: 3.0, swell: 0.19, vib: 0.0022, partials: 22 }), S(sec.from), 1, 0.25);
    const addE = sec.from + span * 0.48, toF = sec.to - BAR * 1.6;
    add(bowBus, bowedString(P.E5, toF - addE, 0.0095, { attack: 4.2, release: 2.4, swell: 0.15, partials: 18 }), S(addE), 1, 0.05);
    add(bowBus, bowedString(P.F5, sec.to - toF + BAR, 0.0114, { attack: 1.5, release: 2.0, partials: 18 }), S(toF), 1, 0.05);
  }

  if (sec.texture === "theme") {
    // the theme returns, in the register it was first played in
    THEME.forEach((m, i) => keyNote(sec.from + i * BEAT * 1.5, m, [0.235, 0.215, 0.255][i], [0.05, 0.12, 0][i]));
    arpRun(sec.from + BAR * 0.6, Math.min(sec.to, sec.from + BAR * 1.6), ARP.Dm9, 2, 0.105);
    const last = inside.at(-1);
    if (last && last.at > sec.from + BAR) {
      // the only crescendo in the last third, so the end card has something to
      // resolve
      [P.E5, P.D5, P.B4].forEach((m, i) => keyNote(last.at + i * BEAT * 1.2, m, [0.26, 0.24, 0.26][i], 0.15 - i * 0.12));
    }
  }

  if (sec.texture === "end") {
    // Cmaj9 -> Fmaj9 -> Dm9: a plagal descent that arrives without
    // congratulating anybody, with the theme in octaves over the Fmaj9.
    const t0 = snap(sec.from);
    const steps = [["eCmaj9", 0], ["eFmaj9", BAR * 0.42], ["eDm9", BAR * 0.84]];
    for (const [name, off] of steps) pad(t0 + off, BAR * 1.6, CH[name], 0.070, 0.35);
    roll(t0, [P.C3, P.G3, P.C4, P.E4, P.G4, P.B4], 0.42, 0.022);
    roll(t0 + BAR * 0.42, [P.F2, P.C3, P.E3, P.A3, P.C4], 0.38, 0.022);
    keyNote(t0 + BAR * 0.55, P.A4, 0.31, -0.06);
    keyNote(t0 + BAR * 0.55, P.A5, 0.23, 0.14);
    roll(t0 + BAR * 0.84, [P.D2, P.D3, P.A3, P.C4, P.E4, P.F4], 0.44, 0.024);
    keyNote(t0 + BAR * 0.84 + 0.16, P.D5, 0.27, 0.05);
    bellNote(t0 + BAR * 0.84, P.D5, 0.15, 0.20);
  }
}

// ================================================================== THE ARC ==
// Macro dynamics live here rather than in sixty note velocities, so re-timing
// the score to a new cut does not mean re-balancing it by hand. One bar to
// move between levels, so the film never hears a step.
function arcGain(t) {
  const sec = sectionAt(t);
  const i = plan.indexOf(sec);
  const prev = plan[Math.max(0, i - 1)];
  const into = t - sec.from;
  const levelDb = into < BAR && prev !== sec
    ? prev.level + (sec.level - prev.level) * (into / BAR)
    : sec.level;
  return Math.pow(10, levelDb / 20);
}

// ================================================================== THE MIX ==
const n = Math.round(LEN * SR);
// The pedal. Every struck note - piano and harp alike - drives a bank of
// undamped diatonic strings, which is what a sustain pedal physically is.
// This is the difference between a piano and a row of one-shots.
const PEDAL = [P.D2, P.A2, P.D3, P.F3, P.A3, P.C4, P.D4, P.E4, P.F4, P.G4, P.A4, P.B4, P.C5, P.D5, P.E5, P.F5, P.A5];
const struckL = new Float32Array(n), struckR = new Float32Array(n);
for (let i = 0; i < n; i += 1) {
  struckL[i] = pianoBus[0][i] + harpBus[0][i] * 0.55;
  struckR[i] = pianoBus[1][i] + harpBus[1][i] * 0.55;
}
const halo = sympathetic(
  Float32Array.from({ length: n }, (_, i) => (struckL[i] + struckR[i]) * 0.5),
  PEDAL, { coupling: 0.075, rt60: 2.8, damp: 2600, spread: 0.04 },
);

const dry = stereoBuf(LEN);
mixInto(dry, pianoBus, 1.0);
mixInto(dry, harpBus, 1.0);
mixInto(dry, bowBus, 1.0);
mixInto(dry, bassBus, 1.0);
mixInto(dry, bellBus, 1.0);
for (let i = 0; i < n; i += 1) { dry[0][i] += halo[i] * 0.85; dry[1][i] += halo[i] * 0.78; }

// the arc, applied before the room so the room follows the dynamics
for (let i = 0; i < n; i += 1) { const g = arcGain(i / SR); dry[0][i] *= g; dry[1][i] *= g; }

// Different sends per instrument: the bass stays dry and centred, the bell and
// the pad are mostly room.
const wet = stereoBuf(LEN);
const sendTo = (buf, amt) => { for (let c = 0; c < 2; c += 1) for (let i = 0; i < n; i += 1) wet[c][i] += buf[c][i] * amt * arcGain(i / SR); };
sendTo(pianoBus, 0.34); sendTo(harpBus, 0.40); sendTo(bowBus, 0.44); sendTo(bellBus, 0.56); sendTo(bassBus, 0.22);
const [rvL, rvR] = hall(wet[0], wet[1], { rt60: 3.1, damp: 4600, preDelay: 0.030, width: 1.15 });
for (let i = 0; i < n; i += 1) { dry[0][i] += rvL[i]; dry[1][i] += rvR[i]; }

// A trace of room tone, so the quiet stretches are a room and not a file.
for (let i = 0; i < n; i += 1) {
  const g = 0.00075 * (0.7 + 0.3 * Math.sin(2 * Math.PI * i / SR / 23));
  const a = rndi() * 2 - 1, b = rndi() * 2 - 1;
  dry[0][i] += a * g; dry[1][i] += b * g;
}

// The voice pocket is cut here rather than left to the mix.
for (let c = 0; c < 2; c += 1) {
  applyBiquad(dry[c], biquad("hp", 44, 0.7));
  applyBiquad(dry[c], biquad("lowshelf", 115, 0.8, 1.0));
  applyBiquad(dry[c], biquad("peak", 240, 0.75, -3.4));    // the voice's fundamentals
  applyBiquad(dry[c], biquad("peak", 480, 0.9, -1.8));     // its first formant
  applyBiquad(dry[c], biquad("peak", 2450, 0.9, -2.4));    // its consonants
  applyBiquad(dry[c], biquad("highshelf", 6500, 0.7, 1.6));
}

// The last chord rings and is then taken off, so the closing words are clean.
// This is a written decay, not a fade under the voice: the score is finished
// before the film's last clause instead of ducking beneath it.
const silentBy = Math.min(LEN - 0.3, lastVoice.end - 2.4);
const fadeFrom = Math.max(cues.endCard + BAR * 1.1, silentBy - 1.8);
for (let i = 0; i < n; i += 1) {
  const t = i / SR;
  let g = 1;
  if (t < 0.25) g *= t / 0.25;
  if (t > fadeFrom) g *= t >= silentBy ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (t - fadeFrom) / (silentBy - fadeFrom));
  dry[0][i] *= g; dry[1][i] *= g;
}

// A fixed output gain, not peak normalisation: with a normaliser, quietening
// one section makes every other section louder and balancing two cues against
// each other becomes circular. The mix sets the final level anyway.
// Drive into a soft saturator and let it round off the peaks, rather than
// normalising to them: a struck six-note chord puts a 3 ms transient 10 dB
// over anything else in the piece, and dividing the whole score by it throws
// away the level everywhere else. Below about a third of full scale this is
// linear, so the quiet two thirds of the film are untouched.
const MASTER = 2.57, CEILING = 0.85;
let peak = 0;
for (let c = 0; c < 2; c += 1) for (let i = 0; i < n; i += 1) {
  dry[c][i] = CEILING * Math.tanh(dry[c][i] * MASTER / CEILING);
  peak = Math.max(peak, Math.abs(dry[c][i]));
}
if (peak > 0.9) console.error(`WARNING: peak ${peak.toFixed(3)} - lower MASTER in videos/score.mjs`);

writeWav(OUT, dry, SR);

// ================================================================== REPORT ==
const mono = Float32Array.from(dry[0], (v, i) => (v + dry[1][i]) / 2);
console.log(`${OUT}  ${LEN.toFixed(2)}s  ${BPM} BPM  D Dorian  ${changes.length} chord changes  peak ${db(peak).toFixed(1)} dBFS`);
console.log(`cues: ${haveCues ? cuesPath : "NOT FOUND - fell back to --money/--len"}` +
  `   lines: ${hasLines ? `${lines.length} from ${linesPath}` : "none"}`);

console.log("\nthe arc (section, span, relative level written, level measured):");
for (const s of plan) {
  const a = Math.round(s.from * SR), b = Math.min(n, Math.round(s.to * SR));
  console.log(`  ${s.name.padEnd(9)} ${s.from.toFixed(1).padStart(6)} - ${s.to.toFixed(1).padStart(6)}s ` +
    `${String(s.level).padStart(6)} dB  ${db(rms(mono, a, b)).toFixed(1).padStart(6)} dB RMS`);
}

console.log("\nhow close each cue lands to a beat:");
const report = [["operators (the lift)", cues.operators], ["waitStart (speed-up)", cues.waitStart],
  ["waitEnd (replies land)", cues.waitEnd], ["moneyShot", cues.moneyShot],
  ["selected", cues.selected], ["endCard", cues.endCard]];
let worst = 0;
for (const [name, t] of report) {
  const d = snap(t) - t;
  worst = Math.max(worst, Math.abs(d));
  console.log(`  ${name.padEnd(24)} ${t.toFixed(3).padStart(8)}s  beat at ${snap(t).toFixed(3)}s  off by ${(d * 1000).toFixed(0).padStart(5)} ms`);
}
const allDrift = WEIGHTED.map(([t]) => Math.abs(snap(t) - t));
console.log(`  worst of the six: ${(worst * 1000).toFixed(0)} ms;  mean over all ${allDrift.length} cues and lines: ` +
  `${(allDrift.reduce((a, b) => a + b, 0) / allDrift.length * 1000).toFixed(0)} ms`);
console.log(`\nmusic stops at ${silentBy.toFixed(2)}s; the last words end at ${lastVoice.end.toFixed(2)}s ` +
  `(${(lastVoice.end - silentBy).toFixed(2)}s of unaccompanied voice)`);
