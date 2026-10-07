import type { Clip, ClipKind, MediaItem, Project, Track, TrackKind, TextStyle } from './types';
import { defaultProps } from './props';

export const EPS = 1e-6;

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}

export const clipEnd = (c: Clip): number => c.start + c.duration;

export function trackKindForClip(kind: ClipKind): TrackKind {
  return kind === 'audio' ? 'audio' : 'video';
}

/** ソース素材の長さ（秒）。上限のない素材は Infinity */
export function sourceDuration(clip: Clip, media: MediaItem[] | Map<string, MediaItem>): number {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return Infinity;
  const m = media instanceof Map ? media.get(clip.mediaId!) : media.find((x) => x.id === clip.mediaId);
  return m && m.duration > 0 ? m.duration : Infinity;
}

export function sequenceDuration(p: Project): number {
  let end = 0;
  for (const c of p.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function linkedGroup(clips: Clip[], ids: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const links = new Set<string>();
  const idSet = new Set(ids);
  for (const c of clips) {
    if (idSet.has(c.id)) {
      out.add(c.id);
      if (c.linkId) links.add(c.linkId);
    }
  }
  for (const c of clips) if (c.linkId && links.has(c.linkId)) out.add(c.id);
  return out;
}

function shiftKeyframes(clip: Clip, dt: number): Clip['keyframes'] {
  if (Math.abs(dt) < EPS) return clip.keyframes;
  const out: Clip['keyframes'] = {};
  for (const [k, kfs] of Object.entries(clip.keyframes)) {
    out[k] = kfs.map((kf) => ({ t: kf.t + dt, v: kf.v }));
  }
  return out;
}

/** クリップの先頭を dt 秒だけ削る（負なら伸ばす） */
export function trimHead(clip: Clip, dt: number): Clip {
  return {
    ...clip,
    start: clip.start + dt,
    duration: clip.duration - dt,
    offset: clip.offset + dt * clip.speed,
    keyframes: shiftKeyframes(clip, -dt),
  };
}

export interface Range {
  trackId: string;
  start: number;
  end: number;
}

/**
 * 上書き編集: 指定範囲にかかる既存クリップを削除・トリム・分割する。
 * exclude に含まれるクリップは影響を受けない。
 */
export function clearRanges(clips: Clip[], ranges: Range[], exclude: Set<string> = new Set()): Clip[] {
  const linkMap = new Map<string, string>();
  let out = clips;
  for (const r of ranges) {
    if (r.end - r.start < EPS) continue;
    const next: Clip[] = [];
    for (const c of out) {
      if (c.trackId !== r.trackId || exclude.has(c.id)) {
        next.push(c);
        continue;
      }
      const s = c.start;
      const e = clipEnd(c);
      if (e <= r.start + EPS || s >= r.end - EPS) {
        next.push(c);
      } else if (s >= r.start - EPS && e <= r.end + EPS) {
        // 完全に覆われる → 削除
      } else if (s < r.start && e > r.end) {
        // 中央に挿入 → 左右に分割
        next.push({ ...c, duration: r.start - s, transitionOut: undefined });
        let link: string | undefined;
        if (c.linkId) {
          link = linkMap.get(c.linkId) ?? uid('link');
          linkMap.set(c.linkId, link);
        }
        const right = trimHead({ ...c, id: uid('clip'), linkId: link, transitionIn: undefined }, r.end - s);
        next.push(right);
      } else if (s < r.start) {
        next.push({ ...c, duration: r.start - s, transitionOut: undefined });
      } else {
        next.push({ ...trimHead(c, r.end - s), transitionIn: undefined });
      }
    }
    out = next;
  }
  return out;
}

/** 時刻 t でクリップ（とリンク先）を分割する */
export function splitClips(clips: Clip[], ids: Iterable<string>, t: number): Clip[] {
  const group = linkedGroup(clips, ids);
  const linkMap = new Map<string, string>();
  const out: Clip[] = [];
  for (const c of clips) {
    if (!group.has(c.id) || t <= c.start + EPS || t >= clipEnd(c) - EPS) {
      out.push(c);
      continue;
    }
    const local = t - c.start;
    const leftKf: Clip['keyframes'] = {};
    const rightKf: Clip['keyframes'] = {};
    for (const [k, kfs] of Object.entries(c.keyframes)) {
      leftKf[k] = kfs.filter((kf) => kf.t <= local + EPS);
      rightKf[k] = kfs.filter((kf) => kf.t >= local - EPS).map((kf) => ({ t: kf.t - local, v: kf.v }));
      // 境界値を保持してアニメーションを途切れさせない
      if (kfs.length > 0) {
        const v = interpolateLinearSafe(kfs, local);
        if (!leftKf[k].some((kf) => Math.abs(kf.t - local) < EPS)) leftKf[k].push({ t: local, v });
        if (!rightKf[k].some((kf) => Math.abs(kf.t) < EPS)) rightKf[k].unshift({ t: 0, v });
      }
    }
    let link: string | undefined;
    if (c.linkId) {
      link = linkMap.get(c.linkId) ?? uid('link');
      linkMap.set(c.linkId, link);
    }
    out.push({ ...c, duration: local, keyframes: leftKf, transitionOut: undefined });
    out.push({
      ...c,
      id: uid('clip'),
      linkId: link,
      start: t,
      duration: c.duration - local,
      offset: c.offset + local * c.speed,
      keyframes: rightKf,
      transitionIn: undefined,
    });
  }
  return out;
}

function interpolateLinearSafe(kfs: { t: number; v: number }[], t: number): number {
  if (t <= kfs[0].t) return kfs[0].v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = b.t - a.t > 0 ? (t - a.t) / (b.t - a.t) : 1;
      const e = k * k * (3 - 2 * k);
      return a.v + (b.v - a.v) * e;
    }
  }
  return kfs[kfs.length - 1].v;
}

