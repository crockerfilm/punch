import type { Chunk, Word } from './types';
import { fetchJson } from './http';

export async function transcribeVideo(file: File): Promise<{ words: Word[]; text: string; fps: number }> {
  const form = new FormData();
  form.append('video', file);
  return fetchJson('/api/transcribe', { method: 'POST', body: form }, 'transcribe failed');
}

export async function getVideoInfo(file: File): Promise<{ fps: number; duration: number }> {
  const form = new FormData();
  form.append('video', file);
  return fetchJson('/api/video-info', { method: 'POST', body: form }, 'video info failed');
}

export async function suggestEmphasis(chunks: Chunk[]): Promise<{ chunks: Chunk[] }> {
  return fetchJson(
    '/api/suggest-emphasis',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chunks }) },
    'emphasis suggestion failed',
  );
}
