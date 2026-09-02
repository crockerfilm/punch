export interface Word {
  word: string;
  start: number;
  end: number;
  emphasis?: boolean;
}

export interface Chunk {
  text: string;
  start: number;
  end: number;
  words: Word[];
  /** 0-100 (% down the frame), set manually per-chunk. Undefined = inherit style.vpos. */
  placement?: number;
}

/** Entrance behavior only — how a chunk (or its words) appears. Highlight-while-spoken is `emphasisMode: 'karaoke'`, a separate axis. */
export type AnimationStyle = 'none' | 'pop' | 'fade' | 'slide-up' | 'word-reveal';

/** How the "important" word is chosen: AI picks one fixed word per chunk, or whichever word is being spoken right now, or no distinction at all. */
export type EmphasisMode = 'auto' | 'karaoke' | 'none';

/** Visual treatment applied to the emphasized word (meaningless when emphasisMode is 'none'). */
export type EmphasisStyle = 'color' | 'scale' | 'box' | 'underline' | 'glow';

export interface StylePreset {
  name: string;
  font: string;
  size: number;
  base: string;
  hi: string;
  stroke: boolean;
  strokeColor: string;
  strokeW: number;
  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  bg: boolean;
  bgColor: string;
  bgOpacity: number;
  caps: boolean;
  /** 0-100 (% down the frame). Default position for any chunk without its own manual override. */
  vpos: number;
  animation: AnimationStyle;
  /** Entrance duration in ms. Applies to fade/pop/slide-up/word-reveal. */
  animSpeedMs: number;
  /** 0-100: how much overshoot the entrance has. Applies to pop/word-reveal (and lightly to slide-up). */
  animBounce: number;
  /** 100-180: how far past full size the entrance overshoots at its peak. Applies to pop/word-reveal. */
  animScale: number;
  emphasisMode: EmphasisMode;
  emphasisStyle: EmphasisStyle;
  /** 100-180: size of the emphasized word, for emphasisStyle 'scale'. */
  emphasisScale: number;
  /** 0-100: underline thickness, for emphasisStyle 'underline'. */
  emphasisUnderline: number;
  /** 0-100: glow intensity, for emphasisStyle 'glow'. */
  emphasisGlow: number;
  /** 0-100: box padding, for emphasisStyle 'box'. */
  emphasisBoxPad: number;
  /** Show only the single currently-active word on screen, replacing the previous one. */
  oneWordMode: boolean;
}

export interface Project {
  name: string;
  videoName: string;
  duration: number;
  chunks: Chunk[];
  style: StylePreset;
  customFont?: { name: string; dataUrl: string };
}
