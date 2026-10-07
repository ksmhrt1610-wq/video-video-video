import { useEffect, useRef, useState } from 'react';
import { getState, setUI, useStore } from '../store';
import { timecode } from '../core/time';
import { sourceEdit } from '../actions';
import { Icon } from './icons';

/** ソースモニター: 素材のプレビューとイン／アウト点の設定 */
export function SourceMonitor() {
  const mediaId = useStore((s) => s.ui.sourceMediaId);
  const media = useStore((s) => s.project.media.find((m) => m.id === s.ui.sourceMediaId));
  const marks = useStore((s) => (mediaId ? s.ui.sourceMarks[mediaId] : undefined));
  const fps = useStore((s) => s.project.sequence.fps);
  const videoRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setT(0);
    setPlaying(false);
  }, [mediaId]);

  // ソースモニター用のキーボード操作 (I / O / , / .)
  useEffect(() => {
    const onKey = (e: Event) => {
      const { key } = (e as CustomEvent<{ key: string }>).detail;
      const el = videoRef.current;
      if (!el || !mediaId) return;
      if (key === 'i') setMark('in', el.currentTime);
      if (key === 'o') setMark('out', el.currentTime);
      if (key === 'space') el.paused ? el.play() : el.pause();
    };
    window.addEventListener('vvv:source-key', onKey);
    return () => window.removeEventListener('vvv:source-key', onKey);
  });

  const setMark = (which: 'in' | 'out', v: number | undefined) => {
    if (!mediaId) return;
    const s = getState().ui.sourceMarks;
    setUI({ sourceMarks: { ...s, [mediaId]: { ...s[mediaId], [which]: v } } });
  };

  if (!media) {
    return (
      <div className="empty-hint">
        <p>プロジェクトパネルの素材をダブルクリックすると、ここでプレビューしてイン点・アウト点を設定できます。</p>
      </div>
    );
  }

  const dur = media.duration || 0;
  const inP = marks?.in ?? 0;
  const outP = marks?.out ?? dur;

  const seek = (v: number) => {
    const el = videoRef.current;
    if (el) el.currentTime = v;
    setT(v);
  };

  return (
    <div className="source-monitor">
      <div className="monitor-stage source-stage">
        {media.type === 'video' && (
          <video
            ref={videoRef}
            src={media.url}
            className="source-video"
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play() : e.currentTarget.pause())}
          />
        )}
        {media.type === 'audio' && (
          <div className="source-audio">
            {Icon.music(64)}
            <div>{media.name}</div>
            <audio
              ref={videoRef}
              src={media.url}
              onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
          </div>
        )}
        {media.type === 'image' && <img src={media.url} className="source-video" alt={media.name} />}
      </div>
      {media.type !== 'image' && (
        <div
          className="source-scrubber"
          onPointerDown={(e) => {
            const el = e.currentTarget;
            const update = (cx: number) => {
              const r = el.getBoundingClientRect();
              seek(Math.min(dur, Math.max(0, ((cx - r.left) / r.width) * dur)));
            };
            update(e.clientX);
            const mv = (ev: PointerEvent) => update(ev.clientX);
            const up = () => {
              window.removeEventListener('pointermove', mv);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', mv);
            window.addEventListener('pointerup', up);
          }}
        >
          <div className="source-range" style={{ left: `${(inP / dur) * 100}%`, width: `${((outP - inP) / dur) * 100}%` }} />
          <div className="source-head" style={{ left: `${(t / dur) * 100}%` }} />
        </div>
      )}
      <div className="monitor-footer">
        <span className="timecode accent">{timecode(t, fps)}</span>
        <div className="transport">
          {media.type !== 'image' && (
            <>
              <button className="icon-btn" title="インをマーク (I)" onClick={() => setMark('in', t)}>{Icon.markIn()}</button>
              <button className="icon-btn" title="アウトをマーク (O)" onClick={() => setMark('out', t)}>{Icon.markOut()}</button>
              <button className="icon-btn" title="1 フレーム戻る" onClick={() => seek(Math.max(0, t - 1 / fps))}>{Icon.stepBack()}</button>
              <button
                className="icon-btn play"
                title="再生 / 停止"
                onClick={() => {
                  const el = videoRef.current;
                  if (el) el.paused ? el.play() : el.pause();
                }}
              >
                {playing ? Icon.pause(18) : Icon.play(18)}
              </button>
              <button className="icon-btn" title="1 フレーム進む" onClick={() => seek(Math.min(dur, t + 1 / fps))}>{Icon.stepFwd()}</button>
            </>
          )}
          <button className="icon-btn" title="インサート (,)" onClick={() => sourceEdit('insert')}>{Icon.insert()}</button>
          <button className="icon-btn" title="上書き (.)" onClick={() => sourceEdit('overwrite')}>{Icon.overwrite()}</button>
        </div>
        <span className="timecode muted" title="イン〜アウトの長さ">
          {media.type === 'image' ? '静止画' : timecode(outP - inP, fps)}
        </span>
      </div>
      <div
        className="source-drag"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-vvv-media', media.id);
          e.dataTransfer.setData('application/x-vvv-source', '1');
          e.dataTransfer.effectAllowed = 'copy';
        }}
        title="イン〜アウトの範囲をタイムラインへドラッグ"
      >
        ⠿ {media.name}
      </div>
    </div>
  );
}
