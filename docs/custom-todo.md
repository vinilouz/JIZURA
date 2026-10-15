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

## Phase 1 — what the audio knows (in progress)

- [x] `analyzeAudio` returns `buffer`, `energy`, `energyRate`, `beats` — verified
- [ ] Expose `onset` without touching `src/10_audio.js`, by re-deriving from the values it already returns
- [ ] Downbeat: strongest low-band onset per bar
- [ ] Bar length: candidates 2 / 3 / 4 scored on low-band onset, tie falls back to 4
- [ ] Silence: energy below 0.15 sustained for at least 0.8 s
- [ ] Copy `downbeats` / `barLen` / `silences` onto the plan so the renderer can read them
- [ ] `dev/audio_test.py` — synthetic signal with a known click tempo, no external audio file

Terms, so nobody says "bass" again: an **onset** is an attack. A **kick** is the low drum, roughly 50–100 Hz, percussive. A **bass** note is sustained, so cutting on one cuts through the middle of the note. A **downbeat** is beat one of a bar.

## Phase 2 — cuts land on the attack (blocked on Gate A)

The official planner spreads cuts inside a line by character weight (`acc += D * u.w / tot`) and then snaps with a tolerance. Snapping to the BPM grid is not the same as landing on the attack.

- [ ] Decide the seam (Gate A): whether this needs an edit inside `J.plan` or can be wrapped
- [ ] Place each cut on the nearest detected onset inside the line's span
- [ ] Respect the bar when the detected bar length is not 4
- [ ] Keep the line start behaviour from Phase 0: snapped by `src/99_custom_beat.js`
- [ ] Extend `dev/beat_test.py` to assert cuts inside a line land on onsets, not on uniform fractions

## Phase 3 — image backgrounds

- [ ] Register as `bg` so the official picker, per-line assignment, randomisation and locks pick it up for free
- [ ] Multiple assets, distributed across cuts or across time ranges
- [ ] Ken Burns pan, blurred matte for portrait sources, grade overlay, vignette, beat-reactive zoom — these existed in the previous fork, in `backup-fork-2026-10-14:src/09_render.js`, and are worth porting rather than rewriting
- [ ] Decide where the binaries live (Gate A question 3): data URL inside the saved project, IndexedDB, or an external `assets/` folder fetched at runtime. The single-file app is already 2.4 MB, so multiple images and videos decide this, not images alone
- [ ] No fallback: a failed load raises, it does not silently draw a procedural background

## Phase 4 — video backgrounds (blocked on Gate A)

The export walks frames with a monotonic `t` (`R.frame(ctx, plan, span.t0 + i / fps)`), so a video never needs seeking. It needs decoding ahead of the cursor in a sliding window and dropping frames once consumed.

- [ ] Decode with `WebCodecs.VideoDecoder`, sequential, window ahead of the render cursor
- [ ] Decode at the output resolution, not the source resolution, to keep the window inside memory
- [ ] Smallest change to `src/11_export.js` that lets the decoder feed the frame loop (Gate A question 3)
- [ ] No fallback: no `VideoDecoder` means the export errors out. No frozen frame, no `<video>` scrubbing substitute
- [ ] Measure the real memory cost before choosing the window size

## Phase 5 — keeping it alive

- [x] `docs/custom.md` — what the layers are, how to update, which seams cannot be wrapped
- [x] `docs/custom-todo.md` — this file
- [ ] Run `dev/smoke_all.py` (the official ~700-expression smoke test) after every merge
- [ ] Version scheme for the local build
- [ ] Decide what happens if the official repo rewrites `J.plan` or `J.computeTiming`

---

## Known limits

- The official `11_export.js` does not consume `bg` at all. A local background does not reach the After Effects export. That is a gap, not a crash, and fixing it means teaching the AE panel a new part type.
- A fixed BPM grid drifts on live or rubato recordings. That is why Phase 2 lands cuts on onsets instead of only on the grid.
- Three lines in `src/08_planner.js` cannot be wrapped. Every official merge will touch that file; resolve by taking the official version and re-applying the three lines.