/**
 * at 以降のクリップをすべてのトラックで左に詰める（シンクロック相当）。
 * どのトラックでも既存クリップと重ならない範囲で最大 amount 秒だけ詰める。
 * 実際に詰めた量を返す。
 */
export function rippleShift(clips: Clip[], at: number, amount: number): { clips: Clip[]; shifted: number } {
  const byTrack = new Map<string, Clip[]>();
  for (const c of clips) {
    if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, []);
    byTrack.get(c.trackId)!.push(c);
  }
  let allowed = amount;
  for (const list of byTrack.values()) {
    const movable = list.filter((c) => c.start >= at - EPS);
    if (movable.length === 0) continue;
    const firstStart = Math.min(...movable.map((c) => c.start));
    const blockerEnd = Math.max(0, ...list.filter((c) => c.start < at - EPS).map(clipEnd));
    allowed = Math.min(allowed, firstStart - blockerEnd);
  }
  allowed = Math.max(0, allowed);
  if (allowed < EPS) return { clips, shifted: 0 };
  return {
    clips: clips.map((c) => (c.start >= at - EPS ? { ...c, start: c.start - allowed } : c)),
    shifted: allowed,
  };
}

/** リップル削除: クリップを削除し、できた隙間を詰める */
export function rippleDelete(clips: Clip[], ids: Iterable<string>): Clip[] {
  const group = linkedGroup(clips, ids);
  const removed = clips.filter((c) => group.has(c.id));
  let out = clips.filter((c) => !group.has(c.id));
  // 右側の範囲から順に詰める
  const spans = mergeSpans(removed.map((c) => [c.start, clipEnd(c)] as [number, number])).sort((a, b) => b[0] - a[0]);
  for (const [s, e] of spans) {
    out = rippleShift(out, e, e - s).clips;
  }
  return out;
}

export function mergeSpans(spans: [number, number][]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + EPS) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

/** トラック上の時刻 t を含む空き（ギャップ）を返す */
export function gapAt(clips: Clip[], trackId: string, t: number): { start: number; end: number } | null {
  const list = clips.filter((c) => c.trackId === trackId);
  if (list.some((c) => t >= c.start && t < clipEnd(c))) return null;
  const prevEnd = Math.max(0, ...list.filter((c) => clipEnd(c) <= t + EPS).map(clipEnd));
  const nexts = list.filter((c) => c.start >= t - EPS).map((c) => c.start);
  if (nexts.length === 0) return null;
  return { start: prevEnd, end: Math.min(...nexts) };
}

/** 挿入編集: at の位置で全トラックを分割し、以降を amount 秒右へずらす */
export function insertSpace(clips: Clip[], at: number, amount: number): Clip[] {
  const crossing = clips.filter((c) => c.start < at - EPS && clipEnd(c) > at + EPS).map((c) => c.id);
  const split = splitClips(clips, crossing, at);
  return split.map((c) => (c.start >= at - EPS ? { ...c, start: c.start + amount } : c));
}

