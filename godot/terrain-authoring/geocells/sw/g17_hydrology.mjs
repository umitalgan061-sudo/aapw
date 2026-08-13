import { WORLD_REFERENCE_WATER_MASK } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G17 = Object.freeze({
  id: 'G17',
  gx: 1,
  gy: 7,
  normalizedBounds: Object.freeze({ minX: 1 / 8, maxX: 2 / 8, minY: 7 / 8, maxY: 1 }),
  maskBounds: Object.freeze({ minX: 12, maxX: 23, minY: 56, maxY: 63 }),
  sourcePixels: Object.freeze({ minX: 192, maxX: 384, minY: 896, maxY: 1024 }),
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rowBit(rowHex, x) {
  const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
  return (nibble >> (3 - (x % 4))) & 1;
}

function waterAtCell(x, y) {
  const { width, height, rowsHex } = WORLD_REFERENCE_WATER_MASK;
  const sx = clamp(x, 0, width - 1);
  const sy = clamp(y, 0, height - 1);
  return rowBit(rowsHex[sy], sx);
}

function smooth01(value) {
  const x = clamp(value, 0, 1);
  return x * x * (3 - 2 * x);
}

export function sampleG17WaterConfidence(normalizedX, normalizedY) {
  const { width, height } = WORLD_REFERENCE_WATER_MASK;
  const gx = clamp(normalizedX * width - 0.5, 0, width - 1);
  const gy = clamp(normalizedY * height - 0.5, 0, height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = smooth01(gx - x0);
  const ty = smooth01(gy - y0);
  const a = waterAtCell(x0, y0);
  const b = waterAtCell(x1, y0);
  const c = waterAtCell(x0, y1);
  const d = waterAtCell(x1, y1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

export function sampleG17HydrologyHeight(normalizedX, normalizedY) {
  const water = sampleG17WaterConfidence(normalizedX, normalizedY);
  return 0.75 - 4.75 * smooth01(Math.max(0, (water - 0.35) / 0.65));
}

export function buildG17HydrologyProbe(size = 65, haloMaskCells = 1) {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('size must be an integer >= 2');
  if (!Number.isInteger(haloMaskCells) || haloMaskCells < 0) throw new RangeError('haloMaskCells must be >= 0');
  const hx = haloMaskCells / WORLD_REFERENCE_WATER_MASK.width;
  const hy = haloMaskCells / WORLD_REFERENCE_WATER_MASK.height;
  const bounds = Object.freeze({
    minX: Math.max(0, G17.normalizedBounds.minX - hx),
    maxX: Math.min(1, G17.normalizedBounds.maxX + hx),
    minY: Math.max(0, G17.normalizedBounds.minY - hy),
    maxY: Math.min(1, G17.normalizedBounds.maxY + hy),
  });
  const confidence = [];
  const heights = [];
  for (let y = 0; y < size; y += 1) {
    const ny = bounds.minY + (bounds.maxY - bounds.minY) * (y / (size - 1));
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.minX + (bounds.maxX - bounds.minX) * (x / (size - 1));
      confidence.push(sampleG17WaterConfidence(nx, ny));
      heights.push(sampleG17HydrologyHeight(nx, ny));
    }
  }
  return Object.freeze({
    schema: 'westeros-g17-hydrology-v1',
    size,
    haloMaskCells,
    bounds,
    confidence: Object.freeze(confidence),
    heights: Object.freeze(heights),
  });
}
