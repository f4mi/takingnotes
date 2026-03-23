export type PenLayout = {
  label: string;
  buttons: number;
  x: number;
  y: number;
  pressure: number;
  minLength: number;
  preferredReportIds?: number[];
};

export type DecodedPenPacket = {
  x: number;
  y: number;
  pressure: number;
  isDown: boolean;
  layout: PenLayout;
  score: number;
};

type DecodeOptions = {
  reportId?: number;
  maxX?: number;
  maxY?: number;
  maxPressure?: number;
  preferredLayoutLabel?: string | null;
};

const LAYOUTS: PenLayout[] = [
  { label: 'r8-standard', buttons: 1, x: 2, y: 4, pressure: 6, minLength: 8, preferredReportIds: [0x08] },
  { label: 'r7-standard', buttons: 1, x: 2, y: 4, pressure: 6, minLength: 7, preferredReportIds: [0x07] },
  { label: 'legacy-7', buttons: 0, x: 1, y: 3, pressure: 5, minLength: 7 },
  { label: 'legacy-8', buttons: 0, x: 2, y: 4, pressure: 6, minLength: 8 },
  { label: 'shifted-9', buttons: 1, x: 3, y: 5, pressure: 7, minLength: 9 },
  { label: 'tail-9', buttons: 0, x: 4, y: 6, pressure: 8, minLength: 9 },
];

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function le16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 1 >= bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

export function listInputReportIds(device: HIDDevice | null): number[] {
  if (!device) return [];
  const reportIds = new Set<number>();
  for (const collection of device.collections || []) {
    for (const report of collection.inputReports || []) {
      if (typeof report.reportId === 'number') {
        reportIds.add(report.reportId);
      }
    }
  }
  return [...reportIds].sort((a, b) => a - b);
}

function scoreLayout(bytes: Uint8Array, layout: PenLayout, options: DecodeOptions): DecodedPenPacket | null {
  const x = le16(bytes, layout.x);
  const y = le16(bytes, layout.y);
  const pressure = le16(bytes, layout.pressure);
  if (x == null || y == null || pressure == null) return null;
  if (x === 0 && y === 0 && pressure === 0) return null;

  const buttons = bytes[layout.buttons] ?? 0;
  const isDown = (buttons & 0x01) !== 0 || pressure > 0;
  const maxX = Math.max(1, options.maxX ?? 32767);
  const maxY = Math.max(1, options.maxY ?? 32767);
  const maxPressure = Math.max(1, options.maxPressure ?? 8191);

  let score = 0;

  if (bytes.length === layout.minLength) score += 3;
  if (bytes.length > layout.minLength) score += 1;

  if (layout.preferredReportIds?.includes(options.reportId ?? -1)) score += 4;
  if (options.preferredLayoutLabel === layout.label) score += 6;

  if (x > 0 && x <= maxX) score += 3;
  if (y > 0 && y <= maxY) score += 3;
  if (pressure <= maxPressure * 1.25) score += 3;
  if ((buttons & 0xf8) === 0) score += 1;
  if (pressure > 0 && isDown) score += 1;
  if (pressure === 0 && !isDown) score += 1;
  if (x === y) score -= 1;
  if (x > maxX * 1.5 || y > maxY * 1.5 || pressure > maxPressure * 2) score -= 4;

  return { x, y, pressure, isDown, layout, score };
}

export function decodePenPacket(bytes: Uint8Array, options: DecodeOptions = {}): DecodedPenPacket | null {
  let best: DecodedPenPacket | null = null;

  for (const layout of LAYOUTS) {
    if (bytes.length < layout.minLength) continue;
    const candidate = scoreLayout(bytes, layout, options);
    if (!candidate) continue;
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best && best.score >= 6 ? best : null;
}
