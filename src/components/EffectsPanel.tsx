import { useState } from 'react';
import type { TransitionType } from '../core/types';
import { PRESETS, TEXT_TEMPLATES, addColorMatte, addText, applyAudioFade, applyPreset, applyTransition, selectedClips } from '../actions';
import { TRANSITION_NAMES } from './Timeline';
import { toast } from '../store';

function Folder({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="fx-folder">
      <div className="fx-folder-head" onClick={() => setOpen(!open)}>
        <span className={`caret ${open ? 'open' : ''}`}>▸</span> 📁 {title}
      </div>
      {open && <div className="fx-folder-body">{children}</div>}
    </div>
  );
}

function EffectItem({ data, label, onApply, hint }: { data: string; label: string; onApply: () => void; hint?: string }) {
  return (
    <div
      className="fx-item"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-vvv-effect', data);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onDoubleClick={onApply}
      title={hint ?? 'クリップへドラッグ、または選択中のクリップにダブルクリックで適用'}
    >
      <span className="fx-icon">▤</span>
      {label}
    </div>
  );
}

function withSelected(kind: 'visual' | 'audio', fn: (id: string) => void) {
  const c = selectedClips().find((x) => (kind === 'audio' ? x.kind === 'audio' : x.kind !== 'audio'));
  if (!c) return toast(kind === 'audio' ? '音声クリップを選択してください' : '映像クリップを選択してください');
  fn(c.id);
}

export function EffectsPanel() {
  const [q, setQ] = useState('');
  const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
  const transitions = (Object.keys(TRANSITION_NAMES) as TransitionType[]).filter((t) => match(TRANSITION_NAMES[t]));
  return (
    <div className="effects-panel">
      <input className="search" placeholder="🔍 エフェクトを検索" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <div className="fx-list">
        <Folder title="ビデオトランジション">
          {transitions.map((t) => (
            <EffectItem
              key={t}
              data={`transition:${t}`}
              label={TRANSITION_NAMES[t]}
              hint="クリップの左半分にドロップで開始側、右半分で終了側に適用"
              onApply={() => withSelected('visual', (id) => applyTransition(id, 'in', t))}
            />
          ))}
        </Folder>
        <Folder title="オーディオトランジション">
          {match('コンスタントパワー フェード') && (
            <EffectItem
              data="audiofade:1"
              label="コンスタントパワー（フェード）"
              hint="音声クリップの左半分でフェードイン、右半分でフェードアウト"
              onApply={() => withSelected('audio', (id) => applyAudioFade(id, 'in'))}
            />
          )}
        </Folder>
        <Folder title="ビデオエフェクト プリセット">
          {PRESETS.filter((p) => match(p.name)).map((p) => (
            <EffectItem key={p.id} data={`preset:${p.id}`} label={p.name} onApply={() => withSelected('visual', (id) => applyPreset(id, p.id))} />
          ))}
        </Folder>
      </div>
    </div>
  );
}

export function GraphicsPanel() {
  return (
    <div className="effects-panel">
      <div className="ec-note">テンプレートをタイムラインにドラッグするか、クリックで再生ヘッド位置に追加します。</div>
      <div className="gfx-grid">
        {TEXT_TEMPLATES.map((t) => (
          <div
            key={t.id}
            className={`gfx-card gfx-${t.id}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/x-vvv-graphic', t.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => addText(t.id)}
          >
            <div className="gfx-preview">
              <span>{t.id === 'lower-third' ? '名前 / 肩書き' : t.id === 'subtitle' ? '字幕テキスト' : t.id === 'big' ? 'WOW!' : 'Title'}</span>
            </div>
            <div className="gfx-name">{t.name}</div>
          </div>
        ))}
        <div
          className="gfx-card"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-vvv-graphic', 'color');
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => addColorMatte()}
        >
          <div className="gfx-preview" style={{ background: '#1e3a8a' }} />
          <div className="gfx-name">カラーマット</div>
        </div>
      </div>
    </div>
  );
}
