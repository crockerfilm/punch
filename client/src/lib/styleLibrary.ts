import type { StylePreset } from './types';

export interface SavedStyle {
  id: string;
  name: string;
  savedAt: number;
  style: StylePreset;
}

const KEY = 'punch:styleLibrary';

export function listSavedStyles(): SavedStyle[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveStyleToLibrary(name: string, style: StylePreset): SavedStyle {
  const entry: SavedStyle = { id: crypto.randomUUID(), name, savedAt: Date.now(), style };
  const all = listSavedStyles();
  all.unshift(entry);
  localStorage.setItem(KEY, JSON.stringify(all));
  return entry;
}

export function deleteSavedStyle(id: string) {
  const all = listSavedStyles().filter(s => s.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function downloadStyle(name: string, style: StylePreset, filenameStem?: string) {
  const blob = new Blob([JSON.stringify({ name, style }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stem = (filenameStem || name).replace(/[^a-z0-9_-]+/gi, '-') || 'style';
  a.href = url;
  a.download = `${stem}_style.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadStyleFromFile(file: File): Promise<{ name: string; style: StylePreset }> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!parsed.style) throw new Error('Not a valid style file');
  return { name: parsed.name || file.name.replace(/\.[^.]+$/, ''), style: parsed.style };
}
