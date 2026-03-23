function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function invertColors(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
  }
}

export function desaturate(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
}

export function adjustBrightness(data: Uint8ClampedArray, amount: number) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampChannel(data[i] + amount);
    data[i + 1] = clampChannel(data[i + 1] + amount);
    data[i + 2] = clampChannel(data[i + 2] + amount);
  }
}

export function adjustContrast(data: Uint8ClampedArray, factor: number) {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clampChannel((data[i] - 128) * factor + 128);
    data[i + 1] = clampChannel((data[i + 1] - 128) * factor + 128);
    data[i + 2] = clampChannel((data[i + 2] - 128) * factor + 128);
  }
}

export function boxBlur(data: Uint8ClampedArray, w: number, h: number, radius: number) {
  if (radius <= 0 || w <= 0 || h <= 0) return;

  const source = new Uint8ClampedArray(data);
  const horizontal = new Float32Array(data.length);
  const windowSize = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let offset = -radius; offset <= radius; offset++) {
      const sx = Math.max(0, Math.min(w - 1, offset));
      const idx = (y * w + sx) * 4;
      sumR += source[idx];
      sumG += source[idx + 1];
      sumB += source[idx + 2];
      sumA += source[idx + 3];
    }

    for (let x = 0; x < w; x++) {
      const outIdx = (y * w + x) * 4;
      horizontal[outIdx] = sumR / windowSize;
      horizontal[outIdx + 1] = sumG / windowSize;
      horizontal[outIdx + 2] = sumB / windowSize;
      horizontal[outIdx + 3] = sumA / windowSize;

      const removeX = Math.max(0, x - radius);
      const addX = Math.min(w - 1, x + radius + 1);
      const removeIdx = (y * w + removeX) * 4;
      const addIdx = (y * w + addX) * 4;
      sumR += source[addIdx] - source[removeIdx];
      sumG += source[addIdx + 1] - source[removeIdx + 1];
      sumB += source[addIdx + 2] - source[removeIdx + 2];
      sumA += source[addIdx + 3] - source[removeIdx + 3];
    }
  }

  for (let x = 0; x < w; x++) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let offset = -radius; offset <= radius; offset++) {
      const sy = Math.max(0, Math.min(h - 1, offset));
      const idx = (sy * w + x) * 4;
      sumR += horizontal[idx];
      sumG += horizontal[idx + 1];
      sumB += horizontal[idx + 2];
      sumA += horizontal[idx + 3];
    }

    for (let y = 0; y < h; y++) {
      const outIdx = (y * w + x) * 4;
      data[outIdx] = clampChannel(sumR / windowSize);
      data[outIdx + 1] = clampChannel(sumG / windowSize);
      data[outIdx + 2] = clampChannel(sumB / windowSize);
      data[outIdx + 3] = clampChannel(sumA / windowSize);

      const removeY = Math.max(0, y - radius);
      const addY = Math.min(h - 1, y + radius + 1);
      const removeIdx = (removeY * w + x) * 4;
      const addIdx = (addY * w + x) * 4;
      sumR += horizontal[addIdx] - horizontal[removeIdx];
      sumG += horizontal[addIdx + 1] - horizontal[removeIdx + 1];
      sumB += horizontal[addIdx + 2] - horizontal[removeIdx + 2];
      sumA += horizontal[addIdx + 3] - horizontal[removeIdx + 3];
    }
  }
}

export function applySharpen(data: Uint8ClampedArray, w: number, h: number) {
  if (w < 3 || h < 3) return;

  const copy = new Uint8ClampedArray(data);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      for (let c = 0; c < 3; c++) {
        const i = (y * w + x) * 4 + c;
        const val = copy[i] * 5
          - copy[((y - 1) * w + x) * 4 + c]
          - copy[((y + 1) * w + x) * 4 + c]
          - copy[(y * w + x - 1) * 4 + c]
          - copy[(y * w + x + 1) * 4 + c];
        data[i] = clampChannel(val);
      }
    }
  }
}
