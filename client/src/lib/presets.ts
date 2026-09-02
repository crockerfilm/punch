import type { StylePreset } from './types';

const ANIM_DEFAULTS = { animSpeedMs: 180, animBounce: 60, animScale: 130 };
const EMPHASIS_DEFAULTS = { emphasisScale: 116, emphasisUnderline: 40, emphasisGlow: 50, emphasisBoxPad: 43 };

export const PRESETS: Record<string, StylePreset> = {
  punch: {
    name: 'PUNCH', font: 'Space Grotesk', size: 88, base: '#FFFFFF', hi: '#F0B34C',
    stroke: true, strokeColor: '#000000', strokeW: 4,
    shadow: false, shadowColor: '#000000', shadowBlur: 6,
    bg: false, bgColor: '#000000', bgOpacity: 70,
    caps: true, vpos: 66, animation: 'pop', ...ANIM_DEFAULTS,
    emphasisMode: 'auto', emphasisStyle: 'color', ...EMPHASIS_DEFAULTS, oneWordMode: false,
  },
  clean: {
    name: 'CLEAN', font: 'Inter', size: 64, base: '#FFFFFF', hi: '#4EA8FE',
    stroke: false, strokeColor: '#000000', strokeW: 0,
    shadow: true, shadowColor: '#000000', shadowBlur: 12,
    bg: true, bgColor: '#000000', bgOpacity: 55,
    caps: false, vpos: 82, animation: 'fade', ...ANIM_DEFAULTS,
    emphasisMode: 'auto', emphasisStyle: 'underline', ...EMPHASIS_DEFAULTS, oneWordMode: false,
  },
  neon: {
    name: 'NEON', font: 'Space Grotesk', size: 85, base: '#FFFFFF', hi: '#00FF88',
    stroke: true, strokeColor: '#004422', strokeW: 2,
    shadow: true, shadowColor: '#00FF88', shadowBlur: 18,
    bg: false, bgColor: '#000000', bgOpacity: 70,
    caps: true, vpos: 66, animation: 'none', ...ANIM_DEFAULTS,
    emphasisMode: 'auto', emphasisStyle: 'glow', ...EMPHASIS_DEFAULTS, oneWordMode: true,
  },
  mono: {
    name: 'MONO', font: 'Inter', size: 58, base: '#FFFFFF', hi: '#FFFFFF',
    stroke: false, strokeColor: '#000000', strokeW: 0,
    shadow: true, shadowColor: '#000000', shadowBlur: 10,
    bg: true, bgColor: '#000000', bgOpacity: 60,
    caps: false, vpos: 82, animation: 'none', ...ANIM_DEFAULTS,
    emphasisMode: 'karaoke', emphasisStyle: 'color', ...EMPHASIS_DEFAULTS, oneWordMode: false,
  },
};

export const DEFAULT_STYLE: StylePreset = { ...PRESETS.punch };

// A curated (not exhaustive) spread of bold/clean/playful/editorial options —
// enough range for creator-style captions without dredging the full Google Fonts catalog.
export const FONT_CHOICES: string[] = [
  'Space Grotesk', 'Inter', 'Impact', 'Arial Black',
  'Anton', 'Bebas Neue', 'Archivo Black', 'Oswald',
  'Poppins', 'Montserrat', 'Bangers', 'Permanent Marker',
  'Righteous', 'Playfair Display',
];

export const ANIMATIONS: { value: StylePreset['animation']; label: string; hideOneWord?: boolean }[] = [
  { value: 'none', label: 'None (static)' },
  { value: 'pop', label: 'Pop in' },
  { value: 'fade', label: 'Fade in' },
  { value: 'slide-up', label: 'Slide up' },
  { value: 'word-reveal', label: 'Word-by-word reveal', hideOneWord: true },
];

export const EMPHASIS_MODES: { value: StylePreset['emphasisMode']; label: string; desc: string; hideOneWord?: boolean }[] = [
  { value: 'auto', label: 'Auto', desc: 'AI picks one standout word per chunk — stays fixed' },
  // in one-word mode, the only word ever on screen IS the one being spoken, so this has nothing to contrast against
  { value: 'karaoke', label: 'As-spoken', desc: 'Highlight follows whichever word is being said', hideOneWord: true },
  { value: 'none', label: 'Neither', desc: 'No word stands out from the rest' },
];

export const EMPHASIS_STYLES: { value: StylePreset['emphasisStyle']; label: string; desc: string }[] = [
  { value: 'color', label: 'Color pop', desc: 'Just recolor the word' },
  { value: 'scale', label: 'Scale pop', desc: 'Recolor and render it slightly bigger' },
  { value: 'box', label: 'Highlight box', desc: 'A colored chip behind just that word' },
  { value: 'underline', label: 'Underline', desc: 'Recolor with a bar underneath' },
  { value: 'glow', label: 'Glow', desc: 'Recolor with a soft colored glow' },
];
