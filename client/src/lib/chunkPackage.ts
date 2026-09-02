import type { Chunk, Word } from './types';

export interface ChunkPackage {
  videoName: string;
  duration: number;
  words: Word[];
  chunks: Chunk[];
}

export function downloadChunks(pkg: ChunkPackage, filenameStem?: string) {
  const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const raw = filenameStem || pkg.videoName || 'captions';
  const stem = raw.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || 'captions';
  a.href = url;
  a.download = `${stem}_chunks.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function loadChunksFromFile(file: File): Promise<ChunkPackage> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed.chunks)) throw new Error('Not a valid chunks file');
  return {
    videoName: parsed.videoName || '',
    duration: parsed.duration || 0,
    words: Array.isArray(parsed.words) ? parsed.words : [],
    chunks: parsed.chunks,
  };
}
