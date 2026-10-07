import type { Clip, Project, Track, TransitionType } from './types';
import { getProp } from './props';
import { clipEnd, EPS } from './timeline';

/** 合成時に描画ソースを取得するためのインターフェース（エンジンが実装） */
export interface SourceProvider {
  /** クリップの映像ソース（準備ができていなければ null） */
  getVisual(clip: Clip, sourceTime: number): CanvasImageSource | null;
  getSize(clip: Clip): { width: number; height: number } | null;
}

export interface LayerMod {
  alpha: number;
  offsetX: number;
  scaleMul: number;
  /** 0..1 の割合で左から表示する（ワイプ） */
  revealX?: number;
  overlayColor?: string;
  overlayAlpha?: number;
}

const IDENTITY: LayerMod = { alpha: 1, offsetX: 0, scaleMul: 1 };

export interface DrawItem {
  clip: Clip;
  /** タイムライン時刻（クリップ範囲外になることもある＝トランジション用の延長） */
  time: number;
  mod: LayerMod;
}

export function sourceTimeOf(clip: Clip, t: number): number {
  return clip.offset + (t - clip.start) * clip.speed;
}

/** トランジションの変形（p: 0→1 で入ってくる側が完全に表示される） */
export function transitionMods(type: TransitionType, p: number, width: number, hasPrev: boolean): { prev?: LayerMod; cur: LayerMod } {
  const cur: LayerMod = { ...IDENTITY };
  const prev: LayerMod = { ...IDENTITY };
  switch (type) {
    case 'cross-dissolve':
      cur.alpha = p;
      break;
    case 'dip-black':
    case 'dip-white': {
      const color = type === 'dip-black' ? '#000' : '#fff';
      if (hasPrev) {
        if (p < 0.5) {
          prev.overlayColor = color;
          prev.overlayAlpha = p * 2;
          cur.alpha = 0;
        } else {
          cur.overlayColor = color;
          cur.overlayAlpha = (1 - p) * 2;
        }
      } else {
        cur.overlayColor = color;
        cur.overlayAlpha = 1 - p;
      }
      break;
    }
    case 'wipe':
      cur.revealX = p;
      break;
    case 'slide':
      cur.offsetX = (1 - p) * width;
      break;
    case 'push':
      cur.offsetX = (1 - p) * width;
      prev.offsetX = -p * width;
      break;
    case 'zoom':
      cur.scaleMul = Math.max(0.001, p);
      cur.alpha = p;
      break;
  }
  return { prev: hasPrev ? prev : undefined, cur };
}

/** 終了側トランジション（q: 0→1 でクリップが消えていく） */
export function transitionOutMod(type: TransitionType, q: number, width: number): LayerMod {
  const p = 1 - q;
  if (type === 'slide' || type === 'push') return { ...IDENTITY, offsetX: -q * width };
  if (type === 'wipe') return { ...IDENTITY, revealX: p };
  return transitionMods(type, p, width, false).cur;
}

const ease = (x: number) => x * x * (3 - 2 * x);

/** 時刻 t に描画するレイヤーを下から順に列挙 */
export function collectDrawItems(project: Project, t: number): DrawItem[] {
  const items: DrawItem[] = [];
  const videoTracks = project.tracks.filter((tr) => tr.kind === 'video').reverse(); // 下 (V1) から
  for (const track of videoTracks) {
    if (track.hidden) continue;
    items.push(...trackItems(project, track, t));
  }
  return items;
}

function trackItems(project: Project, track: Track, t: number): DrawItem[] {
  const clips = project.clips.filter((c) => c.trackId === track.id && !c.disabled);
  const cur = clips.find((c) => t >= c.start - EPS && t < clipEnd(c) - EPS);
  if (!cur) return [];
  const W = project.sequence.width;
  let mod: LayerMod = { ...IDENTITY };
  const out: DrawItem[] = [];
  const local = t - cur.start;
  const tin = cur.transitionIn;
  if (tin && local < tin.duration) {
    const p = ease(Math.min(1, Math.max(0, local / tin.duration)));
    const prevClip = clips.find((c) => Math.abs(clipEnd(c) - cur.start) < 1e-3 && c.id !== cur.id);
    const mods = transitionMods(tin.type, p, W, !!prevClip);
    if (prevClip && mods.prev) out.push({ clip: prevClip, time: t, mod: mods.prev });
    mod = mods.cur;
  }
  const tout = cur.transitionOut;
  const remain = clipEnd(cur) - t;
  if (tout && remain < tout.duration) {
    const q = ease(Math.min(1, Math.max(0, 1 - remain / tout.duration)));
    const m2 = transitionOutMod(tout.type, q, W);
    mod = combine(mod, m2);
  }
  out.push({ clip: cur, time: t, mod });
  return out;
}

