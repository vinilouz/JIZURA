import fs from 'node:fs';
import path from 'node:path';
import { render } from './index.ts';

const BASE = path.resolve('projects/reveri/T013');
const AUDIO = path.join(BASE, 'take-1.mp3');
const LRC = path.join(BASE, 'T013.lrc');
const CLIPS_DIR = path.join(BASE, 'clips');
const FRAMES_DIR = path.join(BASE, 'frames');

const lyrics = fs.readFileSync(LRC, 'utf-8');

const allFrames = fs.readdirSync(FRAMES_DIR)
  .filter(f => f.endsWith('.png'))
  .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

const allClips = fs.readdirSync(CLIPS_DIR)
  .filter(f => f.endsWith('.mp4'))
  .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));

const commonConfig = {
  style: 'noir',
  aspect: '16:9' as const,
  res: 720,
  fps: 24,
};

const range20s = { t0: 0, t1: 20.0 };

console.log('--- 1/4: Renderizando 20s - Imagem única ---');
const r1 = await render({
  audio: AUDIO,
  lyrics,
  config: commonConfig,
  range: range20s,
  backgrounds: [{
    type: 'image',
    data: path.join(FRAMES_DIR, allFrames[0]),
    name: allFrames[0],
  }],
  outputPath: 'scratch/t013_20s_single_image.mp4',
  onProgress: (p, msg) => {
    if (Math.round(p * 100) % 25 === 0) console.log(`[1/4] ${Math.round(p * 100)}% - ${msg}`);
  },
});
console.log(`[1/4 OK] Salvo em ${r1.outputPath} (${r1.size} bytes)`);

console.log('\n--- 2/4: Renderizando 20s - Múltiplas imagens ---');
const r2 = await render({
  audio: AUDIO,
  lyrics,
  config: commonConfig,
  range: range20s,
  backgrounds: allFrames.slice(0, 6).map(f => ({
    type: 'image',
    data: path.join(FRAMES_DIR, f),
    name: f,
  })),
  outputPath: 'scratch/t013_20s_multi_images.mp4',
  onProgress: (p, msg) => {
    if (Math.round(p * 100) % 25 === 0) console.log(`[2/4] ${Math.round(p * 100)}% - ${msg}`);
  },
});
console.log(`[2/4 OK] Salvo em ${r2.outputPath} (${r2.size} bytes)`);

console.log('\n--- 3/4: Renderizando 20s - Clipe único ---');
const r3 = await render({
  audio: AUDIO,
  lyrics,
  config: commonConfig,
  range: range20s,
  backgrounds: [{
    type: 'video',
    data: path.join(CLIPS_DIR, allClips[0]),
    name: allClips[0],
  }],
  outputPath: 'scratch/t013_20s_single_clip.mp4',
  onProgress: (p, msg) => {
    if (Math.round(p * 100) % 25 === 0) console.log(`[3/4] ${Math.round(p * 100)}% - ${msg}`);
  },
});
console.log(`[3/4 OK] Salvo em ${r3.outputPath} (${r3.size} bytes)`);

console.log('\n--- 4/4: Renderizando 20s - Múltiplos clipes ---');
const r4 = await render({
  audio: AUDIO,
  lyrics,
  config: commonConfig,
  range: range20s,
  backgrounds: allClips.slice(0, 6).map(f => ({
    type: 'video',
    data: path.join(CLIPS_DIR, f),
    name: f,
  })),
  outputPath: 'scratch/t013_20s_multi_clips.mp4',
  onProgress: (p, msg) => {
    if (Math.round(p * 100) % 25 === 0) console.log(`[4/4] ${Math.round(p * 100)}% - ${msg}`);
  },
});
console.log(`[4/4 OK] Salvo em ${r4.outputPath} (${r4.size} bytes)`);

console.log('\n=== TODOS OS 4 RENDERS DE 20S CONCLUÍDOS COM SUCESSO ===');
