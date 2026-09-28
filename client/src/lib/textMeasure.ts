import type { StylePreset } from './types';

/** The single source of truth for the caption font string and the line-wrap width
 * threshold — render.ts (actual drawing) and autoChunk.ts (deciding chunk boundaries by
 * whether a line would need to wrap) both measure text against these same two things, and
 * previously each duplicated its own copy, which meant a tweak to one silently stopped
 * matching the other. */

export function setMeasureFont(ctx: CanvasRenderingContext2D, style: Pick<StylePreset, 'font' | 'size'>) {
  ctx.font = `900 ${style.size}px "${style.font}", sans-serif`;
}

export function maxLineWidth(frameWidth: number) {
  return frameWidth * 0.86;
}

/** A throwaway canvas/ctx for measurement only, for callers (like the auto-chunker) that
 * don't already have a real drawing context to reuse. */
export function createOffscreenMeasureCtx(style: Pick<StylePreset, 'font' | 'size'>): CanvasRenderingContext2D {
  const ctx = document.createElement('canvas').getContext('2d')!;
  setMeasureFont(ctx, style);
  return ctx;
}
