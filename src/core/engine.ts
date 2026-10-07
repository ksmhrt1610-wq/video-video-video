import type { Clip, MediaItem, Project } from './types';
import { getAnalysis, getAudioContext } from './media';
import { collectDrawItems, renderFrame, sourceTimeOf, type SourceProvider } from './render';
import { clipEnd, EPS, sequenceDuration } from './timeline';
import { getState, setUI, subscribe } from '../store';

const LOOKAHEAD = 1.5;
const MAX_POOL = 16;

interface PooledVideo {
  el: HTMLVideoElement;
  mediaId: string;
  lastUsed: number;
}

/**
 * 再生エンジン: プレビュー描画・映像要素の同期・音声スケジューリング・書き出しを担当
 */
class Engine implements SourceProvider {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private videos = new Map<string, PooledVideo>();
  private images = new Map<string, HTMLImageElement>();
  private mediaById = new Map<string, MediaItem>();

  private playing = false;
  private playStartCtx = 0;
  private playStartT = 0;
  private sources: AudioScheduledSourceNode[] = [];
  private raf = 0;
  private renderQueued = false;
  private lastProject: Project | null = null;
  private lastPlayhead = -1;
  private rescheduleTimer = 0;

  private master: GainNode | null = null;
  private analysers: [AnalyserNode, AnalyserNode] | null = null;
  private exportDest: MediaStreamAudioDestinationNode | null = null;

  private exportCanvas: HTMLCanvasElement | null = null;
  private exportStop: (() => void) | null = null;

  constructor() {
    subscribe(() => this.onStoreChange());
  }

