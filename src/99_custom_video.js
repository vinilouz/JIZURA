/* ============================================================
   JIZURA — local: video backgrounds (MP4 / MOV, WebCodecs)

   Loads after 99_custom_bgs.js, which asks for these functions by name.

   A video background is one asset in the same panel and the same per-line
   rotation as an image. Nothing here draws: J.video.frame() hands a VideoFrame
   to the background draw, which closes it. This file only demuxes, decodes and
   keeps a lookahead window.

   project.bgAssets = [{id, name, type, w, h, dur}]  — metadata only, the bytes
   live in IndexedDB, and the demuxed sample table lives in memory as index
   arrays over that same ArrayBuffer (no per-chunk copy: only the chunk handed
   to the decoder is copied, by the decoder itself).

   Known limitation: tkhd rotation IS applied (0/90/180/270), but the display
   matrix's scale/shear is not.
   ============================================================ */
(() => {
'use strict';

if (typeof J !== 'object') throw new Error('99_custom_video: J is missing — load it after the app');
if (!J.Renderer) throw new Error('99_custom_video: J.Renderer is missing — the frame hook cannot be installed');

/* ------------------------------------------------------------ window sizes */
/* Playback lookahead. The decoder delivers frames asynchronously, so the render
   asks for a frame that is only "fed" a little later; too short a runway and the
   background goes empty. 2.5 s is ~60 frames of 24 fps. */
const WINDOW_US = 2500000;
/* Import warm-up only needs the reel's first moments decoded, so it uses a short
   runway — every clip is warmed at import, and a full window each would be GBs. */
const WARM_US = 400000;
const FEED_MAX = 24;          // chunks queued in the decoder at once
const KEEP_US = 500000;       // frames kept behind the playhead (seek jitter)
const SEEK_JUMP_US = 500000;  // a forward jump larger than this is a seek, not playback
const CLOSED_MSG = '99_custom_video: the background video was removed';

/* ---------------------------------------------------------------- demuxer */
/* Minimal non-fragmented ISO-BMFF demuxer for H.264 (avc1/avc3) in MP4/MOV.
   Reads mvhd/tkhd/mdhd/elst and the stbl sample tables plus avcC.
   Every unsupported container or codec is named, never reported as "no moov". */
const demux = buf => {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  const cc = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);

  if (u8[0] === 0x1a && u8[1] === 0x45 && u8[2] === 0xdf && u8[3] === 0xa3)
    throw new Error('WebM is not supported: it is EBML, not ISO-BMFF. Use MP4 (H.264).');

  function boxes(from, to) {
    const out = [];
    for (let p = from; p + 8 <= to;) {
      let size = dv.getUint32(p);
      const type = cc(p + 4);
      let head = 8;
      if (size === 1) { size = Number(dv.getBigUint64(p + 8)); head = 16; }
      else if (size === 0) size = to - p;
      if (size < head || p + size > to) break;
      out.push({ type, start: p + head, end: p + size });
      p += size;
    }
    return out;
  }
  const pick = (list, type) => list.find((b) => b.type === type);

  const top = boxes(0, buf.byteLength);
  if (!pick(top, 'ftyp')) throw new Error('not an MP4/MOV file: no ftyp box');
  if (pick(top, 'moof')) throw new Error('fragmented MP4 (moof) is not supported: remux it to a plain MP4 first');

  const moov = pick(top, 'moov');
  if (!moov) throw new Error('MP4: moov not found and no moof either — the file is not a usable MP4');

  const mvhd = pick(boxes(moov.start, moov.end), 'mvhd');
  const mvVer = dv.getUint8(mvhd.start);
  const mvTimescale = dv.getUint32(mvhd.start + (mvVer === 1 ? 20 : 12));
  const mvDuration = mvVer === 1 ? Number(dv.getBigUint64(mvhd.start + 24)) : dv.getUint32(mvhd.start + 16);

  let mdia = null, minf = null, trakKids = null;
  for (const trak of boxes(moov.start, moov.end)) {
    if (trak.type !== 'trak') continue;
    trakKids = boxes(trak.start, trak.end);
    const md = pick(trakKids, 'mdia');
    if (!md) continue;
    const hdlr = pick(boxes(md.start, md.end), 'hdlr');
    if (!hdlr || cc(hdlr.start + 8) !== 'vide') continue;
    mdia = md;
    minf = pick(boxes(md.start, md.end), 'minf');
    break;
  }
  if (!minf) throw new Error('MP4: no video track');

  const tkhd = pick(trakKids, 'tkhd');
  const tkVer = dv.getUint8(tkhd.start);
  // display matrix: a,b and u,v give the rotation; scale and shear are ignored
  const M = tkhd.start + (tkVer === 1 ? 52 : 40);
  const rotation = Math.round(Math.atan2(dv.getInt16(M + 4), dv.getInt16(M)) * 180 / Math.PI);
  const rot = ((rotation % 360) + 360) % 360;
  if (rot % 90 !== 0) throw new Error(`MP4: unsupported track rotation ${rotation}° (only multiples of 90 are drawn)`);

  const mdhd = pick(boxes(mdia.start, mdia.end), 'mdhd');
  const mdVer = dv.getUint8(mdhd.start);
  const timescale = dv.getUint32(mdhd.start + (mdVer === 1 ? 20 : 12));

  /* edit list: media_time trims the reorder head (ffmpeg writes it when B-frames are used) */
  let editShift = 0;
  const edts = pick(trakKids, 'edts');
  const elst = edts && pick(boxes(edts.start, edts.end), 'elst');
  if (elst && dv.getUint32(elst.start + 4) > 0) {
    const v1 = dv.getUint8(elst.start) === 1;
    editShift = Math.max(0, v1 ? Number(dv.getBigInt64(elst.start + 16)) : dv.getInt32(elst.start + 12));
  }

  const stbl = pick(boxes(minf.start, minf.end), 'stbl');
  if (!stbl) throw new Error('fMP4: the sample table (stbl) is missing — this is a fragmented file');
  const st = boxes(stbl.start, stbl.end);
  if (pick(st, 'mvex')) throw new Error('fragmented MP4 (mvex) is not supported: remux it to a plain MP4 first');

  const stsd = pick(st, 'stsd');
  const entry = stsd.start + 8;
  const format = cc(entry + 4);
  if (format === 'hvc1' || format === 'hev1')
    throw new Error(`HEVC (${format}) is not supported: WebCodecs cannot decode it reliably. Use H.264 (avc1).`);
  if (format === 'vp09') throw new Error('VP9 (vp09) is not supported. Use H.264 (avc1).');
  if (format === 'av01') throw new Error('AV1 (av01) is not supported. Use H.264 (avc1).');
  if (format !== 'avc1' && format !== 'avc3')
    throw new Error(`MP4 sample entry '${format}' is not supported. Supported: avc1, avc3 (H.264).`);
  const width = dv.getUint16(entry + 32);
  const height = dv.getUint16(entry + 34);
  const avcC = pick(boxes(entry + 86, entry + dv.getUint32(entry)), 'avcC');
  if (!avcC) throw new Error('MP4: avcC not found — the H.264 decoder configuration is missing');
  const description = u8.slice(avcC.start, avcC.end);
  const codec = `${format}.${[1, 2, 3].map((i) => description[i].toString(16).padStart(2, '0')).join('')}`;

  const stts = pick(st, 'stts'), stsz = pick(st, 'stsz'), stsc = pick(st, 'stsc');
  const stco = pick(st, 'stco') || pick(st, 'co64');
  if (!stts || !stsz || !stsc || !stco)
    throw new Error('fMP4: the sample tables (stts/stsz/stsc/stco) are missing — this is a fragmented file');

  /* decode-order timestamps from stts */
  const nStts = dv.getUint32(stts.start + 4);
  let total = 0;
  for (let e = 0, p = stts.start + 8; e < nStts; e++, p += 8) total += dv.getUint32(p);
  const count = dv.getUint32(stsz.start + 8);
  if (!count) throw new Error('fMP4: no samples in stsz — this is a fragmented file');
  if (count !== total) throw new Error(`MP4 is broken: stts describes ${total} samples, stsz has ${count}`);

  const ts = new Float64Array(count);      // presentation timestamps, microseconds
  const dur = new Uint32Array(count);
  for (let e = 0, p = stts.start + 8, i = 0, t = 0; e < nStts; e++, p += 8) {
    const cnt = dv.getUint32(p), delta = dv.getUint32(p + 4);
    for (let k = 0; k < cnt; k++, i++, t += delta) {
      ts[i] = (t - editShift) * 1e6 / timescale;
      dur[i] = Math.round(delta * 1e6 / timescale);
    }
  }

  /* composition offsets (B-frames) */
  const ctts = pick(st, 'ctts');
  if (ctts) {
    const signed = dv.getUint8(ctts.start) === 1;
    const nCtts = dv.getUint32(ctts.start + 4);
    for (let e = 0, p = ctts.start + 8, i = 0; e < nCtts; e++, p += 8) {
      const cnt = dv.getUint32(p);
      const off = signed ? dv.getInt32(p + 4) : dv.getUint32(p + 4);
      for (let k = 0; k < cnt; k++, i++) ts[i] += off * 1e6 / timescale;
    }
  }
  for (let i = 0; i < count; i++) ts[i] = Math.round(ts[i]);

  /* B-frames leave ts in DECODE order while the presentation order differs, so every
     time lookup has to go through this index. Binary-searching ts itself lands on the
     wrong sample, and the decoder then never gets asked for the frame it produced. */
  const sorted = new Int32Array(count);
  for (let i = 0; i < count; i++) sorted[i] = i;
  sorted.sort((a, b) => ts[a] - ts[b]);

  /* sample sizes (stsz) */
  const size = new Uint32Array(count);
  const uniform = dv.getUint32(stsz.start + 4);
  if (uniform) size.fill(uniform);
  else for (let i = 0; i < count; i++) size[i] = dv.getUint32(stsz.start + 12 + i * 4);

  /* chunk offsets -> sample offsets (stco/stsc) */
  const off = new Float64Array(count);
  const is64 = stco.type === 'co64';
  const nChunks = dv.getUint32(stco.start + 4);
  const chunkOff = new Float64Array(nChunks);
  for (let i = 0; i < nChunks; i++)
    chunkOff[i] = is64 ? Number(dv.getBigUint64(stco.start + 8 + i * 8)) : dv.getUint32(stco.start + 8 + i * 4);
  const nStsc = dv.getUint32(stsc.start + 4);
  for (let e = 0, s = 0; e < nStsc && s < count; e++) {
    const p = stsc.start + 8 + e * 12;
    const first = dv.getUint32(p) - 1;
    const spc = dv.getUint32(p + 4);
    const last = e + 1 < nStsc ? dv.getUint32(stsc.start + 8 + (e + 1) * 12) - 1 : nChunks;
    for (let c = first; c < last && s < count; c++) {
      for (let k = 0, o = chunkOff[c]; k < spc && s < count; k++, s++) off[s] = o, o += size[s];
    }
  }

  /* sync samples (stss); absent means all samples are sync */
  const key = new Uint8Array(count).fill(1);
  const stss = pick(st, 'stss');
  if (stss) {
    key.fill(0);
    const nStss = dv.getUint32(stss.start + 4);
    for (let i = 0; i < nStss; i++) key[dv.getUint32(stss.start + 8 + i * 4) - 1] = 1;
  }
  const keys = [];
  for (let i = 0; i < count; i++) if (key[i]) keys.push(i);

  return {
    codec, description, codedWidth: width, codedHeight: height, rotation: rot,
    timescale, count, keys, key, ts, sorted, dur, size, off, buffer: buf,
    duration: mvTimescale ? mvDuration / mvTimescale : 0,
  };
};

/* ------------------------------------------------------------------ store */
const vids = new Map();      // asset id -> {t, outputs:Map, next, playhead, pumping, waiting, fail}
let pending = null;          // a real decoder failure, rethrown outside the renderer's bg try/catch

const requireDecoder = () => {
  if (typeof VideoDecoder === 'undefined')
    throw new Error('this browser has no WebCodecs VideoDecoder, so video backgrounds cannot be played. Use an image background, or Chrome/Edge 94+.');
};

/* Reads the whole file into memory and demuxes it. Everything unsupported is
   named here, at import time, instead of failing later at draw time. */
J.video = {
  require: requireDecoder,

  async open(id, buffer) {
    requireDecoder();
    const t = demux(buffer);
    const cfg = { codec: t.codec, description: t.description, codedWidth: t.codedWidth, codedHeight: t.codedHeight };
    // isConfigSupported answers a promise; reading .supported off the promise is always undefined,
    // which would reject every clip as unsupported
    const support = await VideoDecoder.isConfigSupported(cfg);
    if (!support.supported) throw new Error(`this browser cannot decode ${t.codec}`);
    const v = {
      t, cfg, outputs: new Map(), next: 0, playhead: -1, pumping: false, fail: null, decoder: null,
      bytes: buffer.byteLength, fed: 0, seeks: 0, gen: 0, flushed: false,
    };
    const dec = new VideoDecoder({
      // seek keeps the window, so a refeed overwrites timestamps already held: close the old frame
      output: frame => { const old = v.outputs.get(frame.timestamp); if (old) old.close(); v.outputs.set(frame.timestamp, frame); },
      error: e => { v.fail = e; },
    });
    dec.configure(cfg);
    v.decoder = dec;
    vids.set(id, v);
    return {
      codec: t.codec, w: t.codedWidth, h: t.codedHeight, dur: t.duration,
      rotation: t.rotation, count: t.count, keys: t.keys.length, bytes: buffer.byteLength,
    };
  },

  /* the 0/90/180/270 degrees tkhd asks for, in degrees */
  rotation(id) { return must(id).t.rotation; },

  /* short window for warming every clip at import; a full window each is gigabytes */
  WARM_US,

  /* The frame covering `tSec`. Synchronous by contract: the caller is inside
     R.frame. If it is not decoded yet this throws — never an older frame. */
  frame(id, tSec) {
    const v = must(id);
    if (v.fail) { pending = v.fail; throw v.fail; }
    const us = Math.round(tSec * 1e6);
    if (v.playhead < 0 || us < v.playhead || us > v.playhead + SEEK_JUMP_US) seek(v, us);
    v.playhead = us;
    pump(v);
    const i = indexAt(v.t, us);
    const frame = v.outputs.get(v.t.ts[i]);
    if (!frame)
      throw new Error(`99_custom_video: frame at ${tSec.toFixed(3)}s is not decoded yet (${v.fed}/${v.t.count} samples fed). The background video cannot be drawn.`);
    evict(v, us);
    return frame;
  },

  /* first frame, for the panel thumbnail; null while the decoder is cold */
  thumb(id) {
    const v = must(id);
    pump(v);
    return v.outputs.get(v.t.ts[v.t.keys[0]]) || null;
  },

  /* Advances the pump until the frame at `tSec` exists. Used by the tests and
     by anything that can await before drawing. `depth` shortens the window, which
     is what import uses: every clip gets warmed there, and a full window each
     would be gigabytes of VideoFrames. */
  async ready(id, tSec, depth) {
    const v = must(id);
    if (v.fail) throw v.fail;
    const us = Math.round(tSec * 1e6);
    if (v.playhead < 0 || us < v.playhead || us > v.playhead + SEEK_JUMP_US) seek(v, us);
    v.playhead = us;
    const win = depth || WINDOW_US;
    for (let spin = 0; spin < 4000; spin++) {
      if (v.fail) throw v.fail;
      pump(v, depth);              // re-arm every pass: a seek hands the guard back
      // wait for the FAR end of the window, not just `tSec`: returning on the first
      // frame leaves the rest of the window for the render to decode in real time,
      // and the renderer asks for a frame the decoder has not produced yet.
      const i = indexAt(v.t, us + win);
      if (v.outputs.get(v.t.ts[i])) return;
      await new Promise(r => setTimeout(r, 2));
    }
    throw new Error(`99_custom_video: the decoder produced no frame for ${tSec.toFixed(3)}s`);
  },

  /* Frees the frames of a clip the reel has left behind. The decoder stays open
     and the playhead is reset, so playing that clip again decodes it again. */
  release(id) {
    const v = vids.get(id);
    if (!v) return 0;
    const held = v.outputs.size;
    for (const f of v.outputs.values()) f.close();
    v.outputs.clear();
    v.decoder.reset();          // otherwise queued chunks still land in outputs after this
    v.decoder.configure(v.cfg);
    v.next = 0;
    v.playhead = -1;
    v.flushed = false;
    v.gen++;
    v.pumping = false;
    return held;
  },

  drop(id) {
    const v = vids.get(id);
    if (!v) return;
    for (const f of v.outputs.values()) f.close();
    v.outputs.clear();
    v.decoder.close();
    vids.delete(id);
  },

  DBG(id) { const v = must(id); return { t: v.t, outputs: v.outputs, fed: v.fed, next: v.next, playhead: v.playhead, seeks: v.seeks }; },
  stats(id) {
    const v = must(id);
    return { held: v.outputs.size, fed: v.fed, count: v.t.count, seeks: v.seeks, bytes: v.bytes };
  },
};

const must = id => {
  const v = vids.get(id);
  if (!v) throw new Error(CLOSED_MSG);
  return v;
};

/* decode index of the last sample whose presentation timestamp is <= us */
const indexAt = (t, us) => {
  const s = t.sorted;
  if (t.ts[s[0]] > us) return s[0];
  let lo = 0, hi = t.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.ts[s[mid]] <= us) lo = mid; else hi = mid - 1;
  }
  return s[lo];
};

