/**
 * Günbatımı Ustası / SW G07 Rock/Snow authoring field.
 * G07 is canonical open sea. This layer therefore keeps snow at zero and derives
 * only a restrained submerged-rock eligibility from global owner-map water-zone
 * and shelf signals. GeoCell edges never participate in the field.
 */
import { REFERENCE_WATER_ZONES, sampleReferenceInfluence } from '../../../../src/3d/world/worldReferenceMap.js';
import { sampleReferenceWaterMask } from '../../../../src/3d/world/worldReferenceWaterMask.js';

export const G07_ROCK_SNOW_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g07-terrain3d-rock-snow-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G07', gx: 0, gy: 7, layer: 'Rock/Snow',
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.875, yMax: 1 }),
  sourceGridSize: 65,
  terrain3dRegionSize: 256,
  substrateTextureId: 0,
  rockTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const SUNSET = REFERENCE_WATER_ZONES.find((z) => z.id === 'sunset-sea');
if (!SUNSET) throw new Error('sunset-sea reference zone is required');
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export function sampleG07RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const x = clamp01(normalizedX); const y = clamp01(normalizedY);
  const canonicalWater = sampleReferenceWaterMask(x, y) ? 1 : 0;
  const sunset = sampleReferenceInfluence(x, y, SUNSET);
  const westShelf = 1 - smoothstep(0.02, 0.22, x);
  const southShelf = smoothstep(0.78, 1.0, y);
  const rockBlend = canonicalWater * clamp01(0.10 + 0.22 * sunset + 0.18 * westShelf + 0.12 * southShelf);
  return Object.freeze({ canonicalWater, rockBlend, snowBlend: 0, sunset, westShelf, southShelf });
}

function fnv1a(hash, value) { hash ^= value & 0xff; return Math.imul(hash, 16777619) >>> 0; }

export function measureG07RockSnow() {
  const { xMin, xMax, yMin, yMax } = G07_ROCK_SNOW_POLICY.normalizedBounds;
  const size = G07_ROCK_SNOW_POLICY.sourceGridSize;
  const rows = [];
  let canonicalWaterSamples = 0, canonicalLandSamples = 0, maxAdjacentRockStep = 0, maxGuardBandRockDelta = 0, maxSnowBlend = 0;
  let minRockBlend = 1, maxRockBlend = 0, checksum = 2166136261;
  for (let y = 0; y < size; y += 1) {
    const ny = yMin + (yMax - yMin) * y / (size - 1); const row = [];
    for (let x = 0; x < size; x += 1) {
      const nx = xMin + (xMax - xMin) * x / (size - 1); const s = sampleG07RockSnow(nx, ny); row.push(s);
      canonicalWaterSamples += s.canonicalWater; canonicalLandSamples += 1 - s.canonicalWater;
      minRockBlend = Math.min(minRockBlend, s.rockBlend); maxRockBlend = Math.max(maxRockBlend, s.rockBlend); maxSnowBlend = Math.max(maxSnowBlend, s.snowBlend);
      checksum = fnv1a(checksum, Math.round(s.rockBlend * 255)); checksum = fnv1a(checksum, Math.round(s.snowBlend * 255));
    }
    rows.push(row);
  }
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(rows[y][x].rockBlend - rows[y][x + 1].rockBlend));
    if (y + 1 < size) maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(rows[y][x].rockBlend - rows[y + 1][x].rockBlend));
  }
  const g = G07_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) {
    const t = i / (size - 1), nx = xMin + (xMax - xMin) * t, ny = yMin + (yMax - yMin) * t;
    for (const [a,b] of [[sampleG07RockSnow(nx,yMin).rockBlend,sampleG07RockSnow(nx,yMin-g).rockBlend],[sampleG07RockSnow(nx,yMax).rockBlend,sampleG07RockSnow(nx,yMax+g).rockBlend],[sampleG07RockSnow(xMin,ny).rockBlend,sampleG07RockSnow(xMin-g,ny).rockBlend],[sampleG07RockSnow(xMax,ny).rockBlend,sampleG07RockSnow(xMax+g,ny).rockBlend]]) maxGuardBandRockDelta = Math.max(maxGuardBandRockDelta, Math.abs(a-b));
  }
  return Object.freeze({ policyId: G07_ROCK_SNOW_POLICY.id, sourceMapSha256: G07_ROCK_SNOW_POLICY.sourceMapSha256, geoCell: 'G07', layer: 'Rock/Snow', sourceSamples: size * size, canonicalWaterSamples, canonicalLandSamples, minRockBlend: +minRockBlend.toFixed(8), maxRockBlend: +maxRockBlend.toFixed(8), maxSnowBlend: +maxSnowBlend.toFixed(8), maxAdjacentRockStep: +maxAdjacentRockStep.toFixed(8), maxGuardBandRockDelta: +maxGuardBandRockDelta.toFixed(8), surfaceChecksum: checksum });
}

export function buildG07RockSnowProbe() {
  const { xMin, xMax, yMin, yMax } = G07_ROCK_SNOW_POLICY.normalizedBounds; const size = G07_ROCK_SNOW_POLICY.sourceGridSize; const rows = [];
  for (let y = 0; y < size; y += 1) { const ny = yMin + (yMax - yMin) * y / (size - 1); const row = [];
    for (let x = 0; x < size; x += 1) { const nx = xMin + (xMax - xMin) * x / (size - 1); const s = sampleG07RockSnow(nx, ny); row.push([+s.rockBlend.toFixed(8), 0]); } rows.push(row); }
  return Object.freeze({ policyId: G07_ROCK_SNOW_POLICY.id, sourceMapSha256: G07_ROCK_SNOW_POLICY.sourceMapSha256, geoCell: 'G07', layer: 'Rock/Snow', sourceGridSize: size, terrain3dRegionSize: 256, substrateTextureId: 0, rockTextureId: 1, rows });
}
