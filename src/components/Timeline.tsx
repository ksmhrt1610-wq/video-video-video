import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Clip, MediaItem, Track } from '../core/types';
import { beginGesture, cancelGesture, endGesture, getState, preview, setUI, useStore } from '../store';
import {
  clampMoveDelta,
  clipEnd,
  commitMove,
  linkedGroup,
  sequenceDuration,
  snapPoints,
  snapTime,
  trimClips,
} from '../core/timeline';
import { engine } from '../core/engine';
import { analysisVersion, getAnalysis, PEAKS_PER_SEC, subscribeAnalysis, thumbnailAt } from '../core/media';
import { timecode, parseTimecode, snapToFrame } from '../core/time';
import {
  addColorMatte,
  addMarker,
  addMediaToTimeline,
  addText,
  addTrack,
  applyAudioFade,
  applyPreset,
  applyTransition,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  expandSelection,
  importFiles,
  linkSelection,
  paste,
  removeMarker,
  removeTrack,
  rippleDeleteGap,
  setZoom,
  splitAtPlayhead,
  splitClipAt,
  toggleEnabled,
  toggleTrack,
  unlinkSelection,
  updateClip,
  MIN_ZOOM,
  MAX_ZOOM,
} from '../actions';
import { Icon } from './icons';
import { openContextMenu } from './ContextMenu';
import type { TransitionType } from '../core/types';

const HEADER_W = 132;
const RULER_H = 28;
const TRACK_H = 54;
const EDGE = 7;
const SNAP_PX = 9;

export const TRANSITION_NAMES: Record<TransitionType, string> = {
  'cross-dissolve': 'クロスディゾルブ',
  'dip-black': '暗転',
  'dip-white': 'ホワイトアウト',
  wipe: 'ワイプ',
  slide: 'スライド',
  push: 'プッシュ',
  zoom: 'ズーム',
};

type Drag =
  | { kind: 'move'; x0: number; y0: number; ids: Set<string>; dragged: Clip; origTrackIdx: number; moved: boolean }
  | { kind: 'trim'; x0: number; clipId: string; edge: 'in' | 'out'; ids: string[]; linked: boolean }
  | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; additive: boolean; base: string[] }
  | { kind: 'scrub' }
  | { kind: 'pan'; x0: number; y0: number; sl: number; st: number };

