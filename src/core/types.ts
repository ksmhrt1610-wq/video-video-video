export type MediaType = 'video' | 'audio' | 'image';
export type TrackKind = 'video' | 'audio';
export type ClipKind = 'video' | 'audio' | 'image' | 'text' | 'color';

export interface MediaItem {
  id: string;
  name: string;
  type: MediaType;
  /** object URL (ランタイムのみ。永続化しない) */
  url: string;
  /** 秒。画像は 0 */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  size: number;
  mime: string;
}

/** メディアのランタイム解析結果（永続化しない） */
export interface MediaAnalysis {
  thumbnails: { time: number; url: string }[];
  /** 1 秒あたり PEAKS_PER_SEC 個の絶対値ピーク (0..1) */
  peaks?: Float32Array;
  audioBuffer?: AudioBuffer;
}

export interface Keyframe {
  /** クリップ先頭からの相対時間（秒） */
  t: number;
  v: number;
}

export type TransitionType =
  | 'cross-dissolve'
  | 'dip-black'
  | 'dip-white'
  | 'wipe'
  | 'slide'
  | 'push'
  | 'zoom';

export interface Transition {
  type: TransitionType;
  duration: number;
}

export interface TextStyle {
  content: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  strokeColor: string;
  strokeWidth: number;
  bgColor: string;
  bgOpacity: number;
  shadow: boolean;
}

export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'difference'
  | 'exclusion';

export interface Clip {
  id: string;
  kind: ClipKind;
  mediaId?: string;
  trackId: string;
  /** タイムライン上の開始位置（秒） */
  start: number;
  /** タイムライン上の長さ（秒） */
  duration: number;
  /** ソースのイン点（秒） */
  offset: number;
  speed: number;
  /** 同じ linkId を持つクリップ（映像と音声）は一緒に動く */
  linkId?: string;
  name: string;
  disabled?: boolean;
  props: Record<string, number>;
  keyframes: Record<string, Keyframe[]>;
  blendMode: BlendMode;
  transitionIn?: Transition;
  transitionOut?: Transition;
  text?: TextStyle;
  color?: string;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface SequenceSettings {
  width: number;
  height: number;
  fps: number;
  background: string;
}

export interface Project {
  name: string;
  sequence: SequenceSettings;
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
}
