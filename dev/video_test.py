"""Video background check: import -> demux -> decode -> draw, plus the named errors.

usage: python3 build.py --dev && python3 dev/video_test.py
fails loudly — no fallback, no skip.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'dev', 'www', 'test.html')
MUXER = os.path.join(ROOT, 'vendor', 'mp4-muxer.min.js')
PAGE = 'file://' + HTML

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
  return { panel: !!J.bgMount(sec), hasVideoDecoder: typeof VideoDecoder !== 'undefined', mux: typeof Mp4Muxer !== 'undefined' };
}
"""

# A 2 s H.264 clip built at runtime: 60 frames, four colours, 15 frames each.
MAKE_MP4 = r"""
async () => {
  const W = 320, H = 180, FPS = 30, N = 60;
  const COLOURS = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({ target, video: { codec: 'avc', width: W, height: H }, fastStart: 'in-memory' });
  let encErr = null, first = null;
  const venc = new VideoEncoder({
    output: (chunk, meta) => { if (meta && meta.decoderConfig) first = meta.decoderConfig.description.slice(0); muxer.addVideoChunk(chunk, meta); },
    error: e => { encErr = e; },
  });
  const cfg = { codec: 'avc1.42001f', width: W, height: H, bitrate: 800000, framerate: FPS, avc: { format: 'avc' } };
  const sup = await VideoEncoder.isConfigSupported(cfg);
  if (!sup.supported) throw new Error('test page cannot encode avc1.42001f');
  venc.configure(cfg);
  for (let i = 0; i < N; i++) {
    ctx.fillStyle = COLOURS[Math.floor(i / 15) % 4]; ctx.fillRect(0, 0, W, H);
    const f = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(f, { keyFrame: i % 30 === 0 });
    f.close();
    if (venc.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 0));
  }
  await venc.flush(); venc.close();
  if (encErr) throw encErr;
  muxer.finalize();
  window.__mp4 = target.buffer;
  return { bytes: target.buffer.byteLength, frames: N, fps: FPS, avcC: first ? Array.from(first.slice(0, 5)) : null };
}
"""

# import through the real panel input: one clip, one picture, and three broken files
IMPORT = r"""
async () => {
  const src = new Uint8Array(window.__mp4);
  const hevc = src.slice();                       // same file, sample entry relabelled
  // patch the sample entry inside stsd, not the 'avc1' brand in ftyp — patching the
  // brand leaves the file still H.264, so it would import instead of being rejected
  const at = (() => {
    const b = new TextEncoder().encode('avc1'), s = new TextEncoder().encode('stsd');
    let st = -1;
    for (let i = 0; i + 4 <= hevc.length; i++)
      if (hevc[i]===s[0]&&hevc[i+1]===s[1]&&hevc[i+2]===s[2]&&hevc[i+3]===s[3]) { st = i; break; }
    if (st < 0) throw new Error('no stsd in the muxed file');
    for (let i = st + 4; i + 4 <= hevc.length; i++)
      if (hevc[i]===b[0]&&hevc[i+1]===b[1]&&hevc[i+2]===b[2]&&hevc[i+3]===b[3]) return i;
    throw new Error('no avc1 sample entry after stsd');
  })();
  hevc.set(new TextEncoder().encode('hvc1'), at);
  const ftr = src.slice();                        // same file, moov cut out and a moof put in
  const moof = new Uint8Array([0,0,0,8,0x6d,0x6f,0x6f,0x66]);
  const fmp4 = new Uint8Array(moof.length + ftr.length);
  fmp4.set(moof, 0); fmp4.set(ftr, moof.length);
  const webm = new Uint8Array([0x1a,0x45,0xdf,0xa3, 0x01,0x02,0x03,0x04]);
  const dt = new DataTransfer();
  dt.items.add(new File([window.__mp4], 'clip.mp4', { type: 'video/mp4' }));
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const x = c.getContext('2d'); x.fillStyle = '#ff00ff'; x.fillRect(0, 0, 64, 64);
  const png = await new Promise(r => c.toBlob(r, 'image/png'));
  dt.items.add(new File([png], 'still.png', { type: 'image/png' }));
  dt.items.add(new File([webm], 'clip.webm', { type: 'video/webm' }));
  dt.items.add(new File([hevc], 'clip_hevc.mp4', { type: 'video/mp4' }));
  dt.items.add(new File([fmp4], 'clip_fmp4.mp4', { type: 'video/mp4' }));
  dt.items.add(new File([new Uint8Array([0,1,2,3,4,5,6,7,8,9])], 'junk.mp4', { type: 'video/mp4' }));
  const inp = document.querySelector('#bgSec input[type=file]');
  inp.files = dt.files;
  inp.dispatchEvent(new Event('change'));
  for (let i = 0; i < 600 && document.querySelectorAll('#bgAssetList li').length < 6; i++)
    await new Promise(r => setTimeout(r, 25));
  window.__vid = window.__p.bgAssets.find(a => a.type === 'video/mp4');
  return {
    assets: window.__p.bgAssets.map(a => a.name),
    meta: window.__vid ? { w: window.__vid.w, h: window.__vid.h, dur: window.__vid.dur } : null,
    bad: Array.from(document.querySelectorAll('#bgAssetList li.is-bad')).map(li => li.querySelector('.bg-name').textContent + ' | ' + li.querySelector('.bg-why').textContent),
    forLine: [0, 1, 2, 3].map(J.bgForLine).map(a => a && a.name),
  };
}
"""

