import { useState } from 'react';
import { redo, setUI, undo, useStore } from '../store';
import {
  addColorMatte,
  addMarker,
  addText,
  addTrack,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  exportFramePng,
  linkSelection,
  newProject,
  paste,
  rippleTrimToPlayhead,
  selectAll,
  splitAtPlayhead,
  toggleEnabled,
  unlinkSelection,
  zoomBy,
} from '../actions';
import type { MenuItem } from './ContextMenu';

interface Menu {
  label: string;
  items: () => MenuItem[];
}

export function MenuBar() {
  const [open, setOpen] = useState<number | null>(null);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const hasSel = useStore((s) => s.ui.selection.length > 0);
  const snapping = useStore((s) => s.ui.snapping);
  const name = useStore((s) => s.project.name);

  const menus: Menu[] = [
    {
      label: 'ファイル',
      items: () => [
        { label: '新規プロジェクト', onClick: newProject },
        { label: '読み込み…', shortcut: 'Ctrl+I', onClick: () => document.getElementById('vvv-import-input')?.click() },
        { separator: true },
        { label: '書き出し（メディア）…', shortcut: 'Ctrl+M', onClick: () => setUI({ dialog: 'export' }) },
        { label: 'フレームを書き出し（PNG）', onClick: exportFramePng },
      ],
    },
    {
      label: '編集',
      items: () => [
        { label: '取り消し', shortcut: 'Ctrl+Z', disabled: !canUndo, onClick: undo },
        { label: 'やり直し', shortcut: 'Ctrl+Shift+Z', disabled: !canRedo, onClick: redo },
        { separator: true },
        { label: 'カット', shortcut: 'Ctrl+X', disabled: !hasSel, onClick: cutSelection },
        { label: 'コピー', shortcut: 'Ctrl+C', disabled: !hasSel, onClick: copySelection },
        { label: 'ペースト', shortcut: 'Ctrl+V', onClick: paste },
        { label: '複製', shortcut: 'Ctrl+D', disabled: !hasSel, onClick: duplicateSelection },
        { label: '消去', shortcut: 'Delete', disabled: !hasSel, onClick: () => deleteSelection(false) },
        { label: 'リップル削除', shortcut: 'Shift+Delete', onClick: () => deleteSelection(true) },
        { separator: true },
        { label: 'すべてを選択', shortcut: 'Ctrl+A', onClick: selectAll },
        { label: 'すべての選択を解除', shortcut: 'Esc', onClick: () => setUI({ selection: [] }) },
      ],
    },
    {
      label: 'クリップ',
      items: () => [
        { label: '有効', shortcut: 'Shift+E', disabled: !hasSel, onClick: toggleEnabled },
        { label: 'リンク', disabled: !hasSel, onClick: linkSelection },
        { label: 'リンク解除', disabled: !hasSel, onClick: unlinkSelection },
      ],
    },
    {
      label: 'シーケンス',
      items: () => [
        { label: 'シーケンス設定…', onClick: () => setUI({ dialog: 'sequence' }) },
        { separator: true },
        { label: '編集点を追加', shortcut: 'Ctrl+K', onClick: splitAtPlayhead },
        { label: '前の編集点をリップルトリム', shortcut: 'Q', onClick: () => rippleTrimToPlayhead('prev') },
        { label: '次の編集点をリップルトリム', shortcut: 'W', onClick: () => rippleTrimToPlayhead('next') },
        { separator: true },
        { label: 'ズームイン', shortcut: '+', onClick: () => zoomBy(1.5) },
        { label: 'ズームアウト', shortcut: '-', onClick: () => zoomBy(1 / 1.5) },
        { label: 'シーケンス全体を表示', shortcut: '\\', onClick: () => window.dispatchEvent(new Event('vvv:zoom-fit')) },
        { label: 'スナップ', shortcut: 'S', checked: snapping, onClick: () => setUI({ snapping: !snapping }) },
        { separator: true },
        { label: '映像トラックを追加', onClick: () => addTrack('video') },
        { label: '音声トラックを追加', onClick: () => addTrack('audio') },
      ],
    },
    {
      label: 'グラフィック',
      items: () => [
        { label: 'テキストを追加', shortcut: 'T', onClick: () => addText('title') },
        { label: '字幕を追加', onClick: () => addText('subtitle') },
        { label: 'ロワーサードを追加', onClick: () => addText('lower-third') },
        { label: 'カラーマットを追加', onClick: () => addColorMatte() },
      ],
    },
    {
      label: 'マーカー',
      items: () => [{ label: 'マーカーを追加', shortcut: 'M', onClick: addMarker }],
    },
    {
      label: 'ヘルプ',
      items: () => [
        { label: 'キーボードショートカット', shortcut: '?', onClick: () => setUI({ dialog: 'shortcuts' }) },
        { label: 'VVV Editor について', onClick: () => setUI({ dialog: 'about' }) },
      ],
    },
  ];

  return (
    <div className="menubar">
      <div className="app-logo">Vv</div>
      {menus.map((m, i) => (
        <div key={m.label} className="menu-root" onPointerEnter={() => open !== null && setOpen(i)}>
          <button className={`menu-title ${open === i ? 'open' : ''}`} onClick={() => setOpen(open === i ? null : i)}>
            {m.label}
          </button>
          {open === i && (
            <>
              <div className="menu-catcher" onPointerDown={() => setOpen(null)} />
              <div className="context-menu dropdown">
                {m.items().map((it, j) =>
                  it.separator ? (
                    <div key={j} className="menu-sep" />
                  ) : (
                    <button
                      key={j}
                      className="menu-item"
                      disabled={it.disabled}
                      onClick={() => {
                        setOpen(null);
                        it.onClick?.();
                      }}
                    >
                      <span className="menu-check">{it.checked ? '✓' : ''}</span>
                      <span className="menu-label">{it.label}</span>
                      {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      ))}
      <div className="spacer" />
      <div className="project-name">{name}</div>
      <div className="spacer" />
      <button className="btn small" onClick={undo} disabled={!canUndo} title="取り消し (Ctrl+Z)">↶</button>
      <button className="btn small" onClick={redo} disabled={!canRedo} title="やり直し (Ctrl+Shift+Z)">↷</button>
      <button className="btn primary small export-btn" onClick={() => setUI({ dialog: 'export' })} title="書き出し (Ctrl+M)">
        書き出し
      </button>
    </div>
  );
}
