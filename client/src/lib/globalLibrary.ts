import type { StylePreset } from './types';

export interface GlobalStyleEntry {
  id: number;
  name: string;
  style: StylePreset;
  preview: string | null;
  created_at: string;
}

export async function fetchGlobalStyles(): Promise<GlobalStyleEntry[]> {
  const r = await fetch('/api/global-styles');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Global library unavailable');
  const { styles } = await r.json();
  return styles;
}

export async function saveToGlobalLibrary(name: string, style: StylePreset, preview: string): Promise<void> {
  const r = await fetch('/api/global-styles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, style, preview }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save to the global library');
}

export async function deleteGlobalStyle(id: number): Promise<void> {
  const r = await fetch(`/api/global-styles/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not delete');
}
