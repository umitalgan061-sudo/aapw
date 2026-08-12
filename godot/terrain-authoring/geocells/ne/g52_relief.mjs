/**
 * Şafak Kartalı / NE GeoCell G52 — Relief/Height Character.
 *
 * GeoCell coordinates are addressing only. The height function is evaluated in
 * continuous owner-map normalized space and deliberately contains no cell-edge
 * term, so the authored relief can cross G52 guard bands without a square seam.
 */
import {
  WORLD_REFERENCE_MAP,
  REFERENCE_BIOME_ZONES,
  REFERENCE_RELIEF_CHAINS,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import {
  WORLD_REFERENCE_WATER_MASK,
  sampleReferenceWaterMask,
} from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G52_RELIEF_POLICY = Object.freeze({
  id: 'safak-kartali-g52-terrain3d-relief-2026-08-12-v1',
  sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
  geoCell: 'G52',
  gx: 5,
  gy: 2,
  layer: 'Relief/Height Character',
  pixelBounds: Object.freeze({ xMin: 960, xMax: 1152, yMin: 256, yMax: 384 }),
  normalizedBounds: Object.freeze({ xMin: 0.625, xMax: 0.75, yMin: 0.25, yMax: 0.375 }),
  terrain3dRegionSize: 256,
  sourceGridSize: 65,
  guardBandNormalized: 1 / 96,
  seaFloorMeters: -7.5,
  minimumDryMeters: 0.75,
  ridgeWidthPixels: 118,
  maxReliefMeters: 132,
});

const BONE_BIOME = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'bone-mountains');
const BONE_CHAIN = REFERENCE_RELIEF_CHAINS.find((chain) => chain.id === 'bone-mountains');
if (!BONE_BIOME || !BONE_CHAIN) throw new Error('canonical Bone Mountains controls missing');

function clamp01(value) {
  if (!Number.isFinite(value)) throw new TypeError('normalized coordinate must be finite');
  return Math.min(1, Math.max(0, value));
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function waterCell(ix, iy) {
  const x = Math.max(0, Math.min(WORLD_REFERENCE_WATER_MASK.width - 1, ix));
  const y = Math.max(0, Math.min(WORLD_REFERENCE_WATER_MASK.height - 1, iy));
  return sampleReferenceWaterMask(
    (x + 0.5) / WORLD_REFERENCE_WATER_MASK.width,
    (y + 0.5) / WORLD_REFERENCE_WATER_MASK.height,
  ) ? 1 : 0;
}

/** Bilinear confidence over canonical mask-cell centres; exact at every centre. */
export function sampleG52WaterConfidence(normalizedX, normalizedY) {
  const x = clamp01(normalizedX) * WORLD_REFERENCE_WATER_MASK.width - 0.5;
  const y = clamp01(normalizedY) * WORLD_REFERENCE_WATER_MASK.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const a = waterCell(x0, y0);
  const b = waterCell(x1, y0);
  const c = waterCell(x0, y1);
  const d = waterCell(x1, y1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return clamp01(top + (bottom - top) * ty);
}

function pointSegmentDistancePixels(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const length2 = abx * abx + aby * aby;
  if (length2 <= Number.EPSILON) return Math.hypot(px - ax, py - ay);
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / length2);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

/** Continuous distance to canonical Bone Mountains polyline in source-image pixels. */
export function distanceToBoneMountainsPixels(normalizedX, normalizedY) {
  const px = clamp01(normalizedX) * WORLD_REFERENCE_MAP.pixelWidth;
  const py = clamp01(normalizedY) * WORLD_REFERENCE_MAP.pixelHeight;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < BONE_CHAIN.points.length - 1; i += 1) {
    const a = BONE_CHAIN.points[i];
    const b = BONE_CHAIN.points[i + 1];
    best = Math.min(best, pointSegmentDistancePixels(
      px,
      py,
      a[0] * WORLD_REFERENCE_MAP.pixelWidth,
      a[1] * WORLD_REFERENCE_MAP.pixelHeight,
      b[0] * WORLD_REFERENCE_MAP.pixelWidth,
      b[1] * WORLD_REFERENCE_MAP.pixelHeight,
    ));
  }
  return best;
}

export function sampleG52ReliefComponents(normalizedX, normalizedY) {
  const x = clamp01(normalizedX);
  const y = clamp01(normalizedY);
  const waterConfidence = sampleG52WaterConfidence(x, y);
  const landConfidence = 1 - waterConfidence;
  const boneBiome = sampleReferenceInfluence(x, y, BONE_BIOME);
  const ridgeDistancePixels = distanceToBoneMountainsPixels(x, y);
  const ridgeInfluence = smoothstep01(1 - ridgeDistancePixels / G52_RELIEF_POLICY.ridgeWidthPixels);

  // Deterministic low-amplitude ridges/valleys, gated by canonical relief influence.
  // Frequencies are in whole-map normalized space, never in GeoCell-local coordinates.
  const ridgePhase = Math.sin((x * 17.0 + y * 5.5) * Math.PI);
  const valleyPhase = Math.cos((x * 7.0 - y * 11.0) * Math.PI);
  const microRelief = (ridgePhase * 0.65 + valleyPhase * 0.35) * (3.5 + ridgeInfluence * 7.5);

  const upland = 8.0
    + boneBiome * 46.0
    + ridgeInfluence * 72.0
    + microRelief * Math.max(boneBiome, ridgeInfluence);
  const dryHeight = Math.max(G52_RELIEF_POLICY.minimumDryMeters, Math.min(G52_RELIEF_POLICY.maxReliefMeters, upland));
  const seaHeight = G52_RELIEF_POLICY.seaFloorMeters - waterConfidence * 3.5;
  const coastWeight = smoothstep01(landConfidence);
  const heightMeters = seaHeight + (dryHeight - seaHeight) * coastWeight;

  return Object.freeze({
    normalizedX: x,
    normalizedY: y,
    waterConfidence,
    landConfidence,
    boneBiome,
    ridgeDistancePixels,
    ridgeInfluence,
    dryHeightMeters: dryHeight,
    heightMeters,
  });
}

export function sampleG52ReliefHeight(normalizedX, normalizedY) {
  return sampleG52ReliefComponents(normalizedX, normalizedY).heightMeters;
}
