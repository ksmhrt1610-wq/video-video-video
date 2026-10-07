import { useEffect, useMemo, useRef, useState } from 'react';
import { getState, setUI, useStore } from '../store';
import { engine, supportedExportTypes } from '../core/engine';
import { sequenceDuration } from '../core/timeline';
import { formatBytes, timecode } from '../core/time';
import { renameProject, setSequence } from '../actions';
import { downloadUrl } from '../download';

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} onKeyDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>{title}</span>
          {onClose && (
            <button className="icon-btn small" onClick={onClose}>
              ✕
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

const close = () => setUI({ dialog: null });

export function ExportDialog() {
  const project = useStore((s) => s.project);
  const types = useMemo(supportedExportTypes, []);
  const [typeIdx, setTypeIdx] = useState(0);
  const [quality, setQuality] = useState<'high' | 'medium' | 'low'>('high');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; name: string; size: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [fileName, setFileName] = useState(project.name);
  const dur = sequenceDuration(project);
  const { width, height, fps } = project.sequence;
  const pixels = width * height;
  const bitrate = Math.round(pixels * fps * ({ high: 0.2, medium: 0.1, low: 0.05 }[quality]));

  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const start = async () => {
    const t = types[typeIdx];
    if (!t) return;
    setError(null);
    setResult(null);
    setProgress(0);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const blob = await engine.exportVideo({
        mimeType: t.mime,
        videoBitsPerSecond: bitrate,
        onProgress: setProgress,
        signal: ac.signal,
      });
      const name = `${fileName || 'export'}.${t.ext}`;
      const url = URL.createObjectURL(blob);
      setResult({ url, name, size: blob.size });
      downloadUrl(url, name);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const busy = progress !== null;
  return (
    <Modal title="書き出し設定" onClose={busy ? undefined : close}>
      {types.length === 0 ? (
        <p className="error">このブラウザは動画の書き出し（MediaRecorder）に対応していません。最新の Chrome / Edge / Firefox をお使いください。</p>
      ) : (
        <>
          <div className="form-grid">
            <label>ファイル名</label>
            <input value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={busy} />
            <label>形式</label>
            <select value={typeIdx} onChange={(e) => setTypeIdx(parseInt(e.target.value))} disabled={busy}>
              {types.map((t, i) => (
                <option key={t.mime} value={i}>
                  {t.label}
                </option>
              ))}
            </select>
            <label>品質</label>
            <select value={quality} onChange={(e) => setQuality(e.target.value as typeof quality)} disabled={busy}>
              <option value="high">高画質</option>
              <option value="medium">標準</option>
              <option value="low">軽量</option>
            </select>
            <label>出力</label>
            <span>
              {width}×{height} ・ {fps}fps ・ 約 {(bitrate / 1e6).toFixed(1)} Mbps ・ {timecode(dur, fps)}
            </span>
            <label>推定サイズ</label>
            <span>{formatBytes(((bitrate + 192000) / 8) * dur)}</span>
          </div>
          <p className="ec-note">書き出しはリアルタイムで行われます（シーケンスと同じ長さの時間がかかります）。書き出し中はこのタブを前面に表示したままにしてください。</p>
          {busy && (
            <div className="progress">
              <div className="progress-bar" style={{ width: `${(progress ?? 0) * 100}%` }} />
              <span>{Math.round((progress ?? 0) * 100)}%</span>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {result && (
            <p className="success">
              書き出しが完了しました（{formatBytes(result.size)}）。{' '}
              <a href={result.url} download={result.name}>
                もう一度ダウンロード
              </a>
            </p>
          )}
          <div className="modal-actions">
            {busy ? (
              <button className="btn" onClick={() => abortRef.current?.abort()}>
                キャンセル
              </button>
            ) : (
              <>
                <button className="btn" onClick={close}>
                  閉じる
                </button>
                <button className="btn primary" onClick={start} disabled={dur <= 0}>
                  書き出し
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

const PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'フル HD 1080p (16:9)', w: 1920, h: 1080 },
  { label: 'HD 720p (16:9)', w: 1280, h: 720 },
  { label: '4K UHD (16:9)', w: 3840, h: 2160 },
  { label: '縦型 1080×1920 (9:16) ショート / リール', w: 1080, h: 1920 },
  { label: '正方形 1080×1080 (1:1)', w: 1080, h: 1080 },
  { label: '4:5 1080×1350 (Instagram)', w: 1080, h: 1350 },
];

export function SequenceDialog() {
  const seq = useStore((s) => s.project.sequence);
  const name = useStore((s) => s.project.name);
  const [w, setW] = useState(seq.width);
  const [h, setH] = useState(seq.height);
  const [fps, setFps] = useState(seq.fps);
  const [bg, setBg] = useState(seq.background);
  const [n, setN] = useState(name);
  return (
    <Modal title="シーケンス設定" onClose={close}>
      <div className="form-grid">
        <label>名前</label>
        <input value={n} onChange={(e) => setN(e.target.value)} />
        <label>プリセット</label>
        <select
          value=""
          onChange={(e) => {
            const p = PRESETS[parseInt(e.target.value)];
            if (p) {
              setW(p.w);
              setH(p.h);
            }
          }}
        >
          <option value="">選択…</option>
          {PRESETS.map((p, i) => (
            <option key={i} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <label>フレームサイズ</label>
        <span className="row-inputs">
          <input type="number" value={w} min={16} max={7680} step={2} onChange={(e) => setW(parseInt(e.target.value) || 0)} />
          ×
          <input type="number" value={h} min={16} max={4320} step={2} onChange={(e) => setH(parseInt(e.target.value) || 0)} />
        </span>
        <label>フレームレート</label>
        <select value={fps} onChange={(e) => setFps(parseInt(e.target.value))}>
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f}>
              {f} fps
            </option>
          ))}
        </select>
        <label>背景色</label>
        <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={close}>
          キャンセル
        </button>
        <button
          className="btn primary"
          onClick={() => {
            const even = (x: number) => Math.max(16, Math.round(x / 2) * 2);
            setSequence({ width: even(w), height: even(h), fps, background: bg });
            if (n !== getState().project.name) renameProject(n);
            close();
          }}
        >
          OK
        </button>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', '再生 / 停止'],
  ['K / L / J', '停止 / 再生 / 5 秒戻る'],
  ['← / →', '1 フレーム移動（Shift で 5 フレーム）'],
  ['↑ / ↓', '前 / 次の編集点へ移動'],
  ['Home / End', 'シーケンスの先頭 / 末尾'],
  ['V', '選択ツール'],
  ['C', 'レーザーツール（Shift+クリックで全トラック分割）'],
  ['H', '手のひらツール'],
  ['Ctrl+K', '再生ヘッドで分割（編集点を追加）'],
  ['Q / W', '再生ヘッドまでリップルトリム（前 / 後）'],
  ['Delete', '消去'],
  ['Shift+Delete', 'リップル削除'],
  ['Ctrl+C / X / V', 'コピー / カット / ペースト'],
  ['Ctrl+D', '複製'],
  ['Ctrl+A', 'すべて選択'],
  ['Shift+E', 'クリップの有効 / 無効'],
  ['Ctrl+Z / Ctrl+Shift+Z', '取り消し / やり直し'],
  ['M', 'マーカーを追加'],
  ['S', 'スナップの切り替え'],
  ['+ / - / \\', 'ズームイン / ズームアウト / 全体表示'],
  ['I / O', 'ソースモニターでイン / アウト'],
  [', / .', 'ソースからインサート / 上書き'],
  ['T', 'テキストを追加'],
  ['Ctrl+I', 'メディアを読み込み'],
  ['Ctrl+M', '書き出し'],
  ['Alt+ドラッグ', 'リンクを無視して片方だけ操作 / スナップ無効'],
  ['Ctrl+ホイール', 'タイムラインのズーム'],
];

export function ShortcutsDialog() {
  return (
    <Modal title="キーボードショートカット" onClose={close} wide>
      <div className="shortcut-grid">
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} className="shortcut-row">
            <kbd>{k}</kbd>
            <span>{d}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function AboutDialog() {
  return (
    <Modal title="VVV Editor について" onClose={close}>
      <p>ブラウザだけで動くノンリニア動画編集ソフトです。素材はアップロードされず、すべてお使いのコンピューター内で処理されます。</p>
      <ul className="about-list">
        <li>マルチトラックのタイムライン（映像・音声・テキスト・カラーマット）</li>
        <li>ソースモニター（イン / アウト、インサート / 上書き）</li>
        <li>キーフレームアニメーション、カラー補正、描画モード</li>
        <li>トランジション、オーディオフェード、速度変更</li>
        <li>プロジェクトの自動保存（IndexedDB）</li>
        <li>MP4 / WebM 書き出し</li>
      </ul>
    </Modal>
  );
}
