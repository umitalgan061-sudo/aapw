import { G77_ROCK_SNOW_POLICY, buildG77RockSnowControlContract, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const p = G77_ROCK_SNOW_POLICY;
const b = p.normalizedBounds;
const size = 257;
const lerp = (a, c, t) => a + (c - a) * t;
const index = (x, y) => y * size + x;
const rock = new Float64Array(size * size);
const snow = new Float64Array(size * size);
const rawSlope = new Float64Array(size * size);
const filteredSlope = new Float64Array(size * size);
const control8 = new Uint8Array(size * size);
let fractionalRockSamples = 0;
let fractionalSnowSamples = 0;
let canonicalWaterLeakSamples = 0;
let shorelineSamples = 0;
let maxRock = -Infinity;
let minRock = Infinity;
let maxAdjacentRockStep = 0;
let maxAdjacentSnowStep = 0;
let maxRawSlopeStep = 0;
let maxFilteredSlopeStep = 0;
let maxRockCurvature = 0;
let maxControlQuantizationError = 0;
let minMaterialWeight = Infinity;
let maxMaterialWeight = -Infinity;
let checksum = 2166136261;
const fnv = (sum, value) => Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;

for (let y = 0; y < size; y += 1) {
  const ny = lerp(b.yMin, b.yMax, y / (size - 1));
  for (let x = 0; x < size; x += 1) {
    const nx = lerp(b.xMin, b.xMax, x / (size - 1));
    const s = sampleG77RockSnow(nx, ny);
    const c = buildG77RockSnowControlContract(s);
    const i = index(x, y);
    rock[i] = s.rockBlend;
    snow[i] = s.snowWeight;
    rawSlope[i] = s.rawSlope;
    filteredSlope[i] = s.slope;
    control8[i] = c.overlayBlend8;
    minRock = Math.min(minRock, s.rockBlend);
    maxRock = Math.max(maxRock, s.rockBlend);
    minMaterialWeight = Math.min(minMaterialWeight, s.materialWeight);
    maxMaterialWeight = Math.max(maxMaterialWeight, s.materialWeight);
    if (s.rockBlend > 0.001 && s.rockBlend < 0.999) fractionalRockSamples += 1;
    if (s.snowWeight > 0.001 && s.snowWeight < 0.999) fractionalSnowSamples += 1;
    if (s.waterConfidence > 0.05 && s.waterConfidence < 0.5) shorelineSamples += 1;
    if (s.waterConfidence >= 0.5 && s.rockWeight + s.snowWeight > 1e-6) canonicalWaterLeakSamples += 1;
    maxControlQuantizationError = Math.max(maxControlQuantizationError, Math.abs(c.overlayBlend - c.overlayBlend8 / 255));
    checksum = fnv(checksum, c.overlayBlend8);
    checksum = fnv(checksum, c.overlayTextureId);
  }
}

for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
  const i = index(x, y);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    if (x + dx >= size || y + dy >= size) continue;
    const j = index(x + dx, y + dy);
    maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(rock[i] - rock[j]));
    maxAdjacentSnowStep = Math.max(maxAdjacentSnowStep, Math.abs(snow[i] - snow[j]));
    maxRawSlopeStep = Math.max(maxRawSlopeStep, Math.abs(rawSlope[i] - rawSlope[j]));
    maxFilteredSlopeStep = Math.max(maxFilteredSlopeStep, Math.abs(filteredSlope[i] - filteredSlope[j]));
  }
  if (x > 0 && x + 1 < size) maxRockCurvature = Math.max(maxRockCurvature, Math.abs(rock[index(x - 1, y)] - 2 * rock[i] + rock[index(x + 1, y)]));
  if (y > 0 && y + 1 < size) maxRockCurvature = Math.max(maxRockCurvature, Math.abs(rock[index(x, y - 1)] - 2 * rock[i] + rock[index(x, y + 1)]));
}

let maxWestGuardRockDelta = 0;
let maxNorthGuardRockDelta = 0;
let maxWestGuardSnowDelta = 0;
let maxNorthGuardSnowDelta = 0;
const g = p.guardBandNormalized;
for (let i = 0; i < size; i += 1) {
  const t = i / (size - 1);
  const y = lerp(b.yMin, b.yMax, t);
  const x = lerp(b.xMin, b.xMax, t);
  const westA = sampleG77RockSnow(b.xMin, y), westB = sampleG77RockSnow(b.xMin - g, y);
  const northA = sampleG77RockSnow(x, b.yMin), northB = sampleG77RockSnow(x, b.yMin - g);
  maxWestGuardRockDelta = Math.max(maxWestGuardRockDelta, Math.abs(westA.rockBlend - westB.rockBlend));
  maxNorthGuardRockDelta = Math.max(maxNorthGuardRockDelta, Math.abs(northA.rockBlend - northB.rockBlend));
  maxWestGuardSnowDelta = Math.max(maxWestGuardSnowDelta, Math.abs(westA.snowWeight - westB.snowWeight));
  maxNorthGuardSnowDelta = Math.max(maxNorthGuardSnowDelta, Math.abs(northA.snowWeight - northB.snowWeight));
}

