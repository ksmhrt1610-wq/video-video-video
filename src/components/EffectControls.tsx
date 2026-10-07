import { useState, type ReactNode } from 'react';
import type { BlendMode, Clip, TextStyle, TransitionType } from '../core/types';
import { beginGesture, endGesture, useStore } from '../store';
import { PROP_BY_KEY, getProp, keyframeAt, propsForKind } from '../core/props';
import { timecode } from '../core/time';
import {
  resetProps,
  setClipProp,
  setClipSpeed,
  toggleAnimation,
  toggleKeyframeAtPlayhead,
  updateClip,
} from '../actions';
import { engine } from '../core/engine';
import { NumberField } from './NumberField';
import { Icon } from './icons';
import { TRANSITION_NAMES } from './Timeline';

const BLEND_MODES: [BlendMode, string][] = [
  ['source-over', '通常'],
  ['multiply', '乗算'],
  ['screen', 'スクリーン'],
  ['overlay', 'オーバーレイ'],
  ['darken', '比較（暗）'],
  ['lighten', '比較（明）'],
  ['color-dodge', '覆い焼きカラー'],
  ['color-burn', '焼き込みカラー'],
  ['difference', '差'],
  ['exclusion', '除外'],
];

const FONTS: [string, string][] = [
  ['"Noto Sans JP", "Hiragino Sans", "Yu Gothic", sans-serif', 'ゴシック'],
  ['"Noto Serif JP", "Hiragino Mincho ProN", "Yu Mincho", serif', '明朝'],
  ['"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", sans-serif', '丸ゴシック'],
  ['Impact, "Arial Black", sans-serif', 'Impact'],
  ['Georgia, serif', 'Georgia'],
  ['"Courier New", monospace', 'Courier'],
  ['"Comic Sans MS", cursive', 'Comic'],
];

export function EffectControls() {
  const selection = useStore((s) => s.ui.selection);
  const clips = useStore((s) => s.project.clips);
  const selected = clips.filter((c) => selection.includes(c.id));
  if (selected.length === 0) {
    return <div className="empty-hint"><p>タイムラインでクリップを選択すると、ここでモーション・不透明度・カラー・テキスト・オーディオなどを調整できます。</p></div>;
  }
  const visual = selected.find((c) => c.kind !== 'audio');
  const audio = selected.find((c) => c.kind === 'audio');
  const sameGroup = selected.every((c) => c.linkId && c.linkId === selected[0].linkId);
  if (selected.length > 2 || (selected.length === 2 && !sameGroup)) {
    return <div className="empty-hint"><p>{selected.length} 個のクリップが選択されています。<br />1 つのクリップを選択してください。</p></div>;
  }
  return (
    <div className="effect-controls">
      {visual && <VisualControls clip={visual} />}
      {audio && <AudioControls clip={audio} />}
    </div>
  );
}

function ClipHeader({ clip }: { clip: Clip }) {
  const fps = useStore((s) => s.project.sequence.fps);
  return (
    <div className="ec-header">
      <div className="ec-title">{clip.kind === 'text' ? 'グラフィック' : clip.name}</div>
      <div className="ec-sub">
        開始 {timecode(clip.start, fps)} ・ 長さ {timecode(clip.duration, fps)}
      </div>
    </div>
  );
}

function Section({ title, children, onReset, defaultOpen = true }: { title: string; children: ReactNode; onReset?: () => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ec-section">
      <div className="ec-section-head" onClick={() => setOpen(!open)}>
        <span className={`caret ${open ? 'open' : ''}`}>▸</span>
        <span className="fx-tag">fx</span>
        <span>{title}</span>
        <span className="spacer" />
        {onReset && (
          <button
            className="icon-btn small"
            title="リセット"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
          >
            {Icon.reset(12)}
          </button>
        )}
      </div>
      {open && <div className="ec-section-body">{children}</div>}
    </div>
  );
}

