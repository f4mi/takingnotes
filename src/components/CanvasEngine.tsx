import React, { useRef, useEffect, useLayoutEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import type { Layer, ToolType, Point, Stroke, ToolSettings, BackgroundSettings, AnimationFrame } from '@/types';
import {
  drawBrushStroke,
  drawEraserStroke,
  drawLine,
  drawRectangle,
  drawCircle,
  drawText,
  floodFill,
  generateId,
  drawBackgroundToContext,
  mergeVisibleLayersToCanvas
} from '@/utils/helpers';

// ── DPI helpers ───────────────────────────────────────────────────────────
/** Current device-pixel-ratio, clamped to [1, 4]. */
function getDpr(): number {
  return Math.max(1, Math.min(window.devicePixelRatio || 1, 4));
}

function getFrequentReadContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d')!;
}

/** Clear a display canvas at full physical resolution, then re-apply the
 *  DPI scale so subsequent draw calls work in logical coordinates. */
function clearDisplayCanvas(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Constrain an endpoint relative to a start point for Shift-held shapes.
 *  Line: snaps to nearest 45° angle.
 *  Rectangle: forces a square.
 *  Circle: no change needed (already radial). */
function constrainPoint(start: { x: number; y: number }, end: { x: number; y: number }, tool: string): { x: number; y: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (tool === 'line') {
    const angle = Math.atan2(dy, dx);
    const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
    const dist = Math.sqrt(dx * dx + dy * dy);
    return { x: start.x + Math.cos(snapped) * dist, y: start.y + Math.sin(snapped) * dist };
  }
  if (tool === 'rectangle') {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: start.x + side * Math.sign(dx || 1), y: start.y + side * Math.sign(dy || 1) };
  }
  return end;
}

// ── Component ─────────────────────────────────────────────────────────────
interface CanvasEngineProps {
  width: number;
  height: number;
  layers: Layer[];
  activeLayerId: string | null;
  activeTool: ToolType;
  toolSettings: ToolSettings;
  backgroundSettings: BackgroundSettings;
  zoom: number;
  showGrid: boolean;
  onStrokeComplete?: (stroke: Stroke) => void;
  onSaveState?: (layerId: string, imageData: ImageData) => void;
  onColorPick?: (color: string) => void;
  onCursorMove?: (x: number, y: number) => void;
  onSelectionChange?: (sel: SelectionRect | null) => void;
  onLayerVisibilityFix?: (layerId: string, updates: Partial<Layer>) => void;
  onDrawingStateChange?: (isDrawing: boolean) => void;
  selection?: SelectionRect | null;
  symmetryX?: boolean;
  bgColor?: string;
  penCursor?: { x: number; y: number; pressure: number; active: boolean } | null;
  viewRotation?: 0 | 90 | 180 | 270;
}

export interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type TransformHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface FreeTransformSession {
  layerId: string;
  sourceRect: SelectionRect;
  bounds: SelectionRect;
  sourceCanvas: HTMLCanvasElement;
}

interface TransformDragState {
  handle: TransformHandle;
  pointerStart: Point;
  startBounds: SelectionRect;
}

interface SelectionDragState {
  mode: 'create' | 'move';
  pointerStart: Point;
  startSelection: SelectionRect | null;
}

interface TextSession {
  x: number;
  y: number;
  draft: string;
  visible: boolean;
}

interface TextLayoutMetrics {
  width: number;
  height: number;
  lineHeight: number;
}

function normalizeRect(rect: SelectionRect): SelectionRect {
  return {
    x: Math.min(rect.x, rect.x + rect.w),
    y: Math.min(rect.y, rect.y + rect.h),
    w: Math.max(1, Math.abs(rect.w)),
    h: Math.max(1, Math.abs(rect.h)),
  };
}

function clampSelectionToCanvas(rect: SelectionRect, width: number, height: number): SelectionRect | null {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = Math.min(width, rect.x + rect.w);
  const bottom = Math.min(height, rect.y + rect.h);

  if (right - left < 1 || bottom - top < 1) return null;

  return {
    x: Math.round(left),
    y: Math.round(top),
    w: Math.round(right - left),
    h: Math.round(bottom - top),
  };
}

function pointInSelection(point: Point, selection: SelectionRect | null): boolean {
  if (!selection) return false;
  return (
    point.x >= selection.x
    && point.x <= selection.x + selection.w
    && point.y >= selection.y
    && point.y <= selection.y + selection.h
  );
}

function buildMarqueeRect(
  start: Point,
  end: Point,
  options: { fromCenter: boolean; constrainSquare: boolean },
): SelectionRect {
  let dx = end.x - start.x;
  let dy = end.y - start.y;

  if (options.constrainSquare) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = side * Math.sign(dx || 1);
    dy = side * Math.sign(dy || 1);
  }

  if (options.fromCenter) {
    return normalizeRect({
      x: start.x - dx,
      y: start.y - dy,
      w: dx * 2,
      h: dy * 2,
    });
  }

  return normalizeRect({
    x: start.x,
    y: start.y,
    w: dx,
    h: dy,
  });
}

function offsetSelectionWithinCanvas(
  selection: SelectionRect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): SelectionRect {
  const normalized = normalizeRect(selection);
  const nextX = Math.max(0, Math.min(width - normalized.w, normalized.x + dx));
  const nextY = Math.max(0, Math.min(height - normalized.h, normalized.y + dy));
  return {
    x: Math.round(nextX),
    y: Math.round(nextY),
    w: normalized.w,
    h: normalized.h,
  };
}

function getTransformHandleSize(zoom: number): number {
  return Math.max(8, 12 / Math.max(zoom, 0.1));
}

function getRotatedDisplaySize(width: number, height: number, rotation: 0 | 90 | 180 | 270) {
  if (rotation === 90 || rotation === 270) {
    return { width: height, height: width };
  }
  return { width, height };
}

function measureTextLayout(
  text: string,
  fontSize: number,
  fontFamily: string,
): TextLayoutMetrics {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const lineHeight = fontSize * 1.2;
  if (!ctx) {
    return {
      width: fontSize * 8,
      height: lineHeight,
      lineHeight,
    };
  }

  ctx.font = `${fontSize}px ${fontFamily}`;
  const lines = (text.length > 0 ? text : ' ').split('\n');
  const width = lines.reduce((maxWidth, line) => Math.max(maxWidth, ctx.measureText(line || ' ').width), 0);
  return {
    width: Math.max(fontSize * 0.7, Math.ceil(width)),
    height: Math.max(lineHeight, Math.ceil(lines.length * lineHeight)),
    lineHeight,
  };
}

function getTransformHandleAtPoint(
  point: Point,
  bounds: SelectionRect,
  handleSize: number,
): TransformHandle | null {
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.w;
  const bottom = bounds.y + bounds.h;
  const midX = left + bounds.w / 2;
  const midY = top + bounds.h / 2;
  const hs = handleSize;

  const hitBox = (cx: number, cy: number) =>
    point.x >= cx - hs && point.x <= cx + hs && point.y >= cy - hs && point.y <= cy + hs;

  if (hitBox(left, top)) return 'nw';
  if (hitBox(right, top)) return 'ne';
  if (hitBox(left, bottom)) return 'sw';
  if (hitBox(right, bottom)) return 'se';
  if (hitBox(midX, top)) return 'n';
  if (hitBox(midX, bottom)) return 's';
  if (hitBox(left, midY)) return 'w';
  if (hitBox(right, midY)) return 'e';

  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) {
    return 'move';
  }

  return null;
}

