/**
 * Kızıl Ufuk / G65 qualified Terrain3D bake -> Three.js runtime adapter.
 *
 * This module consumes only a validated bake payload. It does not evaluate GeoCell masks in the
 * browser and does not mutate the live terrain scene; callers opt in by supplying the bake proof.
 * Coordinates are mapped through the canonical world/reference alignment before bilinear sampling.
 */
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

export const G65_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
  id: 'kizil-ufuk-g65-terrain3d-threejs-runtime-parity-2026-08-13-v1',
  geoCell: 'G65',
  layer: 'Terrain3D Bake/Runtime parity',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  terrain3dVersion: '1.0.2-stable',
  terrain3dLod: 0,
  sourceSize: 129,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  normalizedBounds: Object.freeze({ xMin: 6 / 8, xMax: 7 / 8, yMin: 5 / 8, yMax: 6 / 8 }),
});

const CHANNELS = Object.freeze(['heights', 'rockBlend', 'tintR', 'tintG', 'tintB', 'roughness']);

function assertFinite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function assertBakePayload(bake) {
  if (!bake || typeof bake !== 'object') throw new TypeError('G65 Terrain3D bake payload must be an object');
  if (bake.schema !== 'westeros-g65-terrain3d-bake-v1') throw new Error(`unexpected G65 bake schema: ${bake.schema}`);
  if (bake.policyId !== G65_TERRAIN3D_RUNTIME_PARITY.id) throw new Error(`unexpected G65 runtime parity policy: ${bake.policyId}`);
  if (bake.sourceMapSha256 !== G65_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G65 bake map.png provenance mismatch');
  if (bake.width !== G65_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G65_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
    throw new Error(`G65 bake must be ${G65_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G65_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
  }
  const expected = bake.width * bake.height;
  for (const channel of CHANNELS) {
    if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G65 bake channel ${channel}`);
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
  const a = values[y0 * width + x0];
  const b = values[y0 * width + x1];
  const c = values[y1 * width + x0];
  const d = values[y1 * width + x1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

function localUv(normalizedX, normalizedY) {
  assertFinite(normalizedX, 'normalizedX');
  assertFinite(normalizedY, 'normalizedY');
  const bounds = G65_TERRAIN3D_RUNTIME_PARITY.normalizedBounds;
  const epsilon = 1e-9;
  if (
    normalizedX < bounds.xMin - epsilon || normalizedX > bounds.xMax + epsilon ||
    normalizedY < bounds.yMin - epsilon || normalizedY > bounds.yMax + epsilon
  ) {
    throw new RangeError('G65 runtime parity sampler may only be queried inside its qualified owner-map domain');
  }
  return {
    u: clamp01((normalizedX - bounds.xMin) / (bounds.xMax - bounds.xMin)),
    v: clamp01((normalizedY - bounds.yMin) / (bounds.yMax - bounds.yMin)),
  };
}

export function createG65Terrain3DBakeSampler(bake) {
  assertBakePayload(bake);
  const { width, height } = bake;
  return function sampleG65Terrain3DBake(normalizedX, normalizedY) {
    const { u, v } = localUv(normalizedX, normalizedY);
    return Object.freeze({
      heightMeters: bilinear(bake.heights, width, height, u, v),
      rockBlend: bilinear(bake.rockBlend, width, height, u, v),
      tintR: bilinear(bake.tintR, width, height, u, v),
      tintG: bilinear(bake.tintG, width, height, u, v),
      tintB: bilinear(bake.tintB, width, height, u, v),
      roughness: bilinear(bake.roughness, width, height, u, v),
    });
  };
}

export function createG65Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
  const sampleNormalized = createG65Terrain3DBakeSampler(bake);
  if (!mapBounds || !Number.isFinite(mapBounds.minX) || !Number.isFinite(mapBounds.maxX) || !Number.isFinite(mapBounds.minY) || !Number.isFinite(mapBounds.maxY)) {
    throw new TypeError('mapBounds must contain finite min/max X/Y');
  }
  assertFinite(metersPerMapUnit, 'metersPerMapUnit');
  if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
  return function sampleG65Terrain3DWorld(worldX, worldZ) {
    const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
    return sampleNormalized(normalized.x, normalized.y);
  };
}
