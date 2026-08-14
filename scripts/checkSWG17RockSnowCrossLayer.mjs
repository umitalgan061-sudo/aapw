import { sampleG17WaterConfidence } from '../godot/terrain-authoring/geocells/sw/g17_hydrology.mjs';
import { sampleG17SeabedHeight } from '../godot/terrain-authoring/geocells/sw/g17_relief.mjs';
import { G17_ROCK_SNOW_POLICY, sampleG17RockSnow } from '../godot/terrain-authoring/geocells/sw/g17_rock_snow.mjs';

const bounds = G17_ROCK_SNOW_POLICY.normalizedBounds;
const size = G17_ROCK_SNOW_POLICY.sourceGridSize;
let samples = 0;
let maxHeightDrift = 0;
let maxWaterDrift = 0;
let maxWeightError = 0;
let maxSnowWeight = 0;
let minRockWeight = Infinity;
let maxRockWeight = -Infinity;
let checksum = 2166136261;

for (let y = 0; y < size; y += 1) {
  const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (y / (size - 1));
  for (let x = 0; x < size; x += 1) {
    const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (x / (size - 1));
    const surface = sampleG17RockSnow(nx, ny);
    const relief = sampleG17SeabedHeight(nx, ny);
    const water = sampleG17WaterConfidence(nx, ny);
    maxHeightDrift = Math.max(maxHeightDrift, Math.abs(surface.height - relief.height));
    maxWaterDrift = Math.max(maxWaterDrift, Math.abs(surface.waterConfidence - water));
    maxWeightError = Math.max(maxWeightError, Math.abs(surface.groundWeight + surface.rockWeight + surface.snowWeight - 1));
    maxSnowWeight = Math.max(maxSnowWeight, surface.snowWeight);
    minRockWeight = Math.min(minRockWeight, surface.rockWeight);
    maxRockWeight = Math.max(maxRockWeight, surface.rockWeight);
    checksum = Math.imul((checksum ^ Math.round(surface.rockWeight * 255)) >>> 0, 16777619) >>> 0;
    checksum = Math.imul((checksum ^ Math.round((surface.height + 16) * 32)) >>> 0, 16777619) >>> 0;
    samples += 1;
  }
}

if (samples !== 4225) throw new Error(`unexpected G17 cross-layer sample count ${samples}`);
if (maxHeightDrift !== 0) throw new Error(`G17 Rock/Snow diverged from Relief: ${maxHeightDrift}`);
if (maxWaterDrift !== 0) throw new Error(`G17 Rock/Snow diverged from Hydrology: ${maxWaterDrift}`);
if (maxWeightError > 1e-12) throw new Error(`G17 Rock/Snow weight sum drifted: ${maxWeightError}`);
if (maxSnowWeight !== 0) throw new Error(`G17 Rock/Snow invented snow: ${maxSnowWeight}`);
if (maxRockWeight - minRockWeight < 0.30) throw new Error('G17 Rock/Snow cross-layer blend span collapsed');

const metrics = {
  policyId: G17_ROCK_SNOW_POLICY.id,
  samples,
  maxHeightDrift,
  maxWaterDrift,
  maxWeightError,
  maxSnowWeight,
  minRockWeight: Number(minRockWeight.toFixed(8)),
  maxRockWeight: Number(maxRockWeight.toFixed(8)),
  checksum,
};
console.log(`SW_G17_ROCK_SNOW_CROSS_LAYER_METRICS=${JSON.stringify(metrics)}`);
console.log('SW_G17_ROCK_SNOW_CROSS_LAYER_OK');
