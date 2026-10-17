"""Importa os clipes reais no servidor de edição e prova que o fundo pinta.

O probe cria o próprio projeto, então replaneja com ele depois do import: o app
real importa e replaneja no mesmo objeto, e o `current` do módulo aponta para o
projeto que o editor está usando.

usage: python3 dev/import_probe.py [url]
"""
import asyncio, glob, json, os, sys
from playwright.async_api import async_playwright

CLIPS = sys.argv[1] if len(sys.argv) > 1 else None
URL = sys.argv[2] if len(sys.argv) > 2 else 'http://127.0.0.1:5500/en/index.html'
if not CLIPS:
    print('uso: python3 dev/import_probe.py <pasta-de-clips> [url]')
    sys.exit(2)

SETUP = r"""
async () => {
  const p = Object.assign(J.defaultProject(), { extra:true,
    lyrics:'一行目\n二行目\n三行目', style: J.STYLE_ORDER[0], aspect:'16:9', seed: 7,
    timing:{ bpm:0, offset:0, snap:true, tail:0.5, lineTimes:{}, lineScale:1 } });
  J.plan(p, null);
  window.__p = p;
  const sec = document.createElement('div'); sec.className = 'sec';
  const h = document.createElement('div'); h.className = 'sec-h';
  const info = document.createElement('span'); info.id = 'linesInfo';
  h.appendChild(info); sec.appendChild(h); document.body.appendChild(sec);
  return { panel: !!J.bgMount(sec) };
}
"""

STATE = r"""
async () => ({
  assets: (window.__p.bgAssets || []).map(a => a.name),
  bad: Array.from(document.querySelectorAll('#bgAssetList li.is-bad')).map(li => li.textContent.trim().slice(0, 60)),
})
"""

# the whole point: does the reel paint, on a canvas that is on screen
DRAW = r"""
async () => {
  window.__plan = J.plan(window.__p, null);
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
  document.body.appendChild(cv);                  // connected: the preview path
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const sample = () => {
    const d = ctx.getImageData(4, 4, 32, 32).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
    const n = d.length / 4;
    return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
  };
  const out = {};
  for (const t of [0.5, 8.5, 17.5, 60.5, 120.5]) {
    const reel = J.bgVideoAt(t);
    let px = null, err = null;
    for (let i = 0; i < 250; i++) {
      err = null;                                  // a later success must clear an earlier throw
      ctx.clearRect(0, 0, 320, 180);
      const cut = { line: 0, start: t, dur: 4, seed: 2 };
      try { J.BG.media.draw({ ctx, W: 320, H: 180, t, cut, beat: null, plan: window.__plan }, {}); }
      catch (e) { err = e.message; }
      if (!err) { px = sample(); break; }          // the draw succeeded: that is the assertion
      await new Promise(r => setTimeout(r, 20));
    }
    out['t' + t] = { reel: reel ? reel.asset.name + '@' + reel.local.toFixed(2) : null,
                     px: px || ('no frame: ' + err) };
  }
  out.players = document.querySelectorAll('video').length;
  cv.remove();
  return out;
}
"""

async def main():
    clips = sorted(glob.glob(os.path.join(CLIPS, '*.mp4')))
    if not clips:
        print('FAIL: nenhum clipe em', CLIPS)
        sys.exit(1)
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page()
        msgs = []
        pg.on('console', lambda m: msgs.append(m.type + ': ' + m.text) if m.type in ('error', 'warning') else None)
        pg.on('pageerror', lambda e: msgs.append('pageerror: ' + str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(3000)
        if not await pg.evaluate('!!window.J'):
            print('FAIL: o app não carregou em', URL)
            sys.exit(1)
        print('setup ', json.dumps(await pg.evaluate(SETUP)))
        await pg.set_input_files('#bgSec input[type=file]', clips)
        for _ in range(180):
            st = await pg.evaluate(STATE)
            if len(st['assets']) + len(st['bad']) >= len(clips):
                break
            await asyncio.sleep(1)
        st = await pg.evaluate(STATE)
        print('assets', len(st['assets']), 'rejected', len(st['bad']))
        for r in st['bad']:
            print('   ', r)
        draw = await pg.evaluate(DRAW)
        print('draw  ', json.dumps(draw, indent=1))
        print('console')
        for m in msgs[:12]:
            print('   ', m[:200])
        await b.close()

        spots = [k for k in draw if k.startswith('t')]
        bad = [k for k in spots if draw[k]['reel'] is None or isinstance(draw[k]['px'], str)]
        if bad:
            print('FAIL: sem quadro em', bad)
            sys.exit(1)
        print('OK: a rola pintou em', ', '.join(sorted(k for k in draw if k.startswith('t'))))

asyncio.run(main())