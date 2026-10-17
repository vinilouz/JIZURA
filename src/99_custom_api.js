/* ============================================================
   JIZURA — headless & programmatic API
   Loads after 99_custom_video.js and 99_custom_bgs.js.
   Enables direct schema querying, in-memory assets, preview frame
   snapshots, and full MP4 render jobs without DOM UI or IndexedDB.
   ============================================================ */
(() => {
'use strict';

if (typeof J !== 'object') throw new Error('99_custom_api: J is missing — load after engine');

/* ------------------------------------------------------------ schema introspection */
J.getSchema = () => {
  const styles = (J.STYLE_ORDER || []).map(id => {
    const s = J.STYLES[id] || {};
    return {
      id,
      name: s.name || id,
      desc: s.desc || '',
      extra: !!s.extra,
      wa: !!s.wa,
      horror: !!s.horror,
      schemes: (s.schemes || []).map(sc => ({
        bg: sc.bg, fg: sc.fg, sub: sc.sub, accent: sc.accent,
        accent2: sc.accent2, ink: sc.ink, ghostA: sc.ghostA, ghostB: sc.ghostB,
      })),
      fonts: s.fonts || null,
    };
  });

  const themes = [
    { id: "lyricpv", name: "Lyric PV", desc: "Short phrases, cinematic musical meter timing and editorial typography" },
    { id: "kinetic", name: "Kinetic Motion", desc: "Fast cuts, punchy typography, pop and glitch energy" },
    { id: "wa",      name: "Traditional (Wafuu)", desc: "Japanese brush aesthetics, calligraphy and calm balance" },
    { id: "horror",  name: "Horror / VHS", desc: "Glitch artifacts, tape static and ominous pacing" },
    { id: "pop",     name: "Pop Dynamic", desc: "Vibrant colors, playful bounces and expressive motion" },
    { id: "ballad",  name: "Ballad / Calm", desc: "Slow emotional tempo, held words and gentle transitions" }
  ];

  const moods = Object.entries(J.MOODS || {}).map(([id, m]) => ({
    id,
    name: m.name || id,
    fx: m.fx || null,
    layouts: m.layout || [],
    enters: m.enter || [],
    exits: m.exit || [],
    styles: m.styles || [],
    set: m.set || null,
  }));

  const aspects = ['16:9', '9:16', '1:1', '4:3', '3:4', '4:5', '21:9'];
  const resolutions = [720, 1080, 1440, 2160];
  const fpsList = [24, 30, 60];

  const fonts = Object.entries(J.FONTS || {}).map(([id, f]) => ({
    id,
    label: f.label || id,
    kind: f.kind || 'gothic',
    weight: f.weight || 400,
  }));

  return {
    styles,
    moods,
    aspects,
    resolutions,
    fpsList,
    fonts,
    groups: J.GROUP_KEYS ? Object.fromEntries(J.GROUP_KEYS.map(g => [g, J.order(g)])) : {},
    defaultProject: J.defaultProject(),
  };
};

/* ------------------------------------------------------------ in-memory runner */
let bgSeq = 0;

/* Prepares and plans a job in memory. Returns { project, plan, audio } */
J.prepareJob = async ({ audioBuffer, lyrics, config = {}, backgrounds = [] }) => {
  if (J.bgClearDirect) J.bgClearDirect();

  const project = Object.assign(J.defaultProject(), config);
  if (config.fx) project.fx = Object.assign({}, J.defaultProject().fx, config.fx);
  if (config.timing) project.timing = Object.assign({}, J.defaultProject().timing, config.timing);
  if (typeof lyrics === 'string') project.lyrics = lyrics;

  let audio = null;
  if (audioBuffer) {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    let decodedAudio;
    try {
      decodedAudio = await ac.decodeAudioData(audioBuffer.slice(0));
    } finally {
      try { await ac.close(); } catch (e) {}
    }
    const sr = decodedAudio.sampleRate, len = decodedAudio.length, ch = decodedAudio.numberOfChannels;
    const mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) {
      const d = decodedAudio.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
    }
    const rate = 50, hop = Math.round(sr / rate), n = Math.floor(len / hop);
    const energy = new Float32Array(n), flux = new Float32Array(n);
    let prevHP = 0, prevX = 0;
    for (let f = 0; f < n; f++) {
      let e = 0, eh = 0;
      for (let i = f * hop, end = Math.min(len, (f + 1) * hop); i < end; i++) {
        const x = mono[i]; e += x * x;
        const hp = 0.92 * (prevHP + x - prevX); prevHP = hp; prevX = x; eh += hp * hp;
      }
      energy[f] = Math.sqrt(e / hop); flux[f] = Math.sqrt(eh / hop);
    }
    const onset = new Float32Array(n);
    for (let f = 1; f < n; f++) {
      const cur = Math.log(1e-4 + flux[f]);
      let m = 0, k = 0; for (let j = Math.max(0, f - 4); j < f; j++) { m += Math.log(1e-4 + flux[j]); k++; }
      onset[f] = Math.max(0, cur - m / Math.max(1, k));
    }
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
    let bestPh = 0, bestPS = -1;
    for (let ph = 0; ph < lagF; ph += 0.5) {
      let s = 0; for (let t = ph; t < n; t += lagF) s += onset[Math.round(t)] || 0;
      if (s > bestPS) { bestPS = s; bestPh = ph; }
    }
    const beats = [];
    for (let t = bestPh / rate; t < decodedAudio.duration; t += period) beats.push(+t.toFixed(4));
    const sorted = Array.from(energy).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
    const energyN = new Float32Array(n);
    for (let f = 0; f < n; f++) energyN[f] = Math.min(1, energy[f] / p95);

    audio = {
      name: 'audio', duration: decodedAudio.duration, sampleRate: sr, buffer: decodedAudio,
      bpm: Math.round(60 / period * 10) / 10, beats, energy: energyN, energyRate: rate,
    };
    if (J.localAudioAnalysis) {
      Object.assign(audio, J.localAudioAnalysis(decodedAudio, energyN, rate, beats));
    }
  }

  // First plan pass to initialize project and cuts
  let plan = J.plan(project, audio);

  // Register in-memory background media
  if (Array.isArray(backgrounds) && backgrounds.length) {
    for (const bg of backgrounds) {
      const id = `bg_dir_${Date.now().toString(36)}_${(bgSeq++).toString(36)}`;
      const isVid = bg.type === 'video' || (bg.name && /\.(mp4|mov)$/i.test(bg.name));
      if (isVid) {
        const info = await J.video.open(id, bg.data);
        const asset = { id, name: bg.name || 'clip.mp4', type: 'video/mp4', w: info.w, h: info.h, dur: info.dur };
        J.bgRegisterDirect(asset, null);
      } else {
        const blob = bg.data instanceof Blob ? bg.data : new Blob([bg.data]);
        const bmp = await createImageBitmap(blob);
        const asset = { id, name: bg.name || 'image.png', type: 'image/png', w: bmp.width, h: bmp.height };
        J.bgRegisterDirect(asset, bmp);
      }
    }
    // Re-plan with backgrounds active
    plan = J.plan(project, audio);
  }

  // Pre-load required fonts
  const lyricText = (project.lyrics || '') + (project.title || '') + '0123456789XYLINEREC:/.・【】No';
  await J.ensureFonts(lyricText, null);

  return { project, plan, audio };
};

/* ------------------------------------------------------------ render frame snapshot */
J.renderSnapshot = async (prep, tSec, scale = 0.5) => {
  const { plan } = prep;
  if (J.ensureBgReady) await J.ensureBgReady(tSec);
  const W = Math.round(plan.W * scale), H = Math.round(plan.H * scale);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const R = new J.Renderer();
  R.frame(ctx, plan, tSec, { scale });
  return cv.toDataURL('image/jpeg', 0.88);
};

/* ------------------------------------------------------------ full render job */
J.renderJob = async (job) => {
  const { onProgress, quality = 'high', range = null } = job;
  const prep = await J.prepareJob(job);
  const { project, plan, audio } = prep;

  const res = await J.exportMP4({
    plan,
    project,
    audio,
    quality,
    range,
    onProgress: (p, msg) => {
      if (onProgress) onProgress(p, msg);
    },
  });

  const blob = res.blob;
  return {
    blob,
    get buffer() { return blob.arrayBuffer(); },
    size: res.size,
    duration: plan.duration,
    fps: plan.fps,
    width: res.width,
    height: res.height,
    codec: res.codec,
    cuts: (plan.cuts || []).map(c => ({
      text: c.text, start: c.start, end: c.end, layout: c.layout, enter: c.enter, exit: c.exit,
    })),
  };
};

})();
