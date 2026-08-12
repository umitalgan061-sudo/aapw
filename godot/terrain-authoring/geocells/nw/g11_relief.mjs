/**
 * Buzul Muhafızı / NW GeoCell G11 Relief/Height Character.
 *
 * G11 bounds are work-addressing only. Height is sampled in normalized owner-map
 * space from the canonical hydrology, biome elevation biases and relief-chain
 * controls, so the field remains continuous through the GeoCell boundary.
 */

import {
  REFERENCE_BIOME_ZONES,
  REFERENCE_RELIEF_CHAINS,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';
import { G11_HYDROLOGY_POLICY, measureG11Hydrology } from './g11_hydrology.mjs';

export const G11_RELIEF_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g11-terrain3d-relief-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G11',
  gx: 1,
  gy: 1,
  layer: 'Relief/Height Character',
  normalizedBounds: G11_HYDROLOGY_POLICY.normalizedBounds,
  terrain3dRegionSize: 256,
  sourceGridSize: 65,
  coastlineIso: 0.5,
  coastHalfSpanMeters: 3.0,
  openWaterDepthMeters: 7.0,
  defaultDryReliefMeters: 2.0,
  biomeReliefMeters: 28.0,
  chainReliefMeters: 72.0,
  reliefChainRadiusNormalized: 0.055,
  guardBandNormalized: 1 / 1536,
  normalProbeNormalized: 1 / 1536,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function isWater(surface) {
  return surface === 'sea' || surface === 'lake' ? 1 : 0;
}

function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G11_HYDROLOGY_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G11_HYDROLOGY_POLICY.baseMaskHeight - 1);
  const nx = (x + 0.5) / G11_HYDROLOGY_POLICY.baseMaskWidth;
  const ny = (y + 0.5) / G11_HYDROLOGY_POLICY.baseMaskHeight;
  return isWater(classifyReferenceBaseSurface(nx, ny));
}

/** Continuous canonical hydrology confidence valid across G11 guard bands. */
export function sampleCanonicalWaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  const nx = clamp(normalizedX, 0, 1);
  const ny = clamp(normalizedY, 0, 1);
  const gridX = nx * G11_HYDROLOGY_POLICY.baseMaskWidth - 0.5;
  const gridY = ny * G11_HYDROLOGY_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const w00 = sampleWaterAtMaskCell(x0, y0);
  const w10 = sampleWaterAtMaskCell(x0 + 1, y0);
  const w01 = sampleWaterAtMaskCell(x0, y0 + 1);
  const w11 = sampleWaterAtMaskCell(x0 + 1, y0 + 1);
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
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  return Math.hypot(px - qx, py - qy);
}

function sampleReliefChainInfluence(normalizedX, normalizedY) {
  let strongest = 0;
  for (const chain of REFERENCE_RELIEF_CHAINS) {
    for (let index = 0; index + 1 < chain.points.length; index += 1) {
      const a = chain.points[index];
      const b = chain.points[index + 1];
      const distance = pointSegmentDistance(normalizedX, normalizedY, a[0], a[1], b[0], b[1]);
      const influence = 1 - smoothstep(0, G11_RELIEF_POLICY.reliefChainRadiusNormalized, distance);
      strongest = Math.max(strongest, influence);
    }
  }
  return strongest;
}

function sampleBiomeElevationSignal(normalizedX, normalizedY) {
  let weighted = 0;
  let totalWeight = 0;
  let strongest = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(normalizedX, normalizedY, zone);
    if (influence <= 0) continue;
    const bias = Number.isFinite(zone.elevationBias) ? zone.elevationBias : 0;
    weighted += influence * bias;
    totalWeight += influence;
    strongest = Math.max(strongest, Math.max(0, bias) * influence);
  }
  const averaged = totalWeight > 0 ? weighted / totalWeight : 0;
  return clamp(Math.max(strongest, averaged), -0.25, 1);
}

/**
 * Continuous Terrain3D target height in metres. The zero-height contour is tied
 * exactly to hydrology confidence 0.5, so Relief does not move the accepted coast.
 */
