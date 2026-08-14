/**
 * Buzul Muhafızı / NW G10 — Relief / Height Character.
 *
 * G10 is a work parcel only. The authored field is evaluated in canonical
 * owner-map space and intentionally contains no GeoCell/Pindex/grid term.
 * Coastline sign comes from the already-qualified continuous G10 hydrology;
 * mountain character comes from canonical biome elevation bias and reference
 * relief chains. This keeps map.png macro geography authoritative while
 * allowing continuous Terrain3D height authoring.
 */
import {
  REFERENCE_BIOME_ZONES,
  REFERENCE_RELIEF_CHAINS,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import { sampleG10GlobalWaterConfidence } from './g10_biome.mjs';

export const G10_RELIEF_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g10-terrain3d-relief-2026-08-14-v2',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G10',
  gx: 1,
  gy: 0,
  layer: 'Relief/Height Character',
  bounds: Object.freeze({ xMin: 0.125, xMax: 0.25, yMin: 0, yMax: 0.125 }),
  sourceGridSize: 65,
  denseGridSize: 257,
  terrain3dRegionSize: 256,
  guardNormalizedX: 1 / 1536,
  guardNormalizedY: 1 / 1024,
  derivativeNormalizedX: 1 / 3072,
  derivativeNormalizedY: 1 / 2048,
  coastHalfSpanMeters: 2.5,
  baseLandLiftMeters: 2.0,
  biomeAmplitudeMeters: 36.0,
  reliefAmplitudeMeters: 68.0,
  chainInfluenceRadius: 0.055,
  worldWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
  worldDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const clamp01 = (value) => clamp(value, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-12, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function segmentDistance(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const d2 = dx * dx + dy * dy;
  const t = d2 > 0 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / d2, 0, 1) : 0;
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

function reliefChainSignal(nx, ny) {
  let strongest = 0;
  for (const chain of REFERENCE_RELIEF_CHAINS) {
    for (let index = 0; index + 1 < chain.points.length; index += 1) {
      const distance = segmentDistance(nx, ny, chain.points[index], chain.points[index + 1]);
      strongest = Math.max(
        strongest,
        1 - smoothstep(0, G10_RELIEF_POLICY.chainInfluenceRadius, distance),
      );
    }
  }
  return strongest;
}

function biomeElevationSignal(nx, ny) {
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
  return clamp01(Math.max(strongest, weighted / Math.max(1, total)));
}

export function sampleG10ReliefHeight(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('G10 relief coordinates must be finite');
  }
  const waterConfidence = sampleG10GlobalWaterConfidence(normalizedX, normalizedY);
  const landConfidence = 1 - smoothstep(0, 0.5, waterConfidence);
  const coastHeight = (0.5 - waterConfidence) * G10_RELIEF_POLICY.coastHalfSpanMeters * 2;
  const biomeHeight = G10_RELIEF_POLICY.biomeAmplitudeMeters * biomeElevationSignal(normalizedX, normalizedY);
  const ridgeHeight = G10_RELIEF_POLICY.reliefAmplitudeMeters * Math.pow(reliefChainSignal(normalizedX, normalizedY), 1.35);
  return coastHeight + landConfidence * (G10_RELIEF_POLICY.baseLandLiftMeters + biomeHeight + ridgeHeight);
}

export function sampleG10ReliefNormal(normalizedX, normalizedY) {
  const p = G10_RELIEF_POLICY;
  const hx0 = sampleG10ReliefHeight(normalizedX - p.derivativeNormalizedX, normalizedY);
  const hx1 = sampleG10ReliefHeight(normalizedX + p.derivativeNormalizedX, normalizedY);
  const hz0 = sampleG10ReliefHeight(normalizedX, normalizedY - p.derivativeNormalizedY);
  const hz1 = sampleG10ReliefHeight(normalizedX, normalizedY + p.derivativeNormalizedY);
  const dxMeters = 2 * p.derivativeNormalizedX * p.worldWidthMeters;
  const dzMeters = 2 * p.derivativeNormalizedY * p.worldDepthMeters;
  const dHeightDx = (hx1 - hx0) / dxMeters;
  const dHeightDz = (hz1 - hz0) / dzMeters;
  const length = Math.hypot(dHeightDx, 1, dHeightDz);
  return Object.freeze({
    x: -dHeightDx / length,
    y: 1 / length,
    z: -dHeightDz / length,
    slopeDegrees: Math.atan(Math.hypot(dHeightDx, dHeightDz)) * 180 / Math.PI,
  });
}

function mixChecksum(checksum, value) {
  const quantized = Math.round((value + 256) * 10000);
  let next = checksum;
  for (let shift = 0; shift < 32; shift += 8) {
    next ^= (quantized >>> shift) & 0xff;
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
}

export function buildG10ReliefProbe() {
  const p = G10_RELIEF_POLICY;
  const b = p.bounds;
  const size = p.sourceGridSize;
  const rows = [];
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let maxAdjacentHeightStep = 0;
  let maxSlopeDegrees = 0;
  let checksum = 2166136261;

  for (let y = 0; y < size; y += 1) {
    const ny = lerp(b.yMin, b.yMax, y / (size - 1));
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(b.xMin, b.xMax, x / (size - 1));
      const height = sampleG10ReliefHeight(nx, ny);
      const normal = sampleG10ReliefNormal(nx, ny);
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      maxSlopeDegrees = Math.max(maxSlopeDegrees, normal.slopeDegrees);
      if (x > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(height - row[x - 1]));
      if (y > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(height - rows[y - 1][x]));
      checksum = mixChecksum(checksum, height);
      checksum = mixChecksum(checksum, normal.x);
      checksum = mixChecksum(checksum, normal.y);
      checksum = mixChecksum(checksum, normal.z);
      row.push(Number(height.toFixed(7)));
    }
    rows.push(row);
  }

  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let canonicalSignMismatches = 0;
  for (let maskY = 0; maskY < 8; maskY += 1) {
    for (let maskX = 12; maskX < 24; maskX += 1) {
      const nx = (maskX + 0.5) / 96;
      const ny = (maskY + 0.5) / 64;
      const isWater = sampleG10GlobalWaterConfidence(nx, ny) >= 0.5;
      if (isWater) canonicalWaterCells += 1;
      else canonicalLandCells += 1;
      if ((sampleG10ReliefHeight(nx, ny) < 0) !== isWater) canonicalSignMismatches += 1;
    }
  }

  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  for (let index = 0; index < size; index += 1) {
    const t = index / (size - 1);
    const x = lerp(b.xMin, b.xMax, t);
    const y = lerp(b.yMin, b.yMax, t);
    const pairs = [
      [b.xMin, y, b.xMin - p.guardNormalizedX, y],
      [b.xMax, y, b.xMax + p.guardNormalizedX, y],
      [x, b.yMin, x, b.yMin - p.guardNormalizedY],
      [x, b.yMax, x, b.yMax + p.guardNormalizedY],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardHeightDelta = Math.max(
        maxGuardHeightDelta,
        Math.abs(sampleG10ReliefHeight(ax, ay) - sampleG10ReliefHeight(bx, by)),
      );
      const a = sampleG10ReliefNormal(ax, ay);
      const c = sampleG10ReliefNormal(bx, by);
      maxGuardNormalDelta = Math.max(
        maxGuardNormalDelta,
        Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z),
      );
    }
  }

  return Object.freeze({
    policyId: p.id,
    sourceMapSha256: p.sourceMapSha256,
    geoCell: p.geoCell,
    layer: p.layer,
    sourceGridSize: p.sourceGridSize,
    denseGridSize: p.denseGridSize,
    terrain3dRegionSize: p.terrain3dRegionSize,
    worldWidthMeters: Number(p.worldWidthMeters.toFixed(6)),
    worldDepthMeters: Number(p.worldDepthMeters.toFixed(6)),
    canonicalWaterCells,
    canonicalLandCells,
    canonicalSignMismatches,
    minHeight: Number(minHeight.toFixed(6)),
    maxHeight: Number(maxHeight.toFixed(6)),
    heightSpan: Number((maxHeight - minHeight).toFixed(6)),
    maxAdjacentHeightStep: Number(maxAdjacentHeightStep.toFixed(6)),
    maxSlopeDegrees: Number(maxSlopeDegrees.toFixed(6)),
    maxGuardHeightDelta: Number(maxGuardHeightDelta.toFixed(6)),
    maxGuardNormalDelta: Number(maxGuardNormalDelta.toFixed(6)),
    reliefChecksum: checksum,
    rows,
  });
}
