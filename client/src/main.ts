import { checkAuthRequired, verifyPassword, getStoredPassword, setStoredPassword } from './lib/auth';
import type { Chunk, StylePreset, Word } from './lib/types';
import { DEFAULT_STYLE, ANIMATIONS, EMPHASIS_MODES, EMPHASIS_STYLES, FONT_CHOICES } from './lib/presets';
import { drawFrame, loadCustomFont, renderStylePreviewDataUrl } from './lib/render';
import { transcribeVideo, suggestCaptions, suggestEmphasis } from './lib/api';
import { exportPngSequence, exportPreviewMp4, exportProResAlpha } from './lib/export';
import { saveProject, loadProject, markDirty, markClean, onDirtyChange, isDirty } from './lib/project';
import { saveStyleToLibrary, downloadStyle, loadStyleFromFile } from './lib/styleLibrary';
import { fetchGlobalStyles, saveToGlobalLibrary } from './lib/globalLibrary';
import { downloadChunks, loadChunksFromFile } from './lib/chunkPackage';
import { autoChunkByFit } from './lib/autoChunk';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

// ---------------- shared state ----------------
type Phase = 'landing' | 'style' | 'footage';
let phase: Phase = 'landing';
let style: StylePreset = { ...DEFAULT_STYLE };
let currentStyleName = 'Custom';

let words: Word[] = [];
let chunks: Chunk[] = [];
let selectedChunk: Chunk | null = null;
let videoFile: File | null = null;
let videoFps = 30;
let customFontName: string | null = null;

// ---------------- shared canvas ----------------
const video = $<HTMLVideoElement>('#video');
const cv = $<HTMLCanvasElement>('#cv');
const ctx = cv.getContext('2d', { alpha: true })!;
const stage = $('#stage');
const stylePlaceholderBg = $('#stylePlaceholderBg');
const emptyState = $('#emptyState');

// ---------------- sample preview (phase: style) ----------------
function makeSampleChunks(): Chunk[] {
  const mk = (text: string, start: number, end: number, emphasisIdx: number): Chunk => {
    const ws = text.split(' ');
    const dur = (end - start) / ws.length;
    const w: Word[] = ws.map((word, i) => ({ word, start: start + i * dur, end: start + (i + 1) * dur, emphasis: i === emphasisIdx }));
    return { text, start, end, words: w };
  };
  return [
    mk('THIS IS YOUR', 0, 0.9, 2),
    mk('CAPTION STYLE', 0.95, 1.9, 0),
    mk('LOOKING GOOD', 1.95, 2.9, 1),
  ];
}
const SAMPLE_CHUNKS = makeSampleChunks();
const SAMPLE_LOOP_DUR = 3.2;
let styleLoopRunning = false;
function styleLoopTick() {
  if (phase !== 'style') { styleLoopRunning = false; return; }
  const t = (performance.now() / 1000) % SAMPLE_LOOP_DUR;
  drawFrame(ctx, cv, SAMPLE_CHUNKS, style, t);
  requestAnimationFrame(styleLoopTick);
}
function ensureStyleLoop() {
  if (styleLoopRunning) return;
  styleLoopRunning = true;
  requestAnimationFrame(styleLoopTick);
}

// ---------------- phase switching ----------------
const phaseLandingSidebar = $('#phaseLandingSidebar');
const phaseStyleSidebar = $('#phaseStyleSidebar');
const phaseFootageSidebar = $('#phaseFootageSidebar');
const topbarStyleLeft = $('#topbarStyleLeft');
const topbarStyleTitle = $('#topbarStyleTitle');
const topbarFootageLeft = $('#topbarFootageLeft');
const tcWrap = $('#tcWrap');
const footageControls = $('#footageControls');
const stylePreviewNote = $('#stylePreviewNote');
const styleSummaryName = $('#styleSummaryName');

function setPhase(p: Phase) {
  phase = p;
  const isFootage = p === 'footage';
  const isLanding = p === 'landing';
  phaseLandingSidebar.hidden = !isLanding;
  phaseStyleSidebar.hidden = isLanding || isFootage;
  phaseFootageSidebar.hidden = !isFootage;
  topbarStyleLeft.hidden = isFootage;
  topbarFootageLeft.hidden = !isFootage;
  topbarStyleTitle.textContent = isLanding ? 'Welcome to Punch' : 'Building your caption style';
  tcWrap.hidden = !isFootage;
  footageControls.hidden = !isFootage;
  stylePreviewNote.hidden = isFootage;
  stylePlaceholderBg.hidden = isFootage;
  video.style.display = isFootage ? '' : 'none';
  if (!isFootage) {
    emptyState.hidden = true;
    ensureStyleLoop();
  } else {
    styleSummaryName.textContent = currentStyleName;
    emptyState.hidden = !!videoFile;
    aiEmphasisRow.hidden = style.emphasisMode !== 'auto';
    draw();
  }
}

const backBtn = $<HTMLButtonElement>('#backBtn');
backBtn.addEventListener('click', () => {
  if (phase === 'footage') setPhase('style');
  else if (phase === 'style') setPhase('landing');
});

// ================================================================
// PHASE 1 — STYLE BUILDER
// ================================================================
const wizardSection = $('#wizardSection');
const wizardProgress = $('#wizardProgress');
const wizardCard = $('#wizardCard');
const wizardSummary = $('#wizardSummary');
const fineTuneSection = $('#fineTuneSection');
const styleActionsWrap = $('#styleActionsWrap');
const saveStyleBtn = $('#saveStyleBtn');
const downloadStyleBtn = $('#downloadStyleBtn');
const uploadStyleInput = $<HTMLInputElement>('#uploadStyleInput');
const saveGlobalBtn = $<HTMLButtonElement>('#saveGlobalBtn');
const continueToFootageBtn = $('#continueToFootageBtn');
const editStyleBtn = $('#editStyleBtn');

