import React, { useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { HexAlphaColorPicker } from 'react-colorful';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import type { BackgroundPattern, BackgroundSettings } from '@/types';

interface CanvasSettingsPanelProps {
  settings: BackgroundSettings;
  onSettingsChange: (settings: BackgroundSettings) => void;
  hideTitle?: boolean;
}

const ASPECT_PRESETS = [
  { label: 'Free', value: 'free', width: null, height: null },
  { label: '1:1', value: '1:1', width: 1024, height: 1024 },
  { label: '4:3', value: '4:3', width: 800, height: 600 },
  { label: '16:9', value: '16:9', width: 1280, height: 720 },
  { label: 'A4', value: 'a4', width: 1240, height: 1754 },
];

const PATTERNS: BackgroundPattern[] = ['solid', 'ruled', 'dots', 'grid', 'graph', 'checker'];

/** One-click notebook-style presets that set pattern + colors together. */
const NOTEBOOK_PRESETS: { label: string; icon: string; settings: Partial<BackgroundSettings> }[] = [
  {
    label: 'Blank',
    icon: '◻',
    settings: { pattern: 'solid', primaryColor: '#c8d0dc', secondaryColor: '#ffffff', pixelSize: 24, transparent: false },
  },
  {
    label: 'Lined',
    icon: '☰',
    settings: { pattern: 'ruled', primaryColor: '#b8c4d8', secondaryColor: '#ffffff', pixelSize: 28, transparent: false },
  },
  {
    label: 'Dot Grid',
    icon: '⁙',
    settings: { pattern: 'dots', primaryColor: '#a0aec0', secondaryColor: '#ffffff', pixelSize: 24, transparent: false },
  },
  {
    label: 'Square Grid',
    icon: '▦',
    settings: { pattern: 'grid', primaryColor: '#c8d0dc', secondaryColor: '#ffffff', pixelSize: 24, transparent: false },
  },
  {
    label: 'Graph',
    icon: '▩',
    settings: { pattern: 'graph', primaryColor: '#6ea8c8', secondaryColor: '#ffffff', pixelSize: 16, transparent: false },
  },
  {
    label: 'Dark',
    icon: '■',
    settings: { pattern: 'solid', primaryColor: '#2f3542', secondaryColor: '#20242c', pixelSize: 16, transparent: false },
  },
  {
    label: 'Transparent',
    icon: '▧',
    settings: { transparent: true },
  },
];

export function CanvasSettingsPanel({ settings, onSettingsChange, hideTitle = false }: CanvasSettingsPanelProps) {
  const update = <K extends keyof BackgroundSettings>(key: K, value: BackgroundSettings[K]) => {
    onSettingsChange({ ...settings, [key]: value });
  };
  const updateMany = (updates: Partial<BackgroundSettings>) => {
    onSettingsChange({ ...settings, ...updates });
  };
  const updateHexColor = (key: 'primaryColor' | 'secondaryColor', value: string) => {
    if (/^#[0-9a-fA-F]{0,8}$/.test(value)) {
      update(key, value);
    }
  };
  const updateAlpha = (key: 'primaryColor' | 'secondaryColor', alphaPercent: number) => {
    const normalized = Math.max(0, Math.min(100, Math.round(alphaPercent)));
    const rgb = stripHexAlpha(settings[key]);
    update(key, `${rgb}${alphaPercentToHex(normalized)}`);
  };

  const applyAspect = (presetValue: string) => {
    const preset = ASPECT_PRESETS.find((item) => item.value === presetValue);
    if (!preset) return;
    onSettingsChange({
      ...settings,
      aspectPreset: preset.value,
      width: preset.width ?? settings.width,
      height: preset.height ?? settings.height,
    });
  };

  const applyNotebookPreset = (preset: typeof NOTEBOOK_PRESETS[number]) => {
    onSettingsChange({ ...settings, ...preset.settings });
  };

  // Local draft state for width/height so resizeCanvas only fires on blur/Enter,
  // not on every keystroke (which would destroy undo history and rescale layers repeatedly).
  // Uses React's "adjust state during render" pattern instead of useEffect+setState.
  const [draftWidth, setDraftWidth] = useState(String(settings.width));
  const [draftHeight, setDraftHeight] = useState(String(settings.height));
  const [prevWidth, setPrevWidth] = useState(settings.width);
  const [prevHeight, setPrevHeight] = useState(settings.height);

  if (settings.width !== prevWidth) {
    setPrevWidth(settings.width);
    setDraftWidth(String(settings.width));
  }
  if (settings.height !== prevHeight) {
    setPrevHeight(settings.height);
    setDraftHeight(String(settings.height));
  }

  const commitWidth = () => {
    const v = Math.max(64, Math.min(8192, Math.round(Number(draftWidth) || 64)));
    setDraftWidth(String(v));
    if (v !== settings.width) update('width', v);
  };
  const commitHeight = () => {
    const v = Math.max(64, Math.min(8192, Math.round(Number(draftHeight) || 64)));
    setDraftHeight(String(v));
    if (v !== settings.height) update('height', v);
  };
  const previewDragRef = useRef<{ startX: number; startY: number; startOffsetX: number; startOffsetY: number } | null>(null);

  return (
    <div className="space-y-5">
      {!hideTitle && <h3 className="text-sm font-medium">Canvas & Background</h3>}

      <div className="space-y-3">
        <Label className="text-sm">Canvas Size</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-neutral-400">Width</Label>
            <Input
              type="number"
              min={64}
              max={8192}
              step={1}
              value={draftWidth}
              onChange={(e) => setDraftWidth(e.target.value)}
              onBlur={commitWidth}
              onKeyDown={(e) => { if (e.key === 'Enter') commitWidth(); }}
              className="h-8 bg-neutral-900 border-neutral-600"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-neutral-400">Height</Label>
            <Input
              type="number"
              min={64}
              max={8192}
              step={1}
              value={draftHeight}
              onChange={(e) => setDraftHeight(e.target.value)}
              onBlur={commitHeight}
              onKeyDown={(e) => { if (e.key === 'Enter') commitHeight(); }}
              className="h-8 bg-neutral-900 border-neutral-600"
            />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {ASPECT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={`px-2 py-2 rounded text-xs transition-colors ${settings.aspectPreset === preset.value ? 'bg-blue-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
              onClick={() => applyAspect(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Notebook-style quick presets */}
      <div className="space-y-2">
        <Label className="text-sm">Background Preset</Label>
        <div className="grid grid-cols-3 gap-2">
          {NOTEBOOK_PRESETS.map((preset) => {
            const isActive =
              preset.settings.pattern === settings.pattern &&
              preset.settings.secondaryColor === settings.secondaryColor;
            return (
              <button
                key={preset.label}
                type="button"
                className={`flex flex-col items-center gap-0.5 px-2 py-2 rounded text-xs transition-colors ${isActive ? 'bg-blue-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
                onClick={() => applyNotebookPreset(preset)}
              >
                <span className="text-base leading-none">{preset.icon}</span>
                <span>{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Line / Grid Spacing</Label>
          <span className="text-xs text-neutral-400">{settings.pixelSize}px</span>
        </div>
        <Slider
          value={[settings.pixelSize]}
          onValueChange={([v]) => update('pixelSize', v)}
          min={2}
          max={64}
          step={1}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Pattern</Label>
        <div className="grid grid-cols-2 gap-2">
          {PATTERNS.map((pattern) => (
            <button
              key={pattern}
              type="button"
              className={`px-3 py-2 rounded text-sm capitalize transition-colors ${settings.pattern === pattern ? 'bg-blue-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
              onClick={() => update('pattern', pattern)}
            >
              {pattern}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-neutral-400">Primary (lines)</Label>
          <div className="flex items-center gap-2">
            <ColorPopoverButton
              value={settings.primaryColor}
              onChange={(value) => updateHexColor('primaryColor', value)}
            />
            <Input
              value={settings.primaryColor}
              onChange={(e) => updateHexColor('primaryColor', e.target.value)}
              className="h-8 bg-neutral-900 border-neutral-600 text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Slider
              value={[getAlphaPercent(settings.primaryColor)]}
              onValueChange={([v]) => updateAlpha('primaryColor', v)}
              min={0}
              max={100}
              step={1}
              className="flex-1"
            />
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={String(getAlphaPercent(settings.primaryColor))}
              onChange={(e) => updateAlpha('primaryColor', Number(e.target.value) || 0)}
              className="h-8 w-16 bg-neutral-900 border-neutral-600 text-right text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-neutral-400">Background</Label>
          <div className="flex items-center gap-2">
            <ColorPopoverButton
              value={settings.secondaryColor}
              onChange={(value) => updateHexColor('secondaryColor', value)}
              disabled={settings.transparent}
            />
            <Input
              value={settings.secondaryColor}
              onChange={(e) => updateHexColor('secondaryColor', e.target.value)}
              className="h-8 bg-neutral-900 border-neutral-600 text-xs"
              disabled={settings.transparent}
            />
          </div>
          <div className="flex items-center gap-2">
            <Slider
              value={[getAlphaPercent(settings.secondaryColor)]}
              onValueChange={([v]) => updateAlpha('secondaryColor', v)}
              min={0}
              max={100}
              step={1}
              className="flex-1"
              disabled={settings.transparent}
            />
            <Input
              type="number"
              min={0}
              max={100}
              step={1}
              value={String(getAlphaPercent(settings.secondaryColor))}
              onChange={(e) => updateAlpha('secondaryColor', Number(e.target.value) || 0)}
              className="h-8 w-16 bg-neutral-900 border-neutral-600 text-right text-xs"
              disabled={settings.transparent}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Background Fill</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded text-sm transition-colors ${!settings.transparent ? 'bg-blue-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
            onClick={() => update('transparent', false)}
          >
            Opaque
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded text-sm transition-colors ${settings.transparent ? 'bg-blue-600 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300'}`}
            onClick={() => update('transparent', true)}
          >
            Transparent
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Preview</Label>
        <div
          className="h-24 rounded-lg border border-neutral-700 cursor-grab active:cursor-grabbing"
          style={{ ...getPreviewStyle(settings), touchAction: 'none', userSelect: 'none' }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = e.currentTarget;
            previewDragRef.current = {
              startX: e.clientX,
              startY: e.clientY,
              startOffsetX: settings.patternOffsetX,
              startOffsetY: settings.patternOffsetY,
            };
            target.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const drag = previewDragRef.current;
            if (!drag) return;
            e.preventDefault();
            e.stopPropagation();
            updateMany({
              patternOffsetX: drag.startOffsetX + (e.clientX - drag.startX),
              patternOffsetY: drag.startOffsetY + (e.clientY - drag.startY),
            });
          }}
          onPointerUp={(e) => {
            e.preventDefault();
            previewDragRef.current = null;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={(e) => {
            previewDragRef.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-neutral-400">Offset X</Label>
            <Input
              type="number"
              step={1}
              value={String(Math.round(settings.patternOffsetX))}
              onChange={(e) => update('patternOffsetX', Number(e.target.value) || 0)}
              className="h-8 bg-neutral-900 border-neutral-600 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-neutral-400">Offset Y</Label>
            <Input
              type="number"
              step={1}
              value={String(Math.round(settings.patternOffsetY))}
              onChange={(e) => update('patternOffsetY', Number(e.target.value) || 0)}
              className="h-8 bg-neutral-900 border-neutral-600 text-xs"
            />
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] text-neutral-500">
          <span>Drag or edit X/Y to move pattern</span>
          <button
            type="button"
            className="rounded px-2 py-1 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
            onClick={() => {
              updateMany({ patternOffsetX: 0, patternOffsetY: 0 });
            }}
          >
            Reset Offset
          </button>
        </div>
      </div>
    </div>
  );
}

/** Produce the same CSS properties as CanvasEngine's getBackgroundStyle so the preview is accurate */
function getPreviewStyle(settings: BackgroundSettings): React.CSSProperties {
  const size = Math.max(2, settings.pixelSize);
  const p = settings.primaryColor;
  const s = settings.secondaryColor;
  const loopSize = settings.pattern === 'checker' ? size * 2 : settings.pattern === 'graph' ? size * 5 : size;
  const offsetX = normalizePatternOffset(settings.patternOffsetX || 0, loopSize);
  const offsetY = normalizePatternOffset(settings.patternOffsetY || 0, loopSize);

  if (settings.transparent) {
    return {
      backgroundColor: '#2a2a2a',
      backgroundImage: 'linear-gradient(45deg, #3a3a3a 25%, transparent 25%), linear-gradient(-45deg, #3a3a3a 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #3a3a3a 75%), linear-gradient(-45deg, transparent 75%, #3a3a3a 75%)',
      backgroundSize: '24px 24px',
      backgroundPosition: '0 0, 0 12px, 12px -12px, -12px 0px',
    };
  }

  switch (settings.pattern) {
    case 'solid':
      return { backgroundColor: s };
    case 'ruled':
      return {
        backgroundColor: s,
        backgroundImage: `linear-gradient(${p} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
    case 'dots':
      return {
        backgroundColor: s,
        backgroundImage: `radial-gradient(circle at center, ${p} 18%, transparent 20%)`,
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
    case 'grid':
      return {
        backgroundColor: s,
        backgroundImage: `linear-gradient(${p} 1px, transparent 1px), linear-gradient(90deg, ${p} 1px, transparent 1px)`,
        backgroundSize: `${size}px ${size}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px`,
      };
    case 'graph':
      return {
        backgroundColor: s,
        backgroundImage: `linear-gradient(${withPreviewColorAlpha(p, 0.45)} 1px, transparent 1px), linear-gradient(90deg, ${withPreviewColorAlpha(p, 0.45)} 1px, transparent 1px), linear-gradient(${withPreviewColorAlpha(p, 0.85)} 2px, transparent 2px), linear-gradient(90deg, ${withPreviewColorAlpha(p, 0.85)} 2px, transparent 2px)`,
        backgroundSize: `${size}px ${size}px, ${size}px ${size}px, ${size * 5}px ${size * 5}px, ${size * 5}px ${size * 5}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY}px`,
      };
    case 'checker':
      return {
        backgroundColor: s,
        backgroundImage: `linear-gradient(45deg, ${p} 25%, transparent 25%), linear-gradient(-45deg, ${p} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${p} 75%), linear-gradient(-45deg, transparent 75%, ${p} 75%)`,
        backgroundSize: `${size * 2}px ${size * 2}px`,
        backgroundPosition: `${offsetX}px ${offsetY}px, ${offsetX}px ${offsetY + size}px, ${offsetX + size}px ${offsetY - size}px, ${offsetX - size}px ${offsetY}px`,
      };
    default:
      return { backgroundColor: s };
  }
}

function stripHexAlpha(value: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(normalized)) {
    return normalized.slice(0, 7);
  }
  if (/^#[0-9a-fA-F]{4}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  return normalizeRgbHex(normalized);
}

function normalizeRgbHex(value: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return normalized;
  }
  if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }
  return '#000000';
}

function getHexAlpha(value: string): string {
  const normalized = value.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(normalized)) {
    return normalized.slice(7, 9);
  }
  if (/^#[0-9a-fA-F]{4}$/.test(normalized)) {
    return `${normalized[4]}${normalized[4]}`;
  }
  return 'ff';
}

function getAlphaPercent(value: string): number {
  return Math.round((parseInt(getHexAlpha(value), 16) / 255) * 100);
}

function alphaPercentToHex(value: number): string {
  return Math.round((value / 100) * 255).toString(16).padStart(2, '0');
}

function ColorPopoverButton({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const normalized = normalizeHexWithAlpha(value);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="relative h-8 w-10 shrink-0 overflow-hidden rounded border border-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Choose color with alpha"
        >
          <div className="absolute inset-0 bg-[linear-gradient(45deg,#555_25%,transparent_25%),linear-gradient(-45deg,#555_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#555_75%),linear-gradient(-45deg,transparent_75%,#555_75%)] bg-[length:10px_10px] bg-[position:0_0,0_5px,5px_-5px,-5px_0px]" />
          <div className="absolute inset-1 rounded-sm border border-black/20" style={{ backgroundColor: normalized }} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={8}
          align="start"
          className="z-50 w-64 rounded-xl border border-neutral-700 bg-neutral-900 p-3 shadow-2xl"
        >
          <div className="space-y-3">
            <HexAlphaColorPicker color={normalized} onChange={onChange} />
            <div className="flex items-center gap-2">
              <div
                className="h-8 w-8 shrink-0 rounded-full border border-white/10 shadow-inner"
                style={{ backgroundColor: normalized }}
              />
              <Input
                value={normalized}
                onChange={(e) => {
                  if (/^#[0-9a-fA-F]{0,8}$/.test(e.target.value)) {
                    onChange(e.target.value);
                  }
                }}
                className="h-8 bg-neutral-950 border-neutral-700 text-xs"
              />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(['R', 'G', 'B', 'A'] as const).map((channel) => (
                <div key={channel} className="space-y-1">
                  <Input
                    type="number"
                    min={0}
                    max={255}
                    step={1}
                    value={String(getChannelValue(normalized, channel))}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const next = raw === '' ? 0 : Number(raw);
                      onChange(setChannelValue(normalized, channel, next));
                    }}
                    className="h-8 bg-neutral-950 border-neutral-700 px-2 text-center text-xs"
                  />
                  <div className="text-center text-[10px] uppercase tracking-[0.08em] text-neutral-500">
                    {channel}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function normalizeHexWithAlpha(value: string): string {
  return `${stripHexAlpha(value)}${getHexAlpha(value)}`;
}

function getChannelValue(value: string, channel: 'R' | 'G' | 'B' | 'A'): number {
  const normalized = normalizeHexWithAlpha(value).slice(1);
  const offset = channel === 'R' ? 0 : channel === 'G' ? 2 : channel === 'B' ? 4 : 6;
  return parseInt(normalized.slice(offset, offset + 2), 16);
}

function setChannelValue(value: string, channel: 'R' | 'G' | 'B' | 'A', next: number): string {
  const normalized = normalizeHexWithAlpha(value).slice(1);
  const safe = Math.max(0, Math.min(255, Math.round(Number.isFinite(next) ? next : 0)))
    .toString(16)
    .padStart(2, '0');

  const channels = {
    r: normalized.slice(0, 2),
    g: normalized.slice(2, 4),
    b: normalized.slice(4, 6),
    a: normalized.slice(6, 8),
  };

  if (channel === 'R') channels.r = safe;
  if (channel === 'G') channels.g = safe;
  if (channel === 'B') channels.b = safe;
  if (channel === 'A') channels.a = safe;

  return `#${channels.r}${channels.g}${channels.b}${channels.a}`;
}

function withPreviewColorAlpha(hex: string, alpha: number): string {
  const normalized = normalizeHexWithAlpha(hex).slice(1);
  const r = parseInt(normalized.slice(0, 2), 16) || 0;
  const g = parseInt(normalized.slice(2, 4), 16) || 0;
  const b = parseInt(normalized.slice(4, 6), 16) || 0;
  const baseAlpha = (parseInt(normalized.slice(6, 8), 16) || 255) / 255;
  return `rgba(${r}, ${g}, ${b}, ${baseAlpha * alpha})`;
}

function normalizePatternOffset(value: number, period: number): number {
  if (!Number.isFinite(value) || period <= 0) return 0;
  return ((value % period) + period) % period;
}
