import {
  G77_ROCK_SNOW_POLICY,
  buildG77RockSnowControlContract,
  sampleG77RockSnow,
} from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const b = G77_ROCK_SNOW_POLICY.normalizedBounds;
const lerp = (a, c, t) => a + (c - a) * t;
const fnv = (sum, value) => Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
const sampleSize = 257;
const sampleCount = sampleSize * sampleSize;
const rock = new Float64Array(sampleCount);
const snow = new Float64Array(sampleCount);
const filteredSlope = new Float64Array(sampleCount);
const rawSlope = new Float64Array(sampleCount);
const water = new Float64Array(sampleCount);
const blend8 = new Uint8Array(sampleCount);
const quadrants = [0, 0, 0, 0];
const quantizedBins = new Set();

let maxAdjacentRockStep = 0;
let maxAdjacentSnowStep = 0;
let maxAdjacentFilteredSlopeStep = 0;
let maxAdjacentRawSlopeStep = 0;
let maxSecondDerivativeRock = 0;
let maxRegion255256RockStep = 0;
let maxQuantizationError = 0;
let waterLeakSamples = 0;
let fractionalRockSamples = 0;
let fractionalSnowSamples = 0;
let shorelineSamples = 0;
let minRock = Infinity;
let maxRock = -Infinity;
let maxMaterialWeight = 0;
let checksum = 2166136261;

for (let y = 0; y < sampleSize; y += 1) {
  const ny = lerp(b.yMin, b.yMax, y / (sampleSize - 1));
  for (let x = 0; x < sampleSize; x += 1) {
    const nx = lerp(b.xMin, b.xMax, x / (sampleSize - 1));
    const surface = sampleG77RockSnow(nx, ny);
    const control = buildG77RockSnowControlContract(surface);
    const index = y * sampleSize + x;
    if (![surface.rockWeight, surface.snowWeight, surface.rockBlend, surface.height, surface.slope, surface.rawSlope, surface.waterConfidence, surface.materialWeight].every(Number.isFinite)) {
      throw new Error(`non-finite G77 surface sample at ${x},${y}`);
    }
    rock[index] = surface.rockBlend;
    snow[index] = surface.snowWeight;
    filteredSlope[index] = surface.slope;
    rawSlope[index] = surface.rawSlope;
    water[index] = surface.waterConfidence;
    blend8[index] = control.overlayBlend8;
    quantizedBins.add(control.overlayBlend8);
    minRock = Math.min(minRock, surface.rockBlend);
    maxRock = Math.max(maxRock, surface.rockBlend);
    maxMaterialWeight = Math.max(maxMaterialWeight, surface.materialWeight);
    maxQuantizationError = Math.max(maxQuantizationError, Math.abs(control.overlayBlend8 / 255 - control.overlayBlend));
    if (surface.rockBlend > 0.001 && surface.rockBlend < 0.999) {
      fractionalRockSamples += 1;
      quadrants[(y >= 128 ? 2 : 0) + (x >= 128 ? 1 : 0)] += 1;
    }
    if (surface.snowWeight > 0.001 && surface.snowWeight < 0.999) fractionalSnowSamples += 1;
    if (surface.waterConfidence > 0.05 && surface.waterConfidence < 0.5) shorelineSamples += 1;
    if (surface.waterConfidence >= 0.5 && surface.rockWeight + surface.snowWeight > 1e-6) waterLeakSamples += 1;
    checksum = fnv(checksum, Math.round(surface.rockBlend * 255));
    checksum = fnv(checksum, Math.round(surface.snowWeight * 255));
    checksum = fnv(checksum, Math.round(surface.slope * 255));
    checksum = fnv(checksum, control.overlayBlend8);
  }
}

