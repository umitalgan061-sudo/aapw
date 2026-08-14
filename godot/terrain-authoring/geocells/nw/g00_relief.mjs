/**
 * Buzul Muhafızı / NW GeoCell G00 — Relief/Height Character.
 * GeoCell bounds are work addressing only. Height is sampled in normalized
 * owner-map space so the authored field stays continuous across cell seams.
 */
import {
  REFERENCE_BIOME_ZONES,
  REFERENCE_RELIEF_CHAINS,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G00_RELIEF_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g00-terrain3d-relief-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G00',
  gx: 0,
  gy: 0,
  layer: 'Relief/Height Character',
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 1 / 8, yMin: 0, yMax: 1 / 8 }),
  maskBounds: Object.freeze({ xMin: 0, xMax: 11, yMin: 0, yMax: 7 }),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
  terrain3dRegionSize: 256,
  sourceGridSize: 65,
  coastlineIso: 0.5,
  coastHalfSpanMeters: 2.5,
  defaultDryReliefMeters: 2.0,
  biomeReliefMeters: 36.0,
  chainReliefMeters: 68.0,
  reliefChainRadiusNormalized: 0.055,
  guardBandNormalized: 1 / 1536,
  normalProbeNormalized: 1 / 1536,
  worldWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
  worldDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function smoothstep(a, b, value) {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function isWater(surface) {
  return surface === 'sea' || surface === 'lake' ? 1 : 0;
}

function sampleWaterMaskCell(x, y) {
  const cx = clamp(x, 0, G00_RELIEF_POLICY.baseMaskWidth - 1);
  const cy = clamp(y, 0, G00_RELIEF_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface(
    (cx + 0.5) / G00_RELIEF_POLICY.baseMaskWidth,
    (cy + 0.5) / G00_RELIEF_POLICY.baseMaskHeight,
  ));
}

export function sampleG00CanonicalWaterConfidence(normalizedX, normalizedY) {
  const nx = clamp(normalizedX, 0, 1);
  const ny = clamp(normalizedY, 0, 1);
  const gx = nx * G00_RELIEF_POLICY.baseMaskWidth - 0.5;
  const gy = ny * G00_RELIEF_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const w00 = sampleWaterMaskCell(x0, y0);
  const w10 = sampleWaterMaskCell(x0 + 1, y0);
  const w01 = sampleWaterMaskCell(x0, y0 + 1);
  const w11 = sampleWaterMaskCell(x0 + 1, y0 + 1);
  const top = w00 + (w10 - w00) * tx;
  const bottom = w01 + (w11 - w01) * tx;
  return clamp(top + (bottom - top) * ty, 0, 1);
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
      strongest = Math.max(
        strongest,
        1 - smoothstep(0, G00_RELIEF_POLICY.reliefChainRadiusNormalized, distance),
      );
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
  // Preserve the influence envelope. Dividing by tiny total influence would make
  // a biome keep its full elevation bias right up to its ellipse boundary and
  // then fall to zero in one sample, creating an artificial cliff. Normalize
  // only when overlapping biome influence exceeds one.
  const blended = weighted / Math.max(1, total);
  return clamp(Math.max(strongest, blended), -0.25, 1);
}

export function sampleG00ReliefHeight(nx, ny) {
  const water = sampleG00CanonicalWaterConfidence(nx, ny);
  const signedCoast = (G00_RELIEF_POLICY.coastlineIso - water)
    * G00_RELIEF_POLICY.coastHalfSpanMeters * 2;
  const landFactor = 1 - smoothstep(0, 0.5, water);
  const biome = Math.max(0, sampleBiomeElevationSignal(nx, ny));
  const chain = sampleReliefChainInfluence(nx, ny);
  const dryRelief = G00_RELIEF_POLICY.defaultDryReliefMeters
    + biome * G00_RELIEF_POLICY.biomeReliefMeters
    + Math.pow(chain, 1.35) * G00_RELIEF_POLICY.chainReliefMeters;
  return signedCoast + landFactor * dryRelief;
}

export function sampleG00ReliefNormal(nx, ny) {
  const epsilon = G00_RELIEF_POLICY.normalProbeNormalized;
  const dhDnx = (sampleG00ReliefHeight(nx + epsilon, ny) - sampleG00ReliefHeight(nx - epsilon, ny)) / (2 * epsilon);
  const dhDny = (sampleG00ReliefHeight(nx, ny + epsilon) - sampleG00ReliefHeight(nx, ny - epsilon)) / (2 * epsilon);
  const slopeX = dhDnx / G00_RELIEF_POLICY.worldWidthMeters;
  const slopeZ = dhDny / G00_RELIEF_POLICY.worldDepthMeters;
  const length = Math.hypot(slopeX, 1, slopeZ);
  return Object.freeze({ x: -slopeX / length, y: 1 / length, z: -slopeZ / length });
}

function fnv1a(sum, value) {
  return Math.imul((sum ^ value) >>> 0, 16777619) >>> 0;
}

export function buildG00ReliefProbe() {
  const bounds = G00_RELIEF_POLICY.normalizedBounds;
  const size = G00_RELIEF_POLICY.sourceGridSize;
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
      const height = sampleG00ReliefHeight(nx, ny);
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
  const mask = G00_RELIEF_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) {
    for (let x = mask.xMin; x <= mask.xMax; x += 1) {
      const nx = (x + 0.5) / G00_RELIEF_POLICY.baseMaskWidth;
      const ny = (y + 0.5) / G00_RELIEF_POLICY.baseMaskHeight;
      const expectedWater = sampleWaterMaskCell(x, y) === 1;
      expectedWater ? canonicalWaterCells += 1 : canonicalLandCells += 1;
      if ((sampleG00ReliefHeight(nx, ny) < 0) !== expectedWater) canonicalSignMismatches += 1;
    }
  }

  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  const guard = G00_RELIEF_POLICY.guardBandNormalized;
  for (let i = 0; i < 65; i += 1) {
    const t = i / 64;
    const pairs = [
      [bounds.xMin, bounds.yMin + (bounds.yMax - bounds.yMin) * t, bounds.xMin - guard, bounds.yMin + (bounds.yMax - bounds.yMin) * t],
      [bounds.xMax, bounds.yMin + (bounds.yMax - bounds.yMin) * t, bounds.xMax + guard, bounds.yMin + (bounds.yMax - bounds.yMin) * t],
      [bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMin, bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMin - guard],
      [bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMax, bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMax + guard],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardHeightDelta = Math.max(
        maxGuardHeightDelta,
        Math.abs(sampleG00ReliefHeight(ax, ay) - sampleG00ReliefHeight(bx, by)),
      );
      const a = sampleG00ReliefNormal(ax, ay);
      const b = sampleG00ReliefNormal(bx, by);
      maxGuardNormalDelta = Math.max(
        maxGuardNormalDelta,
        Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
      );
    }
  }

  return Object.freeze({
    policyId: G00_RELIEF_POLICY.id,
    sourceMapSha256: G00_RELIEF_POLICY.sourceMapSha256,
    geoCell: G00_RELIEF_POLICY.geoCell,
    layer: G00_RELIEF_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G00_RELIEF_POLICY.terrain3dRegionSize,
    worldWidthMeters: Number(G00_RELIEF_POLICY.worldWidthMeters.toFixed(6)),
    worldDepthMeters: Number(G00_RELIEF_POLICY.worldDepthMeters.toFixed(6)),
    rows,
    canonicalWaterCells,
    canonicalLandCells,
    canonicalSignMismatches,
    minHeight: Number(minHeight.toFixed(6)),
    maxHeight: Number(maxHeight.toFixed(6)),
    heightSpan: Number((maxHeight - minHeight).toFixed(6)),
    maxAdjacentHeightStep: Number(maxAdjacentHeightStep.toFixed(6)),
    maxGuardHeightDelta: Number(maxGuardHeightDelta.toFixed(6)),
    maxGuardNormalDelta: Number(maxGuardNormalDelta.toFixed(6)),
    reliefChecksum: checksum,
  });
}
