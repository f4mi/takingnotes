import { Play, Pause, SkipBack, SkipForward, Trash2, Copy, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import type { AnimationFrame } from '@/types';

interface AnimationTimelineProps {
  frames: AnimationFrame[];
  currentFrame: number;
  isPlaying: boolean;
  onPlayToggle: () => void;
  onFrameSelect: (frameIndex: number) => void;
  onFramesChange?: (frames: AnimationFrame[]) => void;
  isEditable?: boolean;
}

function cloneCanvas(source?: HTMLCanvasElement): HTMLCanvasElement | undefined {
  if (!source) return undefined;
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d')?.drawImage(source, 0, 0);
  return copy;
}

export function AnimationTimeline({
  frames,
  currentFrame,
  isPlaying,
  onPlayToggle,
  onFrameSelect,
  onFramesChange,
  isEditable = true,
}: AnimationTimelineProps) {

  const handleDeleteFrame = (index: number) => {
    if (!onFramesChange) return;
    const newFrames = frames
      .filter((_, i) => i !== index)
      .map((frame, i) => ({ ...frame, frameNumber: i + 1 }));
    onFramesChange(newFrames);
    if (currentFrame >= newFrames.length) {
      onFrameSelect(Math.max(0, newFrames.length - 1));
    }
  };

  const handleDuplicateFrame = (index: number) => {
    if (!onFramesChange) return;
    const frameToDuplicate = frames[index];
    const newFrame: AnimationFrame = {
      ...frameToDuplicate,
      id: crypto.randomUUID(),
      frameNumber: index + 1,
      strokes: frameToDuplicate.strokes.map((stroke) => ({
        ...stroke,
        points: stroke.points.map((point) => ({ ...point })),
      })),
      snapshot: cloneCanvas(frameToDuplicate.snapshot),
    };
    const newFrames = [...frames];
    newFrames.splice(index + 1, 0, newFrame);
    // Return new objects with renumbered frameNumber
    onFramesChange(newFrames.map((frame, i) => ({ ...frame, frameNumber: i + 1 })));
  };

  const totalDuration = frames.reduce((sum, f) => sum + f.duration, 0);

  return (
    <div className="h-48 bg-neutral-900 border-t border-neutral-700 flex flex-col">
      {/* Timeline Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-neutral-800 border-b border-neutral-700">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => onFrameSelect(0)}
            >
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onPlayToggle}
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => frames.length > 0 && onFrameSelect(frames.length - 1)}
            >
              <SkipForward className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <Film className="h-4 w-4" />
            <span>Frame {currentFrame + 1} of {frames.length}</span>
            <span>•</span>
            <span>{(totalDuration / 1000).toFixed(2)}s total</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400">Timeline Zoom</span>
          <Slider
            defaultValue={[100]}
            min={50}
            max={200}
            step={10}
            className="w-24"
          />
        </div>
      </div>

      {/* Timeline Frames */}
      <ScrollArea className="flex-1">
        <div className="flex gap-1 p-2 min-w-max">
          {frames.map((frame, index) => (
            <div
              key={frame.id}
              className={`
                relative group flex flex-col items-center gap-1 p-2 rounded-lg border min-w-[80px]
                transition-colors cursor-pointer
                ${index === currentFrame
                  ? 'bg-blue-600/20 border-blue-500'
                  : 'bg-neutral-800 border-neutral-700 hover:border-neutral-600'
                }
              `}
              onClick={() => onFrameSelect(index)}
            >
              {/* Frame Number */}
              <span className="text-xs text-neutral-500">{index + 1}</span>

              {/* Frame Thumbnail */}
              <div className="w-16 h-12 bg-neutral-900 rounded border border-neutral-700 flex items-center justify-center overflow-hidden">
                {frame.thumbnail ? (
                  <img
                    src={frame.thumbnail}
                    alt={`Frame ${index + 1}`}
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <Film className="h-4 w-4 text-neutral-600" />
                )}
              </div>

              {/* Frame Duration */}
              <span className="text-xs text-neutral-400">
                {(frame.duration / 1000).toFixed(2)}s
              </span>

              {/* Frame Actions */}
              {isEditable && onFramesChange && (
                <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 bg-neutral-800 hover:bg-blue-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDuplicateFrame(index);
                    }}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 bg-neutral-800 hover:bg-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFrame(index);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              )}

              {/* Onion Skin Indicator */}
              {index === currentFrame - 1 && (
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500/50 rounded-l" />
              )}
              {index === currentFrame + 1 && (
                <div className="absolute right-0 top-0 bottom-0 w-1 bg-green-500/50 rounded-r" />
              )}
            </div>
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>

      {/* Playback Progress */}
      <div className="px-4 py-2 bg-neutral-800 border-t border-neutral-700">
        <Slider
          value={[currentFrame]}
          onValueChange={([v]) => onFrameSelect(v)}
          min={0}
          max={Math.max(0, frames.length - 1)}
          step={1}
          className="w-full"
        />
      </div>
    </div>
  );
}
