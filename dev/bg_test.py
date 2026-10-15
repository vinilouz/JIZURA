"""Background media check: import → IndexedDB → rotation per line → draw.

usage: python3 build.py --dev && python3 dev/bg_test.py
fails loudly — no fallback, no skip.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'dev', 'www', 'test.html')
PAGE = 'file://' + HTML

SETUP = r"""
async () => {
  const p = Object.assign(J.defaultProject(), { extra:true,
    lyrics:'一行目\n二行目\n三行目\n四行目', style: J.STYLE_ORDER[0], aspect:'16:9', seed: 7,
    timing:{ bpm:0, offset:0, snap:true, tail:0.5, lineTimes:{}, lineScale:1 } });
  J.plan(p, null);            // panel and renderer both reach the project through the planner
  window.__p = p;
  // the editor DOM is not on an engine page: mount the panel by hand
  const sec = document.createElement('div'); sec.className = 'sec';
  const h = document.createElement('div'); h.className = 'sec-h';
  const info = document.createElement('span'); info.id = 'linesInfo';
  h.appendChild(info); sec.appendChild(h); document.body.appendChild(sec);
  return { hasAssets: Array.isArray(p.bgAssets), panel: !!J.bgMount(sec) };
}
"""

# three solid-colour PNGs + one .txt: the colour is what makes the draw assertion meaningful
IMPORT = r"""
async () => {
  const colours = ['#ff0000', '#00ff00', '#0000ff'];
  const dt = new DataTransfer();
  for (let i = 0; i < colours.length; i++) {
    const c = document.createElement('canvas'); c.width = 320; c.height = 180;
    const x = c.getContext('2d'); x.fillStyle = colours[i]; x.fillRect(0, 0, 320, 180);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    dt.items.add(new File([blob], `pic${i}.png`, { type: 'image/png' }));
  }
  dt.items.add(new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
  const inp = document.querySelector('#bgSec input[type=file]');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change'));
  for (let i = 0; i < 400 && (document.querySelector('#bgState').textContent.indexOf('…') === 0 || !document.querySelectorAll('#bgAssetList li').length); i++)
    await new Promise(r => setTimeout(r, 25));
  const db = await new Promise((res, rej) => { const o = indexedDB.open('jizura', 1); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
  const rec = await new Promise((res, rej) => { const q = db.transaction('files').objectStore('files').get('bg:' + J.bgForLine(0).id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  return {
    order: window.__p.bgAssets.map(a => a.name),
    forLine: [0, 1, 2, 3, 4].map(J.bgForLine).map(a => a.name),
    meta: JSON.stringify(window.__p.bgAssets),
    idbName: rec.name, idbSize: rec.size, idbBlob: rec instanceof Blob,
    rows: document.querySelectorAll('#bgAssetList li').length,
    bad: Array.from(document.querySelectorAll('#bgAssetList li.is-bad')).map(li => li.querySelector('.bg-name').textContent + ' | ' + li.querySelector('.bg-why').textContent),
    count: document.getElementById('bgCount').textContent,
  };
}
"""

REORDER = r"""
async () => {
  J.plan(window.__p, null);
  J.bgMove(J.bgForLine(0).id, 1);
  return { order: window.__p.bgAssets.map(a => a.name), line1: J.bgForLine(1).name, line0: J.bgForLine(0).name };
}
"""

RENDER = r"""
async () => {
  J.plan(window.__p, null);
  const r = new J.Renderer();
  const grab = (line) => {
    const plan = J.plan(window.__p, null);
    const cut = plan.cuts.find(c => c.line === line);
    cut.bg = 'media';
    const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
    const ctx = cv.getContext('2d');
    r.frame(ctx, plan, cut.start + cut.dur * 0.5, { scale: 320 / plan.W });
    // a corner block: the centre of the frame is where the lyrics sit
    const d = ctx.getImageData(0, 0, 40, 40).data;
    let sr = 0, sg = 0, sb = 0;
    for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
    const n = d.length / 4;
    return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
  };
  return { l0: grab(0), l1: grab(1), l3: grab(3) };
}
"""

EMPTY = r"""
async () => {
  const p = Object.assign(J.defaultProject(), { extra:true, lyrics:'a\nb', style: J.STYLE_ORDER[0], aspect:'16:9', seed: 3,
    timing:{ bpm:0, offset:0, snap:true, tail:0.5, lineTimes:{}, lineScale:1 } });
  const plan = J.plan(p, null);
  for (const c of plan.cuts) c.bg = 'media';
  const r = new J.Renderer();
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
  const ctx = cv.getContext('2d');
  for (const c of plan.cuts) r.frame(ctx, plan, c.start + c.dur * 0.5, { scale: 320 / plan.W });
  return { assets: p.bgAssets ? p.bgAssets.length : 0, registered: !!J.BG.media, line: J.bgForLine(0) };
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

        setup = await pg.evaluate(SETUP)
        imported = await pg.evaluate(IMPORT)
        render = await pg.evaluate(RENDER)
        reorder = await pg.evaluate(REORDER)
        empty = await pg.evaluate(EMPTY)
        await b.close()

    print('setup   ', json.dumps(setup))
    print('import  ', json.dumps({k: imported[k] for k in ('order', 'forLine', 'idbName', 'idbSize', 'idbBlob', 'rows', 'count')}))
    print('reorder ', json.dumps(reorder))
    print('render  ', json.dumps(render))
    print('empty   ', json.dumps(empty))
    print('rejected', json.dumps(imported['bad'], ensure_ascii=False))
    print('metadata', imported['meta'])

    if errs: fail('console errors: ' + '; '.join(errs[:5]))
    if not setup['panel']: fail('the panel did not mount')
    if not setup['hasAssets']: fail('the project carries no bgAssets list')
    if imported['order'] != ['pic0.png', 'pic1.png', 'pic2.png']:
        fail('import order wrong: ' + json.dumps(imported['order']))
    if imported['forLine'] != ['pic0.png', 'pic1.png', 'pic2.png', 'pic0.png', 'pic1.png']:
        fail('the rotation does not follow the import order: ' + json.dumps(imported['forLine']))
    if 'data:' in imported['meta'] or len(imported['meta']) > 500:
        fail('the project carries image bytes: ' + imported['meta'])
    if not imported['idbBlob'] or imported['idbSize'] < 100:
        fail('the image bytes are not in IndexedDB')
    if imported['count'] != '3点':
        fail('the header counter is wrong: ' + imported['count'])
    if imported['rows'] != 4:
        fail(f"expected 3 assets + 1 rejected row, got {imported['rows']}")
    if len(imported['bad']) != 1 or not imported['bad'][0].startswith('notes.txt') or 'txt' not in imported['bad'][0]:
        fail('the unsupported file did not stay visible: ' + json.dumps(imported['bad']))
    if reorder['order'] != ['pic1.png', 'pic0.png', 'pic2.png'] or reorder['line1'] != 'pic0.png' or reorder['line0'] != 'pic1.png':
        fail('↓ did not move the asset or the rotation did not follow: ' + json.dumps(reorder))
    hue = lambda px: ['r', 'g', 'b'][max(range(3), key=lambda i: px[i])]
    # red, green, then back to red: the rotation is the asset order, line by line
    if (hue(render['l0']), hue(render['l1']), hue(render['l3'])) != ('r', 'g', 'r'):
        fail('J.BG.media.draw did not paint the rotation per line: ' + json.dumps(render))
    if not empty['registered'] or empty['assets'] != 0 or empty['line'] is not None:
        fail('the no-asset path did not stay inert: ' + json.dumps(empty))
    print('OK')

asyncio.run(main())