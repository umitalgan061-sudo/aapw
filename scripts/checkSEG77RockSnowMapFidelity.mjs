import { G77_ROCK_SNOW_POLICY, sampleG77RockSnow } from '../godot/terrain-authoring/geocells/se/g77_rock_snow.mjs';

const p = G77_ROCK_SNOW_POLICY;
const b = p.normalizedBounds;
const N = 513;
const lerp = (a, c, t) => a + (c - a) * t;
const water = new Float64Array(N * N);
const material = new Float64Array(N * N);
const idx = (x, y) => y * N + x;
let fractionalWater = 0;
let fractionalMaterial = 0;
let waterLeak = 0;
let contourEdges = 0;
let contourMaterialEdges = 0;
let maxMaterialStep = 0;
let maxContourMaterialStep = 0;
let maxInteriorMaterialStep = 0;
let verticalGridEnergy = 0;
let horizontalGridEnergy = 0;
let nonGridEnergy = 0;
let verticalGridSamples = 0;
let horizontalGridSamples = 0;
let nonGridSamples = 0;

for (let y = 0; y < N; y += 1) {
  const ny = lerp(b.yMin, b.yMax, y / (N - 1));
  for (let x = 0; x < N; x += 1) {
    const nx = lerp(b.xMin, b.xMax, x / (N - 1));
    const s = sampleG77RockSnow(nx, ny);
    const w = s.waterConfidence;
    const m = Math.max(s.rockWeight, s.snowWeight);
    water[idx(x, y)] = w;
    material[idx(x, y)] = m;
    if (w > 0 && w < 1) fractionalWater += 1;
    if (m > 0.001 && m < 0.999) fractionalMaterial += 1;
    if (w >= 0.5 && s.rockWeight + s.snowWeight > 1e-6) waterLeak += 1;
  }
}

for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    if (x + dx >= N || y + dy >= N) continue;
    const a = idx(x, y), c = idx(x + dx, y + dy);
    const step = Math.abs(material[a] - material[c]);
    maxMaterialStep = Math.max(maxMaterialStep, step);
    const crossesCoast = (water[a] < 0.5) !== (water[c] < 0.5);
    if (crossesCoast) {
      contourEdges += 1;
      if (step > 1e-6) contourMaterialEdges += 1;
      maxContourMaterialStep = Math.max(maxContourMaterialStep, step);
    } else {
      maxInteriorMaterialStep = Math.max(maxInteriorMaterialStep, step);
    }
    const gridX = dx === 1 && x > 0 && x % 64 === 0;
    const gridY = dy === 1 && y > 0 && y % 64 === 0;
    if (gridX) { verticalGridEnergy += step; verticalGridSamples += 1; }
    else if (gridY) { horizontalGridEnergy += step; horizontalGridSamples += 1; }
    else { nonGridEnergy += step; nonGridSamples += 1; }
  }
}

const meanVerticalGridStep = verticalGridEnergy / Math.max(1, verticalGridSamples);
const meanHorizontalGridStep = horizontalGridEnergy / Math.max(1, horizontalGridSamples);
const meanNonGridStep = nonGridEnergy / Math.max(1, nonGridSamples);
const gridEnergyRatio = Math.max(meanVerticalGridStep, meanHorizontalGridStep) / Math.max(1e-9, meanNonGridStep);

let westGuardMax = 0, northGuardMax = 0;
for (let i = 0; i < N; i += 1) {
  const t = i / (N - 1), y = lerp(b.yMin, b.yMax, t), x = lerp(b.xMin, b.xMax, t);
  westGuardMax = Math.max(westGuardMax, Math.abs(sampleG77RockSnow(b.xMin, y).rockBlend - sampleG77RockSnow(b.xMin - p.guardBandNormalized, y).rockBlend));
  northGuardMax = Math.max(northGuardMax, Math.abs(sampleG77RockSnow(x, b.yMin).rockBlend - sampleG77RockSnow(x, b.yMin - p.guardBandNormalized).rockBlend));
}

const metrics = {
  schema: 'se-g77-rock-snow-map-fidelity-r9',
  sourceMapSha256: p.sourceMapSha256,
  size: N,
  samples: N * N,
  fractionalWater,
  fractionalMaterial,
  waterLeak,
  contourEdges,
  contourMaterialEdges,
  maxMaterialStep: Number(maxMaterialStep.toFixed(8)),
  maxContourMaterialStep: Number(maxContourMaterialStep.toFixed(8)),
  maxInteriorMaterialStep: Number(maxInteriorMaterialStep.toFixed(8)),
  meanVerticalGridStep: Number(meanVerticalGridStep.toFixed(10)),
  meanHorizontalGridStep: Number(meanHorizontalGridStep.toFixed(10)),
  meanNonGridStep: Number(meanNonGridStep.toFixed(10)),
  gridEnergyRatio: Number(gridEnergyRatio.toFixed(6)),
  westGuardMax: Number(westGuardMax.toFixed(8)),
  northGuardMax: Number(northGuardMax.toFixed(8)),
};
console.log(`SE_G77_ROCK_SNOW_MAP_FIDELITY=${JSON.stringify(metrics)}`);
if (fractionalWater < 50000) throw new Error(`coast lost filtered high-resolution transition: ${fractionalWater}`);
if (fractionalMaterial < 4096) throw new Error(`material field too blocky: ${fractionalMaterial}`);
if (waterLeak !== 0) throw new Error(`material leaked to canonical water: ${waterLeak}`);
if (contourEdges < 500) throw new Error(`coast contour under-sampled: ${contourEdges}`);
if (maxMaterialStep > 0.08 || maxContourMaterialStep > 0.08) throw new Error('material transition too sharp');
if (Math.max(westGuardMax, northGuardMax) > 0.08) throw new Error('owner-map guard seam too large');
if (gridEnergyRatio > 3.0) throw new Error(`possible 65/257 grid imprint detected: ${gridEnergyRatio}`);
console.log('SE_G77_ROCK_SNOW_MAP_FIDELITY_OK');