async function applyCustomFontFile(file: File) {
  const dataUrl = await new Promise<string>(res => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.readAsDataURL(file);
  });
  const name = file.name.replace(/\.[^.]+$/, '');
  await loadCustomFont(name, dataUrl);
  customFontName = name;
  style.font = name;
  customFontChip.hidden = false;
  customFontChip.innerHTML = `<span>${file.name}</span><span class="tag">loaded</span>`;
  if (!FONT_CHOICES.includes(name) && !Array.from(fontSelect.options).some(o => o.value === name)) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    fontSelect.appendChild(opt);
  }
  fontSelect.value = name;
  markDirty();
}

type WizardStepId = 'font' | 'display' | 'emphasisMode' | 'emphasisStyle' | 'animation';
const WIZARD_STEPS: WizardStepId[] = ['font', 'display', 'emphasisMode', 'emphasisStyle', 'animation'];
function effectiveSteps(): WizardStepId[] {
  return WIZARD_STEPS.filter(s => !(s === 'emphasisStyle' && style.emphasisMode === 'none'));
}

let wizardIndex = 0;
let wizardDone = false;
let wizardEditing = false;

const DISPLAY_CHOICES = [
  { value: false, label: 'Full phrase chunks', desc: 'Multiple words on screen at once, wrapped naturally' },
  { value: true, label: 'One word at a time', desc: 'Only the current word shown, replacing the last' },
];

function stepMeta(stepId: WizardStepId) {
  switch (stepId) {
    case 'font':
      return {
        title: 'What font do you want?',
        sub: '',
        render: (container: HTMLElement) => {
          const choices = FONT_CHOICES.map(f => ({ value: f, label: f, fontPreview: true }));
          if (customFontName && !FONT_CHOICES.includes(customFontName)) {
            choices.push({ value: customFontName, label: customFontName, fontPreview: true });
          }
          renderChoiceGrid(container, choices, customFontName || style.font, true, (v: string) => { style.font = v; customFontName = null; });

          const upload = document.createElement('label');
          upload.className = 'upload-font';
          upload.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 3V15M12 15L7 10M12 15L17 10M4 20H20" stroke="#8d8c96" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Upload custom font (.otf/.ttf)';
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.otf,.ttf,.woff,.woff2';
          input.hidden = true;
          input.addEventListener('change', async () => {
            const f = input.files?.[0];
            if (!f) return;
            await applyCustomFontFile(f);
            renderWizard();
          });
          upload.appendChild(input);
          container.appendChild(upload);
        },
      };
    case 'display':
      return {
        title: 'How should captions appear?',
        sub: '',
        render: (container: HTMLElement) => renderChoiceGrid(container, DISPLAY_CHOICES, style.oneWordMode, false, (v: boolean) => {
          style.oneWordMode = v;
          // "As-spoken" has nothing to contrast against once only one word is ever on screen
          if (v && style.emphasisMode === 'karaoke') style.emphasisMode = 'auto';
        }),
      };
    case 'emphasisMode':
      return {
        title: 'Should certain words stand out?',
        sub: '',
        render: (container: HTMLElement) => {
          const opts = EMPHASIS_MODES.filter(m => !(m.hideOneWord && style.oneWordMode));
          renderChoiceGrid(container, opts, style.emphasisMode, false, (v: StylePreset['emphasisMode']) => { style.emphasisMode = v; });
        },
      };
    case 'emphasisStyle':
      return {
        title: 'Choose an emphasis style',
        sub: 'How the standout word should look',
        render: (container: HTMLElement) => {
          renderChoiceGrid(container, EMPHASIS_STYLES, style.emphasisStyle, false, (v: StylePreset['emphasisStyle']) => { style.emphasisStyle = v; });
          const settings = document.createElement('div');
          settings.className = 'wizard-settings';
          if (style.emphasisStyle === 'scale') {
            settings.appendChild(makeSlider('Scale amount', style.emphasisScale, 100, 180, v => { style.emphasisScale = v; }, '%'));
          } else if (style.emphasisStyle === 'box') {
            settings.appendChild(makeSlider('Padding', style.emphasisBoxPad, 0, 100, v => { style.emphasisBoxPad = v; }));
          } else if (style.emphasisStyle === 'underline') {
            settings.appendChild(makeSlider('Thickness', style.emphasisUnderline, 0, 100, v => { style.emphasisUnderline = v; }));
          } else if (style.emphasisStyle === 'glow') {
            settings.appendChild(makeSlider('Intensity', style.emphasisGlow, 0, 100, v => { style.emphasisGlow = v; }));
          }
          if (settings.childElementCount) container.appendChild(settings);
        },
      };
    case 'animation':
      return {
        title: 'Choose an animation style',
        sub: 'How each caption enters the screen',
        render: (container: HTMLElement) => {
          const opts = ANIMATIONS.filter(a => !(a.hideOneWord && style.oneWordMode));
          renderChoiceGrid(container, opts, style.animation, false, (v: StylePreset['animation']) => { style.animation = v; });
          const settings = document.createElement('div');
          settings.className = 'wizard-settings';
          if (style.animation !== 'none') {
            settings.appendChild(makeSlider('Speed', style.animSpeedMs, 60, 500, v => { style.animSpeedMs = v; }, 'ms'));
          }
          if (style.animation === 'pop' || style.animation === 'word-reveal' || style.animation === 'slide-up') {
            settings.appendChild(makeSlider('Bounce', style.animBounce, 0, 100, v => { style.animBounce = v; }));
            settings.appendChild(makeSlider('Scale amount', style.animScale, 100, 180, v => { style.animScale = v; }, '%'));
          }
          if (settings.childElementCount) container.appendChild(settings);
        },
      };
  }
}