/* highest decode index to feed so that every sample up to us is decoded */
const feedTo = (t, us) => {
  const s = t.sorted;
  let hi = -1;
  for (let k = 0; k < t.count; k++) {
    const i = s[k];
    if (t.ts[i] > us) break;
    if (i > hi) hi = i;
  }
  return hi;
};

/* A jump in either direction: reset and refeed from the keyframe at or before t.
   Measured cost: up to one GOP (≈1.4 s of frames) decoded before the first frame. */
const seek = (v, us) => {
  const i = indexAt(v.t, us);
  let k = v.t.keys[0];
  for (const idx of v.t.keys) { if (idx > i) break; k = idx; }
  // the draw warms the current clip from 0 in the same tick as frame(local): clearing here
  // deletes the window frame() is about to read, so the decoded frames stay while only the decoder restarts
  v.decoder.reset();
  v.decoder.configure(v.cfg);
  v.next = k;
  v.flushed = false;
  v.seeks++;
  // a pump already in flight holds the guard and is filling a window this reset
  // just invalidated; hand the flag back so the next pump starts from this keyframe
  v.gen++;
  v.pumping = false;
};

/* Decodes forward until the window is filled. Yields between chunks, so the
   caller's own await points (the export loop yields every 3 frames) interleave.
   It polls the queue instead of parking on an output promise: reset() during a
   seek drops the queued chunks silently, which would leave such a promise
   unresolved forever and the pump dead. */
