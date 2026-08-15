/**
 * Şafak Kartalı / G60 — qualified Terrain3D bake -> Three.js world sampler.
 *
 * Proof-only adapter: production height remains the continuous full-owner-map authority in terrain.js.
 * This module demonstrates deterministic world-coordinate sampling of the native G60 bake without
 * introducing a GeoCell edge, overlay or second production height authority.
 */
import { worldXZToNormalizedReference } from './worldReferenceAlignment.js';

export const G60_TERRAIN3D_RUNTIME_PARITY = Object.freeze({
  id: 'safak-kartali-g60-terrain3d-threejs-runtime-parity-2026-08-15-v1',
  geoCell: 'G60',
  layer: 'Terrain3D Bake/Three.js runtime parity',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  terrain3dVersion: '1.0.2-stable',
  sourceSize: 65,
  terrain3dImportSize: 257,
  terrain3dRegionSize: 256,
  baseTextureId: 0,
  overlayTextureId: 1,
  normalizedBounds: Object.freeze({ xMin: 6 / 8, xMax: 7 / 8, yMin: 0, yMax: 1 / 8 }),
});

const CHANNELS = Object.freeze(['heights', 'controlBlend', 'tintR', 'tintG', 'tintB', 'roughness']);
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

export function assertG60Terrain3DBakePayload(bake) {
  if (!bake || typeof bake !== 'object') throw new TypeError('G60 Terrain3D bake payload must be an object');
  if (bake.schema !== 'westeros-g60-terrain3d-runtime-bake-v1') throw new Error(`unexpected G60 bake schema: ${bake.schema}`);
  if (bake.policyId !== G60_TERRAIN3D_RUNTIME_PARITY.id) throw new Error(`unexpected G60 runtime parity policy: ${bake.policyId}`);
  if (bake.sourceMapSha256 !== G60_TERRAIN3D_RUNTIME_PARITY.sourceMapSha256) throw new Error('G60 bake map provenance mismatch');
  if (bake.width !== G60_TERRAIN3D_RUNTIME_PARITY.sourceSize || bake.height !== G60_TERRAIN3D_RUNTIME_PARITY.sourceSize) {
    throw new Error(`G60 bake must be ${G60_TERRAIN3D_RUNTIME_PARITY.sourceSize}x${G60_TERRAIN3D_RUNTIME_PARITY.sourceSize}`);
  }
  const expected = bake.width * bake.height;
  for (const channel of CHANNELS) {
    if (!Array.isArray(bake[channel]) || bake[channel].length !== expected) throw new Error(`invalid G60 bake channel ${channel}`);
    bake[channel].forEach((value, index) => finite(value, `${channel}[${index}]`));
  }
}

function bilinear(values, width, height, u, v) {
  const gx = clamp01(u) * (width - 1), gy = clamp01(v) * (height - 1);
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
  const tx = gx - x0, ty = gy - y0;
  const a = values[y0 * width + x0], b = values[y0 * width + x1];
  const c = values[y1 * width + x0], d = values[y1 * width + x1];
  return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
}

function localUv(normalizedX, normalizedY) {
  finite(normalizedX, 'normalizedX'); finite(normalizedY, 'normalizedY');
  const bounds = G60_TERRAIN3D_RUNTIME_PARITY.normalizedBounds, epsilon = 1e-9;
  if (normalizedX < bounds.xMin - epsilon || normalizedX > bounds.xMax + epsilon
    || normalizedY < bounds.yMin - epsilon || normalizedY > bounds.yMax + epsilon) {
    throw new RangeError('G60 parity sampler queried outside its qualified owner-map domain');
  }
  return Object.freeze({
    u: clamp01((normalizedX - bounds.xMin) / (bounds.xMax - bounds.xMin)),
    v: clamp01((normalizedY - bounds.yMin) / (bounds.yMax - bounds.yMin)),
  });
}

export function createG60Terrain3DBakeSampler(bake) {
  assertG60Terrain3DBakePayload(bake);
  return function sampleG60Terrain3DBake(normalizedX, normalizedY) {
    const { u, v } = localUv(normalizedX, normalizedY);
    const sample = {};
    for (const channel of CHANNELS) sample[channel] = bilinear(bake[channel], bake.width, bake.height, u, v);
    return Object.freeze({
      heightMeters: sample.heights,
      controlBlend: sample.controlBlend,
      tintR: sample.tintR, tintG: sample.tintG, tintB: sample.tintB,
      roughness: sample.roughness,
    });
  };
}

export function createG60Terrain3DWorldSampler(bake, { mapBounds, metersPerMapUnit }) {
  const sampleNormalized = createG60Terrain3DBakeSampler(bake);
  if (!mapBounds || !['minX', 'maxX', 'minY', 'maxY'].every((key) => Number.isFinite(mapBounds[key]))) {
    throw new TypeError('mapBounds must contain finite min/max X/Y');
  }
  finite(metersPerMapUnit, 'metersPerMapUnit');
  if (metersPerMapUnit <= 0) throw new RangeError('metersPerMapUnit must be > 0');
  return (worldX, worldZ) => {
    const normalized = worldXZToNormalizedReference(worldX, worldZ, mapBounds, metersPerMapUnit);
    return sampleNormalized(normalized.x, normalized.y);
  };
}