  // ---------- セットアップ ----------
  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    this.requestRender();
  }

  private ensureAudioGraph() {
    if (this.master) return;
    const ac = getAudioContext();
    this.master = ac.createGain();
    this.master.connect(ac.destination);
    const splitter = ac.createChannelSplitter(2);
    this.master.connect(splitter);
    const l = ac.createAnalyser();
    const r = ac.createAnalyser();
    l.fftSize = r.fftSize = 1024;
    splitter.connect(l, 0);
    splitter.connect(r, 1);
    this.analysers = [l, r];
  }

  private buf = new Float32Array(1024);
  /** マスターの L/R ピークレベル (0..1+) */
  getLevels(): [number, number] {
    if (!this.analysers || !this.playing) return [0, 0];
    return this.analysers.map((a) => {
      a.getFloatTimeDomainData(this.buf);
      let m = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const v = Math.abs(this.buf[i]);
        if (v > m) m = v;
      }
      return m;
    }) as [number, number];
  }

  // ---------- SourceProvider ----------
  getVisual(clip: Clip, sourceTime: number): CanvasImageSource | null {
    if (clip.kind === 'image') {
      const img = this.getImage(clip.mediaId!);
      return img && img.complete && img.naturalWidth > 0 ? img : null;
    }
    if (clip.kind === 'video') {
      const v = this.getVideo(clip);
      if (!v) return null;
      if (!this.playing && !this.exportStop) this.seekVideo(v, clip, sourceTime);
      return v.readyState >= 2 ? v : null;
    }
    return null;
  }

  getSize(clip: Clip) {
    const m = clip.mediaId ? this.mediaById.get(clip.mediaId) : undefined;
    if (!m) return null;
    return { width: m.width, height: m.height };
  }

  private getImage(mediaId: string): HTMLImageElement | null {
    let img = this.images.get(mediaId);
    if (!img) {
      const m = this.mediaById.get(mediaId);
      if (!m) return null;
      img = new Image();
      img.onload = () => this.requestRender();
      img.src = m.url;
      this.images.set(mediaId, img);
    }
    return img;
  }

  private getVideo(clip: Clip): HTMLVideoElement | null {
    const m = clip.mediaId ? this.mediaById.get(clip.mediaId) : undefined;
    if (!m) return null;
    let pv = this.videos.get(clip.id);
    if (pv && pv.mediaId !== m.id) {
      this.disposeVideo(clip.id);
      pv = undefined;
    }
    if (!pv) {
      const el = document.createElement('video');
      el.muted = true; // 音声は WebAudio で再生
      el.playsInline = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.src = m.url;
      el.addEventListener('seeked', () => this.requestRender());
      el.addEventListener('loadeddata', () => this.requestRender());
      pv = { el, mediaId: m.id, lastUsed: performance.now() };
      this.videos.set(clip.id, pv);
      this.trimPool();
    }
    pv.lastUsed = performance.now();
    return pv.el;
  }

  private seekVideo(el: HTMLVideoElement, clip: Clip, sourceTime: number) {
    const dur = this.mediaById.get(clip.mediaId!)?.duration ?? Infinity;
    const target = Math.max(0, Math.min(sourceTime, dur - 0.02));
    const fps = getState().project.sequence.fps;
    if (!el.paused) el.pause();
    // シーク中なら seeked 後の再描画で改めて最新位置へシークする
    if (!el.seeking && Math.abs(el.currentTime - target) > 0.5 / fps) el.currentTime = target;
  }

  private disposeVideo(clipId: string) {
    const pv = this.videos.get(clipId);
    if (!pv) return;
    pv.el.pause();
    pv.el.removeAttribute('src');
    pv.el.load();
    this.videos.delete(clipId);
  }

  private trimPool() {
    if (this.videos.size <= MAX_POOL) return;
    const sorted = [...this.videos.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [id] of sorted.slice(0, this.videos.size - MAX_POOL)) this.disposeVideo(id);
  }

  // ---------- ストア連携 ----------
  private onStoreChange() {
    const { project, ui } = getState();
    if (project !== this.lastProject) {
      const prev = this.lastProject;
      this.lastProject = project;
      this.mediaById = new Map(project.media.map((m) => [m.id, m]));
      const ids = new Set(project.clips.map((c) => c.id));
      for (const id of [...this.videos.keys()]) if (!ids.has(id)) this.disposeVideo(id);
      for (const [id] of this.images) if (!this.mediaById.has(id)) this.images.delete(id);
      if (this.playing && prev && audioRelevantChange(prev, project)) {
        clearTimeout(this.rescheduleTimer);
        this.rescheduleTimer = window.setTimeout(() => {
          if (this.playing) this.restartAudio();
        }, 60);
      }
      this.requestRender();
    }
    if (ui.playhead !== this.lastPlayhead) {
      this.lastPlayhead = ui.playhead;
      if (!this.playing) this.requestRender();
    }
  }

  requestRender() {
    if (this.renderQueued || this.playing) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      if (!this.playing) this.draw(getState().ui.playhead);
    });
  }

  private draw(t: number) {
    const { project, ui } = getState();
    if (this.exportCanvas) {
      const ectx = this.exportCanvas.getContext('2d')!;
      renderFrame(ectx, project, t, this, 1);
      if (this.ctx && this.canvas) {
        this.ctx.drawImage(this.exportCanvas, 0, 0, this.canvas.width, this.canvas.height);
      }
      return;
    }
    if (!this.ctx || !this.canvas) return;
    const scale = ui.previewScale;
    const w = Math.round(project.sequence.width * scale);
    const h = Math.round(project.sequence.height * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    renderFrame(this.ctx, project, t, this, scale);
  }

  // ---------- 再生 ----------
  isPlaying() {
    return this.playing;
  }

  currentTime(): number {
    if (!this.playing) return getState().ui.playhead;
    const ac = getAudioContext();
    return this.playStartT + Math.max(0, ac.currentTime - this.playStartCtx);
  }

  async play() {
    if (this.playing) return;
    const { project, ui } = getState();
    const end = sequenceDuration(project);
    if (end <= 0) return;
    let t = ui.playhead;
    if (t >= end - EPS) t = 0;
    const ac = getAudioContext();
    if (ac.state !== 'running') await ac.resume().catch(() => {});
    this.ensureAudioGraph();
    this.playing = true;
    this.playStartT = t;
    this.playStartCtx = ac.currentTime + 0.05;
    this.scheduleAudio(project, t);
    setUI({ playing: true, playhead: t });
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.loop);
  }

  pause() {
    if (!this.playing) return;
    const t = this.currentTime();
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.stopAudio();
    for (const pv of this.videos.values()) pv.el.pause();
    setUI({ playing: false, playhead: t });
    this.requestRender();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pause();
    setUI({ playhead: Math.max(0, t) });
    if (wasPlaying) this.play();
  }

  private loop = () => {
    if (!this.playing) return;
    const { project } = getState();
    const end = sequenceDuration(project);
    let t = this.currentTime();
    if (t >= end) {
      t = end;
      if (this.exportStop) {
        this.draw(t);
        const stop = this.exportStop;
        this.exportStop = null;
        stop();
      }
      this.playing = false;
      this.stopAudio();
      for (const pv of this.videos.values()) pv.el.pause();
      setUI({ playing: false, playhead: t });
      this.requestRender();
      return;
    }
    this.syncVideos(project, t);
    this.draw(t);
    setUI({ playhead: t });
    this.raf = requestAnimationFrame(this.loop);
  };

  private syncVideos(project: Project, t: number) {
    const needed = new Set<string>();
    for (const item of collectDrawItems(project, t)) {
      const { clip } = item;
      if (clip.kind !== 'video') continue;
      needed.add(clip.id);
      const el = this.getVideo(clip);
      if (!el) continue;
      const dur = this.mediaById.get(clip.mediaId!)?.duration ?? Infinity;
      const src = sourceTimeOf(clip, item.time);
      if (src >= dur - 0.03) {
        // ソース末尾を超えた（トランジション用の延長）→ 最終フレームで静止
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - (dur - 0.03)) > 0.1) el.currentTime = Math.max(0, dur - 0.03);
        continue;
      }
      const rate = Math.min(16, Math.max(0.0625, clip.speed));
      if (el.playbackRate !== rate) el.playbackRate = rate;
      if (el.paused) {
        if (Math.abs(el.currentTime - src) > 0.05) el.currentTime = src;
        el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - src) > 0.25 * Math.max(1, rate)) {
        el.currentTime = src;
      }
    }
    // 先読み: もうすぐ始まるクリップを頭出ししておく
    for (const clip of project.clips) {
      if (clip.kind !== 'video' || needed.has(clip.id) || clip.disabled) continue;
      if (clip.start > t && clip.start - t < LOOKAHEAD) {
        const el = this.getVideo(clip);
        if (el && el.paused && !el.seeking && Math.abs(el.currentTime - clip.offset) > 0.02) el.currentTime = clip.offset;
        needed.add(clip.id);
      }
    }
    for (const [id, pv] of this.videos) if (!needed.has(id) && !pv.el.paused) pv.el.pause();
  }

  private scheduleAudio(project: Project, t: number) {
    const ac = getAudioContext();
    this.ensureAudioGraph();
    const muted = new Set(project.tracks.filter((tr) => tr.muted).map((tr) => tr.id));
    const ctxAt = (tau: number) => this.playStartCtx + (tau - this.playStartT);
    for (const clip of project.clips) {
      if (clip.kind !== 'audio' || clip.disabled || muted.has(clip.trackId)) continue;
      const end = clipEnd(clip);
      if (end <= t + EPS) continue;
      const buffer = getAnalysis(clip.mediaId)?.audioBuffer;
      if (!buffer) continue;
      const begin = Math.max(t, clip.start);
      const offset = clip.offset + (begin - clip.start) * clip.speed;
      if (offset >= buffer.duration) continue;
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = clip.speed;
      const gain = ac.createGain();
      const vol = (clip.props.volume ?? 100) / 100;
      const fi = Math.min(clip.props.fadeIn ?? 0, clip.duration);
      const fo = Math.min(clip.props.fadeOut ?? 0, clip.duration);
      const gAt = (tau: number) => {
        let g = vol;
        if (fi > 0) g *= Math.min(1, Math.max(0, (tau - clip.start) / fi));
        if (fo > 0) g *= Math.min(1, Math.max(0, (end - tau) / fo));
        return g;
      };
      const pts = [clip.start + fi, end - fo, end].filter((x) => x > begin + EPS).sort((a, b) => a - b);
      gain.gain.setValueAtTime(gAt(begin), ctxAt(begin));
      for (const p of pts) gain.gain.linearRampToValueAtTime(gAt(p), ctxAt(p));
      let node: AudioNode = gain;
      src.connect(gain);
      const pan = (clip.props.pan ?? 0) / 100;
      if (pan !== 0) {
        const panner = ac.createStereoPanner();
        panner.pan.value = pan;
        gain.connect(panner);
        node = panner;
      }
      node.connect(this.master!);
      src.start(ctxAt(begin), offset, (end - begin) * clip.speed);
      this.sources.push(src);
    }
  }

  private stopAudio() {
    for (const s of this.sources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* 既に停止済み */
      }
    }
    this.sources = [];
  }

  private restartAudio() {
    const t = this.currentTime();
    const ac = getAudioContext();
    this.stopAudio();
    this.playStartT = t;
    this.playStartCtx = ac.currentTime + 0.03;
    this.scheduleAudio(getState().project, t);
  }

  // ---------- 書き出し ----------
  /** 指定時刻に必要な映像のシークが完了するまで待つ */
  private async prepareAt(t: number) {
    const { project } = getState();
    const waits: Promise<void>[] = [];
    for (const item of collectDrawItems(project, t)) {
      if (item.clip.kind === 'image') {
        const img = this.getImage(item.clip.mediaId!);
        if (img && !img.complete) waits.push(new Promise((r) => img.addEventListener('load', () => r(), { once: true })));
      }
      if (item.clip.kind !== 'video') continue;
      const el = this.getVideo(item.clip);
      if (!el) continue;
      el.pause();
      el.currentTime = Math.max(0, sourceTimeOf(item.clip, item.time));
      waits.push(
        new Promise((r) => {
          const done = () => r();
          el.addEventListener('seeked', done, { once: true });
          setTimeout(done, 3000);
        }),
      );
    }
    await Promise.all(waits);
  }

  async exportVideo(opts: {
    mimeType: string;
    videoBitsPerSecond: number;
    onProgress: (p: number) => void;
    signal: AbortSignal;
  }): Promise<Blob> {
    const { project } = getState();
    const end = sequenceDuration(project);
    if (end <= 0) throw new Error('タイムラインが空です');
    this.pause();
    const ac = getAudioContext();
    if (ac.state !== 'running') await ac.resume();
    this.ensureAudioGraph();
    if (!this.exportDest) {
      this.exportDest = ac.createMediaStreamDestination();
      this.master!.connect(this.exportDest);
    }

    const canvas = document.createElement('canvas');
    canvas.width = project.sequence.width;
    canvas.height = project.sequence.height;
    this.exportCanvas = canvas;
    setUI({ exporting: true, playhead: 0 });

    try {
      await this.prepareAt(0);
      this.draw(0);
      const stream = canvas.captureStream(project.sequence.fps);
      for (const tr of this.exportDest.stream.getAudioTracks()) stream.addTrack(tr);
      const recorder = new MediaRecorder(stream, {
        mimeType: opts.mimeType,
        videoBitsPerSecond: opts.videoBitsPerSecond,
        audioBitsPerSecond: 192_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: opts.mimeType.split(';')[0] }));
        recorder.onerror = () => reject(new Error('録画中にエラーが発生しました'));
      });
      const progressTimer = window.setInterval(() => opts.onProgress(Math.min(1, this.currentTime() / end)), 200);
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        this.exportStop = null;
        this.pause();
        recorder.stop();
      };
      opts.signal.addEventListener('abort', onAbort, { once: true });
      this.exportStop = () => {
        // 最終フレームを確実に記録するため少し待ってから停止
        setTimeout(() => recorder.state !== 'inactive' && recorder.stop(), 250);
      };
      recorder.start(1000);
      await this.play();
      const blob = await finished;
      clearInterval(progressTimer);
      opts.signal.removeEventListener('abort', onAbort);
      stream.getVideoTracks().forEach((tr) => tr.stop());
      if (aborted) throw new DOMException('中止しました', 'AbortError');
      opts.onProgress(1);
      return blob;
    } finally {
      this.exportStop = null;
      this.exportCanvas = null;
      setUI({ exporting: false });
      this.requestRender();
    }
  }

  /** 現在のフレームを PNG で取得 */
  async snapshot(): Promise<Blob | null> {
    const { project, ui } = getState();
    const canvas = document.createElement('canvas');
    canvas.width = project.sequence.width;
    canvas.height = project.sequence.height;
    await this.prepareAt(ui.playhead);
    renderFrame(canvas.getContext('2d')!, project, ui.playhead, this, 1);
    return new Promise((r) => canvas.toBlob(r, 'image/png'));
  }
}

function audioRelevantChange(a: Project, b: Project): boolean {
  if (a.tracks !== b.tracks) return true;
  if (a.clips === b.clips) return false;
  const pa = a.clips.filter((c) => c.kind === 'audio');
  const pb = b.clips.filter((c) => c.kind === 'audio');
  if (pa.length !== pb.length) return true;
  return pa.some((c, i) => c !== pb[i]);
}

export function supportedExportTypes(): { mime: string; label: string; ext: string }[] {
  const candidates = [
    { mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', label: 'MP4 (H.264 / AAC)', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1,mp4a.40.2', label: 'MP4 (H.264 / AAC)', ext: 'mp4' },
    { mime: 'video/mp4', label: 'MP4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', label: 'WebM (VP9 / Opus)', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', label: 'WebM (VP8 / Opus)', ext: 'webm' },
    { mime: 'video/webm', label: 'WebM', ext: 'webm' },
  ];
  if (typeof MediaRecorder === 'undefined') return [];
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (!MediaRecorder.isTypeSupported(c.mime) || seen.has(c.label)) return false;
    seen.add(c.label);
    return true;
  });
}

export const engine = new Engine();
