import type { Clip, ClipKind, Project, Track, TrackKind, TransitionType } from './core/types';
import {
  clipEnd,
  clipsAt,
  clipsForMedia,
  createEmptyProject,
  defaultTextStyle,
  editPoints,
  EPS,
  gapAt,
  insertSpace,
  linkedGroup,
  makeClip,
  placeClips,
  rippleDelete,
  rippleShift,
  sequenceDuration,
  setSpeed,
  splitClips,
  tracksByNumber,
  trimHead,
  uid,
} from './core/timeline';
import { analyzeMedia, importFile, releaseMedia } from './core/media';
import { PROP_BY_KEY, getProp, keyframeAt, upsertKeyframe } from './core/props';
import { commit, getState, patchMedia, preview, replaceProject, setUI, toast } from './store';
import { engine } from './core/engine';
import { clearSaved, loadProject, saveProject } from './core/persist';
import { snapToFrame, timecode } from './core/time';
import { downloadBlob } from './download';

const S = () => getState();
const fps = () => S().project.sequence.fps;

// ---------------- メディア ----------------
export async function importFiles(files: File[] | FileList) {
  const list = [...files];
  let firstVisual: { width: number; height: number } | null = null;
  const wasEmpty = S().project.media.length === 0 && S().project.clips.length === 0;
  for (const f of list) {
    try {
      const item = await importFile(f, f.name);
      commit((p) => ({ ...p, media: [...p.media, item] }));
      if (!firstVisual && item.type === 'video' && item.width) firstVisual = item;
      analyzeMedia(item).then(({ hasAudio }) => {
        if (hasAudio !== item.hasAudio) patchMedia(item.id, { hasAudio });
      });
    } catch (e) {
      toast((e as Error).message);
    }
  }
  // 最初の素材に合わせてシーケンス設定を自動調整（Premiere の「クリップに合わせる」）
  if (wasEmpty && firstVisual) {
    const fv = firstVisual;
    commit((p) => ({ ...p, sequence: { ...p.sequence, width: even(fv.width), height: even(fv.height) } }));
  }
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** 解析完了を待ってから配置したいときのため、hasAudio が確定するまで待つ */
async function waitForAnalysis(mediaId: string) {
  const m = S().project.media.find((x) => x.id === mediaId);
  if (!m || m.type !== 'video') return;
  for (let i = 0; i < 40; i++) {
    const cur = S().project.media.find((x) => x.id === mediaId);
    if (!cur || cur.hasAudio) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function addMediaToTimeline(mediaId: string, trackId: string, start: number, inPoint?: number, outPoint?: number) {
  await waitForAnalysis(mediaId);
  const { project } = S();
  const media = project.media.find((m) => m.id === mediaId);
  if (!media) return;
  const track = project.tracks.find((t) => t.id === trackId);
  if (track?.locked) return toast('トラックがロックされています');
  const clips = clipsForMedia(project.tracks, media, trackId, snapToFrame(start, fps()), inPoint, outPoint);
  if (clips.length === 0) return;
  commit((p) => ({ ...p, clips: placeClips(p.clips, clips) }));
  setUI({ selection: clips.map((c) => c.id) });
}

export function appendToTimeline(mediaId: string) {
  const { project } = S();
  const v1 = tracksByNumber(project.tracks, 'video')[0];
  const a1 = tracksByNumber(project.tracks, 'audio')[0];
  const media = project.media.find((m) => m.id === mediaId);
  if (!media) return;
  const target = media.type === 'audio' ? a1 : v1;
  if (!target) return;
  const end = Math.max(0, ...project.clips.filter((c) => c.trackId === target.id).map(clipEnd));
  return addMediaToTimeline(mediaId, target.id, end);
}

/** ソースモニターからの挿入／上書き編集 */
export async function sourceEdit(mode: 'insert' | 'overwrite') {
  const { ui, project } = S();
  const id = ui.sourceMediaId;
  const media = project.media.find((m) => m.id === id);
  if (!media) return toast('ソースモニターに素材がありません');
  await waitForAnalysis(media.id);
  const marks = ui.sourceMarks[media.id] ?? {};
  const inP = marks.in ?? 0;
  const outP = media.type === 'image' ? undefined : (marks.out ?? media.duration);
  const v1 = tracksByNumber(project.tracks, 'video')[0];
  const at = ui.playhead;
  const clips = clipsForMedia(project.tracks, S().project.media.find((m) => m.id === media.id)!, media.type === 'audio' ? tracksByNumber(project.tracks, 'audio')[0].id : v1.id, at, media.type === 'image' ? 0 : inP, outP);
  if (!clips.length) return;
  const len = clips[0].duration;
  commit((p) => {
    const base = mode === 'insert' ? insertSpace(p.clips, at, len) : p.clips;
    return { ...p, clips: placeClips(base, clips) };
  });
  setUI({ selection: clips.map((c) => c.id), playhead: at + len });
}

export function removeMedia(mediaId: string) {
  const m = S().project.media.find((x) => x.id === mediaId);
  if (!m) return;
  const used = S().project.clips.some((c) => c.mediaId === mediaId);
  if (used && !confirm(`「${m.name}」はタイムラインで使用中です。クリップごと削除しますか？`)) return;
  commit((p) => ({
    ...p,
    media: p.media.filter((x) => x.id !== mediaId),
    clips: p.clips.filter((c) => c.mediaId !== mediaId),
  }));
  if (S().ui.sourceMediaId === mediaId) setUI({ sourceMediaId: undefined });
}

// ---------------- 選択・編集 ----------------
export function selectedClips(): Clip[] {
  const sel = new Set(S().ui.selection);
  return S().project.clips.filter((c) => sel.has(c.id));
}

export function expandSelection(ids: string[]): string[] {
  if (!S().ui.linkedSelection) return ids;
  return [...linkedGroup(S().project.clips, ids)];
}

function lockedTrackIds(p: Project) {
  return new Set(p.tracks.filter((t) => t.locked).map((t) => t.id));
}

export function deleteSelection(ripple = false) {
  const ids = S().ui.selection;
  if (ids.length === 0) {
    if (ripple) return rippleDeleteGapAtPlayhead();
    return;
  }
  const locked = lockedTrackIds(S().project);
  const targets = S().project.clips.filter((c) => ids.includes(c.id) && !locked.has(c.trackId)).map((c) => c.id);
  commit((p) => {
    if (ripple) return { ...p, clips: rippleDelete(p.clips, targets) };
    const set = new Set(targets);
    return { ...p, clips: p.clips.filter((c) => !set.has(c.id)) };
  });
  setUI({ selection: [] });
}

function rippleDeleteGapAtPlayhead() {
  const { project, ui } = S();
  for (const tr of project.tracks) {
    const gap = gapAt(project.clips, tr.id, ui.playhead);
    if (gap) {
      commit((p) => ({ ...p, clips: rippleShift(p.clips, gap.end, gap.end - gap.start).clips }));
      return;
    }
  }
}

export function rippleDeleteGap(trackId: string, t: number) {
  const gap = gapAt(S().project.clips, trackId, t);
  if (!gap) return;
  let shifted = 0;
  commit((p) => {
    const r = rippleShift(p.clips, gap.end, gap.end - gap.start);
    shifted = r.shifted;
    return { ...p, clips: r.clips };
  });
  if (shifted < gap.end - gap.start - EPS) toast('他のトラックのクリップと重なるため、一部のみ詰めました');
}

/** 再生ヘッドで分割（選択クリップがあればそれのみ、なければ全トラック） */
export function splitAtPlayhead() {
  const { project, ui } = S();
  const t = ui.playhead;
  const locked = lockedTrackIds(project);
  let ids = ui.selection.filter((id) => {
    const c = project.clips.find((x) => x.id === id);
    return c && c.start < t - EPS && clipEnd(c) > t + EPS;
  });
  if (ids.length === 0) ids = clipsAt(project, t).map((c) => c.id);
  ids = ids.filter((id) => !locked.has(project.clips.find((c) => c.id === id)!.trackId));
  if (!ids.length) return;
  commit((p) => ({ ...p, clips: splitClips(p.clips, ids, t) }));
}

export function splitClipAt(clipId: string, t: number, allTracks = false) {
  const { project } = S();
  const locked = lockedTrackIds(project);
  const ids = allTracks ? clipsAt(project, t).map((c) => c.id) : [clipId];
  const ok = ids.filter((id) => !locked.has(project.clips.find((c) => c.id === id)!.trackId));
  commit((p) => ({ ...p, clips: splitClips(p.clips, ok, snapToFrame(t, fps())) }));
}

/** Q / W: 再生ヘッドまでリップルトリム */
export function rippleTrimToPlayhead(side: 'prev' | 'next') {
  const { project, ui } = S();
  const t = ui.playhead;
  const cands = clipsAt(project, t).filter((c) => !lockedTrackIds(project).has(c.trackId));
  if (!cands.length) return;
  commit((p) => {
    let clips = p.clips;
    if (side === 'prev') {
      // 各クリップの先頭〜再生ヘッドを削除し詰める
      const start = Math.min(...cands.map((c) => c.start));
      const ids = new Set(linkedGroup(clips, cands.map((c) => c.id)));
      clips = clips.map((c) => (ids.has(c.id) && c.start < t - EPS && clipEnd(c) > t + EPS ? trimHead(c, t - c.start) : c));
      clips = rippleShift(clips, t, t - start).clips;
      setUI({ playhead: start });
    } else {
      const end = Math.max(...cands.map((c) => clipEnd(c)));
      const ids = new Set(linkedGroup(clips, cands.map((c) => c.id)));
      clips = clips.map((c) => (ids.has(c.id) && c.start < t - EPS && clipEnd(c) > t + EPS ? { ...c, duration: t - c.start, transitionOut: undefined } : c));
      clips = rippleShift(clips, end, end - t).clips;
    }
    return { ...p, clips };
  });
}

let clipboard: Clip[] = [];
export function copySelection() {
  clipboard = expandSelection(S().ui.selection)
    .map((id) => S().project.clips.find((c) => c.id === id)!)
    .filter(Boolean);
  if (clipboard.length) toast(`${clipboard.length} 個のクリップをコピーしました`);
}
export function cutSelection() {
  copySelection();
  deleteSelection(false);
}
export function paste() {
  if (!clipboard.length) return;
  const t = S().ui.playhead;
  const min = Math.min(...clipboard.map((c) => c.start));
  const linkMap = new Map<string, string>();
  const added = clipboard.map((c) => {
    let linkId: string | undefined;
    if (c.linkId) {
      linkId = linkMap.get(c.linkId) ?? uid('link');
      linkMap.set(c.linkId, linkId);
    }
    return { ...c, id: uid('clip'), linkId, start: c.start - min + t };
  });
  commit((p) => ({ ...p, clips: placeClips(p.clips, added) }));
  setUI({ selection: added.map((c) => c.id), playhead: t + Math.max(...added.map((c) => clipEnd(c) - t)) });
}
export function duplicateSelection() {
  const sel = expandSelection(S().ui.selection).map((id) => S().project.clips.find((c) => c.id === id)!);
  if (!sel.length) return;
  const end = Math.max(...sel.map(clipEnd));
  const min = Math.min(...sel.map((c) => c.start));
  const linkMap = new Map<string, string>();
  const added = sel.map((c) => {
    let linkId: string | undefined;
    if (c.linkId) {
      linkId = linkMap.get(c.linkId) ?? uid('link');
      linkMap.set(c.linkId, linkId);
    }
    return { ...c, id: uid('clip'), linkId, start: c.start - min + end };
  });
  commit((p) => ({ ...p, clips: placeClips(p.clips, added) }));
  setUI({ selection: added.map((c) => c.id) });
}

export function selectAll() {
  setUI({ selection: S().project.clips.map((c) => c.id) });
}

export function toggleEnabled() {
  const ids = new Set(expandSelection(S().ui.selection));
  if (!ids.size) return;
  commit((p) => ({ ...p, clips: p.clips.map((c) => (ids.has(c.id) ? { ...c, disabled: !c.disabled } : c)) }));
}

export function unlinkSelection() {
  const ids = new Set(expandSelection(S().ui.selection));
  commit((p) => ({ ...p, clips: p.clips.map((c) => (ids.has(c.id) ? { ...c, linkId: undefined } : c)) }));
}

export function linkSelection() {
  const ids = new Set(S().ui.selection);
  if (ids.size < 2) return;
  const linkId = uid('link');
  commit((p) => ({ ...p, clips: p.clips.map((c) => (ids.has(c.id) ? { ...c, linkId } : c)) }));
}

export function updateClip(clipId: string, patch: Partial<Clip> | ((c: Clip) => Clip)) {
  commit((p) => ({
    ...p,
    clips: p.clips.map((c) => (c.id === clipId ? (typeof patch === 'function' ? patch(c) : { ...c, ...patch }) : c)),
  }));
}

export function setClipSpeed(clipId: string, speed: number) {
  const ids = expandSelection([clipId]);
  commit((p) => {
    let clips = p.clips.map((c) => (ids.includes(c.id) ? setSpeed(c, speed, p.media) : c));
    // 長くなった場合は後続と重ならないよう上書き
    const changed = clips.filter((c) => ids.includes(c.id));
    clips = placeClips(
      clips.filter((c) => !ids.includes(c.id)),
      changed,
    );
    return { ...p, clips };
  });
}

/** プロパティ値の変更。キーフレームが有効なら再生ヘッド位置にキーフレームを打つ */
export function setClipProp(clipId: string, key: string, value: number, opts: { history?: boolean } = {}) {
  const fn = (p: Project): Project => ({
    ...p,
    clips: p.clips.map((c) => {
      if (c.id !== clipId) return c;
      const kfs = c.keyframes[key];
      if (kfs && kfs.length) {
        const local = clampLocal(c, S().ui.playhead - c.start);
        return { ...c, keyframes: { ...c.keyframes, [key]: upsertKeyframe(kfs, local, value, 0.5 / p.sequence.fps) } };
      }
      return { ...c, props: { ...c.props, [key]: value } };
    }),
  });
  if (opts.history === false) preview(fn);
  else commit(fn);
}

const clampLocal = (c: Clip, t: number) => Math.min(Math.max(0, t), c.duration);

/** ストップウォッチ（アニメーション）の切り替え */
export function toggleAnimation(clipId: string, key: string) {
  updateClip(clipId, (c) => {
    const kfs = c.keyframes[key];
    if (kfs && kfs.length) {
      const local = clampLocal(c, S().ui.playhead - c.start);
      const v = getProp(c, key, local);
      const { [key]: _removed, ...rest } = c.keyframes;
      return { ...c, keyframes: rest, props: { ...c.props, [key]: v } };
    }
    const local = clampLocal(c, S().ui.playhead - c.start);
    return { ...c, keyframes: { ...c.keyframes, [key]: [{ t: local, v: c.props[key] ?? PROP_BY_KEY[key].default }] } };
  });
}

export function toggleKeyframeAtPlayhead(clipId: string, key: string) {
  updateClip(clipId, (c) => {
    const local = clampLocal(c, S().ui.playhead - c.start);
    const kfs = c.keyframes[key] ?? [];
    const tol = 0.5 / fps();
    const existing = keyframeAt(kfs, local, tol);
    if (existing) {
      const next = kfs.filter((k) => k !== existing);
      if (next.length === 0) {
        const { [key]: _r, ...rest } = c.keyframes;
        return { ...c, keyframes: rest, props: { ...c.props, [key]: existing.v } };
      }
      return { ...c, keyframes: { ...c.keyframes, [key]: next } };
    }
    return { ...c, keyframes: { ...c.keyframes, [key]: upsertKeyframe(kfs, local, getProp(c, key, local), tol) } };
  });
}

export function resetProps(clipId: string, keys: string[]) {
  updateClip(clipId, (c) => {
    const props = { ...c.props };
    const keyframes = { ...c.keyframes };
    for (const k of keys) {
      props[k] = PROP_BY_KEY[k].default;
      delete keyframes[k];
    }
    return { ...c, props, keyframes };
  });
}

export function applyTransition(clipId: string, side: 'in' | 'out', type: TransitionType, duration = 1) {
  updateClip(clipId, (c) => {
    const d = Math.min(duration, c.duration);
    return side === 'in' ? { ...c, transitionIn: { type, duration: d } } : { ...c, transitionOut: { type, duration: d } };
  });
}

export function applyAudioFade(clipId: string, side: 'in' | 'out', duration = 1) {
  updateClip(clipId, (c) => ({ ...c, props: { ...c.props, [side === 'in' ? 'fadeIn' : 'fadeOut']: Math.min(duration, c.duration) } }));
}

export interface Preset {
  id: string;
  name: string;
  apply: (c: Clip) => Clip;
}

export const PRESETS: Preset[] = [
  { id: 'bw', name: 'モノクロ', apply: (c) => ({ ...c, props: { ...c.props, grayscale: 100, contrast: 110 } }) },
  { id: 'sepia', name: 'セピア', apply: (c) => ({ ...c, props: { ...c.props, sepia: 80, saturation: 90 } }) },
  { id: 'vivid', name: 'ビビッド', apply: (c) => ({ ...c, props: { ...c.props, saturation: 150, contrast: 115 } }) },
  { id: 'cinema', name: 'シネマ調', apply: (c) => ({ ...c, props: { ...c.props, saturation: 80, contrast: 120, brightness: 95, hue: -8 } }) },
  { id: 'warm', name: 'ウォーム', apply: (c) => ({ ...c, props: { ...c.props, sepia: 25, saturation: 120, brightness: 105 } }) },
  { id: 'cool', name: 'クール', apply: (c) => ({ ...c, props: { ...c.props, hue: 15, saturation: 85, brightness: 102 } }) },
  { id: 'dream', name: 'ドリーム（ブラー）', apply: (c) => ({ ...c, props: { ...c.props, blur: 3, brightness: 115 } }) },
  {
    id: 'kenburns-in',
    name: 'ケン・バーンズ（ズームイン）',
    apply: (c) => ({ ...c, keyframes: { ...c.keyframes, scale: [{ t: 0, v: 100 }, { t: c.duration, v: 125 }] } }),
  },
  {
    id: 'kenburns-out',
    name: 'ケン・バーンズ（ズームアウト）',
    apply: (c) => ({ ...c, keyframes: { ...c.keyframes, scale: [{ t: 0, v: 125 }, { t: c.duration, v: 100 }] } }),
  },
  {
    id: 'pan-lr',
    name: 'パン（左→右）',
    apply: (c) => ({
      ...c,
      keyframes: {
        ...c.keyframes,
        scale: [{ t: 0, v: 120 }],
        x: [{ t: 0, v: -150 }, { t: c.duration, v: 150 }],
      },
    }),
  },
  { id: 'reset', name: 'エフェクトをリセット', apply: (c) => ({ ...c, props: { ...c.props, brightness: 100, contrast: 100, saturation: 100, hue: 0, grayscale: 0, sepia: 0, invert: 0, blur: 0 } }) },
];

export function applyPreset(clipId: string, presetId: string) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return;
  updateClip(clipId, (c) => (c.kind === 'audio' ? c : preset.apply(c)));
}

// ---------------- グラフィック ----------------
export interface TextTemplate {
  id: string;
  name: string;
  make: () => Partial<Clip>;
}

export const TEXT_TEMPLATES: TextTemplate[] = [
  { id: 'title', name: 'タイトル', make: () => ({ text: defaultTextStyle('タイトル'), props: { ...baseVisualProps(), y: 0 } }) },
  {
    id: 'subtitle',
    name: '字幕',
    make: () => ({
      text: { ...defaultTextStyle('字幕テキスト'), fontSize: 56, bold: false, strokeWidth: 4, shadow: false },
      props: { ...baseVisualProps(), y: 0 },
    }),
  },
  {
    id: 'lower-third',
    name: 'ロワーサード',
    make: () => ({
      text: { ...defaultTextStyle('名前 / 肩書き'), fontSize: 48, align: 'left', bgOpacity: 70, bgColor: '#1a3a8a', shadow: false },
      props: { ...baseVisualProps() },
    }),
  },
  {
    id: 'big',
    name: 'インパクト',
    make: () => ({
      text: { ...defaultTextStyle('WOW!'), fontSize: 220, color: '#ffd400', strokeColor: '#000000', strokeWidth: 10, italic: true },
      props: baseVisualProps(),
      keyframes: { scale: [{ t: 0, v: 40 }, { t: 0.4, v: 110 }, { t: 0.6, v: 100 }] },
    }),
  },
];

function baseVisualProps() {
  const p: Record<string, number> = {};
  for (const k of ['x', 'y', 'scale', 'rotation', 'opacity', 'brightness', 'contrast', 'saturation', 'hue', 'grayscale', 'sepia', 'invert', 'blur']) {
    p[k] = PROP_BY_KEY[k].default;
  }
  return p;
}

/** 再生ヘッド位置で空いている最上位の映像トラックを探す（なければ新規作成） */
function freeVideoTrack(project: Project, start: number, duration: number): { project: Project; trackId: string } {
  const vt = tracksByNumber(project.tracks, 'video');
  const free = vt.find(
    (t) => !t.locked && !project.clips.some((c) => c.trackId === t.id && c.start < start + duration - EPS && clipEnd(c) > start + EPS),
  );
  if (free) return { project, trackId: free.id };
  const added = withNewTrack(project, 'video');
  return { project: added.project, trackId: added.trackId };
}

export function addGeneratedClip(kind: ClipKind, partial: Partial<Clip>, name: string, at?: number, trackId?: string) {
  const start = snapToFrame(at ?? S().ui.playhead, fps());
  const duration = 5;
  let clipId = '';
  commit((p0) => {
    let p = p0;
    let tid = trackId;
    if (!tid) {
      const r = freeVideoTrack(p, start, duration);
      p = r.project;
      tid = r.trackId;
    }
    const clip = makeClip({ kind, trackId: tid, start, duration, name, ...partial });
    clipId = clip.id;
    return { ...p, clips: placeClips(p.clips, [clip]) };
  });
  setUI({ selection: [clipId], topLeftTab: 'effectControls' });
}

export function addText(templateId = 'title', at?: number, trackId?: string) {
  const tpl = TEXT_TEMPLATES.find((t) => t.id === templateId) ?? TEXT_TEMPLATES[0];
  const partial = tpl.make();
  if (templateId === 'lower-third') {
    const { width, height } = S().project.sequence;
    partial.props = { ...partial.props, x: -width * 0.25, y: height * 0.3 };
  }
  if (templateId === 'subtitle') {
    partial.props = { ...partial.props, y: S().project.sequence.height * 0.38 };
  }
  addGeneratedClip('text', partial, tpl.name, at, trackId);
}

export function addColorMatte(color = '#1e3a8a', at?: number, trackId?: string) {
  addGeneratedClip('color', { color }, 'カラーマット', at, trackId);
}

// ---------------- トラック ----------------
function withNewTrack(p: Project, kind: TrackKind): { project: Project; trackId: string } {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1;
  let name = `${kind === 'video' ? 'V' : 'A'}${n}`;
  while (p.tracks.some((t) => t.name === name)) name += "'";
  const track: Track = { id: uid('track'), kind, name, muted: false, hidden: false, locked: false };
  const tracks = kind === 'video' ? [track, ...p.tracks] : [...p.tracks, track];
  return { project: { ...p, tracks }, trackId: track.id };
}

export function addTrack(kind: TrackKind) {
  commit((p) => withNewTrack(p, kind).project);
}

export function removeTrack(trackId: string) {
  const { project } = S();
  const t = project.tracks.find((x) => x.id === trackId);
  if (!t) return;
  if (project.tracks.filter((x) => x.kind === t.kind).length <= 1) return toast('最後のトラックは削除できません');
  const used = project.clips.some((c) => c.trackId === trackId);
  if (used && !confirm(`${t.name} のクリップも削除されます。よろしいですか？`)) return;
  commit((p) => ({ ...p, tracks: p.tracks.filter((x) => x.id !== trackId), clips: p.clips.filter((c) => c.trackId !== trackId) }));
}

export function toggleTrack(trackId: string, key: 'muted' | 'hidden' | 'locked') {
  commit((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, [key]: !t[key] } : t)) }));
}

