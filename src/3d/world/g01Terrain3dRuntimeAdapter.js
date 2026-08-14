/**
 * Buzul Muhafızı / G01 — qualified Terrain3D bake -> Three.js runtime sampler.
 *
 * This adapter is opt-in and read-only. It does not alter the live terrain mesh;
 * it converts a validated Terrain3D bake payload into continuous owner-map and
 * Three.js world-coordinate samples for parity qualification.
 */
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

export const G01_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
  id: 'buzul-muhafizi-g01-terrain3d-threejs-runtime-parity-2026-08-14-v1',
  geoCell: 'G01',
  layer: 'Terrain3D Bake/Runtime parity',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  terrain3dVersion: '1.0.2-stable',
  terrain3dLod: 0,
  sourceSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 1 / 8, yMin: 1 / 8, yMax: 2 / 8 }),
});

const CHANNELS = Object.freeze(['heights', 'snowWeight', 'tintR', 'tintG', 'tintB', 'roughness']);
const clamp01 = (value) => Math.min(1, Math.max(0, value));

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function assertBakePayload(bake) {
  if (!bake || typeof bake !== 'object') throw new TypeError('G01 Terrain3D bake payload must be an object');
  if (bake.schema !== 'westeros-g01-terrain3d-bake-v1') throw new Error(`unexpected G01 bake schema: ${bake.schema}`);
  if (bake.policyId !== G01_TERRAIN3D_RUNTIME_PARITY.id) throw new Error(`unexpected G01 runtime parity policy: ${bake.policyId}`);
  if (bake.sourceMapSha256 !== G01_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G01 bake owner-map provenance mismatch');
  if (bake.width !== G01_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G01_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
    throw new Error(`G01 bake must be ${G01_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G01_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
  }
  const expected = bake.width * bake.height;
  for (const channel of CHANNELS) {
    if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G01 bake channel ${channel}`);
    for (let i = 0; i < bake[channel].length; i += 1) assertFinite(bake[channel][i], `${channel}[${i}]`);
  }
}

function bilinear(values, width, height, u, v) {
  const gx = clamp01(u) * (width - 1);
  const gy = clamp01(v) * (height - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const top = values[y0 * width + x0] + (values[y0 * width + x1] - values[y0 * width + x0]) * tx;
  const bottom = values[y1 * width + x0] + (values[y1 * width + x1] - values[y1 * width + x0]) * tx;
  return top + (bottom - top) * ty;
}

function localUv(normalizedX, normalizedY) {
  assertFinite(normalizedX, 'normalizedX');
  assertFinite(normalizedY, 'normalizedY');
  const b = G01_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const epsilon = 1e-9;
  if (normalizedX < b.xMin - epsilon || normalizedX > b.xMax + epsilon || normalizedY < b.yMin - epsilon || normalizedY > b.yMax + epsilon) {
    throw new RangeError('G01 parity sampler may only be queried inside its qualified owner-map domain');
  }
  return Object.freeze({
    u: clamp01((normalizedX - b.xMin) / (b.xMax - b.xMin)),
    v: clamp01((normalizedY - b.yMin) / (b.yMax - b.yMin)),
  });
}

export function createG01Terrain3DBakeSampler(bake) {
  assertBakePayload(bake);
  const { width, height } = bake;
  return function sampleG01Terrain3DBake(normalizedX, normalizedY) {
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

export function createG01Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
  const sampleNormalized = createG01Terrain3DBakeSampler(bake);
  if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
    throw new TypeError('mapBounds must contain finite min/max X/Y');
  }
  assertFinite(metersPerMapUnit, 'metersPerMapUnit');
  if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
  return function sampleG01Terrain3DWorld(worldX, worldZ) {
    const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
    return sampleNormalized(normalized.x, normalized.y);
  };
}
