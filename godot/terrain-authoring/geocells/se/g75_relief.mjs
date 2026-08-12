/**
 * Kızıl Ufuk / SE GeoCell G75 — Relief/Height Character.
 * GeoCell bounds are work addressing only. Height is sampled in normalized
 * owner-map space so the authored field stays continuous across cell seams.
 */
import {
  REFERENCE_BIOME_ZONES,
  REFERENCE_RELIEF_CHAINS,
  sampleReferenceInfluence,
} from '../../../../src/3d/world/worldReferenceMap.js';
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G75_RELIEF_POLICY = Object.freeze({
  id: 'kizil-ufuk-g75-terrain3d-relief-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G75',
  gx: 7,
  gy: 5,
  layer: 'Relief/Height Character',
  normalizedBounds: Object.freeze({ xMin: 7 / 8, xMax: 1, yMin: 5 / 8, yMax: 6 / 8 }),
  maskBounds: Object.freeze({ xMin: 84, xMax: 95, yMin: 40, yMax: 47 }),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
  terrain3dRegionSize: 256,
  sourceGridSize: 65,
  coastlineIso: 0.5,
  coastHalfSpanMeters: 2.5,
  defaultDryReliefMeters: 1.5,
  biomeReliefMeters: 22.0,
  chainReliefMeters: 68.0,
  reliefChainRadiusNormalized: 0.055,
  guardBandNormalized: 1 / 1536,
  normalProbeNormalized: 1 / 1536,
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function isWater(surface) { return surface === 'sea' || surface === 'lake' ? 1 : 0; }
function sampleWaterMaskCell(x, y) {
  const cx = clamp(x, 0, G75_RELIEF_POLICY.baseMaskWidth - 1);
  const cy = clamp(y, 0, G75_RELIEF_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface(
    (cx + 0.5) / G75_RELIEF_POLICY.baseMaskWidth,
    (cy + 0.5) / G75_RELIEF_POLICY.baseMaskHeight,
  ));
}

export function sampleCanonicalWaterConfidence(normalizedX, normalizedY) {
  const nx = clamp(normalizedX, 0, 1);
  const ny = clamp(normalizedY, 0, 1);
  const gx = nx * G75_RELIEF_POLICY.baseMaskWidth - 0.5;
  const gy = ny * G75_RELIEF_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = gx - x0;
  const ty = gy - y0;
  const w00 = sampleWaterMaskCell(x0, y0);
  const w10 = sampleWaterMaskCell(x0 + 1, y0);
  const w01 = sampleWaterMaskCell(x0, y0 + 1);
  const w11 = sampleWaterMaskCell(x0 + 1, y0 + 1);
  return clamp((w00 + (w10 - w00) * tx) + (((w01 + (w11 - w01) * tx) - (w00 + (w10 - w00) * tx)) * ty), 0, 1);
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  if (l2 <= Number.EPSILON) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / l2, 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
function sampleReliefChainInfluence(nx, ny) {
  let strongest = 0;
  for (const chain of REFERENCE_RELIEF_CHAINS) {
    for (let i = 0; i + 1 < chain.points.length; i += 1) {
      const a = chain.points[i];
      const b = chain.points[i + 1];
      const d = pointSegmentDistance(nx, ny, a[0], a[1], b[0], b[1]);
      strongest = Math.max(strongest, 1 - smoothstep(0, G75_RELIEF_POLICY.reliefChainRadiusNormalized, d));
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

export function sampleG75ReliefHeight(nx, ny) {
  const water = sampleCanonicalWaterConfidence(nx, ny);
  const signedCoast = (G75_RELIEF_POLICY.coastlineIso - water) * G75_RELIEF_POLICY.coastHalfSpanMeters * 2;
  const landFactor = 1 - smoothstep(0, 0.5, water);
  const biome = Math.max(0, sampleBiomeElevationSignal(nx, ny));
  const chain = sampleReliefChainInfluence(nx, ny);
  const dryRelief = G75_RELIEF_POLICY.defaultDryReliefMeters
    + biome * G75_RELIEF_POLICY.biomeReliefMeters
    + Math.pow(chain, 1.35) * G75_RELIEF_POLICY.chainReliefMeters;
  return signedCoast + landFactor * dryRelief;
}

export function sampleG75ReliefNormal(nx, ny) {
  const e = G75_RELIEF_POLICY.normalProbeNormalized;
  const dx = (sampleG75ReliefHeight(nx + e, ny) - sampleG75ReliefHeight(nx - e, ny)) / (2 * e);
  const dz = (sampleG75ReliefHeight(nx, ny + e) - sampleG75ReliefHeight(nx, ny - e)) / (2 * e);
  const len = Math.hypot(dx, 1, dz);
  return Object.freeze({ x: -dx / len, y: 1 / len, z: -dz / len });
}
function fnv1a(sum, value) { return Math.imul((sum ^ value) >>> 0, 16777619) >>> 0; }

export function buildG75ReliefProbe() {
  const bounds = G75_RELIEF_POLICY.normalizedBounds;
  const size = G75_RELIEF_POLICY.sourceGridSize;
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
      const h = sampleG75ReliefHeight(nx, ny);
      row.push(Number(h.toFixed(6)));
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);
      checksum = fnv1a(checksum, Math.round((h + 128) * 1000));
      if (x > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(h - row[x - 1]));
      if (y > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(h - rows[y - 1][x]));
    }
    rows.push(row);
  }
  let canonicalWaterCells = 0;
  let canonicalLandCells = 0;
  let canonicalSignMismatches = 0;
  const m = G75_RELIEF_POLICY.maskBounds;
  for (let y = m.yMin; y <= m.yMax; y += 1) {
    for (let x = m.xMin; x <= m.xMax; x += 1) {
      const nx = (x + 0.5) / G75_RELIEF_POLICY.baseMaskWidth;
      const ny = (y + 0.5) / G75_RELIEF_POLICY.baseMaskHeight;
      const expectedWater = sampleWaterMaskCell(x, y) === 1;
      expectedWater ? canonicalWaterCells += 1 : canonicalLandCells += 1;
      if ((sampleG75ReliefHeight(nx, ny) < 0) !== expectedWater) canonicalSignMismatches += 1;
    }
  }
  let maxGuardHeightDelta = 0;
  let maxGuardNormalDelta = 0;
  const g = G75_RELIEF_POLICY.guardBandNormalized;
  for (let i = 0; i < 65; i += 1) {
    const t = i / 64;
    const pairs = [
      [bounds.xMin, bounds.yMin + (bounds.yMax - bounds.yMin) * t, bounds.xMin - g, bounds.yMin + (bounds.yMax - bounds.yMin) * t],
      [bounds.xMax, bounds.yMin + (bounds.yMax - bounds.yMin) * t, bounds.xMax + g, bounds.yMin + (bounds.yMax - bounds.yMin) * t],
      [bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMin, bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMin - g],
      [bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMax, bounds.xMin + (bounds.xMax - bounds.xMin) * t, bounds.yMax + g],
    ];
    for (const [ax, ay, bx, by] of pairs) {
      maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(sampleG75ReliefHeight(ax, ay) - sampleG75ReliefHeight(bx, by)));
      const a = sampleG75ReliefNormal(ax, ay);
      const b = sampleG75ReliefNormal(bx, by);
      maxGuardNormalDelta = Math.max(maxGuardNormalDelta, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
  }
  return Object.freeze({
    policyId: G75_RELIEF_POLICY.id,
    sourceMapSha256: G75_RELIEF_POLICY.sourceMapSha256,
    geoCell: 'G75',
    layer: G75_RELIEF_POLICY.layer,
    sourceGridSize: size,
    terrain3dRegionSize: G75_RELIEF_POLICY.terrain3dRegionSize,
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