const valueAt = (array, x, y) => array[y * sampleSize + x];
for (let y = 0; y < sampleSize; y += 1) {
  for (let x = 0; x < sampleSize; x += 1) {
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (x + dx >= sampleSize || y + dy >= sampleSize) continue;
      maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(valueAt(rock, x, y) - valueAt(rock, x + dx, y + dy)));
      maxAdjacentSnowStep = Math.max(maxAdjacentSnowStep, Math.abs(valueAt(snow, x, y) - valueAt(snow, x + dx, y + dy)));
      maxAdjacentFilteredSlopeStep = Math.max(maxAdjacentFilteredSlopeStep, Math.abs(valueAt(filteredSlope, x, y) - valueAt(filteredSlope, x + dx, y + dy)));
      maxAdjacentRawSlopeStep = Math.max(maxAdjacentRawSlopeStep, Math.abs(valueAt(rawSlope, x, y) - valueAt(rawSlope, x + dx, y + dy)));
    }
    if (x > 0 && x + 1 < sampleSize) {
      maxSecondDerivativeRock = Math.max(maxSecondDerivativeRock, Math.abs(valueAt(rock, x - 1, y) - 2 * valueAt(rock, x, y) + valueAt(rock, x + 1, y)));
    }
    if (y > 0 && y + 1 < sampleSize) {
      maxSecondDerivativeRock = Math.max(maxSecondDerivativeRock, Math.abs(valueAt(rock, x, y - 1) - 2 * valueAt(rock, x, y) + valueAt(rock, x, y + 1)));
    }
  }
}
for (let i = 0; i < sampleSize; i += 1) {
  maxRegion255256RockStep = Math.max(
    maxRegion255256RockStep,
    Math.abs(valueAt(rock, 255, i) - valueAt(rock, 256, i)),
    Math.abs(valueAt(rock, i, 255) - valueAt(rock, i, 256)),
  );
}

let maxWestGuardRockDelta = 0;
let maxNorthGuardRockDelta = 0;
let maxWestGuardSnowDelta = 0;
let maxNorthGuardSnowDelta = 0;
const g = G77_ROCK_SNOW_POLICY.guardBandNormalized;
for (let i = 0; i < sampleSize; i += 1) {
  const t = i / (sampleSize - 1);
  const y = lerp(b.yMin, b.yMax, t);
  const x = lerp(b.xMin, b.xMax, t);
  const westA = sampleG77RockSnow(b.xMin, y);
  const westB = sampleG77RockSnow(b.xMin - g, y);
  const northA = sampleG77RockSnow(x, b.yMin);
  const northB = sampleG77RockSnow(x, b.yMin - g);
  maxWestGuardRockDelta = Math.max(maxWestGuardRockDelta, Math.abs(westA.rockBlend - westB.rockBlend));
  maxWestGuardSnowDelta = Math.max(maxWestGuardSnowDelta, Math.abs(westA.snowWeight - westB.snowWeight));
  maxNorthGuardRockDelta = Math.max(maxNorthGuardRockDelta, Math.abs(northA.rockBlend - northB.rockBlend));
  maxNorthGuardSnowDelta = Math.max(maxNorthGuardSnowDelta, Math.abs(northA.snowWeight - northB.snowWeight));
}

function downsample(source, size) {
  const nextSize = (size - 1) / 2 + 1;
  const out = new Float64Array(nextSize * nextSize);
  for (let y = 0; y < nextSize; y += 1) {
    for (let x = 0; x < nextSize; x += 1) out[y * nextSize + x] = source[(y * 2) * size + x * 2];
  }
  return [out, nextSize];
}
const lodSizes = [sampleSize];
const lodSpans = [maxRock - minRock];
let lod = rock;
let lodSize = sampleSize;
while (lodSize > 33) {
  [lod, lodSize] = downsample(lod, lodSize);
  lodSizes.push(lodSize);
  let lodMin = Infinity;
  let lodMax = -Infinity;
  for (const value of lod) { lodMin = Math.min(lodMin, value); lodMax = Math.max(lodMax, value); }
  lodSpans.push(lodMax - lodMin);
}

