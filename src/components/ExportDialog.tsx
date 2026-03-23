import { useState, useCallback, useEffect, useRef } from 'react';
import { Download, Loader2, Film, Image, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import type { AnimationFrame, BackgroundSettings, Layer, Stroke } from '@/types';
import {
  getAnimationPlaybackDuration,
  getAnimationSampleCount,
  getAnimationSampleTimeMs,
  mergeVisibleLayersToCanvas,
  renderAnimationCompositeCanvas,
} from '@/utils/helpers';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  frames: AnimationFrame[];
  animationStrokes?: Stroke[];
  playbackFps: number;
  canvasSize: { width: number; height: number };
  layers?: Layer[];
  backgroundSettings?: BackgroundSettings;
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const BITRATE_MAP: Record<string, number> = {
  low: 1_000_000,
  medium: 4_000_000,
  high: 10_000_000,
};

function bitratePresetFromMbps(mbps: number): 'low' | 'medium' | 'high' {
  if (mbps <= 1) return 'low';
  if (mbps >= 10) return 'high';
  return 'medium';
}

export function ExportDialog({
  open,
  onOpenChange,
  frames,
  animationStrokes = [],
  playbackFps,
  canvasSize,
  layers = [],
  backgroundSettings,
}: ExportDialogProps) {
  const [mode, setMode] = useState<'image' | 'sequence' | 'video'>('image');
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState('');
  const [exportProgress, setExportProgress] = useState(0);
  const [widthDraft, setWidthDraft] = useState(String(canvasSize.width));
  const [heightDraft, setHeightDraft] = useState(String(canvasSize.height));
  const [imageFormat, setImageFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const [videoFps, setVideoFps] = useState(24);
  const [videoBitrate, setVideoBitrate] = useState<'low' | 'medium' | 'high'>('medium');
  const [videoSpeed, setVideoSpeed] = useState(1);
  const [videoFpsDraft, setVideoFpsDraft] = useState('24');
  const [videoBitrateMbps, setVideoBitrateMbps] = useState(4);
  const [videoBitrateDraft, setVideoBitrateDraft] = useState('4');

  const cancelRef = useRef(false);

  useEffect(() => {
    if (open) {
      setWidthDraft(String(canvasSize.width));
      setHeightDraft(String(canvasSize.height));
      setExportStatus('');
      setExportProgress(0);
      setVideoFpsDraft(String(videoFps));
      setVideoBitrateDraft(String(videoBitrateMbps));
      cancelRef.current = false;
    }
  }, [open, canvasSize.width, canvasSize.height, videoBitrateMbps, videoFps]);

  useEffect(() => {
    setVideoFpsDraft(String(videoFps));
  }, [videoFps]);

  useEffect(() => {
    setVideoBitrateDraft(String(videoBitrateMbps));
  }, [videoBitrateMbps]);

  const safeWidth = Math.max(1, Math.round(Number(widthDraft) || canvasSize.width));
  const safeHeight = Math.max(1, Math.round(Number(heightDraft) || canvasSize.height));
  const isEventPlayback = animationStrokes.length > 0;
  const eventPlaybackDurationMs = isEventPlayback
    ? getAnimationPlaybackDuration(frames, playbackFps)
    : 0;
  const sequenceFrameCount = isEventPlayback
    ? getAnimationSampleCount(eventPlaybackDurationMs, playbackFps)
    : frames.length;
  const estimatedVideoFrameCount = isEventPlayback
    ? getAnimationSampleCount(eventPlaybackDurationMs, videoFps, videoSpeed)
    : frames.length;
  const estimatedVideoDurationSeconds = isEventPlayback
    ? estimatedVideoFrameCount / Math.max(1, videoFps)
    : frames.length / Math.max(1, videoFps * videoSpeed);

  const renderMergedCanvas = useCallback(() => {
    return mergeVisibleLayersToCanvas(safeWidth, safeHeight, layers, backgroundSettings);
  }, [backgroundSettings, layers, safeHeight, safeWidth]);

  const renderAnimationFrameCanvas = useCallback((timeMs: number) => {
    return renderAnimationCompositeCanvas(
      safeWidth,
      safeHeight,
      layers,
      backgroundSettings,
      animationStrokes,
      timeMs,
    );
  }, [animationStrokes, backgroundSettings, layers, safeHeight, safeWidth]);

  const loadLegacyFrameCanvas = useCallback(async (frame?: AnimationFrame | null) => {
    if (!frame) return null;
    if (frame.snapshot) return frame.snapshot;
    if (!frame.thumbnail) return null;

    const img = await decodeImage(frame.thumbnail);
    const canvas = document.createElement('canvas');
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    canvas.getContext('2d')?.drawImage(img, 0, 0, safeWidth, safeHeight);
    return canvas;
  }, [safeHeight, safeWidth]);

  const exportImage = useCallback(() => {
    setIsExporting(true);
    setExportStatus('Rendering...');
    requestAnimationFrame(() => {
      try {
        const canvas = renderMergedCanvas();
        const mimeType = imageFormat === 'jpeg'
          ? 'image/jpeg'
          : imageFormat === 'webp'
            ? 'image/webp'
            : 'image/png';
        const quality = imageFormat === 'png' ? undefined : 0.92;
        const dataUrl = canvas.toDataURL(mimeType, quality);
        const link = document.createElement('a');
        link.download = `takingnotes_${Date.now()}.${imageFormat}`;
        link.href = dataUrl;
        link.click();
        setExportStatus('Saved!');
      } catch (error: unknown) {
        setExportStatus(`Failed: ${getErrorMessage(error)}`);
      } finally {
        setIsExporting(false);
      }
    });
  }, [imageFormat, renderMergedCanvas]);

  const exportSequence = useCallback(async () => {
    if (frames.length === 0) {
      setExportStatus('No animation frames available yet.');
      return;
    }

    setIsExporting(true);
    try {
      const totalFrames = isEventPlayback
        ? getAnimationSampleCount(eventPlaybackDurationMs, playbackFps)
        : frames.length;

      for (let i = 0; i < totalFrames; i += 1) {
        const frameCanvas = isEventPlayback
          ? renderAnimationFrameCanvas(getAnimationSampleTimeMs(eventPlaybackDurationMs, playbackFps, i))
          : await loadLegacyFrameCanvas(frames[i]);

        if (frameCanvas) {
          const link = document.createElement('a');
          link.download = `frame_${String(i + 1).padStart(4, '0')}.png`;
          link.href = frameCanvas.toDataURL('image/png');
          link.click();
          await sleep(100);
        }

        setExportStatus(`Saved frame ${i + 1}/${totalFrames}`);
        setExportProgress(((i + 1) / totalFrames) * 100);
      }

      setExportStatus(`Done - ${totalFrames} frames saved.`);
    } catch (error: unknown) {
      setExportStatus(`Failed: ${getErrorMessage(error)}`);
    } finally {
      setIsExporting(false);
    }
  }, [
    eventPlaybackDurationMs,
    frames,
    isEventPlayback,
    loadLegacyFrameCanvas,
    playbackFps,
    renderAnimationFrameCanvas,
  ]);

  const exportVideo = useCallback(async () => {
    if (frames.length === 0) {
      setExportStatus('No frames to render. Record some drawing first.');
      return;
    }

    if (typeof MediaRecorder === 'undefined') {
      setExportStatus('MediaRecorder API not available in this browser.');
      return;
    }

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : MediaRecorder.isTypeSupported('video/webm')
          ? 'video/webm'
          : null;

    if (!mimeType) {
      setExportStatus('Browser does not support WebM recording.');
      return;
    }

    setIsExporting(true);
    setExportProgress(0);
    setExportStatus('Preparing render...');
    cancelRef.current = false;

    try {
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = safeWidth;
      renderCanvas.height = safeHeight;
      const ctx = renderCanvas.getContext('2d')!;
      const stream = renderCanvas.captureStream(0);
      const videoTrack = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: Math.max(250_000, Math.round(videoBitrateMbps * 1_000_000)),
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.onstop = () => {
          try {
            resolve(new Blob(chunks, { type: 'video/webm' }));
          } catch (error) {
            reject(error);
          }
        };
        recorder.onerror = (event: Event) => {
          const recorderEvent = event as Event & { error?: unknown };
          reject(recorderEvent.error ?? event);
        };
      });

      recorder.start();

      const totalFrames = isEventPlayback
        ? getAnimationSampleCount(eventPlaybackDurationMs, videoFps, videoSpeed)
        : frames.length;
      const outputDelayMs = isEventPlayback
        ? 1000 / Math.max(1, videoFps)
        : 1000 / Math.max(1, videoFps * videoSpeed);

      for (let i = 0; i < totalFrames; i += 1) {
        if (cancelRef.current) {
          recorder.stop();
          setExportStatus('Export cancelled.');
          setIsExporting(false);
          return;
        }

        ctx.clearRect(0, 0, safeWidth, safeHeight);

        if (isEventPlayback) {
          const rendered = renderAnimationFrameCanvas(
            getAnimationSampleTimeMs(eventPlaybackDurationMs, videoFps, i, videoSpeed),
          );
          ctx.drawImage(rendered, 0, 0, safeWidth, safeHeight);
        } else {
          const frameCanvas = await loadLegacyFrameCanvas(frames[i]);
          if (frameCanvas) {
            ctx.drawImage(frameCanvas, 0, 0, safeWidth, safeHeight);
          } else {
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, safeWidth, safeHeight);
          }
        }

        videoTrack.requestFrame?.();
        await sleep(outputDelayMs);

        const pct = Math.round(((i + 1) / totalFrames) * 100);
        setExportProgress(pct);
        setExportStatus(`Rendering frame ${i + 1}/${totalFrames} (${pct}%)`);
      }

      await sleep(150);
      recorder.stop();

      setExportStatus('Encoding...');
      const blob = await finished;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `takingnotes_${Date.now()}.webm`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);

      const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
      const sizeKB = (blob.size / 1024).toFixed(0);
      const sizeLabel = blob.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`;
      setExportStatus(`Done! ${totalFrames} frames -> ${sizeLabel} at ${safeWidth}x${safeHeight} ${videoFps}fps`);
      setExportProgress(100);
    } catch (error: unknown) {
      if (!cancelRef.current) {
        setExportStatus(`Failed: ${getErrorMessage(error)}`);
      }
    } finally {
      setIsExporting(false);
    }
  }, [
    eventPlaybackDurationMs,
    frames,
    isEventPlayback,
    loadLegacyFrameCanvas,
    renderAnimationFrameCanvas,
    safeHeight,
    safeWidth,
    videoBitrateMbps,
    videoFps,
    videoSpeed,
  ]);

  const handleExport = () => {
    if (mode === 'image') exportImage();
    else if (mode === 'sequence') void exportSequence();
    else void exportVideo();
  };

  const handleCancel = () => {
    if (isExporting) {
      cancelRef.current = true;
    } else {
      onOpenChange(false);
    }
  };

  const commitVideoFps = () => {
    const next = Math.max(1, Math.min(60, Math.round(Number(videoFpsDraft) || videoFps)));
    setVideoFps(next);
    setVideoFpsDraft(String(next));
  };

  const commitVideoBitrate = () => {
    const next = Math.max(0.25, Math.min(100, Number(videoBitrateDraft) || videoBitrateMbps));
    const rounded = Math.round(next * 100) / 100;
    setVideoBitrateMbps(rounded);
    setVideoBitrateDraft(String(rounded));
    setVideoBitrate(bitratePresetFromMbps(rounded));
  };

  return (
    <Dialog open={open} onOpenChange={isExporting ? undefined : onOpenChange}>
      <DialogContent className="max-w-md bg-neutral-900 border-neutral-700 text-neutral-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Export
          </DialogTitle>
          <DialogDescription className="text-neutral-400">
            Save your drawing as an image, frame sequence, or rendered video.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Export As</Label>
            <Select
              value={mode}
              onValueChange={(value) => setMode(value as 'image' | 'sequence' | 'video')}
              disabled={isExporting}
            >
              <SelectTrigger className="bg-neutral-800 border-neutral-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="image">
                  <span className="flex items-center gap-2"><Image className="h-4 w-4" /> Single Image</span>
                </SelectItem>
                <SelectItem value="sequence">
                  <span className="flex items-center gap-2"><Layers className="h-4 w-4" /> Frame Sequence ({sequenceFrameCount})</span>
                </SelectItem>
                <SelectItem value="video">
                  <span className="flex items-center gap-2"><Film className="h-4 w-4" /> Video (.webm)</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Resolution</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={widthDraft}
                onChange={(event) => setWidthDraft(event.target.value)}
                onBlur={() => setWidthDraft(String(safeWidth))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    setWidthDraft(String(safeWidth));
                  }
                }}
                className="bg-neutral-800 border-neutral-700"
                disabled={isExporting}
              />
              <span className="text-neutral-500 text-sm shrink-0">x</span>
              <Input
                type="number"
                value={heightDraft}
                onChange={(event) => setHeightDraft(event.target.value)}
                onBlur={() => setHeightDraft(String(safeHeight))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === 'Escape') {
                    setHeightDraft(String(safeHeight));
                  }
                }}
                className="bg-neutral-800 border-neutral-700"
                disabled={isExporting}
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {[
                { label: 'Canvas', w: canvasSize.width, h: canvasSize.height },
                { label: '720p', w: 1280, h: 720 },
                { label: '1080p', w: 1920, h: 1080 },
                { label: '4K', w: 3840, h: 2160 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    safeWidth === preset.w && safeHeight === preset.h
                      ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                      : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-500'
                  }`}
                  onClick={() => {
                    setWidthDraft(String(preset.w));
                    setHeightDraft(String(preset.h));
                  }}
                  disabled={isExporting}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'image' && (
            <div className="space-y-2">
              <Label>Format</Label>
              <Select
                value={imageFormat}
                onValueChange={(value) => setImageFormat(value as 'png' | 'jpeg' | 'webp')}
              >
                <SelectTrigger className="bg-neutral-800 border-neutral-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="png">PNG (lossless)</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                  <SelectItem value="webp">WebP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'video' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Frame Rate</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      value={videoFpsDraft}
                      onChange={(event) => setVideoFpsDraft(event.target.value)}
                      onBlur={commitVideoFps}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitVideoFps();
                        if (event.key === 'Escape') setVideoFpsDraft(String(videoFps));
                      }}
                      className="h-8 w-20 bg-neutral-800 border-neutral-700 text-right text-xs tabular-nums"
                      disabled={isExporting}
                    />
                    <span className="text-xs text-neutral-400 tabular-nums">fps</span>
                  </div>
                </div>
                <Slider
                  value={[videoFps]}
                  onValueChange={([value]) => setVideoFps(value)}
                  min={1}
                  max={60}
                  step={1}
                  disabled={isExporting}
                />
                <div className="flex gap-1">
                  {[12, 24, 30, 60].map((presetFps) => (
                    <button
                      key={presetFps}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        videoFps === presetFps
                          ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-500'
                      }`}
                      onClick={() => setVideoFps(presetFps)}
                      disabled={isExporting}
                    >
                      {presetFps}fps
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Playback Speed</Label>
                  <span className="text-xs text-neutral-400 tabular-nums">{videoSpeed}x</span>
                </div>
                <Slider
                  value={[videoSpeed]}
                  onValueChange={([value]) => setVideoSpeed(value)}
                  min={0.25}
                  max={4}
                  step={0.25}
                  disabled={isExporting}
                />
                <div className="flex gap-1">
                  {[0.5, 1, 2, 4].map((presetSpeed) => (
                    <button
                      key={presetSpeed}
                      className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                        videoSpeed === presetSpeed
                          ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-500'
                      }`}
                      onClick={() => setVideoSpeed(presetSpeed)}
                      disabled={isExporting}
                    >
                      {presetSpeed}x
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Quality</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={videoBitrate}
                    onValueChange={(value) => {
                      const preset = value as 'low' | 'medium' | 'high';
                      setVideoBitrate(preset);
                      const mbps = BITRATE_MAP[preset] / 1_000_000;
                      setVideoBitrateMbps(mbps);
                      setVideoBitrateDraft(String(mbps));
                    }}
                    disabled={isExporting}
                  >
                    <SelectTrigger className="bg-neutral-800 border-neutral-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low (1 Mbps - small file)</SelectItem>
                      <SelectItem value="medium">Medium (4 Mbps)</SelectItem>
                      <SelectItem value="high">High (10 Mbps - large file)</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0.25}
                      max={100}
                      step={0.25}
                      value={videoBitrateDraft}
                      onChange={(event) => setVideoBitrateDraft(event.target.value)}
                      onBlur={commitVideoBitrate}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitVideoBitrate();
                        if (event.key === 'Escape') setVideoBitrateDraft(String(videoBitrateMbps));
                      }}
                      className="h-8 w-24 bg-neutral-800 border-neutral-700 text-right text-xs tabular-nums"
                      disabled={isExporting}
                    />
                    <span className="text-xs text-neutral-400 tabular-nums">Mbps</span>
                  </div>
                </div>
              </div>

              {frames.length > 0 && (
                <p className="text-xs text-neutral-500">
                  {estimatedVideoFrameCount} frames at {videoFps}fps x {videoSpeed}x {'->'} {estimatedVideoDurationSeconds.toFixed(1)}s video
                </p>
              )}
            </>
          )}

          {(mode === 'sequence' || mode === 'video') && frames.length === 0 && (
            <p className="text-xs text-amber-400">
              No animation frames yet. Draw or import timed strokes first.
            </p>
          )}

          {isExporting && (
            <div className="space-y-1">
              <Progress value={exportProgress} className="h-2" />
            </div>
          )}

          {exportStatus && (
            <p className="text-xs text-neutral-400">{exportStatus}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={handleCancel}>
            {isExporting ? 'Cancel' : 'Close'}
          </Button>
          <Button
            onClick={handleExport}
            disabled={
              isExporting ||
              (mode === 'image' && layers.length === 0) ||
              ((mode === 'sequence' || mode === 'video') && frames.length === 0)
            }
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isExporting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Rendering...</>
            ) : mode === 'video' ? (
              <><Film className="h-4 w-4 mr-2" /> Render Video</>
            ) : (
              <><Download className="h-4 w-4 mr-2" /> Export</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
