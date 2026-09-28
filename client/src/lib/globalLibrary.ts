import type { StylePreset } from './types';
import { fetchJson } from './http';

export interface GlobalStyleEntry {
  id: number;
  name: string;
  style: StylePreset;
  preview: string | null;
  created_at: string;
}

export async function fetchGlobalStyles(): Promise<GlobalStyleEntry[]> {
  const { styles } = await fetchJson<{ styles: GlobalStyleEntry[] }>('/api/global-styles', undefined, 'Global library unavailable');
  return styles;
}

export async function saveToGlobalLibrary(name: string, style: StylePreset, preview: string): Promise<void> {
  await fetchJson(
    '/api/global-styles',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, style, preview }) },
    'Could not save to the global library',
  );
}

export async function deleteGlobalStyle(id: number): Promise<void> {
  await fetchJson(`/api/global-styles/${id}`, { method: 'DELETE' }, 'Could not delete');
}
