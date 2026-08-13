import {
  REFERENCE_WATER_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import {
  G17,
  sampleG17HydrologyHeight,
  sampleG17WaterConfidence,
} from './g17_hydrology.mjs';

export const G17_BIOME_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g17-macro-biome-2026-08-13-v1',
  schema: 'westeros-g17-biome-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: G17.id,
  layer: 'Macro Albedo/Biome',
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  sourceVertexStride: 4,
  guardBandNormalizedX: 1 / 96,
  guardBandNormalizedY: 1 / 64,
});

const SUNSET = REFERENCE_WATER_ZONES.find((zone) => zone.id === 'sunset-sea');
const SUMMER = REFERENCE_WATER_ZONES.find((zone) => zone.id === 'summer-sea');
if (!SUNSET || !SUMMER) throw new Error('sunset-sea and summer-sea reference zones are required');

const DEEP_SEA = Object.freeze([0.075, 0.165, 0.215]);
const SHELF_SEA = Object.freeze([0.16, 0.30, 0.34]);
const SUNSET_SEA = Object.freeze([0.12, 0.255, 0.31]);
const SUMMER_SEA = Object.freeze([0.14, 0.29, 0.33]);

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

function mixColor(a, b, t) {
  return Object.freeze([
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ]);
}

export function sampleG17Biome(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const waterConfidence = sampleG17WaterConfidence(x, y);
  const sunset = sampleReferenceInfluence(x, y, SUNSET);
  const summer = sampleReferenceInfluence(x, y, SUMMER);

  // Keep the same owner-map macro marine field used by the qualified G07 runtime source.
  // This makes the G07/G17 west seam a continuation of one global formula rather than a cell paint.
  const southShelf = clamp01((y - 0.80) / 0.20);
  const westShelf = clamp01((0.16 - x) / 0.16);
  const shelf = clamp01(0.42 * southShelf + 0.22 * westShelf + 0.36 * Math.max(sunset, summer));
  let color = mixColor(DEEP_SEA, SHELF_SEA, shelf);
  color = mixColor(color, SUNSET_SEA, 0.55 * sunset);
  color = mixColor(color, SUMMER_SEA, 0.35 * summer);

  // Macro substrate roughness only. Near-detail micro roughness remains a later G17 layer.
  const roughness = clamp01(0.74 + 0.10 * shelf + 0.03 * sunset + 0.02 * summer);

  return Object.freeze({
    height: sampleG17HydrologyHeight(x, y),
    waterConfidence,
    marineWeight: waterConfidence,
    landWeight: 1 - waterConfidence,
    color,
    roughness,
    shelf,
    sunset,
    summer,
  });
}

export function buildG17BiomeSource(size = G17_BIOME_POLICY.sourceGridSize) {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('size must be an integer >= 2');
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(G17.normalizedBounds.minY, G17.normalizedBounds.maxY, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(G17.normalizedBounds.minX, G17.normalizedBounds.maxX, x / (size - 1));
      const sample = sampleG17Biome(nx, ny);
      row.push(Object.freeze([
        +sample.height.toFixed(8),
        +sample.color[0].toFixed(8),
        +sample.color[1].toFixed(8),
        +sample.color[2].toFixed(8),
        +sample.roughness.toFixed(8),
        +sample.waterConfidence.toFixed(8),
        +sample.marineWeight.toFixed(8),
        +sample.landWeight.toFixed(8),
        +sample.shelf.toFixed(8),
        +sample.sunset.toFixed(8),
        +sample.summer.toFixed(8),
      ]));
    }
    rows.push(Object.freeze(row));
  }
  return Object.freeze({
    schema: G17_BIOME_POLICY.schema,
    policyId: G17_BIOME_POLICY.id,
    sourceMapSha256: G17_BIOME_POLICY.sourceMapSha256,
    geoCell: G17.id,
    layer: G17_BIOME_POLICY.layer,
    normalizedBounds: G17.normalizedBounds,
    sourcePixels: G17.sourcePixels,
    sourceGridSize: size,
    terrain3dRegionSize: G17_BIOME_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G17_BIOME_POLICY.terrain3dImportSize,
    sourceVertexStride: G17_BIOME_POLICY.sourceVertexStride,
    rows: Object.freeze(rows),
  });
}
