/* ============================================================
   JIZURA — local: background media (the owner's own pictures)
   Loads last (build.py does sorted(glob.glob('src/*.js')), and 99_ > 12_).

   One asset per line, in import order, `↑ ↓` decides that order. No band
   table, no editor: the per-cut picker that already exists is the override.

   project.bgAssets = [{id, name, type, w, h}]  — metadata only, the bytes live
   in IndexedDB ('jizura' / 'files' / 'bg:<id>'), because flushSave rewrites the
   whole project JSON on every keystroke and a data URL per image would blow it up.
   ============================================================ */
(() => {
'use strict';

if (!J.register) throw new Error('99_custom_bgs: J.register is missing — nothing to register');
if (!J.plan) throw new Error('99_custom_bgs: J.plan is missing — the project is never seen');

/* ---------------------------------------------------------------- strings */
/* Japanese is the source language of the app, so every lang other than English
   gets Japanese: the strings are not a degraded translation of a missing feature. */
const STR = {
  ja: {
    h2: () => '背景素材',
    add: () => '画像・動画を追加',
    addTitle: () => '画像・動画（複数可）',
    empty: () => 'まだ何もありません。画像や動画を読むと、カットの順番で自動で背景が切り替わります',
    one: () => 'すべてのカットにこの画像が使われます',
    count: n => `${n}点`,
    bgName: () => '画像・動画',
    rm: n => `${n} を削除`,
    up: () => '上へ',
    down: () => '下へ',
    note: () => '読み込んだ画像は「手法 → 背景」のセレクターと、カットごとの差し替えに出ます',
    loading: (k, n) => `読み込み中… ${k}/${n}`,
    errType: n => `${n} は対応していません（画像: jpg / png / webp / gif、動画: mp4 / mov（H.264））`,
    errDecode: n => `${n} を読み込めませんでした（壊れているか、対応しない形式です）`,
    apply: () => '背景に適用',
    applyTitle: () => 'すべての行の背景にこちらを使います',
    applied: n => `${n}行に適用しました`,
    errWebM: n => `${n}: WebM は対応していません（EBML 形式の demux が必要です）。MP4 / mov（H.264）を使ってください`,
    errIdb: () => 'このブラウザではファイルを保存できません（プライベートモードなど）。再読み込みすると消えます',
    errPartial: (k, n) => `${n}点中 ${k}点を追加できませんでした`,
    added: n => `${n}点を追加しました`,
  },
  en: {
    h2: () => 'Background media',
    add: () => 'Add images / videos',
    addTitle: () => 'Images / videos (multiple)',
    empty: () => 'Nothing here yet. Add images and the background changes automatically, line by line.',
    one: () => 'Every cut uses this image.',
    count: n => `${n} items`,
    bgName: () => 'Pictures & videos',
    rm: n => `Remove ${n}`,
    up: () => 'Move up',
    down: () => 'Move down',
    note: () => 'Loaded images show up under Techniques → Background, and in the per-cut override picker.',
    loading: (k, n) => `Loading… ${k}/${n}`,
    errType: n => `${n} is not supported (images: jpg / png / webp / gif, video: mp4 / mov with H.264).`,
    errDecode: n => `Could not read ${n} (corrupt file or unsupported format).`,
    apply: () => 'Apply as background',
    applyTitle: () => 'Use these as the background of every line',
    applied: n => `Applied to ${n} lines`,
    errWebM: n => `${n}: WebM is not supported — it needs an EBML demuxer. Use MP4 or MOV with H.264.`,
    errIdb: () => 'This browser cannot store files (private mode?). Reloading will lose them.',
    errPartial: (k, n) => `Could not add ${k} of ${n}`,
    added: n => `Added ${n}`,
  },
};
const T = (document.documentElement.lang === 'en' ? STR.en : STR.ja);

const X_GONE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const ICON_STYLE = `#bgSec ol { list-style: none; margin: 8px 0; padding: 0; max-height: 40vh; overflow: auto; }
#bgSec li.bg-asset { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); }
#bgSec .bg-thumb { width: 56px; aspect-ratio: 16 / 9; background: var(--ink); border-radius: var(--r); overflow: hidden; flex: none; }
#bgSec .bg-thumb canvas { width: 100%; height: 100%; display: block; }
#bgSec .bg-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#bgSec li.is-bad .bg-name { color: var(--danger); }
#bgSec .bg-why { font-size: 11px; }
#bgSec label.file { margin: 4px 0 8px; }`;

/* ---------------------------------------------------------------- storage */
/* Same database and store as the song and the fonts (10_audio.js) — one open. */
const IDB = { db: null };
const idb = () => IDB.db || (IDB.db = new Promise((res, rej) => {
  if (typeof indexedDB === 'undefined') return rej(new Error('no IndexedDB'));
  const r = indexedDB.open('jizura', 1);
  r.onupgradeneeded = () => { r.result.createObjectStore('files'); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const idbPut = async (key, val) => {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(val, key);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
};
const idbGet = key => idb().then(db => new Promise((res, rej) => {
  const q = db.transaction('files', 'readonly').objectStore('files').get(key);
  q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
}));
const idbDel = key => idb().then(db => new Promise(res => {
  const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').delete(key);
  tx.oncomplete = res; tx.onerror = res;
}));

/* ---------------------------------------------------------------- assets */
const decoded = new Map();   // id -> ImageBitmap, in memory for the renderer and the thumbnails
let current = null;          // the last project the planner saw; bgAssets is written here only
let lastPlan = null;         // its result: how many lines there are to apply a background to
let seq = 0;

const need = () => {
  if (!current) throw new Error('99_custom_bgs: no project yet — plan once before touching background media');
  return current.bgAssets;
};
const assets = () => (current && Array.isArray(current.bgAssets) ? current.bgAssets : []);

const ACCEPTED = { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'image/gif': 1, 'video/mp4': 1, 'video/quicktime': 1 };
/* a rejected format gets named, not just listed among the accepted ones */
const NAMED_TYPE = { 'video/webm': T.errWebM };
const isVideo = a => a.type === 'video/mp4' || a.type === 'video/quicktime';

/* decode + store one file; a rejection comes back as {name, why} and stays visible in the panel */
const accept = async (file) => {
  if (!ACCEPTED[file.type]) return { name: file.name, why: (NAMED_TYPE[file.type] || T.errType)(file.name) };
  const id = `bg${Date.now().toString(36)}${(seq++).toString(36)}`;
  if (isVideo({ type: file.type })) {
    // demux and configure the decoder now: an unsupported container or codec is
    // named at import time instead of failing later inside the render
    let info;
    try {
      info = await J.video.open(id, await file.arrayBuffer());
    } catch (e) {
      return { name: file.name, why: `${file.name}: ${e.message}` };
    }
    try {
      await idbPut('bg:' + id, file);
    } catch (e) {
      J.video.drop(id);
      return { name: file.name, why: T.errIdb() };
    }
    return { asset: { id, name: file.name, type: file.type, w: info.w, h: info.h, dur: info.dur } };
  }
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch (e) {
    return { name: file.name, why: T.errDecode(file.name) };
  }
  try {
    await idbPut('bg:' + id, file);
  } catch (e) {
    bmp.close();
    return { name: file.name, why: T.errIdb() };
  }
  decoded.set(id, bmp);
  return { asset: { id, name: file.name, type: file.type, w: bmp.width, h: bmp.height } };
};

/* the whole import; `onStep(done, total)` drives the "Loading… 2/5" line */
J.bgImport = async (files, onStep) => {
  const items = Array.from(files);
  const out = [], bad = [];
  let done = 0;
  for (const f of items) {
    if (onStep) onStep(++done, items.length);
    const r = await accept(f);
    if (r.asset) out.push(r.asset); else bad.push({ name: r.name, why: r.why });
  }
  const list = need();
  for (const a of out) list.push(a);
  return { added: out, bad };
};

J.bgRemove = async (id) => {
  const list = need(), i = list.findIndex(a => a.id === id);
  if (i < 0) throw new Error(`99_custom_bgs: no background asset ${id}`);
  const asset = list[i];
  list.splice(i, 1);
  if (isVideo(asset)) J.video.drop(id);
  const bmp = decoded.get(id);
  if (bmp) bmp.close();
  decoded.delete(id);
  await idbDel('bg:' + id);
};

J.bgMove = (id, dir) => {
  const list = need(), i = list.findIndex(a => a.id === id);
  if (i < 0) throw new Error(`99_custom_bgs: no background asset ${id}`);
  const j = i + dir;
  if (j < 0 || j >= list.length) return false;
  list.splice(j, 0, list.splice(i, 1)[0]);
  return true;
};

/* which asset a line gets — the rotation the panel documents */
J.bgForLine = (line) => {
  const list = assets();
  if (!list.length) return null;
  const l = line < 0 ? 0 : line;
  return list[((l % list.length) + list.length) % list.length];
};

/* re-read the bytes after a reload: the metadata is in the project, the picture is not */
J.bgRestore = async () => {
  const list = assets();
  for (const a of list) {
    if (decoded.has(a.id)) continue;
    const blob = await idbGet('bg:' + a.id);
    if (!blob) throw new Error(`99_custom_bgs: ${a.name} is missing from IndexedDB`);
    if (isVideo(a)) await J.video.open(a.id, await blob.arrayBuffer());
    else decoded.set(a.id, await createImageBitmap(blob));
  }
};

/* ---------------------------------------------------------------- drawing */
/* Ported from the pre-fork renderer: Ken Burns pan, a blurred matte behind a
   portrait, the atmospheric grade, the vignette and the beat zoom. */
const isDownbeat = env => {
  const pl = env.plan, b = env.beat;
  if (!pl || !Array.isArray(pl.downbeats) || !pl.downbeats.length || !b) return false;
  return pl.downbeats.indexOf(pl.beats[b.index]) >= 0;
};

const drawMedia = env => {
  const list = assets();
  if (!list.length) return;                    // nothing loaded: the editor background stays as it is
  const cut = env.cut;
  if (!cut) throw new Error('99_custom_bgs: background media needs a cut to rotate over');
  const asset = J.bgForLine(cut.line);
  const vid = isVideo(asset);
  const img = vid ? J.video.frame(asset.id, env.t) : decoded.get(asset.id);
  if (!img) throw new Error(`99_custom_bgs: ${asset.name} is not decoded yet`);
  const rot = vid ? J.video.rotation(asset.id) : 0;
  const ctx = env.ctx, W = env.W, H = env.H, u = H / 1080;
  const iw = vid ? img.displayWidth : img.width, ih = vid ? img.displayHeight : img.height;
  const down = isDownbeat(env);
  const pulse = env.beat && env.beat.since < 0.25 ? 0.9 * Math.exp(-env.beat.since * 16) : 0;
  const prog = J.clamp((env.t - cut.start) / Math.max(0.1, cut.dur));
  const zoom = 1 + 0.04 * prog + pulse * (down ? 0.045 : 0.022);
  const pan = (cut.seed % 2 === 0 ? 1 : -1);
  ctx.save();
  try {
  if (rot) {                                  // tkhd display matrix: phone videos are stored sideways
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.translate(-W / 2, -H / 2);
  }
  if (rot % 180 === 0 ? iw < ih * 0.85 : ih < iw * 0.85) {
    const dw0 = rot % 180 === 0 ? iw : ih, dh0 = rot % 180 === 0 ? ih : iw;
    const s = Math.max(W / dw0, H / dh0) * 1.05;
    if ('filter' in ctx) ctx.filter = 'blur(26px) brightness(0.42)';
    ctx.drawImage(img, (W - dw0 * s) / 2, (H - dh0 * s) / 2, dw0 * s, dh0 * s);
    ctx.filter = 'none';
    const fs = (H * 0.95 / dh0) * zoom, fw = dw0 * fs, fh = dh0 * fs;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = 32 * u;
    ctx.shadowOffsetY = 8 * u;
    ctx.drawImage(img, (W - fw) / 2 + pan * (prog - 0.5) * 24 * u, (H - fh) / 2 - (down ? pulse * 6 * u : 0), fw, fh);
  } else {
    const dw0 = rot % 180 === 0 ? iw : ih, dh0 = rot % 180 === 0 ? ih : iw;
    const s = Math.max(W / dw0, H / dh0) * zoom, dw = dw0 * s, dh = dh0 * s;
    ctx.drawImage(img,
      (W - dw) / 2 + pan * (prog - 0.5) * 35 * u,
      (H - dh) / 2 - pan * (prog - 0.5) * 20 * u - (down ? pulse * 7 * u : 0), dw, dh);
  }
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(7, 10, 18, 0.38)';
  ctx.fillRect(0, 0, W, H);
  const vig = ctx.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.30, W / 2, H * 0.5, Math.hypot(W, H) * 0.68);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(3, 5, 12, 0.65)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
  if (down && pulse > 0.25) {
    ctx.fillStyle = `rgba(255, 255, 255, ${pulse * 0.12})`;
    ctx.fillRect(0, 0, W, H);
  }
  } finally {
    ctx.restore();
    if (vid) img.close();   // a leaked VideoFrame kills the whole export
  }
};

// subtle: a busy layout drops the background unless the background is marked
// subtle (08_planner.js:443), which would blank the picture on those lines
J.register('bg', 'media', { name: T.bgName(), draw: drawMedia, subtle: true }, 'bgmedia');

/* ---------------------------------------------------------------- wiring */
/* The planner is the only place that hands out the live project, and pickBg()
   walks J.BG_ORDER without asking randomOk — so 'media' is hidden from the
   randomiser here and stays visible in the picker, which lists the order. */
const plan = J.plan;
J.plan = (project, audio) => {
  current = project;
  if (!Array.isArray(project.bgAssets)) project.bgAssets = [];
  const i = J.BG_ORDER.indexOf('media');
  if (i < 0) return (lastPlan = plan(project, audio));
  const [m] = J.BG_ORDER.splice(i, 1);
  try { return (lastPlan = plan(project, audio)); } finally { J.BG_ORDER.splice(i, 0, m); }
};

/* Turning the technique on in the picker assigns it to nothing: the planner only
   reads ov.bg, and pickBg never reaches 'media'. Writing ov.bg is what applies
   it, so importing pictures applies them and this button re-applies. */
J.bgApply = () => {
  const n = lastPlan ? lastPlan.lines.length : 0;
  if (!current || !n) return 0;
  for (let li = 0; li < n; li++) {
    const ov = Object.assign({}, current.overrides[li] || {});
    ov.bg = 'media';
    current.overrides[li] = ov;
  }
  return n;
};

/* ---------------------------------------------------------------- panel */
const el = (tag, cls, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};

const thumb = (li, a) => {
  const box = el('div', 'bg-thumb', li);
  const cv = el('canvas', null, box);
  cv.width = 112; cv.height = 63;
  const x = cv.getContext('2d');
  const frame = isVideo(a) ? J.video.thumb(a.id) : decoded.get(a.id);
  if (!frame) return;                        // a video whose decoder is still cold
  const fw = isVideo(a) ? frame.displayWidth : frame.width;
  const fh = isVideo(a) ? frame.displayHeight : frame.height;
  const s = Math.max(112 / fw, 63 / fh);
  x.drawImage(frame, (112 - fw * s) / 2, (63 - fh * s) / 2, fw * s, fh * s);
  if (isVideo(a)) frame.close();
};

const iconBtn = (label, title, svg, parent) => {
  const b = el('button', 'icon ghost', parent);
  b.type = 'button';
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = svg;
  return b;
};

const renderPanel = (sec, bad) => {
  const list = assets();
  sec.querySelector('#bgCount').textContent = T.count(list.length);
  const state = sec.querySelector('#bgState');
  state.textContent = '';
  const ol = sec.querySelector('#bgAssetList');
  ol.textContent = '';
  if (!list.length && !bad.length) {
    state.className = 'hint';
    state.textContent = T.empty();
  } else if (bad.length) {
    state.className = 'hint';
    state.textContent = list.length ? T.errPartial(bad.length, bad.length + list.length) : '';
  } else if (list.length === 1) {
    state.className = 'hint';
    state.textContent = T.one();
  }
  for (const a of list) {
    const li = el('li', 'bg-asset', ol);
    thumb(li, a);
    el('span', 'bg-name muted', li).textContent = a.name;
    el('span', 'dim mono muted', li).textContent = a.dur ? `${a.w}×${a.h} ${a.dur.toFixed(1)}s` : `${a.w}×${a.h}`;
    iconBtn(T.rm(a.name), T.rm(a.name), X_GONE, li).addEventListener('click', () => drop(a.id));
    const up = el('button', 'small ghost', li); up.type = 'button'; up.textContent = '↑'; up.setAttribute('aria-label', T.up()); up.title = T.up();
    up.addEventListener('click', () => { J.bgMove(a.id, -1); renderPanel(sec, bad); });
    const dn = el('button', 'small ghost', li); dn.type = 'button'; dn.textContent = '↓'; dn.setAttribute('aria-label', T.down()); dn.title = T.down();
    dn.addEventListener('click', () => { J.bgMove(a.id, 1); renderPanel(sec, bad); });
  }
  for (const b of bad) {
    const li = el('li', 'bg-asset is-bad', ol);
    el('span', 'bg-name', li).textContent = b.name;
    el('span', 'bg-why muted', li).textContent = b.why;
    iconBtn(T.rm(b.name), T.rm(b.name), X_GONE, li).addEventListener('click', () => {
      bad.splice(bad.indexOf(b), 1);
      renderPanel(sec, bad);
    });
  }
};

const drop = async id => {
  await J.bgRemove(id);
  const sec = document.getElementById('bgSec');
  if (sec) renderPanel(sec, []);
  if (J.uiApi) { J.uiApi.replan(); J.uiApi.flushSave(); }
};

/* Builds the panel into the editor; `anchor` is the "行とカット" section.
   The engine-only pages (tests) have no editor DOM, so mounting is optional. */
J.bgMount = (anchor) => {
  if (!anchor) return null;
  if (document.getElementById('bgSec')) return document.getElementById('bgSec');
  const style = el('style', null, document.head);
  style.textContent = ICON_STYLE;
  // no pro-only: the panel is part of the flow, not a power-user toggle
  const sec = el('div', 'sec', anchor.parentNode);
  sec.id = 'bgSec';
  anchor.parentNode.insertBefore(sec, anchor);
  const h = el('div', 'sec-h', sec);
  el('h2', null, h).textContent = T.h2();
  el('span', 'muted mono', h).id = 'bgCount';
  const applyBtn = el('button', 'small ghost', h);
  applyBtn.type = 'button';
  applyBtn.textContent = T.apply();
  applyBtn.title = T.applyTitle();
  applyBtn.addEventListener('click', () => {
    const n = J.bgApply();
    if (!n) return;
    J.uiApi.replan();
    J.uiApi.flushSave();
    J.uiApi.toast(T.applied(n));
  });
  const state = el('p', 'hint', sec); state.id = 'bgState';
  const ol = el('ol', null, sec); ol.id = 'bgAssetList';
  const lab = el('label', 'file', sec);
  el('span', null, lab).textContent = T.add();
  lab.title = T.addTitle();
  const inp = el('input', null, lab);
  inp.type = 'file'; inp.multiple = true; inp.accept = 'image/*,video/mp4,video/quicktime'; inp.title = T.addTitle();
  const note = el('p', 'note', sec);
  note.textContent = T.note();
  let bad = [];
  inp.addEventListener('change', async () => {
    if (!inp.files || !inp.files.length) return;
    state.className = 'hint';
    state.textContent = T.loading(1, inp.files.length);
    const r = await J.bgImport(inp.files, (k, n) => { state.textContent = T.loading(k, n); });
    bad = r.bad;
    inp.value = '';
    renderPanel(sec, bad);
    if (!J.uiApi) return;
    // importing is the request to use them, so they are applied right away
    if (r.added.length) J.bgApply();
    J.uiApi.replan();
    J.uiApi.flushSave();
    if (r.added.length) J.uiApi.toast(T.added(r.added.length));
  });
  renderPanel(sec, bad);
  return sec;
};

/* the pictures of a restored project: the bytes are not in the JSON */
J.bgMountAndRestore = async (anchor) => {
  const sec = J.bgMount(anchor);
  if (!sec) return null;
  try {
    await J.bgRestore();
  } catch (e) {
    sec.querySelector('#bgState').className = 'hint';
    sec.querySelector('#bgState').textContent = T.errIdb();
    return sec;
  }
  renderPanel(sec, []);
  return sec;
};

if (typeof document !== 'undefined') {
  const mount = () => {
    const info = document.getElementById('linesInfo');
    if (!info) return;                       // engine-only page: no editor to add a panel to
    const anchor = info.closest('.sec');
    if (!anchor) throw new Error('99_custom_bgs: the 行とカット section is missing');
    J.bgMountAndRestore(anchor);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}

})();