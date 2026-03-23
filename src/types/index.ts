// Layer Types
export type BlendMode =
  | 'source-over'   // Normal
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface Layer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  visible: boolean;
  opacity: number;
  locked: boolean;
  blendMode?: BlendMode;
}

// Drawing Tool Types
export type ToolType =
  | 'brush'
  | 'eraser'
  | 'line'
  | 'rectangle'
  | 'circle'
  | 'fill'
  | 'eyedropper'
  | 'move'
  | 'gradient'
  | 'smudge'
  | 'select'
  | 'text';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
  timestamp: number;
}

export interface Stroke {
  id: string;
  points: Point[];
  tool: ToolType;
  color: string;
  size: number;
  opacity: number;
  layerId: string;
  mirrorAxisX?: number;
}

// Animation Types
export interface AnimationFrame {
  id: string;
  frameNumber: number;
  strokes: Stroke[];
  duration: number; // in milliseconds
  timeMs?: number; // sampled playback time for event-based animation
  thumbnail?: string; // data URL for timelapse export
  /** Runtime-only: pre-decoded canvas snapshot for fast playback.
   *  Not serialized to localStorage — rebuilt from thumbnail on play. */
  snapshot?: HTMLCanvasElement;
  /** Runtime-only: tiny hash of the composited frame, used to suppress accidental duplicates. */
  contentHash?: string;
}

export interface AnimationProject {
  name: string;
  frames: AnimationFrame[];
  fps: number;
  width: number;
  height: number;
  totalDuration: number;
}

export interface RenderSettings {
  fps: number;
  width: number;
  height: number;
  speed: number; // 0.5x, 1x, 2x, etc.
  format: 'mp4' | 'webm' | 'gif';
  quality: 'low' | 'medium' | 'high';
}

// Tool Settings
export interface ToolSettings {
  size: number;
  opacity: number;
  color: string;
  hardness: number;
  spacing: number;
  fillTolerance: number;
  fillContiguous: boolean;
  shapeFilled: boolean;
  gradientType: 'linear' | 'radial';
  fontFamily: string;
}

export type BackgroundPattern = 'solid' | 'dots' | 'grid' | 'graph' | 'checker' | 'ruled';

export interface BackgroundSettings {
  width: number;
  height: number;
  pattern: BackgroundPattern;
  pixelSize: number;
  patternOffsetX: number;
  patternOffsetY: number;
  aspectPreset: string;
  primaryColor: string;
  secondaryColor: string;
  transparent: boolean;
}

// Brush Preset
export interface BrushPreset {
  id: string;
  name: string;
  size: number;
  hardness: number;
  spacing: number;
  opacity: number;
}

// History for Undo/Redo
export interface HistoryState {
  layerId: string;
  imageData: ImageData;
}

// UI State
export interface UIState {
  activeTool: ToolType;
  activeLayerId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
}