function resizeTransformBounds(
  startBounds: SelectionRect,
  handle: TransformHandle,
  dx: number,
  dy: number,
): SelectionRect {
  if (handle === 'move') {
    return {
      x: startBounds.x + dx,
      y: startBounds.y + dy,
      w: startBounds.w,
      h: startBounds.h,
    };
  }

  let left = startBounds.x;
  let top = startBounds.y;
  let right = startBounds.x + startBounds.w;
  let bottom = startBounds.y + startBounds.h;

  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;

  return normalizeRect({
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
  });
}

function getTransformCursor(handle: TransformHandle | null): string {
  switch (handle) {
    case 'move':
      return 'move';
    case 'n':
    case 's':
      return 'ns-resize';
    case 'e':
    case 'w':
      return 'ew-resize';
    case 'nw':
    case 'se':
      return 'nwse-resize';
    case 'ne':
    case 'sw':
      return 'nesw-resize';
    default:
      return 'default';
  }
}

interface CanvasEngineRef {
  renderFrame: (frame: AnimationFrame) => void;
  clearCanvas: () => void;
  getMergedCanvas: () => HTMLCanvasElement;
  applyHistory: (layerId: string, imageData: ImageData) => void;
  recomposite: (mode?: 'full' | 'active') => void;
  startFreeTransform: () => boolean;
  commitFreeTransform: () => boolean;
  cancelFreeTransform: () => boolean;
  isFreeTransformActive: () => boolean;
}