// ---------------- マーカー・ナビゲーション ----------------
export function addMarker() {
  const t = S().ui.playhead;
  commit((p) => ({
    ...p,
    markers: [...p.markers.filter((m) => Math.abs(m.time - t) > EPS), { id: uid('mk'), time: t, label: '', color: '#3ec46d' }].sort((a, b) => a.time - b.time),
  }));
}

export function removeMarker(id: string) {
  commit((p) => ({ ...p, markers: p.markers.filter((m) => m.id !== id) }));
}

export function gotoEdit(dir: 1 | -1) {
  const pts = editPoints(S().project);
  const t = S().ui.playhead;
  const next = dir > 0 ? pts.find((x) => x > t + EPS) : [...pts].reverse().find((x) => x < t - EPS);
  if (next !== undefined) engine.seek(next);
}

export function stepFrames(n: number) {
  const f = fps();
  const t = Math.round(S().ui.playhead * f) / f + n / f;
  engine.seek(Math.max(0, t));
}

export function gotoStart() {
  engine.seek(0);
}
export function gotoEnd() {
  engine.seek(sequenceDuration(S().project));
}

// ---------------- ズーム ----------------
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 1200;
export function setZoom(z: number) {
  setUI({ zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) });
}
export function zoomBy(f: number) {
  setZoom(S().ui.zoom * f);
}

