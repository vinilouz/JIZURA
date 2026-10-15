/* ============================================================
   JIZURA — local: seguir o beat
   Loads last (build.py does sorted(glob.glob('src/*.js')), and 99_ > 12_).
   Everything local lives in files like this one, so `git merge upstream/main`
   never has to merge local code.

   Flow: music up -> lyrics with LRC timestamps -> visual config -> video.mp4
   LRC says which line is roughly when; the music says exactly where the cut falls.
   Nothing here is ever pointed or tapped by hand.
   ============================================================ */
(() => {
'use strict';

if (!J.computeTiming) throw new Error('99_custom_beat: J.computeTiming is missing — nothing to wrap');

// nearest beat within half a beat (min 0.18 s). The beat AFTER t counts too, so a cut landing
// slightly early still catches the one coming up.
const beatSnapper = (beats) => {
  const beatLen = beats.length > 1 ? beats[1] - beats[0] : 0.46875;
  const tol = Math.max(0.18, beatLen * 0.48);
  return (t) => {
    let lo = 0, hi = beats.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (beats[mid] < t) lo = mid + 1; else hi = mid; }
    let best = t, bd = tol;
    for (const k of [lo - 1, lo, lo + 1]) if (k >= 0 && k < beats.length && Math.abs(beats[k] - t) < bd) { bd = Math.abs(beats[k] - t); best = beats[k]; }
    return best;
  };
};

const computeTiming = J.computeTiming;

J.computeTiming = (project, parsed, audio) => {
  const beats = audio && audio.beats;
  const T = project.timing || {};
  if (beats && beats.length && T.snap) {
    const nearest = beatSnapper(beats);
    // Move the times upstream reads, so its own clamping / squeezing / ends / duration
    // all come out consistent. Snapping afterwards would leave ends and duration stale.
    for (const ln of parsed.lines) if (ln.lrc != null && isFinite(ln.lrc)) ln.lrc = Math.max(0, nearest(ln.lrc));
    if (T.lineTimes) for (const k of Object.keys(T.lineTimes)) {
      const v = +T.lineTimes[k];
      if (isFinite(v)) T.lineTimes[k] = Math.max(0, nearest(v));
    }
  }
  return computeTiming(project, parsed, audio);
};

})();