const metrics = {
  sampleSize,
  samples: sampleCount,
  fractionalRockSamples,
  fractionalSnowSamples,
  shorelineSamples,
  waterLeakSamples,
  fractionalRockByQuadrant: quadrants,
  quantizedBlendBins: quantizedBins.size,
  minRock: Number(minRock.toFixed(8)),
  maxRock: Number(maxRock.toFixed(8)),
  maxMaterialWeight: Number(maxMaterialWeight.toFixed(8)),
  maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)),
  maxAdjacentSnowStep: Number(maxAdjacentSnowStep.toFixed(8)),
  maxAdjacentFilteredSlopeStep: Number(maxAdjacentFilteredSlopeStep.toFixed(8)),
  maxAdjacentRawSlopeStep: Number(maxAdjacentRawSlopeStep.toFixed(8)),
  maxSecondDerivativeRock: Number(maxSecondDerivativeRock.toFixed(8)),
  maxRegion255256RockStep: Number(maxRegion255256RockStep.toFixed(8)),
  maxQuantizationError: Number(maxQuantizationError.toFixed(8)),
  maxWestGuardRockDelta: Number(maxWestGuardRockDelta.toFixed(8)),
  maxNorthGuardRockDelta: Number(maxNorthGuardRockDelta.toFixed(8)),
  maxWestGuardSnowDelta: Number(maxWestGuardSnowDelta.toFixed(8)),
  maxNorthGuardSnowDelta: Number(maxNorthGuardSnowDelta.toFixed(8)),
  lodSizes,
  lodSpans: lodSpans.map((value) => Number(value.toFixed(8))),
  checksum,
};
console.log(`SE_G77_ROCK_SNOW_CONTROL_ENVELOPE=${JSON.stringify(metrics)}`);

if (waterLeakSamples !== 0) throw new Error(`dense canonical-water surface leakage: ${waterLeakSamples}`);
if (fractionalRockSamples < 4096) throw new Error(`dense rock field lacks continuous samples: ${fractionalRockSamples}`);
if (shorelineSamples < 1024) throw new Error(`dense shoreline coverage collapsed: ${shorelineSamples}`);
if (quadrants.some((count) => count < 128)) throw new Error(`fractional rock coverage missing from a quadrant: ${quadrants.join(',')}`);
if (maxRock - minRock < 0.01) throw new Error(`dense rock span collapsed: ${maxRock - minRock}`);
if (maxMaterialWeight > 1 + G77_ROCK_SNOW_POLICY.weightEpsilon) throw new Error(`dense material weight exceeded one: ${maxMaterialWeight}`);
if (maxAdjacentRockStep > 0.08) throw new Error(`dense adjacent rock step too large: ${maxAdjacentRockStep}`);
if (maxAdjacentSnowStep > 0.08) throw new Error(`dense adjacent snow step too large: ${maxAdjacentSnowStep}`);
if (maxAdjacentFilteredSlopeStep > 0.08) throw new Error(`dense filtered slope step too large: ${maxAdjacentFilteredSlopeStep}`);
if (maxAdjacentFilteredSlopeStep >= maxAdjacentRawSlopeStep * 0.5) throw new Error(`dense slope filter insufficient: raw=${maxAdjacentRawSlopeStep} filtered=${maxAdjacentFilteredSlopeStep}`);
if (maxSecondDerivativeRock > 0.13) throw new Error(`dense rock curvature spike too large: ${maxSecondDerivativeRock}`);
if (maxRegion255256RockStep > 0.04) throw new Error(`255/256 source seam rock step too large: ${maxRegion255256RockStep}`);
if (maxQuantizationError > 1 / 510 + 1e-9) throw new Error(`8-bit control quantization error too large: ${maxQuantizationError}`);
if (quantizedBins.size < 16) throw new Error(`control blend collapsed to too few 8-bit levels: ${quantizedBins.size}`);
if (Math.max(maxWestGuardRockDelta, maxNorthGuardRockDelta) > 0.08) throw new Error('dense guard-band rock seam too large');
if (Math.max(maxWestGuardSnowDelta, maxNorthGuardSnowDelta) > 0.05) throw new Error('dense guard-band snow seam too large');
if (lodSizes.join(',') !== '257,129,65,33') throw new Error(`unexpected source LOD chain ${lodSizes.join(',')}`);
if (lodSpans.some((span) => span < 0.01)) throw new Error(`rock variation vanished in LOD chain: ${lodSpans.join(',')}`);
console.log('SE_G77_ROCK_SNOW_CONTROL_ENVELOPE_OK');
