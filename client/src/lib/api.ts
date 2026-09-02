import type { Chunk, Word } from './types';

export async function transcribeVideo(file: File): Promise<{ words: Word[]; text: string; fps: number }> {
  const form = new FormData();
  form.append('video', file);
  const r = await fetch('/api/transcribe', { method: 'POST', body: form });
  if (!r.ok) throw new Error((await r.json()).error || 'transcribe failed');
  return r.json();
}

export async function suggestEmphasis(chunks: Chunk[]): Promise<{ chunks: Chunk[] }> {
  const r = await fetch('/api/suggest-emphasis', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chunks }),
  });
  if (!r.ok) throw new Error((await r.json()).error || 'emphasis suggestion failed');
  return r.json();
}
