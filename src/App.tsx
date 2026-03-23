import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { 
  Pencil, Eraser, Minus, Square, Circle, PaintBucket, MousePointer2, Type, Pipette, Move, Blend, Droplets,
  Play, Pause, Film, Download, ChevronDown, SkipBack, SkipForward, StepBack, StepForward, CircleStop,
  Plus, Trash2, Grid, Undo, Redo, Save, FolderOpen, FilePlus, Tablet, Copy, Sun, Moon, ChevronRight,
  RotateCcw, RotateCw, RefreshCw, Github
} from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';

import { CanvasEngine } from './components/CanvasEngine';
import { LayerPanel } from './components/LayerPanel';
import { AnimationTimeline } from './components/AnimationTimeline';
import { ExportDialog } from './components/ExportDialog';
import { ToolSettingsPanel } from './components/ToolSettingsPanel';
import { TabletPanel } from './components/TabletPanel';
import { CanvasSettingsPanel } from './components/CanvasSettingsPanel';
import { DownloadedMemoryPage } from './components/DownloadedMemoryPage';
import { ImageMenu } from './components/ImageMenu';
import { Ruler } from './components/Ruler';
import { NavigatorMinimap } from './components/NavigatorMinimap';
import { HslSliders } from './components/HslSliders';
import { boxBlur, applySharpen, adjustBrightness, adjustContrast, desaturate, invertColors } from './utils/imageFilters';

import type { 
  Layer, ToolType, Stroke, AnimationFrame, ToolSettings, BackgroundSettings
} from './types';
import type { DownloadedMemoryNotebook, DownloadedMemoryPage as DownloadedMemoryPageData } from './types/memory';

import {
  generateId,
  createEmptyLayer,
  drawBrushStroke,
  drawEraserStroke,
  mergeVisibleLayersToCanvas,
  renderAnimationCompositeCanvas,
  releaseCanvas,
  buildAnimationKeyframes,
  compactAnimationStrokeTimings,
  findAnimationKeyframeIndexAtTime,
  getAnimationPlaybackDuration,
  getAnimationTimelineCursorMs,
  getAnimationSampleStepMs,
} from './utils/helpers';
import { useAnimationRecorder } from './hooks/useAnimationRecorder';
import { useHistory } from './hooks/useHistory';

const APP_NAME = 'takingnotes.ink';
const APP_ID = 'takingnotes.ink';
const LEGACY_APP_IDS = new Set(['takingnotes.ink', 'noteworthy.stream']);
const PROJECT_EXTENSION = '.tnk';
const MEMORY_LIBRARY_STORAGE_KEY = 'takingnotes_downloaded_memory';
const NOTEBOOK_NAME_STORAGE_KEY = 'takingnotes_notebook_names';
const HUION_MEMORY_STROKE_GAP_SPLIT_DISTANCE = 80;
const MIN_ZOOM = 10;
const MAX_ZOOM = 500;
const ZOOM_STEP = 10;
const FIT_CANVAS_PADDING_PX = 32;
const FIT_CANVAS_BUFFER_PX = 32;
type CanvasViewRotation = 0 | 90 | 180 | 270;

interface ViewportTouchGesture {
  initialDistance: number;
  initialZoom: number;
  midpointClientX: number;
  midpointClientY: number;
}

interface SerializedProjectLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  blendMode: Layer['blendMode'];
  imageData: string;
}

interface SerializedProjectData {
  app?: string;
  layers?: SerializedProjectLayer[];
  canvasSize?: { width?: number; height?: number };
  activeLayerId?: string | null;
  fps?: number;
  playbackSpeed?: number;
  frames?: AnimationFrame[];
  animationStrokes?: Stroke[];
  toolSettings?: Partial<ToolSettings>;
  backgroundSettings?: Partial<BackgroundSettings>;
  bgColor?: string;
  recentColors?: string[];
  symmetryX?: boolean;
}

type NotebookNameRegistry = Record<string, string>;

function loadNotebookNameRegistry(): NotebookNameRegistry {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const saved = window.localStorage.getItem(NOTEBOOK_NAME_STORAGE_KEY);
    if (!saved) {
      return {};
    }
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0),
    );
  } catch {
    return {};
  }
}

function defaultNotebookNameForDevice(deviceType: DownloadedMemoryNotebook['deviceType'], deviceName: string) {
  const trimmedName = String(deviceName || '').trim();
  if (trimmedName) {
    return trimmedName;
  }
  return deviceType === 'wacom' ? 'Wacom/tUHI Notebook' : 'Huion Notebook';
}

function fallbackNotebookUuid(candidate: Partial<DownloadedMemoryNotebook>) {
  const explicitUuid = typeof candidate.notebookUuid === 'string' ? candidate.notebookUuid.trim() : '';
  if (explicitUuid) {
    return explicitUuid;
  }

  const deviceType = candidate.deviceType === 'wacom' ? 'wacom' : 'huion';
  const rawId = typeof candidate.deviceId === 'string' && candidate.deviceId.trim()
    ? candidate.deviceId.trim()
    : typeof candidate.deviceName === 'string' && candidate.deviceName.trim()
      ? candidate.deviceName.trim()
      : typeof candidate.id === 'string' && candidate.id.trim()
        ? candidate.id.trim()
        : 'unknown';

  return rawId.startsWith('wacom:') || rawId.startsWith('huion:')
    ? rawId
    : `${deviceType}:${rawId}`;
}

function normalizeDownloadedPoint(raw: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  return {
    x: Number(raw?.x) || 0,
    y: Number(raw?.y) || 0,
    pressure: Number(raw?.pressure) || 0,
  };
}

function splitDownloadedStrokeOnLargeGaps(
  points: Array<{ x: number; y: number; pressure: number }>,
  pageWidth: number,
  pageHeight: number,
) {
  if (points.length < 2) {
    return points.length > 0 ? [{ points }] : [];
  }

  const repaired: Array<{ points: Array<{ x: number; y: number; pressure: number }> }> = [];
  let currentStroke = [points[0]];

  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    const previousPoint = currentStroke[currentStroke.length - 1];
    const gap = Math.hypot(
      (point.x - previousPoint.x) * pageWidth,
      (point.y - previousPoint.y) * pageHeight,
    );

    if (gap > HUION_MEMORY_STROKE_GAP_SPLIT_DISTANCE) {
      repaired.push({ points: currentStroke });
      currentStroke = [point];
      continue;
    }

    currentStroke.push(point);
  }

  if (currentStroke.length > 0) {
    repaired.push({ points: currentStroke });
  }

  return repaired;
}

function normalizeDownloadedMemoryPage(
  raw: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  index: number,
  pageWidth: number,
  pageHeight: number,
  splitLargeHuionGaps: boolean,
): DownloadedMemoryPageData {
  const strokes = Array.isArray(raw?.strokes)
    ? raw.strokes.flatMap((stroke: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const normalizedPoints = Array.isArray(stroke?.points)
          ? stroke.points.map(normalizeDownloadedPoint)
          : [];

        if (!splitLargeHuionGaps) {
          return normalizedPoints.length > 0 ? [{ points: normalizedPoints }] : [];
        }

        return splitDownloadedStrokeOnLargeGaps(normalizedPoints, pageWidth, pageHeight);
      })
    : [];

  const pointCount = strokes.reduce((sum: number, stroke: { points: ArrayLike<unknown> }) => sum + stroke.points.length, 0);

  return {
    id: typeof raw?.id === 'string' && raw.id.trim() ? raw.id : generateId(),
    pageNum: typeof raw?.pageNum === 'number' ? raw.pageNum : index,
    strokeCount: strokes.length,
    pointCount,
    timestamp: typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now(),
    strokes,
  };
}

function normalizeDownloadedNotebook(
  raw: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  notebookNameRegistry: NotebookNameRegistry,
): DownloadedMemoryNotebook | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const deviceType = raw.deviceType === 'wacom' ? 'wacom' : 'huion';
  const deviceName = typeof raw.deviceName === 'string' ? raw.deviceName.trim() : '';
  const notebookUuid = fallbackNotebookUuid({ ...raw, deviceType, deviceName });
  const savedNotebookName = notebookNameRegistry[notebookUuid]?.trim();
  const currentNotebookName = typeof raw.notebookName === 'string' ? raw.notebookName.trim() : '';
  const pageWidth = typeof raw.pageWidth === 'number' ? raw.pageWidth : 800;
  const pageHeight = typeof raw.pageHeight === 'number' ? raw.pageHeight : 600;
  const pages = Array.isArray(raw.pages)
    ? raw.pages.map((page: any, index: number) => normalizeDownloadedMemoryPage(page, index, pageWidth, pageHeight, deviceType === 'huion')) // eslint-disable-line @typescript-eslint/no-explicit-any
    : [];

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateId(),
    deviceId: notebookUuid,
    notebookUuid,
    deviceType,
    deviceName: deviceName || defaultNotebookNameForDevice(deviceType, ''),
    notebookName: savedNotebookName || currentNotebookName || defaultNotebookNameForDevice(deviceType, deviceName),
    downloadedAt: typeof raw.downloadedAt === 'number' ? raw.downloadedAt : Date.now(),
    pageWidth,
    pageHeight,
    pageCount: typeof raw.pageCount === 'number' ? raw.pageCount : pages.length,
    pages,
  };
}

