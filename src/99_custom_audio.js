/* ============================================================
   JIZURA — local: onset, downbeats, bars & silences
   Loads last (build.py does sorted(glob.glob('src/*.js')), and 99_ > 12_).
   Everything local lives in files like this one, so `git merge upstream/main`
   never has to merge local code.
   Ported from the pre-fork 10_audio.js, so upstream 10_audio.js stays untouched.
   ============================================================ */
(() => {
'use strict';

if (!J.analyzeAudio) throw new Error('99_custom_audio: J.analyzeAudio is missing — nothing to wrap');
if (!J.plan) throw new Error('99_custom_audio: J.plan is missing — nothing to wrap');

/* Analysis on top of what upstream already returns. Working rate is energyRate (50 Hz);
   `energy` is the upstream-normalised envelope, `beats` the upstream beat grid. */
J.localAudioAnalysis = (audioBuffer, energy, energyRate, beats) => {
  if (!audioBuffer) throw new Error('localAudioAnalysis: audioBuffer is required');
  if (!energyRate) throw new Error('localAudioAnalysis: energyRate is required');
  const sr = audioBuffer.sampleRate, len = audioBuffer.length, ch = audioBuffer.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const d = audioBuffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
  const rate = energyRate, hop = Math.round(sr / rate), n = Math.floor(len / hop);
  // onset strength: positive change of log high-passed energy vs local mean
  const flux = new Float32Array(n);
  let prevHP = 0, prevX = 0;
  for (let f = 0; f < n; f++) {
    let eh = 0;
    for (let i = f * hop, end = Math.min(len, (f + 1) * hop); i < end; i++) {
      const x = mono[i]; const hp = 0.92 * (prevHP + x - prevX); prevHP = hp; prevX = x; eh += hp * hp;
    }
    flux[f] = Math.sqrt(eh / hop);
  }
  const onset = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const cur = Math.log(1e-4 + flux[f]);
    let m = 0, k = 0; for (let j = Math.max(0, f - 4); j < f; j++) { m += Math.log(1e-4 + flux[j]); k++; }
    onset[f] = Math.max(0, cur - m / Math.max(1, k));
  }
  // low band <150 Hz: one-pole lowpass → flux/onset over filtered signal
  const TAU = 2 * Math.PI, aLow = 1 - Math.exp(-TAU * 150 / sr);
  const lp = new Float32Array(len);
  lp[0] = aLow * mono[0];
  for (let i = 1; i < len; i++) lp[i] = lp[i - 1] + aLow * (mono[i] - lp[i - 1]);
  const fluxLow = new Float32Array(n);
  let prevLHP = 0, prevLX = 0;
  for (let f = 0; f < n; f++) {
    let eh = 0;
    for (let i = f * hop, end = Math.min(len, (f + 1) * hop); i < end; i++) {
      const x = lp[i]; const hp = 0.92 * (prevLHP + x - prevLX); prevLHP = hp; prevLX = x; eh += hp * hp;
    }
    fluxLow[f] = Math.sqrt(eh / hop);
  }
  const onsetLow = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const cur = Math.log(1e-4 + fluxLow[f]);
    let m = 0, k = 0; for (let j = Math.max(0, f - 4); j < f; j++) { m += Math.log(1e-4 + fluxLow[j]); k++; }
    onsetLow[f] = Math.max(0, cur - m / Math.max(1, k));
  }
  // bar length: candidates 2/3/4 scored on onsetLow at downbeat positions (beat 0, c, 2c…)
  let barLen = 4, bestBar = -1, barTie = false;
  for (const c of [2, 3, 4]) {
    let s = 0;
    for (let k = 0; k * c < beats.length; k++) { const fi = Math.round(beats[k * c] * rate); if (fi < n) s += onsetLow[fi]; }
    if (s > bestBar) { bestBar = s; barLen = c; barTie = false; } else if (s === bestBar) barTie = true;
  }
  if (barTie) barLen = 4;
  // downbeats: strongest low-band onset beat per bar
  const downbeats = [];
  for (let b = 0; b < beats.length; b += barLen) {
    let bi = b, bv = -1;
    for (let j = b; j < Math.min(beats.length, b + barLen); j++) { const fi = Math.round(beats[j] * rate); const v = fi < n ? onsetLow[fi] : -1; if (v > bv) { bv = v; bi = j; } }
    downbeats.push(beats[bi]);
  }
  // silences: energy < 0.15 sustained ≥ 0.8 s
  const qMin = Math.round(0.8 * rate), silences = [];
  let s0 = -1;
  for (let f = 0; f <= n; f++) {
    const quiet = f < n && energy[f] < 0.15;
    if (quiet && s0 < 0) s0 = f;
    if (!quiet && s0 >= 0) { if (f - s0 >= qMin) silences.push([+(s0 / rate).toFixed(2), +(f / rate).toFixed(2)]); s0 = -1; }
  }
  return { onset, downbeats, barLen, silences };
};

const analyzeAudio = J.analyzeAudio;

J.analyzeAudio = async (file) => {
  const a = await analyzeAudio(file);
  Object.assign(a, J.localAudioAnalysis(a.buffer, a.energy, a.energyRate, a.beats));
  return a;
};

const plan = J.plan;

/* additive: the render reads the grid from the plan. plan.cuts stays untouched —
   its start/end/dur/params are derived together before makeCut. */
J.plan = (project, audio) => {
  const p = plan(project, audio);
  // manual BPM with no music file (12_ui.js audioLike) carries a beat grid but no analysis.
  // That is a different case from a missing grid, so nothing is invented and nothing is written:
  // whoever needs onsets and finds none must say so where it needs them.
  if (audio && audio.barLen != null) {
    p.downbeats = audio.downbeats;
    p.barLen = audio.barLen;
    p.silences = audio.silences;
  }
  return p;
};

})();
