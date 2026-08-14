import crypto from 'node:crypto';
import {
  G77_RELIEF_POLICY,
  sampleG77ReliefHeight,
  sampleG77ReliefNormal,
} from '../godot/terrain-authoring/geocells/se/g77_relief.mjs';
import { sampleG77WaterConfidence } from '../godot/terrain-authoring/geocells/se/g77_hydrology.mjs';

const fail = (message) => { throw new Error(`[checkSEG77ReliefContinuity] FAIL: ${message}`); };
const need = (condition, message) => { if (!condition) fail(message); };
const lerp = (a, b, t) => a + (b - a) * t;
const normalDelta = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const finiteNormal = (n) => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z);

const bounds = G77_RELIEF_POLICY.normalizedBounds;
const density = 193;
const dx = (bounds.xMax - bounds.xMin) / (density - 1);
const dy = (bounds.yMax - bounds.yMin) / (density - 1);
const metersPerDx = dx * G77_RELIEF_POLICY.worldWidthMeters;
const metersPerDy = dy * G77_RELIEF_POLICY.worldDepthMeters;

let minHeight = Infinity;
let maxHeight = -Infinity;
let maxStepX = 0;
let maxStepY = 0;
let maxSlopeX = 0;
let maxSlopeY = 0;
let maxNormalStep = 0;
let wetSamples = 0;
let drySamples = 0;
let waterlineSamples = 0;
let transitionSamples = 0;
let nonPositiveDrySamples = 0;
let nonNegativeWetSamples = 0;
let waterlineMismatches = 0;
const checksum = crypto.createHash('sha256');
let previousRow = null;

for (let y = 0; y < density; y += 1) {
  const ny = lerp(bounds.yMin, bounds.yMax, y / (density - 1));
  const row = [];
  for (let x = 0; x < density; x += 1) {
    const nx = lerp(bounds.xMin, bounds.xMax, x / (density - 1));
    const height = sampleG77ReliefHeight(nx, ny);
    const normal = sampleG77ReliefNormal(nx, ny);
    const water = sampleG77WaterConfidence(nx, ny);
    need(Number.isFinite(height), `non-finite height at ${x},${y}`);
    need(finiteNormal(normal), `non-finite normal at ${x},${y}`);
    minHeight = Math.min(minHeight, height);
    maxHeight = Math.max(maxHeight, height);
    if (water > 0.5) {
      wetSamples += 1;
      if (height >= 0) nonNegativeWetSamples += 1;
    } else if (water < 0.5) {
      drySamples += 1;
      if (height <= 0) nonPositiveDrySamples += 1;
    } else {
      waterlineSamples += 1;
      if (Math.abs(height) > 1e-9) waterlineMismatches += 1;
    }
    if (water > 0.15 && water < 0.85) transitionSamples += 1;
    if (x > 0) {
      const left = row[x - 1];
      const step = Math.abs(height - left.height);
      maxStepX = Math.max(maxStepX, step);
      maxSlopeX = Math.max(maxSlopeX, step / metersPerDx);
      maxNormalStep = Math.max(maxNormalStep, normalDelta(normal, left.normal));
    }
    if (previousRow) {
      const above = previousRow[x];
      const step = Math.abs(height - above.height);
      maxStepY = Math.max(maxStepY, step);
      maxSlopeY = Math.max(maxSlopeY, step / metersPerDy);
      maxNormalStep = Math.max(maxNormalStep, normalDelta(normal, above.normal));
    }
    row.push({ height, normal });
    checksum.update(`${Math.round(height * 1e6)},${Math.round(normal.x * 1e7)},${Math.round(normal.y * 1e7)},${Math.round(normal.z * 1e7)};`);
  }
  previousRow = row;
}

