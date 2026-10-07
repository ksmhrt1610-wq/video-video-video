import type { ReactNode } from 'react';

const svg = (children: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const Icon = {
  play: (s?: number) => svg(<path d="M7 4l13 8-13 8z" fill="currentColor" />, s),
  pause: (s?: number) => svg(<><rect x="6" y="4" width="4" height="16" fill="currentColor" /><rect x="14" y="4" width="4" height="16" fill="currentColor" /></>, s),
  stepBack: (s?: number) => svg(<><path d="M18 5l-9 7 9 7z" fill="currentColor" /><line x1="6" y1="5" x2="6" y2="19" /></>, s),
  stepFwd: (s?: number) => svg(<><path d="M6 5l9 7-9 7z" fill="currentColor" /><line x1="18" y1="5" x2="18" y2="19" /></>, s),
  toStart: (s?: number) => svg(<><path d="M20 5l-8 7 8 7z" fill="currentColor" /><path d="M12 5l-8 7 8 7z" fill="currentColor" /></>, s),
  toEnd: (s?: number) => svg(<><path d="M4 5l8 7-8 7z" fill="currentColor" /><path d="M12 5l8 7-8 7z" fill="currentColor" /></>, s),
  select: (s?: number) => svg(<path d="M5 3l14 8-6 2-3 6z" fill="currentColor" />, s),
  razor: (s?: number) => svg(<><path d="M4 20L20 4" /><path d="M14 4h6v6" /><circle cx="6" cy="18" r="2" /></>, s),
  hand: (s?: number) => svg(<path d="M8 13V5a1.5 1.5 0 013 0v6m0-1V4a1.5 1.5 0 013 0v7m0-5a1.5 1.5 0 013 0v7m0-4a1.5 1.5 0 013 0v5a7 7 0 01-7 7h-1a7 7 0 01-6-3l-3-5a1.5 1.5 0 012.5-1.5L8 15" />, s),
  text: (s?: number) => svg(<><path d="M5 5h14" /><path d="M12 5v14" /></>, s),
  eye: (s?: number) => svg(<><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></>, s),
  eyeOff: (s?: number) => svg(<><path d="M17.9 17.9A10 10 0 0112 20c-7 0-11-8-11-8a18 18 0 015-6M9.9 4.2A9 9 0 0112 4c7 0 11 8 11 8a18 18 0 01-2.2 3.2" /><line x1="1" y1="1" x2="23" y2="23" /></>, s),
  speaker: (s?: number) => svg(<><path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" /><path d="M15.5 8.5a5 5 0 010 7" /></>, s),
  mute: (s?: number) => svg(<><path d="M11 5L6 9H2v6h4l5 4z" fill="currentColor" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></>, s),
  lock: (s?: number) => svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>, s),
  unlock: (s?: number) => svg(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.5-2" /></>, s),
  magnet: (s?: number) => svg(<><path d="M6 3v8a6 6 0 0012 0V3" /><path d="M6 7h4M14 7h4" /></>, s),
  link: (s?: number) => svg(<><path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1" /><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" /></>, s),
  marker: (s?: number) => svg(<path d="M6 3h12v14l-6 4-6-4z" fill="currentColor" />, s),
  plus: (s?: number) => svg(<><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, s),
  trash: (s?: number) => svg(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>, s),
  import: (s?: number) => svg(<><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" /></>, s),
  stopwatch: (s?: number) => svg(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2" /><path d="M9 2h6" /></>, s),
  diamond: (s?: number) => svg(<path d="M12 3l8 9-8 9-8-9z" fill="currentColor" />, s),
  chevronLeft: (s?: number) => svg(<path d="M15 6l-6 6 6 6" />, s),
  chevronRight: (s?: number) => svg(<path d="M9 6l6 6-6 6" />, s),
  reset: (s?: number) => svg(<><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4" /><path d="M3 3v5h5" /></>, s),
  markIn: (s?: number) => svg(<><path d="M8 4v16" /><path d="M8 4h6M8 20h6" /></>, s),
  markOut: (s?: number) => svg(<><path d="M16 4v16" /><path d="M16 4h-6M16 20h-6" /></>, s),
  insert: (s?: number) => svg(<><rect x="3" y="7" width="7" height="10" /><rect x="14" y="7" width="7" height="10" /><path d="M12 3v18" /></>, s),
  overwrite: (s?: number) => svg(<><rect x="3" y="7" width="18" height="10" /><path d="M8 7v10M16 7v10" /></>, s),
  camera: (s?: number) => svg(<><path d="M4 7h3l2-3h6l2 3h3a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z" /><circle cx="12" cy="13" r="4" /></>, s),
  film: (s?: number) => svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M7 3v18M17 3v18M3 8h4M3 16h4M17 8h4M17 16h4" /></>, s),
  music: (s?: number) => svg(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>, s),
  image: (s?: number) => svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>, s),
};