export const CanvasEngine = forwardRef<CanvasEngineRef, CanvasEngineProps>(({
  width,
  height,
  layers,
  activeLayerId,
  activeTool,
  toolSettings,
  backgroundSettings,
  zoom,
  showGrid,
  onStrokeComplete,
  onSaveState,
  onColorPick,
  onCursorMove,
  onSelectionChange,
  onLayerVisibilityFix,
  onDrawingStateChange,
  selection,
  symmetryX = false,
  bgColor = '#ffffff',
  penCursor,
  viewRotation = 0,
}, ref) => {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const gridCanvasRef = useRef<HTMLCanvasElement>(null);

  const [_isDrawing, _setIsDrawing] = useState(false);
  const isDrawingRef = useRef(false);
  const setIsDrawing = useCallback((v: boolean) => {
    isDrawingRef.current = v;
    _setIsDrawing(v);
  }, []);
  const [renderTick, setRenderTick] = useState(0);
  const compositeRafRef = useRef<number | null>(null);
  const currentStrokeRef = useRef<Point[]>([]);
  const startPointRef = useRef<Point | null>(null);
  const lastPointRef = useRef<Point | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeTouchPointersRef = useRef<Set<number>>(new Set());
  const strokeCommittedRef = useRef(false);
  // Stroke buffer: draw the current brush/eraser stroke at full opacity here,
  // then composite onto the layer with the desired opacity once on pointerUp.
  // This prevents opacity doubling where overlapping segments meet (PS behavior).
  const strokeBufferRef = useRef<HTMLCanvasElement | null>(null);
  const preStrokeImageRef = useRef<ImageData | null>(null);
  // Shift+click straight line: remember where the last stroke ended
  const lastStrokeEndRef = useRef<Point | null>(null);
  const tabletDataRef = useRef<{ pressure: number; tiltX: number; tiltY: number }>({ pressure: 1, tiltX: 0, tiltY: 0 });

  const [textSession, setTextSession] = useState<TextSession | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const textSessionRef = useRef<TextSession | null>(null);
  const suppressTextBlurCommitRef = useRef(false);
  const [freeTransformSession, setFreeTransformSession] = useState<FreeTransformSession | null>(null);
  const freeTransformSessionRef = useRef<FreeTransformSession | null>(null);
  const transformDragRef = useRef<TransformDragState | null>(null);
  const selectionDragRef = useRef<SelectionDragState | null>(null);
  const transformCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [transformHoverHandle, setTransformHoverHandle] = useState<TransformHandle | null>(null);

  // ── Reactive DPI ────────────────────────────────────────────────────────
  // Re-render when the browser's devicePixelRatio changes (window moved to
  // another display, OS zoom changed, etc.)
  const [dpr, setDpr] = useState(getDpr);
  useEffect(() => {
    let mql: MediaQueryList;
    const update = () => { setDpr(getDpr()); subscribe(); };
    const subscribe = () => {
      mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      mql.addEventListener('change', update, { once: true });
    };
    subscribe();
    return () => mql?.removeEventListener('change', update);
  }, []);

  // Ref mirror so hot-path pointer callbacks can read dpr without needing
  // it in their dependency arrays.
  const dprRef = useRef(dpr);
  useEffect(() => { dprRef.current = dpr; }, [dpr]);
  useEffect(() => { textSessionRef.current = textSession; }, [textSession]);
  useEffect(() => { freeTransformSessionRef.current = freeTransformSession; }, [freeTransformSession]);
  useEffect(() => {
    if (!freeTransformSession) {
      transformDragRef.current = null;
      setTransformHoverHandle(null);
    }
  }, [freeTransformSession]);

  const displayWidth = width * zoom;
  const displayHeight = height * zoom;
  const rotatedDisplaySize = getRotatedDisplaySize(displayWidth, displayHeight, viewRotation);
  const textFontSize = toolSettings.size * 4;

  const requestComposite = useCallback(() => {
    if (compositeRafRef.current !== null) return;
    compositeRafRef.current = requestAnimationFrame(() => {
      compositeRafRef.current = null;
      setRenderTick((t) => t + 1);
    });
  }, [activeLayerId, activeTool, layers.length]);

  useEffect(() => () => {
    if (compositeRafRef.current !== null) {
      cancelAnimationFrame(compositeRafRef.current);
    }
  }, []);

  const focusTextInput = useCallback(() => {
    requestAnimationFrame(() => {
      textInputRef.current?.focus();
    });
  }, []);

  const commitTextSession = useCallback((sessionOverride?: TextSession | null) => {
    const session = sessionOverride ?? textSessionRef.current;
    if (!session?.visible) {
      setTextSession(null);
      return false;
    }

    const draft = session.draft.trim();
    if (draft && activeLayerId) {
      const activeLayer = layers.find((layer) => layer.id === activeLayerId);
      if (activeLayer && !activeLayer.locked) {
        const imgData = activeLayer.ctx.getImageData(0, 0, width, height);
        onSaveState?.(activeLayerId, imgData);
        drawText(
          activeLayer.ctx,
          session.draft,
          session.x,
          session.y,
          toolSettings.color,
          textFontSize,
          toolSettings.opacity,
          toolSettings.fontFamily,
        );
        requestComposite();
      }
    }

    setTextSession(null);
    return Boolean(draft);
  }, [activeLayerId, layers, onSaveState, requestComposite, textFontSize, toolSettings.color, toolSettings.fontFamily, toolSettings.opacity, width]);

  const cancelTextSession = useCallback(() => {
    setTextSession(null);
  }, []);

  const beginTextSession = useCallback((x: number, y: number) => {
    setTextSession({
      x,
      y,
      draft: '',
      visible: true,
    });
    focusTextInput();
  }, [focusTextInput]);

  useEffect(() => {
    if (activeTool !== 'text' && textSessionRef.current?.visible) {
      commitTextSession();
    }
  }, [activeTool, commitTextSession]);

  useEffect(() => {
    const input = textInputRef.current;
    if (!input || activeTool !== 'text' || !textSession?.visible) return;
    const metrics = measureTextLayout(textSession.draft, textFontSize, toolSettings.fontFamily);
    input.style.width = `${Math.max(24, metrics.width * zoom + 8)}px`;
    input.style.height = `${Math.max(metrics.lineHeight * zoom, metrics.height * zoom + 4)}px`;
  }, [activeTool, textFontSize, textSession, toolSettings.fontFamily, zoom]);

  const drawGridCanvasBase = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, d: number) => {
    clearDisplayCanvas(ctx, canvas, d);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      const gridSize = Math.max(4, Math.round(backgroundSettings.pixelSize || 20));
      for (let x = 0; x <= width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y <= height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    if (symmetryX) {
      ctx.save();
      ctx.setLineDash([6, 3]);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.stroke();
      ctx.restore();
    }
  }, [backgroundSettings.pixelSize, height, showGrid, symmetryX, width]);

  // ── Resize display canvases when logical size or dpr changes ────────────
  // Display canvases get a backing store of (logical × dpr) physical pixels
  // while their CSS size stays at (logical × zoom).  This makes the grid
  // overlay and shape previews render crisply on HiDPI displays.
  // Layer canvases are NOT affected — they stay at document resolution.
  useLayoutEffect(() => {
    const d = getDpr();
    [mainCanvasRef, previewCanvasRef, gridCanvasRef].forEach((r) => {
      const c = r.current;
      if (!c) return;
      const pw = Math.round(width * d);
      const ph = Math.round(height * d);
      if (c.width !== pw || c.height !== ph) {
        c.width = pw;
        c.height = ph;
      }
    });
  }, [width, height, dpr, viewRotation]);

  // ── Grid overlay (grid canvas only) ─────────────────────────────────────
  useLayoutEffect(() => {
    const gridCanvas = gridCanvasRef.current;
    if (!gridCanvas) return;
    const d = getDpr();
    const ctx = gridCanvas.getContext('2d');
    if (!ctx) return;

    drawGridCanvasBase(ctx, gridCanvas, d);
  }, [width, height, selection, dpr, drawGridCanvasBase, viewRotation]);

  useLayoutEffect(() => {
    const previewCanvas = previewCanvasRef.current;
    if (!previewCanvas) return;
    const previewCtx = previewCanvas.getContext('2d');
    if (!previewCtx) return;

    if (activeTool !== 'text') {
      clearDisplayCanvas(previewCtx, previewCanvas, dprRef.current);
      return;
    }

    clearDisplayCanvas(previewCtx, previewCanvas, dprRef.current);
    if (!textSession?.visible) return;

    const metrics = measureTextLayout(textSession.draft, textFontSize, toolSettings.fontFamily);
    previewCtx.save();
    previewCtx.strokeStyle = 'rgba(96, 165, 250, 0.75)';
    previewCtx.lineWidth = 1;
    previewCtx.beginPath();
    previewCtx.moveTo(textSession.x, textSession.y);
    previewCtx.lineTo(textSession.x, textSession.y + metrics.lineHeight);
    previewCtx.stroke();
    previewCtx.restore();
  }, [activeTool, textFontSize, textSession, toolSettings.fontFamily, viewRotation]);

  // ── Selection marching ants overlay ────────────────────────────────────
  const marchOffsetRef = useRef(0);
  useLayoutEffect(() => {
    if (!selection && !freeTransformSession) return;
    const gridCanvas = gridCanvasRef.current;
    if (!gridCanvas) return;
    const d = getDpr();
    const ctx = gridCanvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      drawGridCanvasBase(ctx, gridCanvas, d);

      if (freeTransformSession) {
        const bounds = freeTransformSession.bounds;
        const handleRadius = getTransformHandleSize(zoom) * 0.6;
        const handlePoints = [
          { x: bounds.x, y: bounds.y },
          { x: bounds.x + bounds.w / 2, y: bounds.y },
          { x: bounds.x + bounds.w, y: bounds.y },
          { x: bounds.x, y: bounds.y + bounds.h / 2 },
          { x: bounds.x + bounds.w, y: bounds.y + bounds.h / 2 },
          { x: bounds.x, y: bounds.y + bounds.h },
          { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h },
          { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
        ];

        ctx.save();
        ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
        ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(96, 165, 250, 0.95)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
        ctx.setLineDash([]);
        ctx.fillStyle = '#0b1220';
        ctx.strokeStyle = '#93c5fd';
        handlePoints.forEach((handlePoint) => {
          ctx.beginPath();
          ctx.rect(handlePoint.x - handleRadius, handlePoint.y - handleRadius, handleRadius * 2, handleRadius * 2);
          ctx.fill();
          ctx.stroke();
        });
        ctx.restore();
        return;
      }

      if (!selection) return;

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = marchOffsetRef.current;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.strokeStyle = '#000';
      ctx.lineDashOffset = marchOffsetRef.current + 4;
      ctx.strokeRect(selection.x, selection.y, selection.w, selection.h);
      ctx.restore();
    };

    draw();
    if (freeTransformSession) return;
    const interval = setInterval(() => {
      marchOffsetRef.current = (marchOffsetRef.current + 1) % 8;
      draw();
    }, 150);
    return () => clearInterval(interval);
  }, [selection, freeTransformSession, dpr, drawGridCanvasBase, height, width, zoom, viewRotation]);

  // ── Composite visible layers → main display canvas ──────────────────────
  useLayoutEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    if (!mainCanvas) return;
    const d = getDpr();
    const ctx = mainCanvas.getContext('2d');
    if (!ctx) return;

    clearDisplayCanvas(ctx, mainCanvas, d);
    drawBackgroundToContext(ctx, width, height, backgroundSettings);

    layers.forEach((layer) => {
      if (!layer.visible) return;
      ctx.save();
      ctx.globalAlpha = layer.opacity / 100;
      ctx.globalCompositeOperation = layer.blendMode ?? 'source-over';
      if (freeTransformSession && layer.id === freeTransformSession.layerId) {
        let tempCanvas = transformCompositeCanvasRef.current;
        if (!tempCanvas || tempCanvas.width !== width || tempCanvas.height !== height) {
          tempCanvas = document.createElement('canvas');
          tempCanvas.width = width;
          tempCanvas.height = height;
          transformCompositeCanvasRef.current = tempCanvas;
        }
        const tempCtx = tempCanvas.getContext('2d');
        if (tempCtx) {
          tempCtx.clearRect(0, 0, width, height);
          tempCtx.drawImage(layer.canvas, 0, 0);
          tempCtx.clearRect(
            freeTransformSession.sourceRect.x,
            freeTransformSession.sourceRect.y,
            freeTransformSession.sourceRect.w,
            freeTransformSession.sourceRect.h,
          );
          tempCtx.imageSmoothingEnabled = true;
          tempCtx.drawImage(
            freeTransformSession.sourceCanvas,
            freeTransformSession.bounds.x,
            freeTransformSession.bounds.y,
            freeTransformSession.bounds.w,
            freeTransformSession.bounds.h,
          );
          ctx.drawImage(tempCanvas, 0, 0);
        }
      } else {
        ctx.drawImage(layer.canvas, 0, 0);
      }
      ctx.restore();
    });
  }, [layers, width, height, renderTick, dpr, backgroundSettings, activeLayerId, freeTransformSession, viewRotation]);

  // ── Pointer → logical canvas coordinates ────────────────────────────────
  const getCanvasCoordinates = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    let x: number;
    let y: number;

    switch (viewRotation) {
      case 90:
        x = relY * scaleY;
        y = height - relX * scaleX;
        break;
      case 180:
        x = width - relX * scaleX;
        y = height - relY * scaleY;
        break;
      case 270:
        x = width - relY * scaleY;
        y = relX * scaleX;
        break;
      default:
        x = relX * scaleX;
        y = relY * scaleY;
        break;
    }

    return {
      x: Math.max(0, Math.min(width, x)),
      y: Math.max(0, Math.min(height, y))
    };
  }, [height, viewRotation, width]);

  // ── Pointer handlers ────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Middle click = pan (let it bubble to viewport handler)
    if (e.button === 1) return;
    e.preventDefault();
    e.stopPropagation();

    const transformSession = freeTransformSessionRef.current;
    if (transformSession) {
      const { x, y } = getCanvasCoordinates(e);
      const handle = getTransformHandleAtPoint(
        { x, y, timestamp: Date.now() },
        transformSession.bounds,
        getTransformHandleSize(zoom),
      );
      if (!handle) return;

      activePointerIdRef.current = e.pointerId;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      transformDragRef.current = {
        handle,
        pointerStart: { x, y, timestamp: Date.now() },
        startBounds: { ...transformSession.bounds },
      };
      setIsDrawing(true);
      onDrawingStateChange?.(true);
      return;
    }

    if (!activeLayerId) return;
    const activeLayer = layers.find((layer) => layer.id === activeLayerId);
    if (!activeLayer) return;

    if (
      activeTool !== 'eyedropper'
      && activeTool !== 'select'
      && (!activeLayer.visible || activeLayer.opacity <= 0)
    ) {
      onLayerVisibilityFix?.(activeLayer.id, {
        visible: true,
        opacity: activeLayer.opacity <= 0 ? 100 : activeLayer.opacity,
      });
    }

    const { x, y } = getCanvasCoordinates(e);

    // Alt+click = eyedropper (PS convention: pick color under cursor) — works on locked layers
    if (e.altKey && onColorPick) {
      const pixel = activeLayer.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
      const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('');
      onColorPick(hex);
      return;
    }

    // Eyedropper and select tools work on locked layers (read-only operations)
    if (activeTool === 'eyedropper') {
      setIsDrawing(false);
      if (onColorPick) {
        const pixel = activeLayer.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(c => c.toString(16).padStart(2, '0')).join('');
        onColorPick(hex);
      }
      return;
    }

    if (activeLayer.locked && activeTool !== 'select') return;

    const pointerEvent = e.nativeEvent as PointerEvent;
    if (pointerEvent.pointerType === 'touch') {
      activeTouchPointersRef.current.add(e.pointerId);
      if (activeTouchPointersRef.current.size > 1) {
        currentStrokeRef.current = [];
        startPointRef.current = null;
        lastPointRef.current = null;
        activePointerIdRef.current = null;
        strokeCommittedRef.current = true;
        setIsDrawing(false);
        onDrawingStateChange?.(false);
        return;
      }
    }
    let pressure = 1;
    if (pointerEvent.pointerType === 'pen') {
      pressure = pointerEvent.pressure || 1;
      if ('tiltX' in pointerEvent) {
        tabletDataRef.current.tiltX = pointerEvent.tiltX || 0;
        tabletDataRef.current.tiltY = pointerEvent.tiltY || 0;
      }
    }
    tabletDataRef.current.pressure = pressure;

    const point: Point = { x, y, pressure, timestamp: Date.now() };
    activePointerIdRef.current = e.pointerId;
    strokeCommittedRef.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setIsDrawing(true);
    onDrawingStateChange?.(true);
    startPointRef.current = point;
    lastPointRef.current = point;
    currentStrokeRef.current = [point];

    const layerCtx = activeLayer.ctx;

    // Select tool: marquee create or move existing selection
    if (activeTool === 'select') {
      const normalizedSelection = selection ? normalizeRect(selection) : null;
      selectionDragRef.current = pointInSelection(point, normalizedSelection)
        ? { mode: 'move', pointerStart: point, startSelection: normalizedSelection }
        : { mode: 'create', pointerStart: point, startSelection: normalizedSelection };
      if (selectionDragRef.current.mode === 'create') {
        onSelectionChange?.(null);
      }
      return;
    }

    // Smudge tool: save undo state, sample starting color
    if (activeTool === 'smudge') {
      const imageData = layerCtx.getImageData(0, 0, width, height);
      onSaveState?.(activeLayerId, imageData);
      return; // isDrawing stays true
    }

    // Move tool: save undo state, will translate on pointerMove/Up
    if (activeTool === 'move') {
      const imageData = layerCtx.getImageData(0, 0, width, height);
      onSaveState?.(activeLayerId, imageData);
      preStrokeImageRef.current = imageData;
      return; // isDrawing stays true for move drag
    }

    // Gradient tool: save undo, will draw gradient on pointerUp
    if (activeTool === 'gradient') {
      const imageData = layerCtx.getImageData(0, 0, width, height);
      onSaveState?.(activeLayerId, imageData);
      return; // isDrawing stays true, preview on move, commit on up
    }

    if (activeTool === 'text') {
      suppressTextBlurCommitRef.current = true;
      setIsDrawing(false);
      onDrawingStateChange?.(false);
      if (textSessionRef.current?.visible) {
        commitTextSession(textSessionRef.current);
      }
      beginTextSession(x, y);
      return;
    }

    const imageData = layerCtx.getImageData(0, 0, width, height);
    onSaveState?.(activeLayerId, imageData);

    if (activeTool === 'fill') {
      floodFill(layerCtx, Math.floor(x), Math.floor(y), toolSettings.color, toolSettings.fillTolerance, toolSettings.fillContiguous);
      setIsDrawing(false);
      onDrawingStateChange?.(false);
      requestComposite();
      return;
    }

    if (activeTool === 'brush' || activeTool === 'eraser') {
      // Shift+click: draw a straight line from the last stroke endpoint (PS convention)
      if (e.shiftKey && lastStrokeEndRef.current) {
        const from = lastStrokeEndRef.current;
        const segment = [from, point];
        currentStrokeRef.current = [from, point];
        if (activeTool === 'brush') {
          layerCtx.save();
          layerCtx.globalAlpha = toolSettings.opacity / 100;
          drawBrushStroke(layerCtx, segment, toolSettings.color, toolSettings.size * pressure, 100, toolSettings.hardness);
          layerCtx.restore();
        } else {
          drawEraserStroke(layerCtx, segment, toolSettings.size * pressure);
        }
        lastStrokeEndRef.current = point;
        strokeCommittedRef.current = true;
        setIsDrawing(false);
        onDrawingStateChange?.(false);
        requestComposite();
        return;
      }

      // Initialize stroke buffer — draw at full opacity, composite with desired opacity on pointerUp
      let buf = strokeBufferRef.current;
      if (!buf || buf.width !== width || buf.height !== height) {
        buf = document.createElement('canvas');
        buf.width = width;
        buf.height = height;
        strokeBufferRef.current = buf;
      } else {
        getFrequentReadContext(buf).clearRect(0, 0, width, height);
      }
      // Save pre-stroke layer state for live preview compositing
      preStrokeImageRef.current = layerCtx.getImageData(0, 0, width, height);

      const bufCtx = getFrequentReadContext(buf);
      const previewCanvas = previewCanvasRef.current;
      const previewCtx = previewCanvas?.getContext('2d');
      const dotRadius = (toolSettings.size * pressure) / 2;
      const dotColor = activeTool === 'brush' ? toolSettings.color : '#000';
      bufCtx.fillStyle = dotColor;
      bufCtx.beginPath();
      bufCtx.arc(x, y, dotRadius, 0, Math.PI * 2);
      bufCtx.fill();
      if (symmetryX) {
        bufCtx.beginPath();
        bufCtx.arc(width - x, y, dotRadius, 0, Math.PI * 2);
        bufCtx.fill();
      }
      // Live preview: paint the buffered stroke on the overlay canvas so it
      // stays visible even if the main canvas is showing a selected frame.
      if (previewCanvas && previewCtx) {
        clearDisplayCanvas(previewCtx, previewCanvas, dprRef.current);
        previewCtx.save();
        if (activeTool === 'eraser') {
          previewCtx.globalCompositeOperation = 'destination-out';
        } else {
          previewCtx.globalAlpha = toolSettings.opacity / 100;
        }
        previewCtx.drawImage(buf, 0, 0);
        previewCtx.restore();
      }
    }
  }, [activeLayerId, beginTextSession, commitTextSession, layers, getCanvasCoordinates, activeTool, toolSettings, width, height, onSaveState, onColorPick, onLayerVisibilityFix, onDrawingStateChange, selection, onSelectionChange, requestComposite, symmetryX, zoom]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const pointerEvent = e.nativeEvent as PointerEvent;
    if (pointerEvent.pointerType === 'touch' && activeTouchPointersRef.current.size > 1) {
      return;
    }
    const { x: rawX, y: rawY } = getCanvasCoordinates(e);

    const transformSession = freeTransformSessionRef.current;
    if (transformSession) {
      const currentHandle = getTransformHandleAtPoint(
        { x: rawX, y: rawY, timestamp: Date.now() },
        transformSession.bounds,
        getTransformHandleSize(zoom),
      );
      setTransformHoverHandle((prev) => (prev === currentHandle ? prev : currentHandle));

      const dragState = transformDragRef.current;
      if (dragState && activePointerIdRef.current === e.pointerId) {
        const dx = rawX - dragState.pointerStart.x;
        const dy = rawY - dragState.pointerStart.y;
        const nextBounds = resizeTransformBounds(dragState.startBounds, dragState.handle, dx, dy);
        setFreeTransformSession((prev) => prev ? { ...prev, bounds: nextBounds } : prev);
        return;
      }

      return;
    }

    if (!isDrawingRef.current || !activeLayerId) return;

    const activeLayer = layers.find((layer) => layer.id === activeLayerId);
    const previewCanvas = previewCanvasRef.current;
    if (!activeLayer || !previewCanvas) return;

    let pressure = 1;
    if (pointerEvent.pointerType === 'pen') {
      pressure = pointerEvent.pressure || 1;
    }

    // Brush smoothing: weighted average with recent points (reduces jitter for mouse input)
    let x = rawX, y = rawY;
    if ((activeTool === 'brush' || activeTool === 'eraser') && currentStrokeRef.current.length > 0) {
      const pts = currentStrokeRef.current;
      const n = Math.min(3, pts.length);
      let wx = rawX, wy = rawY, wt = 1;
      for (let i = 0; i < n; i++) {
        const w = 0.5 / (i + 1);
        wx += pts[pts.length - 1 - i].x * w;
        wy += pts[pts.length - 1 - i].y * w;
        wt += w;
      }
      x = wx / wt;
      y = wy / wt;
    }

    const point: Point = { x, y, pressure, timestamp: Date.now() };
    const previewCtx = previewCanvas.getContext('2d');
    if (!previewCtx) return;

    // Clear preview at physical resolution, re-apply DPI scale for logical coords
    const d = dprRef.current;
    clearDisplayCanvas(previewCtx, previewCanvas, d);

    if (activeTool === 'brush' || activeTool === 'eraser') {
      currentStrokeRef.current.push(point);
      const pts = currentStrokeRef.current;
      const segment = pts.slice(Math.max(0, pts.length - 3));

      // Draw onto the stroke buffer (at full opacity) to avoid opacity doubling
      const buf = strokeBufferRef.current;
      const bufCtx = buf ? getFrequentReadContext(buf) : null;
      if (bufCtx && buf) {
        if (activeTool === 'brush') {
          drawBrushStroke(bufCtx, segment, toolSettings.color, toolSettings.size * pressure, 100, toolSettings.hardness);
        } else {
          drawEraserStroke(bufCtx, segment, toolSettings.size * pressure);
        }
        // Symmetry: mirror the segment horizontally
        if (symmetryX) {
          const mirrorSeg = segment.map(p => ({ ...p, x: width - p.x }));
          if (activeTool === 'brush') {
            drawBrushStroke(bufCtx, mirrorSeg, toolSettings.color, toolSettings.size * pressure, 100, toolSettings.hardness);
          } else {
            drawEraserStroke(bufCtx, mirrorSeg, toolSettings.size * pressure);
          }
        }
        previewCtx.save();
        if (activeTool === 'eraser') {
          previewCtx.globalCompositeOperation = 'destination-out';
        } else {
          previewCtx.globalAlpha = toolSettings.opacity / 100;
        }
        previewCtx.drawImage(buf, 0, 0);
        previewCtx.restore();
      }

      lastPointRef.current = point;
      return;
    }

    // Smudge tool: blur pixels along the stroke path
    if (activeTool === 'smudge' && lastPointRef.current) {
      currentStrokeRef.current.push(point);
      const layerCtx = activeLayer.ctx;
      const r = Math.max(2, Math.round(toolSettings.size / 2));
      const cx = Math.round(point.x);
      const cy = Math.round(point.y);
      const x0 = Math.max(0, cx - r);
      const y0 = Math.max(0, cy - r);
      const x1 = Math.min(width, cx + r);
      const y1 = Math.min(height, cy + r);
      const sw = x1 - x0;
      const sh = y1 - y0;
      if (sw > 0 && sh > 0) {
        const imgData = layerCtx.getImageData(x0, y0, sw, sh);
        const d = imgData.data;
        const copy = new Uint8ClampedArray(d);
        // Simple 3x3 box blur on the brush area
        for (let py = 1; py < sh - 1; py++) {
          for (let px = 1; px < sw - 1; px++) {
            for (let ch = 0; ch < 4; ch++) {
              const idx = (py * sw + px) * 4 + ch;
              d[idx] = (
                copy[((py-1)*sw+px-1)*4+ch] + copy[((py-1)*sw+px)*4+ch] + copy[((py-1)*sw+px+1)*4+ch] +
                copy[(py*sw+px-1)*4+ch] + copy[(py*sw+px)*4+ch] + copy[(py*sw+px+1)*4+ch] +
                copy[((py+1)*sw+px-1)*4+ch] + copy[((py+1)*sw+px)*4+ch] + copy[((py+1)*sw+px+1)*4+ch]
              ) / 9;
            }
          }
        }
        layerCtx.putImageData(imgData, x0, y0);
      }
      lastPointRef.current = point;
      requestComposite();
      return;
    }

    // Select tool: marquee preview or move selected bounds
    if (activeTool === 'select' && startPointRef.current) {
      const dragState = selectionDragRef.current;
      if (!dragState) return;

      lastPointRef.current = point;
      if (dragState.mode === 'move' && dragState.startSelection) {
        const dx = point.x - dragState.pointerStart.x;
        const dy = point.y - dragState.pointerStart.y;
        onSelectionChange?.(offsetSelectionWithinCanvas(dragState.startSelection, dx, dy, width, height));
        return;
      }

      const marquee = buildMarqueeRect(startPointRef.current, point, {
        fromCenter: e.altKey,
        constrainSquare: e.shiftKey,
      });
      const d = dprRef.current;
      clearDisplayCanvas(previewCtx, previewCanvas, d);
      previewCtx.save();
      previewCtx.setLineDash([4, 4]);
      previewCtx.strokeStyle = '#fff';
      previewCtx.lineWidth = 1;
      previewCtx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
      previewCtx.strokeStyle = '#000';
      previewCtx.lineDashOffset = 4;
      previewCtx.strokeRect(marquee.x, marquee.y, marquee.w, marquee.h);
      previewCtx.restore();
      return;
    }

    // Move tool: translate layer content live (use drawImage to avoid clipping at negative offsets)
    if (activeTool === 'move' && startPointRef.current && preStrokeImageRef.current) {
      const dx = point.x - startPointRef.current.x;
      const dy = point.y - startPointRef.current.y;
      const layerCtx = activeLayer.ctx;
      // Use a temp canvas + drawImage instead of putImageData (which clips at negative offsets)
      if (!strokeBufferRef.current || strokeBufferRef.current.width !== width || strokeBufferRef.current.height !== height) {
        strokeBufferRef.current = document.createElement('canvas');
        strokeBufferRef.current.width = width;
        strokeBufferRef.current.height = height;
      }
      const tmp = strokeBufferRef.current;
      const tmpCtx = getFrequentReadContext(tmp);
      tmpCtx.clearRect(0, 0, width, height);
      tmpCtx.putImageData(preStrokeImageRef.current, 0, 0);
      layerCtx.clearRect(0, 0, width, height);
      layerCtx.drawImage(tmp, Math.round(dx), Math.round(dy));
      lastPointRef.current = point;
      requestComposite();
      return;
    }

    // Gradient tool: show preview line on preview canvas
    if (activeTool === 'gradient' && startPointRef.current) {
      lastPointRef.current = point;
      const d = dprRef.current;
      clearDisplayCanvas(previewCtx, previewCanvas, d);
      previewCtx.save();
      previewCtx.setLineDash([4, 4]);
      previewCtx.strokeStyle = '#fff';
      previewCtx.lineWidth = 1;
      previewCtx.beginPath();
      previewCtx.moveTo(startPointRef.current.x, startPointRef.current.y);
      previewCtx.lineTo(point.x, point.y);
      previewCtx.stroke();
      previewCtx.restore();
      return;
    }

    // Shape previews draw on the DPI-scaled preview canvas (crisp on HiDPI)
    if (startPointRef.current) {
      const raw = point;
      const ep = e.shiftKey ? constrainPoint(startPointRef.current, raw, activeTool) : raw;
      const constrained: Point = { ...raw, x: ep.x, y: ep.y };
      lastPointRef.current = constrained;
      const filled = toolSettings.shapeFilled;
      if (activeTool === 'line') {
        drawLine(previewCtx, startPointRef.current, constrained, toolSettings.color, toolSettings.size, toolSettings.opacity);
      } else if (activeTool === 'rectangle') {
        drawRectangle(previewCtx, startPointRef.current, constrained, toolSettings.color, toolSettings.size, toolSettings.opacity, filled);
      } else if (activeTool === 'circle') {
        drawCircle(previewCtx, startPointRef.current, constrained, toolSettings.color, toolSettings.size, toolSettings.opacity, filled);
      }
    }
  }, [activeLayerId, layers, getCanvasCoordinates, activeTool, toolSettings, requestComposite, symmetryX, width, height, zoom]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const pointerEvent = e.nativeEvent as PointerEvent;
    if (pointerEvent.pointerType === 'touch') {
      activeTouchPointersRef.current.delete(e.pointerId);
    }
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;

    if (transformDragRef.current) {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
      transformDragRef.current = null;
      activePointerIdRef.current = null;
      setIsDrawing(false);
      onDrawingStateChange?.(false);
      return;
    }

    if (!isDrawingRef.current || !activeLayerId || strokeCommittedRef.current) return;

    const activeLayer = layers.find((layer) => layer.id === activeLayerId);
    const previewCanvas = previewCanvasRef.current;
    if (!activeLayer || !previewCanvas) return;

    strokeCommittedRef.current = true;

    const previewCtx = previewCanvas.getContext('2d');
    if (!previewCtx) return;
    const layerCtx = activeLayer.ctx;

    // Select tool: commit the marquee rectangle or moved selection
    if (activeTool === 'select' && startPointRef.current) {
      const dragState = selectionDragRef.current;
      if (dragState?.mode === 'move') {
        selectionDragRef.current = null;
      } else if (lastPointRef.current) {
        const marquee = clampSelectionToCanvas(buildMarqueeRect(startPointRef.current, lastPointRef.current, {
          fromCenter: e.altKey,
          constrainSquare: e.shiftKey,
        }), width, height);
        if (marquee && marquee.w > 2 && marquee.h > 2) {
          onSelectionChange?.(marquee);
        } else {
          onSelectionChange?.(null);
        }
        selectionDragRef.current = null;
      }
    }

    // Move tool: final position already applied in pointerMove, just clean up
    if (activeTool === 'move') {
      preStrokeImageRef.current = null;
    }

    // Gradient tool: draw gradient from start to end (skip zero-length to avoid filling entire canvas)
    if (activeTool === 'gradient' && startPointRef.current && lastPointRef.current) {
      const s = startPointRef.current;
      const end = lastPointRef.current;
      const dist = Math.sqrt((end.x - s.x) ** 2 + (end.y - s.y) ** 2);
      if (dist > 2) {
        layerCtx.save();
        layerCtx.globalAlpha = toolSettings.opacity / 100;
        let grad: CanvasGradient;
        if (toolSettings.gradientType === 'radial') {
          grad = layerCtx.createRadialGradient(s.x, s.y, 0, s.x, s.y, dist);
        } else {
          grad = layerCtx.createLinearGradient(s.x, s.y, end.x, end.y);
        }
        grad.addColorStop(0, toolSettings.color);
        grad.addColorStop(1, bgColor);
        layerCtx.fillStyle = grad;
        layerCtx.fillRect(0, 0, width, height);
        layerCtx.restore();
        requestComposite();
      }
    }

    // Commit shape onto layer canvas (document resolution — no DPI transform)
    if (activeTool === 'line' && startPointRef.current && lastPointRef.current) {
      drawLine(layerCtx, startPointRef.current, lastPointRef.current, toolSettings.color, toolSettings.size, toolSettings.opacity);
    } else if (activeTool === 'rectangle' && startPointRef.current && lastPointRef.current) {
      drawRectangle(layerCtx, startPointRef.current, lastPointRef.current, toolSettings.color, toolSettings.size, toolSettings.opacity, toolSettings.shapeFilled);
    } else if (activeTool === 'circle' && startPointRef.current && lastPointRef.current) {
      drawCircle(layerCtx, startPointRef.current, lastPointRef.current, toolSettings.color, toolSettings.size, toolSettings.opacity, toolSettings.shapeFilled);
    } else if ((activeTool === 'brush' || activeTool === 'eraser') && strokeBufferRef.current) {
      layerCtx.putImageData(preStrokeImageRef.current ?? layerCtx.getImageData(0, 0, width, height), 0, 0);
      layerCtx.save();
      if (activeTool === 'eraser') {
        layerCtx.globalCompositeOperation = 'destination-out';
      } else {
        layerCtx.globalAlpha = toolSettings.opacity / 100;
      }
      layerCtx.drawImage(strokeBufferRef.current, 0, 0);
      layerCtx.restore();
    }

    // Clean up stroke buffer (final composite is already on the layer)
    preStrokeImageRef.current = null;
    if (strokeBufferRef.current) {
      getFrequentReadContext(strokeBufferRef.current).clearRect(0, 0, strokeBufferRef.current.width, strokeBufferRef.current.height);
    }

    // Clear preview at full physical resolution
    previewCtx.setTransform(1, 0, 0, 1, 0, 0);
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    if (currentStrokeRef.current.length > 0) {
      onStrokeComplete?.({
        id: generateId(),
        points: [...currentStrokeRef.current],
        tool: activeTool,
        color: toolSettings.color,
        size: toolSettings.size,
        opacity: toolSettings.opacity,
        layerId: activeLayerId
      });
    }

    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    // Remember endpoint for Shift+click straight lines
    if ((activeTool === 'brush' || activeTool === 'eraser') && lastPointRef.current) {
      lastStrokeEndRef.current = lastPointRef.current;
    }
    activePointerIdRef.current = null;
    setIsDrawing(false);
    onDrawingStateChange?.(false);
    currentStrokeRef.current = [];
    startPointRef.current = null;
    lastPointRef.current = null;
    requestComposite();
  }, [activeLayerId, layers, activeTool, toolSettings, onStrokeComplete, onDrawingStateChange, bgColor, width, height, onSelectionChange, requestComposite]);

  // ── Imperative handle (used by App for animation, export, undo) ─────────
  useImperativeHandle(ref, () => ({
    renderFrame: (frame: AnimationFrame) => {
      const mainCanvas = mainCanvasRef.current;
      if (!mainCanvas) return;
      const ctx = mainCanvas.getContext('2d');
      if (!ctx) return;
      const d = dprRef.current;

      clearDisplayCanvas(ctx, mainCanvas, d);

      // If the frame has a pre-decoded snapshot (BLE-captured), draw it
      // directly — it already contains background + all layers as they
      // were at capture time.
      if (frame.snapshot) {
        ctx.drawImage(frame.snapshot, 0, 0, width, height);
        return;
      }

      // Stroke-based frames: draw background + layers + overlay strokes
      drawBackgroundToContext(ctx, width, height, backgroundSettings);

      layers.forEach((layer) => {
        if (!layer.visible) return;
        ctx.save();
        ctx.globalAlpha = layer.opacity / 100;
        ctx.globalCompositeOperation = layer.blendMode ?? 'source-over';
        ctx.drawImage(layer.canvas, 0, 0);
        ctx.restore();
      });

      if (!frame?.strokes) return;
      frame.strokes.forEach((stroke: Stroke) => {
        ctx.save();
        ctx.globalAlpha = stroke.opacity / 100;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = stroke.size;

        if (stroke.tool === 'eraser') {
          ctx.globalCompositeOperation = 'destination-out';
          ctx.strokeStyle = 'rgba(0,0,0,1)';
        } else {
          ctx.strokeStyle = stroke.color;
        }

        if (stroke.points.length === 1) {
          const point = stroke.points[0];
          ctx.fillStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color;
          if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(point.x, point.y, stroke.size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          return;
        }

        if (stroke.points.length > 1) {
          ctx.beginPath();
          ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
          for (let i = 1; i < stroke.points.length - 1; i++) {
            const midX = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
            const midY = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
            ctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, midX, midY);
          }
          ctx.lineTo(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y);
          ctx.stroke();
        }

        ctx.restore();
      });
    },

    clearCanvas: () => {
      const mainCanvas = mainCanvasRef.current;
      if (!mainCanvas) return;
      const ctx = mainCanvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    },

    getMergedCanvas: () => {
      // Export always at document resolution — no DPI scaling
      return mergeVisibleLayersToCanvas(width, height, layers, backgroundSettings);
    },

    applyHistory: (layerId: string, imageData: ImageData) => {
      const layer = layers.find((item) => item.id === layerId);
      if (!layer) return;
      layer.ctx.putImageData(imageData, 0, 0);
      requestComposite();
    },

    recomposite: () => requestComposite(),

    startFreeTransform: () => {
      if (freeTransformSessionRef.current || !selection || !activeLayerId) return false;
      const layer = layers.find((item) => item.id === activeLayerId);
      if (!layer || layer.locked) return false;

      const sourceRect = normalizeRect(selection);
      if (sourceRect.w < 1 || sourceRect.h < 1) return false;

      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = sourceRect.w;
      sourceCanvas.height = sourceRect.h;
      const sourceCtx = getFrequentReadContext(sourceCanvas);
      if (!sourceCtx) return false;
      sourceCtx.drawImage(
        layer.canvas,
        sourceRect.x,
        sourceRect.y,
        sourceRect.w,
        sourceRect.h,
        0,
        0,
        sourceRect.w,
        sourceRect.h,
      );

      setFreeTransformSession({
        layerId: activeLayerId,
        sourceRect,
        bounds: { ...sourceRect },
        sourceCanvas,
      });
      setIsDrawing(false);
      return true;
    },

    commitFreeTransform: () => {
      const session = freeTransformSessionRef.current;
      if (!session) return false;
      const layer = layers.find((item) => item.id === session.layerId);
      if (!layer || layer.locked) return false;

      onSaveState?.(session.layerId, layer.ctx.getImageData(0, 0, width, height));
      layer.ctx.clearRect(session.sourceRect.x, session.sourceRect.y, session.sourceRect.w, session.sourceRect.h);
      layer.ctx.save();
      layer.ctx.imageSmoothingEnabled = true;
      layer.ctx.drawImage(
        session.sourceCanvas,
        session.bounds.x,
        session.bounds.y,
        session.bounds.w,
        session.bounds.h,
      );
      layer.ctx.restore();

      onSelectionChange?.(clampSelectionToCanvas(session.bounds, width, height));
      transformDragRef.current = null;
      activePointerIdRef.current = null;
      setIsDrawing(false);
      setFreeTransformSession(null);
      requestComposite();
      return true;
    },

    cancelFreeTransform: () => {
      if (!freeTransformSessionRef.current) return false;
      transformDragRef.current = null;
      activePointerIdRef.current = null;
      setIsDrawing(false);
      setFreeTransformSession(null);
      requestComposite();
      return true;
    },

    isFreeTransformActive: () => Boolean(freeTransformSessionRef.current),
  }), [layers, width, height, backgroundSettings, selection, activeLayerId, onSaveState, onSelectionChange, requestComposite]);

  const backgroundStyle = getBackgroundStyle(backgroundSettings, zoom);

  // PS-style brush cursor: circle matching the brush size at current zoom.
  // Falls back to crosshair for non-brush tools or very small sizes.
  const cursorStyle = React.useMemo(() => {
    if (freeTransformSession) return getTransformCursor(transformHoverHandle);
    if (activeTool === 'eyedropper') return 'copy';
    if (activeTool === 'move') return 'move';
    if (activeTool === 'select') return selection ? 'move' : 'crosshair';
    if (activeTool === 'smudge') return 'crosshair';
    if (activeTool !== 'brush' && activeTool !== 'eraser') return 'crosshair';
    const diameter = Math.round(toolSettings.size * zoom);
    if (diameter < 4) return 'crosshair';
    // Clamp cursor to 128px — larger brushes still show the circle outline
    const d = Math.min(diameter, 128);
    const r = d / 2;
    const svgSize = d + 2; // 1px padding each side
    const c = svgSize / 2;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${svgSize}' height='${svgSize}'><circle cx='${c}' cy='${c}' r='${r}' fill='none' stroke='white' stroke-width='1' opacity='0.8'/><circle cx='${c}' cy='${c}' r='${r}' fill='none' stroke='black' stroke-width='1' opacity='0.4' stroke-dasharray='2,2'/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, crosshair`;
  }, [activeTool, toolSettings.size, zoom, freeTransformSession, transformHoverHandle]);

  const canvasContents = (
    <>
      <canvas
        ref={mainCanvasRef}
        className="absolute inset-0"
        style={{ width: displayWidth, height: displayHeight, cursor: cursorStyle }}
        onPointerDown={handlePointerDown}
        onPointerMove={(e) => {
          // Report cursor position for status bar
          if (onCursorMove) {
            const { x, y } = getCanvasCoordinates(e);
            onCursorMove(x, y);
          }
          handlePointerMove(e);
        }}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => {
          onCursorMove?.(-1, -1);
          setTransformHoverHandle(null);
        }}
      />
      <canvas
        ref={previewCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: displayWidth, height: displayHeight }}
      />
      <canvas
        ref={gridCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: displayWidth, height: displayHeight }}
      />

      {/* Drawing Tablet cursor overlay */}
      {penCursor && (
        <div
          className="absolute pointer-events-none z-10"
          style={{
            left: penCursor.x * zoom,
            top: penCursor.y * zoom,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {/* Crosshair */}
          <svg
            width={penCursor.active ? 28 : 20}
            height={penCursor.active ? 28 : 20}
            viewBox="0 0 20 20"
            style={{ overflow: 'visible', opacity: penCursor.active ? 1 : 0.5 }}
          >
            {/* Outer ring */}
            <circle
              cx="10" cy="10"
              r={penCursor.active ? 6 + penCursor.pressure * 4 : 6}
              fill="none"
              stroke={penCursor.active ? '#3b82f6' : '#888'}
              strokeWidth="1.5"
              opacity={0.8}
            />
            {/* Center dot */}
            <circle
              cx="10" cy="10"
              r={penCursor.active ? 1.5 : 1}
              fill={penCursor.active ? '#3b82f6' : '#aaa'}
            />
            {/* Crosshair lines */}
            <line x1="10" y1="2" x2="10" y2="5" stroke={penCursor.active ? '#3b82f6' : '#888'} strokeWidth="1" opacity={0.6} />
            <line x1="10" y1="15" x2="10" y2="18" stroke={penCursor.active ? '#3b82f6' : '#888'} strokeWidth="1" opacity={0.6} />
            <line x1="2" y1="10" x2="5" y2="10" stroke={penCursor.active ? '#3b82f6' : '#888'} strokeWidth="1" opacity={0.6} />
            <line x1="15" y1="10" x2="18" y2="10" stroke={penCursor.active ? '#3b82f6' : '#888'} strokeWidth="1" opacity={0.6} />
          </svg>
        </div>
      )}

      {textSession?.visible && (
        <textarea
          ref={textInputRef}
          value={textSession.draft}
          spellCheck={false}
          onChange={(e) => {
            const nextDraft = e.target.value;
            setTextSession((prev) => prev ? { ...prev, draft: nextDraft } : prev);
          }}
          onBlur={() => {
            if (suppressTextBlurCommitRef.current) {
              suppressTextBlurCommitRef.current = false;
              return;
            }
            commitTextSession();
          }}
          onKeyDown={(e) => {
            const isCommitShortcut = e.key === 'Enter' && (e.metaKey || e.ctrlKey);
            if (e.key === 'Escape') {
              e.preventDefault();
              cancelTextSession();
            }
            if (isCommitShortcut) {
              e.preventDefault();
              commitTextSession();
            }
          }}
          className="absolute z-20 resize-none overflow-hidden border-none bg-transparent p-0 outline-none"
          style={{
            left: textSession.x * zoom,
            top: textSession.y * zoom,
            fontSize: textFontSize * zoom,
            fontFamily: toolSettings.fontFamily,
            lineHeight: 1.2,
            color: toolSettings.color,
            caretColor: toolSettings.color,
            opacity: toolSettings.opacity / 100,
            minWidth: 24,
            minHeight: textFontSize * zoom * 1.2,
            whiteSpace: 'pre',
          }}
        />
      )}
    </>
  );

  if (viewRotation === 0) {
    return (
      <div
        className="relative shadow-2xl"
        style={{
          width: displayWidth,
          height: displayHeight,
          backgroundColor: backgroundStyle.backgroundColor,
          backgroundImage: backgroundStyle.backgroundImage,
          backgroundSize: backgroundStyle.backgroundSize,
          backgroundPosition: backgroundStyle.backgroundPosition,
          backgroundRepeat: 'repeat',
        }}
      >
        {canvasContents}
      </div>
    );
  }

  return (
    <div
      className="relative"
      style={{
        width: rotatedDisplaySize.width,
        height: rotatedDisplaySize.height,
        overflow: 'visible',
      }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: 'translate(-50%, -50%)',
          transformOrigin: 'center center',
        }}
      >
        <div
          className="relative shadow-2xl"
          style={{
          width: displayWidth,
          height: displayHeight,
          transform: `rotate(${viewRotation}deg)`,
          transformOrigin: 'center center',
          willChange: 'transform',
          backgroundColor: backgroundStyle.backgroundColor,
          backgroundImage: backgroundStyle.backgroundImage,
          backgroundSize: backgroundStyle.backgroundSize,
          backgroundPosition: backgroundStyle.backgroundPosition,
          backgroundRepeat: 'repeat',
        }}
      >
        {canvasContents}
        </div>
      </div>
    </div>
  );
});

