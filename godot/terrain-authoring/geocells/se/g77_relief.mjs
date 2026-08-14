/** Kızıl Ufuk / SE G77 Relief/Height Character. GeoCell bounds are addressing only. */
import { REFERENCE_BIOME_ZONES, REFERENCE_RELIEF_CHAINS, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import { sampleG77WaterConfidence, sampleG77HydrologyHeight } from './g77_hydrology.mjs';
import { sampleG77BiomeSurface } from './g77_biome.mjs';

export const G77_RELIEF_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-terrain3d-relief-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G77', gx: 7, gy: 7, layer: 'Relief/Height Character',
  normalizedBounds: Object.freeze({ xMin: 7 / 8, xMax: 1, yMin: 7 / 8, yMax: 1 }),
  maskBounds: Object.freeze({ xMin: 84, xMax: 95, yMin: 56, yMax: 63 }),
  sourceGridSize: 65, terrain3dRegionSize: 256, terrain3dImportSize: 257,
  guardBandNormalized: 1 / 1536, normalProbeNormalized: 1 / 1536,
  worldWidthMeters: FULL_REFERENCE_EXTENT_PLAN.widthMeters,
  worldDepthMeters: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
  biomeReliefMeters: 18, chainReliefMeters: 52, chainRadiusNormalized: 0.06,
  coastalClearanceMaskRadius: 4, coastalClearanceTaps: 5,
  marineCharacterMeters: 1.25,
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const clamp01 = (v) => clamp(v, 0, 1);
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay, l2 = abx * abx + aby * aby;
  if (l2 <= Number.EPSILON) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / l2, 0, 1);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function sampleReliefChainInfluence(nx, ny) {
  let strongest = 0;
  for (const chain of REFERENCE_RELIEF_CHAINS) {
    for (let i = 0; i + 1 < chain.points.length; i += 1) {
      const a = chain.points[i], b = chain.points[i + 1];
      const d = pointSegmentDistance(nx, ny, a[0], a[1], b[0], b[1]);
      strongest = Math.max(strongest, 1 - smoothstep(0, G77_RELIEF_POLICY.chainRadiusNormalized, d));
    }
  }
  return strongest;
}

function sampleBiomeElevationSignal(nx, ny) {
  let weighted = 0, total = 0, strongest = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(nx, ny, zone);
    if (influence <= 0) continue;
    const bias = Number.isFinite(zone.elevationBias) ? zone.elevationBias : 0;
    weighted += influence * bias;
    total += influence;
    strongest = Math.max(strongest, Math.max(0, bias) * influence);
  }
  return clamp(Math.max(strongest, total > 0 ? weighted / total : 0), 0, 1);
}

function sampleCoastalLandFactor(nx, ny, water) {
  const rawDepth = clamp01((0.5 - water) / 0.5);
  if (rawDepth <= 0) return 0;
  const radius = G77_RELIEF_POLICY.coastalClearanceMaskRadius;
  const taps = G77_RELIEF_POLICY.coastalClearanceTaps;
  let clearance = 0;
  for (let iy = 0; iy < taps; iy += 1) for (let ix = 0; ix < taps; ix += 1) {
    const ox = ((ix / (taps - 1)) * 2 - 1) * radius / 96;
    const oy = ((iy / (taps - 1)) * 2 - 1) * radius / 64;
    clearance += clamp01((0.5 - sampleG77WaterConfidence(clamp01(nx + ox), clamp01(ny + oy))) / 0.5);
  }
  const meanClearance = clearance / (taps * taps);
  return rawDepth * meanClearance * meanClearance;
}

export function sampleG77ReliefHeight(nx, ny) {
  const x = clamp01(nx), y = clamp01(ny);
  const water = sampleG77WaterConfidence(x, y);
  const hydrology = sampleG77HydrologyHeight(x, y);
  const landFactor = sampleCoastalLandFactor(x, y, water);
  const waterFactor = smoothstep(0.5, 0.9, water);
  const biome = sampleBiomeElevationSignal(x, y);
  const chain = sampleReliefChainInfluence(x, y);
  const macro = biome * G77_RELIEF_POLICY.biomeReliefMeters + Math.pow(chain, 1.4) * G77_RELIEF_POLICY.chainReliefMeters;
  const marine = -G77_RELIEF_POLICY.marineCharacterMeters * waterFactor * (0.55 + 0.45 * smoothstep(0.65, 1, water));
  return hydrology + landFactor * macro + marine;
}

