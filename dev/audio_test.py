"""Audio analysis check: onset / downbeats / barLen / silences on a synthetic 120 BPM click track.

usage: python3 build.py --dev && python3 dev/audio_test.py
fails loudly — no fallback, no skip. Run after every `tools/update.sh`.
"""
import asyncio, json, os, sys
from playwright.async_api import async_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, 'dev', 'www', 'test.html')
PAGE = 'file://' + HTML

# 6 s at 48 kHz: 8 percussive clicks at 120 BPM (0.5 s apart, 0.5..4.0 s), true silence after
CHECK = r"""
async () => {
  const SR = 48000, DUR = 6, RATE = 50, BPM = 120, CLICKS = 8;
  const len = SR * DUR, hop = Math.round(SR / RATE), n = Math.floor(len / hop);
  const clickLen = Math.round(SR * 0.015);
  const click = new Float32Array(clickLen);
  for (let i = 0; i < clickLen; i++) click[i] = 0.9 * Math.sin(2 * Math.PI * 120 * i / SR) + 0.5 * Math.sin(2 * Math.PI * 2000 * i / SR);
  const buffer = new AudioBuffer({ length: len, sampleRate: SR, numberOfChannels: 1 });
  const d = buffer.getChannelData(0);
  const beatTimes = Array.from({ length: CLICKS }, (_, i) => (i + 1) * 60 / BPM);
  for (const t of beatTimes) { const at = Math.round(t * SR); for (let i = 0; i < clickLen; i++) d[at + i] = click[i]; }
  // energy exactly like upstream: RMS per hop, normalised by p95
  const raw = new Float32Array(n);
  for (let f = 0; f < n; f++) { let e = 0; for (let i = f * hop; i < (f + 1) * hop; i++) e += d[i] * d[i]; raw[f] = Math.sqrt(e / hop); }
  const sorted = Array.from(raw).sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const energy = new Float32Array(n);
  for (let f = 0; f < n; f++) energy[f] = Math.min(1, raw[f] / p95);

  const res = J.localAudioAnalysis(buffer, energy, RATE, beatTimes);
  const onset = Array.from(res.onset);
  const frameOf = (t) => Math.round(t * RATE);
  const peaks = beatTimes.map(t => { let m = 0; for (let f = Math.max(0, frameOf(t) - 1); f <= frameOf(t) + 5 && f < n; f++) m = Math.max(m, onset[f]); return +m.toFixed(3); });
  let away = 0;
  for (let f = 0; f < n; f++) if (!beatTimes.some(t => f >= frameOf(t) - 2 && f <= frameOf(t) + 6)) away = Math.max(away, onset[f]);

  let throwMsg = '';
  try { J.localAudioAnalysis(null, energy, RATE, beatTimes); } catch (e) { throwMsg = e.message; }

  const project = Object.assign(J.defaultProject(), { lyrics: 'One line\nTwo lines\nThree' });
  const audio = { beats: beatTimes, energy, energyRate: RATE, duration: DUR, downbeats: res.downbeats, barLen: res.barLen, silences: res.silences };
  const withAudio = J.plan(project, audio);
  const noAudio = J.plan(project, null);

  // the real wrapper: same buffer as a WAV, decoded by upstream J.analyzeAudio
  const blob = J.audioWav(buffer, DUR);
  const analyzed = await J.analyzeAudio(new File([blob], 'clicks120.wav', { type: 'audio/wav' }));

  return {
    barLen: res.barLen, downbeats: res.downbeats, downbeatsLen: res.downbeats.length,
    expectedDownbeats: Math.ceil(beatTimes.length / res.barLen),
    inBeats: res.downbeats.every(v => beatTimes.includes(v)),
    peaks, away: +away.toFixed(3), throwMsg, silences: res.silences,
    propagated: withAudio.downbeats === audio.downbeats && withAudio.barLen === res.barLen && withAudio.silences === audio.silences,
    absentWithoutAudio: !('downbeats' in noAudio) && !('barLen' in noAudio) && !('silences' in noAudio),
    wrapper: ['onset', 'downbeats', 'barLen', 'silences'].filter(k => k in analyzed),
  };
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
        r = await pg.evaluate(CHECK)
        await b.close()

    print('analysis', json.dumps(r))

    if errs: fail('console errors: ' + '; '.join(errs[:5]))
    if not isinstance(r['barLen'], int) or r['barLen'] not in (2, 3, 4):
        fail(f"barLen must be 2/3/4, got {r['barLen']}")
    if r['downbeatsLen'] != r['expectedDownbeats']:
        fail(f"downbeats {r['downbeatsLen']} != ceil(beats/barLen) {r['expectedDownbeats']}")
    if not r['inBeats']: fail('a downbeat is not one of the beats')
    weak = [i for i, p in enumerate(r['peaks']) if p < 1]
    if weak: fail(f'no onset peak near click(s) {weak}: {r["peaks"]}')
    if r['away'] > 0.5: fail(f'onset peak away from every click: {r["away"]}')
    if not r['throwMsg']: fail('missing audioBuffer must throw with a message')
    if not [s for s in r['silences'] if 3.9 < s[0] < 4.5 and s[1] >= 5.9]:
        fail(f'silence after the last click not found: {r["silences"]}')
    if not r['propagated']: fail('J.plan did not copy downbeats/barLen/silences from audio')
    if not r['absentWithoutAudio']: fail('J.plan with audio=null must not gain the fields')
    if len(r['wrapper']) != 4: fail(f'J.analyzeAudio missing analysis fields: {r["wrapper"]}')
    print('OK')

asyncio.run(main())