export interface TrimContext {
  clips: Clip[];
  media: MediaItem[];
  minDuration: number;
}

/**
 * 編集点（in/out）を newTime へ動かしたときのクリップ群（リンク含む）を返す。
 * 隣接クリップ・ソースの長さで制限される。
 */
export function trimClips(
  ctx: TrimContext,
  ids: string[],
  edge: 'in' | 'out',
  delta: number,
  linked = true,
): Clip[] {
  const group = linked ? linkedGroup(ctx.clips, ids) : new Set(ids);
  let d = delta;
  for (const c of ctx.clips) {
    if (!group.has(c.id)) continue;
    const neighbors = ctx.clips.filter((o) => o.trackId === c.trackId && !group.has(o.id));
    const src = sourceDuration(c, ctx.media);
    if (edge === 'in') {
      const prevEnd = Math.max(0, ...neighbors.filter((o) => clipEnd(o) <= c.start + EPS).map(clipEnd));
      let minStart = prevEnd;
      if (Number.isFinite(src)) minStart = Math.max(minStart, c.start - c.offset / c.speed);
      const maxStart = clipEnd(c) - ctx.minDuration;
      d = Math.max(d, minStart - c.start);
      d = Math.min(d, maxStart - c.start);
    } else {
      const nextStarts = neighbors.filter((o) => o.start >= clipEnd(c) - EPS).map((o) => o.start);
      let maxEnd = nextStarts.length ? Math.min(...nextStarts) : Infinity;
      if (Number.isFinite(src)) maxEnd = Math.min(maxEnd, c.start + (src - c.offset) / c.speed);
      const minEnd = c.start + ctx.minDuration;
      d = Math.min(d, maxEnd - clipEnd(c));
      d = Math.max(d, minEnd - clipEnd(c));
    }
  }
  return ctx.clips.map((c) => {
    if (!group.has(c.id)) return c;
    if (edge === 'in') return trimHead(c, d);
    return { ...c, duration: c.duration + d };
  });
}

/** 移動量を、どのクリップも 0 秒より前に行かないよう制限する */
export function clampMoveDelta(clips: Clip[], ids: Set<string>, delta: number): number {
  let d = delta;
  for (const c of clips) if (ids.has(c.id)) d = Math.max(d, -c.start);
  return d;
}

/** 移動したクリップを確定する（移動先の既存クリップは上書き） */
export function commitMove(clips: Clip[], moved: Set<string>): Clip[] {
  const ranges: Range[] = clips.filter((c) => moved.has(c.id)).map((c) => ({ trackId: c.trackId, start: c.start, end: clipEnd(c) }));
  return clearRanges(clips, ranges, moved);
}

export function snapPoints(p: Project, exclude: Set<string>, playhead: number): number[] {
  const pts = [0, playhead];
  for (const c of p.clips) {
    if (exclude.has(c.id)) continue;
    pts.push(c.start, clipEnd(c));
  }
  for (const m of p.markers) pts.push(m.time);
  return pts;
}

export function snapTime(t: number, points: number[], threshold: number): { time: number; snapped: boolean } {
  let best = t;
  let bestDist = threshold;
  let snapped = false;
  for (const pt of points) {
    const d = Math.abs(pt - t);
    if (d <= bestDist) {
      bestDist = d;
      best = pt;
      snapped = true;
    }
  }
  return { time: best, snapped };
}

