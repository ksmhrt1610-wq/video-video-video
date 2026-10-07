import { useEffect, useRef } from 'react';
import { engine } from '../core/engine';

/** マスターのオーディオメーター（L/R） */
export function AudioMeter() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const levels = [0, 0];
    const peaks = [0, 0];
    const peakHold = [0, 0];
    const draw = () => {
      const c = ref.current;
      if (c) {
        const ctx = c.getContext('2d')!;
        const w = c.width;
        const h = c.height;
        const [l, r] = engine.getLevels();
        [l, r].forEach((v, i) => {
          levels[i] = Math.max(v, levels[i] * 0.9);
          if (levels[i] >= peaks[i]) {
            peaks[i] = levels[i];
            peakHold[i] = 40;
          } else if (--peakHold[i] < 0) peaks[i] *= 0.95;
        });
        ctx.clearRect(0, 0, w, h);
        const toY = (v: number) => {
          const db = 20 * Math.log10(Math.max(v, 1e-5));
          const k = Math.min(1, Math.max(0, (db + 60) / 60));
          return h - k * h;
        };
        const bw = (w - 6) / 2;
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, '#1fae4b');
        grad.addColorStop(0.75, '#d6d62a');
        grad.addColorStop(1, '#e33');
        for (let i = 0; i < 2; i++) {
          const x = 2 + i * (bw + 2);
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(x, 0, bw, h);
          const y = toY(levels[i]);
          ctx.fillStyle = grad;
          ctx.fillRect(x, y, bw, h - y);
          const py = toY(peaks[i]);
          ctx.fillStyle = peaks[i] > 0.99 ? '#f44' : '#ddd';
          if (peaks[i] > 1e-4) ctx.fillRect(x, py, bw, 1);
        }
        ctx.fillStyle = '#666';
        for (const db of [-6, -12, -24, -36, -48]) {
          const y = h - ((db + 60) / 60) * h;
          ctx.fillRect(0, y, 2, 1);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="audio-meter" title="オーディオメーター">
      <canvas ref={ref} width={22} height={200} />
      <div className="meter-labels">
        <span>0</span>
        <span>-12</span>
        <span>-24</span>
        <span>-36</span>
        <span>-48</span>
        <span>dB</span>
      </div>
    </div>
  );
}
