import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  JizuraSchema,
  JizuraJobInput,
  JizuraJobResult,
  JizuraProjectConfig,
  JizuraBackgroundInput,
} from './types.js';

export * from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const RUNNER_HTML = path.join(ROOT_DIR, 'dev', 'www', 'runner.html');
const SCHEMA_FILE = path.join(ROOT_DIR, 'schema.json');

/**
 * Returns the cached static schema without starting any browser.
 */
export function getSchema(): JizuraSchema {
  if (fs.existsSync(SCHEMA_FILE)) {
    return JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf-8'));
  }
  throw new Error(`schema.json not found at ${SCHEMA_FILE}. Run python3 build.py --dev first.`);
}

/**
 * Helper to normalize buffer/file inputs into Base64 for headless bridge.
 */
async function toBuffer(input: string | Uint8Array | ArrayBuffer): Promise<Buffer> {
  if (typeof input === 'string') {
    return fs.promises.readFile(input);
  }
  if (input instanceof ArrayBuffer) {
    return Buffer.from(input);
  }
  return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

function findChromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const home = process.env.HOME || '/home/vinilouz';
  const candidates = [
    `${home}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    `${home}/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome`,
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ];
  return candidates.find(c => fs.existsSync(c));
}

/**
 * Executes a full JIZURA render job inside a headless Chromium instance.
 */
export async function render(job: JizuraJobInput): Promise<JizuraJobResult> {
  const { chromium } = await import('playwright');

  if (!fs.existsSync(RUNNER_HTML)) {
    throw new Error(`Runner HTML not found at ${RUNNER_HTML}. Run python3 build.py --dev first.`);
  }

  // Read audio into memory buffer if provided
  let audioBase64: string | null = null;
  if (job.audio) {
    const audioBuf = await toBuffer(job.audio);
    audioBase64 = audioBuf.toString('base64');
  }

  // Read background assets into memory
  const backgroundsPrepared: Array<{ type: 'video' | 'image'; name: string; base64: string; dur?: number }> = [];
  if (job.backgrounds && Array.isArray(job.backgrounds)) {
    for (const bg of job.backgrounds) {
      const bgBuf = await toBuffer(bg.data);
      backgroundsPrepared.push({
        type: bg.type,
        name: bg.name || (bg.type === 'video' ? 'clip.mp4' : 'image.png'),
        base64: bgBuf.toString('base64'),
        dur: bg.dur,
      });
    }
  }

  const execPath = findChromiumPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
    args: [
      '--allow-file-access-from-files',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-web-security',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu-sandbox',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--enable-zero-copy',
      '--disable-dev-shm-usage',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--js-flags=--max-old-space-size=4096',
    ],
  });

  let server: http.Server | null = null;
  let localPort = 0;
  let finishResolve: () => void;
  let finishReject: (err: any) => void;
  const finishPromise = new Promise<void>((resolve, reject) => {
    finishResolve = resolve;
    finishReject = reject;
  });

  const targetOutput = job.outputPath;
  const tempOutFile = targetOutput || path.join(os.tmpdir(), `jizura-render-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  await fs.promises.mkdir(path.dirname(tempOutFile), { recursive: true });

  server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST') {
      const outStream = fs.createWriteStream(tempOutFile);
      req.pipe(outStream);
      outStream.on('finish', () => {
        res.writeHead(200);
        res.end('ok');
        finishResolve();
      });
      outStream.on('error', (err) => {
        res.writeHead(500);
        res.end(String(err));
        finishReject(err);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      localPort = (server!.address() as any).port;
      resolve();
    });
  });

  try {
    const page = await browser.newPage();

    // Progress bridge
    await page.exposeFunction('__jizuraOnProgress', (progress: number, msg: string, stats?: any) => {
      if (job.onProgress) {
        job.onProgress(progress, msg, stats);
      }
    });

    page.on('console', msg => {
      const txt = msg.text();
      if (msg.type() === 'error' || msg.type() === 'warning' || txt.includes('bg') || txt.includes('Error')) {
        console.warn(`[BROWSER ${msg.type()}]`, txt);
      }
    });
    page.on('pageerror', err => console.error('[BROWSER PAGEERROR]', err));

    await page.goto(`file://${RUNNER_HTML}`);
    await page.waitForFunction('() => window.__jizuraReady === true');

    const result = await page.evaluate(
      async ({ audioB64, lyrics, config, backgrounds, quality, range, port }) => {
        const b64toAB = (b64: string) => {
          const bin = atob(b64);
          const len = bin.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
          return u8.buffer;
        };

        const audioBuf = audioB64 ? b64toAB(audioB64) : null;
        const bgAssets = backgrounds.map((b: { type: 'video' | 'image'; name: string; base64: string; dur?: number }) => ({
          type: b.type,
          name: b.name,
          data: b64toAB(b.base64),
          dur: b.dur,
        }));

        const out = await (window as any).J.renderJob({
          audioBuffer: audioBuf,
          lyrics,
          config: config || {},
          backgrounds: bgAssets,
          quality: quality || 'high',
          range: range || null,
          onProgress: (p: number, msg: string, stats: any) => {
            (window as any).__jizuraOnProgress(p, msg, stats);
          },
        });

        // Stream rendered video directly to host over local HTTP loopback
        const blob = out.blob || (out.buffer ? new Blob([out.buffer], { type: 'video/mp4' }) : null);
        if (!blob) throw new Error('No video output generated');

        const postRes = await fetch(`http://127.0.0.1:${port}/save`, {
          method: 'POST',
          body: blob,
        });
        if (!postRes.ok) {
          throw new Error(`Failed to stream render to host: ${postRes.status} ${postRes.statusText}`);
        }

        return {
          size: out.size,
          duration: out.duration,
          fps: out.fps,
          width: out.width,
          height: out.height,
          codec: out.codec,
          cuts: out.cuts,
        };
      },
      {
        audioB64: audioBase64,
        lyrics: job.lyrics,
        config: job.config || {},
        backgrounds: backgroundsPrepared,
        quality: job.quality || 'high',
        range: job.range || null,
        port: localPort,
      }
    );

    await finishPromise;
    server.close();

    const stats = await fs.promises.stat(tempOutFile);
    let buffer: Buffer;
    if (!targetOutput) {
      buffer = await fs.promises.readFile(tempOutFile);
      await fs.promises.unlink(tempOutFile).catch(() => {});
    } else {
      buffer = stats.size < 50 * 1024 * 1024 ? await fs.promises.readFile(tempOutFile) : Buffer.alloc(0);
    }

    return {
      buffer,
      size: stats.size || result.size,
      duration: result.duration,
      fps: result.fps,
      width: result.width,
      height: result.height,
      codec: result.codec,
      cuts: result.cuts,
      outputPath: targetOutput || tempOutFile,
    };
  } finally {
    try {
      if (server && (server as any).listening) server.close();
    } catch {}
    await browser.close();
  }
}

