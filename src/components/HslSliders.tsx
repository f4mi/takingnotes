function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  const s1 = s / 100, l1 = l / 100;
  const c = (1 - Math.abs(2 * l1 - 1)) * s1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l1 - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function HslSliders({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [h, s, l] = color.length >= 7 ? hexToHsl(color) : [0, 0, 50];
  return (
    <div className="space-y-2">
      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">HSL</span>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-500 w-3">H</span>
          <input type="range" min={0} max={360} value={h}
            onChange={(e) => onChange(hslToHex(Number(e.target.value), s, l))}
            className="flex-1 h-1.5 accent-blue-500" style={{ background: `linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))` }}
          />
          <span className="text-[10px] text-neutral-400 w-7 text-right tabular-nums">{h}°</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-500 w-3">S</span>
          <input type="range" min={0} max={100} value={s}
            onChange={(e) => onChange(hslToHex(h, Number(e.target.value), l))}
            className="flex-1 h-1.5 accent-blue-500"
          />
          <span className="text-[10px] text-neutral-400 w-7 text-right tabular-nums">{s}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-500 w-3">L</span>
          <input type="range" min={0} max={100} value={l}
            onChange={(e) => onChange(hslToHex(h, s, Number(e.target.value)))}
            className="flex-1 h-1.5 accent-blue-500"
          />
          <span className="text-[10px] text-neutral-400 w-7 text-right tabular-nums">{l}%</span>
        </div>
      </div>
    </div>
  );
}
