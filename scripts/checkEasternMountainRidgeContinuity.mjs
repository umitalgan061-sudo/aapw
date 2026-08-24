#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  REFERENCE_RELIEF_CHAINS,
} from '../src/3d/world/worldReferenceMap.js';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  sampleNormalizedReferenceMountainReliefMeters,
  sampleReferenceDryLandWeight,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const TARGET_CHAINS = new Set(['bone-mountains', 'eastern-chain']);
const evidence = {};

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

for (const chain of REFERENCE_RELIEF_CHAINS.filter(({ id }) => TARGET_CHAINS.has(id))) {
  const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
  assert(profile, `${chain.id}: runtime profile missing`);
  assert(profile.summitFloor >= 0.25,
    `${chain.id}: summit floor ${profile.summitFloor} can collapse a long mapped ridge into isolated plugs`);
  assert(profile.summitNoiseExponent <= 1.6,
    `${chain.id}: summit exponent ${profile.summitNoiseExponent} over-concentrates height into local spikes`);

  const heights = [];
  const samples = [];
  for (let segment = 0; segment < chain.points.length - 1; segment += 1) {
    const a = chain.points[segment];
    const b = chain.points[segment + 1];
    for (let step = segment === 0 ? 0 : 1; step <= 80; step += 1) {
      const t = step / 80;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      const dry = sampleReferenceDryLandWeight(x, y);
      const meters = sampleNormalizedReferenceMountainReliefMeters(x, y);
      if (dry < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;
      assert(Number.isFinite(meters) && meters > 0, `${chain.id}: dry centerline relief vanished at ${x},${y}`);
      heights.push(meters);
      samples.push({ x, y, meters });
    }
  }

  assert(heights.length >= 60, `${chain.id}: too few source-owned dry centerline samples for ridge continuity`);
  const sorted = [...heights].sort((a, b) => a - b);
  const p10 = percentile(sorted, 0.10);
  const median = percentile(sorted, 0.50);
  const p90 = percentile(sorted, 0.90);
  const maximum = sorted.at(-1);
  const minimum = sorted[0];

  assert(p10 >= profile.peakMeters * 0.10,
    `${chain.id}: lower ridge body collapsed below 10% of peak envelope (${p10.toFixed(1)}m)`);
  assert(median >= profile.peakMeters * 0.16,
    `${chain.id}: median ridge body is too weak (${median.toFixed(1)}m)`);
  assert(p90 / Math.max(p10, 1) <= 4.5,
    `${chain.id}: p90/p10 ${ (p90 / Math.max(p10, 1)).toFixed(2) } reads as isolated summit spikes`);
  assert(maximum / Math.max(median, 1) <= 3.8,
    `${chain.id}: max/median ${ (maximum / Math.max(median, 1)).toFixed(2) } is too column-like`);

  let largestNeighbourJump = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (distance > 0.01) continue;
    const ratio = Math.max(previous.meters, current.meters) / Math.max(1, Math.min(previous.meters, current.meters));
    largestNeighbourJump = Math.max(largestNeighbourJump, ratio);
  }
  assert(largestNeighbourJump <= 1.55,
    `${chain.id}: adjacent ridge samples jump ${largestNeighbourJump.toFixed(2)}x, indicating a needle-like local discontinuity`);

  evidence[chain.id] = {
    dryCenterlineSamples: heights.length,
    minimumMeters: Number(minimum.toFixed(2)),
    p10Meters: Number(p10.toFixed(2)),
    medianMeters: Number(median.toFixed(2)),
    p90Meters: Number(p90.toFixed(2)),
    maximumMeters: Number(maximum.toFixed(2)),
    p90ToP10: Number((p90 / Math.max(p10, 1)).toFixed(3)),
    maxToMedian: Number((maximum / Math.max(median, 1)).toFixed(3)),
    largestNeighbourJump: Number(largestNeighbourJump.toFixed(3)),
    summitFloor: profile.summitFloor,
    summitNoiseExponent: profile.summitNoiseExponent,
  };
}

assert.deepEqual(Object.keys(evidence).sort(), [...TARGET_CHAINS].sort(), 'both long eastern mountain chains must be audited');
console.log('EASTERN_MOUNTAIN_RIDGE_CONTINUITY_OK', JSON.stringify({
  policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
  evidence,
}));