function makeSlider(label: string, value: number, min: number, max: number, onChange: (v: number) => void, unit = ''): HTMLElement {
  const row = document.createElement('div');
  row.className = 'mini-slider wizard-mini-slider';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.value = String(value);
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = value + unit;
  input.addEventListener('input', () => {
    const v = +input.value;
    val.textContent = v + unit;
    onChange(v);
    markDirty();
  });
  row.appendChild(span);
  row.appendChild(input);
  row.appendChild(val);
  return row;
}

function stepLabel(stepId: WizardStepId): string {
  return { font: 'Font', display: 'Display', emphasisMode: 'Emphasis', emphasisStyle: 'Emphasis look', animation: 'Animation' }[stepId];
}
function stepValueLabel(stepId: WizardStepId): string {
  if (stepId === 'font') return customFontName || style.font;
  if (stepId === 'display') return style.oneWordMode ? 'One word at a time' : 'Full phrase chunks';
  if (stepId === 'emphasisMode') return EMPHASIS_MODES.find(m => m.value === style.emphasisMode)?.label || '';
  if (stepId === 'emphasisStyle') return EMPHASIS_STYLES.find(m => m.value === style.emphasisStyle)?.label || '';
  return ANIMATIONS.find(a => a.value === style.animation)?.label || '';
}

function renderChoiceGrid<T>(
  container: HTMLElement,
  choices: { value: T; label: string; desc?: string; fontPreview?: boolean }[],
  current: T,
  cols2: boolean,
  onPick: (v: T) => void,
) {
  const grid = document.createElement('div');
  grid.className = 'choice-grid' + (cols2 ? ' cols-2' : '');
  for (const c of choices) {
    const card = document.createElement('div');
    card.className = 'choice-card' + (c.value === current ? ' active' : '');
    const name = document.createElement('div');
    name.className = 'cname' + (c.fontPreview ? ' font-preview' : '');
    if (c.fontPreview) name.style.fontFamily = `'${c.label}', sans-serif`;
    name.textContent = c.label;
    card.appendChild(name);
    if (c.desc) {
      const desc = document.createElement('div');
      desc.className = 'cdesc';
      desc.textContent = c.desc;
      card.appendChild(desc);
    }
    card.addEventListener('click', () => {
      onPick(c.value);
      markDirty();
      renderWizard();
    });
    grid.appendChild(card);
  }
  container.appendChild(grid);
}

function renderWizardProgress() {
  const steps = effectiveSteps();
  wizardProgress.innerHTML = '';
  if (wizardDone && !wizardEditing) { wizardProgress.hidden = true; return; }
  wizardProgress.hidden = false;
  steps.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'dot' + (i < wizardIndex ? ' done' : i === wizardIndex ? ' current' : '');
    wizardProgress.appendChild(d);
  });
}

function renderWizardCard() {
  const steps = effectiveSteps();
  if (wizardIndex >= steps.length) wizardIndex = steps.length - 1;
  const stepId = steps[wizardIndex];
  const meta = stepMeta(stepId)!;
  wizardCard.innerHTML = '';

  const q = document.createElement('div');
  q.className = 'wizard-q';
  q.textContent = meta.title;
  wizardCard.appendChild(q);
  if (meta.sub) {
    const sub = document.createElement('div');
    sub.className = 'wizard-sub';
    sub.textContent = meta.sub;
    wizardCard.appendChild(sub);
  }
  meta.render(wizardCard);

  const nav = document.createElement('div');
  nav.className = 'wizard-nav';
  const back = document.createElement('button');
  back.textContent = '← Back';
  back.disabled = wizardIndex === 0;
  back.addEventListener('click', () => { wizardIndex--; renderWizard(); });
  const next = document.createElement('button');
  next.className = 'primary';
  const isLast = wizardIndex === steps.length - 1;
  next.textContent = isLast ? 'Finish' : 'Next →';
  next.addEventListener('click', () => {
    if (isLast) {
      wizardDone = true;
      wizardEditing = false;
      fineTuneSection.hidden = false;
      styleActionsWrap.hidden = false;
      syncCustomizeUI();
    } else {
      wizardIndex++;
    }
    renderWizard();
  });
  nav.appendChild(back);
  nav.appendChild(next);
  wizardCard.appendChild(nav);
}

function renderWizardSummary() {
  wizardSummary.innerHTML = '';
  const steps = effectiveSteps();

  const back = document.createElement('button');
  back.className = 'wizard-back';
  back.textContent = '← Change any answer';
  back.addEventListener('click', () => {
    wizardEditing = true;
    wizardIndex = 0;
    renderWizard();
  });
  wizardSummary.appendChild(back);

  steps.forEach(stepId => {
    const row = document.createElement('div');
    row.className = 'wizard-summary-row';
    const label = document.createElement('span');
    label.className = 'wl';
    label.textContent = stepLabel(stepId);
    const val = document.createElement('span');
    val.className = 'wv';
    val.textContent = stepValueLabel(stepId);
    const icon = document.createElement('span');
    icon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 20l1-4L17 4l3 3L8 19l-4 1Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    row.appendChild(label);
    row.appendChild(val);
    row.appendChild(icon);
    row.addEventListener('click', () => {
      wizardEditing = true;
      wizardIndex = steps.indexOf(stepId);
      renderWizard();
    });
    wizardSummary.appendChild(row);
  });
}