export function Timeline() {
  const project = useStore((s) => s.project);
  const zoom = useStore((s) => s.ui.zoom);
  const tool = useStore((s) => s.ui.tool);
  const selection = useStore((s) => s.ui.selection);
  const snapping = useStore((s) => s.ui.snapping);
  const linked = useStore((s) => s.ui.linkedSelection);
  const exporting = useStore((s) => s.ui.exporting);
  useSyncExternalStore(subscribeAnalysis, analysisVersion);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 1000 });
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [dropHint, setDropHint] = useState<{ trackId: string; time: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const mediaMap = useMemo(() => new Map(project.media.map((m) => [m.id, m])), [project.media]);
  const selSet = useMemo(() => new Set(selection), [selection]);
  const seqDur = sequenceDuration(project);
  const contentW = Math.max((seqDur + 30) * zoom, view.width - HEADER_W);
  const fps = project.sequence.fps;

  const tracksTop = useMemo(() => {
    const m = new Map<string, number>();
    project.tracks.forEach((t, i) => m.set(t.id, RULER_H + i * TRACK_H + (t.kind === 'audio' ? 6 : 0)));
    return m;
  }, [project.tracks]);
  const totalH = RULER_H + project.tracks.length * TRACK_H + 6;

  // ビューポート監視（サムネイル・波形の仮想化用）
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const update = () => {
      const content = el.firstElementChild as HTMLElement | null;
      content?.style.setProperty('--sl', `${el.scrollLeft}px`);
      content?.style.setProperty('--st', `${el.scrollTop}px`);
      const left = Math.floor(el.scrollLeft / 200) * 200;
      const width = el.clientWidth;
      setView((v) => (v.left === left && v.width === width ? v : { left, width }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  // Ctrl + ホイールでズーム（マウス位置を基準）
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left - HEADER_W + el.scrollLeft;
      const z0 = getState().ui.zoom;
      const t = x / z0;
      const z1 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z0 * Math.exp(-e.deltaY * 0.002)));
      setZoom(z1);
      requestAnimationFrame(() => {
        el.scrollLeft = t * z1 - (e.clientX - rect.left - HEADER_W);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ズームショートカット「\」でシーケンス全体を表示
  useEffect(() => {
    const onFit = () => {
      const el = scrollRef.current!;
      const d = sequenceDuration(getState().project);
      if (d > 0) setZoom((el.clientWidth - HEADER_W - 40) / d);
      el.scrollLeft = 0;
    };
    window.addEventListener('vvv:zoom-fit', onFit);
    return () => window.removeEventListener('vvv:zoom-fit', onFit);
  }, []);

  const timeAtClientX = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft) / getState().ui.zoom);
  };
  const trackAtClientY = (clientY: number): Track | undefined => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const y = clientY - rect.top + el.scrollTop;
    const tracks = getState().project.tracks;
    return tracks.find((t) => {
      const top = tracksTop.get(t.id)!;
      return y >= top && y < top + TRACK_H;
    });
  };

  const snapThreshold = () => SNAP_PX / getState().ui.zoom;
  const doSnap = (t: number, exclude: Set<string>) => {
    const s = getState();
    if (!s.ui.snapping) return { time: t, snapped: false };
    return snapTime(t, snapPoints(s.project, exclude, s.ui.playhead), snapThreshold());
  };

  // ---------- ポインター操作 ----------
  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const s = getState();
    if (d.kind === 'scrub') {
      const t = snapToFrame(timeAtClientX(e.clientX), s.project.sequence.fps);
      const snapped = e.shiftKey ? doSnap(t, new Set()) : { time: t };
      setUI({ playhead: snapped.time });
      return;
    }
    if (d.kind === 'pan') {
      const el = scrollRef.current!;
      el.scrollLeft = d.sl - (e.clientX - d.x0);
      el.scrollTop = d.st - (e.clientY - d.y0);
      return;
    }
    if (d.kind === 'marquee') {
      d.x1 = e.clientX;
      d.y1 = e.clientY;
      const el = scrollRef.current!;
      const rect = el.getBoundingClientRect();
      const x = Math.min(d.x0, d.x1) - rect.left + el.scrollLeft;
      const y = Math.min(d.y0, d.y1) - rect.top + el.scrollTop;
      setMarquee({ x, y, w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });
      const t0 = timeAtClientX(Math.min(d.x0, d.x1));
      const t1 = timeAtClientX(Math.max(d.x0, d.x1));
      const yTop = y;
      const yBot = y + Math.abs(d.y1 - d.y0);
      const hits = s.project.clips
        .filter((c) => {
          const top = tracksTop.get(c.trackId)!;
          return c.start < t1 && clipEnd(c) > t0 && top < yBot && top + TRACK_H > yTop;
        })
        .map((c) => c.id);
      const ids = expandSelection(hits);
      setUI({ selection: d.additive ? [...new Set([...d.base, ...ids])] : ids });
      return;
    }
    if (d.kind === 'move') {
      const dx = e.clientX - d.x0;
      if (!d.moved && Math.abs(dx) < 3 && Math.abs(e.clientY - d.y0) < 3) return;
      if (!d.moved) beginGesture();
      d.moved = true;
      const base = getBase();
      let delta = dx / s.ui.zoom;
      // スナップ: 動かすクリップの開始・終了点のうち最も近いものを吸着
      let snappedAt: number | null = null;
      if (s.ui.snapping && !e.altKey) {
        const pts = snapPoints({ ...s.project, clips: base }, d.ids, s.ui.playhead);
        let best = snapThreshold();
        for (const c of base) {
          if (!d.ids.has(c.id)) continue;
          for (const edge of [c.start, clipEnd(c)]) {
            const r = snapTime(edge + delta, pts, best);
            if (r.snapped) {
              best = Math.abs(r.time - (edge + delta));
              delta = r.time - edge;
              snappedAt = r.time;
            }
          }
        }
      }
      delta = clampMoveDelta(base, d.ids, delta);
      delta = snapToFrame(delta, s.project.sequence.fps);
      // トラック移動
      const kindTracks = s.project.tracks.filter((t) => t.kind === trackKind(d.dragged));
      const over = trackAtClientY(e.clientY);
      let trackShift = 0;
      if (over && over.kind === trackKind(d.dragged)) trackShift = kindTracks.indexOf(over) - d.origTrackIdx;
      const movedSameKind = base.filter((c) => d.ids.has(c.id) && trackKind(c) === trackKind(d.dragged));
      const canShift = movedSameKind.every((c) => {
        const idx = kindTracks.findIndex((t) => t.id === c.trackId) + trackShift;
        return idx >= 0 && idx < kindTracks.length && !kindTracks[idx].locked;
      });
      if (!canShift) trackShift = 0;
      preview((p) => ({
        ...p,
        clips: base.map((c) => {
          if (!d.ids.has(c.id)) return c;
          let trackId = c.trackId;
          if (trackShift && trackKind(c) === trackKind(d.dragged)) {
            trackId = kindTracks[kindTracks.findIndex((t) => t.id === c.trackId) + trackShift].id;
          }
          return { ...c, start: c.start + delta, trackId };
        }),
      }));
      setSnapLine(snappedAt);
      return;
    }
    if (d.kind === 'trim') {
      const base = getBase();
      const clip = base.find((c) => c.id === d.clipId)!;
      const edgeT = d.edge === 'in' ? clip.start : clipEnd(clip);
      let target = edgeT + (e.clientX - d.x0) / s.ui.zoom;
      let snappedAt: number | null = null;
      if (s.ui.snapping && !e.altKey) {
        const r = snapTime(target, snapPoints({ ...s.project, clips: base }, new Set(d.ids), s.ui.playhead), snapThreshold());
        if (r.snapped) snappedAt = r.time;
        target = r.time;
      }
      target = snapToFrame(target, s.project.sequence.fps);
      const clips = trimClips({ clips: base, media: s.project.media, minDuration: 1 / s.project.sequence.fps }, d.ids, d.edge, target - edgeT, d.linked);
      preview((p) => ({ ...p, clips }));
      setSnapLine(snappedAt);
    }
  };

  const baseRef = useRef<Clip[]>([]);
  const getBase = () => baseRef.current;

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('keydown', onEscape);
    setSnapLine(null);
    setMarquee(null);
    if (!d) return;
    if (d.kind === 'move' && d.moved) endGesture((p) => ({ ...p, clips: commitMove(p.clips, d.ids) }));
    if (d.kind === 'trim') endGesture();
  };

  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    cancelGesture();
    dragRef.current = null;
    onPointerUp();
  };

  const startDrag = (d: Drag) => {
    dragRef.current = d;
    baseRef.current = getState().project.clips;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onEscape);
  };

  const onClipPointerDown = (e: React.PointerEvent, clip: Clip) => {
    if (e.button !== 0 || exporting) return;
    e.stopPropagation();
    const s = getState();
    const track = s.project.tracks.find((t) => t.id === clip.trackId);
    if (s.ui.tool === 'hand') return onBgPointerDown(e);
    if (s.ui.tool === 'razor') {
      if (track?.locked) return;
      let t = timeAtClientX(e.clientX);
      if (s.ui.snapping) t = doSnap(t, new Set()).time;
      splitClipAt(clip.id, t, e.shiftKey);
      return;
    }
    // 選択
    const alt = e.altKey;
    const group = alt || !s.ui.linkedSelection ? [clip.id] : [...linkedGroup(s.project.clips, [clip.id])];
    let sel = s.ui.selection;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      sel = sel.includes(clip.id) ? sel.filter((id) => !group.includes(id)) : [...sel, ...group];
    } else if (!sel.includes(clip.id)) {
      sel = group;
    }
    setUI({ selection: sel, topLeftTab: 'effectControls' });
    if (track?.locked) return;
    // 端ならトリム
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const xIn = e.clientX - rect.left;
    if (xIn < EDGE || rect.right - e.clientX < EDGE) {
      beginGesture();
      startDrag({ kind: 'trim', x0: e.clientX, clipId: clip.id, edge: xIn < EDGE ? 'in' : 'out', ids: [clip.id], linked: !alt && s.ui.linkedSelection });
      return;
    }
    const locked = new Set(s.project.tracks.filter((t) => t.locked).map((t) => t.id));
    const ids = new Set(sel.filter((id) => !locked.has(s.project.clips.find((c) => c.id === id)?.trackId ?? '')));
    const kindTracks = s.project.tracks.filter((t) => t.kind === trackKind(clip));
    startDrag({
      kind: 'move',
      x0: e.clientX,
      y0: e.clientY,
      ids,
      dragged: clip,
      origTrackIdx: kindTracks.findIndex((t) => t.id === clip.trackId),
      moved: false,
    });
  };

  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || getState().ui.tool === 'hand') {
      e.preventDefault();
      const el = scrollRef.current!;
      startDrag({ kind: 'pan', x0: e.clientX, y0: e.clientY, sl: el.scrollLeft, st: el.scrollTop });
      return;
    }
    if (e.button !== 0) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) setUI({ selection: [] });
    startDrag({ kind: 'marquee', x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, additive, base: getState().ui.selection });
  };

  const onRulerPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (engine.isPlaying()) engine.pause();
    startDrag({ kind: 'scrub' });
    setUI({ playhead: snapToFrame(timeAtClientX(e.clientX), fps) });
  };

  // ---------- ドラッグ＆ドロップ（プロジェクトパネル・OS から） ----------
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (!types.includes('application/x-vvv-media') && !types.includes('Files') && !types.includes('application/x-vvv-graphic')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const tr = trackAtClientY(e.clientY);
    let t = snapToFrame(timeAtClientX(e.clientX), fps);
    t = doSnap(t, new Set()).time;
    if (tr) setDropHint({ trackId: tr.id, time: t });
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropHint(null);
    const tr = trackAtClientY(e.clientY);
    const s = getState();
    const trackId = tr?.id ?? s.project.tracks.find((t) => t.kind === 'video')!.id;
    let t = snapToFrame(timeAtClientX(e.clientX), fps);
    t = doSnap(t, new Set()).time;
    const mediaId = e.dataTransfer.getData('application/x-vvv-media');
    const graphic = e.dataTransfer.getData('application/x-vvv-graphic');
    if (mediaId) {
      const marks = e.dataTransfer.getData('application/x-vvv-source') ? s.ui.sourceMarks[mediaId] : undefined;
      await addMediaToTimeline(mediaId, trackId, t, marks?.in, marks?.out);
    } else if (graphic) {
      const vTrack = tr?.kind === 'video' ? tr.id : undefined;
      if (graphic === 'color') addColorMatte(undefined, t, vTrack);
      else addText(graphic, t, vTrack);
    } else if (e.dataTransfer.files.length) {
      const before = new Set(s.project.media.map((m) => m.id));
      await importFiles(e.dataTransfer.files);
      let at = t;
      for (const m of getState().project.media.filter((m) => !before.has(m.id))) {
        await addMediaToTimeline(m.id, trackId, at);
        at += m.type === 'image' ? 5 : m.duration;
      }
    }
  };

  // ---------- コンテキストメニュー ----------
  const onClipContextMenu = (e: React.MouseEvent, clip: Clip) => {
    e.preventDefault();
    e.stopPropagation();
    const s = getState();
    if (!s.ui.selection.includes(clip.id)) setUI({ selection: expandSelection([clip.id]) });
    const multi = getState().ui.selection.length;
    const visual = clip.kind !== 'audio';
    openContextMenu(e.clientX, e.clientY, [
      { label: '再生ヘッドで分割', shortcut: 'Ctrl+K', onClick: splitAtPlayhead },
      { label: 'カット', shortcut: 'Ctrl+X', onClick: cutSelection },
      { label: 'コピー', shortcut: 'Ctrl+C', onClick: copySelection },
      { label: '複製', shortcut: 'Ctrl+D', onClick: duplicateSelection },
      { separator: true },
      { label: '消去', shortcut: 'Delete', onClick: () => deleteSelection(false) },
      { label: 'リップル削除', shortcut: 'Shift+Delete', onClick: () => deleteSelection(true) },
      { separator: true },
      { label: 'クリップを有効にする', checked: !clip.disabled, shortcut: 'Shift+E', onClick: toggleEnabled },
      clip.linkId ? { label: 'リンク解除', onClick: unlinkSelection } : { label: 'リンク', disabled: multi < 2, onClick: linkSelection },
      { separator: true },
      ...(visual
        ? [
            { label: 'クロスディゾルブ（イン）を適用', onClick: () => applyTransition(clip.id, 'in', 'cross-dissolve') },
            { label: 'フェードアウト（アウト）を適用', onClick: () => applyTransition(clip.id, 'out', 'cross-dissolve') },
            { label: 'トランジションを削除', disabled: !clip.transitionIn && !clip.transitionOut, onClick: () => removeTransitions(clip.id) },
          ]
        : [
            { label: 'オーディオ フェードイン (1秒)', onClick: () => applyAudioFade(clip.id, 'in') },
            { label: 'オーディオ フェードアウト (1秒)', onClick: () => applyAudioFade(clip.id, 'out') },
          ]),
    ]);
  };

  const onLaneContextMenu = (e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    const t = timeAtClientX(e.clientX);
    openContextMenu(e.clientX, e.clientY, [
      { label: 'ペースト', shortcut: 'Ctrl+V', onClick: () => { setUI({ playhead: snapToFrame(t, fps) }); paste(); } },
      { label: 'ギャップをリップル削除', onClick: () => rippleDeleteGap(track.id, t) },
      { separator: true },
      ...(track.kind === 'video'
        ? [
            { label: 'テキストを追加', onClick: () => addText('title', t, track.id) },
            { label: 'カラーマットを追加', onClick: () => addColorMatte(undefined, t, track.id) },
          ]
        : []),
      { label: 'マーカーを追加', onClick: () => { setUI({ playhead: snapToFrame(t, fps) }); addMarker(); } },
    ]);
  };

  // 再生中は再生ヘッドを追従スクロール
  const playhead = useStore((s) => s.ui.playhead);
  const playing = useStore((s) => s.ui.playing);
  useEffect(() => {
    if (!playing) return;
    const el = scrollRef.current;
    if (!el) return;
    const x = playhead * zoom;
    const visibleW = el.clientWidth - HEADER_W;
    if (x > el.scrollLeft + visibleW - 30 || x < el.scrollLeft) el.scrollLeft = x - 40;
  }, [playhead, playing, zoom]);

  const cursor = tool === 'razor' ? 'cursor-razor' : tool === 'hand' ? 'cursor-hand' : '';

  return (
    <div className={`timeline ${exporting ? 'is-locked' : ''}`}>
      <TimelineToolbar snapping={snapping} linked={linked} />
      <div
        className={`tl-scroll ${cursor}`}
        ref={scrollRef}
        onDragOver={onDragOver}
        onDragLeave={() => setDropHint(null)}
        onDrop={onDrop}
      >
        <div className="tl-content" style={{ width: HEADER_W + contentW, height: totalH }}>
          {/* ルーラー */}
          <div className="tl-corner" style={{ width: HEADER_W, height: RULER_H }}>
            <button className="icon-btn small" title="映像トラックを追加" onClick={() => addTrack('video')}>V+</button>
            <button className="icon-btn small" title="音声トラックを追加" onClick={() => addTrack('audio')}>A+</button>
          </div>
          <Ruler zoom={zoom} width={contentW} fps={fps} onPointerDown={onRulerPointerDown} viewLeft={view.left} viewWidth={view.width}>
            {project.markers.map((m) => (
              <div
                key={m.id}
                className="tl-marker-head"
                style={{ left: m.time * zoom, background: m.color }}
                title="クリックで移動 / ダブルクリックで削除"
                onDoubleClick={() => removeMarker(m.id)}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  engine.seek(m.time);
                }}
              />
            ))}
            <PlayheadHead zoom={zoom} />
          </Ruler>
          {/* トラック */}
          {project.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              top={tracksTop.get(track.id)!}
              width={contentW}
              zoom={zoom}
              clips={project.clips}
              media={mediaMap}
              selSet={selSet}
              viewLeft={view.left}
              viewWidth={view.width}
              onClipPointerDown={onClipPointerDown}
              onClipContextMenu={onClipContextMenu}
              onBgPointerDown={onBgPointerDown}
              onLaneContextMenu={onLaneContextMenu}
              dropHint={dropHint?.trackId === track.id ? dropHint.time : null}
            />
          ))}
          {/* マーカー */}
          {project.markers.map((m) => (
            <div key={m.id} className="tl-marker" style={{ left: HEADER_W + m.time * zoom, height: totalH }} />
          ))}
          <Playhead zoom={zoom} height={totalH} />
          {snapLine !== null && <div className="tl-snapline" style={{ left: HEADER_W + snapLine * zoom, height: totalH }} />}
          {marquee && <div className="tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>
      </div>
    </div>
  );
}