export function sampleG77ReliefNormal(nx, ny) {
  const e = G77_RELIEF_POLICY.normalProbeNormalized;
  const dhx = (sampleG77ReliefHeight(nx + e, ny) - sampleG77ReliefHeight(nx - e, ny)) / (2 * e);
  const dhz = (sampleG77ReliefHeight(nx, ny + e) - sampleG77ReliefHeight(nx, ny - e)) / (2 * e);
  const sx = dhx / G77_RELIEF_POLICY.worldWidthMeters, sz = dhz / G77_RELIEF_POLICY.worldDepthMeters;
  const len = Math.hypot(sx, 1, sz);
  return Object.freeze({ x: -sx / len, y: 1 / len, z: -sz / len });
}

function fnv1a(sum, value) { return Math.imul((sum ^ value) >>> 0, 16777619) >>> 0; }

export function buildG77ReliefProbe() {
  const b = G77_RELIEF_POLICY.normalizedBounds, size = G77_RELIEF_POLICY.sourceGridSize, rows = [];
  let minHeight = Infinity, maxHeight = -Infinity, maxAdjacentHeightStep = 0, checksum = 2166136261;
  let canonicalWater = 0, canonicalLand = 0, canonicalSignMismatches = 0;
  for (let y = 0; y < size; y += 1) {
    const ny = lerp(b.yMin, b.yMax, y / (size - 1)), row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = lerp(b.xMin, b.xMax, x / (size - 1)), h = sampleG77ReliefHeight(nx, ny);
      row.push(Number(h.toFixed(6))); minHeight = Math.min(minHeight, h); maxHeight = Math.max(maxHeight, h);
      checksum = fnv1a(checksum, Math.round((h + 128) * 1000));
      if (x > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(h - row[x - 1]));
      if (y > 0) maxAdjacentHeightStep = Math.max(maxAdjacentHeightStep, Math.abs(h - rows[y - 1][x]));
    }
    rows.push(row);
  }
  for (let cy = 0; cy < 8; cy += 1) for (let cx = 0; cx < 12; cx += 1) {
    const nx = (84 + cx + 0.5) / 96, ny = (56 + cy + 0.5) / 64;
    const isWater = sampleG77WaterConfidence(nx, ny) >= 0.5;
    if (isWater) canonicalWater += 1; else canonicalLand += 1;
    if ((sampleG77ReliefHeight(nx, ny) < 0) !== isWater) canonicalSignMismatches += 1;
  }
  let maxGuardHeightDelta = 0, maxGuardNormalDelta = 0, maxBiomeHeightDrift = 0;
  const g = G77_RELIEF_POLICY.guardBandNormalized;
  for (let i = 0; i <= 64; i += 1) {
    const t = i / 64, x = lerp(b.xMin, b.xMax, t), y = lerp(b.yMin, b.yMax, t);
    for (const [ax, ay, bx, by] of [[b.xMin, y, b.xMin - g, y], [x, b.yMin, x, b.yMin - g]]) {
      maxGuardHeightDelta = Math.max(maxGuardHeightDelta, Math.abs(sampleG77ReliefHeight(ax, ay) - sampleG77ReliefHeight(bx, by)));
      const a = sampleG77ReliefNormal(ax, ay), c = sampleG77ReliefNormal(bx, by);
      maxGuardNormalDelta = Math.max(maxGuardNormalDelta, Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z));
    }
    const surface = sampleG77BiomeSurface(x, y);
    maxBiomeHeightDrift = Math.max(maxBiomeHeightDrift, Math.abs(surface.height - sampleG77HydrologyHeight(x, y)));
  }
  return Object.freeze({ policyId: G77_RELIEF_POLICY.id, sourceMapSha256: G77_RELIEF_POLICY.sourceMapSha256, geoCell: 'G77', layer: G77_RELIEF_POLICY.layer,
    sourceGridSize: size, terrain3dRegionSize: 256, terrain3dImportSize: 257, worldWidthMeters: Number(G77_RELIEF_POLICY.worldWidthMeters.toFixed(6)), worldDepthMeters: Number(G77_RELIEF_POLICY.worldDepthMeters.toFixed(6)), rows,
    canonicalWater, canonicalLand, canonicalSignMismatches, minHeight: Number(minHeight.toFixed(6)), maxHeight: Number(maxHeight.toFixed(6)), heightSpan: Number((maxHeight - minHeight).toFixed(6)), maxAdjacentHeightStep: Number(maxAdjacentHeightStep.toFixed(6)), maxGuardHeightDelta: Number(maxGuardHeightDelta.toFixed(6)), maxGuardNormalDelta: Number(maxGuardNormalDelta.toFixed(6)), maxBiomeHeightDrift: Number(maxBiomeHeightDrift.toFixed(9)), reliefChecksum: checksum });
}
