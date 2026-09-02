import JSZip from 'jszip';
import type { Chunk, StylePreset } from './types';
import { drawFrame } from './render';

export interface ExportProgress {
  (pct: number, label: string): void;
}

/**
 * True-alpha export: renders a PNG sequence + a zip, since browser video codecs
 * (VP9/H.264 in WebM/MP4 via MediaRecorder/WebCodecs) do not reliably preserve
 * alpha end-to-end. The PNG sequence is what After Effects / Premiere import
 * as an image sequence with real transparency. A "preview MP4" (black bg,
 * Screen blend mode) is offered alongside for a quick drag-in.
 */
export async function exportPngSequence(
  chunks: Chunk[],
  style: StylePreset,
  duration: number,
  width: number,
  height: number,
  fps: number,
  onProgress: ExportProgress,
): Promise<Blob> {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d', { alpha: true })!;

  const zip = new JSZip();
  const total = Math.ceil(duration * fps);

  for (let i = 0; i < total; i++) {
    const t = i / fps;
    drawFrame(ctx, cv, chunks, style, t);
    const blob: Blob = await new Promise(resolve => cv.toBlob(b => resolve(b!), 'image/png'));
    const name = `frame_${String(i).padStart(5, '0')}.png`;
    zip.file(name, blob);
    if (i % 5 === 0) {
      onProgress(Math.round((i / total) * 100), `Rendering frame ${i}/${total}`);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  onProgress(100, 'Zipping...');
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

/** Fast preview export: black background + Screen blend note, real MP4 via WebCodecs. */
export async function exportPreviewMp4(
  chunks: Chunk[],
  style: StylePreset,
  duration: number,
  width: number,
  height: number,
  fps: number,
  onProgress: ExportProgress,
): Promise<Blob> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d')!;

  const bitrate = Math.max(2_000_000, Math.min(10_000_000, width * height * fps * 0.08));
  const codecs = ['avc1.4D401E', 'avc1.4D4028', 'avc1.640028', 'avc1.42E01E', 'avc1.42001E'];
  let chosenCodec: string | null = null;
  for (const c of codecs) {
    try {
      const sup = await (VideoEncoder as any).isConfigSupported({ codec: c, width, height, bitrate, framerate: fps });
      if (sup.supported) { chosenCodec = c; break; }
    } catch { /* try next */ }
  }
  if (!chosenCodec) throw new Error('No supported H.264 codec in this browser');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: 'in-memory' });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => { throw e; },
  });
  encoder.configure({ codec: chosenCodec, width, height, bitrate, framerate: fps });

  const total = Math.ceil(duration * fps);
  for (let i = 0; i < total; i++) {
    const t = i / fps;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    drawFrame(ctx, cv, chunks, style, t);
    const vf = new VideoFrame(cv, { timestamp: i * Math.round(1_000_000 / fps), duration: Math.round(1_000_000 / fps) });
    encoder.encode(vf);
    vf.close();
    if (i % 10 === 0) {
      onProgress(Math.round((i / total) * 100), `Encoding ${i}/${total}`);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  muxer.finalize();
  encoder.close();
  return new Blob([target.buffer], { type: 'video/mp4' });
}

/**
 * True native alpha, the Premiere-friendly way: browsers can't encode ProRes or any
 * alpha-capable H.264/HEVC themselves (WebCodecs only exposes alpha for VP9/WebM,
 * which Premiere handles inconsistently at best) — so this renders the same PNG
 * sequence as exportPngSequence, then hands it to the server to encode into a real
 * ProRes 4444 .mov (codec tag ap4h) via ffmpeg. Drops into a Premiere timeline like
 * any other native clip, transparency included.
 */
export async function exportProResAlpha(
  chunks: Chunk[],
  style: StylePreset,
  duration: number,
  width: number,
  height: number,
  fps: number,
  onProgress: ExportProgress,
): Promise<Blob> {
  const zipBlob = await exportPngSequence(chunks, style, duration, width, height, fps, (pct, label) => {
    onProgress(Math.round(pct * 0.7), label);
  });
  onProgress(75, 'Encoding ProRes 4444 on server…');
  const form = new FormData();
  form.append('frames', zipBlob, 'frames.zip');
  form.append('fps', String(fps));
  const r = await fetch('/api/export-prores', { method: 'POST', body: form });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: 'ProRes export failed' }));
    throw new Error(err.error || 'ProRes export failed');
  }
  onProgress(100, 'Done');
  return r.blob();
}
