import { getState, redo, setUI, undo } from './store';
import { engine } from './core/engine';
import {
  addMarker,
  addText,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  gotoEdit,
  gotoEnd,
  gotoStart,
  paste,
  rippleTrimToPlayhead,
  selectAll,
  sourceEdit,
  splitAtPlayhead,
  stepFrames,
  toggleEnabled,
  zoomBy,
} from './actions';

function isTyping(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return (tag === 'INPUT' && !['range', 'checkbox', 'color', 'button'].includes((el as HTMLInputElement).type)) || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const s = getState();
    if (s.ui.dialog) {
      if (e.key === 'Escape') setUI({ dialog: null });
      return;
    }
    if (s.ui.exporting) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const sourceFocused = s.ui.topLeftTab === 'source' && !!s.ui.sourceMediaId;
    let handled = true;

    if (mod) {
      if (k === 'z' && e.shiftKey) redo();
      else if (k === 'z') undo();
      else if (k === 'y') redo();
      else if (k === 'c') copySelection();
      else if (k === 'x') cutSelection();
      else if (k === 'v') paste();
      else if (k === 'd') duplicateSelection();
      else if (k === 'a') selectAll();
      else if (k === 'k') splitAtPlayhead();
      else if (k === 'i') document.getElementById('vvv-import-input')?.click();
      else if (k === 'm') setUI({ dialog: 'export' });
      else handled = false;
    } else {
      switch (e.key) {
        case ' ':
          engine.toggle();
          break;
        case 'k':
        case 'K':
          engine.pause();
          break;
        case 'l':
        case 'L':
          engine.play();
          break;
        case 'j':
        case 'J':
          engine.seek(Math.max(0, engine.currentTime() - 5));
          break;
        case 'ArrowLeft':
          stepFrames(e.shiftKey ? -5 : -1);
          break;
        case 'ArrowRight':
          stepFrames(e.shiftKey ? 5 : 1);
          break;
        case 'ArrowUp':
          gotoEdit(-1);
          break;
        case 'ArrowDown':
          gotoEdit(1);
          break;
        case 'Home':
          gotoStart();
          break;
        case 'End':
          gotoEnd();
          break;
        case 'Delete':
        case 'Backspace':
          deleteSelection(e.shiftKey);
          break;
        case 'Escape':
          setUI({ selection: [] });
          break;
        case 'v':
        case 'V':
          setUI({ tool: 'select' });
          break;
        case 'c':
        case 'C':
          setUI({ tool: 'razor' });
          break;
        case 'h':
        case 'H':
          setUI({ tool: 'hand' });
          break;
        case 't':
        case 'T':
          addText('title');
          break;
        case 'm':
        case 'M':
          addMarker();
          break;
        case 's':
        case 'S':
          setUI({ snapping: !s.ui.snapping });
          break;
        case 'q':
        case 'Q':
          rippleTrimToPlayhead('prev');
          break;
        case 'w':
        case 'W':
          rippleTrimToPlayhead('next');
          break;
        case 'E':
          if (e.shiftKey) toggleEnabled();
          else handled = false;
          break;
        case '+':
        case '=':
          zoomBy(1.5);
          break;
        case '-':
          zoomBy(1 / 1.5);
          break;
        case '\\':
          window.dispatchEvent(new Event('vvv:zoom-fit'));
          break;
        case 'i':
        case 'I':
        case 'o':
        case 'O':
          if (sourceFocused) window.dispatchEvent(new CustomEvent('vvv:source-key', { detail: { key: k } }));
          else handled = false;
          break;
        case ',':
          sourceEdit('insert');
          break;
        case '.':
          sourceEdit('overwrite');
          break;
        case '?':
          setUI({ dialog: 'shortcuts' });
          break;
        default:
          handled = false;
      }
    }
    if (handled) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
