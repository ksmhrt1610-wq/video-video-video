import type { MediaAnalysis, MediaItem, MediaType } from './types';
import { uid } from './timeline';

export const PEAKS_PER_SEC = 100;

let audioCtx: AudioContext | null = null;
export function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext({ latencyHint: 'interactive' });
  return audioCtx;
}

const analysis = new Map<string, MediaAnalysis>();
const blobs = new Map<string, Blob>();
const listeners = new Set<() => void>();
let version = 0;

export function getAnalysis(id: string | undefined): MediaAnalysis | undefined {
  return id ? analysis.get(id) : undefined;
}
export function getBlob(id: string): Blob | undefined {
  return blobs.get(id);
}
export function subscribeAnalysis(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function analysisVersion(): number {
  return version;
}
function notify() {
  version++;
  listeners.forEach((l) => l());
}

export function detectType(mime: string, name: string): MediaType | null {
  const t = mime;
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('image/')) return 'image';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  return null;
}

function loadElementMeta(url: string, type: MediaType): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (type === 'image') {
      const img = new Image();
      img.onload = () => resolve({ duration: 0, width: img.naturalWidth || 1920, height: img.naturalHeight || 1080 });
      img.onerror = () => reject(new Error('画像を読み込めません'));
      img.src = url;
      return;
    }
    const el = document.createElement(type === 'video' ? 'video' : 'audio') as HTMLMediaElement;
    el.preload = 'metadata';
    el.muted = true;
    el.onloadedmetadata = () => {
      const finish = (d: number) => {
        const v = el as HTMLVideoElement;
        resolve({ duration: d, width: v.videoWidth || 0, height: v.videoHeight || 0 });
        el.removeAttribute('src');
        el.load();
      };
      if (Number.isFinite(el.duration)) finish(el.duration);
      else {
        // MediaRecorder 製 WebM などは duration=Infinity になるので末尾へシークして求める
        el.ontimeupdate = () => {
          el.ontimeupdate = null;
          const d = el.duration;
          finish(Number.isFinite(d) ? d : el.currentTime);
        };
        el.currentTime = 1e101;
      }
    };
    el.onerror = () => reject(new Error('このファイル形式はブラウザで再生できません'));
    el.src = url;
  });
}

/** ファイルを読み込んで MediaItem を作る。解析（サムネイル・波形）は非同期で続行 */
export async function importFile(file: File | Blob, name: string, id = uid('media')): Promise<MediaItem> {
  const type = detectType(file.type, name);
  if (!type) throw new Error(`${name}: 未対応のファイル形式です`);
  const url = URL.createObjectURL(file);
  const meta = await loadElementMeta(url, type);
  const item: MediaItem = {
    id,
    name,
    type,
    url,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    hasAudio: type === 'audio',
    size: file.size,
    mime: file.type,
  };
  blobs.set(id, file);
  analysis.set(id, { thumbnails: [] });
  return item;
}

/**
 * サムネイルと音声波形を生成する。音声デコードに成功すれば hasAudio = true を返す。
 */
export async function analyzeMedia(item: MediaItem): Promise<{ hasAudio: boolean }> {
  const a: MediaAnalysis = analysis.get(item.id) ?? { thumbnails: [] };
  analysis.set(item.id, a);
  let hasAudio = item.type === 'audio';
  if (item.type === 'video' || item.type === 'audio') {
    try {
      const blob = blobs.get(item.id);
      if (blob) {
        const buf = await blob.arrayBuffer();
        const audio = await getAudioContext().decodeAudioData(buf);
        a.audioBuffer = audio;
        a.peaks = computePeaks(audio);
        hasAudio = true;
        notify();
      }
    } catch {
      hasAudio = item.type === 'audio';
    }
  }
  if (item.type === 'image') {
    a.thumbnails = [{ time: 0, url: item.url }];
    notify();
  } else if (item.type === 'video') {
    await generateThumbnails(item, a);
  }
  return { hasAudio };
}

function computePeaks(buf: AudioBuffer): Float32Array {
  const n = Math.max(1, Math.ceil(buf.duration * PEAKS_PER_SEC));
  const peaks = new Float32Array(n);
  const block = buf.sampleRate / PEAKS_PER_SEC;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * block);
      const e = Math.min(data.length, Math.floor((i + 1) * block));
      let max = peaks[i];
      for (let j = s; j < e; j += 4) {
        const v = data[j] < 0 ? -data[j] : data[j];
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
  }
  return peaks;
}

async function generateThumbnails(item: MediaItem, a: MediaAnalysis) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = item.url;
  await new Promise<void>((res) => {
    video.onloadeddata = () => res();
    video.onerror = () => res();
  });
  const h = 72;
  const w = Math.max(16, Math.round((h * (item.width || 16)) / (item.height || 9)));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const count = Math.min(24, Math.max(2, Math.ceil(item.duration / 2)));
  for (let i = 0; i < count; i++) {
    const t = Math.min(item.duration - 0.05, (item.duration * i) / count + 0.01);
    const ok = await seek(video, Math.max(0, t));
    if (!ok) break;
    ctx.drawImage(video, 0, 0, w, h);
    a.thumbnails.push({ time: t, url: canvas.toDataURL('image/jpeg', 0.7) });
    if (i === 0 || i === count - 1) notify();
  }
  notify();
  video.removeAttribute('src');
  video.load();
}

function seek(video: HTMLVideoElement, t: number): Promise<boolean> {
  return new Promise((res) => {
    const timer = setTimeout(() => res(false), 4000);
    video.onseeked = () => {
      clearTimeout(timer);
      res(true);
    };
    video.currentTime = t;
  });
}

export function thumbnailAt(a: MediaAnalysis | undefined, t: number): string | undefined {
  if (!a || a.thumbnails.length === 0) return undefined;
  let best = a.thumbnails[0];
  for (const th of a.thumbnails) if (th.time <= t + 0.01) best = th;
  return best.url;
}

export function releaseMedia(id: string, url: string) {
  URL.revokeObjectURL(url);
  analysis.delete(id);
  blobs.delete(id);
  notify();
}
