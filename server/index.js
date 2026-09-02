import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import JSZip from 'jszip';
import pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, '../client/dist');

const execFileAsync = promisify(execFile);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ---------------- global style library (Postgres, optional) ----------------
// Only configured when DATABASE_URL is set (e.g. Railway's Postgres plugin) —
// local dev without it just runs with the global library disabled, everything
// else works the same.
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false })
  : null;

if (pool) {
  pool.query(`
    CREATE TABLE IF NOT EXISTS global_styles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      style JSONB NOT NULL,
      preview TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `).then(() => console.log('global_styles table ready')).catch(err => console.error('DB init failed:', err));
}

/** Calls Claude, returns the first text block's content (skipping any thinking/tool blocks). */
async function callClaude({ system, content, maxTokens = 4096 }) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic API error ${r.status}: ${await r.text()}`);
  const json = await r.json();
  const textBlock = (json.content || []).find(b => b.type === 'text');
  return textBlock?.text || '';
}

function extractJson(raw) {
  return JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
}

/**
 * Parses "Duration: 00:01:23.45" and "<n> fps" out of ffmpeg's stderr
 * (ffmpeg always writes both for a video file, even without -i-only runs).
 */
async function getVideoInfo(inPath) {
  let stderr = '';
  try {
    await execFileAsync(ffmpegPath, ['-i', inPath]);
  } catch (err) {
    stderr = err.stderr || '';
  }
  const durM = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const duration = durM ? (+durM[1]) * 3600 + (+durM[2]) * 60 + parseFloat(durM[3]) : null;
  const fpsM = /(\d+(?:\.\d+)?)\s+fps/.exec(stderr);
  const fps = fpsM ? Math.round(parseFloat(fpsM[1])) : null;
  return { duration, fps };
}

async function transcribeChunk(audioBuf, filename) {
  const form = new FormData();
  form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), filename);
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'word');

  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Groq API error ${r.status}: ${await r.text()}`);
  return r.json();
}

// Whisper-family models sometimes stop early on long and/or silence-heavy audio (a known
// quirk, not something we can fix API-side) — so long audio is split into fixed windows and
// each is transcribed independently, which sidesteps that regardless of the exact cause.
const SEGMENT_SECONDS = 50;

/**
 * POST /api/transcribe
 * multipart form field "video" -> extracts audio with ffmpeg, sends to Groq Whisper
 * (segmented for anything longer than SEGMENT_SECONDS so long/quiet audio can't get cut short),
 * returns { words: [{word, start, end}], text }
 */
