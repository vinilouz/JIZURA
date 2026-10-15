/* ============================================================
   JIZURA — local: cut on the percussive attack (onset)
   Loads last (build.py does sorted(glob.glob('src/*.js')), and 99_ > 12_).
   Everything local lives in files like this one, so `git merge upstream/main`
   never has to merge local code.

   The official planner spreads the cuts inside a line by character weight and
   snaps them to the beat grid; a beat is not an attack. This wrapper re-plans
   through overrides[li].cutTime: the official planner applies cutTime before
   the unit loop, so dur / params / inDur / outDur are all derived from the new
   bounds. The clone is discarded — the project keeps no cutTime, so the editor
   still shows every line as automatic.
   ============================================================ */
(() => {
'use strict';

if (!J.plan) throw new Error('99_custom_cuts: J.plan is missing — nothing to wrap');
if (!J.LAYOUTS) throw new Error('99_custom_cuts: J.LAYOUTS is missing — cut kinds are unknown');

const WINDOW = 0.2;   // fixed search window around the position the official planner chose
const GAP = 0.22;     // the cut-to-cut spacing the official cutTime block enforces

/* attack times: frames where the onset strength rises over the frame before and falls after */
const onsetPeaks = (onset, rate) => {
  const out = [];
  for (let f = 1; f < onset.length; f++) {
    if (!(onset[f] > 0) || onset[f] < onset[f - 1]) continue;
    if (f + 1 < onset.length && onset[f] <= onset[f + 1]) continue;
    out.push(f / rate);
  }
  return out;
};

const nearest = (times, t) => {
  let best = null, bd = WINDOW;
  for (const v of times) { const d = Math.abs(v - t); if (d <= bd) { bd = d; best = v; } }
  return best;
};

const plan = J.plan;

J.plan = (project, audio) => {
  const p = plan(project, audio);
  // typed BPM with no music file (12_ui.js audioLike) carries a beat grid but no analysis:
  // a different input, not a degraded one — there is no attack to follow, nothing is invented.
  if (!audio || !audio.onset) return p;
  const rate = audio.energyRate;
  if (!(rate > 0)) throw new Error('99_custom_cuts: audio.onset present but energyRate is missing');
  // a detected bar that is not 4 beats: only the downbeat is an attack worth cutting on
  const candidates = p.barLen != null && p.barLen !== 4 ? p.downbeats.slice() : onsetPeaks(audio.onset, rate);
  // the cuts the editor counts per line (title and interludes are special layouts)
  const byLine = new Map();
  for (const c of p.cuts) {
    if (c.line < 0 || !J.LAYOUTS[c.layout] || J.LAYOUTS[c.layout].special) continue;
    let arr = byLine.get(c.line);
    if (!arr) byLine.set(c.line, arr = []);
    arr.push(c);
  }
  const cutTime = {};
  for (const [li, cuts] of byLine) {
    if (cuts.length < 2) continue;   // a single cut starts with the line: nothing to place
    const ov = (project.overrides || {})[li] || {};
    if (ov.lock || ov.lockedCuts || (ov.cutTime && Object.keys(ov.cutTime).length)) continue;   // hand-set times and locks stay
    const s = p.lines[li].start, visEnd = p.lines[li].visEnd, nb = cuts.length;
    let prev = s;
    const ct = {};
    for (let k = 1; k < nb; k++) {
      const t = nearest(candidates, cuts[k].start);
      if (t != null && t >= prev + GAP && t <= visEnd - GAP * (nb - k)) { ct[k] = t - s; prev = t; }
      else prev = Math.max(cuts[k].start, prev + GAP);   // no usable attack in the window: the official position stands
    }
    if (Object.keys(ct).length) cutTime[li] = ct;
  }
  // never write back into project.overrides: the editor reads it to mark a cut as hand-fixed
  const clone = Object.assign({}, project);
  clone.overrides = Object.assign({}, project.overrides);
  for (const k of Object.keys(cutTime)) clone.overrides[k] = Object.assign({}, clone.overrides[k], { cutTime: cutTime[k] });
  return plan(clone, audio);
};

})();