// ---------------- プロジェクト ----------------
let saveTimer = 0;
let lastSaved: Project | null = null;
let restored = false;

export function startAutosave(subscribeFn: (fn: () => void) => () => void) {
  return subscribeFn(() => {
    const p = S().project;
    if (!restored || p === lastSaved) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      lastSaved = p;
      saveProject(p).catch((e) => console.warn('autosave failed', e));
    }, 800);
  });
}

export async function restoreProject() {
  try {
    const saved = await loadProject();
    if (saved && saved.project.media) {
      const media = [];
      for (const m of saved.project.media) {
        const blob = saved.blobs.get(m.id);
        if (!blob) continue;
        try {
          const item = await importFile(blob, m.name, m.id);
          media.push({ ...m, url: item.url });
          analyzeMedia({ ...m, url: item.url });
        } catch {
          /* 読み込めない素材はスキップ */
        }
      }
      const ids = new Set(media.map((m) => m.id));
      const project: Project = {
        ...createEmptyProject(),
        ...saved.project,
        media,
        clips: saved.project.clips.filter((c) => !c.mediaId || ids.has(c.mediaId)),
      };
      lastSaved = project;
      replaceProject(project);
      if (project.clips.length) toast('前回のプロジェクトを復元しました');
    }
  } catch (e) {
    console.warn('restore failed', e);
  } finally {
    restored = true;
  }
}

export async function newProject() {
  if (S().project.clips.length && !confirm('現在のプロジェクトを破棄して新規作成しますか？')) return;
  engine.pause();
  for (const m of S().project.media) releaseMedia(m.id, m.url);
  await clearSaved();
  const p = createEmptyProject();
  lastSaved = p;
  replaceProject(p);
}

export function setSequence(patch: Partial<Project['sequence']>) {
  commit((p) => ({ ...p, sequence: { ...p.sequence, ...patch } }));
}

export function renameProject(name: string) {
  commit((p) => ({ ...p, name }));
}

/** 再生ヘッド位置のフレームを PNG で保存 */
export async function exportFramePng() {
  const blob = await engine.snapshot();
  if (!blob) return;
  const { project, ui } = S();
  downloadBlob(blob, `${project.name}_${timecode(ui.playhead, project.sequence.fps).replace(/:/g, '-')}.png`);
}
