import { useRef, useEffect } from 'react';

export function Ruler({ direction, size, zoom, cursor }: { direction: 'horizontal' | 'vertical'; size: number; zoom: number; cursor: number | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isH = direction === 'horizontal';
  const thickness = 16;

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const logicalLen = Math.max(size * zoom, isH ? c.parentElement?.clientWidth ?? 800 : c.parentElement?.clientHeight ?? 600);
    const pw = isH ? Math.round(logicalLen * dpr) : Math.round(thickness * dpr);
    const ph = isH ? Math.round(thickness * dpr) : Math.round(logicalLen * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, logicalLen, thickness);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, isH ? logicalLen : thickness, isH ? thickness : logicalLen);

    const pixelsPerUnit = zoom;
    let step = 100;
    if (pixelsPerUnit >= 4) step = 10;
    if (pixelsPerUnit >= 20) step = 5;
    if (pixelsPerUnit < 1) step = 500;

    ctx.fillStyle = '#555';
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 0.5;
    ctx.font = '8px "TASA Orbiter", sans-serif';
    ctx.textBaseline = 'top';

    const count = Math.ceil(size / step) + 1;
    for (let i = 0; i < count; i++) {
      const px = i * step;
      const pos = px * zoom;
      if (isH) {
        ctx.beginPath(); ctx.moveTo(pos, thickness); ctx.lineTo(pos, thickness * 0.3); ctx.stroke();
        if (step >= 10) ctx.fillText(String(px), pos + 2, 1);
      } else {
        ctx.beginPath(); ctx.moveTo(thickness, pos); ctx.lineTo(thickness * 0.3, pos); ctx.stroke();
        ctx.save(); ctx.translate(1, pos + 2); ctx.rotate(-Math.PI / 2); ctx.fillText(String(px), 0, 0); ctx.restore();
      }
    }

    if (cursor != null && cursor >= 0) {
      const cpos = cursor * zoom;
      ctx.fillStyle = '#3b82f6';
      if (isH) {
        ctx.fillRect(cpos - 0.5, 0, 1, thickness);
      } else {
        ctx.fillRect(0, cpos - 0.5, thickness, 1);
      }
    }
  }, [size, zoom, cursor, isH]);

  return (
    <canvas
      ref={canvasRef}
      className="shrink-0"
      style={isH
        ? { height: thickness, width: '100%', display: 'block', borderBottom: '1px solid #333' }
        : { width: thickness, height: '100%', display: 'block', borderRight: '1px solid #333' }
      }
    />
  );
}
