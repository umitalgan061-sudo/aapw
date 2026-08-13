/**
 * Günbatımı Ustası / SW G07 final Terrain3D bake source.
 *
 * This self-contained source composes the previously qualified G07 marine biome, relief,
 * submerged-rock and merged near-detail fields into one continuous authoring payload. GeoCell
 * bounds remain addressing metadata only: every field is evaluated from global owner-map
 * normalized coordinates and the north/east guard probes continue the same formulas beyond G07.
 */
import {
  REFERENCE_WATER_ZONES,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';
import { sampleG07NearDetail } from './g07_near_detail.mjs';

export const G07_RUNTIME_BAKE_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g07-terrain3d-runtime-bake-2026-08-13-v2',
  schema: 'westeros-g07-runtime-source-v2',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G07',
  gx: 0,
  gy: 7,
  layer: 'Terrain3D Bake / Three.js Runtime Parity',
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.875, yMax: 1 }),
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  sourceVertexStride: 4,
  substrateTextureId: 0,
  rockTextureId: 1,
  snowTextureId: 4,
  roadTextureId: 2,
  pathTextureId: 3,
  referenceWorldMeters: Object.freeze({ x: 13296.079, z: 10341.395 }),
  deepSeabedMeters: -9.0,
  shelfRiseMeters: 4.25,
  waterCeilingMeters: -2.5,
  guardBandNormalized: 1 / 1536,
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
function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function normalDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
function fnv1a(hash, value) {
  hash ^= value & 0xff;
  return Math.imul(hash, 16777619) >>> 0;
}

export function sampleG07RuntimeBakeSource(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const canonicalWater = sampleReferenceWaterMask(x, y) ? 1 : 0;
  const sunset = sampleReferenceInfluence(x, y, SUNSET);
  const summer = sampleReferenceInfluence(x, y, SUMMER);

  // Relief provenance: G07 Relief/Height Character #290. Continuous global shelf terms only.
  const reliefSouthShelf = smoothstep(0.82, 1.0, y);
  const reliefWestShelf = 1 - smoothstep(0.0, 0.18, x);
  const reliefShelf = clamp01(0.55 * sunset + 0.25 * reliefSouthShelf + 0.20 * reliefWestShelf);
  const height = G07_RUNTIME_BAKE_POLICY.deepSeabedMeters
    + G07_RUNTIME_BAKE_POLICY.shelfRiseMeters * reliefShelf;

  // Rock/Snow provenance: #297. Snow stays zero in canonical open sea.
  const rockWestShelf = 1 - smoothstep(0.02, 0.22, x);
  const rockSouthShelf = smoothstep(0.78, 1.0, y);
  const rockBlend = canonicalWater * clamp01(
    0.10 + 0.22 * sunset + 0.18 * rockWestShelf + 0.12 * rockSouthShelf,
  );

  // Macro Albedo/Biome provenance: #287. Continuous marine owner-map color, no cell-edge term.
  const biomeSouthShelf = clamp01((y - 0.80) / 0.20);
  const biomeWestShelf = clamp01((0.16 - x) / 0.16);
  const biomeShelf = clamp01(0.42 * biomeSouthShelf + 0.22 * biomeWestShelf + 0.36 * Math.max(sunset, summer));
  let color = mixColor(DEEP_SEA, SHELF_SEA, biomeShelf);
  color = mixColor(color, SUNSET_SEA, 0.55 * sunset);
  color = mixColor(color, SUMMER_SEA, 0.35 * summer);

  // Near Detail is the merged G07 source. Encode micro variation as Terrain3D color-map roughness
  // so it coexists with the Rock/Snow control map rather than replacing the rock overlay slot.
  const nearDetail = sampleG07NearDetail(x, y);
  const roughness = clamp01(0.70 + 0.24 * nearDetail.detailBlend + 0.05 * rockBlend);

  return Object.freeze({
    canonicalWater,
    height,
    rockBlend,
    snowBlend: 0,
    roadBlend: 0,
    pathBlend: 0,
    color: Object.freeze(color),
    roughness,
    detailBlend: nearDetail.detailBlend,
    sunset,
    summer,
  });
}