function renderWizard() {
  const showQuestion = !wizardDone || wizardEditing;
  wizardCard.hidden = !showQuestion;
  wizardSummary.hidden = showQuestion;
  renderWizardProgress();
  if (showQuestion) renderWizardCard();
  else renderWizardSummary();
}

/** Applies a fully-formed style (from a preset, a saved-library entry, or an uploaded file) and jumps straight to the summary + fine-tune, same as finishing the wizard. */
function applyLoadedStyle(name: string, loaded: StylePreset) {
  // merge over the current defaults so a style saved before a field existed doesn't end up with `undefined`s
  style = { ...DEFAULT_STYLE, ...loaded };
  // "As-spoken" has nothing to contrast against in one-word mode — normalize any stale/imported combo
  if (style.oneWordMode && style.emphasisMode === 'karaoke') style.emphasisMode = 'auto';
  currentStyleName = name;
  customFontName = FONT_CHOICES.includes(style.font) ? null : style.font;
  wizardDone = true;
  wizardEditing = false;
  wizardIndex = 0;
  fineTuneSection.hidden = false;
  styleActionsWrap.hidden = false;
  syncCustomizeUI();
  renderWizard();
  markDirty();
}

saveStyleBtn.addEventListener('click', () => {
  const name = (window.prompt('Name this style:', currentStyleName === 'Custom' ? '' : currentStyleName) || '').trim();
  if (!name) return;
  saveStyleToLibrary(name, style);
  currentStyleName = name;
});
downloadStyleBtn.addEventListener('click', () => downloadStyle(currentStyleName, style));
saveGlobalBtn.addEventListener('click', async () => {
  const name = (window.prompt('Name this style for the global library:', currentStyleName === 'Custom' ? '' : currentStyleName) || '').trim();
  if (!name) return;
  saveGlobalBtn.disabled = true;
  saveGlobalBtn.textContent = 'Saving…';
  try {
    const preview = renderStylePreviewDataUrl(style);
    await saveToGlobalLibrary(name, style, preview);
    currentStyleName = name;
    saveGlobalBtn.textContent = 'Saved!';
    setTimeout(() => { saveGlobalBtn.textContent = 'Save to global library'; }, 1500);
  } catch (err: any) {
    window.alert(err.message);
    saveGlobalBtn.textContent = 'Save to global library';
  } finally {
    saveGlobalBtn.disabled = false;
  }
});
uploadStyleInput.addEventListener('change', async () => {
  const f = uploadStyleInput.files?.[0];
  uploadStyleInput.value = '';
  if (!f) return;
  try {
    const { name, style: loaded } = await loadStyleFromFile(f);
    applyLoadedStyle(name, loaded);
  } catch (err: any) {
    window.alert('Could not load that style file: ' + err.message);
  }
});
continueToFootageBtn.addEventListener('click', () => setPhase('footage'));
editStyleBtn.addEventListener('click', () => setPhase('style'));

// ================================================================
// FINE-TUNE (shared markup, used once wizard is done)
// ================================================================
const fontSelect = $<HTMLSelectElement>('#fontSelect');
for (const f of FONT_CHOICES) {
  const opt = document.createElement('option');
  opt.value = f; opt.textContent = f;
  fontSelect.appendChild(opt);
}
const customFontInput = $<HTMLInputElement>('#customFontInput');
const customFontChip = $('#customFontChip');
const sizeInput = $<HTMLInputElement>('#size');
const sizeVal = $('#sizeVal');
const baseColor = $<HTMLInputElement>('#baseColor');
const hiColor = $<HTMLInputElement>('#hiColor');
const vposInput = $<HTMLInputElement>('#vpos');
const vposVal = $('#vposVal');
const tStroke = $('#tStroke');
const strokeSubRow = tStroke.closest('.toggle-card')!.querySelector('.sub-row')!;
const strokeColor = $<HTMLInputElement>('#strokeColor');
const strokeW = $<HTMLInputElement>('#strokeW');
const strokeWVal = $('#strokeWVal');
const tShadow = $('#tShadow');
const shadowSubRow = tShadow.closest('.toggle-card')!.querySelector('.sub-row')!;
const shadowColor = $<HTMLInputElement>('#shadowColor');
const shadowBlur = $<HTMLInputElement>('#shadowBlur');
const shadowBlurVal = $('#shadowBlurVal');
const tBg = $('#tBg');
const bgSubRow = tBg.closest('.toggle-card')!.querySelector('.sub-row')!;
const bgColor = $<HTMLInputElement>('#bgColor');
const bgOpacity = $<HTMLInputElement>('#bgOpacity');
const bgOpacityVal = $('#bgOpacityVal');
const tCaps = $('#tCaps');

function syncCustomizeUI() {
  fontSelect.value = customFontName || style.font;
  sizeInput.value = String(style.size);
  sizeVal.textContent = style.size + 'px';
  baseColor.value = style.base;
  hiColor.value = style.hi;
  vposInput.value = String(style.vpos);
  vposVal.textContent = style.vpos + '%';
  tStroke.classList.toggle('on', style.stroke);
  strokeSubRow.classList.toggle('disabled', !style.stroke);
  strokeColor.value = style.strokeColor;
  strokeW.value = String(style.strokeW);
  strokeWVal.textContent = style.strokeW + 'px';
  tShadow.classList.toggle('on', style.shadow);
  shadowSubRow.classList.toggle('disabled', !style.shadow);
  shadowColor.value = style.shadowColor;
  shadowBlur.value = String(style.shadowBlur);
  shadowBlurVal.textContent = style.shadowBlur + 'px';
  tBg.classList.toggle('on', style.bg);
  bgSubRow.classList.toggle('disabled', !style.bg);
  bgColor.value = style.bgColor;
  bgOpacity.value = String(style.bgOpacity);
  bgOpacityVal.textContent = style.bgOpacity + '%';
  tCaps.classList.toggle('on', style.caps);
}

