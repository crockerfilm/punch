import type { Chunk, StylePreset, Word } from './types';
import { createOffscreenMeasureCtx, maxLineWidth } from './textMeasure';

/**
 * Groups words into caption chunks with no AI call at all: greedily fills each
 * chunk with words until the next word would overflow one line at the current
 * style's font/size (same 86%-of-frame-width threshold render.ts wraps at), or
 * until a natural speech pause (a gap between words) suggests a new beat.
 * This is the free default; AI grouping is an opt-in upgrade for trickier phrasing.
 */
export function autoChunkByFit(words: Word[], style: StylePreset, frameWidth: number): Chunk[] {
  if (!words.length) return [];

  const ctx = createOffscreenMeasureCtx(style);
  const maxLineW = maxLineWidth(frameWidth);
  const PAUSE_SEC = 0.5;
  const display = (w: string) => (style.caps ? w.toUpperCase() : w);
  const measure = (s: string) => ctx.measureText(s).width;

  const chunks: Chunk[] = [];
  let cur: Word[] = [];

  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      text: cur.map(w => w.word).join(' '),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      words: cur.map(w => ({ ...w, emphasis: false })),
    });
    cur = [];
  };

  for (const w of words) {
    const pause = cur.length ? w.start - cur[cur.length - 1].end : 0;
    const testLine = [...cur, w].map(x => display(x.word)).join(' ');
    const overflows = cur.length > 0 && measure(testLine) > maxLineW;
    if (overflows || pause > PAUSE_SEC) flush();
    cur.push(w);
  }
  flush();
  return chunks;
}
