// Checks a proposed "words per line" rule against what actually happened in take5.
// Rule: maxWords = floor(2.1 * gapSeconds - 2.5)   (gap = seconds until the next caption)
import { readFileSync } from "node:fs";
const SRC = "C:/Users/bpiar/OneDrive/Documents/ChatGPT/Convex All Gas Hackathon/videos/take5";
const vo = JSON.parse(readFileSync(SRC + "/vo.json", "utf8"));
const starts = [2.44, 11.12, 15.30, 22.15, 28.22, 33.28, 40.26, 45.68, 54.34, 62.03,
  67.25, 74.88, 79.88, 91.72, 99.82, 104.39, 111.56, 119.12, 129.83, 138.77];
const FINAL = 144.65;
console.log("line  gap   words  allowed  verdict     actual tempo in take5");
let wrong = 0;
vo.forEach((l, i) => {
  const gap = (starts[i + 1] ?? FINAL) - starts[i];
  const w = l.text.split(/\s+/).length;
  const allowed = Math.floor(2.1 * gap - 2.5);
  const ruleSaysOk = w <= allowed;
  const actuallyFit = l.seconds <= gap - 0.25;        // what the builder checks
  if (ruleSaysOk !== actuallyFit) wrong++;
  console.log(`${String(i).padStart(3)} ${gap.toFixed(2).padStart(6)} ${String(w).padStart(6)} ${String(allowed).padStart(8)}   ` +
    `${(ruleSaysOk ? "rule: ok " : "rule: CUT").padEnd(11)} ${actuallyFit ? "fit at 1.00x" : "needed atempo"}`);
});
console.log(`\nrule disagrees with reality on ${wrong} of ${vo.length} lines`);
const rate = vo.reduce((a, l) => a + l.text.split(/\s+/).length, 0) / vo.reduce((a, l) => a + l.seconds, 0);
console.log(`measured sage delivery: ${(rate * 60).toFixed(0)} wpm = ${rate.toFixed(2)} words per second`);