export function sampleG07RuntimeBakeNormal(normalizedX, normalizedY) {
  const epsilon = 1 / 1536;
  const left = sampleG07RuntimeBakeSource(normalizedX - epsilon, normalizedY).height;
  const right = sampleG07RuntimeBakeSource(normalizedX + epsilon, normalizedY).height;
  const down = sampleG07RuntimeBakeSource(normalizedX, normalizedY - epsilon).height;
  const up = sampleG07RuntimeBakeSource(normalizedX, normalizedY + epsilon).height;
  const dxMeters = 2 * epsilon * G07_RUNTIME_BAKE_POLICY.referenceWorldMeters.x;
  const dzMeters = 2 * epsilon * G07_RUNTIME_BAKE_POLICY.referenceWorldMeters.z;
  const nx = -(right - left) / dxMeters;
  const ny = 1;
  const nz = -(up - down) / dzMeters;
  const length = Math.hypot(nx, ny, nz) || 1;
  return Object.freeze([nx / length, ny / length, nz / length]);
}

export function measureG07RuntimeBakeSource() {
  const { xMin, xMax, yMin, yMax } = G07_RUNTIME_BAKE_POLICY.normalizedBounds;
  const size = G07_RUNTIME_BAKE_POLICY.sourceGridSize;
  const rows = [];
  let canonicalWaterSamples = 0;
  let canonicalLandSamples = 0;
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let minRockBlend = 1;
  let maxRockBlend = 0;
  let minRoughness = 1;
  let maxRoughness = 0;
  let maxAdjacentHeightDelta = 0;
  let maxAdjacentRockDelta = 0;
  let maxAdjacentColorDelta = 0;
  let maxAdjacentRoughnessDelta = 0;
  let maxSnowBlend = 0;
  let maxRoadBlend = 0;
  let maxPathBlend = 0;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = lerp(yMin, yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(xMin, xMax, x / (size - 1));
      const sample = sampleG07RuntimeBakeSource(nx, ny);
      row.push(sample);
      canonicalWaterSamples += sample.canonicalWater;
      canonicalLandSamples += 1 - sample.canonicalWater;
      minHeight = Math.min(minHeight, sample.height);
      maxHeight = Math.max(maxHeight, sample.height);
      minRockBlend = Math.min(minRockBlend, sample.rockBlend);
      maxRockBlend = Math.max(maxRockBlend, sample.rockBlend);
      minRoughness = Math.min(minRoughness, sample.roughness);
      maxRoughness = Math.max(maxRoughness, sample.roughness);
      maxSnowBlend = Math.max(maxSnowBlend, sample.snowBlend);
      maxRoadBlend = Math.max(maxRoadBlend, sample.roadBlend);
      maxPathBlend = Math.max(maxPathBlend, sample.pathBlend);
      checksum = fnv1a(checksum, Math.round((sample.height + 16) * 100));
      checksum = fnv1a(checksum, Math.round(sample.rockBlend * 255));
      checksum = fnv1a(checksum, Math.round(sample.roughness * 255));
      for (const component of sample.color) checksum = fnv1a(checksum, Math.round(component * 255));
    }
    rows.push(row);
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sample = rows[y][x];
      for (const neighbor of [x + 1 < size ? rows[y][x + 1] : null, y + 1 < size ? rows[y + 1][x] : null]) {
        if (!neighbor) continue;
        maxAdjacentHeightDelta = Math.max(maxAdjacentHeightDelta, Math.abs(sample.height - neighbor.height));
        maxAdjacentRockDelta = Math.max(maxAdjacentRockDelta, Math.abs(sample.rockBlend - neighbor.rockBlend));
        maxAdjacentColorDelta = Math.max(maxAdjacentColorDelta, colorDistance(sample.color, neighbor.color));
        maxAdjacentRoughnessDelta = Math.max(maxAdjacentRoughnessDelta, Math.abs(sample.roughness - neighbor.roughness));
      }
    }
  }

  const guard = G07_RUNTIME_BAKE_POLICY.guardBandNormalized;
  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  let maxGuardRockDelta = 0;
  let maxGuardColorDelta = 0;
  let maxGuardRoughnessDelta = 0;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1);
    const nx = lerp(xMin, xMax, t);
    const ny = lerp(yMin, yMax, t);
    for (const [ax, ay, bx, by] of [
      [xMax, ny, xMax + guard, ny],
      [nx, yMin - guard, nx, yMin],
    ]) {
      const a = sampleG07RuntimeBakeSource(ax, ay);
      const b = sampleG07RuntimeBakeSource(bx, by);
      maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(a.height - b.height));
      maxGuardNormalDelta = Math.max(maxGuardNormalDelta, normalDistance(
        sampleG07RuntimeBakeNormal(ax, ay), sampleG07RuntimeBakeNormal(bx, by),
      ));
      maxGuardRockDelta = Math.max(maxGuardRockDelta, Math.abs(a.rockBlend - b.rockBlend));
      maxGuardColorDelta = Math.max(maxGuardColorDelta, colorDistance(a.color, b.color));
      maxGuardRoughnessDelta = Math.max(maxGuardRoughnessDelta, Math.abs(a.roughness - b.roughness));
    }
  }

  return Object.freeze({
    policyId: G07_RUNTIME_BAKE_POLICY.id,
    schema: G07_RUNTIME_BAKE_POLICY.schema,
    sourceMapSha256: G07_RUNTIME_BAKE_POLICY.sourceMapSha256,
    geoCell: 'G07',
    layer: G07_RUNTIME_BAKE_POLICY.layer,
    sourceSamples: size * size,
    canonicalWaterSamples,
    canonicalLandSamples,
    minHeight: +minHeight.toFixed(8),
    maxHeight: +maxHeight.toFixed(8),
    minRockBlend: +minRockBlend.toFixed(8),
    maxRockBlend: +maxRockBlend.toFixed(8),
    minRoughness: +minRoughness.toFixed(8),
    maxRoughness: +maxRoughness.toFixed(8),
    maxSnowBlend,
    maxRoadBlend,
    maxPathBlend,
    maxAdjacentHeightDelta: +maxAdjacentHeightDelta.toFixed(8),
    maxAdjacentRockDelta: +maxAdjacentRockDelta.toFixed(8),
    maxAdjacentColorDelta: +maxAdjacentColorDelta.toFixed(8),
    maxAdjacentRoughnessDelta: +maxAdjacentRoughnessDelta.toFixed(8),
    maxGuardHeightDelta: +maxGuardHeightDelta.toFixed(8),
    maxGuardNormalDelta: +maxGuardNormalDelta.toFixed(8),
    maxGuardRockDelta: +maxGuardRockDelta.toFixed(8),
    maxGuardColorDelta: +maxGuardColorDelta.toFixed(8),
    maxGuardRoughnessDelta: +maxGuardRoughnessDelta.toFixed(8),
    sourceChecksum: checksum,
  });
}

