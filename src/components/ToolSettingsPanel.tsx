import { useEffect, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { ToolType, ToolSettings } from '@/types';

interface ToolSettingsPanelProps {
  tool: ToolType;
  settings: ToolSettings;
  onSettingsChange: (settings: ToolSettings) => void;
}

export function ToolSettingsPanel({ tool, settings, onSettingsChange }: ToolSettingsPanelProps) {
  const updateSetting = <K extends keyof ToolSettings>(
    key: K,
    value: ToolSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const renderBrushSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Size</Label>
          <NumberDraftInput
            value={settings.size}
            onCommit={(value) => updateSetting('size', value)}
            className="h-8 w-20 bg-neutral-900 text-right text-sm border-neutral-600"
            min={1}
            max={1000}
          />
        </div>
        <Slider
          value={[settings.size]}
          onValueChange={([v]) => updateSetting('size', v)}
          min={1}
          max={200}
          step={1}
        />
        <div className="flex gap-1 flex-wrap">
          {[1, 2, 5, 10, 20, 40, 80].map(s => (
            <button
              key={s}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${settings.size === s ? 'bg-blue-600/30 border-blue-500 text-blue-300' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:border-neutral-500'}`}
              onClick={() => updateSetting('size', s)}
            >{s}</button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Opacity</Label>
          <span className="text-xs text-neutral-400">{settings.opacity}%</span>
        </div>
        <Slider
          value={[settings.opacity]}
          onValueChange={([v]) => updateSetting('opacity', v)}
          min={1}
          max={100}
          step={1}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Hardness</Label>
          <span className="text-xs text-neutral-400">{settings.hardness}%</span>
        </div>
        <Slider
          value={[settings.hardness]}
          onValueChange={([v]) => updateSetting('hardness', v)}
          min={0}
          max={100}
          step={1}
        />
        <div className="flex justify-between text-xs text-neutral-500">
          <span>Soft</span>
          <span>Hard</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Spacing</Label>
          <span className="text-xs text-neutral-400">{settings.spacing}%</span>
        </div>
        <Slider
          value={[settings.spacing]}
          onValueChange={([v]) => updateSetting('spacing', v)}
          min={1}
          max={100}
          step={1}
        />
      </div>

      {/* Brush Preview */}
      <div className="space-y-2">
        <Label className="text-sm">Preview</Label>
        <div className="h-24 bg-neutral-900 rounded-lg border border-neutral-700 flex items-center justify-center">
          <div
            className="rounded-full"
            style={{
              width: Math.min(settings.size, 80),
              height: Math.min(settings.size, 80),
              backgroundColor: settings.color,
              opacity: settings.opacity / 100,
              filter: `blur(${(100 - settings.hardness) / 10}px)`
            }}
          />
        </div>
      </div>
    </div>
  );

  const renderEraserSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Size</Label>
          <NumberDraftInput
            value={settings.size}
            onCommit={(value) => updateSetting('size', value)}
            className="h-8 w-20 bg-neutral-900 text-right text-sm border-neutral-600"
            min={1}
            max={1000}
          />
        </div>
        <Slider
          value={[settings.size]}
          onValueChange={([v]) => updateSetting('size', v)}
          min={1}
          max={200}
          step={1}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Hardness</Label>
          <span className="text-xs text-neutral-400">{settings.hardness}%</span>
        </div>
        <Slider
          value={[settings.hardness]}
          onValueChange={([v]) => updateSetting('hardness', v)}
          min={0}
          max={100}
          step={1}
        />
      </div>

      {/* Eraser Preview */}
      <div className="space-y-2">
        <Label className="text-sm">Preview</Label>
        <div className="h-24 bg-neutral-900 rounded-lg border border-neutral-700 flex items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-20">
            <div className="w-full h-full bg-gradient-to-br from-blue-500 to-purple-500" />
          </div>
          <div
            className="rounded-full border-2 border-white/50 relative z-10"
            style={{
              width: Math.min(settings.size, 80),
              height: Math.min(settings.size, 80),
              backgroundColor: 'transparent',
              filter: `blur(${(100 - settings.hardness) / 10}px)`
            }}
          />
        </div>
      </div>
    </div>
  );

  const renderShapeSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label className="text-sm">Mode</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded text-sm transition-colors ${!settings.shapeFilled ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            onClick={() => updateSetting('shapeFilled', false)}
          >
            Stroke
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded text-sm transition-colors ${settings.shapeFilled ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            onClick={() => updateSetting('shapeFilled', true)}
          >
            Fill
          </button>
        </div>
        <p className="text-xs text-neutral-500">Hold Shift to constrain (square / 45° lines)</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">{settings.shapeFilled ? 'Size (ignored)' : 'Stroke Width'}</Label>
          <NumberDraftInput
            value={settings.size}
            onCommit={(value) => updateSetting('size', value)}
            className="h-8 w-20 bg-neutral-900 text-right text-sm border-neutral-600"
            min={1}
            max={100}
          />
        </div>
        <Slider
          value={[settings.size]}
          onValueChange={([v]) => updateSetting('size', v)}
          min={1}
          max={50}
          step={1}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Opacity</Label>
          <span className="text-xs text-neutral-400">{settings.opacity}%</span>
        </div>
        <Slider
          value={[settings.opacity]}
          onValueChange={([v]) => updateSetting('opacity', v)}
          min={1}
          max={100}
          step={1}
        />
      </div>
    </div>
  );

  const renderFillSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Tolerance</Label>
          <span className="text-xs text-neutral-400">{settings.fillTolerance}</span>
        </div>
        <Slider
          value={[settings.fillTolerance]}
          onValueChange={([v]) => updateSetting('fillTolerance', v)}
          min={0}
          max={255}
          step={1}
        />
        <p className="text-xs text-neutral-500">
          Higher tolerance fills more similar colors
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Mode</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className={`px-3 py-2 rounded text-sm transition-colors ${!settings.fillContiguous ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            onClick={() => updateSetting('fillContiguous', false)}
          >
            All Pixels
          </button>
          <button
            type="button"
            className={`px-3 py-2 rounded text-sm transition-colors ${settings.fillContiguous ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
            onClick={() => updateSetting('fillContiguous', true)}
          >
            Contiguous
          </button>
        </div>
      </div>
    </div>
  );

  const getToolTitle = () => {
    switch (tool) {
      case 'brush': return 'Brush Settings';
      case 'eraser': return 'Eraser Settings';
      case 'line': return 'Line Settings';
      case 'rectangle': return 'Rectangle Settings';
      case 'circle': return 'Circle Settings';
      case 'fill': return 'Fill Settings';
      case 'eyedropper': return 'Eyedropper';
      case 'smudge': return 'Smudge Tool';
      case 'move': return 'Move Tool';
      case 'gradient': return 'Gradient Tool';
      case 'text': return 'Text Settings';
      case 'select': return 'Select Tool';
      default: return 'Tool Settings';
    }
  };

  const renderTextSettings = () => (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Font Size</Label>
          <NumberDraftInput
            value={settings.size * 4}
            onCommit={(value) => updateSetting('size', Math.max(1, value / 4))}
            className="h-8 w-20 bg-neutral-900 text-right text-sm border-neutral-600"
            min={8}
            max={200}
          />
        </div>
        <Slider
          value={[settings.size]}
          onValueChange={([v]) => updateSetting('size', v)}
          min={2}
          max={50}
          step={1}
        />
        <div className="flex justify-between text-xs text-neutral-500">
          <span>8px</span>
          <span>200px</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Opacity</Label>
          <span className="text-xs text-neutral-400">{settings.opacity}%</span>
        </div>
        <Slider
          value={[settings.opacity]}
          onValueChange={([v]) => updateSetting('opacity', v)}
          min={1}
          max={100}
          step={1}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Font</Label>
        <select
          value={settings.fontFamily}
          onChange={() => updateSetting('fontFamily', '"TASA Orbiter", sans-serif')}
          className="w-full h-8 text-xs bg-neutral-900 border border-neutral-600 rounded text-neutral-200 px-2"
        >
          <option value={'"TASA Orbiter", sans-serif'}>TASA Orbiter</option>
        </select>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">How to use</Label>
        <p className="text-xs text-neutral-500">
          Click on the canvas to place text. Type your text and press Enter to commit, or Shift+Enter for a new line. Press Escape to cancel.
        </p>
      </div>
    </div>
  );

  const renderSelectInfo = () => (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500">
        Click and drag to create a rectangular selection (marching ants).
      </p>
      <div className="space-y-1 text-xs text-neutral-500">
        <p><span className="text-neutral-400 font-mono">Delete</span> — Clear selection area</p>
        <p><span className="text-neutral-400 font-mono">Ctrl+C</span> — Copy selection</p>
        <p><span className="text-neutral-400 font-mono">Ctrl+X</span> — Cut selection</p>
        <p><span className="text-neutral-400 font-mono">Ctrl+A</span> — Select all</p>
        <p><span className="text-neutral-400 font-mono">Ctrl+D</span> — Deselect</p>
      </div>
    </div>
  );

  const getToolSettings = () => {
    switch (tool) {
      case 'brush':
        return renderBrushSettings();
      case 'eraser':
        return renderEraserSettings();
      case 'line':
      case 'rectangle':
      case 'circle':
        return renderShapeSettings();
      case 'fill':
        return renderFillSettings();
      case 'eyedropper':
        return (
          <div className="space-y-4">
            <p className="text-xs text-neutral-500">
              Click on the canvas to sample a color. You can also Alt+click with any brush tool.
            </p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded border border-neutral-600" style={{ backgroundColor: settings.color }} />
              <span className="text-sm font-mono text-neutral-300">{settings.color}</span>
            </div>
          </div>
        );
      case 'smudge':
        return (
          <div className="space-y-6">
            <p className="text-xs text-neutral-500">
              Click and drag to smudge/blur pixels under the cursor. Useful for blending colors and softening edges.
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Size</Label>
                <NumberDraftInput
                  value={settings.size}
                  onCommit={(value) => updateSetting('size', value)}
                  className="h-8 w-20 bg-neutral-900 text-right text-sm border-neutral-600"
                  min={4}
                  max={200}
                />
              </div>
              <Slider
                value={[settings.size]}
                onValueChange={([v]) => updateSetting('size', v)}
                min={4}
                max={100}
                step={1}
              />
            </div>
          </div>
        );
      case 'move':
        return (
          <div className="space-y-4">
            <p className="text-xs text-neutral-500">
              Click and drag on the canvas to move the active layer's content. Supports undo.
            </p>
          </div>
        );
      case 'gradient':
        return (
          <div className="space-y-6">
            <p className="text-xs text-neutral-500">
              Click and drag to draw a gradient from foreground to background color.
              X to swap colors, D to reset.
            </p>
            <div className="space-y-2">
              <Label className="text-sm">Type</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`px-3 py-2 rounded text-sm transition-colors ${settings.gradientType === 'linear' ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
                  onClick={() => updateSetting('gradientType', 'linear')}
                >
                  Linear
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 rounded text-sm transition-colors ${settings.gradientType === 'radial' ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
                  onClick={() => updateSetting('gradientType', 'radial')}
                >
                  Radial
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Opacity</Label>
                <span className="text-xs text-neutral-400">{settings.opacity}%</span>
              </div>
              <Slider
                value={[settings.opacity]}
                onValueChange={([v]) => updateSetting('opacity', v)}
                min={1}
                max={100}
                step={1}
              />
            </div>
          </div>
        );
      case 'text':
        return renderTextSettings();
      case 'select':
        return renderSelectInfo();
      default:
        return (
          <p className="text-sm text-neutral-500 text-center py-8">
            Select a tool to view its settings
          </p>
        );
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium">{getToolTitle()}</h3>
      {getToolSettings()}
    </div>
  );
}

function NumberDraftInput({
  value,
  onCommit,
  min,
  max,
  step = 1,
  className,
}: {
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const fallback = Number.isFinite(value) ? value : (min ?? 0);
    let next = Number(draft);
    if (!Number.isFinite(next)) {
      next = fallback;
    }
    if (typeof min === 'number') next = Math.max(min, next);
    if (typeof max === 'number') next = Math.min(max, next);
    if (step >= 1) next = Math.round(next);
    setDraft(String(next));
    if (next !== value) {
      onCommit(next);
    }
  };

  return (
    <Input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(String(value));
      }}
      className={className}
      min={min}
      max={max}
      step={step}
    />
  );
}