function removeTransitions(clipId: string) {
  updateClip(clipId, { transitionIn: undefined, transitionOut: undefined });
}

const trackKind = (c: Clip) => (c.kind === 'audio' ? 'audio' : 'video');

function TimelineToolbar({ snapping, linked }: { snapping: boolean; linked: boolean }) {
  const playhead = useStore((s) => s.ui.playhead);
  const fps = useStore((s) => s.project.sequence.fps);
  const zoom = useStore((s) => s.ui.zoom);
  const name = useStore((s) => s.project.name);
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="tl-toolbar">
      <span className="panel-title">タイムライン: {name}</span>
      {editing === null ? (
        <span className="timecode tc-big" title="クリックして時間を入力" onClick={() => setEditing(timecode(playhead, fps))}>
          {timecode(playhead, fps)}
        </span>
      ) : (
        <input
          className="timecode tc-big tc-input"
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => setEditing(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const t = parseTimecode(editing, fps);
              if (t !== null) engine.seek(t);
              setEditing(null);
            }
            if (e.key === 'Escape') setEditing(null);
            e.stopPropagation();
          }}
        />
      )}
      <div className="tl-tools">
        <button className={`icon-btn ${snapping ? 'active' : ''}`} title="スナップ (S)" onClick={() => setUI({ snapping: !snapping })}>
          {Icon.magnet()}
        </button>
        <button className={`icon-btn ${linked ? 'active' : ''}`} title="リンクされた選択" onClick={() => setUI({ linkedSelection: !linked })}>
          {Icon.link()}
        </button>
        <button className="icon-btn" title="マーカーを追加 (M)" onClick={addMarker}>
          {Icon.marker()}
        </button>
      </div>
      <div className="tl-zoom">
        <span className="muted">－</span>
        <input
          type="range"
          min={Math.log(MIN_ZOOM)}
          max={Math.log(MAX_ZOOM)}
          step={0.01}
          value={Math.log(zoom)}
          onChange={(e) => setZoom(Math.exp(parseFloat(e.target.value)))}
          title="ズーム (+ / -、\\ で全体表示)"
        />
        <span className="muted">＋</span>
      </div>
    </div>
  );
}

