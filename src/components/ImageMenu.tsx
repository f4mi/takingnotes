import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

export type ImageAction = 'invert' | 'desaturate' | 'blur' | 'sharpen' | 'flip-h' | 'flip-v' | 'brightness-up' | 'brightness-down' | 'contrast-up' | 'contrast-down' | 'crop-to-selection' | 'rotate-cw' | 'rotate-ccw';

export function ImageMenu({ onAction }: { onAction: (action: ImageAction) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open]);

  const triggerAction = (action: ImageAction) => {
    onAction(action);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => setOpen(!open)}>
        Image
      </Button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl py-1 min-w-[180px] z-50">
          <MenuSection label="Adjustments" />
          <MenuItem label="Brightness +" shortcut="" onClick={() => triggerAction('brightness-up')} />
          <MenuItem label="Brightness −" shortcut="" onClick={() => triggerAction('brightness-down')} />
          <MenuItem label="Contrast +" shortcut="" onClick={() => triggerAction('contrast-up')} />
          <MenuItem label="Contrast −" shortcut="" onClick={() => triggerAction('contrast-down')} />
          <MenuItem label="Invert" shortcut="Ctrl+I" onClick={() => triggerAction('invert')} />
          <MenuItem label="Desaturate" shortcut="Ctrl+Shift+U" onClick={() => triggerAction('desaturate')} />
          <MenuSection label="Filters" />
          <MenuItem label="Blur" shortcut="" onClick={() => triggerAction('blur')} />
          <MenuItem label="Sharpen" shortcut="" onClick={() => triggerAction('sharpen')} />
          <MenuSection label="Transform" />
          <MenuItem label="Flip Horizontal" shortcut="" onClick={() => triggerAction('flip-h')} />
          <MenuItem label="Flip Vertical" shortcut="" onClick={() => triggerAction('flip-v')} />
          <MenuItem label="Rotate 90° CW" shortcut="" onClick={() => triggerAction('rotate-cw')} />
          <MenuItem label="Rotate 90° CCW" shortcut="" onClick={() => triggerAction('rotate-ccw')} />
          <MenuSection label="Canvas" />
          <MenuItem label="Crop to Selection" shortcut="" onClick={() => triggerAction('crop-to-selection')} />
        </div>
      )}
    </div>
  );
}

function MenuSection({ label }: { label: string }) {
  return <div className="px-3 pt-2 pb-0.5 text-[10px] text-neutral-500 uppercase tracking-wider">{label}</div>;
}

function MenuItem({ label, shortcut, onClick }: { label: string; shortcut: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 transition-colors">
      <span>{label}</span>
      {shortcut && <span className="text-neutral-500 font-mono text-[10px] ml-4">{shortcut}</span>}
    </button>
  );
}
