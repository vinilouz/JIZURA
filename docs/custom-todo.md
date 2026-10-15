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
- [x] `tools/update.sh` — fetch, merge, rebuild every edition, run all five local tests
- [x] `dev/beat_test.py` — fails loudly if any cut lands off the beat grid
- [x] Favicon

## Phase 1 — what the audio knows (done)

- [x] `J.analyzeAudio` wrapped, not edited. Upstream computes `flux`/`onset` and throws them away in its return, so there is nothing internal to reuse; the wrapper recomputes from the values upstream already returns.
- [x] Low-band onset below 150 Hz, bar length 2/3/4 with ties going to 4, downbeat as the strongest low-band onset per bar, silence as energy under 0.15 for at least 0.8 s
- [x] `downbeats` / `barLen` / `silences` copied onto the plan when the audio carries them
- [x] `dev/audio_test.py`
- Measured cost: about 190–205 ms per music load, no second decode

Manual BPM with no music file is a different input, not a degraded result: `12_ui.js` `audioLike()` returns only a beat grid, there is no audio to analyse, and nothing is written to the plan.

## Phase 2 — cuts land on the attack (done)

Re-plans through `overrides[li].cutTime`, which the official planner applies before the unit loop, so `dur`, `params`, `inDur` and `outDur` are recomputed together. No official file touched.

Measured on a 48-line, 143-cut project: every requested cut bound landed within 5 ms of an onset; the second plan pass costs about 14 ms, inside the debounce the official replan already uses.

Rejected: feeding onsets in place of the beat array (one line), because the snap tolerance is derived from the gap between the first two onsets and a sparse intro drags the bound.

- [x] Each cut inside a line lands on the nearest onset within a fixed window
- [x] Outside the window the official position stands — there is no attack there to follow
- [x] Respect the detected bar when it is not 4
- [x] Lines with a hand-set `cutTime` or a lock are left alone
- [x] The clone carrying `cutTime` is discarded, so the editor keeps showing the line as automatic
- [x] `dev/onset_test.py`

## Phase 3 — image backgrounds (done)

- [x] Registered through `J.register('bg', …)` from a `99_*.js`, which puts it in the picker for free
- [x] UI injected by DOM after the audio section, `pro-only` so it disappears in easy mode
- [x] Binaries in IndexedDB, mirroring the store `10_audio.js` already uses
- [x] One asset per line in import order; up and down reorder
- [x] Ken Burns pan, blurred matte for portrait sources, grade, vignette, downbeat zoom — ported from the previous fork
- [x] No fallback: a failed load stays visible in the panel as an item that can be dismissed
- [x] The MP4 export draws backgrounds with no official edit
- [x] `dev/bg_test.py`

## Phase 4 — video backgrounds (done)

- [x] Own MP4 demuxer: `stts`/`ctts`/`stsz`/`stco`/`stsc`/`stss` plus the `elst` edit list, which MP4s with B-frames need or every timestamp lands 66 ms off
- [x] `WebCodecs.VideoDecoder` fed through a sliding window, sequential, never seeking forward
- [x] Videos enter the same panel and the same per-line rotation as the pictures
- [x] A backward seek resets the decoder and refills from the keyframe at or before the target
- [x] No fallback: no decoder means an error; a frame that is not decoded yet means an error, never a repeated frame
- [x] `dev/video_test.py`

Format restrictions, stated rather than hidden:

- MP4 and MOV with H.264 (`avc1`/`avc3`).
- HEVC, WebM and fragmented MP4 each get a named error explaining why.
- Rotation metadata is ignored, so phone video comes out sideways.

## Phase 5 — keeping it alive

- [x] `docs/custom.md` — the layers, how to update, which seams cannot be wrapped
- [x] `docs/custom-todo.md` — this file
- [ ] Run the official smoke test after every merge
- [ ] Decide what happens if the official repo rewrites `J.plan` or `J.computeTiming`

---

## Decisions

- **The LRC is the base.** It says when each line is; the music only refines where a cut lands inside the line. When there is no attack near the ideal position, the official position stands. That is not a fallback: it is the absence of the event.
- **English is the interface.** The Japanese and Korean editions stay because the songs are in those languages, but only the English strings matter for day-to-day use. No other translations will be added.
- **The After Effects export is out of scope.** It is not used, so the official gap there is not worked around.

---

## Known limits

- A fixed BPM grid drifts on live or rubato recordings. That is why phase 2 lands cuts on onsets instead of only on the grid.
- Three lines in `src/08_planner.js` cannot be wrapped. Every official merge will touch that file; resolve by taking the official version and re-applying the three lines.
- The Chinese, Korean and Indonesian editions show the Japanese panel text and the Japanese background name. English and Japanese are complete.