fontSelect.addEventListener('change', () => { style.font = fontSelect.value; customFontName = null; markDirty(); });
customFontInput.addEventListener('change', async () => {
  const f = customFontInput.files?.[0];
  if (!f) return;
  await applyCustomFontFile(f);
});
sizeInput.addEventListener('input', () => { style.size = +sizeInput.value; sizeVal.textContent = style.size + 'px'; markDirty(); });
baseColor.addEventListener('input', () => { style.base = baseColor.value; markDirty(); });
hiColor.addEventListener('input', () => { style.hi = hiColor.value; markDirty(); });
vposInput.addEventListener('input', () => {
  style.vpos = +vposInput.value;
  vposVal.textContent = style.vpos + '%';
  markDirty();
});
tStroke.addEventListener('click', () => { style.stroke = !style.stroke; syncCustomizeUI(); markDirty(); });
strokeColor.addEventListener('input', () => { style.strokeColor = strokeColor.value; markDirty(); });
strokeW.addEventListener('input', () => { style.strokeW = +strokeW.value; strokeWVal.textContent = style.strokeW + 'px'; markDirty(); });
tShadow.addEventListener('click', () => { style.shadow = !style.shadow; syncCustomizeUI(); markDirty(); });
shadowColor.addEventListener('input', () => { style.shadowColor = shadowColor.value; markDirty(); });
shadowBlur.addEventListener('input', () => { style.shadowBlur = +shadowBlur.value; shadowBlurVal.textContent = style.shadowBlur + 'px'; markDirty(); });
tBg.addEventListener('click', () => { style.bg = !style.bg; syncCustomizeUI(); markDirty(); });
bgColor.addEventListener('input', () => { style.bgColor = bgColor.value; markDirty(); });
bgOpacity.addEventListener('input', () => { style.bgOpacity = +bgOpacity.value; bgOpacityVal.textContent = style.bgOpacity + '%'; markDirty(); });
tCaps.addEventListener('click', () => { style.caps = !style.caps; syncCustomizeUI(); markDirty(); });

// ================================================================
// PHASE 2 — FOOTAGE
// ================================================================
const dropzone = $('#dropzone');
const fileInput = $<HTMLInputElement>('#fileInput');
const fileCard = $('#fileCard');
const fileName = $('#fileName');
const fileInfo = $('#fileInfo');
const fileRemove = $('#fileRemove');
const statusEl = $('#status');
const aiSummary = $('#aiSummary');
const aiDesc = $('#aiDesc');
const aiRerun = $<HTMLButtonElement>('#aiRerun');
const aiChunkingBox = $<HTMLInputElement>('#aiChunking');
const aiEmphasisRow = $('#aiEmphasisRow');
const aiEmphasisFlagBox = $<HTMLInputElement>('#aiEmphasisFlag');
const exportChunksBtn = $<HTMLButtonElement>('#exportChunksBtn');
const importChunksInput = $<HTMLInputElement>('#importChunksInput');

exportChunksBtn.addEventListener('click', () => {
  if (!chunks.length) return;
  downloadChunks({ videoName: videoFile?.name || '', duration: video.duration || 0, words, chunks });
});
function applyChunkPackage(pkg: { videoName: string; words: Word[]; chunks: Chunk[] }) {
  words = pkg.words;
  chunks = pkg.chunks;
  selectedChunk = null;
  aiSummary.textContent = `${chunks.length} caption chunks imported`;
  aiDesc.textContent = pkg.videoName && videoFile && pkg.videoName !== videoFile.name
    ? `Imported from "${pkg.videoName}" — double check timing lines up with this video.`
    : 'Loaded from a previous export — no need to re-transcribe.';
  aiRerun.disabled = !words.length;
  renderTimeline();
  editRow.hidden = true;
  markDirty();
  draw();
}

importChunksInput.addEventListener('change', async () => {
  const f = importChunksInput.files?.[0];
  importChunksInput.value = '';
  if (!f) return;
  try {
    applyChunkPackage(await loadChunksFromFile(f));
  } catch (err: any) {
    window.alert('Could not load that chunks file: ' + err.message);
  }
});
const playBtn = $('#playBtn');
const scrub = $<HTMLInputElement>('#scrub');
const tcCur = $('#tcCur');
const tcTot = $('#tcTot');
const timeline = $('#timeline');
const chunkCount = $('#chunkCount');
const editRow = $('#editRow');
const projectName = $<HTMLInputElement>('#projectName');
const dirtyDot = $('#dirtyDot');
const saveBtn = $('#saveBtn');
const exportBtn = $<HTMLButtonElement>('#exportBtn');
const exportModal = $('#exportModal');

function setStatus(kind: 'good' | 'bad', msg: string) {
  statusEl.hidden = false;
  statusEl.className = 'status ' + kind;
  statusEl.textContent = msg;
}

dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) handleFile(f);
});
['dragenter', 'dragover'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.add('drag'); }));
['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, e => { e.preventDefault(); dropzone.classList.remove('drag'); }));
dropzone.addEventListener('drop', e => {
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) handleFile(f);
});
fileRemove.addEventListener('click', () => {
  videoFile = null;
  video.removeAttribute('src');
  fileCard.hidden = true;
  dropzone.hidden = false;
  emptyState.hidden = false;
  words = []; chunks = [];
  renderTimeline();
  updateAiCard();
});

