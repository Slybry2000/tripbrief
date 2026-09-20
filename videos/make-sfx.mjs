// Four sound-design elements, synthesised with ffmpeg only, tuned to the bed's
// key (A minor) so they never clash with it.
import { spawnSync } from "node:child_process";
const sh = (name, args) => {
  const r = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) console.log(name, "FAILED\n", r.stderr);
  return r.status === 0;
};

// 1. tick - a click landing on a button. Short filtered noise plus a tuned
//    knock, 90 ms total, so it reads as "something was pressed", not a beep.
sh("tick", ["-f", "lavfi", "-i",
  "aevalsrc='0.55*exp(-95*t)*sin(2*PI*1760*t)+0.35*exp(-140*t)*sin(2*PI*2640*t)':d=0.12:s=48000",
  "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.5:duration=0.12:r=48000",
  "-filter_complex",
  "[1:a]highpass=f=2000,lowpass=f=7000,volume='exp(-60*t)':eval=frame,volume=0.6[n];" +
  "[0:a][n]amix=inputs=2:normalize=0,afade=t=in:st=0:d=0.002,afade=t=out:st=0.08:d=0.04," +
  "aformat=channel_layouts=stereo:sample_fmts=s16:sample_rates=48000[o]",
  "-map", "[o]", "tick.wav"]);

// 2. chime - a reply has landed. A4 with a fifth and an octave above, bell
//    decay, 1.4 s tail. In key, so it sounds like part of the music.
sh("chime", ["-f", "lavfi", "-i",
  "aevalsrc='0.60*exp(-4.5*t)*sin(2*PI*880*t)+0.30*exp(-6.5*t)*sin(2*PI*1318.51*t)+0.14*exp(-9*t)*sin(2*PI*1760*t)+0.07*exp(-13*t)*sin(2*PI*2637*t)'" +
  "|'0.60*exp(-4.5*t)*sin(2*PI*880.9*t)+0.30*exp(-6.5*t)*sin(2*PI*1317.4*t)+0.14*exp(-9*t)*sin(2*PI*1761.8*t)+0.07*exp(-13*t)*sin(2*PI*2634*t)':d=1.8:s=48000",
  "-af", "highpass=f=200,aecho=0.85:0.9:38|71:0.22|0.14,afade=t=in:st=0:d=0.004,afade=t=out:st=1.4:d=0.4," +
  "aformat=channel_layouts=stereo:sample_fmts=s16:sample_rates=48000", "chime.wav"]);

// 3. swell - under a reveal. Two seconds of rising air, then a soft low impact
//    and an A-minor stab that the bed can carry on from.
sh("swell", ["-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.8:duration=3.6:r=48000",
  "-f", "lavfi", "-i",
  "aevalsrc='0.9*exp(-2.6*max(0,t-2))*sin(2*PI*55*max(0,t-2))+0.5*exp(-3.4*max(0,t-2))*sin(2*PI*110*max(0,t-2))':d=3.6:s=48000",
  "-f", "lavfi", "-i",
  "aevalsrc='0.30*exp(-1.5*max(0,t-2))*sin(2*PI*220*max(0,t-2))+0.22*exp(-1.7*max(0,t-2))*sin(2*PI*329.63*max(0,t-2))+0.16*exp(-2.0*max(0,t-2))*sin(2*PI*523.25*max(0,t-2))'" +
  "|'0.30*exp(-1.5*max(0,t-2))*sin(2*PI*220.4*max(0,t-2))+0.22*exp(-1.7*max(0,t-2))*sin(2*PI*329.0*max(0,t-2))+0.16*exp(-2.0*max(0,t-2))*sin(2*PI*524.1*max(0,t-2))':d=3.6:s=48000",
  "-filter_complex",
  "[0:a]bandpass=f=900:width_type=o:w=3.2,volume='min(1,pow(t/2,3))*lt(t,2.05)+max(0,1-(t-2.05)*3.5)*gte(t,2.05)':eval=frame," +
  "aformat=channel_layouts=stereo,stereotools=slev=1.6,volume=0.55[air];" +
  "[1:a]lowpass=f=160,aformat=channel_layouts=stereo,volume=0.8[sub];" +
  "[2:a]lowpass=f=3000,aecho=0.8:0.9:55|93:0.25|0.18,volume=0.7[stab];" +
  "[air][sub][stab]amix=inputs=3:normalize=0,afade=t=out:st=3.1:d=0.5," +
  "alimiter=limit=0.7:level=disabled,aformat=channel_layouts=stereo:sample_fmts=s16:sample_rates=48000[o]",
  "-map", "[o]", "swell.wav"]);

// 4. whoosh - a screen change. Two noise layers moving in opposite directions,
//    which is what gives the sense of travel without a real filter sweep.
sh("whoosh", ["-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.9:duration=0.9:r=48000",
  "-f", "lavfi", "-i", "anoisesrc=color=white:amplitude=0.5:duration=0.9:r=48000",
  "-filter_complex",
  "[0:a]lowpass=f=700,volume='max(0,1-t*1.4)':eval=frame[lo];" +
  "[1:a]highpass=f=1400,lowpass=f=6500,volume='min(1,t*2.2)*max(0,1-t*1.1)':eval=frame,volume=0.5[hi];" +
  "[lo][hi]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo,stereotools=slev=1.8," +
  "afade=t=in:st=0:d=0.05,afade=t=out:st=0.65:d=0.25," +
  "aformat=sample_fmts=s16:sample_rates=48000:channel_layouts=stereo[o]",
  "-map", "[o]", "whoosh.wav"]);

// Report
for (const f of ["tick.wav", "chime.wav", "swell.wav", "whoosh.wav"]) {
  const p = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" });
  const a = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", f, "-af", "astats=metadata=1:reset=0,ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const t = String(a.stdout) + String(a.stderr);
  const g = (k) => (new RegExp(k + ":? +(-?[0-9.]+)").exec(t) ?? [])[1];
  console.log(`${f.padEnd(11)} dur=${Number(p.stdout).toFixed(2)}s  peak=${g("Peak level dB")}dB  rms=${g("RMS level dB")}dB  crest=${g("Crest factor")}  LUFS=${(/ {4}I: +(-?[0-9.]+)/.exec(t) ?? [])[1]}`);
}