function PropRow({ clip, propKey }: { clip: Clip; propKey: string }) {
  const def = PROP_BY_KEY[propKey];
  const playhead = useStore((s) => s.ui.playhead);
  const fps = useStore((s) => s.project.sequence.fps);
  const local = Math.min(Math.max(0, playhead - clip.start), clip.duration);
  const value = getProp(clip, propKey, local);
  const kfs = clip.keyframes[propKey];
  const animated = !!kfs?.length;
  const atKf = animated && !!keyframeAt(kfs, local, 0.5 / fps);
  const prevKf = animated ? [...kfs].reverse().find((k) => k.t < local - 0.5 / fps) : undefined;
  const nextKf = animated ? kfs.find((k) => k.t > local + 0.5 / fps) : undefined;

  return (
    <div className="ec-row">
      {def.animatable ? (
        <button className={`icon-btn small stopwatch ${animated ? 'active' : ''}`} title="アニメーションのオン／オフ" onClick={() => toggleAnimation(clip.id, propKey)}>
          {Icon.stopwatch(12)}
        </button>
      ) : (
        <span className="stopwatch-placeholder" />
      )}
      <span className="ec-label">{def.label}</span>
      <NumberField
        value={value}
        min={def.min}
        max={def.max}
        step={def.step}
        unit={def.unit}
        onScrubStart={beginGesture}
        onScrub={(v) => setClipProp(clip.id, propKey, v, { history: false })}
        onScrubEnd={() => endGesture()}
        onChange={(v) => setClipProp(clip.id, propKey, v)}
      />
      {animated && (
        <span className="kf-nav">
          <button className="icon-btn tiny" disabled={!prevKf} onClick={() => prevKf && engine.seek(clip.start + prevKf.t)} title="前のキーフレーム">
            {Icon.chevronLeft(10)}
          </button>
          <button className={`icon-btn tiny kf-toggle ${atKf ? 'on' : ''}`} onClick={() => toggleKeyframeAtPlayhead(clip.id, propKey)} title="キーフレームの追加／削除">
            {Icon.diamond(10)}
          </button>
          <button className="icon-btn tiny" disabled={!nextKf} onClick={() => nextKf && engine.seek(clip.start + nextKf.t)} title="次のキーフレーム">
            {Icon.chevronRight(10)}
          </button>
        </span>
      )}
      {animated && (
        <div className="kf-track">
          {kfs.map((k, i) => (
            <span
              key={i}
              className={`kf-dot ${Math.abs(k.t - local) < 0.5 / fps ? 'on' : ''}`}
              style={{ left: `${(k.t / clip.duration) * 100}%` }}
              onClick={() => engine.seek(clip.start + k.t)}
              title={`${timecode(clip.start + k.t, fps)} : ${k.v.toFixed(1)}`}
            />
          ))}
          <span className="kf-head" style={{ left: `${(local / clip.duration) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

function VisualControls({ clip }: { clip: Clip }) {
  const keys = propsForKind(clip.kind).map((p) => p.key);
  const motion = keys.filter((k) => PROP_BY_KEY[k].group === 'motion');
  const color = keys.filter((k) => PROP_BY_KEY[k].group === 'color');
  return (
    <>
      <ClipHeader clip={clip} />
      {clip.kind === 'text' && clip.text && <TextControls clip={clip} text={clip.text} />}
      {clip.kind === 'color' && (
        <Section title="カラーマット">
          <div className="ec-row">
            <span className="stopwatch-placeholder" />
            <span className="ec-label">カラー</span>
            <input type="color" value={clip.color ?? '#000000'} onChange={(e) => updateClip(clip.id, { color: e.target.value })} />
          </div>
        </Section>
      )}
      <Section title="モーション" onReset={() => resetProps(clip.id, motion)}>
        {motion.map((k) => (
          <PropRow key={k} clip={clip} propKey={k} />
        ))}
      </Section>
      <Section title="不透明度" onReset={() => { resetProps(clip.id, ['opacity']); updateClip(clip.id, { blendMode: 'source-over' }); }}>
        <PropRow clip={clip} propKey="opacity" />
        <div className="ec-row">
          <span className="stopwatch-placeholder" />
          <span className="ec-label">描画モード</span>
          <select className="mini-select" value={clip.blendMode} onChange={(e) => updateClip(clip.id, { blendMode: e.target.value as BlendMode })}>
            {BLEND_MODES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
      </Section>
      {(clip.kind === 'video' || clip.kind === 'audio') && <SpeedSection clip={clip} />}
      <Section title="カラー補正 (Lumetri 風)" onReset={() => resetProps(clip.id, color)}>
        {color.map((k) => (
          <PropRow key={k} clip={clip} propKey={k} />
        ))}
      </Section>
      <TransitionSection clip={clip} />
    </>
  );
}

function SpeedSection({ clip }: { clip: Clip }) {
  return (
    <Section title="速度・デュレーション" defaultOpen={false}>
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">速度</span>
        <NumberField value={clip.speed * 100} min={10} max={1000} step={1} unit="%" onChange={(v) => setClipSpeed(clip.id, v / 100)} />
      </div>
      <div className="ec-note">速度を変えるとクリップの長さが変わります（リンクした音声も連動）。</div>
    </Section>
  );
}

function TransitionSection({ clip }: { clip: Clip }) {
  const types = Object.keys(TRANSITION_NAMES) as TransitionType[];
  const row = (side: 'in' | 'out') => {
    const tr = side === 'in' ? clip.transitionIn : clip.transitionOut;
    const key = side === 'in' ? 'transitionIn' : 'transitionOut';
    return (
      <div className="ec-row" key={side}>
        <span className="stopwatch-placeholder" />
        <span className="ec-label">{side === 'in' ? '開始' : '終了'}</span>
        <select
          className="mini-select"
          value={tr?.type ?? ''}
          onChange={(e) => {
            const type = e.target.value as TransitionType | '';
            updateClip(clip.id, { [key]: type ? { type, duration: tr?.duration ?? Math.min(1, clip.duration) } : undefined });
          }}
        >
          <option value="">なし</option>
          {types.map((t) => (
            <option key={t} value={t}>{TRANSITION_NAMES[t]}</option>
          ))}
        </select>
        {tr && (
          <NumberField
            value={tr.duration}
            min={0.05}
            max={clip.duration}
            step={0.05}
            unit="秒"
            onChange={(v) => updateClip(clip.id, { [key]: { ...tr, duration: v } })}
          />
        )}
      </div>
    );
  };
  return (
    <Section title="トランジション">
      {row('in')}
      {row('out')}
      <div className="ec-note">開始側のトランジションは、同じトラックの直前のクリップから切り替わります。</div>
    </Section>
  );
}

function TextControls({ clip, text }: { clip: Clip; text: TextStyle }) {
  const set = (patch: Partial<TextStyle>) => updateClip(clip.id, { text: { ...text, ...patch } });
  return (
    <Section title="テキスト">
      <textarea
        className="ec-textarea"
        value={text.content}
        rows={3}
        onChange={(e) => set({ content: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">フォント</span>
        <select className="mini-select" value={text.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
          {FONTS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      </div>
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">サイズ</span>
        <NumberField value={text.fontSize} min={4} max={1000} step={1} unit="px" onChange={(v) => set({ fontSize: v })} />
      </div>
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">スタイル</span>
        <div className="btn-group">
          <button className={`tog ${text.bold ? 'on' : ''}`} onClick={() => set({ bold: !text.bold })}><b>B</b></button>
          <button className={`tog ${text.italic ? 'on' : ''}`} onClick={() => set({ italic: !text.italic })}><i>I</i></button>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a} className={`tog ${text.align === a ? 'on' : ''}`} onClick={() => set({ align: a })}>
              {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
            </button>
          ))}
        </div>
      </div>
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">塗り</span>
        <input type="color" value={text.color} onChange={(e) => set({ color: e.target.value })} />
      </div>
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">境界線</span>
        <input type="color" value={text.strokeColor} onChange={(e) => set({ strokeColor: e.target.value })} />
        <NumberField value={text.strokeWidth} min={0} max={50} step={1} unit="px" onChange={(v) => set({ strokeWidth: v })} />
      </div>
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">背景</span>
        <input type="color" value={text.bgColor} onChange={(e) => set({ bgColor: e.target.value })} />
        <NumberField value={text.bgOpacity} min={0} max={100} step={1} unit="%" onChange={(v) => set({ bgOpacity: v })} />
      </div>
      <div className="ec-row">
        <span className="stopwatch-placeholder" />
        <span className="ec-label">シャドウ</span>
        <input type="checkbox" checked={text.shadow} onChange={(e) => set({ shadow: e.target.checked })} />
      </div>
    </Section>
  );
}

function AudioControls({ clip }: { clip: Clip }) {
  const keys = propsForKind('audio').map((p) => p.key);
  return (
    <>
      <ClipHeader clip={clip} />
      <Section title="オーディオ" onReset={() => resetProps(clip.id, keys)}>
        {keys.map((k) => (
          <PropRow key={k} clip={clip} propKey={k} />
        ))}
      </Section>
      {!clip.linkId && <SpeedSection clip={clip} />}
    </>
  );
}
