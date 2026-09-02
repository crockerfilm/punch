import type { Chunk, StylePreset } from './types';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Entrance curve: rises 0->1 over p in [0,1]. `bounce` (0-100) controls overshoot —
 * 0 is a plain monotonic ease with no overshoot, 100 is a springy overshoot past 1.
 * `scaleAmount` (100-180) then scales just the portion above 1 (the overshoot bump),
 * independent of how bouncy the curve shape is.
 */
function entranceCurve(p: number, bounce: number, scaleAmount: number) {
  const c1 = (bounce / 100) * 1.70158 * 1.4, c3 = c1 + 1;
  const raw = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  return raw > 1 ? 1 + (raw - 1) * (scaleAmount / 130) : raw;
}
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

export function findActiveChunk(chunks: Chunk[], t: number): Chunk | null {
  for (const c of chunks) if (t >= c.start && t < c.end) return c;
  return null;
}

function yFromPos(cv: HTMLCanvasElement, percent: number) {
  return Math.round(cv.height * (percent / 100));
}

/** Draws one frame. Canvas must be cleared to fully transparent by the caller for alpha export. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cv: HTMLCanvasElement,
  chunks: Chunk[],
  style: StylePreset,
  t: number,
) {
  ctx.clearRect(0, 0, cv.width, cv.height);

  const chunk = findActiveChunk(chunks, t);
  if (!chunk) return;

  const caps = style.caps;
  const y = yFromPos(cv, chunk.placement ?? style.vpos);
  const fontSize = style.size;
  ctx.font = `900 ${fontSize}px "${style.font}", sans-serif`;
  ctx.textBaseline = 'alphabetic';

  // one-word-at-a-time mode: only the word currently being spoken is on screen
  let sourceWords = chunk.words;
  if (style.oneWordMode) {
    let idx = 0;
    for (let i = 0; i < chunk.words.length; i++) {
      if (t >= chunk.words[i].start) idx = i; else break;
    }
    sourceWords = [chunk.words[idx]];
  }

  const words = sourceWords.map(w => ({ ...w, word: caps ? w.word.toUpperCase() : w.word }));
  const measure = (s: string) => ctx.measureText(s).width;
  const x = cv.width / 2;
  const maxLineW = cv.width * 0.86;
  // entrance timing anchors to the word's own start in one-word mode (each word is its own beat),
  // otherwise to the whole chunk's start.
  const entranceAnchor = style.oneWordMode ? words[0].start : chunk.start;

  // greedy word-wrap so long chunks never run off the frame edges
  const lines: (typeof words)[] = [];
  let lineStart = 0;
  for (let i = 1; i <= words.length; i++) {
    const testLine = words.slice(lineStart, i).map(w => w.word).join(' ');
    const overflows = measure(testLine) > maxLineW && i - 1 > lineStart;
    const isLast = i === words.length;
    if (overflows) {
      lines.push(words.slice(lineStart, i - 1));
      lineStart = i - 1;
    } else if (isLast) {
      lines.push(words.slice(lineStart, i));
    }
  }
  const lineWidths = lines.map(line => measure(line.map(w => w.word).join(' ')));
  const fullW = Math.max(...lineWidths);
  const lineHeight = Math.round(fontSize * 1.18);
  const blockH = lines.length * lineHeight;
  // first line's baseline, so the whole block is vertically centered on the anchor y
  const firstBaselineY = y - blockH / 2 + fontSize * 0.85;

  const tIntoChunk = t - entranceAnchor;
  const anim = style.animation;
  const entranceDur = Math.max(0.02, style.animSpeedMs / 1000);

  // whole-group entrance transform (pop / fade / slide-up)
  let groupAlpha = 1, groupScale = 1, groupYOffset = 0;
  if (anim === 'fade') {
    groupAlpha = clamp01(tIntoChunk / entranceDur);
  } else if (anim === 'pop') {
    const p = clamp01(tIntoChunk / entranceDur);
    groupScale = tIntoChunk < entranceDur ? Math.max(0, entranceCurve(p, style.animBounce, style.animScale)) : 1;
    groupAlpha = tIntoChunk < entranceDur * 0.6 ? clamp01(tIntoChunk / (entranceDur * 0.6)) : 1;
  } else if (anim === 'slide-up') {
    const p = clamp01(tIntoChunk / entranceDur);
    groupYOffset = (1 - entranceCurve(p, style.animBounce, style.animScale)) * fontSize * 0.5;
    groupAlpha = p;
  }

  ctx.save();
  ctx.globalAlpha = groupAlpha;
  if (groupScale !== 1 || groupYOffset !== 0) {
    ctx.translate(x, y);
    ctx.scale(groupScale, groupScale);
    ctx.translate(-x, -y + groupYOffset);
  }

  if (style.bg) {
    const padX = Math.round(fontSize * 0.55);
    const padY = Math.round(fontSize * 0.35);
    const r = parseInt(style.bgColor.slice(1, 3), 16);
    const g = parseInt(style.bgColor.slice(3, 5), 16);
    const b = parseInt(style.bgColor.slice(5, 7), 16);
    ctx.save();
    ctx.fillStyle = `rgba(${r},${g},${b},${style.bgOpacity / 100})`;
    roundRect(ctx, x - fullW / 2 - padX, firstBaselineY - fontSize - padY, fullW + padX * 2, blockH + padY * 2, Math.round(fontSize * 0.35));
    ctx.fill();
    ctx.restore();
  }

  if (style.shadow) {
    ctx.shadowColor = style.shadowColor;
    ctx.shadowBlur = style.shadowBlur;
    ctx.shadowOffsetX = Math.round(fontSize * 0.06);
    ctx.shadowOffsetY = Math.round(fontSize * 0.06);
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  }

  ctx.textAlign = 'left';
  const doStroke = style.stroke && style.strokeW > 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineY = firstBaselineY + li * lineHeight;
    let startX = x - lineWidths[li] / 2;

    for (const w of line) {
      let wordAlpha = 1, wordScale = 1;

      // which words count as "emphasized" depends on emphasisMode: a fixed AI-picked
      // word, whichever word is being spoken right now, or none at all.
      const isEmphasized = style.emphasisMode === 'none' ? false
        : style.emphasisMode === 'karaoke' ? (t >= w.start && t < w.end)
        : !!w.emphasis;

      let color = isEmphasized ? style.hi : style.base;
      const showBox = isEmphasized && style.emphasisStyle === 'box';
      if (showBox) color = style.base; // text sits on a hi-colored chip, so keep it legible instead of hi-on-hi
      if (isEmphasized && style.emphasisStyle === 'scale') wordScale *= style.emphasisScale / 100;

      if (anim === 'word-reveal' && !style.oneWordMode) {
        const since = t - w.start;
        if (since < 0) { startX += measure(w.word + ' '); continue; } // not yet spoken
        const p = clamp01(since / entranceDur);
        wordScale *= since < entranceDur ? Math.max(0, entranceCurve(p, style.animBounce, style.animScale)) : 1;
        wordAlpha = since < entranceDur * 0.6 ? clamp01(since / (entranceDur * 0.6)) : 1;
      }

      const wordW = measure(w.word);
      ctx.save();
      ctx.globalAlpha = groupAlpha * wordAlpha;
      if (wordScale !== 1) {
        const cx = startX + wordW / 2;
        ctx.translate(cx, lineY);
        ctx.scale(wordScale, wordScale);
        ctx.translate(-cx, -lineY);
      }

      if (showBox) {
        const padX = fontSize * (0.05 + style.emphasisBoxPad / 100 * 0.3), padY = padX * 0.778;
        ctx.save();
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
        ctx.fillStyle = style.hi;
        roundRect(ctx, startX - padX, lineY - fontSize * 0.78 - padY, wordW + padX * 2, fontSize * 0.78 + padY * 2, Math.round(fontSize * 0.16));
        ctx.fill();
        ctx.restore();
      }
      if (isEmphasized && style.emphasisStyle === 'glow') {
        ctx.shadowColor = style.hi;
        ctx.shadowBlur = fontSize * (0.15 + style.emphasisGlow / 100 * 0.5);
      }

      ctx.fillStyle = color;
      if (doStroke) {
        ctx.strokeStyle = style.strokeColor;
        ctx.lineWidth = style.strokeW;
        ctx.strokeText(w.word, startX, lineY);
      }
      ctx.fillText(w.word, startX, lineY);

      if (isEmphasized && style.emphasisStyle === 'underline') {
        ctx.fillStyle = style.hi;
        const thickness = Math.max(2, Math.round(fontSize * (0.02 + style.emphasisUnderline / 100 * 0.10)));
        ctx.fillRect(startX, lineY + fontSize * 0.12, wordW, thickness);
      }
      ctx.restore();

      startX += measure(w.word + ' ');
    }
  }

  ctx.restore();
}

export async function loadCustomFont(name: string, dataUrl: string) {
  const face = new FontFace(name, `url(${dataUrl})`);
  await face.load();
  (document.fonts as any).add(face);
}

/** Renders a small preview thumbnail (PNG data URL) of a style, for a library card. */
export function renderStylePreviewDataUrl(style: StylePreset, width = 320, height = 180): string {
  const sampleChunk: Chunk = {
    text: 'YOUR STYLE', start: 0, end: 2,
    words: [
      { word: 'YOUR', start: 0, end: 0.9 },
      { word: 'STYLE', start: 1.0, end: 2.0, emphasis: true },
    ],
  };

  const textCv = document.createElement('canvas');
  textCv.width = width;
  textCv.height = height;
  const textCtx = textCv.getContext('2d', { alpha: true })!;
  drawFrame(textCtx, textCv, [sampleChunk], style, 1.2);

  const outCv = document.createElement('canvas');
  outCv.width = width;
  outCv.height = height;
  const outCtx = outCv.getContext('2d')!;
  const grad = outCtx.createRadialGradient(width / 2, height * 0.35, 0, width / 2, height * 0.35, width * 0.8);
  grad.addColorStop(0, '#2a2620');
  grad.addColorStop(1, '#0c0c0e');
  outCtx.fillStyle = grad;
  outCtx.fillRect(0, 0, width, height);
  outCtx.drawImage(textCv, 0, 0);
  return outCv.toDataURL('image/png');
}
