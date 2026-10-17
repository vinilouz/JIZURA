/**
 * JIZURA TypeScript Types & Vendor Contract
 */

export interface JizuraColor {
  bg: string;
  fg: string;
  sub: string;
  accent: string;
  accent2: string;
  ink: string;
  ghostA?: string;
  ghostB?: string;
}

export interface JizuraStyleInfo {
  id: string;
  name: string;
  desc: string;
  extra: boolean;
  wa: boolean;
  horror: boolean;
  schemes: JizuraColor[];
  fonts?: Record<string, string[]> | null;
}

export interface JizuraMoodInfo {
  id: string;
  name: string;
  fx: Record<string, [number, number]> | null;
  layouts: string[];
  enters: string[];
  exits: string[];
  styles: string[];
  set?: string | null;
}

export interface JizuraSchema {
  styles: JizuraStyleInfo[];
  moods: JizuraMoodInfo[];
  aspects: Array<'16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '4:5' | '21:9'>;
  resolutions: number[];
  fpsList: number[];
  fonts: Array<{ id: string; label: string; kind: string; weight: number }>;
  groups: Record<string, string[]>;
  defaultProject: Record<string, any>;
}

export interface JizuraFxConfig {
  motion?: number;
  glitch?: number;
  chroma?: number;
  decor?: number;
  density?: number;
  texture?: number;
  flash?: boolean;
  onTwos?: boolean;
  koma?: number;
  hud?: string;
  bgSwitch?: number;
  hideNo?: boolean;
  hideTime?: boolean;
}

export interface JizuraProjectConfig {
  title?: string;
  artist?: string;
  style?: string;
  mood?: string | null;
  seed?: number;
  aspect?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '4:5' | '21:9';
  res?: number;
  fps?: number;
  keyBg?: 'off' | 'green' | 'black';
  extra?: boolean;
  wa?: boolean;
  horror?: boolean;
  typo?: boolean;
  kinetic?: boolean;
  lang?: 'auto' | 'ja' | 'zh-Hant' | 'zh-Hans' | 'ko';
  unify?: boolean;
  typeset?: boolean;
  centerFree?: boolean;
  fx?: Partial<JizuraFxConfig>;
  timing?: {
    bpm?: number;
    offset?: number;
    snap?: boolean;
    tail?: number;
    lineScale?: number;
    lineTimes?: Record<string, number>;
  };
  overrides?: Record<string, any>;
  [key: string]: any;
}

export interface JizuraBackgroundInput {
  type: 'video' | 'image';
  /** Path to local file, Buffer or ArrayBuffer */
  data: string | Uint8Array | ArrayBuffer;
  name?: string;
  dur?: number;
}

export interface JizuraProgressStats {
  current: number;
  total: number;
  percent: number;
  fps: number;
  eta: number;
}

export interface JizuraJobInput {
  /** Path to audio file or raw buffer (MP3, WAV, AAC, etc.) */
  audio?: string | Uint8Array | ArrayBuffer;
  /** Lyrics text (lines separated by newline or with [mm:ss.xx] LRC tags) */
  lyrics: string;
  /** Project configuration (merged over defaultProject) */
  config?: Partial<JizuraProjectConfig>;
  /** Background images or video clips */
  backgrounds?: JizuraBackgroundInput[];
  /** Export quality: 'draft' | 'high' | 'max' (default: 'high') */
  quality?: 'draft' | 'high' | 'max';
  /** Optional slice to render in seconds: { t0, t1 } */
  range?: { t0: number; t1: number } | null;
  /** Optional file path where to write the MP4 directly */
  outputPath?: string;
  /** Progress callback with optional stats object */
  onProgress?: (progress: number, message: string, stats?: JizuraProgressStats) => void;
}

export interface JizuraCutInfo {
  text: string;
  start: number;
  end: number;
  layout: string;
  enter: string;
  exit: string;
}

export interface JizuraJobResult {
  buffer: Buffer;
  size: number;
  duration: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
  cuts: JizuraCutInfo[];
  outputPath?: string;
}
