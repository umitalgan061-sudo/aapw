/** Günbatımı Ustası / SW G07 Near Detail — continuous marine micro-surface field. */
import { REFERENCE_WATER_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G07_NEAR_DETAIL_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g07-terrain3d-near-detail-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G07', gx: 0, gy: 7, layer: 'Near Detail',
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.875, yMax: 1 }),
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  substrateTextureId: 0,
  microDetailTextureId: 2,
  guardBandNormalized: 1 / 1536,
});

const SUNSET = REFERENCE_WATER_ZONES.find((z) => z.id === 'sunset-sea');
if (!SUNSET) throw new Error('sunset-sea reference zone is required');
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function organicMicro(nx, ny) {
  const a = Math.sin((nx * 11.0 + ny * 7.0) * Math.PI * 2);
  const b = Math.sin((nx * 5.0 - ny * 13.0 + 0.173) * Math.PI * 2);
  const c = Math.sin((nx * 17.0 + ny * 3.0 + 0.417) * Math.PI * 2);
  return clamp01(0.5 + 0.22 * a + 0.15 * b + 0.08 * c);
}

export function sampleG07NearDetail(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const x = clamp01(normalizedX); const y = clamp01(normalizedY);
  const canonicalWater = sampleReferenceWaterMask(x, y) ? 1 : 0;
  const sunset = sampleReferenceInfluence(x, y, SUNSET);
  const westShelf = 1 - smoothstep(0.02, 0.22, x);
  const southShelf = smoothstep(0.78, 1.0, y);
  const macro = clamp01(0.35 + 0.30 * sunset + 0.20 * westShelf + 0.15 * southShelf);
  const micro = organicMicro(x, y);
  const detailBlend = canonicalWater * clamp01(0.12 + 0.34 * macro * (0.55 + 0.45 * micro));
  return Object.freeze({ canonicalWater, detailBlend, macro, micro, foliageWeight: 0 });
}

function fnv1a(hash, value) { hash ^= value & 0xff; return Math.imul(hash, 16777619) >>> 0; }

export function measureG07NearDetail() {
  const { xMin, xMax, yMin, yMax } = G07_NEAR_DETAIL_POLICY.normalizedBounds;
  const size = G07_NEAR_DETAIL_POLICY.sourceGridSize;
  const rows = [];
  let canonicalWaterSamples = 0, canonicalLandSamples = 0, minDetailBlend = 1, maxDetailBlend = 0;
  let maxAdjacentDetailStep = 0, maxGuardBandDetailDelta = 0, maxFoliageWeight = 0, checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * y / (size - 1); const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * x / (size - 1); const s = sampleG07NearDetail(nx, ny); row.push(s);
      canonicalWaterSamples += s.canonicalWater; canonicalLandSamples += 1 - s.canonicalWater;
      minDetailBlend = Math.min(minDetailBlend, s.detailBlend); maxDetailBlend = Math.max(maxDetailBlend, s.detailBlend); maxFoliageWeight = Math.max(maxFoliageWeight, s.foliageWeight);
      checksum = fnv1a(checksum, Math.round(s.detailBlend * 255));
    }
    rows.push(row);
  }
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x + 1 < size) maxAdjacentDetailStep = Math.max(maxAdjacentDetailStep, Math.abs(rows[y][x].detailBlend - rows[y][x + 1].detailBlend));
    if (y + 1 < size) maxAdjacentDetailStep = Math.max(maxAdjacentDetailStep, Math.abs(rows[y][x].detailBlend - rows[y + 1][x].detailBlend));
  }
  const g = G07_NEAR_DETAIL_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1), nx = xMin + (xMax - xMin) * t, ny = yMin + (yMax - yMin) * t;
    for (const [a,b] of [[sampleG07NearDetail(nx,yMin).detailBlend,sampleG07NearDetail(nx,yMin-g).detailBlend],[sampleG07NearDetail(nx,yMax).detailBlend,sampleG07NearDetail(nx,yMax+g).detailBlend],[sampleG07NearDetail(xMin,ny).detailBlend,sampleG07NearDetail(xMin-g,ny).detailBlend],[sampleG07NearDetail(xMax,ny).detailBlend,sampleG07NearDetail(xMax+g,ny).detailBlend]]) maxGuardBandDetailDelta = Math.max(maxGuardBandDetailDelta, Math.abs(a-b));
  }
  return Object.freeze({ policyId:G07_NEAR_DETAIL_POLICY.id, sourceMapSha256:G07_NEAR_DETAIL_POLICY.sourceMapSha256, geoCell:'G07', layer:'Near Detail', sourceSamples:size*size, canonicalWaterSamples, canonicalLandSamples, minDetailBlend:+minDetailBlend.toFixed(8), maxDetailBlend:+maxDetailBlend.toFixed(8), maxAdjacentDetailStep:+maxAdjacentDetailStep.toFixed(8), maxGuardBandDetailDelta:+maxGuardBandDetailDelta.toFixed(8), maxFoliageWeight:+maxFoliageWeight.toFixed(8), detailChecksum:checksum });
}

export function buildG07NearDetailProbe() {
  const { xMin, xMax, yMin, yMax } = G07_NEAR_DETAIL_POLICY.normalizedBounds; const size = G07_NEAR_DETAIL_POLICY.sourceGridSize; const rows = [];
  for (let y = 0; y < size; y += 1) { const ny = yMin + (yMax-yMin)*y/(size-1); const row=[];
    for (let x = 0; x < size; x += 1) { const nx=xMin+(xMax-xMin)*x/(size-1); row.push(+sampleG07NearDetail(nx,ny).detailBlend.toFixed(8)); } rows.push(row); }
  return Object.freeze({ policyId:G07_NEAR_DETAIL_POLICY.id, sourceMapSha256:G07_NEAR_DETAIL_POLICY.sourceMapSha256, geoCell:'G07', layer:'Near Detail', sourceGridSize:size, terrain3dRegionSize:256, substrateTextureId:0, microDetailTextureId:2, rows });
}
