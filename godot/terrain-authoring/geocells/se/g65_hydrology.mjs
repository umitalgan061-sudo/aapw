import { WORLD_REFERENCE_WATER_MASK } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G65 = Object.freeze({
  id: 'G65', gx: 6, gy: 5,
  normalizedBounds: Object.freeze({ minX: 0.75, maxX: 0.875, minY: 0.625, maxY: 0.75 }),
  maskBounds: Object.freeze({ minX: 72, maxX: 83, minY: 40, maxY: 47 }),
  sourcePixels: Object.freeze({ minX: 1152, maxX: 1344, minY: 640, maxY: 768 }),
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

function smooth01(t) {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/** Continuous global owner-map water confidence. GeoCell edges never participate. */
export function sampleG65WaterConfidence(normalizedX, normalizedY) {
  const { width, height } = WORLD_REFERENCE_WATER_MASK;
  const gx = Math.max(0, Math.min(width - 1, normalizedX * width - 0.5));
  const gy = Math.max(0, Math.min(height - 1, normalizedY * height - 0.5));
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

/** Coast-signed height used only for the bounded Terrain3D hydrology proof. */
export function sampleG65HydrologyHeight(normalizedX, normalizedY) {
  const water = sampleG65WaterConfidence(normalizedX, normalizedY);
  // Keep canonical G65 dry while smoothly approaching adjacent coastal water outside the core.
  return 0.75 - 4.75 * smooth01(Math.max(0, (water - 0.35) / 0.65));
}

export function buildG65HydrologyProbe(size = 65, haloMaskCells = 1) {
  if (!Number.isInteger(size) || size < 3) throw new TypeError('size must be an integer >= 3');
  const haloX = haloMaskCells / WORLD_REFERENCE_WATER_MASK.width;
  const haloY = haloMaskCells / WORLD_REFERENCE_WATER_MASK.height;
  const minX = G65.normalizedBounds.minX - haloX;
  const maxX = G65.normalizedBounds.maxX + haloX;
  const minY = G65.normalizedBounds.minY - haloY;
  const maxY = G65.normalizedBounds.maxY + haloY;
  const confidence = [];
  const heights = [];
  for (let y = 0; y < size; y += 1) {
    const v = y / (size - 1);
    const ny = minY + (maxY - minY) * v;
    for (let x = 0; x < size; x += 1) {
      const u = x / (size - 1);
      const nx = minX + (maxX - minX) * u;
      confidence.push(sampleG65WaterConfidence(nx, ny));
      heights.push(sampleG65HydrologyHeight(nx, ny));
    }
  }
  return Object.freeze({
    schema: 'westeros-g65-hydrology-v1',
    size, haloMaskCells,
    bounds: Object.freeze({ minX, maxX, minY, maxY }),
    confidence: Object.freeze(confidence),
    heights: Object.freeze(heights),
  });
}
