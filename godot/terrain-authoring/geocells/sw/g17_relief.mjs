import { G17 } from './g17_hydrology.mjs';
import { sampleG17Biome } from './g17_biome.mjs';
import { sampleG07RuntimeBakeSource, sampleG07RuntimeBakeNormal } from './g07_runtime_bake_source.mjs';

export { G17 };

export const G17_RELIEF_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g17-terrain3d-relief-2026-08-13-v1',
  schema: 'westeros-g17-relief-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: G17.id,
  layer: 'Relief/Height Character',
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  sourceVertexStride: 4,
  referenceWorldMeters: Object.freeze({ x: 13296.079, z: 10341.395 }),
  deepSeabedMeters: -9.0,
  shelfRiseMeters: 4.25,
  waterCeilingMeters: -2.5,
  guardBandNormalizedX: 1 / 1536,
  guardBandNormalizedY: 1 / 1024,
});

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * G17 continues the exact qualified G07 global bathymetry field. The inputs are
 * owner-map coordinates only; the GeoCell boundary is never a height term.
 */
export function sampleG17Relief(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const biome = sampleG17Biome(x, y);
  const southShelf = smoothstep(0.82, 1.0, y);
  const westShelf = 1 - smoothstep(0.0, 0.18, x);
  const shelf = clamp01(0.55 * biome.sunset + 0.25 * southShelf + 0.20 * westShelf);
  const height = G17_RELIEF_POLICY.deepSeabedMeters + G17_RELIEF_POLICY.shelfRiseMeters * shelf;

  return Object.freeze({
    ...biome,
    height,
    reliefShelf: shelf,
    southShelf,
    westShelf,
  });
}

export function sampleG17ReliefNormal(normalizedX, normalizedY) {
  const epsilon = 1 / 1536;
  const left = sampleG17Relief(normalizedX - epsilon, normalizedY).height;
  const right = sampleG17Relief(normalizedX + epsilon, normalizedY).height;
  const down = sampleG17Relief(normalizedX, normalizedY - epsilon).height;
  const up = sampleG17Relief(normalizedX, normalizedY + epsilon).height;
  const dxMeters = 2 * epsilon * G17_RELIEF_POLICY.referenceWorldMeters.x;
  const dzMeters = 2 * epsilon * G17_RELIEF_POLICY.referenceWorldMeters.z;
  const nx = -(right - left) / dxMeters;
  const ny = 1;
  const nz = -(up - down) / dzMeters;
  const length = Math.hypot(nx, ny, nz) || 1;
  return Object.freeze([nx / length, ny / length, nz / length]);
}

/**
 * Direct proof that G17's west edge is the same mathematical relief field as
 * the already merged G07 runtime-bake source, not an independently tuned tile.
 */
export function sampleG17WestG07Parity(normalizedY) {
  const y = clamp01(normalizedY);
  const x = G17.normalizedBounds.minX;
  const g17 = sampleG17Relief(x, y);
  const g07 = sampleG07RuntimeBakeSource(x, y);
  const g17Normal = sampleG17ReliefNormal(x, y);
  const g07Normal = sampleG07RuntimeBakeNormal(x, y);
  return Object.freeze({
    heightDelta: Math.abs(g17.height - g07.height),
    normalDelta: Math.hypot(
      g17Normal[0] - g07Normal[0],
      g17Normal[1] - g07Normal[1],
      g17Normal[2] - g07Normal[2],
    ),
  });
}

export function buildG17ReliefSource(size = G17_RELIEF_POLICY.sourceGridSize) {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('size must be an integer >= 2');
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(G17.normalizedBounds.minY, G17.normalizedBounds.maxY, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(G17.normalizedBounds.minX, G17.normalizedBounds.maxX, x / (size - 1));
      const sample = sampleG17Relief(nx, ny);
      const normal = sampleG17ReliefNormal(nx, ny);
      row.push(Object.freeze([
        +sample.height.toFixed(8),
        +sample.color[0].toFixed(8),
        +sample.color[1].toFixed(8),
        +sample.color[2].toFixed(8),
        +sample.roughness.toFixed(8),
        +sample.waterConfidence.toFixed(8),
        +sample.marineWeight.toFixed(8),
        +sample.landWeight.toFixed(8),
        +sample.reliefShelf.toFixed(8),
        +sample.sunset.toFixed(8),
        +sample.summer.toFixed(8),
        +normal[0].toFixed(10),
        +normal[1].toFixed(10),
        +normal[2].toFixed(10),
      ]));
    }
    rows.push(Object.freeze(row));
  }
  return Object.freeze({
    schema: G17_RELIEF_POLICY.schema,
    policyId: G17_RELIEF_POLICY.id,
    sourceMapSha256: G17_RELIEF_POLICY.sourceMapSha256,
    geoCell: G17.id,
    layer: G17_RELIEF_POLICY.layer,
    normalizedBounds: G17.normalizedBounds,
    sourcePixels: G17.sourcePixels,
    sourceGridSize: size,
    terrain3dRegionSize: G17_RELIEF_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G17_RELIEF_POLICY.terrain3dImportSize,
    sourceVertexStride: G17_RELIEF_POLICY.sourceVertexStride,
    waterCeilingMeters: G17_RELIEF_POLICY.waterCeilingMeters,
    rows: Object.freeze(rows),
  });
}
