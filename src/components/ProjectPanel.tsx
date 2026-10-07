import { useRef, useState, useSyncExternalStore } from 'react';
import { setUI, useStore } from '../store';
import { analysisVersion, getAnalysis, subscribeAnalysis } from '../core/media';
import { formatBytes, shortDuration } from '../core/time';
import { appendToTimeline, importFiles, removeMedia } from '../actions';
import { Icon } from './icons';
import { openContextMenu } from './ContextMenu';

export function ProjectPanel() {
  const media = useStore((s) => s.project.media);
  const clips = useStore((s) => s.project.clips);
  const sourceId = useStore((s) => s.ui.sourceMediaId);
  useSyncExternalStore(subscribeAnalysis, analysisVersion);
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const shown = media.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
  const openInSource = (id: string) => setUI({ sourceMediaId: id, topLeftTab: 'source' });

  return (
    <div
      className={`project-panel ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
      }}
    >
      <div className="pp-toolbar">
        <input className="search" placeholder="🔍 検索" value={filter} onChange={(e) => setFilter(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button className={`icon-btn small ${view === 'list' ? 'active' : ''}`} title="リスト表示" onClick={() => setView('list')}>≣</button>
        <button className={`icon-btn small ${view === 'grid' ? 'active' : ''}`} title="アイコン表示" onClick={() => setView('grid')}>▦</button>
        <button className="btn primary small" onClick={() => inputRef.current?.click()} title="メディアを読み込み (Ctrl+I)">
          {Icon.import(13)} 読み込み
        </button>
        <input
          ref={inputRef}
          id="vvv-import-input"
          type="file"
          multiple
          accept="video/*,audio/*,image/*,.mkv,.mov"
          hidden
          onChange={(e) => {
            if (e.target.files) importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {media.length === 0 ? (
        <div className="empty-hint drop-zone" onClick={() => inputRef.current?.click()}>
          {Icon.import(36)}
          <p>
            動画・音声・画像ファイルをここにドロップ
            <br />
            またはクリックして読み込み
          </p>
        </div>
      ) : (
        <div className={`pp-items ${view}`}>
          {shown.map((m) => {
            const a = getAnalysis(m.id);
            const thumb = a?.thumbnails[Math.min(1, (a?.thumbnails.length ?? 1) - 1)]?.url;
            const used = clips.some((c) => c.mediaId === m.id);
            return (
              <div
                key={m.id}
                className={`pp-item ${sourceId === m.id ? 'active' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-vvv-media', m.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDoubleClick={() => openInSource(m.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openContextMenu(e.clientX, e.clientY, [
                    { label: 'ソースモニターで開く', onClick: () => openInSource(m.id) },
                    { label: 'タイムラインの末尾に追加', onClick: () => appendToTimeline(m.id) },
                    { separator: true },
                    { label: '削除', onClick: () => removeMedia(m.id) },
                  ]);
                }}
                title={`${m.name}\n${m.width ? `${m.width}×${m.height} ・ ` : ''}${m.type === 'image' ? '静止画' : shortDuration(m.duration)} ・ ${formatBytes(m.size)}\nダブルクリックでソースモニターに表示`}
              >
                <div className="pp-thumb">
                  {thumb ? <img src={thumb} alt="" draggable={false} /> : <div className="pp-icon">{m.type === 'audio' ? Icon.music(28) : m.type === 'image' ? Icon.image(28) : Icon.film(28)}</div>}
                  {m.type !== 'image' && <span className="pp-dur">{shortDuration(m.duration)}</span>}
                  <span className={`pp-type ${m.type}`}>{m.type === 'video' ? (m.hasAudio ? '🎞🔊' : '🎞') : m.type === 'audio' ? '🔊' : '🖼'}</span>
                  <button
                    className="pp-add"
                    title="タイムラインの末尾に追加"
                    onClick={(e) => {
                      e.stopPropagation();
                      appendToTimeline(m.id);
                    }}
                  >
                    {Icon.plus(14)}
                  </button>
                </div>
                <div className={`pp-name ${used ? 'used' : ''}`}>{m.name}</div>
                {view === 'list' && (
                  <div className="pp-meta">
                    {m.width ? `${m.width}×${m.height}` : ''} {formatBytes(m.size)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="pp-footer">{media.length} 個のアイテム</div>
    </div>
  );
}
