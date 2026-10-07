import { describe, expect, it } from 'vitest';
import {
  clearRanges,
  clipsForMedia,
  createDefaultTracks,
  gapAt,
  insertSpace,
  makeClip,
  rippleDelete,
  rippleShift,
  snapTime,
  splitClips,
  trimClips,
  setSpeed,
} from './timeline';
import { getProp } from './props';
import type { Clip, MediaItem } from './types';

const media: MediaItem = {
  id: 'm1', name: 'a.mp4', type: 'video', url: '', duration: 10, width: 1920, height: 1080,
  hasAudio: true, size: 0, mime: 'video/mp4',
};

function v(id: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return makeClip({ id, kind: 'video', mediaId: 'm1', trackId: 'V1', start, duration, name: id, ...extra });
}

describe('clearRanges (上書き)', () => {
  it('完全に覆われたクリップを削除し、部分的に重なるクリップをトリムする', () => {
    const clips = [v('a', 0, 4), v('b', 4, 4), v('c', 8, 4)];
    const out = clearRanges(clips, [{ trackId: 'V1', start: 3, end: 9 }]);
    expect(out.map((c) => [c.id, c.start, c.duration, c.offset])).toEqual([
      ['a', 0, 3, 0],
      ['c', 9, 3, 1],
    ]);
  });

  it('クリップの中央を上書きすると左右に分割される', () => {
    const out = clearRanges([v('a', 0, 10)], [{ trackId: 'V1', start: 2, end: 5 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: 'a', start: 0, duration: 2 });
    expect(out[1]).toMatchObject({ start: 5, duration: 5, offset: 5 });
  });

  it('別トラックには影響しない', () => {
    const out = clearRanges([v('a', 0, 10)], [{ trackId: 'V2', start: 2, end: 5 }]);
    expect(out).toHaveLength(1);
  });
});

describe('splitClips', () => {
  it('リンククリップも一緒に分割し、右側同士は新しい linkId で結ばれる', () => {
    const clips = [v('a', 0, 10, { linkId: 'L' }), v('b', 0, 10, { kind: 'audio', trackId: 'A1', linkId: 'L' })];
    const out = splitClips(clips, ['a'], 4);
    expect(out).toHaveLength(4);
    const rights = out.filter((c) => c.start === 4);
    expect(rights).toHaveLength(2);
    expect(rights[0].linkId).toBe(rights[1].linkId);
    expect(rights[0].linkId).not.toBe('L');
    expect(rights.every((c) => c.offset === 4 && c.duration === 6)).toBe(true);
  });

  it('キーフレームを分割点で保持する', () => {
    const c = v('a', 0, 10, { keyframes: { opacity: [{ t: 0, v: 0 }, { t: 10, v: 100 }] } });
    const [l, r] = splitClips([c], ['a'], 5);
    expect(getProp(l, 'opacity', 5)).toBeCloseTo(50);
    expect(getProp(r, 'opacity', 0)).toBeCloseTo(50);
    expect(getProp(r, 'opacity', 5)).toBeCloseTo(100);
  });

  it('クリップの端では分割しない', () => {
    expect(splitClips([v('a', 0, 10)], ['a'], 0)).toHaveLength(1);
    expect(splitClips([v('a', 0, 10)], ['a'], 10)).toHaveLength(1);
  });
});

describe('ripple', () => {
  it('リップル削除で後続クリップが詰まる', () => {
    const out = rippleDelete([v('a', 0, 2), v('b', 2, 3), v('c', 5, 2)], ['b']);
    expect(out.map((c) => [c.id, c.start])).toEqual([
      ['a', 0],
      ['c', 2],
    ]);
  });

  it('他トラックの障害物があれば詰める量を制限する', () => {
    const clips = [v('a', 0, 2), v('c', 5, 2), v('x', 1, 3, { trackId: 'V2' }), v('y', 6, 1, { trackId: 'V2' })];
    const { clips: out, shifted } = rippleShift(clips, 5, 3);
    // V2 では x が 4 まで占有しているので、y は 4 までしか動けない (2 秒)
    expect(shifted).toBe(2);
    expect(out.find((c) => c.id === 'c')!.start).toBe(3);
  });

  it('gapAt でギャップを検出する', () => {
    expect(gapAt([v('a', 0, 2), v('b', 5, 1)], 'V1', 3)).toEqual({ start: 2, end: 5 });
    expect(gapAt([v('a', 0, 2)], 'V1', 1)).toBeNull();
  });

  it('insertSpace で挿入点のクリップを分割して後ろへずらす', () => {
    const out = insertSpace([v('a', 0, 4), v('b', 4, 2)], 2, 3);
    expect(out.map((c) => [c.start, c.duration]).sort((x, y) => x[0] - y[0])).toEqual([
      [0, 2],
      [5, 2],
      [7, 2],
    ]);
  });
});

describe('trimClips', () => {
  const ctx = (clips: Clip[]) => ({ clips, media: [media], minDuration: 1 / 30 });

  it('ソースの長さを超えて伸ばせない', () => {
    const out = trimClips(ctx([v('a', 0, 5, { offset: 2 })]), ['a'], 'out', 100);
    expect(out[0].duration).toBe(8);
    const out2 = trimClips(ctx([v('a', 3, 5, { offset: 2 })]), ['a'], 'in', -100);
    expect(out2[0]).toMatchObject({ start: 1, offset: 0, duration: 7 });
  });

  it('隣接クリップを越えられない', () => {
    const out = trimClips(ctx([v('a', 0, 2), v('b', 3, 2)]), ['a'], 'out', 5);
    expect(out[0].duration).toBe(3);
  });
});

describe('clipsForMedia', () => {
  it('音声付き動画は V1 と A1 のリンククリップになる', () => {
    const out = clipsForMedia(createDefaultTracks(), media, 'V1', 0);
    expect(out.map((c) => [c.kind, c.trackId])).toEqual([
      ['video', 'V1'],
      ['audio', 'A1'],
    ]);
    expect(out[0].linkId).toBeDefined();
    expect(out[0].linkId).toBe(out[1].linkId);
  });

  it('V2 にドロップすると A2 と対になる', () => {
    const out = clipsForMedia(createDefaultTracks(), media, 'V2', 0);
    expect(out.map((c) => c.trackId)).toEqual(['V2', 'A2']);
  });
});

describe('misc', () => {
  it('スナップ', () => {
    expect(snapTime(4.95, [0, 5, 10], 0.1)).toEqual({ time: 5, snapped: true });
    expect(snapTime(4.5, [0, 5, 10], 0.1)).toEqual({ time: 4.5, snapped: false });
  });

  it('速度 2x で長さが半分になる', () => {
    const c = setSpeed(v('a', 0, 4), 2, [media]);
    expect(c.duration).toBe(2);
  });
});
