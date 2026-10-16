"""As chaves de outputs batem com t.ts? Um clipe real do dono, medido.

usage: python3 dev/clip_probe.py [caminho.mp4]
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

CLIP = sys.argv[1] if len(sys.argv) > 1 else \
    '/var/home/vinilouz/Projetos/GHOSTLAB/channels/reveriofc/releases/T013/movie/clips/s1.mp4'
URL = 'http://127.0.0.1:5500/en/index.html'
ROUTE = 'http://127.0.0.1:5500/probe-clip.mp4'

PROBE = r"""
async (url) => {
  const buf = await (await fetch(url)).arrayBuffer();
  await J.video.open('probe', buf.slice(0));
  const t = J.video.DBG('probe').t;
  const before = { count: t.count, ts: t.ts.slice(0, 8), sorted: t.sorted.slice(0, 8),
                   keys: t.keys.slice(0, 5), dur: t.dur.slice(0, 4),
                   tsLast: t.ts.slice(-4), sortedLast: t.sorted.slice(-4) };
  let readyErr = null;
  try { await J.video.ready('probe', 0, J.video.WARM_US); } catch (e) { readyErr = e.message; }
  const d = J.video.DBG('probe');
  const outKeys = Array.from(d.outputs.keys()).sort((a, b) => a - b);
  return {
    before,
    readyErr,
    held: outKeys.length,
    outKeys: outKeys.slice(0, 8),
    outKeysLast: outKeys.slice(-4),
    // does any decoded timestamp line up with the demuxer's own timeline?
    hits: outKeys.filter(k => t.ts.includes(k)).length,
    tsInOut: outKeys.filter(k => t.ts.includes(k)).slice(0, 8),
    stats: J.video.stats('probe'),
  };
}
"""

async def main():
    if not os.path.exists(CLIP):
        print('FAIL: clip inexistente:', CLIP)
        sys.exit(1)
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--allow-file-access-from-files',
                                            '--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page()
        await pg.route(ROUTE, lambda route: route.fulfill(path=CLIP, content_type='video/mp4'))
        msgs = []
        pg.on('pageerror', lambda e: msgs.append('pageerror: ' + str(e)))
        await pg.goto(URL)
        await pg.wait_for_timeout(2500)
        print('clip ', os.path.basename(CLIP))
        try:
            r = await pg.evaluate(PROBE, ROUTE)
        except Exception as e:
            print('FAIL:', str(e)[:400])
            sys.exit(1)
        print(json.dumps(r, indent=1))
        for m in msgs[:6]:
            print('   ', m[:200])
        await b.close()

asyncio.run(main())