app.post('/api/transcribe', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  if (!process.env.GROQ_API_KEY) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  const dir = await mkdtemp(path.join(tmpdir(), 'punch-'));
  const inPath = path.join(dir, 'in' + path.extname(req.file.originalname || '.mp4'));
  const outPath = path.join(dir, 'audio.mp3');

  try {
    await writeFile(inPath, req.file.buffer);

    await execFileAsync(ffmpegPath, [
      '-y', '-i', inPath,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k',
      outPath,
    ]);

    const { duration, fps } = await getVideoInfo(inPath);
    const words = [];
    const texts = [];

    if (!duration || duration <= SEGMENT_SECONDS) {
      const json = await transcribeChunk(await readFile(outPath), 'audio.mp3');
      for (const w of json.words || []) words.push({ word: w.word.trim(), start: w.start, end: w.end });
      texts.push(json.text || '');
    } else {
      for (let start = 0; start < duration; start += SEGMENT_SECONDS) {
        const segPath = path.join(dir, `seg_${start}.mp3`);
        await execFileAsync(ffmpegPath, [
          '-y', '-ss', String(start), '-t', String(SEGMENT_SECONDS), '-i', outPath,
          '-c', 'copy', segPath,
        ]);
        const json = await transcribeChunk(await readFile(segPath), `seg_${start}.mp3`);
        for (const w of json.words || []) {
          words.push({ word: w.word.trim(), start: w.start + start, end: w.end + start });
        }
        texts.push(json.text || '');
      }
    }

    res.json({ words, text: texts.join(' ').trim(), fps: fps || 30, duration });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

/**
 * POST /api/suggest-captions
 * JSON body: { words, emphasisDetection }
 * returns { chunks: [{ text, start, end, words: [{word,start,end,emphasis}] }] }
 * (Vertical placement is a manual per-chunk slider in the UI now, not AI-picked —
 * that used to cost a second vision call per generation; not worth the tokens.)
 */
app.post('/api/suggest-captions', async (req, res) => {
  const words = Array.isArray(req.body.words) ? req.body.words : [];
  if (!words.length) return res.status(400).json({ error: 'no words' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const emphasisDetection = req.body.emphasisDetection !== false;
  const transcript = words.map((w, i) => `${i}:${w.word}`).join(' ');

  const groupingPrompt = `You are styling captions for a punchy short-form vertical video ad (UGC/creator style).
Given this word list (index:word), group words into short caption chunks (1-5 words each, following natural speech pauses/emphasis, similar to karaoke-style captions).${emphasisDetection ? ' Also pick which word index(es) in each chunk should be the "emphasis" word (the single most important/loud word - things like numbers, product names, superlatives, strong verbs/adjectives). Not every chunk needs an emphasis word.' : ''}

Word list:
${transcript}

Respond with ONLY valid JSON, no prose, in this exact shape:
{"chunks":[{"wordIndexes":[0,1,2]${emphasisDetection ? ',"emphasisIndexes":[1]' : ''}}, ...]}

Every word index from 0 to ${words.length - 1} must appear in exactly one chunk, in order, covering the whole transcript.`;

  try {
    const raw = await callClaude({ content: groupingPrompt, maxTokens: 8192 });
    const parsed = extractJson(raw);

    const chunks = (parsed.chunks || []).map(c => {
      const chunkWords = c.wordIndexes.map(i => ({
        ...words[i],
        emphasis: emphasisDetection && (c.emphasisIndexes || []).includes(i),
      }));
      return {
        text: chunkWords.map(w => w.word).join(' '),
        start: chunkWords[0]?.start ?? 0,
        end: chunkWords[chunkWords.length - 1]?.end ?? 0,
        words: chunkWords,
      };
    });

    res.json({ chunks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /api/suggest-emphasis
 * JSON body: { chunks: [{ text, start, end, words: [{word,start,end}] }] }
 * Picks one standout word per chunk without re-deciding chunk boundaries — the
 * cheap add-on for when chunking itself was done deterministically (no AI call)
 * but the emphasis-word pick is still wanted.
 * returns { chunks } with each chunk's words carrying `emphasis` booleans.
 */
app.post('/api/suggest-emphasis', async (req, res) => {
  const chunks = Array.isArray(req.body.chunks) ? req.body.chunks : [];
  if (!chunks.length) return res.status(400).json({ error: 'no chunks' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

  const listing = chunks.map((c, ci) => `${ci}: ${c.words.map((w, wi) => `${wi}:${w.word}`).join(' ')}`).join('\n');
  const prompt = `You are picking the single standout "emphasis" word (the most important/loud word - numbers, product names, superlatives, strong verbs/adjectives) for each caption chunk below, if any. Not every chunk needs one. Chunks are given as "chunkIndex: wordIndex:word wordIndex:word ...".

${listing}

Respond with ONLY valid JSON, no prose: {"emphasis":[{"chunk":0,"word":1}, ...]} where "word" is the word's index within that chunk. Omit a chunk entirely if it has no clear standout word.`;

  try {
    const raw = await callClaude({ content: prompt, maxTokens: 2048 });
    const parsed = extractJson(raw);
    const picks = new Map((parsed.emphasis || []).map(p => [p.chunk, p.word]));

    const result = chunks.map((c, ci) => ({
      ...c,
      words: c.words.map((w, wi) => ({ ...w, emphasis: picks.get(ci) === wi })),
    }));
    res.json({ chunks: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

/**
 * POST /api/export-prores
 * multipart form: "frames" (a .zip of frame_00000.png, frame_00001.png, ... — same
 * naming exportPngSequence produces), "fps".
 * Encodes them into a genuine ProRes 4444 .mov with a real alpha channel (codec tag
 * ap4h) via ffmpeg's prores_ks encoder — this is what Premiere/AE import natively,
 * unlike WebM/VP9 alpha which Premiere handles inconsistently at best.
 */
app.post('/api/export-prores', upload.single('frames'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no frames zip' });
  const fps = Math.max(1, Math.min(120, Math.round(+req.body.fps || 30)));

  const dir = await mkdtemp(path.join(tmpdir(), 'punch-prores-'));
  try {
    const zip = await JSZip.loadAsync(req.file.buffer);
    const names = Object.keys(zip.files).filter(n => n.endsWith('.png')).sort();
    if (!names.length) return res.status(400).json({ error: 'zip had no frames' });
    for (const name of names) {
      const buf = await zip.files[name].async('nodebuffer');
      await writeFile(path.join(dir, name), buf);
    }

    const outPath = path.join(dir, 'output.mov');
    await execFileAsync(ffmpegPath, [
      '-y', '-framerate', String(fps), '-i', path.join(dir, 'frame_%05d.png'),
      '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0',
      outPath,
    ], { maxBuffer: 1024 * 1024 * 50 });

    const outBuf = await readFile(outPath);
    res.setHeader('Content-Type', 'video/quicktime');
    res.setHeader('Content-Disposition', 'attachment; filename="overlay_prores4444.mov"');
    res.send(outBuf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

/**
 * Global style library — shared across everyone using this deployment, backed by
 * Postgres. Disabled (503) when DATABASE_URL isn't set, e.g. local dev.
 */
app.get('/api/global-styles', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Global library not configured on this server' });
  try {
    const { rows } = await pool.query(
      'SELECT id, name, style, preview, created_at FROM global_styles ORDER BY created_at DESC LIMIT 300'
    );
    res.json({ styles: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post('/api/global-styles', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Global library not configured on this server' });
  const { name, style, preview } = req.body || {};
  if (!name || !style) return res.status(400).json({ error: 'name and style are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO global_styles (name, style, preview) VALUES ($1, $2, $3) RETURNING id, name, created_at',
      [String(name).slice(0, 200), JSON.stringify(style), preview ? String(preview).slice(0, 2_000_000) : null]
    );
    res.json({ saved: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete('/api/global-styles/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'Global library not configured on this server' });
  try {
    await pool.query('DELETE FROM global_styles WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Serve the built client (single-service deploy: this same process serves both
// the API and the static frontend). No-op in local dev where dist/ doesn't exist —
// run the Vite dev server separately for that, as the README describes.
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const port = process.env.PORT || 8787;
app.listen(port, () => console.log(`punch server on :${port}`));