function handleFile(f: File) {
  videoFile = f;
  video.src = URL.createObjectURL(f);
  dropzone.hidden = true;
  fileCard.hidden = false;
  fileName.textContent = f.name;
  video.addEventListener('loadedmetadata', () => {
    fileInfo.textContent = `${fmtTC(video.duration)} · ${video.videoWidth}×${video.videoHeight}`;
    tcTot.textContent = fmtTC(video.duration);
    emptyState.hidden = true;
    resizeCanvas();
  }, { once: true });
  words = []; chunks = [];
  renderTimeline();
  updateAiCard();
  markDirty();
  runTranscription(f);
}

async function runTranscription(f: File) {
  aiSummary.textContent = 'Transcribing…';
  aiDesc.textContent = 'Extracting audio and running Whisper. This can take a moment.';
  try {
    const { words: w, fps } = await transcribeVideo(f);
    words = w;
    videoFps = fps || 30;
    aiSummary.textContent = `${words.length} words transcribed`;
    aiDesc.textContent = 'Click "Generate captions" to build the timeline for this style.';
    aiRerun.disabled = false;
    aiRerun.textContent = 'Generate captions';
    setStatus('good', `Transcribed ${words.length} words`);
  } catch (err: any) {
    setStatus('bad', 'Transcription failed: ' + err.message);
    aiSummary.textContent = 'Transcription failed';
    aiDesc.textContent = err.message;
  }
}

aiRerun.addEventListener('click', async () => {
  if (!words.length) return;
  aiRerun.disabled = true;
  const wantEmphasis = style.emphasisMode === 'auto' && aiEmphasisFlagBox.checked;
  try {
    let c: Chunk[];
    if (aiChunkingBox.checked) {
      aiRerun.textContent = 'Thinking…';
      ({ chunks: c } = await suggestCaptions(words, { emphasisDetection: wantEmphasis }));
    } else {
      c = autoChunkByFit(words, style, video.videoWidth || 1080);
      if (wantEmphasis) {
        aiRerun.textContent = 'Flagging keywords…';
        ({ chunks: c } = await suggestEmphasis(c));
      }
    }
    chunks = c;
    selectedChunk = null;
    aiSummary.textContent = `${chunks.length} caption chunks generated`;
    aiDesc.textContent = 'Adjust anything in the timeline below.';
    renderTimeline();
    markDirty();
  } catch (err: any) {
    setStatus('bad', 'AI suggestion failed: ' + err.message);
  } finally {
    aiRerun.disabled = false;
    aiRerun.textContent = 'Re-run captions';
  }
});

function updateAiCard() {
  if (!videoFile) {
    aiSummary.textContent = 'Upload a video to begin';
    aiDesc.textContent = '';
    aiRerun.disabled = true;
    aiRerun.textContent = 'Generate captions';
  }
}

// ---------------- playback / canvas ----------------
function fmtTC(t: number) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return String(m).padStart(2, '0') + ':' + s.toFixed(3).padStart(6, '0');
}

function resizeCanvas() {
  cv.width = video.videoWidth || 1080;
  cv.height = video.videoHeight || 1920;
  stage.style.aspectRatio = `${cv.width}/${cv.height}`;
  draw();
}

function draw() {
  if (phase !== 'footage') return;
  drawFrame(ctx, cv, chunks, style, video.currentTime || 0);
}

video.addEventListener('timeupdate', () => {
  tcCur.textContent = fmtTC(video.currentTime);
  scrub.value = video.duration ? String(Math.floor((video.currentTime / video.duration) * 1000)) : '0';
  draw();
  highlightPlayingChunk();
});
video.addEventListener('play', () => { playBtn.innerHTML = pauseIcon(); requestAnimationFrame(loop); });
video.addEventListener('pause', () => { playBtn.innerHTML = playIcon(); });

function loop() {
  if (video.paused) return;
  draw();
  highlightPlayingChunk();
  requestAnimationFrame(loop);
}
playBtn.addEventListener('click', () => { if (video.paused) video.play(); else video.pause(); });
scrub.addEventListener('input', () => {
  if (!video.duration) return;
  video.currentTime = (+scrub.value / 1000) * video.duration;
  draw();
});
function playIcon() { return '<svg width="13" height="13" viewBox="0 0 24 24" fill="#241a04"><path d="M6 4L20 12L6 20V4Z"/></svg>'; }
function pauseIcon() { return '<svg width="13" height="13" viewBox="0 0 24 24" fill="#241a04"><path d="M6 4H10V20H6V4ZM14 4H18V20H14V4Z"/></svg>'; }

// ---------------- timeline + chunk editing ----------------
function renderTimeline() {
  timeline.innerHTML = '';
  chunkCount.textContent = `${chunks.length} chunks · click to edit`;
  exportChunksBtn.disabled = !chunks.length;
  for (const c of chunks) {
    const el = document.createElement('div');
    el.className = 'chunk-block' + (c === selectedChunk ? ' selected' : '');
    const w = Math.max(36, Math.round((c.end - c.start) * 90));
    el.style.width = w + 'px';
    el.innerHTML = `<span class="ctxt">${c.text}</span>`;
    el.addEventListener('click', () => {
      selectedChunk = c;
      video.currentTime = c.start;
      renderTimeline();
      renderEditRow();
    });
    (el as any)._chunk = c;
    timeline.appendChild(el);
  }
}

function highlightPlayingChunk() {
  const t = video.currentTime;
  timeline.querySelectorAll('.chunk-block').forEach(el => {
    const c = (el as any)._chunk as Chunk;
    el.classList.toggle('playing', t >= c.start && t < c.end);
  });
}

/** Recomputes a chunk's start/end/text from its current word list (called after any add/remove/edit). */
function recomputeChunk(c: Chunk) {
  c.text = c.words.map(w => w.word).join(' ');
  c.start = c.words[0].start;
  c.end = c.words[c.words.length - 1].end;
}