CanvasEngine.displayName = 'CanvasEngine';

function getBackgroundStyle(settings: BackgroundSettings, zoom: number) {
  const size = Math.max(2, settings.pixelSize);
  const scaledSize = Math.max(2, size * zoom);
  const scaledMajor = Math.max(2, scaledSize * 5);
  const primary = settings.primaryColor;
  const secondary = settings.secondaryColor;
  const offsetX = (settings.patternOffsetX || 0) * zoom;
  const offsetY = (settings.patternOffsetY || 0) * zoom;
  const transparencyBackdrop = {
    backgroundColor: '#2a2a2a',
    backgroundImage: 'linear-gradient(45deg, #3a3a3a 25%, transparent 25%), linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a3a 75%), linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)',
    backgroundSize: '24px 24px',
    backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
  };

  if (settings.transparent) {
    return transparencyBackdrop;
  }

  switch (settings.pattern) {
    case 'solid':
      return {
        backgroundColor: secondary,
        backgroundImage: 'none',
        backgroundSize: `${scaledSize}px ${scaledSize}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
    case 'dots':
      return {
        backgroundColor: secondary,
        backgroundImage: `radial-gradient(circle at center, ${primary} 18%, transparent 20%)`,
        backgroundSize: `${scaledSize}px ${scaledSize}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
    case 'grid':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(${primary} 1px, transparent 1px), linear-gradient(90deg, ${primary} 1px, transparent 1px)`,
        backgroundSize: `${scaledSize}px ${scaledSize}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
    case 'graph':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(${withColorAlpha(primary, 0.45)} 1px, transparent 1px), linear-gradient(90deg, ${withColorAlpha(primary, 0.45)} 1px, transparent 1px), linear-gradient(${withColorAlpha(primary, 0.85)} 2px, transparent 2px), linear-gradient(90deg, ${withColorAlpha(primary, 0.85)} 2px, transparent 2px)`,
        backgroundSize: `${scaledSize}px ${scaledSize}px, ${scaledSize}px ${scaledSize}px, ${scaledMajor}px ${scaledMajor}px, ${scaledMajor}px ${scaledMajor}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px`,
      };
    case 'checker':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(45deg, ${primary} 25%, transparent 25%), linear-gradient(-45deg, ${primary} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${primary} 75%), linear-gradient(-45deg, transparent 75%, ${primary} 75%)`,
        backgroundSize: `${scaledSize * 2}px ${scaledSize * 2}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY + scaledSize}px, ${offsetX + scaledSize}px ${offsetY - scaledSize}px, ${offsetX - scaledSize}px ${offsetY}px`,
      };
    case 'ruled':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(${primary} 1px, transparent 1px)`,
        backgroundSize: `${scaledSize}px ${scaledSize}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
    default:
      return {
        backgroundColor: secondary,
        backgroundImage: 'none',
        backgroundSize: `${scaledSize}px ${scaledSize}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
  }
}

function withColorAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace(/^#/, '');
  const expanded =
    normalized.length === 3
      ? `${normalized[0]}${normalized[0]}${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}ff`
      : normalized.length === 4
        ? `${normalized[0]}${normalized[0]}${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`
        : normalized.length === 6
          ? `${normalized}ff`
          : normalized.length >= 8
            ? normalized.slice(0, 8)
            : '000000ff';
  const r = parseInt(expanded.slice(0, 2), 16) || 0;
  const g = parseInt(expanded.slice(2, 4), 16) || 0;
  const b = parseInt(expanded.slice(4, 6), 16) || 0;
  const baseAlpha = (parseInt(expanded.slice(6, 8), 16) || 255) / 255;
  return `rgba(${r}, ${g}, ${b}, ${baseAlpha * alpha})`;
}