DECODE = r"""
async () => {
  const a = window.__vid;
  await J.video.ready(a.id, 0.0);
  const first = J.video.stats(a.id);
  await J.video.ready(a.id, 1.2);                 // forward inside the window
  const mid = J.video.stats(a.id);
  await J.video.ready(a.id, 0.1);                 // backward: forces reset + refeed from a keyframe
  const back = J.video.stats(a.id);
  let cold = null;
  const v = J.video;
  try {            // cold backward seek: must reset, refeed from the keyframe and land on the right frame
    await v.ready(a.id, 1.9);
    await new Promise(r => setTimeout(r, 0));
    await v.ready(a.id, 0.05);
    cold = 'ok';
  } catch (e) { cold = e.message; }
  return { first, mid, back, cold, codec: J.video.stats(a.id) };
}
"""

# the draw itself: the right colour at the right time, through J.BG.media.draw
DRAW = r"""
async () => {
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
  const ctx = cv.getContext('2d');
  const plan = J.plan(window.__p, null);
  const hueAt = (line, t) => {
    ctx.clearRect(0, 0, 320, 180);
    const cut = { line, start: t, dur: 2, seed: 2 };
    J.BG.media.draw({ ctx, W: 320, H: 180, t, cut, beat: null, plan }, {});
    const d = ctx.getImageData(4, 4, 32, 32).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
    const n = d.length / 4;
    return [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
  };
  const v = window.__vid;
  const out = {};
  for (const t of [0.2, 0.7, 1.2, 1.7]) {
    await J.video.ready(v.id, t);
    out['t' + t] = hueAt(0, t);                   // line 0 rotates to the video (clip.mp4 first)
  }
  await J.video.ready(v.id, 1.2);
  out.line1 = hueAt(1, 1.2);                      // line 1 rotates to the picture (still.png)
  await J.video.ready(v.id, 1.2);
  out.line2 = hueAt(2, 1.2);                      // line 2 wraps back to the video
  return out;
}
"""

NO_DECODER = r"""
async () => {
  const keep = window.VideoDecoder;
  let msg = null, open = null;
  try {
    delete window.VideoDecoder;
    try { J.video.require(); msg = 'no throw'; } catch (e) { msg = e.message; }
    // still inside the window where the decoder is gone: open must refuse too
    try { await J.video.open('probe', new Uint8Array([0,0,0,8,0x66,0x74,0x79,0x70]).buffer); open = 'no throw'; }
    catch (e) { open = e.message; }
  } catch (e) { msg = msg || e.message; }
  window.VideoDecoder = keep;
  return { guard: msg, open };
}
"""

DROP = r"""
async () => {
  const id = window.__vid.id;
  const after = await J.bgRemove(id);
  let msg = null;
  try { J.video.frame(id, 0.5); msg = 'no throw'; } catch (e) { msg = e.message; }
  return { assets: window.__p.bgAssets.length, closed: after, msg };
}
"""

def fail(msg):
    print('FAIL:', msg)
    sys.exit(1)

