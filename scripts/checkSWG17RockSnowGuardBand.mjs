import {
  G17_ROCK_SNOW_POLICY,
  sampleG17RockSnow,
} from '../godot/terrain-authoring/geocells/sw/g17_rock_snow.mjs';

const bounds = G17_ROCK_SNOW_POLICY.normalizedBounds;
const guard = G17_ROCK_SNOW_POLICY.guardBandNormalized;
const samplesPerEdge = 1025;
let maxRockDelta = 0;
let maxSlopeDelta = 0;
let comparedPairs = 0;

function compare(ax, ay, bx, by) {
  const a = sampleG17RockSnow(ax, ay);
  const b = sampleG17RockSnow(bx, by);
  for (const value of [a.rockBlend, b.rockBlend, a.slope, b.slope, a.height, b.height]) {
    if (!Number.isFinite(value)) throw new Error('G17 Rock/Snow guard band produced a non-finite sample');
  }
  maxRockDelta = Math.max(maxRockDelta, Math.abs(a.rockBlend - b.rockBlend));
  maxSlopeDelta = Math.max(maxSlopeDelta, Math.abs(a.slope - b.slope));
  if (a.snowWeight !== 0 || b.snowWeight !== 0) throw new Error('G17 Rock/Snow guard band invented snow');
  comparedPairs += 1;
}

for (let i = 0; i < samplesPerEdge; i += 1) {
  const t = i / (samplesPerEdge - 1);
  const x = bounds.xMin + (bounds.xMax - bounds.xMin) * t;
  const y = bounds.yMin + (bounds.yMax - bounds.yMin) * t;
  compare(x, bounds.yMin, x, bounds.yMin - guard);
  compare(x, bounds.yMax, x, bounds.yMax + guard);
  compare(bounds.xMin, y, bounds.xMin - guard, y);
  compare(bounds.xMax, y, bounds.xMax + guard, y);
}

if (comparedPairs !== samplesPerEdge * 4) throw new Error(`unexpected G17 Rock/Snow guard pair count ${comparedPairs}`);
if (maxRockDelta > 0.01) throw new Error(`G17 Rock/Snow dense guard seam too large: ${maxRockDelta}`);
if (maxSlopeDelta > 0.00005) throw new Error(`G17 Rock/Snow relief-slope guard seam too large: ${maxSlopeDelta}`);

const metrics = {
  policyId: G17_ROCK_SNOW_POLICY.id,
  samplesPerEdge,
  comparedPairs,
  maxRockDelta: Number(maxRockDelta.toFixed(10)),
  maxSlopeDelta: Number(maxSlopeDelta.toFixed(10)),
};
console.log(`SW_G17_ROCK_SNOW_GUARD_METRICS=${JSON.stringify(metrics)}`);
console.log('SW_G17_ROCK_SNOW_GUARD_OK');
