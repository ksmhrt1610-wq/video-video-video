import { useSyncExternalStore, useRef, useCallback } from 'react';
import type { Project } from './core/types';
import { createEmptyProject } from './core/timeline';

export type Tool = 'select' | 'razor' | 'hand';
export type TopLeftTab = 'source' | 'effectControls';
export type BottomLeftTab = 'project' | 'effects' | 'graphics';
export type Dialog = null | 'export' | 'sequence' | 'shortcuts' | 'about';

export interface UIState {
  playhead: number;
  playing: boolean;
  selection: string[];
  tool: Tool;
  /** ピクセル/秒 */
  zoom: number;
  scrollX: number;
  snapping: boolean;
  linkedSelection: boolean;
  topLeftTab: TopLeftTab;
  bottomLeftTab: BottomLeftTab;
  sourceMediaId?: string;
  sourceMarks: Record<string, { in?: number; out?: number }>;
  dialog: Dialog;
  toast?: { text: string; id: number };
  /** 書き出し中はタイムライン操作をロック */
  exporting: boolean;
  /** プレビュー解像度 (1, 0.5, 0.25) */
  previewScale: number;
}

export interface State {
  project: Project;
  ui: UIState;
  past: Project[];
  future: Project[];
}

const initialUI: UIState = {
  playhead: 0,
  playing: false,
  selection: [],
  tool: 'select',
  zoom: 60,
  scrollX: 0,
  snapping: true,
  linkedSelection: true,
  topLeftTab: 'effectControls',
  bottomLeftTab: 'project',
  sourceMarks: {},
  dialog: null,
  exporting: false,
  previewScale: 1,
};

let state: State = {
  project: createEmptyProject(),
  ui: initialUI,
  past: [],
  future: [],
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setUI(patch: Partial<UIState> | ((ui: UIState) => Partial<UIState>)) {
  const p = typeof patch === 'function' ? patch(state.ui) : patch;
  state = { ...state, ui: { ...state.ui, ...p } };
  emit();
}

const HISTORY_LIMIT = 200;

/** 履歴に残る編集 */
export function commit(fn: (p: Project) => Project) {
  const next = fn(state.project);
  if (next === state.project) return;
  state = {
    ...state,
    project: next,
    past: [...state.past.slice(-HISTORY_LIMIT + 1), state.project],
    future: [],
    ui: { ...state.ui, selection: state.ui.selection.filter((id) => next.clips.some((c) => c.id === id)) },
  };
  emit();
}

/** ドラッグ中などの一時的な変更（履歴に残さない） */
export function preview(fn: (p: Project) => Project) {
  const next = fn(state.project);
  if (next === state.project) return;
  state = { ...state, project: next };
  emit();
}

let gestureBase: Project | null = null;
/** ドラッグ操作の開始。終了時に endGesture を呼ぶと 1 ステップの履歴になる */
export function beginGesture() {
  gestureBase = state.project;
}
export function endGesture(finalize?: (p: Project) => Project) {
  const base = gestureBase;
  gestureBase = null;
  let project = state.project;
  if (finalize) project = finalize(project);
  if (!base || base === project) {
    if (project !== state.project) {
      state = { ...state, project };
      emit();
    }
    return;
  }
  state = {
    ...state,
    project,
    past: [...state.past.slice(-HISTORY_LIMIT + 1), base],
    future: [],
  };
  emit();
}
export function cancelGesture() {
  if (gestureBase) {
    state = { ...state, project: gestureBase };
    gestureBase = null;
    emit();
  }
}

export function undo() {
  const prev = state.past[state.past.length - 1];
  if (!prev) return;
  state = {
    ...state,
    project: { ...prev, media: mergeMedia(prev, state.project) },
    past: state.past.slice(0, -1),
    future: [state.project, ...state.future],
  };
  pruneSelection();
  emit();
}

export function redo() {
  const next = state.future[0];
  if (!next) return;
  state = {
    ...state,
    project: { ...next, media: mergeMedia(next, state.project) },
    past: [...state.past, state.project],
    future: state.future.slice(1),
  };
  pruneSelection();
  emit();
}

/** メディアの解析結果（hasAudio 等）は取り消しで巻き戻さない */
function mergeMedia(target: Project, current: Project) {
  return target.media.map((m) => current.media.find((c) => c.id === m.id) ?? m);
}

function pruneSelection() {
  const ids = new Set(state.project.clips.map((c) => c.id));
  state = { ...state, ui: { ...state.ui, selection: state.ui.selection.filter((id) => ids.has(id)) } };
}

export function replaceProject(project: Project, keepHistory = false) {
  state = {
    project,
    ui: { ...initialUI, zoom: state.ui.zoom },
    past: keepHistory ? state.past : [],
    future: [],
  };
  emit();
}

/** メディアのメタデータ更新（履歴に残さない） */
export function patchMedia(id: string, patch: Partial<Project['media'][number]>) {
  const update = (p: Project): Project => ({
    ...p,
    media: p.media.map((m) => (m.id === id ? { ...m, ...patch } : m)),
  });
  state = {
    ...state,
    project: update(state.project),
    past: state.past.map(update),
    future: state.future.map(update),
  };
  emit();
}

let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  setUI({ toast: { text, id } });
  setTimeout(() => {
    if (state.ui.toast?.id === id) setUI({ toast: undefined });
  }, 2600);
}

export function useStore<T>(selector: (s: State) => T): T {
  const selRef = useRef(selector);
  selRef.current = selector;
  const get = useCallback(() => selRef.current(state), []);
  return useSyncExternalStore(subscribe, get, get);
}
