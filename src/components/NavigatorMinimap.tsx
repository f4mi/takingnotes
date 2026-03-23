import { useRef, useEffect, useState } from 'react';
import type { Layer } from '@/types';

export function NavigatorMinimap({ canvasWidth, canvasHeight, zoom, viewportRef, layers }: {
  canvasWidth: number; canvasHeight: number; zoom: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  layers: Layer[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const maxSize = 120;
  const aspect = canvasWidth / canvasHeight;
  const w = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
  const h = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;

  // Listen for scroll events on the viewport to update the minimap rectangle
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onScroll = () => setScrollTick(t => t + 1);
    vp.addEventListener('scroll', onScroll, { passive: true });
    return () => vp.removeEventListener('scroll', onScroll);
  }, [viewportRef]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = w * 2; c.height = h * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, w, h);
    layers.forEach(l => {
      if (!l.visible) return;
      ctx.save();
      ctx.globalAlpha = l.opacity / 100;
      ctx.drawImage(l.canvas, 0, 0, w, h);
      ctx.restore();
    });
    const vp = viewportRef.current;
    if (vp) {
      const scale = w / (canvasWidth * zoom);
      const vx = vp.scrollLeft * scale;
      const vy = vp.scrollTop * scale;
      const vw = vp.clientWidth * scale;
      const vh = vp.clientHeight * scale;
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.strokeRect(vx, vy, vw, vh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasWidth, canvasHeight, zoom, w, h, layers, scrollTick]);

  return (
    <div className="absolute bottom-2 right-2 z-20 rounded border border-neutral-600 shadow-lg overflow-hidden" style={{ width: w, height: h }}>
      <canvas ref={canvasRef} style={{ width: w, height: h }} className="block" />
    </div>
  );
}