async def main():
    for p in (HTML, MUXER):
        if not os.path.exists(p):
            fail(f'{p} missing — run `python3 build.py --dev` first')
    async with async_playwright() as pw:
        b = await pw.chromium.launch(args=['--allow-file-access-from-files'])
        pg = await b.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        await pg.goto(PAGE)
        await pg.wait_for_function('window.J && window.T')
        await pg.add_script_tag(path=MUXER)
        await pg.wait_for_function('window.Mp4Muxer')

        setup = await pg.evaluate(SETUP)
        made = await pg.evaluate(MAKE_MP4)
        imported = await pg.evaluate(IMPORT)
        print('setup   ', json.dumps(setup))
        print('mp4     ', json.dumps(made))
        print('import  ', json.dumps(imported))
        if imported['meta'] is None:
            await b.close()
            fail('the clip was not imported: ' + json.dumps(imported))
        decode = await pg.evaluate(DECODE)
        draw = await pg.evaluate(DRAW)
        nodec = await pg.evaluate(NO_DECODER)
        drop = await pg.evaluate(DROP)
        await b.close()




    print('decode  ', json.dumps(decode))
    print('draw    ', json.dumps(draw))
    print('noDec   ', json.dumps(nodec))
    print('drop    ', json.dumps(drop))
    print('rejected')
    for r in imported['bad']:
        print('   ', r)

    if errs: fail('console errors: ' + '; '.join(errs[:5]))
    if not setup['panel']: fail('the panel did not mount')
    if not setup['hasVideoDecoder']: fail('chromium has no VideoDecoder — the test cannot run here')
    if made['bytes'] < 1000: fail('the generated mp4 is suspiciously small: ' + json.dumps(made))
    if imported['assets'] != ['clip.mp4', 'still.png']:
        fail('import order wrong: ' + json.dumps(imported['assets']))
    if imported['meta'] is None or imported['meta']['w'] != 320 or imported['meta']['h'] != 180:
        fail('video metadata wrong: ' + json.dumps(imported['meta']))
    if abs(imported['meta']['dur'] - 2.0) > 0.15:
        fail('duration from mvhd is wrong: ' + json.dumps(imported['meta']))
    if imported['forLine'] != ['clip.mp4', 'still.png', 'clip.mp4', 'still.png']:
        fail('the rotation does not mix image and video per line: ' + json.dumps(imported['forLine']))

    names = {r.split(' | ')[0]: r.split(' | ', 1)[1] for r in imported['bad']}
    want = {
        'clip.webm': 'WebM',
        'clip_hevc.mp4': 'HEVC',
        'clip_fmp4.mp4': 'fragmented MP4',
        'junk.mp4': 'not an MP4/MOV',
    }
    for name, needle in want.items():
        if name not in names: fail(f'{name} was not rejected at all')
        if needle not in names[name]: fail(f'{name} error is not named ({needle}): ' + names[name])
    if 'moov' in names.get('clip.webm', ''): fail('the WebM file reported a missing moov')

    if decode['first']['fed'] < 30: fail('the decoder barely fed anything: ' + json.dumps(decode['first']))
    if decode['back']['seeks'] < 1: fail('a backward jump did not seek: ' + json.dumps(decode['back']))
    if decode['back']['held'] > 400: fail('the window is not bounded: ' + json.dumps(decode['back']))
    if decode['cold'] != 'ok': fail('cold backward seek failed: ' + json.dumps(decode['cold']))
    if decode['codec']['seeks'] < 4: fail('the seeks did not go through reset+refeed: ' + json.dumps(decode['codec']))

    def hue(px):
        r, g, b = px
        # the sampled region is averaged and graded down, so classify by relation, not by level
        if abs(r - g) < 40 and b < min(r, g) * 0.5: return 'y'
        return ['r', 'g', 'b'][max(range(3), key=lambda i: px[i])]
    # 60 frames of 320x180 at 30fps, four colours, 15 frames (0.5 s) each
    want_hue = {'t0.2': 'r', 't0.7': 'g', 't1.2': 'b', 't1.7': 'y'}
    for k, v in want_hue.items():
        if hue(draw[k]) != v:
            fail(f'wrong colour at {k}s (expected {v}): ' + json.dumps(draw))
    if hue(draw['line1']) != 'm' and max(draw['line1']) - min(draw['line1']) < 60:
        fail('line 1 did not draw the picture: ' + json.dumps(draw))
    if hue(draw['line2']) != hue(draw['t1.2']):
        fail('line 2 did not wrap back to the video: ' + json.dumps(draw))

    if 'VideoDecoder' not in nodec['guard']: fail('no guard for a missing VideoDecoder: ' + json.dumps(nodec))
    if 'VideoDecoder' not in nodec['open']: fail('open() accepted a file with no VideoDecoder: ' + json.dumps(nodec))
    if drop['assets'] != 1: fail('removing the video did not leave the picture: ' + json.dumps(drop))
    if 'no throw' in str(drop['msg']): fail('a removed video asset is still drawable: ' + json.dumps(drop['msg']))
    print('OK')

asyncio.run(main())