function combine(a: LayerMod, b: LayerMod): LayerMod {
  return {
    alpha: a.alpha * b.alpha,
    offsetX: a.offsetX + b.offsetX,
    scaleMul: a.scaleMul * b.scaleMul,
    revealX: a.revealX !== undefined || b.revealX !== undefined ? Math.min(a.revealX ?? 1, b.revealX ?? 1) : undefined,
    overlayColor: b.overlayColor ?? a.overlayColor,
    overlayAlpha: Math.max(a.overlayAlpha ?? 0, b.overlayAlpha ?? 0) || undefined,
  };
}

export function filterString(clip: Clip, local: number): string {
  const parts: string[] = [];
  const b = getProp(clip, 'brightness', local);
  const c = getProp(clip, 'contrast', local);
  const s = getProp(clip, 'saturation', local);
  const h = getProp(clip, 'hue', local);
  const g = getProp(clip, 'grayscale', local);
  const se = getProp(clip, 'sepia', local);
  const inv = getProp(clip, 'invert', local);
  const bl = getProp(clip, 'blur', local);
  if (b !== 100) parts.push(`brightness(${b}%)`);
  if (c !== 100) parts.push(`contrast(${c}%)`);
  if (s !== 100) parts.push(`saturate(${s}%)`);
  if (h !== 0) parts.push(`hue-rotate(${h}deg)`);
  if (g !== 0) parts.push(`grayscale(${g}%)`);
  if (se !== 0) parts.push(`sepia(${se}%)`);
  if (inv !== 0) parts.push(`invert(${inv}%)`);
  if (bl > 0) parts.push(`blur(${bl}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

export interface ClipGeometry {
  /** キャンバス中心からのオフセット適用後の中心座標 */
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

/** クリップ内容の基本サイズ（スケール 100% のとき、フレームにフィット） */
export function baseSize(clip: Clip, src: { width: number; height: number } | null, W: number, H: number) {
  if (clip.kind === 'color') return { width: W, height: H };
  if (!src || !src.width || !src.height) return { width: W, height: H };
  const k = Math.min(W / src.width, H / src.height);
  return { width: src.width * k, height: src.height * k };
}

export function clipGeometry(clip: Clip, local: number, size: { width: number; height: number }, W: number, H: number): ClipGeometry {
  const scale = getProp(clip, 'scale', local) / 100;
  return {
    cx: W / 2 + getProp(clip, 'x', local),
    cy: H / 2 + getProp(clip, 'y', local),
    width: size.width * scale,
    height: size.height * scale,
    rotation: (getProp(clip, 'rotation', local) * Math.PI) / 180,
  };
}

let layerCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
function getLayer(w: number, h: number) {
  if (!layerCanvas) {
    layerCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas');
  }
  if (layerCanvas.width !== w || layerCanvas.height !== h) {
    layerCanvas.width = w;
    layerCanvas.height = h;
  }
  return layerCanvas;
}

/**
 * 1 フレームを描画する。
 * scale はプレビュー用の縮小率（キャンバスサイズ = シーケンスサイズ × scale）。
 */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  project: Project,
  t: number,
  provider: SourceProvider,
  scale = 1,
) {
  const { width: W, height: H, background } = project.sequence;
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, cw, ch);

  const layer = getLayer(cw, ch);
  const lctx = layer.getContext('2d') as CanvasRenderingContext2D;

  for (const item of collectDrawItems(project, t)) {
    const { clip, mod } = item;
    const local = Math.min(Math.max(0, item.time - clip.start), clip.duration);
    const opacity = (getProp(clip, 'opacity', local) / 100) * mod.alpha;
    if (opacity <= 0.001) continue;

    // レイヤーに描画
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalAlpha = 1;
    lctx.globalCompositeOperation = 'source-over';
    lctx.filter = 'none';
    lctx.clearRect(0, 0, cw, ch);
    lctx.setTransform(scale, 0, 0, scale, 0, 0);
    lctx.filter = filterString(clip, local);
    const drawn = drawClipContent(lctx, clip, item.time, local, provider, W, H, mod);
    lctx.filter = 'none';
    if (!drawn) continue;

    if (mod.overlayColor && mod.overlayAlpha) {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'source-atop';
      lctx.globalAlpha = Math.min(1, mod.overlayAlpha);
      lctx.fillStyle = mod.overlayColor;
      lctx.fillRect(0, 0, cw, ch);
      lctx.globalCompositeOperation = 'source-over';
      lctx.globalAlpha = 1;
    }

    // 合成
    ctx.save();
    ctx.globalAlpha = Math.min(1, opacity);
    ctx.globalCompositeOperation = clip.blendMode ?? 'source-over';
    if (mod.revealX !== undefined) {
      ctx.beginPath();
      ctx.rect(0, 0, cw * mod.revealX, ch);
      ctx.clip();
    }
    ctx.drawImage(layer as CanvasImageSource, mod.offsetX * scale, 0);
    ctx.restore();
  }
}

function drawClipContent(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  t: number,
  local: number,
  provider: SourceProvider,
  W: number,
  H: number,
  mod: LayerMod,
): boolean {
  if (clip.kind === 'text') {
    if (!clip.text) return false;
    const g = clipGeometry(clip, local, { width: W, height: H }, W, H);
    const s = (g.width / W) * mod.scaleMul;
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(g.rotation);
    ctx.scale(s, s);
    drawText(ctx, clip);
    ctx.restore();
    return true;
  }
  if (clip.kind === 'color') {
    const g = clipGeometry(clip, local, { width: W, height: H }, W, H);
    ctx.save();
    ctx.translate(g.cx, g.cy);
    ctx.rotate(g.rotation);
    ctx.scale(mod.scaleMul, mod.scaleMul);
    ctx.fillStyle = clip.color ?? '#000';
    ctx.fillRect(-g.width / 2, -g.height / 2, g.width, g.height);
    ctx.restore();
    return true;
  }
  const src = provider.getVisual(clip, sourceTimeOf(clip, t));
  if (!src) return false;
  const size = baseSize(clip, provider.getSize(clip), W, H);
  const g = clipGeometry(clip, local, size, W, H);
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.rotate(g.rotation);
  ctx.scale(mod.scaleMul, mod.scaleMul);
  ctx.drawImage(src, -g.width / 2, -g.height / 2, g.width, g.height);
  ctx.restore();
  return true;
}

export function textFont(clip: Clip): string {
  const s = clip.text!;
  return `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${s.fontSize}px ${s.fontFamily}`;
}

/** テキストのバウンディングボックス（原点中心、スケール前） */
export function measureText(ctx: CanvasRenderingContext2D, clip: Clip) {
  const s = clip.text!;
  ctx.font = textFont(clip);
  const lines = s.content.split('\n');
  const lineH = s.fontSize * 1.25;
  const width = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
  const height = lines.length * lineH;
  return { width, height, lines, lineH };
}

function drawText(ctx: CanvasRenderingContext2D, clip: Clip) {
  const s = clip.text!;
  const { width, height, lines, lineH } = measureText(ctx, clip);
  const pad = s.fontSize * 0.3;
  if (s.bgOpacity > 0) {
    ctx.save();
    ctx.globalAlpha *= s.bgOpacity / 100;
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(-width / 2 - pad, -height / 2 - pad / 2, width + pad * 2, height + pad);
    ctx.restore();
  }
  ctx.textBaseline = 'middle';
  ctx.textAlign = s.align;
  const x = s.align === 'left' ? -width / 2 : s.align === 'right' ? width / 2 : 0;
  lines.forEach((line, i) => {
    const y = -height / 2 + lineH * (i + 0.5);
    if (s.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = s.fontSize * 0.08;
      ctx.shadowOffsetX = s.fontSize * 0.03;
      ctx.shadowOffsetY = s.fontSize * 0.03;
    }
    if (s.strokeWidth > 0) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = s.strokeWidth * 2;
      ctx.strokeStyle = s.strokeColor;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = s.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = 'transparent';
  });
}

/** モニター上での選択枠（シーケンス座標の四隅） */
export function clipCorners(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  local: number,
  provider: SourceProvider,
  W: number,
  H: number,
): [number, number][] | null {
  let size: { width: number; height: number };
  let g: ClipGeometry;
  if (clip.kind === 'text') {
    if (!clip.text) return null;
    const m = measureText(ctx, clip);
    const pad = clip.text.fontSize * 0.3;
    g = clipGeometry(clip, local, { width: W, height: H }, W, H);
    const s = g.width / W;
    size = { width: (m.width + pad * 2) * s, height: (m.height + pad) * s };
  } else if (clip.kind === 'audio') {
    return null;
  } else {
    const base = baseSize(clip, provider.getSize(clip), W, H);
    g = clipGeometry(clip, local, base, W, H);
    size = { width: g.width, height: g.height };
  }
  const hw = size.width / 2;
  const hh = size.height / 2;
  const cos = Math.cos(g.rotation);
  const sin = Math.sin(g.rotation);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [g.cx + x * cos - y * sin, g.cy + x * sin + y * cos]);
}