const epsilon = 1 / 1536;
let maxBoundaryHeightJump = 0;
let maxBoundaryNormalJump = 0;
let maxBoundaryDerivativeKink = 0;
let boundarySamples = 0;
for (let i = 0; i < density; i += 1) {
  const t = i / (density - 1);
  const y = lerp(bounds.yMin, bounds.yMax, t);
  const x = lerp(bounds.xMin, bounds.xMax, t);
  const triples = [
    [bounds.xMin - epsilon, y, bounds.xMin, y, bounds.xMin + epsilon, y],
    [x, bounds.yMin - epsilon, x, bounds.yMin, x, bounds.yMin + epsilon],
  ];
  for (const [x0, y0, x1, y1, x2, y2] of triples) {
    const h0 = sampleG77ReliefHeight(x0, y0);
    const h1 = sampleG77ReliefHeight(x1, y1);
    const h2 = sampleG77ReliefHeight(x2, y2);
    const n0 = sampleG77ReliefNormal(x0, y0);
    const n1 = sampleG77ReliefNormal(x1, y1);
    const n2 = sampleG77ReliefNormal(x2, y2);
    maxBoundaryHeightJump = Math.max(maxBoundaryHeightJump, Math.abs(h1 - h0), Math.abs(h2 - h1));
    maxBoundaryNormalJump = Math.max(maxBoundaryNormalJump, normalDelta(n0, n1), normalDelta(n1, n2));
    maxBoundaryDerivativeKink = Math.max(maxBoundaryDerivativeKink, Math.abs((h1 - h0) - (h2 - h1)));
    boundarySamples += 1;
  }
}

need(wetSamples > 0 && drySamples > 0, `dense field lost mixed land/water character: wet=${wetSamples} dry=${drySamples}`);
need(transitionSamples > 0, 'dense field contains no continuous coast transition samples');
need(nonPositiveDrySamples === 0, `dry relief crossed sea level at ${nonPositiveDrySamples} dense samples`);
need(nonNegativeWetSamples === 0, `wet relief crossed sea level at ${nonNegativeWetSamples} dense samples`);
need(waterlineMismatches === 0, `waterline relief is not exactly zero at ${waterlineMismatches}/${waterlineSamples} samples`);
need(maxHeight - minHeight > 2, `relief span too small: ${maxHeight - minHeight}`);
need(maxStepX <= 4 && maxStepY <= 4, `dense adjacent step too high: x=${maxStepX} y=${maxStepY}`);
need(maxSlopeX <= 0.5 && maxSlopeY <= 0.5, `physical slope too high: x=${maxSlopeX} y=${maxSlopeY}`);
need(maxNormalStep <= 0.25, `dense normal step too high: ${maxNormalStep}`);
need(maxBoundaryHeightJump <= 2, `owner-map boundary height jump too high: ${maxBoundaryHeightJump}`);
need(maxBoundaryNormalJump <= 0.25, `owner-map boundary normal jump too high: ${maxBoundaryNormalJump}`);
need(maxBoundaryDerivativeKink <= 2, `owner-map boundary derivative kink too high: ${maxBoundaryDerivativeKink}`);

const metrics = Object.freeze({
  schema: 'se-g77-relief-continuity-v1', sourceMapSha256: G77_RELIEF_POLICY.sourceMapSha256,
  density, samples: density * density, boundarySamples, wetSamples, drySamples, waterlineSamples, transitionSamples,
  minHeight: Number(minHeight.toFixed(8)), maxHeight: Number(maxHeight.toFixed(8)), heightSpan: Number((maxHeight - minHeight).toFixed(8)),
  maxStepX: Number(maxStepX.toFixed(8)), maxStepY: Number(maxStepY.toFixed(8)),
  maxSlopeX: Number(maxSlopeX.toFixed(10)), maxSlopeY: Number(maxSlopeY.toFixed(10)), maxNormalStep: Number(maxNormalStep.toFixed(10)),
  maxBoundaryHeightJump: Number(maxBoundaryHeightJump.toFixed(8)), maxBoundaryNormalJump: Number(maxBoundaryNormalJump.toFixed(10)),
  maxBoundaryDerivativeKink: Number(maxBoundaryDerivativeKink.toFixed(8)), checksumSha256: checksum.digest('hex'),
});
console.log(`SE_G77_RELIEF_CONTINUITY_METRICS=${JSON.stringify(metrics)}`);
console.log('SE_G77_RELIEF_CONTINUITY_OK');