function Ruler({
  zoom,
  width,
  fps,
  onPointerDown,
  viewLeft,
  viewWidth,
  children,
}: {
  zoom: number;
  width: number;
  fps: number;
  onPointerDown: (e: React.PointerEvent) => void;
  viewLeft: number;
  viewWidth: number;
  children?: React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const left = Math.max(0, viewLeft - 200);
  const w = Math.min(width - left, viewWidth + 600);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || w <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.ceil(w * dpr);
    c.height = RULER_H * dpr;
    const ctx = c.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, RULER_H);
    // 目盛り間隔を決定
    const steps = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    const major = steps.find((s) => s * zoom >= 80) ?? 3600;
    const minorCandidates = steps.filter((s) => s < major && major % s < 1e-6 * major + 1e-9);
    const minor = [...minorCandidates].reverse().find((s) => s * zoom >= 8) ?? major;
    ctx.strokeStyle = '#5b5b5b';
    ctx.fillStyle = '#a8a8a8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.beginPath();
    const t0 = left / zoom;
    const t1 = (left + w) / zoom;
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = Math.round(t * zoom - left) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, isMajor ? RULER_H - 12 : RULER_H - 5);
      if (isMajor) ctx.fillText(timecode(t, fps), x + 3, 11);
    }
    ctx.stroke();
  }, [zoom, left, w, fps]);
  return (
    <div className="tl-ruler" style={{ left: HEADER_W, width, height: RULER_H }} onPointerDown={onPointerDown}>
      <canvas ref={canvasRef} style={{ position: 'absolute', left, width: w, height: RULER_H }} />
      {children}
    </div>
  );
}

