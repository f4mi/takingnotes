import type { AnimationFrame, BackgroundSettings, Layer, Point, Stroke } from '@/types';

function getFrequentReadContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d')!;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function createEmptyLayer(name: string, width: number, height: number, fillWhite: boolean = false): Layer {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = getFrequentReadContext(canvas);
  if (fillWhite) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  
  return {
    id: generateId(),
    name,
    canvas,
    ctx,
    visible: true,
    opacity: 100,
    locked: false
  };
}

export function getDistance(p1: Point, p2: Point): number {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

export function getMidpoint(p1: Point, p2: Point): Point {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
    timestamp: (p1.timestamp + p2.timestamp) / 2
  };
}

export function drawBrushStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  size: number,
  opacity: number,
  hardness: number
): void {
  if (points.length < 2) return;
  
  ctx.save();
  ctx.globalAlpha = opacity / 100;

  if (hardness < 100) {
    // Soft brush: stamp radial gradients along the path at each point
    // This produces a proper soft-edge brush unlike assigning a fixed-origin gradient to strokeStyle
    const radius = size / 2;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      grad.addColorStop(0, color);
      grad.addColorStop(hardness / 100, color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Hard brush: standard path stroke
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size;
    
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    for (let i = 1; i < points.length - 1; i++) {
      const mid = getMidpoint(points[i], points[i + 1]);
      ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
    }
    
    if (points.length > 1) {
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }
    
    ctx.stroke();
  }

  ctx.restore();
}

export function drawEraserStroke(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  size: number
): void {
  if (points.length < 2) return;
  
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size;
  
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  
  for (let i = 1; i < points.length - 1; i++) {
    const mid = getMidpoint(points[i], points[i + 1]);
    ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
  }
  
  if (points.length > 1) {
    ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
  }
  
  ctx.stroke();
  ctx.restore();
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  size: number,
  opacity: number
): void {
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = size;
  
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

export function drawRectangle(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  size: number,
  opacity: number,
  filled: boolean = false
): void {
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  
  if (filled) {
    ctx.fillRect(x, y, width, height);
  } else {
    ctx.strokeRect(x, y, width, height);
  }
  ctx.restore();
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  start: Point,
  end: Point,
  color: string,
  size: number,
  opacity: number,
  filled: boolean = false
): void {
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  
  const radius = getDistance(start, end);
  
  ctx.beginPath();
  ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
  
  if (filled) {
    ctx.fill();
  } else {
    ctx.stroke();
  }
  ctx.restore();
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  fontSize: number,
  opacity: number,
  fontFamily: string = '"TASA Orbiter", sans-serif'
): void {
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';
  
  const lines = text.split('\n');
  const lineHeight = fontSize * 1.2;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, y + i * lineHeight);
  });
  
  ctx.restore();
}

/**
 * Parse a CSS hex color string to RGBA values.
 * Avoids creating a temporary canvas element for color parsing.
 */
