import React, { useState, useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Eye, EyeOff, GripVertical, Lock, Unlock } from 'lucide-react';
import type { Layer } from '@/types';

interface LayerPanelProps {
  layer: Layer;
  isActive: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<Layer>) => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onFlip?: (dir: 'horizontal' | 'vertical') => void;
  onRotate?: (deg: 90 | -90 | 180) => void;
  onClear?: () => void;
  canDelete?: boolean;
  renderTick?: number;
}

export function LayerPanel({ layer, isActive, onSelect, onUpdate, onDuplicate, onDelete, onFlip, onRotate, onClear, canDelete = true, renderTick }: LayerPanelProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: layer.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  };

  const thumbnailRef = React.useRef<HTMLCanvasElement>(null);
  
  React.useEffect(() => {
    const canvas = thumbnailRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 36, 36);

    // Draw checkerboard transparency pattern
    const size = 4;
    for (let y = 0; y < 36; y += size) {
      for (let x = 0; x < 36; x += size) {
        ctx.fillStyle = ((x / size + y / size) % 2 === 0) ? '#444' : '#333';
        ctx.fillRect(x, y, size, size);
      }
    }
    ctx.save();
    ctx.globalAlpha = layer.visible ? layer.opacity / 100 : Math.max(0.2, (layer.opacity / 100) * 0.35);
    ctx.drawImage(layer.canvas, 0, 0, 36, 36);
    ctx.restore();
  }, [layer.canvas, layer.opacity, layer.visible, renderTick]);

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); };
  }, [ctxMenu]);

  const blendLabel = layer.blendMode && layer.blendMode !== 'source-over'
    ? layer.blendMode.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : null;

  return (
    <>
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center h-11 cursor-pointer select-none
        border-b border-neutral-700/50
        ${isActive
          ? 'bg-[#2a4a7f]'
          : 'bg-neutral-800 hover:bg-neutral-700/50'
        }
        ${isDragging ? 'z-50' : ''}
      `}
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxMenu({ x: e.clientX, y: e.clientY }); }}
    >
      <button
        type="button"
        className="shrink-0 w-6 h-full flex items-center justify-center text-neutral-600 hover:text-neutral-300 cursor-grab active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Visibility toggle */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUpdate({ visible: !layer.visible });
        }}
        className={`
          shrink-0 w-8 h-full flex items-center justify-center
          hover:bg-white/5 transition-colors
          ${layer.visible ? 'text-neutral-300' : 'text-neutral-600'}
        `}
      >
        {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
      </button>

      {/* Lock toggle */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUpdate({ locked: !layer.locked });
        }}
        className={`
          shrink-0 w-6 h-full flex items-center justify-center
          hover:bg-white/5 transition-colors
          ${layer.locked ? 'text-neutral-400' : 'text-neutral-600'}
        `}
      >
        {layer.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
      </button>

      {/* Thumbnail */}
      <div className="shrink-0 mx-1.5">
        <canvas
          ref={thumbnailRef}
          width={36}
          height={36}
          className="border border-neutral-600 bg-neutral-900 block"
          style={{ width: 36, height: 36 }}
        />
      </div>

      {/* Layer Name — double-click to rename (PS convention) */}
      <div className="flex-1 min-w-0 px-1.5">
        <LayerName name={layer.name} onRename={(name) => onUpdate({ name })} />
        <div className="flex items-center gap-1">
          {layer.opacity < 100 && (
            <span className="text-[10px] text-neutral-500 leading-tight">{layer.opacity}%</span>
          )}
          {blendLabel && (
            <span className="text-[10px] text-blue-400/60 leading-tight truncate">{blendLabel}</span>
          )}
        </div>
      </div>
    </div>

    {/* Right-click context menu */}
    {ctxMenu && (
      <div
        className="fixed z-[100] bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl py-1 min-w-[160px]"
        style={{ left: ctxMenu.x, top: ctxMenu.y }}
        onClick={() => setCtxMenu(null)}
      >
        <CtxItem onClick={() => onDuplicate?.()}>Duplicate Layer</CtxItem>
        <CtxItem onClick={() => onDelete?.()} disabled={!canDelete}>Delete Layer</CtxItem>
        <div className="border-t border-neutral-700 my-1" />
        <CtxItem onClick={() => onUpdate({ visible: !layer.visible })}>{layer.visible ? 'Hide' : 'Show'} Layer</CtxItem>
        <CtxItem onClick={() => onUpdate({ locked: !layer.locked })}>{layer.locked ? 'Unlock' : 'Lock'} Layer</CtxItem>
        <div className="border-t border-neutral-700 my-1" />
        <CtxItem onClick={() => onFlip?.('horizontal')}>Flip Horizontal</CtxItem>
        <CtxItem onClick={() => onFlip?.('vertical')}>Flip Vertical</CtxItem>
        <CtxItem onClick={() => onRotate?.(90)}>Rotate 90° CW</CtxItem>
        <CtxItem onClick={() => onRotate?.(-90)}>Rotate 90° CCW</CtxItem>
        <CtxItem onClick={() => onRotate?.(180)}>Rotate 180°</CtxItem>
        <div className="border-t border-neutral-700 my-1" />
        <CtxItem onClick={() => onClear?.()}>Clear Layer</CtxItem>
      </div>
    )}
    </>
  );
}

function CtxItem({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      className="w-full text-left px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700 disabled:text-neutral-600 disabled:hover:bg-transparent transition-colors"
    >
      {children}
    </button>
  );
}

function LayerName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(name); }, [name]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    else setDraft(name);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(name); setEditing(false); }
          e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        className="text-xs font-normal text-neutral-200 bg-neutral-900 border border-neutral-600 rounded px-1 py-0 w-full outline-none focus:border-blue-500"
      />
    );
  }

  return (
    <p
      className="text-xs font-normal truncate text-neutral-200"
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      {name}
    </p>
  );
}
