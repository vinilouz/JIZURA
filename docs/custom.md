# Local layers on top of JIZURA

This fork tracks the official repo (`upstream`, `https://github.com/852wa/JIZURA.git`) and adds three things the official repo does not have. Everything local lives in `src/99_custom_*.js`, so pulling the official repo in is a merge that does not conflict.

## The layering rule

`build.py` builds the single-file web app like this:

```python
sources = sorted(glob.glob('src/*.js'))
```

Files are concatenated in sorted order, so anything named `99_*` loads **after** the official `00_*` through `12_ui.js`. That is the whole extension seam: a local file can wrap any `J.*` function, register new expression packs, or inject UI, without editing a single official line.

Official files are edited only where there is no seam. Today that is three lines in `src/08_planner.js` (see "Cuts inside a line" below).

## Local capabilities

### Cuts follow the beat

The flow is: load the music, paste lyrics with LRC timestamps, set the visuals, export the MP4. Nothing is pointed at, tapped, or dragged.

`src/99_custom_beat.js` snaps the LRC timestamps and any `timing.lineTimes` **before** the official `J.computeTiming` reads them. That matters: the official function clamps fixed times to stay monotonic, squeezes estimated runs between them, and derives `ends` and `duration` from the result. Snapping its output afterwards would leave `ends` and `duration` stale. Snapping its input lets the official code produce one consistent answer.

`src/08_planner.js`, three lines: the snap tolerance used for cuts *inside* a line. It stays in the official file because cut parameters (`params`, `inDur`, `outDur`) are derived from `dur` inside `J.plan`, before `makeCut` is called. Re-planning a line from outside would leave those stale, so this cannot be wrapped.

### Favicon

`favicon.svg` at the repo root. `build.py` injects the `<link rel="icon">` with the correct relative path per edition: `favicon.svg` at the root, `../favicon.svg` inside `en/`, `ko/`, `vi/` and the rest.

### Backgrounds (images and video)

See `docs/custom-todo.md` for the state of this work.

## House rules

**No fallbacks.** Either the request is implemented exactly, or it raises. A browser without `WebCodecs` gets an error, not a degraded still frame. There is no silent default, no "if it is missing, use something else", no `||` papering over missing data. This is a deliberate choice: a video project that silently renders a still frame looks like it worked.

**No dead code.** A capability is only implemented when something consumes it in the same task.

## Updating from the official repo

```bash
tools/update.sh
```

That fetches `upstream`, merges `upstream/main`, rebuilds every edition, and runs `dev/beat_test.py`. The test fails loudly if any cut lands off the beat grid.

If the merge touches `src/08_planner.js` or `build.py`, resolve by keeping the official version and re-applying the local hunks listed above. Nothing else should ever conflict.

The version of a local build is the pair of commit hashes, printed by `tools/update.sh`. The official `VERSION` file is deliberately not edited: the owner bumps it on every release, so changing it would conflict on every single merge for no benefit.

## Tests

| command | what it proves |
|---|---|
| `python3 build.py --dev` then `python3 dev/beat_test.py` | line starts land on the detected beat grid; the snap toggle is respected; cuts stay in order and never end before they start; render throws nothing |
| `python3 build.py --dev` then `python3 dev/audio_test.py` | onset / downbeat / bar length / silence detection is correct on a synthetic signal |
| `python3 dev/build_test.py t_all --all-packs` then serve `dev/www` and run `python3 dev/smoke_all.py t_t_all` | every registered expression still renders without exceptions (official test, ~700 expressions) |

Both local tests exit non-zero on failure and never skip.

## Remotes and branches

- `upstream` — official repo, read only.
- `origin` — the user's fork on GitHub.
- `upstream-plus` — the working branch: official repo plus the local layers.
- `backup-fork-2026-10-14` and tag `backup-f9e0ae6` — the previous fork (EN/JP i18n, word-level cuts, image backgrounds). Kept for reference; its pull request was closed by the owner as superseded.
- `backup-port-4feat` — an earlier attempt at porting those four features onto v0.10.1.