export function sampleG11ReliefHeight(normalizedX, normalizedY) {
  const water = sampleCanonicalWaterConfidence(normalizedX, normalizedY);
  const signedCoast = (G11_RELIEF_POLICY.coastlineIso - water) * G11_RELIEF_POLICY.coastHalfSpanMeters * 2;
  const landFactor = 1 - smoothstep(0.36, 0.5, water);
  const seaFactor = smoothstep(0.5, 0.72, water);
  const biomeSignal = sampleBiomeElevationSignal(normalizedX, normalizedY);
  const chainSignal = sampleReliefChainInfluence(normalizedX, normalizedY);
  const dryRelief = G11_RELIEF_POLICY.defaultDryReliefMeters
    + Math.max(0, biomeSignal) * G11_RELIEF_POLICY.biomeReliefMeters
    + Math.pow(chainSignal, 1.35) * G11_RELIEF_POLICY.chainReliefMeters;
  const seabed = seaFactor * G11_RELIEF_POLICY.openWaterDepthMeters;
  return signedCoast + landFactor * dryRelief - seabed;
}

export function sampleG11ReliefNormal(normalizedX, normalizedY) {
  const epsilon = G11_RELIEF_POLICY.normalProbeNormalized;
  const hL = sampleG11ReliefHeight(normalizedX - epsilon, normalizedY);
  const hR = sampleG11ReliefHeight(normalizedX + epsilon, normalizedY);
  const hD = sampleG11ReliefHeight(normalizedX, normalizedY - epsilon);
  const hU = sampleG11ReliefHeight(normalizedX, normalizedY + epsilon);
  const dx = (hR - hL) / (2 * epsilon);
  const dz = (hU - hD) / (2 * epsilon);
  const length = Math.hypot(dx, 1, dz);
  return Object.freeze({ x: -dx / length, y: 1 / length, z: -dz / length });
}

function fnv1a(checksum, value) {
  return Math.imul((checksum ^ value) >>> 0, 16777619) >>> 0;
}

export function buildG11ReliefProbe() {
  const bounds = G11_RELIEF_POLICY.normalizedBounds;
  const size = G11_RELIEF_POLICY.sourceGridSize;
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
      const height = sampleG11ReliefHeight(nx, ny);
      row.push(Number(height.toFixed(6)));
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      checksum = fnv1a(checksum, Math.round((height + 128) * 1000));
      if (x > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(height - row[x - 1]));
      if (y > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(height - rows[y - 1][x]));
    }
    rows.push(row);
  }

  let canonicalSignMismatches = 0;
  const mask = G11_HYDROLOGY_POLICY.maskBounds;
  for (let maskY = mask.yMin; maskY <= mask.yMax; maskY += 1) {
    for (let maskX = mask.xMin; maskX <= mask.xMax; maskX += 1) {
      const nx = (maskX + 0.5) / G11_HYDROLOGY_POLICY.baseMaskWidth;
      const ny = (maskY + 0.5) / G11_HYDROLOGY_POLICY.baseMaskHeight;
      const expectedWater = sampleWaterAtMaskCell(maskX, maskY) === 1;
      const actualWater = sampleG11ReliefHeight(nx, ny) < 0;
      if (expectedWater !== actualWater) canonicalSignMismatches += 1;
    }
  }

  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  const guard = G11_RELIEF_POLICY.guardBandNormalized;
  const edgeSamples = 65;
  for (let index = 0; index < edgeSamples; index += 1) {
    const t = index / (edgeSamples - 1);
    const edgePairs = [
      [bounds.xMin, bounds.yMin + (bounds.yMax - bounds.yMin) * t, bounds.xMin - guard, bounds.yMin + (bounds.yMax - bounds.yMin) * t],
      [bounds.xMax, bounds.yMin + (bounds.yMax - bounds.yMin) * t, bounds.xMax + guard, bounds.yMin + (bounds.yMax - bounds.yMin) * t],
      [bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMin, bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMin - guard],
      [bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMax, bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMax + guard],
    ];
    for (const [ax, ay, bx, by] of edgePairs) {
      maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(sampleG11ReliefHeight(ax, ay) - sampleG11ReliefHeight(bx, by)));
      const a = sampleG11ReliefNormal(ax, ay);
      const b = sampleG11ReliefNormal(bx, by);
      maxGuardNormalDelta = Math.max(maxGuardNormalDelta, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }

  return Object.freeze({
    policyId: G11_RELIEF_POLICY.id,
    sourceMapSha256: G11_RELIEF_POLICY.sourceMapSha256,
    geoCell: G11_RELIEF_POLICY.geoCell,
    layer: G11_RELIEF_POLICY.layer,
    normalizedBounds: G11_RELIEF_POLICY.normalizedBounds,
    sourceGridSize: size,
    terrain3dRegionSize: G11_RELIEF_POLICY.terrain3dRegionSize,
    coastlineIso: G11_RELIEF_POLICY.coastlineIso,
    rows,
    hydrology: measureG11Hydrology(),
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