function removeWordFromChunk(w: Word) {
  if (!selectedChunk) return;
  const i = selectedChunk.words.indexOf(w);
  if (i === -1) return;
  selectedChunk.words.splice(i, 1);
  if (!selectedChunk.words.length) {
    // an empty chunk has nothing left to show — drop it entirely
    const ci = chunks.indexOf(selectedChunk);
    if (ci !== -1) chunks.splice(ci, 1);
    selectedChunk = null;
  } else {
    recomputeChunk(selectedChunk);
  }
  renderTimeline();
  renderEditRow();
  markDirty();
  draw();
}

function addWordToChunk() {
  if (!selectedChunk) return;
  const text = (window.prompt('New word:') || '').trim();
  if (!text) return;
  // carve a small, safe time slice off the end of the chunk — never touching any
  // existing word's timing, and never overrunning into the next chunk or the video's end.
  const ci = chunks.indexOf(selectedChunk);
  const nextStart = chunks[ci + 1]?.start ?? (video.duration || selectedChunk.end + 0.3);
  const availableGap = Math.max(0.05, nextStart - selectedChunk.end);
  const dur = Math.min(0.3, availableGap - 0.01 > 0.05 ? availableGap - 0.01 : availableGap);
  const start = selectedChunk.end;
  const end = start + dur;
  selectedChunk.words.push({ word: text, start, end });
  recomputeChunk(selectedChunk);
  renderTimeline();
  renderEditRow();
  markDirty();
  draw();
}

function renderEditRow() {
  if (!selectedChunk) { editRow.hidden = true; return; }
  editRow.hidden = false;
  editRow.innerHTML = '';

  const posRow = document.createElement('div');
  posRow.className = 'edit-pos-row';
  const posSlider = makeSlider(
    'Position',
    Math.round(selectedChunk.placement ?? style.vpos),
    0, 100,
    v => { selectedChunk!.placement = v; draw(); },
    '%',
  );
  posRow.appendChild(posSlider);
  // re-render once the drag ends (not on every tick) so the "Reset to default" button appears without disrupting an in-progress drag
  posSlider.querySelector('input')!.addEventListener('change', () => renderEditRow());
  if (selectedChunk.placement !== undefined) {
    const reset = document.createElement('button');
    reset.className = 'edit-pos-reset';
    reset.textContent = 'Reset to default';
    reset.addEventListener('click', () => {
      selectedChunk!.placement = undefined;
      markDirty();
      draw();
      renderEditRow();
    });
    posRow.appendChild(reset);
  }
  editRow.appendChild(posRow);

  for (const w of selectedChunk.words) {
    const span = document.createElement('span');
    span.className = 'edit-word' + (w.emphasis ? ' emphasis' : '');
    span.tabIndex = 0;

    const text = document.createElement('span');
    text.textContent = w.word;
    span.appendChild(text);

    const del = document.createElement('span');
    del.className = 'edit-word-x';
    del.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M6 18L18 6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    del.addEventListener('click', (e) => { e.stopPropagation(); removeWordFromChunk(w); });
    span.appendChild(del);

    span.addEventListener('click', () => {
      w.emphasis = !w.emphasis;
      span.classList.toggle('emphasis', w.emphasis);
      selectedChunk!.text = selectedChunk!.words.map(x => x.word).join(' ');
      markDirty();
      draw();
    });

    span.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      text.contentEditable = 'true';
      text.focus();
      const range = document.createRange();
      range.selectNodeContents(text);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    text.addEventListener('blur', () => {
      if (text.contentEditable !== 'true') return;
      w.word = text.textContent?.trim() || w.word;
      text.contentEditable = 'false';
      selectedChunk!.text = selectedChunk!.words.map(x => x.word).join(' ');
      renderTimeline();
      markDirty();
      draw();
    });
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
    });

    editRow.appendChild(span);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'edit-word-add';
  addBtn.textContent = '+ Add word';
  addBtn.addEventListener('click', addWordToChunk);
  editRow.appendChild(addBtn);

  const hint = document.createElement('span');
  hint.className = 'edit-hint';
  hint.textContent = 'Click to toggle emphasis · double-click to rename · × to remove';
  editRow.appendChild(hint);
}

// ---------------- project save ----------------
projectName.addEventListener('input', markDirty);
saveBtn.addEventListener('click', () => {
  saveProject({
    name: projectName.value,
    videoName: videoFile?.name || '',
    duration: video.duration || 0,
    chunks,
    style,
    customFont: undefined,
  });
});
onDirtyChange(() => { dirtyDot.hidden = !isDirty(); });

// ---------------- export ----------------
exportBtn.addEventListener('click', () => { exportModal.hidden = false; });
$('#exportClose').addEventListener('click', () => { exportModal.hidden = true; });
$('#exportPng').addEventListener('click', () => runExport('png'));
$('#exportMp4').addEventListener('click', () => runExport('mp4'));
$('#exportProRes').addEventListener('click', () => runExport('prores'));

