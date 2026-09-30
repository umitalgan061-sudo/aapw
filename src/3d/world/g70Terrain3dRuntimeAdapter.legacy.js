/**
 * Şafak Kartalı / G70 — qualified Terrain3D bake -> Three.js runtime sampler.
 *
 * Opt-in only: this adapter does not replace live terrain. It proves that the
 * same continuous owner-map bake can be sampled deterministically in Three.js
 * world coordinates without exposing GeoCell/grid boundaries.
 */
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

export const G70_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
  id: 'safak-kartali-g70-terrain3d-threejs-runtime-parity-2026-08-14-v1',
  geoCell: 'G70',
  layer: 'Terrain3D Bake/Runtime parity',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  terrain3dVersion: '1.0.2-stable',
  terrain3dLod: 0,
  sourceSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  normalizedBounds: Object.freeze({ xMin: 7 / 8, xMax: 1, yMin: 0, yMax: 1 / 8 }),
});

const CHANNELS = Object.freeze(['heights', 'snowWeight', 'tintR', 'tintG', 'tintB', 'roughness']);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function assertBakePayload(bake) {
  if (!bake || typeof bake !== 'object') throw new TypeError('G70 Terrain3D bake payload must be an object');
  if (bake.schema !== 'westeros-g70-terrain3d-bake-v1') throw new Error(`unexpected G70 bake schema: ${bake.schema}`);
  if (bake.policyId !== G70_TERRAIN3D_RUNTIME_PARITY.id) throw new Error(`unexpected G70 runtime parity policy: ${bake.policyId}`);
  if (bake.sourceMapSha256 !== G70_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G70 bake owner-map provenance mismatch');
  if (bake.width !== G70_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G70_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
    throw new Error(`G70 bake must be ${G70_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G70_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
  }
  const expected = bake.width * bake.height;
  for (const channel of CHANNELS) {
    if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G70 bake channel ${channel}`);
    for (let i = 0; i < bake[channel].length; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
  }
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

function localUv(normalizedX, normalizedY) {
  assertFinite(normalizedX, 'normalizedX');
  assertFinite(normalizedY, 'normalizedY');
  const b = G70_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const epsilon = 1e-9;
  if (normalizedX < b.xMin - epsilon || normalizedX > b.xMax + epsilon || normalizedY < b.yMin - epsilon || normalizedY > b.yMax + epsilon) {
    throw new RangeError('G70 parity sampler may only be queried inside its qualified owner-map domain');
  }
  return Object.freeze({
    u: clamp01((normalizedX - b.xMin) / (b.xMax - b.xMin)),
    v: clamp01((normalizedY - b.yMin) / (b.yMax - b.yMin)),
  });
}

export function createG70Terrain3DBakeSampler(bake) {
  assertBakePayload(bake);
  const { width, height } = bake;
  return function sampleG70Terrain3DBake(normalizedX, normalizedY) {
    const { u, v } = localUv(normalizedX, normalizedY);
    return Object.freeze({
      heightMeters: bilinear(bake.heights, width, height, u, v),
      snowWeight: bilinear(bake.snowWeight, width, height, u, v),
      tintR: bilinear(bake.tintR, width, height, u, v),
      tintG: bilinear(bake.tintG, width, height, u, v),
      tintB: bilinear(bake.tintB, width, height, u, v),
      roughness: bilinear(bake.roughness, width, height, u, v),
    });
  };
}

export function createG70Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
  const sampleNormalized = createG70Terrain3DBakeSampler(bake);
  if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
    throw new TypeError('mapBounds must contain finite min/max X/Y');
  }
  assertFinite(metersPerMapUnit, 'metersPerMapUnit');
  if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
  return function sampleG70Terrain3DWorld(worldX, worldZ) {
    const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
    return sampleNormalized(normalized.x, normalized.y);
  };
}
