import { useEffect, useRef, useState } from 'react';
import { engine } from '../core/engine';
import { beginGesture, endGesture, getState, preview, setUI, useStore } from '../store';
import { timecode } from '../core/time';
import { sequenceDuration } from '../core/timeline';
import { clipCorners } from '../core/render';
import { getProp, upsertKeyframe } from '../core/props';
import { gotoEdit, gotoEnd, gotoStart, stepFrames, splitAtPlayhead, addMarker, exportFramePng } from '../actions';
import { Icon } from './icons';
import { AudioMeter } from './AudioMeter';

export function ProgramMonitor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const project = useStore((s) => s.project);
  const playhead = useStore((s) => s.ui.playhead);
  const playing = useStore((s) => s.ui.playing);
  const selection = useStore((s) => s.ui.selection);
  const previewScale = useStore((s) => s.ui.previewScale);
  const exporting = useStore((s) => s.ui.exporting);
  const [box, setBox] = useState({ w: 640, h: 360 });
  const { width: W, height: H, fps } = project.sequence;

  useEffect(() => {
    engine.attach(canvasRef.current);
    return () => engine.attach(null);
  }, []);

  // モニターサイズに合わせてフィット
  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const k = Math.min(r.width / W, r.height / H);
      setBox({ w: Math.max(1, Math.floor(W * k)), h: Math.max(1, Math.floor(H * k)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  // 選択クリップのバウンディングボックス
  const selClip = project.clips.find(
    (c) => selection.includes(c.id) && c.kind !== 'audio' && playhead >= c.start && playhead < c.start + c.duration,
  );
  let corners: [number, number][] | null = null;
  if (selClip && !playing) {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) corners = clipCorners(ctx, selClip, playhead - selClip.start, engine, W, H);
  }
  const k = box.w / W;

  const onOverlayPointerDown = (e: React.PointerEvent) => {
    if (!selClip || e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const local = getState().ui.playhead - selClip.start;
    const startX = getProp(selClip, 'x', local);
    const startY = getProp(selClip, 'y', local);
    const id = selClip.id;
    beginGesture();
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / k;
      const dy = (ev.clientY - y0) / k;
      preview((p) => ({
        ...p,
        clips: p.clips.map((c) => {
          if (c.id !== id) return c;
          const nx = Math.round(startX + dx);
          const ny = Math.round(startY + dy);
          const tol = 0.5 / p.sequence.fps;
          const keyframes = { ...c.keyframes };
          const props = { ...c.props };
          if (keyframes.x?.length) keyframes.x = upsertKeyframe(keyframes.x, local, nx, tol);
          else props.x = nx;
          if (keyframes.y?.length) keyframes.y = upsertKeyframe(keyframes.y, local, ny, tol);
          else props.y = ny;
          return { ...c, props, keyframes };
        }),
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      endGesture();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onMonitorClick = (e: React.PointerEvent) => {
    // クリックした位置にある最前面のクリップを選択
    if (playing || e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = (e.clientX - rect.left) / k;
    const py = (e.clientY - rect.top) / k;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { project: p, ui } = getState();
    const order = p.tracks.filter((t) => t.kind === 'video' && !t.hidden);
    for (const tr of order) {
      const c = p.clips.find((x) => x.trackId === tr.id && ui.playhead >= x.start && ui.playhead < x.start + x.duration && !x.disabled);
      if (!c) continue;
      const cs = clipCorners(ctx, c, ui.playhead - c.start, engine, p.sequence.width, p.sequence.height);
      if (cs && pointInPoly(px, py, cs)) {
        setUI({ selection: [c.id], topLeftTab: 'effectControls' });
        return;
      }
    }
  };

  const dur = sequenceDuration(project);

  return (
    <div className="panel monitor program-monitor">
      <div className="panel-tabs">
        <div className="panel-tab active">プログラム: {project.name}</div>
        <div className="spacer" />
        <select
          className="mini-select"
          value={previewScale}
          onChange={(e) => setUI({ previewScale: parseFloat(e.target.value) })}
          title="再生時の解像度"
        >
          <option value={1}>フル画質</option>
          <option value={0.5}>1/2</option>
          <option value={0.25}>1/4</option>
        </select>
      </div>
      <div className="monitor-body">
        <div className="monitor-stage" ref={wrapRef}>
          <div className="monitor-frame" style={{ width: box.w, height: box.h }} onPointerDown={onMonitorClick}>
            <canvas ref={canvasRef} className="monitor-canvas" style={{ width: box.w, height: box.h }} />
            {corners && (
              <svg ref={overlayRef} className="monitor-overlay" width={box.w} height={box.h}>
                <polygon
                  points={corners.map(([x, y]) => `${x * k},${y * k}`).join(' ')}
                  className="sel-box"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onOverlayPointerDown(e);
                  }}
                />
                {corners.map(([x, y], i) => (
                  <rect key={i} x={x * k - 4} y={y * k - 4} width={8} height={8} className="sel-handle" />
                ))}
                <circle cx={(corners[0][0] + corners[2][0]) / 2 * k} cy={(corners[0][1] + corners[2][1]) / 2 * k} r={5} className="sel-anchor" />
              </svg>
            )}
            {exporting && <div className="monitor-badge">書き出し中…</div>}
          </div>
        </div>
        <AudioMeter />
      </div>
      <div className="monitor-footer">
        <span className="timecode accent">{timecode(playhead, fps)}</span>
        <div className="transport">
          <button className="icon-btn" title="マーカーを追加 (M)" onClick={addMarker}>{Icon.marker()}</button>
          <button className="icon-btn" title="前の編集点へ (↑)" onClick={() => gotoEdit(-1)}>{Icon.toStart()}</button>
          <button className="icon-btn" title="1 フレーム戻る (←)" onClick={() => stepFrames(-1)}>{Icon.stepBack()}</button>
          <button className="icon-btn play" title="再生 / 停止 (Space)" onClick={() => engine.toggle()} disabled={exporting}>
            {playing ? Icon.pause(18) : Icon.play(18)}
          </button>
          <button className="icon-btn" title="1 フレーム進む (→)" onClick={() => stepFrames(1)}>{Icon.stepFwd()}</button>
          <button className="icon-btn" title="次の編集点へ (↓)" onClick={() => gotoEdit(1)}>{Icon.toEnd()}</button>
          <button className="icon-btn" title="再生ヘッドで分割 (Ctrl+K)" onClick={splitAtPlayhead}>{Icon.razor()}</button>
          <button className="icon-btn" title="フレームを書き出し (PNG)" onClick={exportFramePng}>{Icon.camera()}</button>
        </div>
        <span className="timecode muted" title="シーケンスの長さ" onClick={gotoEnd} onDoubleClick={gotoStart}>
          {timecode(dur, fps)}
        </span>
      </div>
    </div>
  );
}

function pointInPoly(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