/**
 * Extracts a lightweight keyframe preview image (JPEG data URL or buffer)
 * at a given second `tSec` without encoding an entire MP4 video.
 */
export async function snapshot(
  job: Omit<JizuraJobInput, 'outputPath' | 'onProgress' | 'quality' | 'range'>,
  tSec: number,
  scale = 0.5
): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const execPath = findChromiumPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
    args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const page = await browser.newPage();
    page.on('console', msg => {
      const txt = msg.text();
      if (msg.type() === 'error' || msg.type() === 'warning' || txt.includes('bg') || txt.includes('Error')) {
        console.warn(`[SNAPSHOT BROWSER ${msg.type()}]`, txt);
      }
    });
    page.on('pageerror', err => console.error('[SNAPSHOT BROWSER PAGEERROR]', err));
    let audioBase64: string | null = null;
    if (job.audio) {
      const audioBuf = await toBuffer(job.audio);
      audioBase64 = audioBuf.toString('base64');
    }

    const backgroundsPrepared = [];
    if (job.backgrounds && Array.isArray(job.backgrounds)) {
      for (const bg of job.backgrounds) {
        const bgBuf = await toBuffer(bg.data);
        backgroundsPrepared.push({
          type: bg.type,
          name: bg.name || (bg.type === 'video' ? 'clip.mp4' : 'image.png'),
          base64: bgBuf.toString('base64'),
          dur: bg.dur,
        });
      }
    }

    await page.goto(`file://${RUNNER_HTML}`);
    await page.waitForFunction('() => window.__jizuraReady === true');

    const dataUrl = await page.evaluate(
      async ({ audioB64, lyrics, config, backgrounds, t, s }) => {
        const b64toAB = (b64: string) => {
          const bin = atob(b64);
          const len = bin.length;
          const u8 = new Uint8Array(len);
          for (let i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
          return u8.buffer;
        };
        const audioBuf = audioB64 ? b64toAB(audioB64) : null;
        const bgAssets = backgrounds.map((b: { type: 'video' | 'image'; name: string; base64: string; dur?: number }) => ({
          type: b.type,
          name: b.name,
          data: b64toAB(b.base64),
          dur: b.dur,
        }));

        const prep = await (window as any).J.prepareJob({
          audioBuffer: audioBuf,
          lyrics,
          config: config || {},
          backgrounds: bgAssets,
        });

        return (window as any).J.renderSnapshot(prep, t, s);
      },
      {
        audioB64: audioBase64,
        lyrics: job.lyrics,
        config: job.config || {},
        backgrounds: backgroundsPrepared,
        t: tSec,
        s: scale,
      }
    );

    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(b64, 'base64');
  } finally {
    await browser.close();
  }
}