function clampZoom(value: number) {
  const rounded = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

function clampZoomSmooth(value: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

function normalizeCanvasRotation(value: number): CanvasViewRotation {
  const normalized = ((value % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function getCanvasViewportFootprint(
  width: number,
  height: number,
  zoom: number,
  rotation: CanvasViewRotation,
) {
  const displayWidth = width * zoom;
  const displayHeight = height * zoom;
  if (rotation === 90 || rotation === 270) {
    return { width: displayHeight, height: displayWidth };
  }
  return { width: displayWidth, height: displayHeight };
}

function getFrequentReadContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return canvas.getContext('2d', { willReadFrequently: true }) ?? canvas.getContext('2d')!;
}

function App() {
  // Core State
  const [layers, setLayers] = useState<Layer[]>([]);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolType>('brush');
  const [toolSettings, setToolSettings] = useState<ToolSettings>({
    size: 5,
    opacity: 100,
    color: '#000000',
    hardness: 100,
    spacing: 10,
    fillTolerance: 32,
    fillContiguous: true,
    shapeFilled: false,
    gradientType: 'linear',
    fontFamily: '"TASA Orbiter", sans-serif',
  });
  const [bgColor, setBgColor] = useState('#ffffff');
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [previousColor, setPreviousColor] = useState('#000000');
  
  // Canvas State
  const [zoom, setZoom] = useState(100);
  const [canvasRotation, setCanvasRotation] = useState<CanvasViewRotation>(0);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const [backgroundSettings, setBackgroundSettings] = useState<BackgroundSettings>({
    width: 800,
    height: 600,
    pattern: 'solid',
    pixelSize: 24,
    patternOffsetX: 0,
    patternOffsetY: 0,
    aspectPreset: '4:3',
    primaryColor: '#c8d0dc',
    secondaryColor: '#ffffff',
    transparent: false,
  });
  
  // Animation State
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [storedFrames, setStoredFrames] = useState<AnimationFrame[]>([]);
  const [animationStrokes, setAnimationStrokes] = useState<Stroke[]>([]);
  const [fps, setFps] = useState(60); // render/export FPS
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // playback speed multiplier
  const isEventPlayback = animationStrokes.length > 0;
  const frames = useMemo(
    () => (isEventPlayback ? buildAnimationKeyframes(animationStrokes, fps) : storedFrames),
    [animationStrokes, fps, isEventPlayback, storedFrames],
  );
  
  // UI State
  const [showGrid, setShowGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(() => {
    try {
      return localStorage.getItem('takingnotes_show_rulers') !== 'false';
    } catch {
      return true;
    }
  });
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [layerRenderTick, setLayerRenderTick] = useState(0);
  const [rightTab, setRightTab] = useState<'layers' | 'tools' | 'color' | 'tablet'>('layers');
  const [showBackgroundLayerSettings, setShowBackgroundLayerSettings] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPanels, setShowPanels] = useState(true);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [symmetryX, setSymmetryX] = useState(false);
  const [activePage, setActivePage] = useState<'studio' | 'memory'>('studio');
  const [notebookNameRegistry, setNotebookNameRegistry] = useState<NotebookNameRegistry>(() => loadNotebookNameRegistry());
  const [downloadedNotebooks, setDownloadedNotebooks] = useState<DownloadedMemoryNotebook[]>(() => {
    if (typeof window === 'undefined') {
      return [];
    }

    try {
      const saved = window.localStorage.getItem(MEMORY_LIBRARY_STORAGE_KEY);
      if (!saved) {
        return [];
      }
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) {
        return [];
      }
      const registry = loadNotebookNameRegistry();
      return parsed
        .map((entry) => normalizeDownloadedNotebook(entry, registry))
        .filter((entry): entry is DownloadedMemoryNotebook => entry != null);
    } catch (e) {
      console.warn('[Memory] Failed to restore downloaded memory:', e);
      return [];
    }
  });
  const [hasTabletConnection, setHasTabletConnection] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem('takingnotes_theme');
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });
  const [fpsDraft, setFpsDraft] = useState(String(60));
  const [zoomDraft, setZoomDraft] = useState(String(100));
  const [layerOpacityDraft, setLayerOpacityDraft] = useState(String(100));

  // Drawing Tablet mode — cursor overlay + streaming indicator
  const [blePenCursor, setBlePenCursor] = useState<{ x: number; y: number; pressure: number; active: boolean } | null>(null);
  const [isTabletStreaming, setIsTabletStreaming] = useState(false);
  
  // Device resolution prompt
  const [resolutionPrompt, setResolutionPrompt] = useState<{
    deviceName: string;
    portrait: { width: number; height: number };
    landscape: { width: number; height: number };
    preferredOrientation: 'portrait' | 'landscape';
    modeLabel: 'paper' | 'tablet';
  } | null>(null);
  const [canvasResizePrompt, setCanvasResizePrompt] = useState<{ width: string; height: string } | null>(null);

  // Refs
  const canvasEngineRef = useRef<{
    renderFrame: (frame: AnimationFrame) => void;
    clearCanvas: () => void;
    getMergedCanvas: () => HTMLCanvasElement;
    applyHistory: (layerId: string, imageData: ImageData) => void;
    recomposite: (mode?: 'full' | 'active') => void;
    startFreeTransform: () => boolean;
    commitFreeTransform: () => boolean;
    cancelFreeTransform: () => boolean;
    isFreeTransformActive: () => boolean;
  } | null>(null);
  const animationRef = useRef<number | null>(null);
  const animationTimelineCursorRef = useRef(0);
  const playbackTimeRef = useRef(0);
  const bleCurrentStrokeRef = useRef<Stroke | null>(null);
  const pendingFrameRenderRef = useRef<number | null>(null);
  const isCanvasDrawingRef = useRef(false);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const userScrubRef = useRef(false);
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const currentFrameRef = useRef(currentFrame);
  currentFrameRef.current = currentFrame;
  const playbackSpeedRef = useRef(playbackSpeed);
  playbackSpeedRef.current = playbackSpeed;
  
  // Custom Hooks
  const { 
    startRecording, 
    stopRecording, 
    addStroke 
  } = useAnimationRecorder();
  
  const {
    undo: rawUndo, redo: rawRedo, canUndo, canRedo, saveState,
    clear: clearHistory, undoTargetLayerId, redoTargetLayerId
  } = useHistory();

  // Keep layers and activeLayerId in refs so undo/redo and BLE callbacks never go stale
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const activeLayerIdRef = useRef(activeLayerId);
  activeLayerIdRef.current = activeLayerId;
  const canvasViewportRef = useRef<HTMLDivElement | null>(null);
  const panDragRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const pendingZoomAnchorRef = useRef<{
    contentX: number;
    contentY: number;
    viewportX: number;
    viewportY: number;
    previousZoom: number;
  } | null>(null);
  const touchGestureRef = useRef<ViewportTouchGesture | null>(null);
  const viewportScrollAnimationRef = useRef<number | null>(null);

  const appendAnimationStroke = useCallback((stroke: Stroke) => {
    if (!stroke.points.length) return;
    const isFreehand = stroke.tool === 'brush' || stroke.tool === 'eraser';
    const strokeStartTime = stroke.points[0].timestamp;
    const timelineOffset = animationTimelineCursorRef.current;

    const normalizedStroke: Stroke = {
      ...stroke,
      id: stroke.id || generateId(),
      points: stroke.points.map((point) => ({
        ...point,
        timestamp: timelineOffset + (
          isFreehand
            ? Math.max(0, point.timestamp - strokeStartTime)
            : 0
        ),
      })),
    };

    animationTimelineCursorRef.current = normalizedStroke.points[normalizedStroke.points.length - 1]?.timestamp ?? timelineOffset;
    setStoredFrames([]);
    setAnimationStrokes((prev) => [...prev, normalizedStroke]);
  }, []);

  const appendAnimationStrokeBatch = useCallback((strokes: Stroke[]) => {
    if (strokes.length === 0) return;
    const normalized = strokes
      .filter((stroke) => stroke.points.length > 0)
      .map((stroke) => {
        const isFreehand = stroke.tool === 'brush' || stroke.tool === 'eraser';
        const strokeStartTime = stroke.points[0]?.timestamp ?? 0;
        const timelineOffset = animationTimelineCursorRef.current;
        const normalizedStroke: Stroke = {
          ...stroke,
          id: stroke.id || generateId(),
          points: stroke.points.map((point) => ({
            ...point,
            timestamp: timelineOffset + (
              isFreehand
                ? Math.max(0, point.timestamp - strokeStartTime)
                : 0
            ),
          })),
        };
        animationTimelineCursorRef.current = normalizedStroke.points[normalizedStroke.points.length - 1]?.timestamp ?? timelineOffset;
        return normalizedStroke;
      });
    if (normalized.length === 0) return;
    setStoredFrames([]);
    setAnimationStrokes((prev) => [...prev, ...normalized]);
  }, []);

  const clearAnimationTimeline = useCallback(() => {
    animationTimelineCursorRef.current = 0;
    playbackTimeRef.current = 0;
    bleCurrentStrokeRef.current = null;
    setAnimationStrokes([]);
    setStoredFrames([]);
    setCurrentFrame(0);
  }, []);

  const lastAnimSnapshotRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    setFpsDraft(String(fps));
  }, [fps]);

  useEffect(() => {
    setZoomDraft(String(zoom));
  }, [zoom]);

  const activeLayerOpacity = layers.find(l => l.id === activeLayerId)?.opacity ?? 100;
  useEffect(() => {
    setLayerOpacityDraft(String(activeLayerOpacity));
  }, [activeLayerId, activeLayerOpacity]);
  const renderAnimationAtTime = useCallback((timeMs: number) => {
    if (!canvasEngineRef.current) return;
    // Return previous snapshot to the canvas pool before acquiring a new one
    if (lastAnimSnapshotRef.current) {
      releaseCanvas(lastAnimSnapshotRef.current);
    }
    const snapshot = renderAnimationCompositeCanvas(
      canvasSize.width,
      canvasSize.height,
      layersRef.current,
      backgroundSettings,
      animationStrokes,
      timeMs,
    );
    lastAnimSnapshotRef.current = snapshot;
    canvasEngineRef.current.renderFrame({
      id: `playback-${timeMs}`,
      frameNumber: 0,
      strokes: [],
      duration: 0,
      timeMs,
      snapshot,
    });
  }, [animationStrokes, backgroundSettings, canvasSize.height, canvasSize.width]);

  // Track which animation strokes were removed by undo so redo can restore them
  const undoneStrokesRef = useRef<Stroke[]>([]);

  const handleUndo = useCallback(() => {
    const targetId = undoTargetLayerId();
    if (!targetId) return;
    const targetLayer = layersRef.current.find(l => l.id === targetId);
    if (!targetLayer) return;
    const currentImageData = targetLayer.ctx.getImageData(
      0, 0, targetLayer.canvas.width, targetLayer.canvas.height
    );
    const state = rawUndo(targetId, currentImageData);
    if (state && canvasEngineRef.current) {
      canvasEngineRef.current.applyHistory(state.layerId, state.imageData);
    }
    // Remove the last animation stroke for this layer (undo reverses the last draw)
    setAnimationStrokes(prev => {
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].layerId === targetId) {
          undoneStrokesRef.current.push(prev[i]);
          const next = compactAnimationStrokeTimings([...prev.slice(0, i), ...prev.slice(i + 1)]);
          animationTimelineCursorRef.current = getAnimationTimelineCursorMs(next);
          return next;
        }
      }
      return prev;
    });
  }, [rawUndo, undoTargetLayerId]);

  const handleRedo = useCallback(() => {
    const targetId = redoTargetLayerId();
    if (!targetId) return;
    const targetLayer = layersRef.current.find(l => l.id === targetId);
    if (!targetLayer) return;
    const currentImageData = targetLayer.ctx.getImageData(
      0, 0, targetLayer.canvas.width, targetLayer.canvas.height
    );
    const state = rawRedo(targetId, currentImageData);
    if (state && canvasEngineRef.current) {
      canvasEngineRef.current.applyHistory(state.layerId, state.imageData);
    }
    // Restore the animation stroke that was removed by undo
    const restored = undoneStrokesRef.current.pop();
    if (restored) {
      setAnimationStrokes(prev => {
        const next = compactAnimationStrokeTimings([...prev, restored]);
        animationTimelineCursorRef.current = getAnimationTimelineCursorMs(next);
        return next;
      });
    }
  }, [rawRedo, redoTargetLayerId]);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    try {
      localStorage.setItem('takingnotes_theme', theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('takingnotes_show_rulers', String(showRulers));
    } catch {
      // ignore storage errors
    }
  }, [showRulers]);

  // Initialize with saved data from localStorage, or default layer
  useEffect(() => {
    const restoreFromStorage = async () => {
      try {
        const saved = localStorage.getItem('takingnotes_autosave');
        if (saved) {
          const data = JSON.parse(saved);
          if (data.layers && data.layers.length > 0) {
            const restoredLayers: Layer[] = [];
            for (const sl of data.layers) {
              const img = new Image();
              await new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve(); // skip broken layers
                img.src = sl.dataUrl;
              });
              const canvas = document.createElement('canvas');
              canvas.width = data.canvasWidth || 800;
              canvas.height = data.canvasHeight || 600;
              const ctx = getFrequentReadContext(canvas);
              ctx.drawImage(img, 0, 0);
              restoredLayers.push({
                id: sl.id || generateId(),
                name: sl.name || 'Layer',
                visible: sl.visible ?? true,
                locked: sl.locked ?? false,
                opacity: sl.opacity ?? 100,
                blendMode: sl.blendMode,
                canvas,
                ctx,
              });
            }
            if (restoredLayers.length > 0) {
              const restoredCanvasSize = {
                width: data.canvasWidth || 800,
                height: data.canvasHeight || 600,
              };
              const nextActiveLayerId = data.activeLayerId || restoredLayers[0].id;
              layersRef.current = restoredLayers;
              activeLayerIdRef.current = nextActiveLayerId;
              setLayers(restoredLayers);
              setActiveLayerId(nextActiveLayerId);
              setCanvasSize(restoredCanvasSize);
              setBackgroundSettings((prev) => ({
                ...prev,
                width: restoredCanvasSize.width,
                height: restoredCanvasSize.height,
                ...(data.backgroundSettings || {}),
              }));
              const restoredAnimationStrokes = compactAnimationStrokeTimings(
                Array.isArray(data.animationStrokes) ? data.animationStrokes : [],
              );
              setStoredFrames(restoredAnimationStrokes.length > 0
                ? []
                : (Array.isArray(data.frames) ? data.frames : []));
              setAnimationStrokes(restoredAnimationStrokes);
              animationTimelineCursorRef.current = getAnimationTimelineCursorMs(restoredAnimationStrokes);
              setFps(typeof data.fps === 'number' ? data.fps : 60);
              if (typeof data.playbackSpeed === 'number') setPlaybackSpeed(data.playbackSpeed);
              setToolSettings((prev) => ({
                ...prev,
                ...(data.toolSettings || {}),
              }));
              if (typeof data.bgColor === 'string') setBgColor(data.bgColor);
              if (Array.isArray(data.recentColors)) setRecentColors(data.recentColors);
              if (typeof data.symmetryX === 'boolean') setSymmetryX(data.symmetryX);
              console.log(`[AutoSave] Restored ${restoredLayers.length} layers from localStorage`);
              return;
            }
          }
        }
      } catch (e) {
        console.warn('[AutoSave] Failed to restore:', e);
      }
      // Fallback: create default layer
      if (layers.length === 0) {
        const defaultLayer = createEmptyLayer('Layer 1', canvasSize.width, canvasSize.height);
        layersRef.current = [defaultLayer];
        activeLayerIdRef.current = defaultLayer.id;
        setLayers([defaultLayer]);
        setActiveLayerId(defaultLayer.id);
      }
    };
    restoreFromStorage();
    // Auto-center canvas in viewport after initial render
    requestAnimationFrame(() => {
      const vp = canvasViewportRef.current;
      if (vp) {
        vp.scrollLeft = Math.max(0, (vp.scrollWidth - vp.clientWidth) / 2);
        vp.scrollTop = Math.max(0, (vp.scrollHeight - vp.clientHeight) / 2);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MEMORY_LIBRARY_STORAGE_KEY, JSON.stringify(downloadedNotebooks));
    } catch (e) {
      console.warn('[Memory] Failed to persist downloaded memory:', e);
    }
  }, [downloadedNotebooks]);

  useEffect(() => {
    try {
      localStorage.setItem(NOTEBOOK_NAME_STORAGE_KEY, JSON.stringify(notebookNameRegistry));
    } catch (e) {
      console.warn('[Memory] Failed to persist notebook names:', e);
    }
  }, [notebookNameRegistry]);

  // Auto-save to localStorage on every render tick (debounced)
  useEffect(() => {
    if (layers.length === 0) return;
    const timer = setTimeout(() => {
      try {
        const data = {
          canvasWidth: canvasSize.width,
          canvasHeight: canvasSize.height,
          activeLayerId,
          fps,
          playbackSpeed,
          // Save frame metadata but strip thumbnails (large) and snapshots (non-serializable).
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          frames: storedFrames.map(({ thumbnail, snapshot, contentHash, ...rest }) => rest),
          animationStrokes,
          toolSettings,
          backgroundSettings,
          bgColor,
          recentColors,
          symmetryX,
          layers: layers.map(l => ({
            id: l.id,
            name: l.name,
            visible: l.visible,
            locked: l.locked,
            opacity: l.opacity,
            blendMode: l.blendMode,
            dataUrl: l.canvas.toDataURL('image/png'),
          })),
        };
        localStorage.setItem('takingnotes_autosave', JSON.stringify(data));
      } catch (e) {
        // localStorage might be full — silently fail
        console.warn('[AutoSave] Save failed:', e);
      }
    }, 1000); // 1 second debounce
    return () => clearTimeout(timer);
  }, [layers, layerRenderTick, canvasSize, activeLayerId, fps, playbackSpeed, storedFrames, animationStrokes, toolSettings, backgroundSettings, bgColor, recentColors, symmetryX]);

  // Generate one frame per stroke — the animation plays back each stroke appearing one at a time.
  // FPS controls playback speed, NOT how many frames are generated.
  // Stable refs for functions used in the keyboard handler (defined later in the file)
  const saveProjectRef = useRef<() => void>(() => {});
  const openFileRef = useRef<() => void>(() => {});
  const duplicateLayerRef = useRef<(id: string) => void>(() => {});
  const bgColorRef = useRef(bgColor);
  bgColorRef.current = bgColor;
  const setActiveToolRef = useRef(setActiveTool);
  setActiveToolRef.current = setActiveTool;
  const toolSettingsRefKb = useRef(toolSettings);
  toolSettingsRefKb.current = toolSettings;
  const setToolSettingsRef = useRef(setToolSettings);
  setToolSettingsRef.current = setToolSettings;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const applyZoomRef = useRef<(v: number) => void>(() => {});
  const fitCanvasToViewportRef = useRef<() => void>(() => {});

  const cancelViewportScrollAnimation = useCallback(() => {
    if (viewportScrollAnimationRef.current == null) return;
    cancelAnimationFrame(viewportScrollAnimationRef.current);
    viewportScrollAnimationRef.current = null;
  }, []);

  const scrollViewportTo = useCallback((
    left: number,
    top: number,
    options?: { immediate?: boolean; durationMs?: number },
  ) => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    const targetLeft = Math.max(0, Math.min(left, maxLeft));
    const targetTop = Math.max(0, Math.min(top, maxTop));

    if (options?.immediate) {
      cancelViewportScrollAnimation();
      viewport.scrollLeft = targetLeft;
      viewport.scrollTop = targetTop;
      return;
    }

    const startLeft = viewport.scrollLeft;
    const startTop = viewport.scrollTop;
    const deltaLeft = targetLeft - startLeft;
    const deltaTop = targetTop - startTop;
    if (Math.abs(deltaLeft) < 0.5 && Math.abs(deltaTop) < 0.5) {
      viewport.scrollLeft = targetLeft;
      viewport.scrollTop = targetTop;
      return;
    }

    cancelViewportScrollAnimation();
    const durationMs = options?.durationMs ?? 140;
    const startedAt = performance.now();
    const step = (timestamp: number) => {
      const vp = canvasViewportRef.current;
      if (!vp) {
        viewportScrollAnimationRef.current = null;
        return;
      }
      const t = Math.min(1, (timestamp - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      vp.scrollLeft = startLeft + deltaLeft * eased;
      vp.scrollTop = startTop + deltaTop * eased;
      if (t < 1) {
        viewportScrollAnimationRef.current = requestAnimationFrame(step);
      } else {
        vp.scrollLeft = targetLeft;
        vp.scrollTop = targetTop;
        viewportScrollAnimationRef.current = null;
      }
    };
    viewportScrollAnimationRef.current = requestAnimationFrame(step);
  }, [cancelViewportScrollAnimation]);

  const handleNewProject = useCallback(() => {
    if (animationRef.current) {
      clearTimeout(animationRef.current);
      animationRef.current = null;
    }
    const freshLayer = createEmptyLayer('Layer 1', canvasSize.width, canvasSize.height);
    layersRef.current.forEach((layer) => layer.ctx.clearRect(0, 0, canvasSize.width, canvasSize.height));
    layersRef.current = [freshLayer];
    activeLayerIdRef.current = freshLayer.id;
    setLayers([freshLayer]);
    setActiveLayerId(freshLayer.id);
    setSelection(null);
    userScrubRef.current = false;
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsRecording(false);
    clearAnimationTimeline();
    clearHistory();
    setCanvasRotation(0);
    bleCurrentStrokeRef.current = null;
    setBlePenCursor(null);
    setLayerRenderTick((t) => t + 1);
    try { localStorage.removeItem('takingnotes_autosave'); } catch { /* ignore */ }
    canvasEngineRef.current?.clearCanvas();
    requestAnimationFrame(() => {
      canvasEngineRef.current?.recomposite('full');
    });
  }, [canvasSize.height, canvasSize.width, clearAnimationTimeline, clearHistory]);

  // Keyboard shortcuts — PS/Photopea conventions
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;
      const ctrl = e.ctrlKey || e.metaKey;
      const transformActive = canvasEngineRef.current?.isFreeTransformActive?.() ?? false;

      if (transformActive) {
        if (e.key === 'Enter') {
          e.preventDefault();
          canvasEngineRef.current?.commitFreeTransform();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          canvasEngineRef.current?.cancelFreeTransform();
          return;
        }
        if (!inInput) {
          if (ctrl && e.altKey && e.key.toLowerCase() === 't') {
            e.preventDefault();
          }
          return;
        }
      }

      // Ctrl+Z/Y — let native undo/redo work in text inputs
      if (ctrl && e.key === 'z' && !e.shiftKey) { if (!inInput) { e.preventDefault(); handleUndo(); } return; }
      if (ctrl && (e.key === 'y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey))) { if (!inInput) { e.preventDefault(); handleRedo(); } return; }
      if (ctrl && e.shiftKey && e.key === 'S') { e.preventDefault(); setShowExportDialog(true); return; }
      if (ctrl && e.key === 's') { e.preventDefault(); saveProjectRef.current(); return; }
      if (ctrl && e.key === 'o') { e.preventDefault(); openFileRef.current(); return; }
      // Ctrl+V = paste image from clipboard as new layer
      if (ctrl && e.key === 'v') {
        e.preventDefault();
        navigator.clipboard.read?.().then(async (items) => {
          for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (!imageType) continue;
            const blob = await item.getType(imageType);
            const img = new Image();
            const url = URL.createObjectURL(blob);
            img.onload = () => {
              const layer = createEmptyLayer('Pasted', canvasSize.width, canvasSize.height);
              layer.ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
              layersRef.current = [...layersRef.current, layer];
              activeLayerIdRef.current = layer.id;
              setLayers(prev => [...prev, layer]);
              setActiveLayerId(layer.id);
              URL.revokeObjectURL(url);
            };
            img.onerror = () => URL.revokeObjectURL(url);
            img.src = url;
            break;
          }
        }).catch(() => { /* clipboard access denied or empty */ });
        return;
      }
      // Ctrl+A = select all (PS convention)
      if (ctrl && e.key === 'a') { e.preventDefault(); setSelection({ x: 0, y: 0, w: canvasSize.width, h: canvasSize.height }); return; }
      // Ctrl+D = deselect (PS convention)
      if (ctrl && e.key === 'd') { e.preventDefault(); setSelection(null); return; }
      // Ctrl+Shift+C = copy merged (all visible layers flattened)
      if (ctrl && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        const merged = mergeVisibleLayersToCanvas(canvasSize.width, canvasSize.height, layersRef.current, backgroundSettings);
        const sel = selection;
        const copyCanvas = document.createElement('canvas');
        if (sel) {
          copyCanvas.width = sel.w; copyCanvas.height = sel.h;
          copyCanvas.getContext('2d')?.drawImage(merged, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
        } else {
          copyCanvas.width = merged.width; copyCanvas.height = merged.height;
          copyCanvas.getContext('2d')?.drawImage(merged, 0, 0);
        }
        copyCanvas.toBlob((blob) => {
          if (!blob) return;
          navigator.clipboard.write?.([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
        }, 'image/png');
        return;
      }
      // Ctrl+C = copy (selection or full canvas) to clipboard
      if (ctrl && e.key === 'c') {
        e.preventDefault();
        const alId = activeLayerIdRef.current;
        if (!alId) return;
        const layer = layersRef.current.find(l => l.id === alId);
        if (!layer) return;
        const sel = selection;
        const copyCanvas = document.createElement('canvas');
        if (sel) {
          copyCanvas.width = sel.w;
          copyCanvas.height = sel.h;
          copyCanvas.getContext('2d')?.drawImage(layer.canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
        } else {
          copyCanvas.width = layer.canvas.width;
          copyCanvas.height = layer.canvas.height;
          copyCanvas.getContext('2d')?.drawImage(layer.canvas, 0, 0);
        }
        copyCanvas.toBlob((blob) => {
          if (!blob) return;
          navigator.clipboard.write?.([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
        }, 'image/png');
        return;
      }
      // Ctrl+X = cut selection
      if (ctrl && e.key === 'x' && selection) {
        e.preventDefault();
        const alId = activeLayerIdRef.current;
        if (!alId) return;
        const layer = layersRef.current.find(l => l.id === alId);
        if (!layer || layer.locked) return;
        const sel = selection;
        // Copy to clipboard
        const copyCanvas = document.createElement('canvas');
        copyCanvas.width = sel.w; copyCanvas.height = sel.h;
        copyCanvas.getContext('2d')?.drawImage(layer.canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
        copyCanvas.toBlob((blob) => {
          if (!blob) return;
          navigator.clipboard.write?.([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
        }, 'image/png');
        // Clear the selection area
        const imgData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        saveState(alId, imgData);
        layer.ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
        canvasEngineRef.current?.recomposite();
        setLayerRenderTick(t => t + 1);
        setSelection(null);
        return;
      }
      // Ctrl+J = duplicate layer (PS convention)
      if (ctrl && e.key === 'j') {
        e.preventDefault();
        const alId = activeLayerIdRef.current;
        if (alId) duplicateLayerRef.current(alId);
        return;
      }
      // Ctrl+I = invert colors (PS convention)
      if (ctrl && e.key === 'i' && !e.shiftKey) {
        e.preventDefault();
        const alId = activeLayerIdRef.current;
        if (!alId) return;
        const layer = layersRef.current.find(l => l.id === alId);
        if (!layer || layer.locked) return;
        const imgData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        saveState(alId, imgData);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          d[i] = 255 - d[i];
          d[i + 1] = 255 - d[i + 1];
          d[i + 2] = 255 - d[i + 2];
        }
        layer.ctx.putImageData(imgData, 0, 0);
        canvasEngineRef.current?.recomposite();
        setLayerRenderTick(t => t + 1);
        return;
      }
      // Ctrl+Shift+U = desaturate (PS convention)
      if (ctrl && e.shiftKey && e.key === 'U') {
        e.preventDefault();
        const alId = activeLayerIdRef.current;
        if (!alId) return;
        const layer = layersRef.current.find(l => l.id === alId);
        if (!layer || layer.locked) return;
        const imgData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        saveState(alId, imgData);
        const d = imgData.data;
        for (let i = 0; i < d.length; i += 4) {
          const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
          d[i] = gray; d[i + 1] = gray; d[i + 2] = gray;
        }
        layer.ctx.putImageData(imgData, 0, 0);
        canvasEngineRef.current?.recomposite();
        setLayerRenderTick(t => t + 1);
        return;
      }
      // Ctrl+E = merge down (PS convention: merge active layer into the one below)
      if (ctrl && !e.shiftKey && e.key === 'e') {
        e.preventDefault();
        const ls = layersRef.current;
        const alId = activeLayerIdRef.current;
        if (!alId || ls.length <= 1) return;
        const idx = ls.findIndex(l => l.id === alId);
        if (idx <= 0) return; // no layer below
        const above = ls[idx];
        const below = ls[idx - 1];
        // Draw above onto below using the upper layer's blend settings.
        below.ctx.save();
        below.ctx.globalAlpha = above.opacity / 100;
        below.ctx.globalCompositeOperation = above.blendMode ?? 'source-over';
        below.ctx.drawImage(above.canvas, 0, 0);
        below.ctx.restore();
        // Remove the above layer
        const next = ls.filter((_, i) => i !== idx);
        layersRef.current = next;
        activeLayerIdRef.current = below.id;
        setLayers(next);
        setActiveLayerId(below.id);
        canvasEngineRef.current?.recomposite();
        setLayerRenderTick(t => t + 1);
        return;
      }
      // Ctrl+Shift+E = flatten/merge visible layers
      if (ctrl && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        const ls = layersRef.current;
        if (ls.length <= 1) return;
        const merged = mergeVisibleLayersToCanvas(canvasSize.width, canvasSize.height, ls, backgroundSettings);
        const ctx = merged.getContext('2d')!;
        const flat: Layer = { id: generateId(), name: 'Merged', canvas: merged, ctx, visible: true, opacity: 100, locked: false };
        layersRef.current = [flat];
        activeLayerIdRef.current = flat.id;
        setLayers([flat]);
        setActiveLayerId(flat.id);
        clearHistory();
        return;
      }
      // Ctrl+Shift+N = new layer (PS convention)
      if (ctrl && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        const newLayer = createEmptyLayer(`Layer ${layersRef.current.length + 1}`, canvasSize.width, canvasSize.height);
        layersRef.current = [...layersRef.current, newLayer];
        activeLayerIdRef.current = newLayer.id;
        setLayers(prev => [...prev, newLayer]);
        setActiveLayerId(newLayer.id);
        return;
      }
      if (ctrl && e.key === 'n') {
        e.preventDefault();
        if (confirm('Create new project? Unsaved changes will be lost.')) {
          handleNewProject();
        }
        return;
      }
      // Ctrl+= / Ctrl+- for zoom (= is unshifted + on most keyboards)
      if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); applyZoomRef.current(zoomRef.current + ZOOM_STEP); return; }
      if (ctrl && e.key === '-') { e.preventDefault(); applyZoomRef.current(zoomRef.current - ZOOM_STEP); return; }
      // Ctrl+0 = zoom to fit canvas in viewport, Ctrl+1 = actual pixels 100%
      if (ctrl && e.key === '0') {
        e.preventDefault();
        fitCanvasToViewportRef.current();
        return;
      }
      if (ctrl && e.key === '1') { e.preventDefault(); applyZoomRef.current(100); return; }
      if (ctrl && e.altKey && e.key.toLowerCase() === 't') {
        if (!inInput) {
          e.preventDefault();
          canvasEngineRef.current?.startFreeTransform();
        }
        return;
      }

      // Everything below is tool shortcuts — skip if in an input
      if (inInput) return;

      // PS tool shortcuts
      switch (e.key.toLowerCase()) {
        case 'b': setActiveToolRef.current('brush'); break;
        case 'e': setActiveToolRef.current('eraser'); break;
        case 'l': setActiveToolRef.current('line'); break;
        case 'u': setActiveToolRef.current('rectangle'); break;
        case 'c': if (!ctrl) setActiveToolRef.current('circle'); break;
        case 'g': setActiveToolRef.current('fill'); break;
        case 'i': setActiveToolRef.current('eyedropper'); break;
        case 'r': setActiveToolRef.current('smudge'); break;
        case 'v': setActiveToolRef.current('move'); break;
        case 'm': setActiveToolRef.current('select'); break;
        case 't': setActiveToolRef.current('text'); break;
        // [ ] to decrease/increase brush size (PS convention)
        case '[': {
          const ts = toolSettingsRefKb.current;
          setToolSettingsRef.current({ ...ts, size: Math.max(1, ts.size - (ts.size > 10 ? 5 : 1)) });
          break;
        }
        case ']': {
          const ts = toolSettingsRefKb.current;
          setToolSettingsRef.current({ ...ts, size: Math.min(1000, ts.size + (ts.size >= 10 ? 5 : 1)) });
          break;
        }
        // X = swap foreground/background colors (PS convention)
        case 'x': {
          const ts = toolSettingsRefKb.current;
          const prevFg = ts.color;
          const prevBg = bgColorRef.current;
          setToolSettingsRef.current({ ...ts, color: prevBg });
          setBgColor(prevFg);
          break;
        }
        // D = reset to default colors (black/white, PS convention)
        case 'd':
          setToolSettingsRef.current({ ...toolSettingsRefKb.current, color: '#000000' });
          setBgColor('#ffffff');
          break;
        // Delete/Backspace = clear selection or entire layer (PS convention)
        case 'delete':
        case 'backspace': {
          const alId = activeLayerIdRef.current;
          if (!alId) break;
          const layer = layersRef.current.find(l => l.id === alId);
          if (!layer || layer.locked) break;
          const imgData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
          saveState(alId, imgData);
          const sel = selection;
          if (sel) {
            layer.ctx.clearRect(sel.x, sel.y, sel.w, sel.h);
            setSelection(null);
          } else {
            layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
          }
          canvasEngineRef.current?.recomposite();
          setLayerRenderTick(t => t + 1);
          break;
        }
        // Spacebar = temporary hand tool (PS convention)
        case ' ':
          e.preventDefault();
          setIsSpaceDown(true);
          break;
        // Number keys for opacity (PS: 1=10%, ..., 9=90%, 0=100%)
        case '1': case '2': case '3': case '4': case '5':
        case '6': case '7': case '8': case '9': case '0': {
          const ts = toolSettingsRefKb.current;
          const opacity = e.key === '0' ? 100 : Number(e.key) * 10;
          setToolSettingsRef.current({ ...ts, opacity });
          break;
        }
        case '?':
          setShowShortcuts(s => !s);
          break;
        case 'tab':
          e.preventDefault();
          setShowPanels(s => !s);
          break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        setIsSpaceDown(false);
      }
    };
    window.addEventListener('keydown', handler);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handler);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleUndo, handleRedo, canvasSize, clearAnimationTimeline, clearHistory, selection, backgroundSettings, saveState, handleNewProject]);

  // Layer Management
  const addLayer = useCallback(() => {
    const newLayer = createEmptyLayer(`Layer ${layersRef.current.length + 1}`, canvasSize.width, canvasSize.height);
    layersRef.current = [...layersRef.current, newLayer];
    activeLayerIdRef.current = newLayer.id;
    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
  }, [canvasSize]);

  // Called when a tablet notebook button requests a new page,
  // or when downloading multiple offline pages (one onNewPage per page after the first).
  // Must synchronously update layersRef + activeLayerIdRef so the very-next
  // onImportStrokes call can draw on the new layer without waiting for React re-render.
  const handleNewPage = useCallback(() => {
    const newLayer = createEmptyLayer(`Page ${layersRef.current.length + 1}`, canvasSize.width, canvasSize.height);
    // Synchronous ref updates — critical for multi-page import
    layersRef.current = [...layersRef.current, newLayer];
    activeLayerIdRef.current = newLayer.id;
    // React state updates (for rendering)
    setLayers(prev => [...prev, newLayer]);
    setActiveLayerId(newLayer.id);
  }, [canvasSize]);

  const duplicateLayer = useCallback((layerId: string) => {
    const source = layersRef.current.find(l => l.id === layerId);
    if (!source) return;
    const canvas = document.createElement('canvas');
    canvas.width = source.canvas.width;
    canvas.height = source.canvas.height;
    const ctx = getFrequentReadContext(canvas);
    ctx.drawImage(source.canvas, 0, 0);
    const newLayer: Layer = {
      id: generateId(),
      name: `${source.name} copy`,
      canvas,
      ctx,
      visible: source.visible,
      opacity: source.opacity,
      locked: false,
      blendMode: source.blendMode,
    };
    setLayers(prev => {
      const idx = prev.findIndex(l => l.id === layerId);
      const next = [...prev];
      next.splice(idx + 1, 0, newLayer);
      layersRef.current = next;
      return next;
    });
    activeLayerIdRef.current = newLayer.id;
    setActiveLayerId(newLayer.id);
  }, []);
  duplicateLayerRef.current = duplicateLayer;

  const flipLayer = useCallback((layerId: string, direction: 'horizontal' | 'vertical') => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (!layer || layer.locked) return;
    const { canvas, ctx } = layer;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    saveState(layerId, imgData);
    // putImageData ignores transforms, so use a temp canvas + drawImage
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    getFrequentReadContext(tmp).putImageData(imgData, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    if (direction === 'horizontal') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
    canvasEngineRef.current?.recomposite();
    setLayerRenderTick(t => t + 1);
  }, [saveState]);

  const rotateLayer = useCallback((layerId: string, angleDeg: 90 | -90 | 180) => {
    const layer = layersRef.current.find(l => l.id === layerId);
    if (!layer || layer.locked) return;
    const { canvas, ctx } = layer;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    saveState(layerId, imgData);
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    getFrequentReadContext(tmp).putImageData(imgData, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((angleDeg * Math.PI) / 180);
    ctx.drawImage(tmp, -tmp.width / 2, -tmp.height / 2);
    ctx.restore();
    canvasEngineRef.current?.recomposite();
    setLayerRenderTick(t => t + 1);
  }, [saveState]);

  const deleteLayer = useCallback((layerId: string) => {
    if (layersRef.current.length <= 1) return;
    const remaining = layersRef.current.filter(l => l.id !== layerId);
    layersRef.current = remaining;
    setLayers(remaining);
    if (activeLayerIdRef.current === layerId) {
      const nextActiveId = remaining[remaining.length - 1]?.id || null;
      activeLayerIdRef.current = nextActiveId;
      setActiveLayerId(nextActiveId);
    }
    canvasEngineRef.current?.recomposite();
    setLayerRenderTick(t => t + 1);
  }, []);

  const updateLayer = useCallback((layerId: string, updates: Partial<Layer>) => {
    setLayers(prev => {
      const next = prev.map(l =>
        l.id === layerId ? { ...l, ...updates } : l
      );
      layersRef.current = next;
      return next;
    });
    if ('visible' in updates || 'opacity' in updates || 'blendMode' in updates) {
      canvasEngineRef.current?.recomposite();
      setLayerRenderTick(t => t + 1);
    }
  }, []);

  const moveLayer = useCallback((oldIndex: number, newIndex: number) => {
    setLayers(prev => {
      const next = arrayMove(prev, oldIndex, newIndex);
      layersRef.current = next;
      return next;
    });
    canvasEngineRef.current?.recomposite();
    setLayerRenderTick(t => t + 1);
  }, []);

  const selectLayer = useCallback((layerId: string | null) => {
    activeLayerIdRef.current = layerId;
    setActiveLayerId(layerId);
  }, []);

  const applyZoom = useCallback((nextZoom: number, anchor?: { clientX: number; clientY: number }, mode: 'stepped' | 'smooth' = 'stepped') => {
    const safeZoom = mode === 'smooth' ? clampZoomSmooth(nextZoom) : clampZoom(nextZoom);
    if (safeZoom === zoom) return;

    const viewport = canvasViewportRef.current;
    if (viewport) {
      const rect = viewport.getBoundingClientRect();
      const effectiveAnchor = anchor ?? {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      };
      pendingZoomAnchorRef.current = {
        contentX: viewport.scrollLeft + (effectiveAnchor.clientX - rect.left),
        contentY: viewport.scrollTop + (effectiveAnchor.clientY - rect.top),
        viewportX: effectiveAnchor.clientX - rect.left,
        viewportY: effectiveAnchor.clientY - rect.top,
        previousZoom: zoom,
      };
    } else {
      pendingZoomAnchorRef.current = null;
    }

    setZoom(safeZoom);
  }, [zoom]);
  applyZoomRef.current = applyZoom;

  const handleCanvasViewportWheel = useCallback((event: WheelEvent) => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    event.preventDefault();

    const trackpadLike =
      event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
      && (event.ctrlKey || Math.abs(event.deltaX) > 0 || (Math.abs(event.deltaY) > 0 && Math.abs(event.deltaY) < 40));

    if (trackpadLike) {
      if (event.ctrlKey) {
        const pinchScale = Math.exp(-event.deltaY * 0.0035);
        applyZoom(
          zoomRef.current * pinchScale,
          { clientX: event.clientX, clientY: event.clientY },
          'smooth',
        );
        return;
      }

      scrollViewportTo(
        viewport.scrollLeft + event.deltaX,
        viewport.scrollTop + event.deltaY,
        { immediate: true },
      );
      return;
    }

    const direction = event.deltaY < 0 ? 1 : -1;
    applyZoom(zoomRef.current + direction * ZOOM_STEP, {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }, [applyZoom, scrollViewportTo]);

  // Attach wheel listener natively with { passive: false } so preventDefault actually works.
  // React's onWheel is passive by default in modern browsers.
  // Also prevent default middle-click auto-scroll (browser's scroll circle).
  useEffect(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    viewport.addEventListener('wheel', handleCanvasViewportWheel, { passive: false });
    const preventMiddleScroll = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
    viewport.addEventListener('mousedown', preventMiddleScroll);
    return () => {
      viewport.removeEventListener('wheel', handleCanvasViewportWheel);
      viewport.removeEventListener('mousedown', preventMiddleScroll);
    };
  }, [handleCanvasViewportWheel]);

  useEffect(() => {
    const viewport = canvasViewportRef.current;
    const anchor = pendingZoomAnchorRef.current;
    if (!viewport || !anchor || anchor.previousZoom === 0) return;

    const zoomRatio = zoom / anchor.previousZoom;
    const zoomDelta = Math.abs(zoom - anchor.previousZoom);
    scrollViewportTo(
      anchor.contentX * zoomRatio - anchor.viewportX,
      anchor.contentY * zoomRatio - anchor.viewportY,
      { immediate: zoomDelta > 40, durationMs: zoomDelta > 20 ? 110 : 150 },
    );
    pendingZoomAnchorRef.current = null;
  }, [zoom, scrollViewportTo]);

  const centerCanvasViewport = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;
    scrollViewportTo(
      Math.max(0, (viewport.scrollWidth - viewport.clientWidth) / 2),
      Math.max(0, (viewport.scrollHeight - viewport.clientHeight) / 2),
      { durationMs: 180 },
    );
  }, [scrollViewportTo]);

  const fitCanvasToViewport = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return;

    const fitSize = getCanvasViewportFootprint(canvasSize.width, canvasSize.height, 1, canvasRotation);
    const fitPaddingPx = FIT_CANVAS_PADDING_PX * 2 + FIT_CANVAS_BUFFER_PX;
    const availableWidth = Math.max(1, viewport.clientWidth - fitPaddingPx);
    const availableHeight = Math.max(1, viewport.clientHeight - fitPaddingPx);
    const nextZoom = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        Math.floor(Math.min(
          (availableWidth / fitSize.width) * 100,
          (availableHeight / fitSize.height) * 100,
        )),
      ),
    );

    applyZoom(nextZoom, undefined, 'smooth');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        centerCanvasViewport();
      });
    });
  }, [applyZoom, canvasRotation, canvasSize.height, canvasSize.width, centerCanvasViewport]);
  fitCanvasToViewportRef.current = fitCanvasToViewport;

  const getViewportCenterAnchor = useCallback(() => {
    const viewport = canvasViewportRef.current;
    if (!viewport) return undefined;
    const rect = viewport.getBoundingClientRect();
    return {
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
  }, []);

  const getTouchDistance = useCallback((first: { clientX: number; clientY: number }, second: { clientX: number; clientY: number }) => {
    const dx = second.clientX - first.clientX;
    const dy = second.clientY - first.clientY;
    return Math.hypot(dx, dy);
  }, []);

  const getTouchMidpoint = useCallback((first: { clientX: number; clientY: number }, second: { clientX: number; clientY: number }) => ({
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2,
  }), []);

  const rotateCanvasBy = useCallback((delta: 90 | -90) => {
    setCanvasRotation((current) => normalizeCanvasRotation(current + delta));
  }, []);

  const resetCanvasRotation = useCallback(() => {
    setCanvasRotation(0);
  }, []);

  const resizeCanvas = useCallback((width: number, height: number) => {
    const safeWidth = Math.max(64, Math.round(width));
    const safeHeight = Math.max(64, Math.round(height));

    if (safeWidth === canvasSize.width && safeHeight === canvasSize.height) return;

    const scaleX = safeWidth / Math.max(1, canvasSize.width);
    const scaleY = safeHeight / Math.max(1, canvasSize.height);

    clearHistory();
    setSelection(null);
    setCanvasSize({ width: safeWidth, height: safeHeight });
    setBackgroundSettings((prev) => ({ ...prev, width: safeWidth, height: safeHeight }));
    setAnimationStrokes((prev) => prev.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({
        ...point,
        x: point.x * scaleX,
        y: point.y * scaleY,
      })),
    })));
    setLayers(prev => prev.map(layer => {
      const resized = document.createElement('canvas');
      resized.width = safeWidth;
      resized.height = safeHeight;
      const ctx = getFrequentReadContext(resized);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, 0, 0, safeWidth, safeHeight);
      return { ...layer, canvas: resized, ctx };
    }));
    setLayerRenderTick(t => t + 1);
  }, [canvasSize.height, canvasSize.width, clearHistory]);

  // Device connected — prompt user to match canvas to notebook page size
  const handleDeviceConnected = useCallback((
    _deviceType: 'huion' | 'wacom',
    deviceWidth: number,
    deviceHeight: number,
    deviceName: string,
    mode: 'paper' | 'tablet' | null = null,
    preferredOrientation: 'portrait' | 'landscape' | null = null,
  ) => {
    const pw = Math.round(deviceWidth);
    const ph = Math.round(deviceHeight);
    if (canvasSize.width === pw && canvasSize.height === ph) return;
    if (canvasSize.width === ph && canvasSize.height === pw) return;
    
    setResolutionPrompt({
      deviceName,
      portrait: { width: Math.min(pw, ph), height: Math.max(pw, ph) },
      landscape: { width: Math.max(pw, ph), height: Math.min(pw, ph) },
      preferredOrientation: preferredOrientation ?? (mode === 'tablet' ? 'landscape' : 'portrait'),
      modeLabel: mode === 'tablet' ? 'tablet' : 'paper',
    });
  }, [canvasSize]);

  const applyDeviceResolution = useCallback((width: number, height: number) => {
    resizeCanvas(width, height);
    setResolutionPrompt(null);
  }, [resizeCanvas]);

  const openCanvasResizePrompt = useCallback(() => {
    setCanvasResizePrompt({
      width: String(canvasSize.width),
      height: String(canvasSize.height),
    });
  }, [canvasSize.height, canvasSize.width]);

  const applyCanvasResizePrompt = useCallback(() => {
    if (!canvasResizePrompt) return;
    const width = Math.max(64, Math.min(8192, Math.round(Number(canvasResizePrompt.width) || canvasSize.width)));
    const height = Math.max(64, Math.min(8192, Math.round(Number(canvasResizePrompt.height) || canvasSize.height)));
    resizeCanvas(width, height);
    setCanvasResizePrompt(null);
  }, [canvasResizePrompt, canvasSize.height, canvasSize.width, resizeCanvas]);

  const applyProjectData = useCallback(async (data: SerializedProjectData) => {
    if (typeof data.app !== 'string' || !LEGACY_APP_IDS.has(data.app) || !Array.isArray(data.layers)) {
      throw new Error('Invalid project file.');
    }

    const loadedLayers: Layer[] = [];
    for (const saved of data.layers) {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load layer image'));
        img.src = saved.imageData;
      });
      const canvas = document.createElement('canvas');
      canvas.width = data.canvasSize?.width ?? canvasSize.width;
      canvas.height = data.canvasSize?.height ?? canvasSize.height;
      const ctx = getFrequentReadContext(canvas);
      ctx.drawImage(img, 0, 0);
      loadedLayers.push({
        id: saved.id,
        name: saved.name,
        canvas,
        ctx,
        visible: saved.visible,
        opacity: saved.opacity,
        locked: saved.locked,
        blendMode: saved.blendMode,
      });
    }

    const nextCanvasSize = {
      width: data.canvasSize?.width ?? canvasSize.width,
      height: data.canvasSize?.height ?? canvasSize.height,
    };

    setCanvasSize(nextCanvasSize);
    setBackgroundSettings(prev => ({
      ...prev,
      width: nextCanvasSize.width,
      height: nextCanvasSize.height,
      ...(data.backgroundSettings ?? {}),
    }));
    const nextActiveLayerId = data.activeLayerId ?? loadedLayers[0]?.id ?? null;
    layersRef.current = loadedLayers;
    activeLayerIdRef.current = nextActiveLayerId;
    setLayers(loadedLayers);
    setActiveLayerId(nextActiveLayerId);
    const importedAnimationStrokes = compactAnimationStrokeTimings(
      Array.isArray(data.animationStrokes) ? data.animationStrokes : [],
    );
    setStoredFrames(importedAnimationStrokes.length > 0
      ? []
      : (Array.isArray(data.frames) ? data.frames : []));
    setAnimationStrokes(importedAnimationStrokes);
    animationTimelineCursorRef.current = getAnimationTimelineCursorMs(importedAnimationStrokes);
    setFps(typeof data.fps === 'number' ? data.fps : 60);
    if (typeof data.playbackSpeed === 'number') setPlaybackSpeed(data.playbackSpeed);
    setToolSettings(prev => ({
      ...prev,
      ...(data.toolSettings ?? {}),
      fillTolerance: data.toolSettings?.fillTolerance ?? prev.fillTolerance,
      fillContiguous: data.toolSettings?.fillContiguous ?? prev.fillContiguous,
    }));
    if (typeof data.bgColor === 'string') setBgColor(data.bgColor);
    if (Array.isArray(data.recentColors)) setRecentColors(data.recentColors);
    if (typeof data.symmetryX === 'boolean') setSymmetryX(data.symmetryX);
    setSelection(null);
    clearHistory();

    setTimeout(() => {
      canvasEngineRef.current?.recomposite();
      setLayerRenderTick(t => t + 1);
    }, 50);
  }, [canvasSize.width, canvasSize.height, clearHistory]);

  const importProjectFile = useCallback(async (file: File) => {
    const text = await file.text();
    const data = JSON.parse(text);
    await applyProjectData(data);
  }, [applyProjectData]);

  // Project Save/Load
  const saveProject = useCallback(() => {
    const projectData = {
      version: 1,
      app: APP_ID,
      canvasSize,
      fps,
      playbackSpeed,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      frames: storedFrames.map(({ snapshot, contentHash, ...rest }) => rest),
      animationStrokes,
      layers: layers.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        locked: l.locked,
        blendMode: l.blendMode,
        imageData: l.canvas.toDataURL('image/png'),
      })),
      activeLayerId,
      toolSettings,
      backgroundSettings,
      bgColor,
      recentColors,
      symmetryX,
    };
    const json = JSON.stringify(projectData);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.download = `takingnotes-${Date.now()}${PROJECT_EXTENSION}`;
    link.href = URL.createObjectURL(blob);
    link.click();
    // Defer revocation so the browser can finish the download
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, [layers, storedFrames, animationStrokes, fps, playbackSpeed, canvasSize, activeLayerId, toolSettings, backgroundSettings, bgColor, recentColors, symmetryX]);
  saveProjectRef.current = saveProject;

  const openFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `image/*,${PROJECT_EXTENSION},.nws`;
    input.onchange = (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.name.endsWith(PROJECT_EXTENSION) || file.name.endsWith('.nws')) {
        (async () => {
          try {
            await importProjectFile(file);
          } catch (err) {
            alert('Failed to load project: ' + (err as Error).message);
          }
        })();
      } else {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);
        img.onload = () => {
          const layer = createEmptyLayer(file.name, canvasSize.width, canvasSize.height);
          layer.ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
          layersRef.current = [...layersRef.current, layer];
          activeLayerIdRef.current = layer.id;
          setLayers(prev => [...prev, layer]);
          setActiveLayerId(layer.id);
          URL.revokeObjectURL(objectUrl);
        };
        img.onerror = () => URL.revokeObjectURL(objectUrl);
        img.src = objectUrl;
      }
    };
    input.click();
  }, [canvasSize, importProjectFile]);
  openFileRef.current = openFile;

  // Tool Handlers
  const handleToolChange = (tool: ToolType) => {
    setActiveTool(tool);
  };

  const addRecentColor = useCallback((color: string) => {
    if (!color || color.length < 4) return;
    setRecentColors(prev => {
      const without = prev.filter(c => c !== color);
      return [color, ...without].slice(0, 16);
    });
  }, []);

  const handleStrokeComplete = useCallback((stroke: Stroke) => {
    const animationStroke: Stroke =
      symmetryX && (stroke.tool === 'brush' || stroke.tool === 'eraser')
        ? { ...stroke, mirrorAxisX: canvasSize.width / 2 }
        : stroke;
    appendAnimationStroke(animationStroke);
    pendingFrameRenderRef.current = animationStrokes.length;
    setCurrentFrame(animationStrokes.length);
    undoneStrokesRef.current = [];
    if (userScrubRef.current) {
      userScrubRef.current = false;
      canvasEngineRef.current?.recomposite(); // restore live layer view
    }
    addRecentColor(stroke.color);
    if (isRecording) {
      addStroke(animationStroke);
    }
  }, [appendAnimationStroke, addRecentColor, isRecording, addStroke, animationStrokes.length, canvasSize.width, symmetryX]);

  const decodeFrameSnapshot = useCallback(async (thumbnail: string): Promise<HTMLCanvasElement> => {
    const img = new Image();
    img.src = thumbnail;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = canvasSize.width;
    c.height = canvasSize.height;
    c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }, [canvasSize.height, canvasSize.width]);

  const selectFrameForCanvas = useCallback((index: number, options?: { scrub?: boolean }) => {
    const next = Math.max(0, Math.min(frames.length - 1, index));
    if (options?.scrub ?? true) {
      userScrubRef.current = true;
    }
    setCurrentFrame(next);

    const frame = frames[next];
    if (!canvasEngineRef.current || !frame) {
      canvasEngineRef.current?.recomposite();
      return;
    }

    playbackTimeRef.current = frame.timeMs ?? 0;

    if (isEventPlayback) {
      renderAnimationAtTime(frame.timeMs ?? 0);
      return;
    }

    if (frame.snapshot) {
      canvasEngineRef.current.renderFrame(frame);
      return;
    }

    if (frame.thumbnail) {
      void decodeFrameSnapshot(frame.thumbnail).then((snapshot) => {
        setStoredFrames((prev) => prev.map((candidate, candidateIndex) => (
          candidateIndex === next && !candidate.snapshot ? { ...candidate, snapshot } : candidate
        )));
        canvasEngineRef.current?.renderFrame({ ...frame, snapshot });
      }).catch(() => {});
      return;
    }

    canvasEngineRef.current.renderFrame(frame);
  }, [decodeFrameSnapshot, frames, isEventPlayback, renderAnimationAtTime]);

  const handleCanvasDrawingStateChange = useCallback((isDrawing: boolean) => {
    isCanvasDrawingRef.current = isDrawing;
    if (isDrawing) {
      userScrubRef.current = false;
      canvasEngineRef.current?.recomposite();
    }
  }, []);

  const handlePlayAnimation = () => {
    if (frames.length === 0) return;
    if (animationRef.current) {
      clearTimeout(animationRef.current);
      animationRef.current = null;
    }

    userScrubRef.current = false;
    pendingFrameRenderRef.current = null;
    isPlayingRef.current = true;
    setIsPlaying(true);

    const renderIntervalMs = getAnimationSampleStepMs(fps, 1);

    if (isEventPlayback) {
      let elapsedTimeMs = Math.max(0, playbackTimeRef.current);

      const playLoop = () => {
        if (!isPlayingRef.current) return;

        const liveFrames = framesRef.current;
        if (liveFrames.length === 0) {
          isPlayingRef.current = false;
          setIsPlaying(false);
          return;
        }

        const totalDurationMs = getAnimationPlaybackDuration(liveFrames, fps);
        if (elapsedTimeMs >= totalDurationMs) {
          elapsedTimeMs = 0;
        }

        const liveFrameIndex = findAnimationKeyframeIndexAtTime(liveFrames, elapsedTimeMs);
        setCurrentFrame(liveFrameIndex);
        playbackTimeRef.current = elapsedTimeMs;
        renderAnimationAtTime(elapsedTimeMs);

        elapsedTimeMs += getAnimationSampleStepMs(fps, playbackSpeedRef.current);
        animationRef.current = window.setTimeout(playLoop, renderIntervalMs);
      };

      playLoop();
      return;
    }

    let frameIndex = Math.max(0, Math.min(framesRef.current.length - 1, currentFrameRef.current));
    const playLoop = () => {
      if (!isPlayingRef.current) return;

      const liveFrames = framesRef.current;
      if (liveFrames.length === 0) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        return;
      }

      if (frameIndex >= liveFrames.length) {
        frameIndex = 0;
      }

      const frame = liveFrames[frameIndex];
      selectFrameForCanvas(frameIndex, { scrub: false });

      frameIndex = (frameIndex + 1) % liveFrames.length;
      const delayMs = Math.max(1, (frame?.duration || renderIntervalMs) / Math.max(0.01, playbackSpeedRef.current));
      animationRef.current = window.setTimeout(playLoop, delayMs);
    };

    playLoop();
  };

  const handlePauseAnimation = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (animationRef.current) {
      clearTimeout(animationRef.current);
      animationRef.current = null;
    }
    if (isEventPlayback) {
      renderAnimationAtTime(playbackTimeRef.current);
      return;
    }
    const pausedFrame = currentFrameRef.current;
    if (framesRef.current.length > 0 && pausedFrame >= 0 && pausedFrame < framesRef.current.length) {
      selectFrameForCanvas(pausedFrame, { scrub: false });
      return;
    }
    canvasEngineRef.current?.recomposite();
  };

  const handleStopAnimation = () => {
    handlePauseAnimation();
    playbackTimeRef.current = 0;
    if (isEventPlayback) {
      setCurrentFrame(0);
      renderAnimationAtTime(0);
      return;
    }
    selectFrameForCanvas(0, { scrub: false });
  };

  const handleStepFrame = (delta: number) => {
    if (frames.length === 0) return;
    if (isPlaying) handlePauseAnimation();
    const next = Math.max(0, Math.min(frames.length - 1, currentFrame + delta));
    selectFrameForCanvas(next);
  };

  const handleRecordToggle = () => {
    if (isRecording) {
      setIsRecording(false);
      stopRecording();
    } else {
      clearAnimationTimeline();
      setIsRecording(true);
      startRecording();
    }
  };

  useEffect(() => {
    return () => {
      if (animationRef.current) {
        clearTimeout(animationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (frames.length === 0) {
      if (currentFrame !== 0) {
        setCurrentFrame(0);
      }
      playbackTimeRef.current = 0;
      return;
    }
    if (currentFrame >= frames.length) {
      setCurrentFrame(frames.length - 1);
    }
  }, [currentFrame, frames.length]);

  useEffect(() => {
    if (!canvasEngineRef.current) return;
    if (isCanvasDrawingRef.current) return;
    if (frames.length === 0 || currentFrame < 0 || currentFrame >= frames.length) {
      if (pendingFrameRenderRef.current === currentFrame) {
        return;
      }
      canvasEngineRef.current.recomposite();
      return;
    }
    if (pendingFrameRenderRef.current === currentFrame) {
      pendingFrameRenderRef.current = null;
      selectFrameForCanvas(currentFrame, { scrub: false });
      return;
    }
    if (isEventPlayback && isPlayingRef.current) {
      return;
    }
    if (!isPlayingRef.current && !userScrubRef.current) {
      return;
    }
    selectFrameForCanvas(currentFrame, { scrub: false });
  }, [currentFrame, frames.length, isEventPlayback, selectFrameForCanvas]);

  // Sensors for drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // BLE tablet input shared by Huion and Bamboo/Wacom devices
  const blePenState = useRef<{ lastDown: boolean; lastX: number; lastY: number }>({ lastDown: false, lastX: 0, lastY: 0 });
  const toolSettingsRef = useRef(toolSettings);
  toolSettingsRef.current = toolSettings;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const lastBleSampleRef = useRef<{ x: number; y: number; pressure: number; isDown: boolean; at: number } | null>(null);

  // rAF-batched recomposite: BLE points arrive at 100+ Hz but the display
  // only needs one composite per animation frame.  Drawing to the layer
  // canvas is immediate; only the display re-composite is deferred.
  const bleRafRef = useRef(0);
  const bleRafDirtyRef = useRef(false);
  const scheduleBLERecomposite = useCallback(() => {
    bleRafDirtyRef.current = true;
    if (bleRafRef.current) return; // already scheduled
    bleRafRef.current = requestAnimationFrame(() => {
      bleRafRef.current = 0;
      if (bleRafDirtyRef.current) {
        bleRafDirtyRef.current = false;
        canvasEngineRef.current?.recomposite('active');
      }
    });
  }, []);
  // Cancel pending rAF on unmount
  useEffect(() => () => { if (bleRafRef.current) cancelAnimationFrame(bleRafRef.current); }, []);

  const handleBLEPenPoint = useCallback((x: number, y: number, pressure: number, isDown: boolean) => {
    if (isDown) console.log(`[BLE PEN] x=${x.toFixed(1)} y=${y.toFixed(1)} p=${pressure.toFixed(3)}`);
    const now = performance.now();
    const lastSample = lastBleSampleRef.current;
    if (
      lastSample &&
      lastSample.isDown === isDown &&
      Math.abs(lastSample.x - x) < 0.01 &&
      Math.abs(lastSample.y - y) < 0.01 &&
      Math.abs(lastSample.pressure - pressure) < 0.0025 &&
      now - lastSample.at < 20
    ) {
      return;
    }
    lastBleSampleRef.current = { x, y, pressure, isDown, at: now };

    // Always update cursor for drawing-tablet overlay (including hover)
    setBlePenCursor({ x, y, pressure, active: isDown && pressure > 0.01 });

    const alId = activeLayerIdRef.current;
    if (!alId) return;
    const activeLayer = layersRef.current.find(l => l.id === alId);
    if (!activeLayer || activeLayer.locked) return;
    const ctx = activeLayer.ctx;
    const prev = blePenState.current;
    const ts = toolSettingsRef.current;
    const tool = activeToolRef.current;
    const pointTimestamp = Date.now();

    if (isDown && pressure > 0.01) {
      if (!prev.lastDown) {
        // Pen just touched down — save state for undo
        const imageData = ctx.getImageData(0, 0, canvasSize.width, canvasSize.height);
        saveState(alId, imageData);
        bleCurrentStrokeRef.current = {
          id: generateId(),
          points: [{ x, y, pressure, timestamp: pointTimestamp }],
          tool,
          color: ts.color,
          size: ts.size,
          opacity: ts.opacity,
          layerId: alId,
        };
      } else {
        bleCurrentStrokeRef.current?.points.push({ x, y, pressure, timestamp: pointTimestamp });
      }

      const brushSize = ts.size * pressure;
      const strokeWindow = bleCurrentStrokeRef.current?.points.slice(-3) ?? [];

      if (tool === 'eraser') {
        // Eraser mode — destination-out compositing
        if (prev.lastDown) {
          drawEraserStroke(ctx, strokeWindow, brushSize);
        } else {
          ctx.save();
          ctx.globalCompositeOperation = 'destination-out';
          ctx.beginPath();
          ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      } else {
        // Brush / default mode
        if (prev.lastDown) {
          drawBrushStroke(ctx, strokeWindow, ts.color, brushSize, ts.opacity, ts.hardness);
        } else {
          ctx.save();
          ctx.globalAlpha = ts.opacity / 100;
          ctx.fillStyle = ts.color;
          ctx.beginPath();
          ctx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Schedule display re-composite (rAF-batched — one per frame)
      scheduleBLERecomposite();
    }

    const wasDown = prev.lastDown;
    prev.lastDown = isDown && pressure > 0.01;
    prev.lastX = x;
    prev.lastY = y;

    // Pen-up: trigger layer thumbnail refresh + autosave (once per stroke)
    if (wasDown && !prev.lastDown) {
      const finishedStroke = bleCurrentStrokeRef.current;
      if (finishedStroke && finishedStroke.points.length > 0) {
        appendAnimationStroke(finishedStroke);
        if (isRecording) {
          addStroke(finishedStroke);
        }
      }
      bleCurrentStrokeRef.current = null;
      setLayerRenderTick(t => t + 1);
    }
  }, [addStroke, appendAnimationStroke, canvasSize, isRecording, saveState, scheduleBLERecomposite]);

  // BLE Tablet - import offline pages as strokes
  const handleImportStrokes = useCallback((strokes: { points: { x: number; y: number; pressure: number }[] }[]) => {
    const alId = activeLayerIdRef.current;
    if (!alId) return;
    const activeLayer = layersRef.current.find(l => l.id === alId);
    if (!activeLayer) return;
    const ctx = activeLayer.ctx;
    const ts = toolSettingsRef.current;

    // Save state for undo
    const imageData = ctx.getImageData(0, 0, canvasSize.width, canvasSize.height);
    saveState(alId, imageData);

    let importedTimestamp = Date.now();
    const importedAnimationStrokes: Stroke[] = [];

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      ctx.save();
      ctx.globalAlpha = ts.opacity / 100;
      ctx.fillStyle = ts.color;
      ctx.strokeStyle = ts.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.points.length === 1) {
        const point = stroke.points[0];
        const dotSize = Math.max(1, ts.size * (point.pressure || 0.5));
        ctx.beginPath();
        ctx.arc(point.x, point.y, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (let i = 1; i < stroke.points.length; i++) {
          const segment = stroke.points
            .slice(Math.max(0, i - 2), i + 1)
            .map((point, index) => ({
              x: point.x,
              y: point.y,
              pressure: point.pressure,
              timestamp: importedTimestamp + (i - 2 + index) * 8,
            }));
          const averagePressure = segment.reduce((sum, point) => sum + (point.pressure || 0.5), 0) / segment.length;
          drawBrushStroke(ctx, segment, ts.color, ts.size * averagePressure, ts.opacity, ts.hardness);
        }
      }
      ctx.restore();

      importedAnimationStrokes.push({
        id: generateId(),
        tool: 'brush',
        color: ts.color,
        size: ts.size,
        opacity: ts.opacity,
        layerId: alId,
        points: stroke.points.map((point, index) => ({
          x: point.x,
          y: point.y,
          pressure: point.pressure,
          timestamp: importedTimestamp + index * 8,
        })),
      });
      importedTimestamp += stroke.points.length * 8 + 24;
    }
    appendAnimationStrokeBatch(importedAnimationStrokes);
    // Trigger canvas re-composite
    canvasEngineRef.current?.recomposite();
    setLayerRenderTick(t => t + 1);
  }, [appendAnimationStrokeBatch, canvasSize, saveState]);

  const handlePagesDownloaded = useCallback((notebook: DownloadedMemoryNotebook) => {
    setDownloadedNotebooks((prev) => {
      const normalizedNotebook = normalizeDownloadedNotebook(notebook, notebookNameRegistry);
      if (!normalizedNotebook) {
        return prev;
      }

      const rememberedName = notebookNameRegistry[normalizedNotebook.notebookUuid]
        || prev.find((candidate) => candidate.notebookUuid === normalizedNotebook.notebookUuid)?.notebookName
        || normalizedNotebook.notebookName;

      return [
        {
          ...normalizedNotebook,
          deviceId: normalizedNotebook.notebookUuid,
          notebookName: rememberedName,
        },
        ...prev,
      ];
    });
    setActivePage('memory');
  }, [notebookNameRegistry]);

  const importDownloadedPage = useCallback((notebookId: string, pageId: string) => {
    const notebook = downloadedNotebooks.find((candidate) => candidate.id === notebookId);
    const page = notebook?.pages.find((candidate) => candidate.id === pageId);
    if (!notebook || !page) return;

    const canvasStrokes = page.strokes.map((stroke) => ({
      points: stroke.points.map((point) => ({
        x: point.x * canvasSize.width,
        y: point.y * canvasSize.height,
        pressure: point.pressure,
      })),
    }));

    handleImportStrokes(canvasStrokes);
    setActivePage('studio');
    setRightTab('layers');
  }, [canvasSize.height, canvasSize.width, downloadedNotebooks, handleImportStrokes]);

  const importDownloadedNotebook = useCallback((notebookId: string) => {
    const notebook = downloadedNotebooks.find((candidate) => candidate.id === notebookId);
    if (!notebook) return;

    notebook.pages.forEach((page, index) => {
      const canvasStrokes = page.strokes.map((stroke) => ({
        points: stroke.points.map((point) => ({
          x: point.x * canvasSize.width,
          y: point.y * canvasSize.height,
          pressure: point.pressure,
        })),
      }));

      if (index > 0) {
        handleNewPage();
      }
      handleImportStrokes(canvasStrokes);
    });

    setActivePage('studio');
    setRightTab('layers');
  }, [canvasSize.height, canvasSize.width, downloadedNotebooks, handleImportStrokes, handleNewPage]);

  const deleteDownloadedNotebook = useCallback((notebookId: string) => {
    setDownloadedNotebooks((prev) => prev.filter((notebook) => notebook.id !== notebookId));
  }, []);

  const renameDownloadedNotebook = useCallback((notebookId: string, nextNotebookName: string) => {
    const trimmedName = nextNotebookName.trim();
    if (!trimmedName) {
      return;
    }

    const targetNotebook = downloadedNotebooks.find((candidate) => candidate.id === notebookId);
    if (!targetNotebook) {
      return;
    }

    setDownloadedNotebooks((prev) => prev.map((notebook) => (
      notebook.notebookUuid === targetNotebook.notebookUuid
        ? { ...notebook, notebookName: trimmedName }
        : notebook
    )));
    setNotebookNameRegistry((prev) => (
      prev[targetNotebook.notebookUuid] === trimmedName
        ? prev
        : { ...prev, [targetNotebook.notebookUuid]: trimmedName }
    ));
  }, [downloadedNotebooks]);

  const tools = [
    { id: 'brush', icon: Pencil, label: 'Brush', shortcut: 'B' },
    { id: 'eraser', icon: Eraser, label: 'Eraser', shortcut: 'E' },
    { id: 'line', icon: Minus, label: 'Line', shortcut: 'L' },
    { id: 'rectangle', icon: Square, label: 'Rectangle', shortcut: 'U' },
    { id: 'circle', icon: Circle, label: 'Circle', shortcut: 'C' },
    { id: 'fill', icon: PaintBucket, label: 'Fill', shortcut: 'G' },
    { id: 'eyedropper', icon: Pipette, label: 'Eyedropper', shortcut: 'I' },
    { id: 'gradient', icon: Blend, label: 'Gradient', shortcut: 'G' },
    { id: 'smudge', icon: Droplets, label: 'Smudge', shortcut: 'R' },
    { id: 'move', icon: Move, label: 'Move', shortcut: 'V' },
    { id: 'select', icon: MousePointer2, label: 'Marquee', shortcut: 'M' },
    { id: 'text', icon: Type, label: 'Text', shortcut: 'T' },
  ];

  const canvasFootprint = getCanvasViewportFootprint(
    canvasSize.width,
    canvasSize.height,
    zoom / 100,
    canvasRotation,
  );

  if (activePage === 'memory') {
    return (
      <DownloadedMemoryPage
        notebooks={downloadedNotebooks}
        onBackToStudio={() => setActivePage('studio')}
        onImportNotebook={importDownloadedNotebook}
        onImportPage={importDownloadedPage}
        onDeleteNotebook={deleteDownloadedNotebook}
        onRenameNotebook={renameDownloadedNotebook}
      />
    );
  }

  return (
    <TooltipProvider>
      <div className={`${theme === 'light' ? 'light' : ''} flex h-screen flex-col overflow-hidden bg-neutral-900 text-neutral-100`}>
        {/* Top Menu Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-neutral-800 border-b border-neutral-700">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
              {APP_NAME}
            </h1>
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => {
                      if (confirm('Create new project? Unsaved changes will be lost.')) {
                        handleNewProject();
                      }
                    }}
                  >
                    <FilePlus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>New Project (Ctrl+N)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openFile}>
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open (Ctrl+O)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={saveProject}>
                    <Save className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Save Project (Ctrl+S)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8"
                    onClick={() => {
                      const merged = mergeVisibleLayersToCanvas(canvasSize.width, canvasSize.height, layers, backgroundSettings);
                      const link = document.createElement('a');
                      link.download = 'takingnotes-export.png';
                      link.href = merged.toDataURL('image/png');
                      link.click();
                    }}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export as PNG</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-6 mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={handleUndo}
                    disabled={!canUndo}
                  >
                    <Undo className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8"
                    onClick={handleRedo}
                    disabled={!canRedo}
                  >
                    <Redo className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
              </Tooltip>
              <Separator orientation="vertical" className="h-6 mx-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                  >
                    <a
                      href="https://github.com/f4mi/takingnotes"
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open GitHub repository"
                    >
                      <Github className="h-4 w-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>GitHub Repository</TooltipContent>
              </Tooltip>
              {/* Image menu */}
              <ImageMenu
                onAction={(action) => {
                  const alId = activeLayerId;
                  if (!alId) return;
                  const layer = layers.find(l => l.id === alId);
                  if (!layer || layer.locked) return;
                  const { ctx, canvas } = layer;
                  const targetRect = (() => {
                    if (!selection) return { x: 0, y: 0, w: canvas.width, h: canvas.height };
                    const left = Math.max(0, Math.min(canvas.width, selection.x));
                    const top = Math.max(0, Math.min(canvas.height, selection.y));
                    const right = Math.max(left, Math.min(canvas.width, selection.x + selection.w));
                    const bottom = Math.max(top, Math.min(canvas.height, selection.y + selection.h));
                    return { x: left, y: top, w: right - left, h: bottom - top };
                  })();
                  if (targetRect.w < 1 || targetRect.h < 1) return;
                  // Actions that manage their own undo or don't need it
                  const selfUndoActions = new Set(['flip-h', 'flip-v', 'crop-to-selection', 'rotate-cw', 'rotate-ccw']);
                  const imgData = ctx.getImageData(targetRect.x, targetRect.y, targetRect.w, targetRect.h);
                  if (!selfUndoActions.has(action)) {
                    saveState(alId, ctx.getImageData(0, 0, canvas.width, canvas.height));
                  }
                  const d = imgData.data;
                  switch (action) {
                    case 'invert':
                      invertColors(d);
                      break;
                    case 'desaturate':
                      desaturate(d);
                      break;
                    case 'blur':
                      boxBlur(d, targetRect.w, targetRect.h, 3);
                      break;
                    case 'sharpen':
                      applySharpen(d, targetRect.w, targetRect.h);
                      break;
                    case 'flip-h': {
                      ctx.putImageData(imgData, targetRect.x, targetRect.y); // restore pixels (saveState already captured them above, flipLayer will save its own)
                      // Remove the duplicate undo entry we just pushed — flipLayer will push the correct one
                      flipLayer(alId, 'horizontal');
                      return;
                    }
                    case 'flip-v': {
                      ctx.putImageData(imgData, targetRect.x, targetRect.y);
                      flipLayer(alId, 'vertical');
                      return;
                    }
                    case 'brightness-up':
                      adjustBrightness(d, 15);
                      break;
                    case 'brightness-down':
                      adjustBrightness(d, -15);
                      break;
                    case 'contrast-up':
                      adjustContrast(d, 1.2);
                      break;
                    case 'contrast-down':
                      adjustContrast(d, 0.8);
                      break;
                    case 'crop-to-selection': {
                      const sel = selection;
                      if (!sel) return;
                      // Extract subregion from each layer (no scaling)
                      const croppedLayers = layersRef.current.map(l => {
                        const nc = document.createElement('canvas');
                        nc.width = sel.w; nc.height = sel.h;
                        const nctx = nc.getContext('2d')!;
                        nctx.drawImage(l.canvas, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
                        return { ...l, canvas: nc, ctx: nctx };
                      });
                      const nextActiveLayerId = activeLayerIdRef.current && croppedLayers.some((layer) => layer.id === activeLayerIdRef.current)
                        ? activeLayerIdRef.current
                        : croppedLayers[0]?.id ?? null;
                      layersRef.current = croppedLayers;
                      activeLayerIdRef.current = nextActiveLayerId;
                      setLayers(croppedLayers);
                      setActiveLayerId(nextActiveLayerId);
                      setCanvasSize({ width: sel.w, height: sel.h });
                      setBackgroundSettings(prev => ({ ...prev, width: sel.w, height: sel.h }));
                      clearHistory();
                      setSelection(null);
                      setTimeout(() => { canvasEngineRef.current?.recomposite(); setLayerRenderTick(t2 => t2 + 1); }, 50);
                      return;
                    }
                    case 'rotate-cw':
                    case 'rotate-ccw': {
                      const newW = canvasSize.height;
                      const newH = canvasSize.width;
                      const angle = action === 'rotate-cw' ? 90 : -90;
                      const newLayers = layersRef.current.map(l => {
                        const nc = document.createElement('canvas');
                        nc.width = newW; nc.height = newH;
                        const nctx = nc.getContext('2d')!;
                        nctx.save();
                        nctx.translate(newW / 2, newH / 2);
                        nctx.rotate((angle * Math.PI) / 180);
                        nctx.drawImage(l.canvas, -l.canvas.width / 2, -l.canvas.height / 2);
                        nctx.restore(); // reset transform so future draws work correctly
                        return { ...l, canvas: nc, ctx: nctx };
                      });
                      layersRef.current = newLayers;
                      setLayers(newLayers);
                      setCanvasSize({ width: newW, height: newH });
                      setBackgroundSettings(prev => ({ ...prev, width: newW, height: newH }));
                      setSelection(null);
                      clearHistory();
                      setTimeout(() => { canvasEngineRef.current?.recomposite(); setLayerRenderTick(t2 => t2 + 1); }, 50);
                      return;
                    }
                    default: return;
                  }
                  ctx.putImageData(imgData, targetRect.x, targetRect.y);
                  canvasEngineRef.current?.recomposite();
                  setLayerRenderTick(t => t + 1);
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-2 rounded-lg border border-neutral-600/80 bg-neutral-700/80 px-3 text-xs"
                  onClick={() => setTheme((prev) => prev === 'light' ? 'dark' : 'light')}
                >
                  {theme === 'light' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  {theme === 'light' ? 'Dark' : 'Light'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Toggle {theme === 'light' ? 'dark' : 'light'} mode</TooltipContent>
            </Tooltip>

            {/* Animation Controls */}
            <div className="flex items-center gap-2 px-3 py-1 bg-neutral-700 rounded-lg">
              <Film className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-neutral-400">Render:</span>
              <Input
                type="number"
                value={fpsDraft}
                onChange={(e) => setFpsDraft(e.target.value)}
                onBlur={() => {
                  const v = Math.max(1, Math.min(120, Math.round(Number(fpsDraft) || fps)));
                  setFps(v);
                  setFpsDraft(String(v));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const v = Math.max(1, Math.min(120, Math.round(Number(fpsDraft) || fps)));
                    setFps(v);
                    setFpsDraft(String(v));
                  }
                  if (e.key === 'Escape') {
                    setFpsDraft(String(fps));
                  }
                }}
                className="h-7 w-16 bg-neutral-800 text-center text-xs border-neutral-600"
                min={1}
                max={120}
                title="Render/export FPS"
              />
              <span className="text-xs text-neutral-400">Speed:</span>
                <select
                  value={playbackSpeed}
                  onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                  className="h-6 text-xs bg-neutral-800 border border-neutral-600 rounded text-neutral-200 px-1"
                  title="Playback speed"
                >
                <option value={0.25}>0.25x</option>
                <option value={0.5}>0.5x</option>
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={4}>4x</option>
                <option value={8}>8x</option>
                <option value={16}>16x</option>
              </select>
              <Separator orientation="vertical" className="h-4 mx-1" />
              <Button 
                variant="ghost" 
                size="icon" 
                className={`h-7 w-7 ${isRecording ? 'bg-red-500/20 text-red-400 animate-pulse' : ''}`}
                onClick={handleRecordToggle}
              >
                <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500' : 'bg-red-500/50'}`} />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => selectFrameForCanvas(0)} disabled={frames.length === 0}>
                    <SkipBack className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>First Frame</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleStepFrame(-1)} disabled={frames.length === 0}>
                    <StepBack className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Previous Frame</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={isPlaying ? handlePauseAnimation : handlePlayAnimation} disabled={frames.length === 0}>
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isPlaying ? 'Pause' : 'Play'}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleStopAnimation} disabled={frames.length === 0 && !isPlaying}>
                    <CircleStop className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Stop</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleStepFrame(1)} disabled={frames.length === 0}>
                    <StepForward className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Next Frame</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => selectFrameForCanvas(frames.length - 1)} disabled={frames.length === 0}>
                    <SkipForward className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Last Frame</TooltipContent>
              </Tooltip>
              {frames.length > 0 && (
                <span className="text-xs text-neutral-400 tabular-nums">
                  {`${currentFrame + 1}/${frames.length}`}
                </span>
              )}
              {frames.length > 0 && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setShowTimeline(!showTimeline)}
                      >
                        <ChevronDown className={`h-4 w-4 transition-transform ${showTimeline ? 'rotate-180' : ''}`} />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{showTimeline ? 'Hide' : 'Show'} Timeline</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-neutral-500 hover:text-red-400"
                        onClick={() => {
                          if (confirm(`Clear all ${frames.length} frames?`)) {
                            clearAnimationTimeline();
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clear Frames</TooltipContent>
                  </Tooltip>
                </>
              )}
            </div>
            
            <Button 
              variant="default" 
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              onClick={() => setShowExportDialog(true)}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        </div>

        {/* Main Workspace */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left Toolbar */}
          <div className={`w-14 shrink-0 bg-neutral-800 border-r border-neutral-700 flex flex-col items-center py-4 gap-1 ${showPanels ? '' : 'hidden'}`}>
            {tools.map((tool) => (
              <Tooltip key={tool.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant={activeTool === tool.id ? 'default' : 'ghost'}
                    size="icon"
                    className={`h-10 w-10 ${activeTool === tool.id ? 'bg-blue-600' : ''}`}
                    onClick={() => handleToolChange(tool.id as ToolType)}
                  >
                    <tool.icon className="h-5 w-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">{tool.label} ({tool.shortcut})</TooltipContent>
              </Tooltip>
            ))}
            
            <Separator className="my-2 w-8" />
            
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-10 w-10 ${showGrid ? 'bg-blue-600/30 text-blue-400' : ''}`}
                  onClick={() => setShowGrid(!showGrid)}
                >
                  <Grid className="h-5 w-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Toggle Grid</TooltipContent>
            </Tooltip>

            <div className="mt-auto" />

            {/* PS-style foreground/background color swap */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="relative w-10 h-10 cursor-pointer"
                  onClick={() => {
                    const prev = toolSettings.color;
                    setToolSettings(s => ({ ...s, color: bgColor }));
                    setBgColor(prev);
                  }}
                >
                  {/* Background color (bottom-right) */}
                  <div
                    className="absolute bottom-0 right-0 w-6 h-6 rounded-sm border border-neutral-500"
                    style={{ backgroundColor: bgColor }}
                  />
                  {/* Foreground color (top-left, on top) */}
                  <div
                    className="absolute top-0 left-0 w-6 h-6 rounded-sm border border-neutral-400 z-10"
                    style={{ backgroundColor: toolSettings.color }}
                  />
                  {/* Reset icon (tiny) */}
                  <div
                    className="absolute bottom-0 left-0 text-neutral-500 hover:text-neutral-300 z-20"
                    style={{ fontSize: 8, lineHeight: 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setToolSettings(s => ({ ...s, color: '#000000' }));
                      setBgColor('#ffffff');
                    }}
                    title="Reset colors (D)"
                  >
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="1" y="4" width="4" height="4" fill="white" stroke="currentColor" />
                      <rect x="5" y="1" width="4" height="4" fill="black" stroke="currentColor" />
                    </svg>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">Swap Colors (X)</TooltipContent>
            </Tooltip>
          </div>

          {/* Center Canvas Area */}
          <div className="min-w-0 flex-1 flex flex-col bg-neutral-950 relative">
            {/* Canvas Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">Zoom:</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-neutral-300 hover:text-white"
                  onClick={() => applyZoom(zoom - ZOOM_STEP, getViewportCenterAnchor())}
                  disabled={zoom <= MIN_ZOOM}
                  title="Zoom out"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Slider
                  value={[zoom]}
                  onValueChange={([v]) => applyZoom(v)}
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={ZOOM_STEP}
                  className="w-32"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-neutral-300 hover:text-white"
                  onClick={() => applyZoom(zoom + ZOOM_STEP, getViewportCenterAnchor())}
                  disabled={zoom >= MAX_ZOOM}
                  title="Zoom in"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  value={zoomDraft}
                  onChange={(e) => setZoomDraft(e.target.value)}
                  onBlur={() => {
                    const v = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(Number(zoomDraft) || zoom)));
                    applyZoom(v);
                    setZoomDraft(String(v));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(Number(zoomDraft) || zoom)));
                      applyZoom(v);
                      setZoomDraft(String(v));
                    }
                    if (e.key === 'Escape') {
                      setZoomDraft(String(zoom));
                    }
                  }}
                  className="h-7 w-16 bg-neutral-800 px-2 text-center text-xs border-neutral-600"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={ZOOM_STEP}
                />
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                  onClick={fitCanvasToViewport}
                  title="Fit (Ctrl+0)"
                >Fit</button>
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                  onClick={centerCanvasViewport}
                  title="Center canvas"
                >Center</button>
                <button
                  className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                  onClick={() => applyZoom(100)}
                  title="100% (Ctrl+1)"
                >1:1</button>
                <button
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                  onClick={() => rotateCanvasBy(-90)}
                  title="Rotate canvas left"
                >
                  <RotateCcw className="h-3 w-3" />
                  Left
                </button>
                <button
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors"
                  onClick={() => rotateCanvasBy(90)}
                  title="Rotate canvas right"
                >
                  <RotateCw className="h-3 w-3" />
                  Right
                </button>
                <button
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50 disabled:hover:text-neutral-400"
                  onClick={resetCanvasRotation}
                  title="Reset canvas rotation"
                  disabled={canvasRotation === 0}
                >
                  <RefreshCw className="h-3 w-3" />
                  Normal
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <button
                  onClick={() => setShowRulers((value) => !value)}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${showRulers ? 'bg-blue-600/20 border-blue-500/30 text-blue-300' : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:text-neutral-300'}`}
                  title="Toggle rulers"
                >
                  Rulers
                </button>
                <button
                  onClick={() => setSymmetryX(s => !s)}
                  className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${symmetryX ? 'bg-blue-600/20 border-blue-500/30 text-blue-300' : 'bg-neutral-800 border-neutral-700 text-neutral-500 hover:text-neutral-300'}`}
                  title="Mirror Symmetry (horizontal)"
                >
                  ⎸Mirror
                </button>
                {isTabletStreaming && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-600/20 border border-blue-500/30 text-blue-300 text-[10px]">
                    <Tablet className="h-3 w-3" />
                    Drawing Tablet
                  </span>
                )}
                <span>{canvasSize.width} x {canvasSize.height} px</span>
                <span>{canvasRotation}deg</span>
                <span className="text-[10px] text-neutral-500">Scroll to zoom · Space to pan</span>
              </div>
            </div>
            
            {/* Canvas with optional rulers */}
            <div className="flex-1 flex flex-col min-h-0">
              {showRulers && (
                <Ruler direction="horizontal" size={canvasSize.width} zoom={zoom / 100} cursor={cursorPos?.x ?? null} />
              )}
              <div className="flex flex-1 min-h-0">
                {showRulers && (
                  <Ruler direction="vertical" size={canvasSize.height} zoom={zoom / 100} cursor={cursorPos?.y ?? null} />
                )}
            <div
              ref={canvasViewportRef}
              className="flex-1 overflow-auto"
              style={{ cursor: panDragRef.current ? 'grabbing' : isSpaceDown ? 'grab' : undefined }}
              onMouseDown={(e) => {
                if (!isSpaceDown && e.button !== 1) return;
                e.preventDefault();
                e.stopPropagation();
                const vp = canvasViewportRef.current;
                if (!vp) return;
                panDragRef.current = { startX: e.clientX, startY: e.clientY, scrollLeft: vp.scrollLeft, scrollTop: vp.scrollTop };
                // Force cursor update
                if (vp) vp.style.cursor = 'grabbing';
              }}
              onMouseMove={(e) => {
                const drag = panDragRef.current;
                if (!drag) return;
                e.preventDefault();
                const vp = canvasViewportRef.current;
                if (!vp) return;
                vp.scrollLeft = drag.scrollLeft - (e.clientX - drag.startX);
                vp.scrollTop = drag.scrollTop - (e.clientY - drag.startY);
              }}
              onMouseUp={() => {
                panDragRef.current = null;
                const vp = canvasViewportRef.current;
                if (vp) vp.style.cursor = '';
              }}
              onMouseLeave={() => {
                panDragRef.current = null;
                const vp = canvasViewportRef.current;
                if (vp) vp.style.cursor = '';
              }}
              onTouchStart={(e) => {
                if (e.touches.length < 2) {
                  touchGestureRef.current = null;
                  return;
                }
                const [first, second] = Array.from(e.touches);
                const midpoint = getTouchMidpoint(first, second);
                touchGestureRef.current = {
                  initialDistance: Math.max(1, getTouchDistance(first, second)),
                  initialZoom: zoomRef.current,
                  midpointClientX: midpoint.clientX,
                  midpointClientY: midpoint.clientY,
                };
              }}
              onTouchMove={(e) => {
                if (e.touches.length < 2) {
                  touchGestureRef.current = null;
                  return;
                }
                const gesture = touchGestureRef.current;
                if (!gesture) return;
                e.preventDefault();
                const [first, second] = Array.from(e.touches);
                const midpoint = getTouchMidpoint(first, second);
                const distance = Math.max(1, getTouchDistance(first, second));
                const scaledZoom = gesture.initialZoom * (distance / gesture.initialDistance);
                applyZoom(scaledZoom, {
                  clientX: midpoint.clientX,
                  clientY: midpoint.clientY,
                }, 'smooth');
                gesture.midpointClientX = midpoint.clientX;
                gesture.midpointClientY = midpoint.clientY;
              }}
              onTouchEnd={(e) => {
                if (e.touches.length < 2) {
                  touchGestureRef.current = null;
                }
              }}
              onTouchCancel={() => {
                touchGestureRef.current = null;
              }}
              onAuxClick={(e) => { if (e.button === 1) e.preventDefault(); }}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (!file || !file.type.startsWith('image/')) return;
                const img = new Image();
                const url = URL.createObjectURL(file);
                img.onload = () => {
                  const layer = createEmptyLayer(file.name, canvasSize.width, canvasSize.height);
                  layer.ctx.drawImage(img, 0, 0, canvasSize.width, canvasSize.height);
                  layersRef.current = [...layersRef.current, layer];
                  activeLayerIdRef.current = layer.id;
                  setLayers(prev => [...prev, layer]);
                  setActiveLayerId(layer.id);
                  URL.revokeObjectURL(url);
                };
                img.onerror = () => URL.revokeObjectURL(url);
                img.src = url;
              }}
            >
              <div style={{ display: 'grid', placeItems: 'center', minWidth: `calc(100% + ${canvasFootprint.width}px)`, minHeight: `calc(100% + ${canvasFootprint.height}px)`, padding: 32 }}>
              <CanvasEngine
                ref={canvasEngineRef}
                width={canvasSize.width}
                height={canvasSize.height}
                layers={layers}
                activeLayerId={activeLayerId}
                activeTool={activeTool}
                toolSettings={toolSettings}
                backgroundSettings={backgroundSettings}
                zoom={zoom / 100}
                showGrid={showGrid}
                onStrokeComplete={handleStrokeComplete}
                onColorPick={(color) => {
                  setPreviousColor(toolSettings.color);
                  setToolSettings(prev => ({ ...prev, color }));
                  addRecentColor(color);
                }}
                onCursorMove={(x, y) => setCursorPos(x >= 0 ? { x, y } : null)}
                onLayerVisibilityFix={updateLayer}
                onSelectionChange={setSelection}
                onDrawingStateChange={handleCanvasDrawingStateChange}
                selection={selection}
                symmetryX={symmetryX}
                bgColor={bgColor}
                onSaveState={saveState}
                penCursor={isTabletStreaming ? blePenCursor : null}
                viewRotation={canvasRotation}
              />
              </div>
            </div>

            {/* Navigator mini-map */}
            {zoom > 100 && (
              <NavigatorMinimap
                canvasWidth={canvasSize.width}
                canvasHeight={canvasSize.height}
                zoom={zoom / 100}
                viewportRef={canvasViewportRef}
                layers={layers}
              />
            )}

              </div>
            </div>

            {/* Animation Timeline — floating popup overlay */}
            {frames.length > 0 && showTimeline && (
              <div className="absolute bottom-0 left-0 right-0 z-30 shadow-2xl" style={{ maxHeight: '40%' }}>
                <div className="bg-neutral-800 border-t border-neutral-600">
                  <button
                    onClick={() => setShowTimeline(false)}
                    className="w-full flex items-center justify-between px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-400 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Film className="h-3.5 w-3.5 text-blue-400" />
                      Timeline — {frames.length} frame{frames.length !== 1 ? 's' : ''}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                  </button>
                  <AnimationTimeline
                    frames={frames}
                    currentFrame={currentFrame}
                    isPlaying={isPlaying}
                    onPlayToggle={isPlaying ? handlePauseAnimation : handlePlayAnimation}
                    onFrameSelect={selectFrameForCanvas}
                    onFramesChange={isEventPlayback ? undefined : setStoredFrames}
                    isEditable={!isEventPlayback}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Right Panels */}
          <div className={`w-72 shrink-0 bg-neutral-800 border-l border-neutral-700 flex flex-col overflow-hidden ${showPanels ? '' : 'hidden'}`}>
            {/* Tab bar */}
            <div className="app-right-tabs shrink-0">
              {(['layers', 'tools', 'color', 'tablet'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setRightTab(tab)}
                  className={`app-right-tab ${
                    tab === 'tablet' && !hasTabletConnection ? 'app-right-tab-attention' : ''
                  } ${
                    rightTab === tab
                      ? 'app-right-tab-active'
                      : ''
                  }`}
                >
                  {tab === 'tablet' ? 'Pad' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {rightTab === 'layers' && (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Blend mode + Opacity control bar - PS style */}
                <div className="shrink-0 px-3 py-1.5 border-b border-neutral-700 space-y-1.5">
                  <select
                    value={layers.find(l => l.id === activeLayerId)?.blendMode ?? 'source-over'}
                    onChange={(e) => activeLayerId && updateLayer(activeLayerId, { blendMode: e.target.value as Layer['blendMode'] })}
                    className="w-full h-6 text-[11px] bg-neutral-900 border border-neutral-600 rounded text-neutral-200 px-1"
                  >
                    <option value="source-over">Normal</option>
                    <option value="multiply">Multiply</option>
                    <option value="screen">Screen</option>
                    <option value="overlay">Overlay</option>
                    <option value="darken">Darken</option>
                    <option value="lighten">Lighten</option>
                    <option value="color-dodge">Color Dodge</option>
                    <option value="color-burn">Color Burn</option>
                    <option value="hard-light">Hard Light</option>
                    <option value="soft-light">Soft Light</option>
                    <option value="difference">Difference</option>
                    <option value="exclusion">Exclusion</option>
                    <option value="hue">Hue</option>
                    <option value="saturation">Saturation</option>
                    <option value="color">Color</option>
                    <option value="luminosity">Luminosity</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-neutral-400 shrink-0">Opacity:</span>
                  <Slider
                    value={[layers.find(l => l.id === activeLayerId)?.opacity ?? 100]}
                    onValueChange={([v]) => activeLayerId && updateLayer(activeLayerId, { opacity: v })}
                    min={0}
                    max={100}
                    step={1}
                    className="flex-1"
                  />
                  <Input
                    type="number"
                    value={layerOpacityDraft}
                    onChange={(e) => setLayerOpacityDraft(e.target.value)}
                    onBlur={() => {
                      if (!activeLayerId) return;
                      const v = Math.max(0, Math.min(100, Math.round(Number(layerOpacityDraft) || activeLayerOpacity)));
                      updateLayer(activeLayerId, { opacity: v });
                      setLayerOpacityDraft(String(v));
                    }}
                    onKeyDown={(e) => {
                      if (!activeLayerId) return;
                      if (e.key === 'Enter') {
                        const v = Math.max(0, Math.min(100, Math.round(Number(layerOpacityDraft) || activeLayerOpacity)));
                        updateLayer(activeLayerId, { opacity: v });
                        setLayerOpacityDraft(String(v));
                      }
                      if (e.key === 'Escape') {
                        setLayerOpacityDraft(String(activeLayerOpacity));
                      }
                    }}
                    className="h-7 w-16 bg-neutral-900 px-2 text-right text-[11px] tabular-nums border-neutral-600"
                    min={0}
                    max={100}
                    step={1}
                  />
                  </div>
                </div>

                {/* Layer list */}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(event) => {
                    const { active, over } = event;
                    if (!over || active.id === over.id) return;

                    const displayOrder = [...layers].reverse();
                    const oldDisplayIndex = displayOrder.findIndex(l => l.id === active.id);
                    const newDisplayIndex = displayOrder.findIndex(l => l.id === over.id);
                    if (oldDisplayIndex < 0 || newDisplayIndex < 0) return;

                    const oldIndex = layers.length - 1 - oldDisplayIndex;
                    const newIndex = layers.length - 1 - newDisplayIndex;
                    moveLayer(oldIndex, newIndex);
                  }}
                >
                  <SortableContext 
                    items={[...layers].reverse().map(l => l.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      {[...layers].reverse().map((layer) => (
                        <LayerPanel
                          key={layer.id}
                          layer={layer}
                          isActive={layer.id === activeLayerId}
                          onSelect={() => selectLayer(layer.id)}
                          onUpdate={(updates) => updateLayer(layer.id, updates)}
                          onDuplicate={() => duplicateLayer(layer.id)}
                          onDelete={() => deleteLayer(layer.id)}
                          onFlip={(dir) => flipLayer(layer.id, dir)}
                          onRotate={(deg) => rotateLayer(layer.id, deg)}
                          onClear={() => {
                            if (layer.locked) return;
                            const imgData = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
                            saveState(layer.id, imgData);
                            layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
                            canvasEngineRef.current?.recomposite();
                            setLayerRenderTick(t => t + 1);
                          }}
                          canDelete={layers.length > 1}
                          renderTick={layerRenderTick}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => setShowBackgroundLayerSettings((value) => !value)}
                        className={`flex h-11 w-full items-center border-b border-neutral-700/50 text-left transition-colors ${
                          showBackgroundLayerSettings
                            ? 'bg-[#2a4a7f]'
                            : 'bg-neutral-800 hover:bg-neutral-700/50'
                        }`}
                      >
                        <div className="w-6 shrink-0" />
                        <div className="w-8 shrink-0" />
                        <div className="w-6 shrink-0" />
                        <div
                          className="mx-1.5 h-9 w-9 shrink-0 border border-neutral-600"
                          style={getBackgroundLayerPreviewStyle(backgroundSettings)}
                        />
                        <div className="min-w-0 flex-1 px-1.5">
                          <div className="truncate text-xs font-normal text-neutral-200">Background</div>
                          <div className="truncate text-[10px] leading-tight text-neutral-500">
                            {backgroundSettings.transparent ? 'Transparent' : `${backgroundSettings.pattern} • ${backgroundSettings.width} x ${backgroundSettings.height}`}
                          </div>
                        </div>
                        <ChevronRight
                          className={`mr-3 h-3.5 w-3.5 shrink-0 text-neutral-400 transition-transform ${
                            showBackgroundLayerSettings ? 'rotate-90' : ''
                          }`}
                        />
                      </button>
                      {showBackgroundLayerSettings && (
                        <div className="border-b border-neutral-700 bg-neutral-900/70 px-3 py-3">
                          <CanvasSettingsPanel
                            settings={backgroundSettings}
                            hideTitle
                            onSettingsChange={(next) => {
                              setBackgroundSettings(next);
                              if (next.width !== canvasSize.width || next.height !== canvasSize.height) {
                                resizeCanvas(next.width, next.height);
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Bottom action bar - PS style */}
                <div className="shrink-0 border-t border-neutral-700 bg-neutral-800 px-2 py-1 flex items-center justify-center gap-1">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-neutral-400 hover:text-neutral-200" onClick={addLayer} title="New Layer">
                    <Plus className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-neutral-400 hover:text-neutral-200" onClick={() => activeLayerId && duplicateLayer(activeLayerId)} title="Duplicate Layer">
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-neutral-400 hover:text-neutral-200"
                    onClick={() => activeLayerId && deleteLayer(activeLayerId)}
                    disabled={layers.length <= 1}
                    title="Delete Layer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {rightTab === 'tools' && (
              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-2">
                <ToolSettingsPanel
                  tool={activeTool}
                  settings={toolSettings}
                  onSettingsChange={setToolSettings}
                />
              </div>
            )}

            {rightTab === 'color' && (
              <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-2">
                <div className="space-y-4">
                  <HexColorPicker
                    color={toolSettings.color}
                    onChange={(color) => setToolSettings(prev => ({ ...prev, color }))}
                    style={{ width: '100%', height: 200 }}
                  />
                  <div className="flex items-center gap-2">
                    {/* New / Previous color split (PS convention) */}
                    <div className="flex flex-col w-10 h-10 rounded border border-neutral-600 overflow-hidden">
                      <div className="flex-1" style={{ backgroundColor: toolSettings.color }} title={`New: ${toolSettings.color}`} />
                      <div
                        className="flex-1 cursor-pointer"
                        style={{ backgroundColor: previousColor }}
                        title={`Previous: ${previousColor} (click to revert)`}
                        onClick={() => setToolSettings(prev => ({ ...prev, color: previousColor }))}
                      />
                    </div>
                    <Input
                      value={toolSettings.color}
                      onChange={(e) => {
                        const v = e.target.value;
                        // Only commit valid hex colors; allow typing partial values
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) {
                          setToolSettings(prev => ({ ...prev, color: v }));
                        }
                      }}
                      className="flex-1 bg-neutral-900 border-neutral-600"
                    />
                  </div>

                  {/* Palette swatches */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Palette</span>
                    <div className="flex flex-wrap gap-0.5">
                      {['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff',
                        '#ff6600','#9933ff','#00cc66','#ff3366','#3399ff','#cc9900','#666666','#cccccc',
                        '#800000','#008000','#000080','#808000','#800080','#008080','#c0c0c0','#404040',
                      ].map(c => (
                        <button
                          key={c}
                          className={`w-4 h-4 rounded-sm border ${c === toolSettings.color ? 'border-blue-400 ring-1 ring-blue-400/50' : 'border-neutral-700'}`}
                          style={{ backgroundColor: c }}
                          onClick={() => setToolSettings(prev => ({ ...prev, color: c }))}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>

                  {/* HSL sliders */}
                  <HslSliders
                    color={toolSettings.color}
                    onChange={(color) => setToolSettings(prev => ({ ...prev, color }))}
                  />

                  {/* Recent colors */}
                  {recentColors.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Recent</span>
                      <div className="flex flex-wrap gap-1">
                        {recentColors.map((color, i) => (
                          <button
                            key={`${color}-${i}`}
                            className={`w-5 h-5 rounded-sm border transition-colors ${color === toolSettings.color ? 'border-blue-400 ring-1 ring-blue-400/50' : 'border-neutral-600 hover:border-neutral-400'}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setToolSettings(prev => ({ ...prev, color }))}
                            title={color}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TabletPanel stays mounted always so BLE connection survives tab switches */}
            <div className={`flex-1 min-h-0 overflow-y-auto px-3 pb-3 pt-2 ${rightTab === 'tablet' ? '' : 'hidden'}`}>
              <TabletPanel
                canvasWidth={canvasSize.width}
                canvasHeight={canvasSize.height}
                onPenPoint={handleBLEPenPoint}
                onDeviceConnected={handleDeviceConnected}
                onConnectionStateChange={setHasTabletConnection}
                onNewPage={handleNewPage}
                onStreamingChange={(streaming) => {
                  setIsTabletStreaming(streaming);
                  if (!streaming) setBlePenCursor(null);
                }}
                onPagesDownloaded={handlePagesDownloaded}
                onOpenMemoryPage={() => setActivePage('memory')}
              />
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="flex items-center justify-between px-4 py-0.5 bg-neutral-800 border-t border-neutral-700 text-[10px] text-neutral-500 shrink-0">
          <div className="flex items-center gap-4">
            {cursorPos && <span className="font-mono tabular-nums">X: {Math.round(cursorPos.x)}, Y: {Math.round(cursorPos.y)}</span>}
            <button
              type="button"
              onClick={openCanvasResizePrompt}
              className="rounded px-1.5 py-0.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-100"
              title="Edit canvas resolution"
            >
              {canvasSize.width} × {canvasSize.height} px
            </button>
          </div>
          <div className="flex items-center gap-4">
            <span>{layers.find(l => l.id === activeLayerId)?.name ?? '—'}</span>
            <span>{zoom}%</span>
            <span className="text-neutral-600">Tab: toggle panels · ?: shortcuts</span>
          </div>
        </div>

        {/* Export Dialog */}
        <ExportDialog
          open={showExportDialog}
          onOpenChange={setShowExportDialog}
          frames={frames}
          animationStrokes={animationStrokes}
          playbackFps={fps}
          canvasSize={canvasSize}
          layers={layers}
          backgroundSettings={backgroundSettings}
        />

        {/* Keyboard Shortcuts Help */}
        {showShortcuts && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowShortcuts(false)}>
            <div className="bg-neutral-800 border border-neutral-600 rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-neutral-100">Keyboard Shortcuts</h3>
                <button onClick={() => setShowShortcuts(false)} className="text-neutral-500 hover:text-neutral-300 text-xs">ESC</button>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
                {[
                  ['Tools', ''],
                  ['B', 'Brush'], ['E', 'Eraser'], ['L', 'Line'], ['U', 'Rectangle'],
                  ['C', 'Circle'], ['G', 'Fill'], ['I', 'Eyedropper'],
                  ['R', 'Smudge'], ['V', 'Move'], ['M', 'Marquee Select'], ['T', 'Text'],
                  ['', ''],
                  ['Drawing', ''],
                  ['[ / ]', 'Brush size -/+'], ['1-9, 0', 'Opacity 10%-100%'],
                  ['Shift+Click', 'Straight line'], ['Shift+Drag', 'Constrain shape'],
                  ['Alt+Click', 'Eyedropper'], ['Delete', 'Clear layer'],
                  ['Ctrl+Alt+T', 'Free transform selection'], ['Enter / Esc', 'Commit / cancel transform'],
                  ['', ''],
                  ['Colors', ''],
                  ['X', 'Swap FG/BG'], ['D', 'Reset to B/W'],
                  ['', ''],
                  ['Navigation', ''],
                  ['Space+Drag', 'Pan'], ['Middle Drag', 'Pan'],
                  ['Scroll', 'Zoom'], ['Ctrl + / -', 'Zoom in/out'], ['Ctrl+0', 'Fit canvas'],
                  ['Tab', 'Toggle panels'],
                  ['', ''],
                  ['File', ''],
                  ['Ctrl+N', 'New project'], ['Ctrl+O', 'Open'], ['Ctrl+S', 'Save'],
                  ['Ctrl+V', 'Paste image'], ['Ctrl+C', 'Copy'], ['Ctrl+Shift+C', 'Copy merged'], ['Ctrl+X', 'Cut'],
                  ['Ctrl+A', 'Select all'], ['Ctrl+D', 'Deselect'],
                  ['Ctrl+Z', 'Undo'], ['Ctrl+Y', 'Redo'], ['Ctrl+Shift+S', 'Export dialog'],
                  ['', ''],
                  ['Adjustments', ''],
                  ['Ctrl+I', 'Invert colors'], ['Ctrl+Shift+U', 'Desaturate'],
                  ['', ''],
                  ['Layers', ''],
                  ['Ctrl+J', 'Duplicate layer'], ['Ctrl+E', 'Merge down'],
                  ['Ctrl+Shift+E', 'Flatten all'], ['Ctrl+Shift+N', 'New layer'],
                  ['Dbl-click name', 'Rename'], ['Right-click', 'Layer context menu'],
                ].map(([key, desc], i) => (
                  desc === '' && key !== '' ? (
                    <div key={i} className="col-span-2 text-neutral-400 font-medium mt-2 mb-0.5 border-b border-neutral-700 pb-0.5">{key}</div>
                  ) : key === '' ? null : (
                    <div key={i} className="contents">
                      <span className="text-neutral-400 font-mono">{key}</span>
                      <span className="text-neutral-300">{desc}</span>
                    </div>
                  )
                ))}
              </div>
              <p className="text-[10px] text-neutral-500 mt-4 text-center">Press ? to toggle this overlay</p>
            </div>
          </div>
        )}

        {/* Device Resolution Prompt */}
        {resolutionPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-neutral-800 border border-neutral-600 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
              <h3 className="text-sm font-semibold text-neutral-100 mb-1">
                {resolutionPrompt.deviceName} Connected
              </h3>
              <p className="text-xs text-neutral-400 mb-4">
                {resolutionPrompt.modeLabel === 'tablet'
                  ? 'Match your canvas to the tablet workspace? Landscape is usually the right fit for live tablet mode.'
                  : 'Match your canvas to the notebook page size?'}
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Portrait option */}
                <button
                  onClick={() => applyDeviceResolution(resolutionPrompt.portrait.width, resolutionPrompt.portrait.height)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border hover:border-blue-500 hover:bg-blue-500/10 transition-colors group ${
                    resolutionPrompt.preferredOrientation === 'portrait'
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-neutral-600'
                  }`}
                >
                  <div className="w-10 h-14 rounded border-2 border-neutral-500 group-hover:border-blue-400 transition-colors" />
                  <span className="text-xs text-neutral-300 font-medium">
                    Portrait{resolutionPrompt.preferredOrientation === 'portrait' ? ' Recommended' : ''}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {resolutionPrompt.portrait.width} × {resolutionPrompt.portrait.height}
                  </span>
                </button>
                {/* Landscape option */}
                <button
                  onClick={() => applyDeviceResolution(resolutionPrompt.landscape.width, resolutionPrompt.landscape.height)}
                  className={`flex flex-col items-center gap-2 p-3 rounded-lg border hover:border-blue-500 hover:bg-blue-500/10 transition-colors group ${
                    resolutionPrompt.preferredOrientation === 'landscape'
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-neutral-600'
                  }`}
                >
                  <div className="w-14 h-10 rounded border-2 border-neutral-500 group-hover:border-blue-400 transition-colors" />
                  <span className="text-xs text-neutral-300 font-medium">
                    Landscape{resolutionPrompt.preferredOrientation === 'landscape' ? ' Recommended' : ''}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {resolutionPrompt.landscape.width} × {resolutionPrompt.landscape.height}
                  </span>
                </button>
              </div>
              <button
                onClick={() => setResolutionPrompt(null)}
                className="w-full text-xs text-neutral-500 hover:text-neutral-300 py-1.5 transition-colors"
              >
                Keep current ({canvasSize.width} × {canvasSize.height})
              </button>
            </div>
          </div>
        )}

        {canvasResizePrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setCanvasResizePrompt(null)}>
            <div
              className="bg-neutral-800 border border-neutral-600 rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4"
              onClick={(event) => event.stopPropagation()}
            >
              <h3 className="mb-1 text-sm font-semibold text-neutral-100">Edit Canvas Resolution</h3>
              <p className="mb-4 text-xs text-neutral-400">
                Resize the current project canvas.
              </p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="space-y-1">
                  <label className="text-[11px] text-neutral-400">Width</label>
                  <Input
                    type="number"
                    min={64}
                    max={8192}
                    step={1}
                    value={canvasResizePrompt.width}
                    onChange={(e) => setCanvasResizePrompt((prev) => prev ? { ...prev, width: e.target.value } : prev)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyCanvasResizePrompt();
                      if (e.key === 'Escape') setCanvasResizePrompt(null);
                    }}
                    className="h-9 bg-neutral-900 border-neutral-600 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-neutral-400">Height</label>
                  <Input
                    type="number"
                    min={64}
                    max={8192}
                    step={1}
                    value={canvasResizePrompt.height}
                    onChange={(e) => setCanvasResizePrompt((prev) => prev ? { ...prev, height: e.target.value } : prev)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyCanvasResizePrompt();
                      if (e.key === 'Escape') setCanvasResizePrompt(null);
                    }}
                    className="h-9 bg-neutral-900 border-neutral-600 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-neutral-700 bg-neutral-900 text-neutral-100 hover:bg-neutral-800"
                  onClick={() => setCanvasResizePrompt(null)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={applyCanvasResizePrompt}
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

export default App;

function getBackgroundLayerPreviewStyle(settings: BackgroundSettings): import('react').CSSProperties {
  if (settings.transparent) {
    return {
      backgroundColor: '#2a2a2a',
      backgroundImage: 'linear-gradient(45deg, #3a3a3a 25%, transparent 25%), linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a3a 75%), linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)',
      backgroundSize: '12px 12px',
      backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
    };
  }

  const primary = settings.primaryColor;
  const secondary = settings.secondaryColor;
  const size = Math.max(4, Math.round(settings.pixelSize / 2));

  switch (settings.pattern) {
    case 'solid':
      return { backgroundColor: secondary };
    case 'ruled':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(${primary} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
      };
    case 'dots':
      return {
        backgroundColor: secondary,
        backgroundImage: `radial-gradient(circle at center, ${primary} 18%, transparent 22%)`,
        backgroundSize: `${size}px ${size}px`,
      };
    case 'grid':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(${primary} 1px, transparent 1px), linear-gradient(90deg, ${primary} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
      };
    case 'graph':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(${primary} 1px, transparent 1px), linear-gradient(90deg, ${primary} 1px, transparent 1px), linear-gradient(${primary}66 2px, transparent 2px), linear-gradient(90deg, ${primary}66 2px, transparent 2px)`,
        backgroundSize: `${size}px ${size}px, ${size}px ${size}px, ${size * 5}px ${size * 5}px, ${size * 5}px ${size * 5}px`,
      };
    case 'checker':
      return {
        backgroundColor: secondary,
        backgroundImage: `linear-gradient(45deg, ${primary} 25%, transparent 25%), linear-gradient(-45deg, ${primary} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${primary} 75%), linear-gradient(-45deg, transparent 75%, ${primary} 75%)`,
        backgroundSize: `${size * 2}px ${size * 2}px`,
        backgroundPosition: `0 0, 0 ${size}px, ${size}px -${size}px, -${size}px 0px`,
      };
    default:
      return { backgroundColor: secondary };
  }
}
