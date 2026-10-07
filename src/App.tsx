import { useEffect, useState } from 'react';
import { setUI, subscribe, useStore, type BottomLeftTab, type TopLeftTab, type Tool } from './store';
import { MenuBar } from './components/MenuBar';
import { ProjectPanel } from './components/ProjectPanel';
import { EffectsPanel, GraphicsPanel } from './components/EffectsPanel';
import { EffectControls } from './components/EffectControls';
import { SourceMonitor } from './components/SourceMonitor';
import { ProgramMonitor } from './components/ProgramMonitor';
import { Timeline } from './components/Timeline';
import { ContextMenuHost } from './components/ContextMenu';
import { AboutDialog, ExportDialog, SequenceDialog, ShortcutsDialog } from './components/Dialogs';
import { Icon } from './components/icons';
import { installShortcuts } from './shortcuts';
import { addText, restoreProject, startAutosave } from './actions';

const LAYOUT_KEY = 'vvv-layout';
interface Layout {
  topH: number;
  topLeftW: number;
  bottomLeftW: number;
}

function loadLayout(): Layout {
  const def = { topH: 0.55, topLeftW: 0.38, bottomLeftW: 0.26 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') };
  } catch {
    return def;
  }
}

export function App() {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const dialog = useStore((s) => s.ui.dialog);
  const toastMsg = useStore((s) => s.ui.toast);

  useEffect(() => {
    const off1 = installShortcuts();
    const off2 = startAutosave(subscribe);
    restoreProject();
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      off1();
      off2();
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    } catch {
      /* ストレージが使えない環境 */
    }
  }, [layout]);

  const drag = (key: keyof Layout, axis: 'x' | 'y') => (e: React.PointerEvent) => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement!;
    const rect = container.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const v = axis === 'x' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      setLayout((l) => ({ ...l, [key]: Math.min(0.85, Math.max(0.12, v)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="app">
      <MenuBar />
      <div className="workspace" style={{ gridTemplateRows: `${layout.topH * 100}% 5px 1fr` }}>
        <div className="row" style={{ gridTemplateColumns: `${layout.topLeftW * 100}% 5px 1fr` }}>
          <TopLeftPanel />
          <div className="splitter v" onPointerDown={drag('topLeftW', 'x')} />
          <ProgramMonitor />
        </div>
        <div className="splitter h" onPointerDown={drag('topH', 'y')} />
        <div className="row" style={{ gridTemplateColumns: `${layout.bottomLeftW * 100}% 5px 1fr` }}>
          <BottomLeftPanel />
          <div className="splitter v" onPointerDown={drag('bottomLeftW', 'x')} />
          <div className="panel timeline-panel">
            <ToolStrip />
            <Timeline />
          </div>
        </div>
      </div>
      <ContextMenuHost />
      {dialog === 'export' && <ExportDialog />}
      {dialog === 'sequence' && <SequenceDialog />}
      {dialog === 'shortcuts' && <ShortcutsDialog />}
      {dialog === 'about' && <AboutDialog />}
      {toastMsg && (
        <div className="toast" key={toastMsg.id}>
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

function TopLeftPanel() {
  const tab = useStore((s) => s.ui.topLeftTab);
  const sourceName = useStore((s) => s.project.media.find((m) => m.id === s.ui.sourceMediaId)?.name);
  const tabs: [TopLeftTab, string][] = [
    ['source', `ソース${sourceName ? `: ${sourceName}` : ''}`],
    ['effectControls', 'エフェクトコントロール'],
  ];
  return (
    <div className="panel">
      <div className="panel-tabs">
        {tabs.map(([id, label]) => (
          <div key={id} className={`panel-tab ${tab === id ? 'active' : ''}`} onClick={() => setUI({ topLeftTab: id })}>
            {label}
          </div>
        ))}
      </div>
      <div className="panel-body">
        <div style={{ display: tab === 'source' ? 'contents' : 'none' }}>
          <SourceMonitor />
        </div>
        {tab === 'effectControls' && <EffectControls />}
      </div>
    </div>
  );
}

function BottomLeftPanel() {
  const tab = useStore((s) => s.ui.bottomLeftTab);
  const tabs: [BottomLeftTab, string][] = [
    ['project', 'プロジェクト'],
    ['effects', 'エフェクト'],
    ['graphics', 'グラフィック'],
  ];
  return (
    <div className="panel">
      <div className="panel-tabs">
        {tabs.map(([id, label]) => (
          <div key={id} className={`panel-tab ${tab === id ? 'active' : ''}`} onClick={() => setUI({ bottomLeftTab: id })}>
            {label}
          </div>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'project' && <ProjectPanel />}
        {tab === 'effects' && <EffectsPanel />}
        {tab === 'graphics' && <GraphicsPanel />}
      </div>
    </div>
  );
}

function ToolStrip() {
  const tool = useStore((s) => s.ui.tool);
  const tools: [Tool, string, React.ReactNode][] = [
    ['select', '選択ツール (V)', Icon.select(15)],
    ['razor', 'レーザーツール (C)', Icon.razor(15)],
    ['hand', '手のひらツール (H)', Icon.hand(15)],
  ];
  return (
    <div className="tool-strip">
      {tools.map(([id, title, icon]) => (
        <button key={id} className={`icon-btn tool ${tool === id ? 'active' : ''}`} title={title} onClick={() => setUI({ tool: id })}>
          {icon}
        </button>
      ))}
      <button className="icon-btn tool" title="テキストを追加 (T)" onClick={() => addText('title')}>
        {Icon.text(15)}
      </button>
    </div>
  );
}
