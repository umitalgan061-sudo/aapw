/**
 * Buzul Muhafızı / NW G00 — Terrain3D bake -> Three.js runtime parity adapter.
 *
 * GeoCell coordinates are authoring addresses only. Numeric channels are sampled
 * bilinearly; discrete Terrain3D base/overlay IDs are selected from the nearest
 * baked authoring node so road/path and Rock/Snow semantics cannot be blended
 * into invented texture IDs.
 */
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

export const G00_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
  id: 'buzul-muhafizi-g00-terrain3d-threejs-runtime-parity-2026-08-13-v1',
  geoCell: 'G00',
  layer: 'Terrain3D Bake/Runtime parity',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  terrain3dVersion: '1.0.2-stable',
  terrain3dLod: 0,
  sourceSize: 65,
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 1 / 8, yMin: 0, yMax: 1 / 8 }),
});

const NUMERIC_CHANNELS = Object.freeze([
  'heights', 'blend', 'tintR', 'tintG', 'tintB', 'roughness',
  'roadCoverage', 'pathCoverage', 'snowWeight', 'landFactor',
]);
const DISCRETE_CHANNELS = Object.freeze(['baseId', 'overlayId']);

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}
function clamp01(value) { return Math.max(0, Math.min(1, value)); }

function assertBake(bake) {
  if (!bake || typeof bake !== 'object') throw new TypeError('G00 Terrain3D bake payload must be an object');
  if (bake.schema !== 'westeros-g00-terrain3d-bake-v1') throw new Error(`unexpected G00 bake schema: ${bake.schema}`);
  if (bake.sourceMapSha256 !== G00_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G00 bake map.png provenance mismatch');
  if (bake.width !== G00_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G00_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
    throw new Error(`G00 bake must be ${G00_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G00_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
  }
  const expected = bake.width * bake.height;
  for (const channel of NUMERIC_CHANNELS) {
    if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G00 bake channel ${channel}`);
    for (let i = 0; i < expected; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
  }
  for (const channel of DISCRETE_CHANNELS) {
    if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G00 bake channel ${channel}`);
    for (let i = 0; i < expected; i += 1) {
      if (!Number.isInteger(bake[channel][i]) || bake[channel][i] < 0 || bake[channel][i] > 31) throw new Error(`invalid ${channel}[${i}]`);
    }
  }
}

function localUv(normalizedX, normalizedY) {
  assertFinite(normalizedX, 'normalizedX');
  assertFinite(normalizedY, 'normalizedY');
  const b = G00_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const epsilon = 1e-9;
  if (normalizedX < b.xMin - epsilon || normalizedX > b.xMax + epsilon || normalizedY < b.yMin - epsilon || normalizedY > b.yMax + epsilon) {
    throw new RangeError('G00 parity sampler may only be queried inside its qualified owner-map domain');
  }
  return Object.freeze({
    u: clamp01((normalizedX - b.xMin) / (b.xMax - b.xMin)),
    v: clamp01((normalizedY - b.yMin) / (b.yMax - b.yMin)),
  });
}

function bilinear(values, width, height, u, v) {
  const gx = clamp01(u) * (width - 1);
  const gy = clamp01(v) * (height - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const tx = gx - x0, ty = gy - y0;
  const top = values[y0 * width + x0] + (values[y0 * width + x1] - values[y0 * width + x0]) * tx;
  const bottom = values[y1 * width + x0] + (values[y1 * width + x1] - values[y1 * width + x0]) * tx;
  return top + (bottom - top) * ty;
}

function nearest(values, width, height, u, v) {
  const x = Math.max(0, Math.min(width - 1, Math.round(clamp01(u) * (width - 1))));
  const y = Math.max(0, Math.min(height - 1, Math.round(clamp01(v) * (height - 1))));
  return values[y * width + x];
}

export function createG00Terrain3DBakeSampler(bake) {
  assertBake(bake);
  const { width, height } = bake;
  return function sampleG00Terrain3DBake(normalizedX, normalizedY) {
    const { u, v } = localUv(normalizedX, normalizedY);
    return Object.freeze({
      heightMeters: bilinear(bake.heights, width, height, u, v),
      baseId: nearest(bake.baseId, width, height, u, v),
      overlayId: nearest(bake.overlayId, width, height, u, v),
      blend: bilinear(bake.blend, width, height, u, v),
      tintR: bilinear(bake.tintR, width, height, u, v),
      tintG: bilinear(bake.tintG, width, height, u, v),
      tintB: bilinear(bake.tintB, width, height, u, v),
      roughness: bilinear(bake.roughness, width, height, u, v),
      roadCoverage: bilinear(bake.roadCoverage, width, height, u, v),
      pathCoverage: bilinear(bake.pathCoverage, width, height, u, v),
      snowWeight: bilinear(bake.snowWeight, width, height, u, v),
      landFactor: bilinear(bake.landFactor, width, height, u, v),
    });
  };
}

export function createG00Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
  const sampleNormalized = createG00Terrain3DBakeSampler(bake);
  if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
    throw new TypeError('mapBounds must contain finite min/max X/Y');
  }
  assertFinite(metersPerMapUnit, 'metersPerMapUnit');
  if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
  return function sampleG00Terrain3DWorld(worldX, worldZ) {
    const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
    return sampleNormalized(normalized.x, normalized.y);
  };
}