function parseHexColor(hex: string): [number, number, number, number] {
  // Remove leading #
  let h = hex.replace(/^#/, '');
  
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (h.length === 4) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255;
  
  return [
    isNaN(r) ? 0 : r,
    isNaN(g) ? 0 : g,
    isNaN(b) ? 0 : b,
    isNaN(a) ? 255 : a,
  ];
}

/**
 * Scanline flood fill — much more memory-efficient than stack-based DFS
 * for large areas. Uses a queue of horizontal spans.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fillColor: string,
  tolerance: number = 0,
  contiguous: boolean = true
): void {
  const imageData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const data = imageData.data;
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;

  const startX = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const startY = Math.max(0, Math.min(height - 1, Math.floor(y)));

  const [fillR, fillG, fillB, fillA] = parseHexColor(fillColor);

  const getIndex = (px: number, py: number) => (py * width + px) * 4;
  const targetIdx = getIndex(startX, startY);
  const targetR = data[targetIdx];
  const targetG = data[targetIdx + 1];
  const targetB = data[targetIdx + 2];
  const targetA = data[targetIdx + 3];

  const matchesTarget = (idx: number) => (
    Math.abs(data[idx] - targetR) <= tolerance &&
    Math.abs(data[idx + 1] - targetG) <= tolerance &&
    Math.abs(data[idx + 2] - targetB) <= tolerance &&
    Math.abs(data[idx + 3] - targetA) <= tolerance
  );

  const isSameFill = (
    Math.abs(targetR - fillR) <= tolerance &&
    Math.abs(targetG - fillG) <= tolerance &&
    Math.abs(targetB - fillB) <= tolerance &&
    Math.abs(targetA - fillA) <= tolerance
  );

  if (isSameFill) return;

  const paintPixel = (idx: number) => {
    data[idx] = fillR;
    data[idx + 1] = fillG;
    data[idx + 2] = fillB;
    data[idx + 3] = fillA;
  };

  if (!contiguous) {
    // Global replace: paint all matching pixels
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const idx = getIndex(px, py);
        if (matchesTarget(idx)) {
          paintPixel(idx);
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return;
  }

  // Scanline flood fill
  const visited = new Uint8Array(width * height);

  // Each entry: [leftX, rightX, y, parentY] — parentY used to skip re-checking parent row
  const queue: [number, number, number, number][] = [];

  // Find initial span
  let left = startX;
  let right = startX;
  while (left > 0 && matchesTarget(getIndex(left - 1, startY))) left--;
  while (right < width - 1 && matchesTarget(getIndex(right + 1, startY))) right++;

  // Paint initial span
  for (let px = left; px <= right; px++) {
    const idx = getIndex(px, startY);
    paintPixel(idx);
    visited[startY * width + px] = 1;
  }
  queue.push([left, right, startY, -1]);

  while (queue.length > 0) {
    const [spanLeft, spanRight, spanY, parentY] = queue.shift()!;

    // Check rows above and below
    for (const nextY of [spanY - 1, spanY + 1]) {
      if (nextY < 0 || nextY >= height || nextY === parentY) continue;

      let px = spanLeft;
      while (px <= spanRight) {
        // Skip non-matching or already visited pixels
        const vi = nextY * width + px;
        if (visited[vi] || !matchesTarget(getIndex(px, nextY))) {
          px++;
          continue;
        }

        // Found a matching pixel — expand span in both directions
        let newLeft = px;
        let newRight = px;
        while (newLeft > 0 && !visited[nextY * width + (newLeft - 1)] && matchesTarget(getIndex(newLeft - 1, nextY))) {
          newLeft--;
        }
        while (newRight < width - 1 && !visited[nextY * width + (newRight + 1)] && matchesTarget(getIndex(newRight + 1, nextY))) {
          newRight++;
        }

        // Paint this span
        for (let spx = newLeft; spx <= newRight; spx++) {
          paintPixel(getIndex(spx, nextY));
          visited[nextY * width + spx] = 1;
        }
        queue.push([newLeft, newRight, nextY, spanY]);

        // Jump past this span
        px = newRight + 1;
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}


function hexToRgba(hex: string, alpha: number = 1): string {
  const [r, g, b, a] = parseHexColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${(a / 255) * alpha})`;
}

export function drawBackgroundToContext(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  settings?: BackgroundSettings
): void {
  if (!settings) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    return;
  }

  const size = Math.max(2, Math.round(settings.pixelSize || 16));
  const primary = settings.primaryColor || '#2f3542';
  const secondary = settings.secondaryColor || '#20242c';
  const offsetX = settings.patternOffsetX || 0;
  const offsetY = settings.patternOffsetY || 0;

  ctx.save();
  ctx.clearRect(0, 0, width, height);
  if (settings.transparent) {
    ctx.restore();
    return;
  }
  ctx.fillStyle = secondary;
  ctx.fillRect(0, 0, width, height);

  switch (settings.pattern) {
    case 'solid':
      break;

    case 'dots': {
      const radius = Math.max(1, size * 0.18);
      ctx.fillStyle = primary;
      for (let y = mod(offsetY, size) + size / 2 - size; y < height + size; y += size) {
        for (let x = mod(offsetX, size) + size / 2 - size; x < width + size; x += size) {
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }

    case 'grid': {
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1;
      for (let x = mod(offsetX, size) - size; x <= width + size; x += size) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      for (let y = mod(offsetY, size) - size; y <= height + size; y += size) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
      break;
    }

    case 'graph': {
      const major = size * 5;
      ctx.lineWidth = 1;
      ctx.strokeStyle = hexToRgba(primary, 0.45);
      for (let x = mod(offsetX, size) - size; x <= width + size; x += size) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      for (let y = mod(offsetY, size) - size; y <= height + size; y += size) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
      ctx.strokeStyle = hexToRgba(primary, 0.85);
      ctx.lineWidth = 2;
      for (let x = mod(offsetX, major) - major; x <= width + major; x += major) {
        ctx.beginPath();
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, height);
        ctx.stroke();
      }
      for (let y = mod(offsetY, major) - major; y <= height + major; y += major) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
      break;
    }

    case 'checker': {
      ctx.fillStyle = primary;
      for (let y = mod(offsetY, size * 2) - size * 2; y < height + size * 2; y += size) {
        for (let x = mod(offsetX, size * 2) - size * 2; x < width + size * 2; x += size) {
          if (((x / size) + (y / size)) % 2 === 0) {
            ctx.fillRect(x, y, size, size);
          }
        }
      }
      break;
    }

    case 'ruled': {
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1;
      for (let y = mod(offsetY, size) - size; y <= height + size; y += size) {
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(width, y + 0.5);
        ctx.stroke();
      }
      break;
    }

    default:
      break;
  }

  ctx.restore();
}

function mod(value: number, base: number): number {
  return ((value % base) + base) % base;
}

export function mergeVisibleLayersToCanvas(
  width: number,
  height: number,
  layers: Layer[],
  backgroundSettings?: BackgroundSettings
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  drawBackgroundToContext(ctx, width, height, backgroundSettings);

  layers.forEach((layer) => {
    if (!layer.visible) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = layer.blendMode ?? 'source-over';
    ctx.drawImage(layer.canvas, 0, 0, width, height);
    ctx.restore();
  });

  return canvas;
}

function drawBrushDot(
  ctx: CanvasRenderingContext2D,
  point: Point,
  color: string,
  size: number,
  opacity: number,
): void {
  ctx.save();
  ctx.globalAlpha = opacity / 100;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.5, size / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawEraserDot(
  ctx: CanvasRenderingContext2D,
  point: Point,
  size: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.5, size / 2), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function getStrokePointsUpToTime(stroke: Stroke, timeMs: number): Point[] {
  if (!Number.isFinite(timeMs)) return stroke.points.map((point) => ({ ...point }));
  const points = stroke.points;
  if (points.length === 0) return [];
  if (timeMs < points[0].timestamp) return [];

  const visible = points.filter((point) => point.timestamp <= timeMs).map((point) => ({ ...point }));
  if (visible.length === 0) return [];

  if (visible.length >= points.length) {
    return visible;
  }

  const nextPoint = points[visible.length];
  const lastPoint = visible[visible.length - 1];
  if (!nextPoint || nextPoint.timestamp <= lastPoint.timestamp) {
    return visible;
  }

  const t = (timeMs - lastPoint.timestamp) / (nextPoint.timestamp - lastPoint.timestamp);
  const clamped = Math.max(0, Math.min(1, t));
  visible.push({
    x: lastPoint.x + (nextPoint.x - lastPoint.x) * clamped,
    y: lastPoint.y + (nextPoint.y - lastPoint.y) * clamped,
    pressure: (lastPoint.pressure ?? 1) + ((nextPoint.pressure ?? 1) - (lastPoint.pressure ?? 1)) * clamped,
    timestamp: timeMs,
  });
  return visible;
}

export function renderStrokeToContext(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  timeMs: number = Number.POSITIVE_INFINITY,
): void {
  if (!stroke.points.length) return;

  const fullStrokeReady = timeMs >= stroke.points[stroke.points.length - 1].timestamp;
  const points = fullStrokeReady ? stroke.points : getStrokePointsUpToTime(stroke, timeMs);
  if (points.length === 0) return;
  const mirrorPoints = typeof stroke.mirrorAxisX === 'number'
    ? points.map((point) => ({
        ...point,
        x: stroke.mirrorAxisX! * 2 - point.x,
      }))
    : null;

  switch (stroke.tool) {
    case 'brush': {
      if (points.length === 1) {
        drawBrushDot(ctx, points[0], stroke.color, stroke.size * (points[0].pressure ?? 1), stroke.opacity);
        if (mirrorPoints) {
          drawBrushDot(ctx, mirrorPoints[0], stroke.color, stroke.size * (mirrorPoints[0].pressure ?? 1), stroke.opacity);
        }
      } else {
        drawBrushStroke(ctx, points, stroke.color, stroke.size, stroke.opacity, 100);
        if (mirrorPoints) {
          drawBrushStroke(ctx, mirrorPoints, stroke.color, stroke.size, stroke.opacity, 100);
        }
      }
      break;
    }
    case 'eraser': {
      if (points.length === 1) {
        drawEraserDot(ctx, points[0], stroke.size * (points[0].pressure ?? 1));
        if (mirrorPoints) {
          drawEraserDot(ctx, mirrorPoints[0], stroke.size * (mirrorPoints[0].pressure ?? 1));
        }
      } else {
        drawEraserStroke(ctx, points, stroke.size);
        if (mirrorPoints) {
          drawEraserStroke(ctx, mirrorPoints, stroke.size);
        }
      }
      break;
    }
    case 'line': {
      if (!fullStrokeReady) return;
      drawLine(ctx, stroke.points[0], stroke.points[stroke.points.length - 1], stroke.color, stroke.size, stroke.opacity);
      break;
    }
    case 'rectangle': {
      if (!fullStrokeReady) return;
      drawRectangle(ctx, stroke.points[0], stroke.points[stroke.points.length - 1], stroke.color, stroke.size, stroke.opacity, false);
      break;
    }
    case 'circle': {
      if (!fullStrokeReady) return;
      drawCircle(ctx, stroke.points[0], stroke.points[stroke.points.length - 1], stroke.color, stroke.size, stroke.opacity, false);
      break;
    }
    default:
      break;
  }
}

// Canvas pool for animation rendering — avoids creating N+1 canvases per frame at 60fps.
const canvasPool: HTMLCanvasElement[] = [];

function acquireCanvas(width: number, height: number): HTMLCanvasElement {
  const c = canvasPool.pop() ?? document.createElement('canvas');
  if (c.width !== width || c.height !== height) {
    c.width = width;
    c.height = height;
  } else {
    c.getContext('2d')?.clearRect(0, 0, width, height);
  }
  return c;
}

export function releaseCanvas(c: HTMLCanvasElement) {
  // Keep pool bounded to avoid unbounded memory growth
  if (canvasPool.length < 20) canvasPool.push(c);
}

function getStrokeEndTimeMs(stroke: Stroke): number {
  return stroke.points[stroke.points.length - 1]?.timestamp ?? stroke.points[0]?.timestamp ?? 0;
}

function isAnimatedFreehandStroke(stroke: Stroke): boolean {
  return stroke.tool === 'brush' || stroke.tool === 'eraser';
}

export function compactAnimationStrokeTimings(strokes: Stroke[]): Stroke[] {
  let timelineCursorMs = 0;

  return strokes
    .filter((stroke) => stroke.points.length > 0)
    .map((stroke) => {
      const strokeStartTimeMs = stroke.points[0]?.timestamp ?? 0;
      const normalizedPoints = stroke.points.map((point) => ({
        ...point,
        timestamp: timelineCursorMs + (
          isAnimatedFreehandStroke(stroke)
            ? Math.max(0, point.timestamp - strokeStartTimeMs)
            : 0
        ),
      }));

      timelineCursorMs = normalizedPoints[normalizedPoints.length - 1]?.timestamp ?? timelineCursorMs;

      return {
        ...stroke,
        points: normalizedPoints,
      };
    });
}

export function getAnimationTimelineCursorMs(strokes: Stroke[]): number {
  if (strokes.length === 0) return 0;
  return getStrokeEndTimeMs(strokes[strokes.length - 1]);
}

export function buildAnimationKeyframes(strokes: Stroke[], fps: number): AnimationFrame[] {
  if (strokes.length === 0) return [];

  const fallbackDuration = 1000 / Math.max(1, fps);
  const keyedStrokes = strokes
    .filter((stroke) => stroke.points.length > 0)
    .map((stroke, sourceIndex) => ({
      stroke,
      sourceIndex,
      timeMs: Math.max(0, getStrokeEndTimeMs(stroke)),
    }))
    .sort((a, b) => (a.timeMs - b.timeMs) || (a.sourceIndex - b.sourceIndex));

  return keyedStrokes.map((entry, index) => {
    const previousTimeMs = index > 0 ? (keyedStrokes[index - 1]?.timeMs ?? 0) : 0;
    return {
      id: `keyframe-${entry.stroke.id || entry.sourceIndex}`,
      frameNumber: index + 1,
      strokes: [],
      duration: Math.max(fallbackDuration, entry.timeMs - previousTimeMs),
      timeMs: entry.timeMs,
    };
  });
}

export function getAnimationPlaybackDuration(frames: AnimationFrame[], fps: number): number {
  if (frames.length === 0) return 0;
  const fallbackDuration = 1000 / Math.max(1, fps);
  const lastTimeMs = Math.max(0, frames[frames.length - 1]?.timeMs ?? 0);
  return Math.max(fallbackDuration, lastTimeMs + fallbackDuration);
}

export function findAnimationKeyframeIndexAtTime(frames: AnimationFrame[], timeMs: number): number {
  if (frames.length === 0) return 0;

  let low = 0;
  let high = frames.length - 1;
  let bestIndex = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTimeMs = frames[mid]?.timeMs ?? 0;
    if (midTimeMs <= timeMs) {
      bestIndex = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return bestIndex;
}

export function getAnimationSampleStepMs(fps: number, speed: number = 1): number {
  return (1000 / Math.max(1, fps)) * Math.max(0.01, speed);
}

export function getAnimationSampleCount(totalDurationMs: number, fps: number, speed: number = 1): number {
  if (totalDurationMs <= 0) return 1;
  return Math.max(1, Math.ceil(totalDurationMs / getAnimationSampleStepMs(fps, speed)));
}

export function getAnimationSampleTimeMs(
  totalDurationMs: number,
  fps: number,
  sampleIndex: number,
  speed: number = 1,
): number {
  if (totalDurationMs <= 0) return 0;
  return Math.min(totalDurationMs, getAnimationSampleStepMs(fps, speed) * (sampleIndex + 1));
}

export function renderAnimationCompositeCanvas(
  width: number,
  height: number,
  layers: Layer[],
  backgroundSettings: BackgroundSettings | undefined,
  strokes: Stroke[],
  timeMs: number,
): HTMLCanvasElement {
  const layerCanvases = new Map<string, HTMLCanvasElement>();
  layers.forEach((layer) => {
    layerCanvases.set(layer.id, acquireCanvas(width, height));
  });

  const orderedStrokes = [...strokes].sort((a, b) => {
    const at = a.points[0]?.timestamp ?? 0;
    const bt = b.points[0]?.timestamp ?? 0;
    return at - bt;
  });

  orderedStrokes.forEach((stroke) => {
    const layerCanvas = layerCanvases.get(stroke.layerId);
    const layerCtx = layerCanvas?.getContext('2d');
    if (!layerCtx) return;
    renderStrokeToContext(layerCtx, stroke, timeMs);
  });

  const canvas = acquireCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  drawBackgroundToContext(ctx, width, height, backgroundSettings);

  layers.forEach((layer) => {
    if (!layer.visible) return;
    const layerCanvas = layerCanvases.get(layer.id);
    if (!layerCanvas) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity / 100;
    ctx.globalCompositeOperation = layer.blendMode ?? 'source-over';
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  });

  // Return per-layer canvases to the pool
  layerCanvases.forEach((c) => releaseCanvas(c));

  return canvas;
}
