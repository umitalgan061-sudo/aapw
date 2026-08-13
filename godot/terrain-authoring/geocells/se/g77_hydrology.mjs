import { WORLD_REFERENCE_WATER_MASK } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G77 = Object.freeze({
  id: 'G77', gx: 7, gy: 7,
  normalizedBounds: Object.freeze({ minX: 7 / 8, maxX: 1, minY: 7 / 8, maxY: 1 }),
  maskBounds: Object.freeze({ minX: 84, maxX: 95, minY: 56, maxY: 63 }),
  sourcePixels: Object.freeze({ minX: 1344, maxX: 1536, minY: 896, maxY: 1024 }),
});

function rowBit(rowHex, x) {
  const nibble = Number.parseInt(rowHex[Math.floor(x / 4)], 16);
  return (nibble >> (3 - (x % 4))) & 1;
}
function waterAtCell(x, y) {
  const { width, height, rowsHex } = WORLD_REFERENCE_WATER_MASK;
  const sx = Math.max(0, Math.min(width - 1, x));
  const sy = Math.max(0, Math.min(height - 1, y));
  return rowBit(rowsHex[sy], sx);
}

/** Bilinear high-resolution resampling: mask cells are semantic addresses, never final pixels. */
export function sampleG77WaterConfidence(normalizedX, normalizedY) {
  const { width, height } = WORLD_REFERENCE_WATER_MASK;
  const gx = Math.max(0, Math.min(width - 1, normalizedX * width - 0.5));
  const gy = Math.max(0, Math.min(height - 1, normalizedY * height - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const a = waterAtCell(x0, y0), b = waterAtCell(x1, y0);
  const c = waterAtCell(x0, y1), d = waterAtCell(x1, y1);
  const north = a + (b - a) * tx, south = c + (d - c) * tx;
  return north + (south - north) * ty;
}

/** Waterline is confidence 0.5; canonical centres remain exactly +0.75m land / -6m water. */
export function sampleG77HydrologyHeight(normalizedX, normalizedY) {
  const water = sampleG77WaterConfidence(normalizedX, normalizedY);
  return water <= 0.5 ? 1.5 * (0.5 - water) : -12 * (water - 0.5);
}

export function sampleG77HydrologySurface(normalizedX, normalizedY) {
  const water = sampleG77WaterConfidence(normalizedX, normalizedY);
  const land = [0.52, 0.42, 0.30], seabed = [0.18, 0.27, 0.30];
  return Object.freeze({
    height: sampleG77HydrologyHeight(normalizedX, normalizedY), water,
    color: Object.freeze(land.map((value, i) => value + (seabed[i] - value) * water)),
    roughness: 0.88 + (0.72 - 0.88) * water,
  });
}

export function buildG77HydrologyProbe(size = 65, haloMaskCells = 1) {
  const { width, height } = WORLD_REFERENCE_WATER_MASK;
  const bounds = Object.freeze({
    minX: Math.max(0, G77.normalizedBounds.minX - haloMaskCells / width), maxX: G77.normalizedBounds.maxX,
    minY: Math.max(0, G77.normalizedBounds.minY - haloMaskCells / height), maxY: G77.normalizedBounds.maxY,
  });
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const normalizedY = bounds.minY + (bounds.maxY - bounds.minY) * y / (size - 1), row = [];
    for (let x = 0; x < size; x += 1) {
      const normalizedX = bounds.minX + (bounds.maxX - bounds.minX) * x / (size - 1);
      const s = sampleG77HydrologySurface(normalizedX, normalizedY);
      row.push([s.water, s.height, ...s.color, s.roughness]);
    }
    rows.push(row);
  }
  return Object.freeze({
    schema: 'westeros-g77-terrain3d-hydrology-v1',
    sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
    sourceGridSize: size, terrain3dRegionSize: 256, terrain3dImportSize: 257,
    landTextureId: 0, coastTextureId: 1, haloMaskCells, bounds,
    rows: Object.freeze(rows.map((row) => Object.freeze(row.map(Object.freeze)))),
  });
}