const seamPairs = [];
for (const c of [255, 256]) {
  for (let q = 0; q <= 256; q += 16) {
    seamPairs.push([index(c, q), index(c === 255 ? 256 : 255, q)]);
    seamPairs.push([index(q, c), index(q, c === 255 ? 256 : 255)]);
  }
}
let max255256RockStep = 0;
let max255256SnowStep = 0;
for (const [a, c] of seamPairs) {
  max255256RockStep = Math.max(max255256RockStep, Math.abs(rock[a] - rock[c]));
  max255256SnowStep = Math.max(max255256SnowStep, Math.abs(snow[a] - snow[c]));
}

function downsample(source, n) {
  const next = (n - 1) / 2 + 1;
  const out = new Float64Array(next * next);
  for (let y = 0; y < next; y += 1) for (let x = 0; x < next; x += 1) out[y * next + x] = source[(y * 2) * n + x * 2];
  return [out, next];
}
const lodSizes = [size];
let lod = rock, lodSize = size;
while (lodSize > 33) { [lod, lodSize] = downsample(lod, lodSize); lodSizes.push(lodSize); }

const metrics = { size, samples: size * size, fractionalRockSamples, fractionalSnowSamples, canonicalWaterLeakSamples, shorelineSamples, minRock: Number(minRock.toFixed(8)), maxRock: Number(maxRock.toFixed(8)), maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)), maxAdjacentSnowStep: Number(maxAdjacentSnowStep.toFixed(8)), maxRawSlopeStep: Number(maxRawSlopeStep.toFixed(8)), maxFilteredSlopeStep: Number(maxFilteredSlopeStep.toFixed(8)), maxRockCurvature: Number(maxRockCurvature.toFixed(8)), maxWestGuardRockDelta: Number(maxWestGuardRockDelta.toFixed(8)), maxNorthGuardRockDelta: Number(maxNorthGuardRockDelta.toFixed(8)), maxWestGuardSnowDelta: Number(maxWestGuardSnowDelta.toFixed(8)), maxNorthGuardSnowDelta: Number(maxNorthGuardSnowDelta.toFixed(8)), max255256RockStep: Number(max255256RockStep.toFixed(8)), max255256SnowStep: Number(max255256SnowStep.toFixed(8)), minMaterialWeight: Number(minMaterialWeight.toFixed(8)), maxMaterialWeight: Number(maxMaterialWeight.toFixed(8)), maxControlQuantizationError: Number(maxControlQuantizationError.toFixed(8)), lodSizes, checksum };
console.log(`SE_G77_ROCK_SNOW_CONTROL_ENVELOPE=${JSON.stringify(metrics)}`);
if (canonicalWaterLeakSamples !== 0) throw new Error(`dense canonical-water leakage: ${canonicalWaterLeakSamples}`);
if (fractionalRockSamples < 4096) throw new Error(`dense rock field lacks continuous samples: ${fractionalRockSamples}`);
if (shorelineSamples < 512) throw new Error(`shoreline sampling insufficient: ${shorelineSamples}`);
if (maxRock - minRock < 0.01) throw new Error('dense rock span collapsed');
if (maxAdjacentRockStep > 0.08 || maxAdjacentSnowStep > 0.08) throw new Error('dense material adjacency too sharp');
if (maxFilteredSlopeStep > maxRawSlopeStep + 1e-9) throw new Error('filtered relief is rougher than raw relief');
if (Math.max(maxWestGuardRockDelta, maxNorthGuardRockDelta) > 0.08) throw new Error('dense rock guard seam too large');
if (Math.max(maxWestGuardSnowDelta, maxNorthGuardSnowDelta) > 0.05) throw new Error('dense snow guard seam too large');
if (Math.max(max255256RockStep, max255256SnowStep) > 0.08) throw new Error('255/256 source seam too large');
if (maxControlQuantizationError > 1 / 255 + 1e-9) throw new Error('Terrain3D control quantization error too high');
if (lodSizes.join(',') !== '257,129,65,33') throw new Error(`unexpected LOD chain ${lodSizes.join(',')}`);
console.log('SE_G77_ROCK_SNOW_CONTROL_ENVELOPE_OK');
