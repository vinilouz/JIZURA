"""Onset check: cuts inside a line must land on the attack, not on the beat-snapped weight fraction.

usage: python3 build.py --dev && python3 dev/onset_test.py
fails loudly — no fallback, no skip. Run after every `tools/update.sh`.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'dev', 'www', 'test.html')
PAGE = 'file://' + HTML

WINDOW = 0.2

# 8 s at 48 kHz: percussive clicks at irregular times, every one frame-aligned (0.02 s at
# energyRate 50) so its onset peak sits exactly on the chosen time. Only 6.0 s is on the
# 0.5 s beat grid and 6.0 s is a 4-beat position, so the bar-length vote ties and stays 4.
# Lines start on the beat grid (1.0 / 3.0 / 4.0 / 6.0); two cuts per line (ov.cuts = 2)
# put one cut boundary at the line middle, inside the window of the clicks above.
CHECK = r"""
async () => {
  const SR = 48000, DUR = 8, RATE = 50;
  const CLICKS = [0.4, 1.9, 3.36, 4.9, 6.0];
  const len = SR * DUR, hop = Math.round(SR / RATE), n = Math.floor(len / hop);
  const clickLen = Math.round(SR * 0.015);
  const click = new Float32Array(clickLen);
  for (let i = 0; i < clickLen; i++) click[i] = 0.9 * Math.sin(2 * Math.PI * 120 * i / SR) + 0.5 * Math.sin(2 * Math.PI * 2000 * i / SR);
  const buffer = new AudioBuffer({ length: len, sampleRate: SR, numberOfChannels: 1 });
  const d = buffer.getChannelData(0);
  for (const t of CLICKS) { const at = Math.round(t * SR); for (let i = 0; i < clickLen; i++) d[at + i] = click[i]; }
  // energy exactly like upstream: RMS per hop, normalised by p95
  const raw = new Float32Array(n);
  for (let f = 0; f < n; f++) { let e = 0; for (let i = f * hop; i < (f + 1) * hop; i++) e += d[i] * d[i]; raw[f] = Math.sqrt(e / hop); }
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const energy = new Float32Array(n);
  for (let f = 0; f < n; f++) energy[f] = Math.min(1, raw[f] / p95);

  const beats = []; for (let t = 0; t <= DUR + 1e-9; t += 0.5) beats.push(+t.toFixed(4));
  const res = J.localAudioAnalysis(buffer, energy, RATE, beats);
  const audio = { beats, energy, energyRate: RATE, duration: DUR, onset: res.onset, downbeats: res.downbeats, barLen: res.barLen, silences: res.silences };
  const BARS = [2.0, 3.5, 5.0];
  const audioBar = { beats, energy, energyRate: RATE, duration: DUR, onset: res.onset, downbeats: BARS, barLen: 3, silences: [] };
  const beatsOnly = { beats, energy, energyRate: RATE, duration: DUR };

  const mk = () => Object.assign(J.defaultProject(), {
    lyrics: 'あいう/えおか\nあいう/えおか\nあいう/えおか\nあいう/えおか',
    timing: Object.assign(J.defaultProject().timing, { lineTimes: { 0: 1.0, 1: 3.0, 2: 4.0, 3: 6.0 } }),
    overrides: { 0: { cuts: 2 }, 1: { cuts: 2 }, 2: { cuts: 2 }, 3: { cuts: 2 } },
  });
  const bounds = (p) => {
    const out = {};
    for (const c of p.cuts) {
      if (c.line < 0 || !J.LAYOUTS[c.layout] || J.LAYOUTS[c.layout].special) continue;
      (out[c.line] = out[c.line] || []).push(+c.start.toFixed(6));
    }
    return out;
  };

  const pUp = mk(), ovBefore = JSON.stringify(pUp.overrides);
  const up = J.plan(pUp, beatsOnly);                  // no onset: the official plan, untouched
  const pOn = mk();
  const t0 = performance.now();
  const on = J.plan(pOn, audio);                      // onsets: re-planned through cutTime
  const msOn = performance.now() - t0;
  const bar = J.plan(mk(), audioBar);                 // bar of 3: only the downbeat is followed
  const ovAfter = JSON.stringify(pOn.overrides);

  // second-pass cost at a realistic size: 48 lines, ~3 cuts each. Warm up, then alternate
  // both paths so JIT / GC noise hits them the same way.
  const N = 48, GAP = 2.5;
  const big = () => Object.assign(J.defaultProject(), {
    lyrics: Array.from({ length: N }, () => 'あいう/えおか').join('\n'),
    timing: Object.assign(J.defaultProject().timing, { lineTimes: Object.fromEntries(Array.from({ length: N }, (_, i) => [i, +(0.5 + i * GAP).toFixed(2)])) }),
    overrides: {},
  });
  J.plan(big(), beatsOnly); J.plan(big(), audio);
  const one = [], two = [];
  for (let i = 0; i < 4; i++) {
    const p1 = big(); let t0 = performance.now(); J.plan(p1, beatsOnly); one.push(+(performance.now() - t0).toFixed(1));
    const p2 = big(); t0 = performance.now(); J.plan(p2, audio); two.push(+(performance.now() - t0).toFixed(1));
  }

  return { barLen: res.barLen, clicks: CLICKS, bars: BARS, up: bounds(up), on: bounds(on), bar: bounds(bar),
           ovBefore, ovAfter, ovClean: Object.values(pOn.overrides).every(o => !o.cutTime),
           msOn: +msOn.toFixed(1), one, two };
}
"""


def fail(msg):
    print('FAIL:', msg)
    sys.exit(1)


def nearest(times, t, window=WINDOW):
    best, bd = None, window
    for v in times:
        d = abs(v - t)
        if d <= bd:
            bd, best = d, v
    return best


def lines_of(obj):
    return {int(k): v for k, v in obj.items()}


def median(xs):
    s = sorted(xs)
    return s[len(s) // 2]


async def main():
    if not os.path.exists(HTML):
        fail('dev/www/test.html missing — run `python3 build.py --dev` first')
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        await pg.goto(PAGE)
        await pg.wait_for_function('window.J && window.T')
        r = await pg.evaluate(CHECK)
        await b.close()

    print('plan     ', json.dumps({k: r[k] for k in ('barLen', 'up', 'on', 'bar')}))
    print('overrides', 'intact' if r['ovBefore'] == r['ovAfter'] else 'CHANGED', '| cutTime leaked:', not r['ovClean'])
    print('cost ms  ', 'small project with onsets', r['msOn'], '| 48 lines: 1 pass', r['one'], '2 passes', r['two'],
          '=> 2nd pass ~', round(median(r['two']) - median(r['one']), 1))

    if errs: fail('console errors: ' + '; '.join(errs[:5]))
    if r['barLen'] != 4: fail(f"fixture broken: click layout must keep barLen 4, got {r['barLen']}")
    up, on, bar = lines_of(r['up']), lines_of(r['on']), lines_of(r['bar'])
    if set(up) != set(on) or set(up) != set(bar): fail(f'line sets differ: {sorted(up)} / {sorted(on)} / {sorted(bar)}')

    moved, kept, distinct_bar = 0, 0, 0
    for li in sorted(up):
        u, o, b = up[li], on[li], bar[li]
        if len(u) != 2: fail(f'line {li}: fixture expects 2 cuts, got {len(u)}: {u}')
        ub, ob, bb = u[1], o[1], b[1]
        if abs(ub / 0.5 - round(ub / 0.5)) > 1e-6: fail(f'line {li}: official bound {ub} is not on the beat grid')
        exp = nearest(r['clicks'], ub)
        if exp is None:
            kept += 1
            if abs(ob - ub) > 1e-6: fail(f'line {li}: no click in the window of {ub}, bound moved to {ob}')
        else:
            if abs(ob - exp) > 0.005: fail(f'line {li}: bound {ob} is not the nearest click {exp} to {ub}')
            if abs(ob - ub) > WINDOW + 1e-6: fail(f'line {li}: bound moved {abs(ob - ub):.3f} s, outside the window')
            if abs(ob - ub) > 1e-6: moved += 1
        expb = nearest(r['bars'], ub)
        if expb is None:
            if abs(bb - ub) > 1e-6: fail(f'line {li}: bar 3 has no downbeat near {ub}, bound moved to {bb}')
        else:
            if abs(bb - expb) > 0.005: fail(f'line {li}: bound {bb} is not the nearest downbeat {expb} to {ub}')
            if exp is not None and abs(exp - expb) > 1e-6:
                distinct_bar += 1
                if abs(bb - ob) <= 0.05: fail(f'line {li}: bar 3 must follow the downbeat {expb}, not the onset {ob}')
    if moved < 2: fail(f'only {moved} bound(s) moved onto a click — the wrapper is not placing cuts')
    if kept < 1: fail('no line exercised the no-attack-in-window path')
    if distinct_bar < 2: fail(f'only {distinct_bar} line(s) tell the downbeat path from the onset path')
    if r['ovBefore'] != r['ovAfter']: fail('J.plan wrote into project.overrides')
    if not r['ovClean']: fail('cutTime leaked into project.overrides — the editor would show the cut as hand-fixed')
    print('OK')

asyncio.run(main())
