/**
 * Kızıl Ufuk / SE GeoCell G65 — Relief/Height Character.
 *
 * GeoCell bounds are work addressing only. The height field is evaluated in
 * normalized owner-map space and explicitly reuses the merged G65 Hydrology
 * confidence/height field, so relief cannot introduce a square cell edge or
 * silently move the canonical coastline.
 */
import {
  REFERENCE_BIOME_ZONES,
  REFERENCE_RELIEF_CHAINS,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';
import { sampleG65HydrologyHeight, sampleG65WaterConfidence } from './g65_hydrology.mjs';

export const G65_RELIEF_POLICY = Object.freeze({
  id: 'kizil-ufuk-g65-terrain3d-relief-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G65',
  gx: 6,
  gy: 5,
  layer: 'Relief/Height Character',
  normalizedBounds: Object.freeze({ xMin: 6 / 8, xMax: 7 / 8, yMin: 5 / 8, yMax: 6 / 8 }),
  maskBounds: Object.freeze({ xMin: 72, xMax: 83, yMin: 40, yMax: 47 }),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  terrain3dImportSize: 257,
  defaultDryReliefMeters: 1.5,
  biomeReliefMeters: 22.0,
  chainReliefMeters: 68.0,
  reliefChainRadiusNormalized: 0.055,
  // One original map pixel. Probes cross each GeoCell edge in owner-map space.
  guardBandNormalized: 1 / 1536,
  normalProbeNormalized: 1 / 1536,
  worldWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
  worldDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
});

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
function smoothstep(a, b, value) {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared <= Number.EPSILON) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
function sampleReliefChainInfluence(nx, ny) {
  let strongest = 0;
  for (const chain of REFERENCE_RELIEF_CHAINS) {
    for (let i = 0; i + 1 < chain.points.length; i += 1) {
      const a = chain.points[i];
      const b = chain.points[i + 1];
      const distance = pointSegmentDistance(nx, ny, a[0], a[1], b[0], b[1]);
      strongest = Math.max(strongest, 1 - smoothstep(0, G65_RELIEF_POLICY.reliefChainRadiusNormalized, distance));
    }
  }
  return strongest;
}
function sampleBiomeElevationSignal(nx, ny) {
  let weighted = 0;
  let total = 0;
  let strongest = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(nx, ny, zone);
    if (influence <= 0) continue;
    const bias = Number.isFinite(zone.elevationBias) ? zone.elevationBias : 0;
    weighted += influence * bias;
    total += influence;
    strongest = Math.max(strongest, Math.max(0, bias) * influence);
  }
  return clamp(Math.max(strongest, total > 0 ? weighted / total : 0), -0.25, 1);
}
function isCanonicalWater(nx, ny) {
  const surface = classifyReferenceBaseSurface(nx, ny);
  return surface === 'sea' || surface === 'lake';
}

export function sampleG65ReliefHeight(nx, ny) {
  const waterConfidence = sampleG65WaterConfidence(nx, ny);
  const hydrologyHeight = sampleG65HydrologyHeight(nx, ny);
  // Keep relief out of the wet side of the already-merged hydrology transition.
  // Interior G65 is canonical dry land, while the global field can still taper
  // continuously toward the neighbouring coast just outside the work parcel.
  const landFactor = 1 - smoothstep(0.20, 0.70, waterConfidence);
  const biome = Math.max(0, sampleBiomeElevationSignal(nx, ny));
  const chain = sampleReliefChainInfluence(nx, ny);
  const dryRelief = G65_RELIEF_POLICY.defaultDryReliefMeters
    + biome * G65_RELIEF_POLICY.biomeReliefMeters
    + Math.pow(chain, 1.35) * G65_RELIEF_POLICY.chainReliefMeters;
  return hydrologyHeight + landFactor * dryRelief;
}

