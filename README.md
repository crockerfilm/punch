# Punch — caption tool

WordPunch successor. Web-based: upload a raw edit, get word-level transcription (Groq Whisper),
AI-suggested caption chunking + emphasis words (Claude), edit live in-browser, export.

## Run locally

```bash
cd server && npm install && cp .env.example .env   # fill in GROQ_API_KEY, ANTHROPIC_API_KEY
npm run dev

# separate terminal
cd client && npm install
npm run dev
```

Open the client URL Vite prints (default http://localhost:5173).

## Export

- **ProRes 4444 (.mov)** — a genuine alpha-channel QuickTime file (ffmpeg's `prores_ks`
  encoder, codec tag `ap4h`), rendered client-side as a PNG sequence then encoded
  server-side. Drops into a Premiere/AE timeline like any native clip — no import
  wrangling, no blend modes. This is the one to use; the browser can't produce this
  itself (no ProRes encoder in WebCodecs), so it's the only export that leaves the browser.
- **PNG sequence (.zip)** — true alpha transparency, all client-side. Import as an
  image sequence if you'd rather not round-trip through the server.
- **Preview MP4** — black background, drop it on your timeline with the Screen blend mode.
  Fastest option, no real transparency.

Browser video codecs (WebCodecs/MediaRecorder) don't reliably preserve alpha end-to-end —
VP9/WebM is the only one that theoretically can, and Premiere's support for it is
inconsistent — so ProRes 4444 goes through the server instead, which is what actually
gets you a clean, native-transparent file Premiere likes.

Export frame rate auto-matches the source footage (detected server-side via ffmpeg during
transcription) rather than a fixed 30fps, so exports stay in sync regardless of what the
original clip was shot at.