async function runExport(kind: 'png' | 'mp4' | 'prores') {
  if (!chunks.length || !video.duration) return;
  const progressWrap = $('#exportProgress');
  const bar = $('#exportBar');
  const label = $('#exportLabel');
  progressWrap.hidden = false;
  const onProgress = (pct: number, msg: string) => { bar.style.width = pct + '%'; label.textContent = msg; };
  const w = video.videoWidth || 1080, h = video.videoHeight || 1920;
  const ext = kind === 'png' ? 'zip' : kind === 'mp4' ? 'mp4' : 'mov';
  try {
    const blob = kind === 'png'
      ? await exportPngSequence(chunks, style, video.duration, w, h, videoFps, onProgress)
      : kind === 'mp4'
      ? await exportPreviewMp4(chunks, style, video.duration, w, h, videoFps, onProgress)
      : await exportProResAlpha(chunks, style, video.duration, w, h, videoFps, onProgress);
    const videoStem = (videoFile?.name || projectName.value || 'punch').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${videoStem}_overlay.${ext}`;
    a.click();
    // bundle the chunks + style alongside the overlay, all sharing the source video's
    // name, so the export folder is self-contained and rebuildable without redoing AI work
    setTimeout(() => downloadChunks({ videoName: videoFile?.name || '', duration: video.duration || 0, words, chunks }, videoStem), 250);
    setTimeout(() => downloadStyle(currentStyleName, style, videoStem), 500);
    label.textContent = 'Done — overlay + chunks + style downloaded';
  } catch (err: any) {
    label.textContent = 'Export failed: ' + err.message;
  }
}

// ================================================================
// PHASE 0 — LANDING
// ================================================================
const landingStyleInput = $<HTMLInputElement>('#landingStyleInput');
const landingChunksInput = $<HTMLInputElement>('#landingChunksInput');
const landingStyleChip = $('#landingStyleChip');
const landingChunksChip = $('#landingChunksChip');
const landingStartBtn = $<HTMLButtonElement>('#landingStartBtn');

let pendingStyle: { name: string; style: StylePreset } | null = null;
let pendingChunks: Awaited<ReturnType<typeof loadChunksFromFile>> | null = null;

landingStyleInput.addEventListener('change', async () => {
  const f = landingStyleInput.files?.[0];
  landingStyleInput.value = '';
  if (!f) return;
  try {
    pendingStyle = await loadStyleFromFile(f);
    landingStyleChip.hidden = false;
    landingStyleChip.innerHTML = `<span>${pendingStyle.name}</span><span class="tag">loaded</span>`;
  } catch (err: any) {
    window.alert('Could not load that style file: ' + err.message);
  }
});
landingChunksInput.addEventListener('change', async () => {
  const f = landingChunksInput.files?.[0];
  landingChunksInput.value = '';
  if (!f) return;
  try {
    pendingChunks = await loadChunksFromFile(f);
    landingChunksChip.hidden = false;
    landingChunksChip.innerHTML = `<span>${pendingChunks.chunks.length} chunks (${f.name})</span><span class="tag">loaded</span>`;
  } catch (err: any) {
    window.alert('Could not load that chunks file: ' + err.message);
  }
});
landingStartBtn.addEventListener('click', () => {
  if (pendingChunks) applyChunkPackage(pendingChunks);
  if (pendingStyle) {
    applyLoadedStyle(pendingStyle.name, pendingStyle.style);
    setPhase('footage');
  } else {
    setPhase('style');
  }
});

// ---------------- browse global library ----------------
const browseGlobalBtn = $<HTMLButtonElement>('#browseGlobalBtn');
const globalLibraryModal = $('#globalLibraryModal');
const globalLibraryStatus = $('#globalLibraryStatus');
const globalLibraryGrid = $('#globalLibraryGrid');
const globalLibraryClose = $('#globalLibraryClose');

browseGlobalBtn.addEventListener('click', async () => {
  globalLibraryModal.hidden = false;
  globalLibraryGrid.innerHTML = '';
  globalLibraryStatus.textContent = 'Loading…';
  try {
    const styles = await fetchGlobalStyles();
    globalLibraryStatus.textContent = `${styles.length} shared styles`;
    if (!styles.length) {
      globalLibraryGrid.innerHTML = '<div class="global-lib-empty">No styles saved yet — build one and click "Save to global library" to be the first.</div>';
      return;
    }
    for (const entry of styles) {
      const card = document.createElement('button');
      card.className = 'global-lib-card';
      const img = document.createElement('img');
      img.src = entry.preview || '';
      img.alt = entry.name;
      const name = document.createElement('div');
      name.className = 'glc-name';
      name.textContent = entry.name;
      card.appendChild(img);
      card.appendChild(name);
      card.addEventListener('click', () => {
        pendingStyle = { name: entry.name, style: entry.style };
        landingStyleChip.hidden = false;
        landingStyleChip.innerHTML = `<span>${entry.name}</span><span class="tag">loaded</span>`;
        globalLibraryModal.hidden = true;
      });
      globalLibraryGrid.appendChild(card);
    }
  } catch (err: any) {
    globalLibraryStatus.textContent = err.message;
  }
});
globalLibraryClose.addEventListener('click', () => { globalLibraryModal.hidden = true; });

// ================================================================
// init (gated behind the shared-password check, when one is configured)
// ================================================================
function boot() {
  renderWizard();
  renderTimeline();

  const existing = loadProject();
  if (existing && existing.chunks?.length) {
    projectName.value = existing.name;
    chunks = existing.chunks;
    style = existing.style;
    currentStyleName = style.name || 'Custom';
    wizardDone = true;
    fineTuneSection.hidden = false;
    styleActionsWrap.hidden = false;
    syncCustomizeUI();
    renderWizard();
    renderTimeline();
    setPhase('footage');
  } else {
    setPhase('landing');
  }
}

(async () => {
  const required = await checkAuthRequired();
  if (!required) { boot(); return; }

  const stored = getStoredPassword();
  if (stored && await verifyPassword(stored)) { boot(); return; }

  const gate = $('#authGate');
  const form = $<HTMLFormElement>('#authGateForm');
  const input = $<HTMLInputElement>('#authGateInput');
  const error = $('#authGateError');
  gate.hidden = false;
  input.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = input.value;
    if (await verifyPassword(pw)) {
      setStoredPassword(pw);
      gate.hidden = true;
      boot();
    } else {
      error.hidden = false;
      input.select();
    }
  });
})();