function Playhead({ zoom, height }: { zoom: number; height: number }) {
  const t = useStore((s) => s.ui.playhead);
  return <div className="tl-playhead" style={{ transform: `translateX(${HEADER_W + t * zoom}px)`, height }} />;
}

function PlayheadHead({ zoom }: { zoom: number }) {
  const t = useStore((s) => s.ui.playhead);
  return <div className="tl-playhead-head" style={{ transform: `translateX(${t * zoom}px)` }} />;
}

interface TrackRowProps {
  track: Track;
  top: number;
  width: number;
  zoom: number;
  clips: Clip[];
  media: Map<string, MediaItem>;
  selSet: Set<string>;
  viewLeft: number;
  viewWidth: number;
  dropHint: number | null;
  onClipPointerDown: (e: React.PointerEvent, c: Clip) => void;
  onClipContextMenu: (e: React.MouseEvent, c: Clip) => void;
  onBgPointerDown: (e: React.PointerEvent) => void;
  onLaneContextMenu: (e: React.MouseEvent, t: Track) => void;
}

function TrackRow(p: TrackRowProps) {
  const { track } = p;
  const clips = p.clips.filter((c) => c.trackId === track.id);
  return (
    <>
      <div
        className={`tl-track-header ${track.kind}`}
        style={{ top: p.top, height: TRACK_H }}
        onContextMenu={(e) => {
          e.preventDefault();
          openContextMenu(e.clientX, e.clientY, [{ label: `${track.name} を削除`, onClick: () => removeTrack(track.id) }]);
        }}
      >
        <span className="track-name">{track.name}</span>
        <div className="track-btns">
          {track.kind === 'video' ? (
            <button className={`icon-btn small ${track.hidden ? 'warn' : ''}`} title="トラック出力の切り替え" onClick={() => toggleTrack(track.id, 'hidden')}>
              {track.hidden ? Icon.eyeOff(13) : Icon.eye(13)}
            </button>
          ) : (
            <button className={`icon-btn small ${track.muted ? 'warn' : ''}`} title="トラックをミュート" onClick={() => toggleTrack(track.id, 'muted')}>
              {track.muted ? Icon.mute(13) : Icon.speaker(13)}
            </button>
          )}
          <button className={`icon-btn small ${track.locked ? 'warn' : ''}`} title="トラックをロック" onClick={() => toggleTrack(track.id, 'locked')}>
            {track.locked ? Icon.lock(13) : Icon.unlock(13)}
          </button>
        </div>
      </div>
      <div
        className={`tl-lane ${track.kind} ${track.locked ? 'locked' : ''} ${track.hidden || track.muted ? 'dim' : ''}`}
        style={{ top: p.top, left: HEADER_W, width: p.width, height: TRACK_H }}
        onPointerDown={p.onBgPointerDown}
        onContextMenu={(e) => p.onLaneContextMenu(e, track)}
      >
        {clips.map((c) => (
          <ClipView
            key={c.id}
            clip={c}
            zoom={p.zoom}
            media={c.mediaId ? p.media.get(c.mediaId) : undefined}
            selected={p.selSet.has(c.id)}
            viewLeft={p.viewLeft}
            viewWidth={p.viewWidth}
            onPointerDown={p.onClipPointerDown}
            onContextMenu={p.onClipContextMenu}
          />
        ))}
        {p.dropHint !== null && <div className="tl-drop-hint" style={{ left: p.dropHint * p.zoom }} />}
      </div>
    </>
  );
}