export function buildG07RuntimeBakeSource() {
  const { xMin, xMax, yMin, yMax } = G07_RUNTIME_BAKE_POLICY.normalizedBounds;
  const size = G07_RUNTIME_BAKE_POLICY.sourceGridSize;
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(yMin, yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(xMin, xMax, x / (size - 1));
      const s = sampleG07RuntimeBakeSource(nx, ny);
      row.push([
        +s.height.toFixed(8),
        +s.rockBlend.toFixed(8),
        s.snowBlend,
        s.roadBlend,
        s.pathBlend,
        +s.color[0].toFixed(8),
        +s.color[1].toFixed(8),
        +s.color[2].toFixed(8),
        +s.roughness.toFixed(8),
        +s.detailBlend.toFixed(8),
      ]);
    }
    rows.push(row);
  }
  return Object.freeze({
    schema: G07_RUNTIME_BAKE_POLICY.schema,
    policyId: G07_RUNTIME_BAKE_POLICY.id,
    sourceMapSha256: G07_RUNTIME_BAKE_POLICY.sourceMapSha256,
    geoCell: 'G07',
    layer: G07_RUNTIME_BAKE_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G07_RUNTIME_BAKE_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G07_RUNTIME_BAKE_POLICY.terrain3dImportSize,
    sourceVertexStride: G07_RUNTIME_BAKE_POLICY.sourceVertexStride,
    normalizedBounds: G07_RUNTIME_BAKE_POLICY.normalizedBounds,
    substrateTextureId: G07_RUNTIME_BAKE_POLICY.substrateTextureId,
    rockTextureId: G07_RUNTIME_BAKE_POLICY.rockTextureId,
    snowTextureId: G07_RUNTIME_BAKE_POLICY.snowTextureId,
    roadTextureId: G07_RUNTIME_BAKE_POLICY.roadTextureId,
    pathTextureId: G07_RUNTIME_BAKE_POLICY.pathTextureId,
    waterCeilingMeters: G07_RUNTIME_BAKE_POLICY.waterCeilingMeters,
    rows,
  });
}
