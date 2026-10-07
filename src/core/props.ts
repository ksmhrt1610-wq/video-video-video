import type { Clip, ClipKind, Keyframe } from './types';

export interface PropDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  animatable: boolean;
  group: 'motion' | 'opacity' | 'color' | 'audio' | 'time';
}

export const PROP_DEFS: PropDef[] = [
  { key: 'x', label: '位置 X', min: -4000, max: 4000, step: 1, default: 0, unit: 'px', animatable: true, group: 'motion' },
  { key: 'y', label: '位置 Y', min: -4000, max: 4000, step: 1, default: 0, unit: 'px', animatable: true, group: 'motion' },
  { key: 'scale', label: 'スケール', min: 0, max: 1000, step: 1, default: 100, unit: '%', animatable: true, group: 'motion' },
  { key: 'rotation', label: '回転', min: -3600, max: 3600, step: 1, default: 0, unit: '°', animatable: true, group: 'motion' },
  { key: 'opacity', label: '不透明度', min: 0, max: 100, step: 1, default: 100, unit: '%', animatable: true, group: 'opacity' },
  { key: 'brightness', label: '明るさ', min: 0, max: 300, step: 1, default: 100, unit: '%', animatable: true, group: 'color' },
  { key: 'contrast', label: 'コントラスト', min: 0, max: 300, step: 1, default: 100, unit: '%', animatable: true, group: 'color' },
  { key: 'saturation', label: '彩度', min: 0, max: 300, step: 1, default: 100, unit: '%', animatable: true, group: 'color' },
  { key: 'hue', label: '色相', min: -180, max: 180, step: 1, default: 0, unit: '°', animatable: true, group: 'color' },
  { key: 'grayscale', label: 'モノクロ', min: 0, max: 100, step: 1, default: 0, unit: '%', animatable: true, group: 'color' },
  { key: 'sepia', label: 'セピア', min: 0, max: 100, step: 1, default: 0, unit: '%', animatable: true, group: 'color' },
  { key: 'invert', label: '反転', min: 0, max: 100, step: 1, default: 0, unit: '%', animatable: true, group: 'color' },
  { key: 'blur', label: 'ブラー', min: 0, max: 100, step: 0.5, default: 0, unit: 'px', animatable: true, group: 'color' },
  { key: 'volume', label: 'ボリューム', min: 0, max: 200, step: 1, default: 100, unit: '%', animatable: false, group: 'audio' },
  { key: 'pan', label: 'パン', min: -100, max: 100, step: 1, default: 0, animatable: false, group: 'audio' },
  { key: 'fadeIn', label: 'フェードイン', min: 0, max: 30, step: 0.1, default: 0, unit: '秒', animatable: false, group: 'audio' },
  { key: 'fadeOut', label: 'フェードアウト', min: 0, max: 30, step: 0.1, default: 0, unit: '秒', animatable: false, group: 'audio' },
];

export const PROP_BY_KEY: Record<string, PropDef> = Object.fromEntries(PROP_DEFS.map((p) => [p.key, p]));

export function isVisualKind(kind: ClipKind): boolean {
  return kind !== 'audio';
}

export function propsForKind(kind: ClipKind): PropDef[] {
  if (kind === 'audio') return PROP_DEFS.filter((p) => p.group === 'audio');
  return PROP_DEFS.filter((p) => p.group !== 'audio');
}

export function defaultProps(kind: ClipKind): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of propsForKind(kind)) out[p.key] = p.default;
  return out;
}

/** クリップ先頭からの相対時間 localT におけるプロパティ値（キーフレームを線形補間） */
export function getProp(clip: Clip, key: string, localT: number): number {
  const kfs = clip.keyframes[key];
  if (kfs && kfs.length > 0) return interpolate(kfs, localT);
  const v = clip.props[key];
  return v ?? PROP_BY_KEY[key]?.default ?? 0;
}

export function interpolate(kfs: Keyframe[], t: number): number {
  if (t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.v;
      const k = (t - a.t) / span;
      // イーズイン・アウト（Premiere の「自動ベジェ」風）
      const e = k * k * (3 - 2 * k);
      return a.v + (b.v - a.v) * e;
    }
  }
  return last.v;
}

/** キーフレームを追加・更新（同時刻±半フレームは上書き） */
export function upsertKeyframe(kfs: Keyframe[], t: number, v: number, tolerance = 1 / 60): Keyframe[] {
  const out = kfs.filter((k) => Math.abs(k.t - t) > tolerance);
  out.push({ t, v });
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function keyframeAt(kfs: Keyframe[] | undefined, t: number, tolerance = 1 / 60): Keyframe | undefined {
  return kfs?.find((k) => Math.abs(k.t - t) <= tolerance);
}
