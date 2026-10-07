import { useState } from 'react';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  decimals?: number;
  /** ドラッグ中（確定前）の変更 */
  onScrub?: (v: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  /** 確定した変更 */
  onChange: (v: number) => void;
}

/** Premiere の「ホットテキスト」風: 左右ドラッグで値を変更、クリックで直接入力 */
export function NumberField({ value, min = -Infinity, max = Infinity, step = 1, unit, decimals, onScrub, onScrubStart, onScrubEnd, onChange }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const dec = decimals ?? (step < 1 ? Math.min(3, Math.ceil(-Math.log10(step))) : 0);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(dec) : '—');

  if (editing !== null) {
    const commit = () => {
      const v = parseFloat(editing);
      if (!Number.isNaN(v)) onChange(clamp(v));
      setEditing(null);
    };
    return (
      <input
        className="hot-input"
        autoFocus
        value={editing}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(null);
        }}
        onFocus={(e) => e.currentTarget.select()}
      />
    );
  }

  return (
    <span
      className="hot-text"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const x0 = e.clientX;
        let moved = false;
        let last = value;
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - x0;
          if (!moved && Math.abs(dx) < 3) return;
          if (!moved) onScrubStart?.();
          moved = true;
          const mul = ev.shiftKey ? 10 : ev.altKey || ev.ctrlKey ? 0.1 : 1;
          last = clamp(Math.round((value + dx * step * mul) / (step * (mul < 1 ? 0.1 : 1))) * (step * (mul < 1 ? 0.1 : 1)));
          (onScrub ?? onChange)(last);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (moved) onScrubEnd?.();
          else setEditing(fmt(value));
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      title="ドラッグで調整（Shift で 10 倍）／クリックで入力"
    >
      {fmt(value)}
      {unit && <span className="hot-unit">{unit}</span>}
    </span>
  );
}
