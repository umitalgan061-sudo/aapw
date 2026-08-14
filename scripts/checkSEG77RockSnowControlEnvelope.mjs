import { sampleG77RockSnow, G77_ROCK_SNOW_POLICY } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';
const b = G77_ROCK_SNOW_POLICY.normalizedBounds;
const lerp = (a, c, t) => a + (c - a) * t;
const sampleSize = 257;
const values = new Float64Array(sampleSize * sampleSize);
let maxAdjacentRockStep = 0, maxAdjacentSnowStep = 0, waterLeakSamples = 0, fractionalRockSamples = 0, fractionalSnowSamples = 0, minRock = Infinity, maxRock = -Infinity, checksum = 2166136261;
const fnv = (sum, value) => Math.imul((sum ^ (value & 0xff)) >>> 0, 16777619) >>> 0;
for (let y = 0; y < sampleSize; y += 1) {
  const ny = lerp(b.yMin, b.yMax, y / (sampleSize - 1));
  for (let x = 0; x < sampleSize; x += 1) {
    const nx = lerp(b.xMin, b.xMax, x / (sampleSize - 1));
    const s = sampleG77RockSnow(nx, ny), index = y * sampleSize + x;
    if (![s.rockWeight, s.snowWeight, s.rockBlend, s.height, s.slope].every(Number.isFinite)) throw new Error('non-finite G77 surface sample');
    values[index] = s.rockBlend; minRock = Math.min(minRock, s.rockBlend); maxRock = Math.max(maxRock, s.rockBlend);
    if (s.rockBlend > 0.001 && s.rockBlend < 0.999) fractionalRockSamples += 1;
    if (s.snowWeight > 0.001 && s.snowWeight < 0.999) fractionalSnowSamples += 1;
    if (s.waterConfidence >= 0.5 && s.rockWeight + s.snowWeight > 1e-6) waterLeakSamples += 1;
    checksum = fnv(checksum, Math.round(s.rockBlend * 255)); checksum = fnv(checksum, Math.round(s.snowWeight * 255));
    if (x > 0) { const p = sampleG77RockSnow(lerp(b.xMin, b.xMax, (x - 1) / (sampleSize - 1)), ny); maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(s.rockBlend - p.rockBlend)); maxAdjacentSnowStep = Math.max(maxAdjacentSnowStep, Math.abs(s.snowWeight - p.snowWeight)); }
    if (y > 0) { const p = sampleG77RockSnow(nx, lerp(b.yMin, b.yMax, (y - 1) / (sampleSize - 1))); maxAdjacentRockStep = Math.max(maxAdjacentRockStep, Math.abs(s.rockBlend - p.rockBlend)); maxAdjacentSnowStep = Math.max(maxAdjacentSnowStep, Math.abs(s.snowWeight - p.snowWeight)); }
  }
}
let maxWestGuardRockDelta = 0, maxNorthGuardRockDelta = 0, maxWestGuardSnowDelta = 0, maxNorthGuardSnowDelta = 0;
const g = G77_ROCK_SNOW_POLICY.guardBandNormalized;
for (let i = 0; i < sampleSize; i += 1) {
  const t = i / (sampleSize - 1), y = lerp(b.yMin, b.yMax, t), x = lerp(b.xMin, b.xMax, t);
  const westA = sampleG77RockSnow(b.xMin, y), westB = sampleG77RockSnow(b.xMin - g, y), northA = sampleG77RockSnow(x, b.yMin), northB = sampleG77RockSnow(x, b.yMin - g);
  maxWestGuardRockDelta = Math.max(maxWestGuardRockDelta, Math.abs(westA.rockBlend - westB.rockBlend)); maxWestGuardSnowDelta = Math.max(maxWestGuardSnowDelta, Math.abs(westA.snowWeight - westB.snowWeight));
  maxNorthGuardRockDelta = Math.max(maxNorthGuardRockDelta, Math.abs(northA.rockBlend - northB.rockBlend)); maxNorthGuardSnowDelta = Math.max(maxNorthGuardSnowDelta, Math.abs(northA.snowWeight - northB.snowWeight));
}
function downsample(source, size) { const nextSize = (size - 1) / 2 + 1, out = new Float64Array(nextSize * nextSize); for (let y = 0; y < nextSize; y += 1) for (let x = 0; x < nextSize; x += 1) out[y * nextSize + x] = source[(y * 2) * size + x * 2]; return [out, nextSize]; }
const lodSizes = [sampleSize]; let lod = values, lodSize = sampleSize;
while (lodSize > 33) { [lod, lodSize] = downsample(lod, lodSize); lodSizes.push(lodSize); }
const metrics = { sampleSize, samples: sampleSize * sampleSize, fractionalRockSamples, fractionalSnowSamples, waterLeakSamples, minRock: Number(minRock.toFixed(8)), maxRock: Number(maxRock.toFixed(8)), maxAdjacentRockStep: Number(maxAdjacentRockStep.toFixed(8)), maxAdjacentSnowStep: Number(maxAdjacentSnowStep.toFixed(8)), maxWestGuardRockDelta: Number(maxWestGuardRockDelta.toFixed(8)), maxNorthGuardRockDelta: Number(maxNorthGuardRockDelta.toFixed(8)), maxWestGuardSnowDelta: Number(maxWestGuardSnowDelta.toFixed(8)), maxNorthGuardSnowDelta: Number(maxNorthGuardSnowDelta.toFixed(8)), lodSizes, checksum };
console.log(`SE_G77_ROCK_SNOW_CONTROL_ENVELOPE=${JSON.stringify(metrics)}`);
if (waterLeakSamples !== 0) throw new Error(`dense canonical-water surface leakage: ${waterLeakSamples}`);
if (fractionalRockSamples < 4096) throw new Error(`dense rock field lacks continuous samples: ${fractionalRockSamples}`);
if (maxRock - minRock < 0.01) throw new Error(`dense rock span collapsed: ${maxRock - minRock}`);
if (maxAdjacentRockStep > 0.08) throw new Error(`dense adjacent rock step too large: ${maxAdjacentRockStep}`);
if (maxAdjacentSnowStep > 0.08) throw new Error(`dense adjacent snow step too large: ${maxAdjacentSnowStep}`);
if (Math.max(maxWestGuardRockDelta, maxNorthGuardRockDelta) > 0.08) throw new Error('dense guard-band rock seam too large');
if (Math.max(maxWestGuardSnowDelta, maxNorthGuardSnowDelta) > 0.05) throw new Error('dense guard-band snow seam too large');
if (lodSizes.join(',') !== '257,129,65,33') throw new Error(`unexpected source LOD chain ${lodSizes.join(',')}`);
console.log('SE_G77_ROCK_SNOW_CONTROL_ENVELOPE_OK');
