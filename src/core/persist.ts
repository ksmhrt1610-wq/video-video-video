import type { Project } from './types';
import { getBlob } from './media';

const DB_NAME = 'vvv-editor';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('project')) db.createObjectStore('project');
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openDB());

const savedMedia = new Set<string>();

/** プロジェクトとメディア本体を IndexedDB に保存 */
export async function saveProject(p: Project): Promise<void> {
  const d = await db();
  for (const m of p.media) {
    if (savedMedia.has(m.id)) continue;
    const blob = getBlob(m.id);
    if (!blob) continue;
    await tx(d, 'media', 'readwrite', (s) => s.put(blob, m.id));
    savedMedia.add(m.id);
  }
  const serializable = { ...p, media: p.media.map((m) => ({ ...m, url: '' })) };
  await tx(d, 'project', 'readwrite', (s) => s.put(serializable, 'current'));
  // 使われなくなったメディアを削除
  const keys = (await tx(d, 'media', 'readonly', (s) => s.getAllKeys())) as string[];
  const live = new Set(p.media.map((m) => m.id));
  for (const k of keys) {
    if (!live.has(k)) {
      await tx(d, 'media', 'readwrite', (s) => s.delete(k));
      savedMedia.delete(k);
    }
  }
}

export async function loadProject(): Promise<{ project: Project; blobs: Map<string, Blob> } | null> {
  const d = await db();
  const project = (await tx(d, 'project', 'readonly', (s) => s.get('current'))) as Project | undefined;
  if (!project) return null;
  const blobs = new Map<string, Blob>();
  for (const m of project.media) {
    const b = (await tx(d, 'media', 'readonly', (s) => s.get(m.id))) as Blob | undefined;
    if (b) {
      blobs.set(m.id, b);
      savedMedia.add(m.id);
    }
  }
  return { project, blobs };
}

export async function clearSaved(): Promise<void> {
  const d = await db();
  await tx(d, 'project', 'readwrite', (s) => s.clear());
  await tx(d, 'media', 'readwrite', (s) => s.clear());
  savedMedia.clear();
}
