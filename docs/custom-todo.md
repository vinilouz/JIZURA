# TODO — local layers

State of the work on top of the official JIZURA repo. See `docs/custom.md` for how the layering works.

## Non-negotiable

No fallbacks. Either the request is implemented exactly or it raises. A browser without `WebCodecs` gets an error, not a degraded still frame. No silent defaults, no `||` covering missing data.

The flow is fixed and has no alternatives:

```
load music  ->  paste lyrics with LRC timestamps  ->  set the visuals  ->  video.mp4
```

No pointing at the timeline, no tapping, no drag-to-adjust, no grid/onset/hybrid mode picker. The LRC says which line is roughly when; the music says exactly where the cut falls.

---

## Phase 0 — layering (done)

- [x] Local code lives in `src/99_custom_*.js`, which loads last
- [x] `tools/update.sh` — fetch, merge, rebuild every edition, run the beat test
- [x] `dev/beat_test.py` — fails loudly if any cut lands off the beat grid
- [x] Favicon

## Phase 1 — what the audio knows (done)

- [x] `J.analyzeAudio` wrapped, not edited. Upstream computes `flux`/`onset` and throws them away in its return, so there is nothing internal to reuse; the wrapper recomputes from the values upstream already returns.
- [x] Low-band onset below 150 Hz, bar length 2/3/4 with ties going to 4, downbeat as the strongest low-band onset per bar, silence as energy under 0.15 for at least 0.8 s
- [x] `downbeats` / `barLen` / `silences` copied onto the plan when the audio carries them
- [x] `dev/audio_test.py` — synthetic click track, no external audio file
- Measured cost: about 190–205 ms per music load, no second decode

Manual BPM with no music file is a different input, not a degraded result: `12_ui.js` `audioLike()` returns only a beat grid, there is no audio to analyse, and nothing is written to the plan. Whoever needs onsets and finds none has to say so where it needs them.

## Phase 2 — cuts land on the attack

Chosen seam: re-plan through `overrides[li].cutTime`. Upstream applies `cutTime` before the unit loop, so `dur`, `params`, `inDur` and `outDur` are recomputed together. No official file is touched.

Measured on a 48-line, 175-cut project: 118 requested cut bounds, all 118 landing within 5 ms of an onset; 54 of 54 generic cuts with `inDur`/`outDur` matching the formula for the new `dur`; the `cutTime` block consumes no rng, so the rest of the plan is unchanged. Cost: 41.6 ms to about 84 ms per replan, which the existing debounced replan already absorbs.

Rejected: feeding onsets in place of the beat array (one line), because the snap tolerance is derived from the gap between the first two onsets and a sparse intro drags the bound.

- [ ] Each cut inside a line lands on the nearest onset within a fixed window
- [ ] Outside the window the official position stands — there is no attack there to follow
- [ ] Respect the detected bar when it is not 4
- [ ] Lines with a hand-set `cutTime` or a lock are left alone
- [ ] The clone carrying `cutTime` is discarded, so the UI keeps showing the line as automatic
- [ ] `dev/onset_test.py`

## Phase 3 — image backgrounds

- [ ] Register through `J.register('bg', …)` from a `99_*.js`, which puts it in the picker for free (`12_ui.js` techItems and the per-cut picker). Use `extra: true` so the randomiser never picks it by itself. Do not use `special: true`, which hides it from the picker entirely.
- [ ] UI injected by DOM after the audio section, `pro-only` so it disappears in easy mode. No edit to `body.html` or `12_ui.js`.
- [ ] Binaries in IndexedDB, mirroring the store `10_audio.js` already uses for audio. A data URL inside the project overflows, because the save path rewrites the whole JSON on every edit; an external `assets/` folder breaks the single-file build and `file://`.
- [ ] Multiple assets, distributed across cuts or across time ranges
- [ ] Ken Burns pan, blurred matte for portrait sources, grade overlay, vignette, beat-reactive zoom — these existed in the previous fork, in `backup-fork-2026-10-14:src/09_render.js`
- [ ] No fallback: a failed load raises
- [ ] The MP4 export already draws backgrounds (`11_export.js` to `09_render.js`), so images export with no official edit

## Phase 4 — video backgrounds

The frame hook is one line before the render call, a pump that throws if the frame is not ready. The real problem is upstream of that: `VideoDecoder` only accepts `EncodedVideoChunk`, and the repo vendors only the MP4 muxer, which writes. Reading the sample table and the decoder description out of an MP4 is its own project, not a one-line hook. A spike is measuring whether the `VideoDecoder` genuinely requires an own demuxer or whether an official path produces chunks without one.

- [ ] Decode with `WebCodecs.VideoDecoder`, sequential, window ahead of the render cursor
- [ ] Decode at the output resolution so the window fits in memory
- [ ] Smallest possible change to the export loop that lets the decoder feed it
- [ ] No fallback: without a decoder the export errors out. No frozen frame, no scrubbing substitute
- [ ] What breaks, to be handled rather than ignored: preview seeking breaks the monotonic `t`; range export needs a warm-up from the start offset; an encoder retry restarts the whole run

## Phase 5 — keeping it alive

- [x] `docs/custom.md` — the layers, how to update, which seams cannot be wrapped
- [x] `docs/custom-todo.md` — this file
- [ ] Run the official smoke test after every merge
- [ ] Decide what happens if the official repo rewrites `J.plan` or `J.computeTiming`

---

## Known limits

- The official `11_export.js` does not consume `bg` for the After Effects export. A local background does not reach the AE export. That is a gap, not a crash.
- A fixed BPM grid drifts on live or rubato recordings. That is why phase 2 lands cuts on onsets instead of only on the grid.
- Three lines in `src/08_planner.js` cannot be wrapped. Every official merge will touch that file; resolve by taking the official version and re-applying the three lines.
- MP4 demuxing may restrict video backgrounds to MP4. If so, that is a product restriction to state, not hide.