/** 次/前の編集点 */
export function editPoints(p: Project): number[] {
  const set = new Set<number>([0]);
  for (const c of p.clips) {
    set.add(round6(c.start));
    set.add(round6(clipEnd(c)));
  }
  return [...set].sort((a, b) => a - b);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function clipsAt(p: Project, t: number): Clip[] {
  return p.clips.filter((c) => t >= c.start - EPS && t < clipEnd(c) - EPS);
}

export function defaultTextStyle(content = 'テキストを入力'): TextStyle {
  return {
    content,
    fontFamily: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif',
    fontSize: 96,
    color: '#ffffff',
    bold: true,
    italic: false,
    align: 'center',
    strokeColor: '#000000',
    strokeWidth: 0,
    bgColor: '#000000',
    bgOpacity: 0,
    shadow: true,
  };
}

export function makeClip(partial: Partial<Clip> & Pick<Clip, 'kind' | 'trackId' | 'start' | 'duration' | 'name'>): Clip {
  return {
    id: uid('clip'),
    offset: 0,
    speed: 1,
    props: defaultProps(partial.kind),
    keyframes: {},
    blendMode: 'source-over',
    ...partial,
  };
}

/** 映像トラックに対応する音声トラック（同じ番号、なければ最初）を返す */
export function pairedTrack(tracks: Track[], trackId: string, kind: TrackKind): Track | undefined {
  const src = tracks.find((t) => t.id === trackId);
  const same = tracksByNumber(tracks, kind);
  if (!src) return same[0];
  if (src.kind === kind) return src;
  const idx = tracksByNumber(tracks, src.kind).indexOf(src);
  return same[idx] ?? same[same.length - 1];
}

/**
 * トラックを番号順（V1, V2, ... / A1, A2, ...）で返す。
 * 表示順は映像トラックが上から V3, V2, V1、音声トラックが A1, A2, A3。
 */
export function tracksByNumber(tracks: Track[], kind: TrackKind): Track[] {
  const list = tracks.filter((t) => t.kind === kind);
  return kind === 'video' ? list.reverse() : list;
}

export const DEFAULT_STILL_DURATION = 5;

/**
 * メディアをタイムラインに配置するクリップを作る。
 * 音声付き動画は映像＋音声のリンククリップになる。
 */
export function clipsForMedia(
  tracks: Track[],
  media: MediaItem,
  trackId: string,
  start: number,
  inPoint = 0,
  outPoint?: number,
): Clip[] {
  const base = { mediaId: media.id, name: media.name, start, offset: inPoint };
  if (media.type === 'image') {
    const vt = pairedTrack(tracks, trackId, 'video');
    if (!vt) return [];
    return [makeClip({ ...base, kind: 'image', trackId: vt.id, duration: DEFAULT_STILL_DURATION, offset: 0 })];
  }
  const end = outPoint ?? media.duration;
  const duration = Math.max(0.05, end - inPoint);
  if (media.type === 'audio') {
    const at = pairedTrack(tracks, trackId, 'audio');
    if (!at) return [];
    return [makeClip({ ...base, kind: 'audio', trackId: at.id, duration })];
  }
  const vt = pairedTrack(tracks, trackId, 'video');
  const at = pairedTrack(tracks, trackId, 'audio');
  const out: Clip[] = [];
  const linkId = media.hasAudio && vt && at ? uid('link') : undefined;
  if (vt) out.push(makeClip({ ...base, kind: 'video', trackId: vt.id, duration, linkId }));
  if (media.hasAudio && at) out.push(makeClip({ ...base, kind: 'audio', trackId: at.id, duration, linkId }));
  return out;
}

/** 新しいクリップを上書きで配置 */
export function placeClips(clips: Clip[], added: Clip[]): Clip[] {
  const ranges = added.map((c) => ({ trackId: c.trackId, start: c.start, end: clipEnd(c) }));
  return [...clearRanges(clips, ranges), ...added];
}

/** 速度変更（長さを再計算） */
export function setSpeed(clip: Clip, speed: number, media: MediaItem[]): Clip {
  const srcLen = clip.duration * clip.speed;
  let duration = srcLen / speed;
  const src = sourceDuration(clip, media);
  if (Number.isFinite(src)) duration = Math.min(duration, (src - clip.offset) / speed);
  const ratio = duration / clip.duration;
  const keyframes: Clip['keyframes'] = {};
  for (const [k, kfs] of Object.entries(clip.keyframes)) keyframes[k] = kfs.map((kf) => ({ t: kf.t * ratio, v: kf.v }));
  return { ...clip, speed, duration, keyframes };
}

export function createDefaultTracks(): Track[] {
  return [
    { id: 'V3', kind: 'video', name: 'V3', muted: false, hidden: false, locked: false },
    { id: 'V2', kind: 'video', name: 'V2', muted: false, hidden: false, locked: false },
    { id: 'V1', kind: 'video', name: 'V1', muted: false, hidden: false, locked: false },
    { id: 'A1', kind: 'audio', name: 'A1', muted: false, hidden: false, locked: false },
    { id: 'A2', kind: 'audio', name: 'A2', muted: false, hidden: false, locked: false },
    { id: 'A3', kind: 'audio', name: 'A3', muted: false, hidden: false, locked: false },
  ];
}

export function createEmptyProject(): Project {
  return {
    name: '無題のプロジェクト',
    sequence: { width: 1920, height: 1080, fps: 30, background: '#000000' },
    media: [],
    tracks: createDefaultTracks(),
    clips: [],
    markers: [],
  };
}
