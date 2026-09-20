// The camera. One take of the live product is cut into shots here, each with
// its own framing and its own slow push, and the shots are assembled into the
// finished picture.
//
// Two rules the filtergraph exists to satisfy. A push has to be evaluated per
// output frame, or it steps; and it has to be supersampled, or the crop jitters
// by a pixel. So: scale with eval=frame into a fixed crop, then one lanczos
// downscale. zoompan looks like the obvious tool and is not: it truncates its
// offsets to integers and visibly shudders on a slow move.
//
// The house rules, kept here because this is the file that enforces them:
//   One move per shot. A shot pushes or holds, never both.
//   Easing is always ease-out. The camera arrives and settles, never winds up.
//   A push runs 3.5 to 7 seconds, and travels 1.00 to 1.06, never past 1.10.
//   Every third shot is locked off.
//   Never push during a sped-up span: motion on top of speed reads as a glitch.
//   The last 0.8s of a shot is still, so the cut lands on a settled frame.

const SUPER_W = 2560, SUPER_H = 1440; // intermediate, 1.333x the delivery
const OUT_W = 1920, OUT_H = 1080, FPS = 30;

const eased = (from, to, dur) =>
  from === to ? `${from}` : `(${from}+(${to}-${from})*(1-pow(1-min(1,t/${dur.toFixed(3)}),3)))`;

/**
 * shot = { from, to, speed=1, z0=1, z1=1, cx=0.5, cy=0.5 }
 * from/to are seconds in raw.webm. cx/cy are the focal point, 0 to 1.
 */
export function shotFilter(shot, i) {
  const { from, to, speed = 1, z0 = 1, z1 = 1, cx = 0.5, cy = 0.5 } = shot;
  const dur = (to - from) / speed;
  const z = eased(z0.toFixed(4), z1.toFixed(4), dur);
  return [
    `[0:v]trim=start=${from.toFixed(3)}:end=${to.toFixed(3)}`,
    `setpts=(PTS-STARTPTS)/${speed}`,
    // Before the push, so the camera is evaluated at 30 distinct times even
    // though Playwright records at 25.
    `fps=${FPS}`,
    `scale=w='${SUPER_W}*${z}':h='${SUPER_H}*${z}':eval=frame:flags=bicubic`,
    `crop=${SUPER_W}:${SUPER_H}:x='(iw-${SUPER_W})*${cx}':y='(ih-${SUPER_H})*${cy}'`,
    `scale=${OUT_W}:${OUT_H}:flags=lanczos`,
    // xfade hands back its output on the default timebase, so every shot is
    // put on that same timebase or the second dissolve refuses to configure.
    `setsar=1,settb=AVTB[s${i}]`,
  ].join(",");
}

export const shotLength = (shot) => (shot.to - shot.from) / (shot.speed ?? 1);

/** Straight cuts throughout. */
export function assembleCuts(shots) {
  const parts = shots.map((shot, i) => shotFilter(shot, i));
  const ins = shots.map((_, i) => `[s${i}]`).join("");
  return {
    graph: [...parts, `${ins}concat=n=${shots.length}:v=1:a=0[out]`].join(";\n"),
    length: shots.reduce((total, shot) => total + shotLength(shot), 0),
  };
}

/**
 * Cuts by default; a dissolve only where a shot declares xfadeIn, in seconds.
 * A cut means "a moment later, somewhere else", which is true at almost every
 * boundary. A dissolve means "time passed", which is true at four of them.
 */
export function assembleXfade(shots) {
  const lines = shots.map((shot, i) => shotFilter(shot, i));
  let label = "s0";
  let clock = shotLength(shots[0]);
  for (let i = 1; i < shots.length; i += 1) {
    const fade = shots[i].xfadeIn ?? 0;
    const next = i === shots.length - 1 ? "out" : `x${i}`;
    if (fade > 0) {
      lines.push(`[${label}][s${i}]xfade=transition=fade:duration=${fade}:offset=${(clock - fade).toFixed(3)}[${next}]`);
      clock += shotLength(shots[i]) - fade;
    } else {
      lines.push(`[${label}][s${i}]concat=n=2:v=1:a=0[${next}]`);
      clock += shotLength(shots[i]);
    }
    label = next;
  }
  return { graph: lines.join(";\n"), length: clock };
}
