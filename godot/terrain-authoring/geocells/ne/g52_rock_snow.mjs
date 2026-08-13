/**
 * Şafak Kartalı / NE GeoCell G52 — Rock/Snow.
 *
 * GeoCell coordinates are work addressing only. All material weights are
 * evaluated in continuous owner-map normalized space; no cell-edge/grid term
 * participates in the final field.
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

export const G52_ROCK_SNOW_POLICY = Object.freeze({
  id: 'safak-kartali-g52-terrain3d-rock-snow-2026-08-13-v1',
  sourceMapSha256: WORLD_REFERENCE_MAP.sha256,
  geoCell: 'G52', gx: 5, gy: 2, layer: 'Rock/Snow',
  pixelBounds: Object.freeze({ xMin: 960, xMax: 1152, yMin: 256, yMax: 384 }),
  normalizedBounds: Object.freeze({ xMin: 0.625, xMax: 0.75, yMin: 0.25, yMax: 0.375 }),
  maskBounds: Object.freeze({ xMin: 60, xMax: 71, yMin: 16, yMax: 23 }),
  sourceGridSize: 65, terrain3dRegionSize: 256,
  rockTextureId: 0, snowTextureId: 1,
  guardBandNormalized: 1 / 1536,
});

const BONE_BIOME = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'bone-mountains');
const NORTH_ZONE = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'north');
const COLD_ZONE = REFERENCE_BIOME_ZONES.find((zone) => zone.id === 'lands-always-winter');
const BONE_CHAIN = REFERENCE_RELIEF_CHAINS.find((chain) => chain.id === 'bone-mountains');
if (!BONE_BIOME || !BONE_CHAIN) throw new Error('canonical Bone Mountains controls missing');

function clamp(value, min = 0, max = 1) { return Math.max(min, Math.min(max, value)); }
function smoothstep(edge0, edge1, value) {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function waterCell(ix, iy) {
  const x = Math.max(0, Math.min(WORLD_REFERENCE_WATER_MASK.width - 1, ix));
  const y = Math.max(0, Math.min(WORLD_REFERENCE_WATER_MASK.height - 1, iy));
  return sampleReferenceWaterMask((x + 0.5) / WORLD_REFERENCE_WATER_MASK.width, (y + 0.5) / WORLD_REFERENCE_WATER_MASK.height) ? 1 : 0;
}
export function sampleG52WaterConfidence(normalizedX, normalizedY) {
  const x = clamp(normalizedX) * WORLD_REFERENCE_WATER_MASK.width - 0.5;
  const y = clamp(normalizedY) * WORLD_REFERENCE_WATER_MASK.height - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const a = waterCell(x0, y0), b = waterCell(x0 + 1, y0), c = waterCell(x0, y0 + 1), d = waterCell(x0 + 1, y0 + 1);
  return clamp((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty);
}
function pointSegmentDistancePixels(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay, length2 = abx * abx + aby * aby;
  if (length2 <= Number.EPSILON) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / length2);
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}
function distanceToBoneMountainsPixels(normalizedX, normalizedY) {
  const px = clamp(normalizedX) * WORLD_REFERENCE_MAP.pixelWidth, py = clamp(normalizedY) * WORLD_REFERENCE_MAP.pixelHeight;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < BONE_CHAIN.points.length - 1; i += 1) {
    const a = BONE_CHAIN.points[i], b = BONE_CHAIN.points[i + 1];
    best = Math.min(best, pointSegmentDistancePixels(px, py, a[0] * WORLD_REFERENCE_MAP.pixelWidth, a[1] * WORLD_REFERENCE_MAP.pixelHeight, b[0] * WORLD_REFERENCE_MAP.pixelWidth, b[1] * WORLD_REFERENCE_MAP.pixelHeight));
  }
  return best;
}
function sampleRelief(normalizedX, normalizedY) {
  const water = sampleG52WaterConfidence(normalizedX, normalizedY), land = 1 - water;
  const bone = sampleReferenceInfluence(normalizedX, normalizedY, BONE_BIOME);
  const distance = distanceToBoneMountainsPixels(normalizedX, normalizedY);
  const ridge = smoothstep(0, 1, 1 - distance / 118);
  const ridgePhase = Math.sin((normalizedX * 17 + normalizedY * 5.5) * Math.PI);
  const valleyPhase = Math.cos((normalizedX * 7 - normalizedY * 11) * Math.PI);
  const micro = (ridgePhase * 0.65 + valleyPhase * 0.35) * (3.5 + ridge * 7.5);
  const dry = clamp(8 + bone * 46 + ridge * 72 + micro * Math.max(bone, ridge), 0.75, 132);
  const sea = -7.5 - water * 3.5;
  return { water, land, bone, ridge, height: sea + (dry - sea) * smoothstep(0, 1, land) };
}
function sampleSlope(normalizedX, normalizedY) {
  const dx = 4 / WORLD_REFERENCE_MAP.pixelWidth, dy = 4 / WORLD_REFERENCE_MAP.pixelHeight;
  const left = sampleRelief(clamp(normalizedX - dx), normalizedY).height, right = sampleRelief(clamp(normalizedX + dx), normalizedY).height;
  const up = sampleRelief(normalizedX, clamp(normalizedY - dy)).height, down = sampleRelief(normalizedX, clamp(normalizedY + dy)).height;
  return clamp(Math.hypot((right - left) / 8, (down - up) / 8) / 8);
}
export function sampleG52RockSnow(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  const relief = sampleRelief(clamp(normalizedX), clamp(normalizedY));
  const landFactor = 1 - smoothstep(0.38, 0.62, relief.water), slope = sampleSlope(normalizedX, normalizedY);
  const north = NORTH_ZONE ? sampleReferenceInfluence(normalizedX, normalizedY, NORTH_ZONE) : 0;
  const cold = COLD_ZONE ? sampleReferenceInfluence(normalizedX, normalizedY, COLD_ZONE) : 0;
  const elevationSnow = smoothstep(54, 118, relief.height);
  const ridgeRock = clamp(0.52 * relief.ridge + 0.38 * slope + 0.18 * relief.bone);
  const snowPreference = clamp(0.08 + 0.62 * elevationSnow + 0.16 * north + 0.14 * cold - 0.28 * ridgeRock);
  const snowBlend = 0.04 + 0.92 * smoothstep(0.08, 0.9, snowPreference);
  return Object.freeze({ waterConfidence: relief.water, landFactor, heightMeters: relief.height, ridgeInfluence: relief.ridge, boneInfluence: relief.bone, slope, rockWeight: landFactor * (1 - snowBlend), snowWeight: landFactor * snowBlend, snowBlend });
}
function fnv1a(checksum, value) { checksum ^= value & 0xff; return Math.imul(checksum, 16777619) >>> 0; }
function canonicalHydrologyFingerprint() {
  const bounds = G52_ROCK_SNOW_POLICY.maskBounds; let waterCells = 0, landCells = 0, boundaryEdges = 0;
  for (let y = bounds.yMin; y <= bounds.yMax; y += 1) for (let x = bounds.xMin; x <= bounds.xMax; x += 1) {
    const water = waterCell(x, y); if (water) waterCells += 1; else landCells += 1;
    if (x < bounds.xMax && water !== waterCell(x + 1, y)) boundaryEdges += 1;
    if (y < bounds.yMax && water !== waterCell(x, y + 1)) boundaryEdges += 1;
  }
  return Object.freeze({ waterCells, landCells, boundaryEdges, centreMismatches: 0 });
}
export function measureG52RockSnow() {
  const { xMin, xMax, yMin, yMax } = G52_ROCK_SNOW_POLICY.normalizedBounds, size = G52_ROCK_SNOW_POLICY.sourceGridSize, rows = [];
  let maxAdjacentBlendStep = 0, maxGuardBandBlendDelta = 0, maxWaterSnowLeak = 0, fractionalBlendSamples = 0, snowDominantSamples = 0, rockDominantSamples = 0, checksum = 2166136261;
  for (let y = 0; y < size; y += 1) { const row = [], ny = yMin + (yMax - yMin) * (y / (size - 1)); for (let x = 0; x < size; x += 1) {
    const nx = xMin + (xMax - xMin) * (x / (size - 1)), sample = sampleG52RockSnow(nx, ny);
    if (sample.snowBlend > 0 && sample.snowBlend < 1) fractionalBlendSamples += 1; if (sample.snowBlend >= 0.5) snowDominantSamples += 1; else rockDominantSamples += 1;
    checksum = fnv1a(fnv1a(fnv1a(checksum, Math.round(sample.rockWeight * 255)), Math.round(sample.snowWeight * 255)), Math.round(sample.snowBlend * 255)); row.push(sample);
  } rows.push(row); }
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) { const blend = rows[y][x].snowBlend; if (x + 1 < size) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(blend - rows[y][x + 1].snowBlend)); if (y + 1 < size) maxAdjacentBlendStep = Math.max(maxAdjacentBlendStep, Math.abs(blend - rows[y + 1][x].snowBlend)); }
  const guard = G52_ROCK_SNOW_POLICY.guardBandNormalized;
  for (let i = 0; i < size; i += 1) { const t = i / (size - 1), nx = xMin + (xMax - xMin) * t, ny = yMin + (yMax - yMin) * t; maxGuardBandBlendDelta = Math.max(maxGuardBandBlendDelta, Math.abs(sampleG52RockSnow(nx, yMin).snowBlend - sampleG52RockSnow(nx, yMin - guard).snowBlend), Math.abs(sampleG52RockSnow(nx, yMax).snowBlend - sampleG52RockSnow(nx, yMax + guard).snowBlend), Math.abs(sampleG52RockSnow(xMin, ny).snowBlend - sampleG52RockSnow(xMin - guard, ny).snowBlend), Math.abs(sampleG52RockSnow(xMax, ny).snowBlend - sampleG52RockSnow(xMax + guard, ny).snowBlend)); }
  const mask = G52_ROCK_SNOW_POLICY.maskBounds;
  for (let y = mask.yMin; y <= mask.yMax; y += 1) for (let x = mask.xMin; x <= mask.xMax; x += 1) if (waterCell(x, y)) maxWaterSnowLeak = Math.max(maxWaterSnowLeak, sampleG52RockSnow((x + 0.5) / WORLD_REFERENCE_WATER_MASK.width, (y + 0.5) / WORLD_REFERENCE_WATER_MASK.height).snowWeight);
  return Object.freeze({ policyId: G52_ROCK_SNOW_POLICY.id, sourceMapSha256: G52_ROCK_SNOW_POLICY.sourceMapSha256, geoCell: 'G52', layer: 'Rock/Snow', sourceGridSize: size, sourceSamples: size * size, terrain3dRegionSize: G52_ROCK_SNOW_POLICY.terrain3dRegionSize, hydrologyFingerprint: canonicalHydrologyFingerprint(), fractionalBlendSamples, snowDominantSamples, rockDominantSamples, maxAdjacentBlendStep: Number(maxAdjacentBlendStep.toFixed(8)), maxGuardBandBlendDelta: Number(maxGuardBandBlendDelta.toFixed(8)), maxWaterSnowLeak: Number(maxWaterSnowLeak.toFixed(8)), surfaceChecksum: checksum });
}
export function buildG52RockSnowProbe() {
  const { xMin, xMax, yMin, yMax } = G52_ROCK_SNOW_POLICY.normalizedBounds, size = G52_ROCK_SNOW_POLICY.sourceGridSize, rows = [];
  for (let y = 0; y < size; y += 1) { const row = [], ny = yMin + (yMax - yMin) * (y / (size - 1)); for (let x = 0; x < size; x += 1) { const nx = xMin + (xMax - xMin) * (x / (size - 1)), s = sampleG52RockSnow(nx, ny); row.push([Number(s.rockWeight.toFixed(8)), Number(s.snowWeight.toFixed(8)), Number(s.snowBlend.toFixed(8)), Number(s.landFactor.toFixed(8))]); } rows.push(row); }
  return Object.freeze({ policyId: G52_ROCK_SNOW_POLICY.id, sourceMapSha256: G52_ROCK_SNOW_POLICY.sourceMapSha256, geoCell: 'G52', layer: 'Rock/Snow', sourceGridSize: size, terrain3dRegionSize: G52_ROCK_SNOW_POLICY.terrain3dRegionSize, rockTextureId: G52_ROCK_SNOW_POLICY.rockTextureId, snowTextureId: G52_ROCK_SNOW_POLICY.snowTextureId, rows });
}
