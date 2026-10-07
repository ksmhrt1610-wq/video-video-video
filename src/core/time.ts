/** 秒 → HH:MM:SS:FF */
export function timecode(sec: number, fps: number): string {
  const totalFrames = Math.round(Math.max(0, sec) * fps);
  const f = totalFrames % fps;
  const s = Math.floor(totalFrames / fps);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}:${pad(f)}`;
}

/** HH:MM:SS:FF / MM:SS / 秒数 の文字列を秒へ */
export function parseTimecode(text: string, fps: number): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const parts = t.split(/[:;.]/).map((x) => parseInt(x, 10));
  if (parts.some((x) => Number.isNaN(x))) return null;
  while (parts.length < 4) parts.unshift(0);
  const [h, m, s, f] = parts.slice(-4);
  return h * 3600 + m * 60 + s + f / fps;
}

export function snapToFrame(t: number, fps: number): number {
  return Math.round(t * fps) / fps;
}

export function shortDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