const pump = (v, depth) => {
  if (v.pumping || v.fail) return;
  v.pumping = true;
  const gen = v.gen;
  const run = async () => {
    // ts is in decode order, so the feed limit comes from the presentation index
    const upto = feedTo(v.t, v.playhead + (depth || WINDOW_US));
    while (!v.fail && v.gen === gen && v.next <= upto) {
      if (v.decoder.decodeQueueSize >= FEED_MAX) { await tick(); continue; }
      v.decoder.decode(chunk(v, v.next));
      v.next++; v.fed++;
    }
    while (!v.fail && v.gen === gen && v.decoder.decodeQueueSize > 0 && v.next <= upto) await tick();
    // the decoder holds the trailing frames back until it is told no more are coming.
    // Without this the last frames of a clip never arrive, and a background reel that
    // has run past its end sits on a frame that can never be drawn.
    if (!v.fail && v.gen === gen && upto >= v.t.count - 1 && !v.flushed) {
      v.flushed = true;
      await v.decoder.flush();
    }
  };
  // a seek bumps gen and takes the guard back; this stale run must not clear it
  run().then(() => { if (v.gen === gen) v.pumping = false; }, e => { v.fail = e; v.pumping = false; });
};

const tick = () => new Promise(res => { setTimeout(res, 0); });

const chunk = (v, i) => new EncodedVideoChunk({
  type: v.t.key[i] ? 'key' : 'delta',
  timestamp: v.t.ts[i],
  duration: v.t.dur[i],
  data: new Uint8Array(v.t.buffer, v.t.off[i], v.t.size[i]),
});

/* resolves on the next decoded frame (or the next decoder error) */

/* drops the frames behind the playhead; whoever drew them has closed them already */
const evict = (v, us) => {
  const floor = us - KEEP_US;
  for (const [ts, frame] of v.outputs) {
    if (ts >= floor) continue;
    frame.close();
    v.outputs.delete(ts);
  }
};

/* --------------------------------------------------------- failure escape */
/* 09_render.js wraps every background draw in try/catch and only warns. A decoder
   failure must stop the export, so it is rethrown here, outside that try, on the
   next frame. Frames that are merely not decoded yet are NOT stashed here. */
const rawFrame = J.Renderer.prototype.frame;
J.Renderer.prototype.frame = function (...args) {
  const out = rawFrame.apply(this, args);
  if (pending) { const e = pending; pending = null; throw e; }
  return out;
};

})();
