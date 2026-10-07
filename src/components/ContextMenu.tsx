import { useEffect, useState } from 'react';

export interface MenuItem {
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

let setter: ((m: MenuState | null) => void) | null = null;

export function openContextMenu(x: number, y: number, items: MenuItem[]) {
  setter?.({ x, y, items });
}

export function closeContextMenu() {
  setter?.(null);
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  useEffect(() => {
    setter = setMenu;
    return () => {
      setter = null;
    };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  if (!menu) return null;
  const h = menu.items.reduce((s, i) => s + (i.separator ? 9 : 26), 8);
  const x = Math.min(menu.x, window.innerWidth - 250);
  const y = Math.min(menu.y, window.innerHeight - h - 4);
  return (
    <div className="context-menu" style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className="menu-item"
            disabled={it.disabled}
            onClick={() => {
              setMenu(null);
              it.onClick?.();
            }}
          >
            <span className="menu-check">{it.checked ? '✓' : ''}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