interface ClipViewProps {
  clip: Clip;
  zoom: number;
  media?: MediaItem;
  selected: boolean;
  viewLeft: number;
  viewWidth: number;
  onPointerDown: (e: React.PointerEvent, c: Clip) => void;
  onContextMenu: (e: React.MouseEvent, c: Clip) => void;
}

const ClipView = memo(function ClipView({ clip, zoom, media, selected, viewLeft, viewWidth, onPointerDown, onContextMenu }: ClipViewProps) {
  const left = clip.start * zoom;
  const width = Math.max(2, clip.duration * zoom);
  // 表示範囲（クリップ内のローカル px）
  const visL = Math.max(0, viewLeft - 300 - left);
  const visR = Math.min(width, viewLeft + viewWidth + 300 - left);
  const [dragOver, setDragOver] = useState<'in' | 'out' | null>(null);

  const hasFx =
    Object.keys(clip.keyframes).length > 0 ||
    ['brightness', 'contrast', 'saturation'].some((k) => clip.props[k] !== undefined && clip.props[k] !== 100) ||
    ['hue', 'grayscale', 'sepia', 'invert', 'blur'].some((k) => (clip.props[k] ?? 0) !== 0);

  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-vvv-effect')) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDragOver(e.clientX - rect.left < rect.width / 2 ? 'in' : 'out');
  };
  const onDrop = (e: React.DragEvent) => {
    const data = e.dataTransfer.getData('application/x-vvv-effect');
    setDragOver(null);
    if (!data) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side = e.clientX - rect.left < rect.width / 2 ? 'in' : 'out';
    const [kind, id] = data.split(':');
    if (kind === 'transition' && clip.kind !== 'audio') applyTransition(clip.id, side, id as TransitionType);
    else if (kind === 'audiofade' && clip.kind === 'audio') applyAudioFade(clip.id, side);
    else if (kind === 'preset' && clip.kind !== 'audio') applyPreset(clip.id, id);
    setUI({ selection: [clip.id] });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tool = getState().ui.tool;
    el.style.cursor = tool !== 'select' ? '' : x < EDGE ? 'w-resize' : rect.right - e.clientX < EDGE ? 'e-resize' : '';
  };

  return (
    <div
      className={`clip clip-${clip.kind} ${selected ? 'selected' : ''} ${clip.disabled ? 'disabled' : ''} ${dragOver ? 'drag-' + dragOver : ''}`}
      style={{ left, width }}
      onPointerDown={(e) => onPointerDown(e, clip)}
      onContextMenu={(e) => onContextMenu(e, clip)}
      onMouseMove={onMouseMove}
      onDragOver={onDragOver}
      onDragLeave={() => setDragOver(null)}
      onDrop={onDrop}
      title={clip.name}
    >
      {(clip.kind === 'video' || clip.kind === 'image') && media && (
        <Filmstrip clip={clip} zoom={zoom} media={media} visL={visL} visR={visR} />
      )}
      {clip.kind === 'audio' && media && <Waveform clip={clip} zoom={zoom} visL={visL} visR={visR} />}
      {clip.kind === 'color' && <div className="clip-color-swatch" style={{ background: clip.color }} />}
      <div className="clip-label">
        {clip.linkId && <span className="clip-badge">⛓</span>}
        {hasFx && <span className="clip-badge fx">fx</span>}
        {clip.speed !== 1 && <span className="clip-badge">{Math.round(clip.speed * 100)}%</span>}
        <span className="clip-name">{clip.kind === 'text' ? `T  ${clip.text?.content.split('\n')[0] ?? ''}` : clip.name}</span>
      </div>
      {clip.transitionIn && (
        <div className="clip-transition in" style={{ width: clip.transitionIn.duration * zoom }} title={TRANSITION_NAMES[clip.transitionIn.type]} />
      )}
      {clip.transitionOut && (
        <div className="clip-transition out" style={{ width: clip.transitionOut.duration * zoom }} title={TRANSITION_NAMES[clip.transitionOut.type]} />
      )}
      {clip.kind === 'audio' && (clip.props.fadeIn ?? 0) > 0 && <div className="clip-fade in" style={{ width: clip.props.fadeIn * zoom }} />}
      {clip.kind === 'audio' && (clip.props.fadeOut ?? 0) > 0 && <div className="clip-fade out" style={{ width: clip.props.fadeOut * zoom }} />}
    </div>
  );
});

