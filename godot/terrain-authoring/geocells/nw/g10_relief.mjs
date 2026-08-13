import { REFERENCE_BIOME_ZONES, REFERENCE_RELIEF_CHAINS, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { FULL_REFERENCE_EXTENT_PLAN } from '../../../../src/3d/world/worldReferenceExtent.js';
import { sampleG10GlobalWaterConfidence } from './g10_biome.mjs';

export const G10_RELIEF_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g10-terrain3d-relief-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G10', layer: 'Relief/Height Character', sourceGridSize: 65, terrain3dRegionSize: 256,
  bounds: Object.freeze({ xMin: 0.125, xMax: 0.25, yMin: 0, yMax: 0.125 }),
  guard: 1 / 1536, normalStep: 1 / 1536, coastHalfSpan: 2.5,
  worldWidth: FULL_REFERENCE_EXTENT_PLAN.widthMeters, worldDepth: FULL_REFERENCE_EXTENT_PLAN.depthMeters,
});
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function segmentDistance(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], d2 = dx * dx + dy * dy;
  const t = d2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / d2, 0, 1) : 0;
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}
function chainSignal(nx, ny) {
  let best = 0;
  for (const chain of REFERENCE_RELIEF_CHAINS) for (let i = 0; i + 1 < chain.points.length; i += 1) {
    best = Math.max(best, 1 - smooth(0, 0.055, segmentDistance(nx, ny, chain.points[i], chain.points[i + 1])));
  }
  return best;
}
function biomeSignal(nx, ny) {
  let weighted = 0, total = 0, strongest = 0;
  for (const zone of REFERENCE_BIOME_ZONES) {
    const influence = sampleReferenceInfluence(nx, ny, zone);
    if (influence <= 0) continue;
    const bias = Number.isFinite(zone.elevationBias) ? zone.elevationBias : 0;
    weighted += influence * bias; total += influence; strongest = Math.max(strongest, Math.max(0, bias) * influence);
  }
  return clamp(Math.max(strongest, weighted / Math.max(1, total)), 0, 1);
}
export function sampleG10ReliefHeight(nx, ny) {
  const water = sampleG10GlobalWaterConfidence(nx, ny);
  const coast = (0.5 - water) * G10_RELIEF_POLICY.coastHalfSpan * 2;
  const land = 1 - smooth(0, 0.5, water);
  return coast + land * (2 + 36 * biomeSignal(nx, ny) + 68 * Math.pow(chainSignal(nx, ny), 1.35));
}
export function sampleG10ReliefNormal(nx, ny) {
  const p = G10_RELIEF_POLICY, e = p.normalStep;
  const sx = (sampleG10ReliefHeight(nx + e, ny) - sampleG10ReliefHeight(nx - e, ny)) / (2 * e * p.worldWidth);
  const sz = (sampleG10ReliefHeight(nx, ny + e) - sampleG10ReliefHeight(nx, ny - e)) / (2 * e * p.worldDepth);
  const length = Math.hypot(sx, 1, sz); return { x: -sx / length, y: 1 / length, z: -sz / length };
}
export function buildG10ReliefProbe() {
  const p = G10_RELIEF_POLICY, b = p.bounds, rows = []; let min = Infinity, max = -Infinity, step = 0, sum = 2166136261;
  for (let y = 0; y < 65; y += 1) {
    const ny = lerp(b.yMin, b.yMax, y / 64), row = [];
    for (let x = 0; x < 65; x += 1) {
      const nx = lerp(b.xMin, b.xMax, x / 64), h = sampleG10ReliefHeight(nx, ny), q = Number(h.toFixed(6));
      row.push(q); min = Math.min(min, h); max = Math.max(max, h); sum = Math.imul((sum ^ Math.round((h + 128) * 1000)) >>> 0, 16777619) >>> 0;
      if (x) step = Math.max(step, Math.abs(h - row[x - 1])); if (y) step = Math.max(step, Math.abs(h - rows[y - 1][x]));
    } rows.push(row);
  }
  let water = 0, land = 0, mismatch = 0, guardHeight = 0, guardNormal = 0;
  for (let y = 0; y < 8; y += 1) for (let x = 12; x < 24; x += 1) {
    const nx = (x + 0.5) / 96, ny = (y + 0.5) / 64, isWater = sampleG10GlobalWaterConfidence(nx, ny) >= 0.5;
    isWater ? water++ : land++; if ((sampleG10ReliefHeight(nx, ny) < 0) !== isWater) mismatch++;
  }
  for (let i = 0; i < 65; i += 1) {
    const t = i / 64, x = lerp(b.xMin, b.xMax, t), y = lerp(b.yMin, b.yMax, t), g = p.guard;
    for (const [ax, ay, bx, by] of [[b.xMin,y,b.xMin-g,y],[b.xMax,y,b.xMax+g,y],[x,b.yMin,x,b.yMin-g],[x,b.yMax,x,b.yMax+g]]) {
      guardHeight = Math.max(guardHeight, Math.abs(sampleG10ReliefHeight(ax, ay) - sampleG10ReliefHeight(bx, by)));
      const a = sampleG10ReliefNormal(ax, ay), c = sampleG10ReliefNormal(bx, by); guardNormal = Math.max(guardNormal, Math.hypot(a.x-c.x,a.y-c.y,a.z-c.z));
    }
  }
  return Object.freeze({ policyId:p.id, sourceMapSha256:p.sourceMapSha256, geoCell:p.geoCell, layer:p.layer, sourceGridSize:65, terrain3dRegionSize:256,
    worldWidthMeters:Number(p.worldWidth.toFixed(6)), worldDepthMeters:Number(p.worldDepth.toFixed(6)), rows, canonicalWaterCells:water, canonicalLandCells:land, canonicalSignMismatches:mismatch,
    minHeight:Number(min.toFixed(6)), maxHeight:Number(max.toFixed(6)), heightSpan:Number((max-min).toFixed(6)), maxAdjacentHeightStep:Number(step.toFixed(6)),
    maxGuardHeightDelta:Number(guardHeight.toFixed(6)), maxGuardNormalDelta:Number(guardNormal.toFixed(6)), reliefChecksum:sum });
}
