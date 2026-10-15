"""Beat-follow check: line starts must land on the detected beat grid, not on the LRC / typed time.

usage: python3 build.py --dev && python3 dev/beat_test.py
fails loudly — no fallback, no skip. Run after every `tools/update.sh`.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'dev', 'www', 'test.html')
PAGE = 'file://' + HTML

# beat grid every 0.5 s; line times deliberately OFF the grid (they came from LRC)
CHECK = r"""
async (snapOn) => {
  const beats = Array.from({length:160}, (_,i) => i * 0.5);
  const audio = { beats, downbeats: [], duration: 80, energy: Array.from({length:800},()=>0.5),
    energyRate: 10, silences: [], moments: [] };
  const lineTimes = { 0: 1.07, 1: 2.13, 2: 3.31, 3: 4.02 };
  const p = Object.assign(J.defaultProject(), { extra:true,
    lyrics:'Wide awake\nCan you feel it now\nWatch me\ndream it real',
    style: J.STYLE_ORDER[0], aspect:'16:9', seed: 99,
    timing: { bpm:0, offset:0, snap: snapOn, tail:0.5, lineTimes, lineScale:1 } });
  const plan = J.plan(p, audio);
  const onGrid = t => Math.abs(t / 0.5 - Math.round(t / 0.5)) < 1e-6;
  const starts = plan.cuts.map(c => +c.start.toFixed(3));
  return { starts, offGrid: starts.filter(t => !onGrid(t)).length,
           monotonic: starts.every((t,i,a) => i === 0 || t >= a[i-1]),
           endsOk: plan.cuts.every(c => c.end > c.start) };
}
"""

RENDER = r"""
async () => {
  const beats = Array.from({length:160}, (_,i) => i * 0.5);
  const audio = { beats, downbeats: [], duration: 80, energy: Array.from({length:800},()=>0.5),
    energyRate: 10, silences: [], moments: [] };
  const p = Object.assign(J.defaultProject(), { extra:true,
    lyrics:'愛\n透明\nほどけた声が鳴った\nねえ、まだ間に合うかな',
    style: J.STYLE_ORDER[0], aspect:'16:9', seed: 5,
    timing: { bpm:0, offset:0, snap:true, tail:0.5, lineTimes:{}, lineScale:1 } });
  const plan = J.plan(p, audio);
  const r = new J.Renderer();
  const cv = document.createElement('canvas'); cv.width = 480; cv.height = 270;
  const ctx = cv.getContext('2d');
  for (const c of plan.cuts) for (let k = 0; k < 3; k++)
    r.frame(ctx, plan, c.start + (c.end - c.start) * (k + 0.5) / 3, { scale: 0.5 });
  return plan.cuts.length;
}
"""

def fail(msg):
    print('FAIL:', msg)
    sys.exit(1)

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

        on = await pg.evaluate(CHECK, True)
        off = await pg.evaluate(CHECK, False)
        n = await pg.evaluate(RENDER)
        await b.close()

    print('snap ON ', json.dumps(on))
    print('snap OFF', json.dumps(off))
    print('render  ', n, 'cuts')

    if errs: fail('console errors: ' + '; '.join(errs[:5]))
    if on['offGrid']: fail(f"{on['offGrid']} cut(s) off the beat grid: {on['starts']}")
    if not on['monotonic']: fail('cut starts are not in order')
    if not on['endsOk']: fail('a cut ends before it starts')
    if off['offGrid'] != len(off['starts']): fail('snap OFF must leave every time untouched')
    if n == 0: fail('no cuts planned')
    print('OK')

asyncio.run(main())