function Filmstrip({ clip, zoom, media, visL, visR }: { clip: Clip; zoom: number; media: MediaItem; visL: number; visR: number }) {
  const a = getAnalysis(media.id);
  if (!a || a.thumbnails.length === 0) return null;
  const tileW = Math.max(40, Math.round((44 * (media.width || 16)) / (media.height || 9)));
  const tiles: { x: number; url: string }[] = [];
  const first = Math.floor(visL / tileW);
  const last = Math.ceil(visR / tileW);
  for (let i = first; i < last && tiles.length < 200; i++) {
    const x = i * tileW;
    const srcT = clip.kind === 'image' ? 0 : clip.offset + (x / zoom) * clip.speed;
    const url = thumbnailAt(a, srcT);
    if (url) tiles.push({ x, url });
  }
  return (
    <div className="clip-filmstrip">
      {tiles.map((t) => (
        <img key={t.x} src={t.url} style={{ left: t.x, width: tileW }} draggable={false} alt="" />
      ))}
    </div>
  );
}

function Waveform({ clip, zoom, visL, visR }: { clip: Clip; zoom: number; visL: number; visR: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const peaks = getAnalysis(clip.mediaId)?.peaks;
  const w = Math.max(0, Math.floor(visR - visL));
  const vol = (clip.props.volume ?? 100) / 100;
  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks || w <= 0) return;
    const h = TRACK_H - 2;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(160, 255, 190, 0.75)';
    const mid = h / 2 + 6;
    const amp = h / 2 - 8;
    for (let x = 0; x < w; x++) {
      const t0 = clip.offset + ((visL + x) / zoom) * clip.speed;
      const t1 = clip.offset + ((visL + x + 1) / zoom) * clip.speed;
      const i0 = Math.floor(t0 * PEAKS_PER_SEC);
      const i1 = Math.max(i0 + 1, Math.floor(t1 * PEAKS_PER_SEC));
      let m = 0;
      for (let i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i];
      const y = Math.min(amp, m * amp * vol);
      ctx.fillRect(x, mid - y, 1, Math.max(1, y * 2));
    }
  }, [peaks, w, visL, zoom, clip.offset, clip.speed, vol]);
  if (!peaks) return null;
  return <canvas ref={ref} className="clip-wave" style={{ left: visL, width: w }} />;
}