export function sampleG65ReliefNormal(nx, ny) {
  const e = G65_RELIEF_POLICY.normalProbeNormalized;
  const dhDnx = (sampleG65ReliefHeight(nx + e, ny) - sampleG65ReliefHeight(nx - e, ny)) / (2 * e);
  const dhDny = (sampleG65ReliefHeight(nx, ny + e) - sampleG65ReliefHeight(nx, ny - e)) / (2 * e);
  const slopeX = dhDnx / G65_RELIEF_POLICY.worldWidthMeters;
  const slopeZ = dhDny / G65_RELIEF_POLICY.worldDepthMeters;
  const length = Math.hypot(slopeX, 1, slopeZ);
  return Object.freeze({ x: -slopeX / length, y: 1 / length, z: -slopeZ / length });
}

function fnv1a(sum, value) {
  return Math.imul((sum ^ value) >>> 0, 16777619) >>> 0;
}

export function buildG65ReliefProbe() {
  const bounds = G65_RELIEF_POLICY.normalizedBounds;
  const size = G65_RELIEF_POLICY.sourceGridSize;
  const rows = [];
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let maxAdjacentHeightStep = 0;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
      const height = sampleG65ReliefHeight(nx, ny);
      row.push(Number(height.toFixed(6)));
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      checksum = fnv1a(checksum, Math.round((height + 128) * 1000));
      if (x > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(height - row[x - 1]));
      if (y > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(height - rows[y - 1][x]));
    }
    rows.push(row);
  }

  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let canonicalSignMismatches = 0;
  let minCanonicalLandHeight = Infinity;
  const mask = G65_RELIEF_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const nx = (x + 0.5) / G65_RELIEF_POLICY.baseMaskWidth;
      const ny = (y + 0.5) / G65_RELIEF_POLICY.baseMaskHeight;
      const expectedWater = isCanonicalWater(nx, ny);
      const height = sampleG65ReliefHeight(nx, ny);
      if (expectedWater) canonicalWaterCells += 1;
      else {
        canonicalLandCells += 1;
        minCanonicalLandHeight = Math.min(minCanonicalLandHeight, height);
      }
      if ((height < 0) !== expectedWater) canonicalSignMismatches += 1;
    }
  }

  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  const guard = G65_RELIEF_POLICY.guardBandNormalized;
  for (let i = 0; i < 65; i += 1) {
    const t = i / 64;
    const edgeY = bounds.yMin + (bounds.yMax - bounds.yMin) * t;
    const edgeX = bounds.xMin + (bounds.xMax - bounds.xMin) * t;
    const pairs = [
      [bounds.xMin, edgeY, bounds.xMin - guard, edgeY],
      [bounds.xMax, edgeY, bounds.xMax + guard, edgeY],
      [edgeX, bounds.yMin, edgeX, bounds.yMin - guard],
      [edgeX, bounds.yMax, edgeX, bounds.yMax + guard],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(sampleG65ReliefHeight(ax, ay) - sampleG65ReliefHeight(bx, by)));
      const a = sampleG65ReliefNormal(ax, ay);
      const b = sampleG65ReliefNormal(bx, by);
      maxGuardNormalDelta = Math.max(maxGuardNormalDelta, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }

  return Object.freeze({
    policyId: G65_RELIEF_POLICY.id,
    sourceMapSha256: G65_RELIEF_POLICY.sourceMapSha256,
    geoCell: G65_RELIEF_POLICY.geoCell,
    layer: G65_RELIEF_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G65_RELIEF_POLICY.terrain3dRegionSize,
    terrain3dImportSize: G65_RELIEF_POLICY.terrain3dImportSize,
    worldWidthMeters: Number(G65_RELIEF_POLICY.worldWidthMeters.toFixed(6)),
    worldDepthMeters: Number(G65_RELIEF_POLICY.worldDepthMeters.toFixed(6)),
    rows,
    canonicalWaterCells,
    canonicalLandCells,
    canonicalSignMismatches,
    minCanonicalLandHeight: Number(minCanonicalLandHeight.toFixed(6)),
    minHeight: Number(minHeight.toFixed(6)),
    maxHeight: Number(maxHeight.toFixed(6)),
    heightSpan: Number((maxHeight - minHeight).toFixed(6)),
    maxAdjacentHeightStep: Number(maxAdjacentHeightStep.toFixed(6)),
    maxGuardHeightDelta: Number(maxGuardHeightDelta.toFixed(6)),
    maxGuardNormalDelta: Number(maxGuardNormalDelta.toFixed(6)),
    reliefChecksum: checksum,
  });
}
