/* ============================================================
   JIZURA — audio: decode, energy envelope, onset, BPM & beat grid
   ============================================================ */
(() => {
'use strict';

J.analyzeAudio = async (file) => {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let audioBuffer;
  try { audioBuffer = await ac.decodeAudioData(buf.slice(0)); } finally { try { ac.close(); } catch (e) {} }
  const sr = audioBuffer.sampleRate, len = audioBuffer.length, ch = audioBuffer.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const d = audioBuffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
  const rate = 50, hop = Math.round(sr / rate), n = Math.floor(len / hop);
  const energy = new Float32Array(n), flux = new Float32Array(n);
  let prevHP = 0, prevX = 0;
  for (let f = 0; f < n; f++) {
    let e = 0, eh = 0;
    for (let i = f * hop, end = Math.min(len, (f + 1) * hop); i < end; i++) {
      const x = mono[i]; e += x * x;
      const hp = 0.92 * (prevHP + x - prevX); prevHP = hp; prevX = x; eh += hp * hp;
    }
    energy[f] = Math.sqrt(e / hop);
    flux[f] = Math.sqrt(eh / hop);
  }
  // onset strength: positive change of log high-passed energy vs local mean
  const onset = new Float32Array(n);
  for (let f = 1; f < n; f++) {
    const cur = Math.log(1e-4 + flux[f]);
    let m = 0, k = 0; for (let j = Math.max(0, f - 4); j < f; j++) { m += Math.log(1e-4 + flux[j]); k++; }
    onset[f] = Math.max(0, cur - m / Math.max(1, k));
  }
  // tempo via autocorrelation (70..180 BPM)
  const minLag = Math.round(rate * 60 / 180), maxLag = Math.round(rate * 60 / 70);
  let best = 0, bestLag = Math.round(rate * 0.5);
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let f = lag; f < n; f++) s += onset[f] * onset[f - lag];
    const bpm = 60 * rate / lag;
    const w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 125) / 0.7, 2));
    s *= w; scores[lag] = s;
    if (s > best) { best = s; bestLag = lag; }
  }
  let lagF = bestLag;
  if (scores[bestLag - 1] != null && scores[bestLag + 1] != null) {
    const a = scores[bestLag - 1], b = scores[bestLag], c = scores[bestLag + 1];
    const d = (a - 2 * b + c); if (d !== 0) lagF = bestLag + 0.5 * (a - c) / d;
  }
  const period = lagF / rate;
  // phase
  let bestPh = 0, bestPS = -1;
  for (let ph = 0; ph < lagF; ph += 0.5) {
    let s = 0; for (let t = ph; t < n; t += lagF) s += onset[Math.round(t)] || 0;
    if (s > bestPS) { bestPS = s; bestPh = ph; }
  }
  const beats = [];
  for (let t = bestPh / rate; t < audioBuffer.duration; t += period) beats.push(+t.toFixed(4));
  // normalised energy (0..1, 95th percentile)
  const sorted = Array.from(energy).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const energyN = new Float32Array(n);
  for (let f = 0; f < n; f++) energyN[f] = Math.min(1, energy[f] / p95);
  // waveform peaks for the timeline
  const bins = 1600, peaks = new Float32Array(bins), per = Math.max(1, Math.floor(len / bins));
  for (let b = 0; b < bins; b++) { let m = 0; for (let i = b * per, e = Math.min(len, (b + 1) * per); i < e; i += 4) { const v = Math.abs(mono[i]); if (v > m) m = v; } peaks[b] = m; }
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
  // silences: energyN < 0.15 sustained ≥ 0.8 s
  const qMin = Math.round(0.8 * rate), silences = [];
  let s0 = -1;
  for (let f = 0; f <= n; f++) {
    const quiet = f < n && energyN[f] < 0.15;
    if (quiet && s0 < 0) s0 = f;
    if (!quiet && s0 >= 0) { if (f - s0 >= qMin) silences.push([+(s0 / rate).toFixed(2), +(f / rate).toFixed(2)]); s0 = -1; }
  }
  // phases: 2 s moving average of energyN vs global mean × 1.1
  const smW = rate * 2, smooth = new Float32Array(n);
  let acc = 0;
  for (let f = 0; f < n; f++) { acc += energyN[f]; if (f >= smW) acc -= energyN[f - smW]; smooth[f] = acc / Math.min(f + 1, smW); }
  let mean = 0; for (let f = 0; f < n; f++) mean += smooth[f];
  const thr = mean / Math.max(1, n) * 1.1;
  const phases = [];
  for (let f = 0; f < n; f++) {
    const loud = smooth[f] >= thr, last = phases[phases.length - 1];
    if (last && last.loud === loud) last.end = +((f + 1) / rate).toFixed(2);
    else phases.push({ start: +(f / rate).toFixed(2), end: +((f + 1) / rate).toFixed(2), loud });
  }
  for (let i = phases.length - 1; i > 0; i--) if (phases[i].end - phases[i].start < 0.5) { phases[i - 1].end = phases[i].end; phases.splice(i, 1); }
  if (phases.length > 1 && phases[0].end - phases[0].start < 0.5) { phases[1].start = phases[0].start; phases.splice(0, 1); }
  // moments: positive 0.4 s deltas of smoothed energy, greedy ≥ 4 s apart
  const dLag = Math.round(0.4 * rate), mGap = 4 * rate;
  let maxD = 0;
  for (let f = dLag; f < n; f++) { const d = smooth[f] - smooth[f - dLag]; if (d > maxD) maxD = d; }
  const mCand = [];
  for (let f = dLag; f < n; f++) { const d = smooth[f] - smooth[f - dLag]; if (d >= maxD * 0.5 && d >= 0.25) mCand.push([d, f]); }
  mCand.sort((a, b) => b[0] - a[0]);
  const mSel = [];
  for (const [, f] of mCand) if (mSel.every(g => Math.abs(f - g) >= mGap)) mSel.push(f);
  const moments = mSel.sort((a, b) => a - b).map(f => +(f / rate).toFixed(2));
  return {
    name: file.name, duration: audioBuffer.duration, sampleRate: sr, buffer: audioBuffer,
    bpm: Math.round(60 / period * 10) / 10, beats, energy: energyN, energyRate: rate, peaks,
    downbeats, barLen, silences, phases, moments,
  };
};

/* rebuild a beat grid from a user BPM + first-beat offset */
J.beatGrid = (bpm, offset, duration) => {
  const out = []; if (!(bpm > 0)) return out;
  const p = 60 / bpm;
  for (let t = offset; t < duration + 0.01; t += p) if (t >= 0) out.push(+t.toFixed(4));
  return out;
};
})();
