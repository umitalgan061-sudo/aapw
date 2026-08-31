#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  REFERENCE_RELIEF_CHAINS,
  WORLD_REFERENCE_MAP,
} from '../src/3d/world/worldReferenceMap.js';
import {
  WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY,
  sampleNormalizedReferenceMountainReliefMeters,
  sampleReferenceDryLandWeight,
} from '../src/3d/world/worldReferenceMountainRelief.js';

const TARGET_CHAINS = new Set(['bone-mountains', 'eastern-chain']);
const MAP_ASPECT = WORLD_REFERENCE_MAP.pixelWidth / WORLD_REFERENCE_MAP.pixelHeight;
const evidence = {};

function percentile(sorted, fraction) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index];
}

for (const chain of REFERENCE_RELIEF_CHAINS.filter(({ id }) => TARGET_CHAINS.has(id))) {
  const profile = WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.chains[chain.id];
  assert(profile, `${chain.id}: profile missing`);

  const shoulderSamples = [];
  const centerSamples = [];
  let bilateralSections = 0;

  for (let segment = 0; segment < chain.points.length - 1; segment += 1) {
    const a = chain.points[segment];
    const b = chain.points[segment + 1];
    const dx = (b[0] - a[0]) * MAP_ASPECT;
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) continue;
    const normalX = -dy / length;
    const normalY = dx / length;

    for (let step = 8; step <= 72; step += 8) {
      const t = step / 80;
      const centerX = a[0] + (b[0] - a[0]) * t;
      const centerY = a[1] + (b[1] - a[1]) * t;
      if (sampleReferenceDryLandWeight(centerX, centerY) < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;

      const centerMeters = sampleNormalizedReferenceMountainReliefMeters(centerX, centerY);
      if (!(centerMeters > 0)) continue;
      centerSamples.push(centerMeters);

      const offset = profile.outerWidthNormalized * 0.30;
      const offsetX = normalX * offset / MAP_ASPECT;
      const offsetY = normalY * offset;
      const sides = [
        [centerX + offsetX, centerY + offsetY],
        [centerX - offsetX, centerY - offsetY],
      ];

      const sectionHeights = [];
      for (const [x, y] of sides) {
        if (x < 0 || x > 1 || y < 0 || y > 1) continue;
        if (sampleReferenceDryLandWeight(x, y) < WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.landGateFull) continue;
        const meters = sampleNormalizedReferenceMountainReliefMeters(x, y);
        if (meters > 0) {
          shoulderSamples.push(meters);
          sectionHeights.push(meters);
        }
      }
      if (sectionHeights.length === 2) bilateralSections += 1;
    }
  }

  assert(centerSamples.length >= 8, `${chain.id}: insufficient interior centerline evidence`);
  assert(shoulderSamples.length >= 8, `${chain.id}: broad shoulders disappear from interior cross-sections`);
  assert(bilateralSections >= 3, `${chain.id}: relief does not read as a two-sided mountain range`);

  const sortedShoulders = [...shoulderSamples].sort((a, b) => a - b);
  const shoulderMedian = percentile(sortedShoulders, 0.50);
  const shoulderP20 = percentile(sortedShoulders, 0.20);
  assert(shoulderMedian >= profile.peakMeters * 0.12,
    `${chain.id}: median 30%-width shoulder is too weak (${shoulderMedian.toFixed(1)}m)`);
  assert(shoulderP20 >= profile.peakMeters * 0.045,
    `${chain.id}: lower shoulder body is too sparse (${shoulderP20.toFixed(1)}m)`);

  evidence[chain.id] = {
    centerSamples: centerSamples.length,
    shoulderSamples: shoulderSamples.length,
    bilateralSections,
    shoulderMedianMeters: Number(shoulderMedian.toFixed(2)),
    shoulderP20Meters: Number(shoulderP20.toFixed(2)),
    peakMeters: profile.peakMeters,
    outerWidthNormalized: profile.outerWidthNormalized,
  };
}

assert.deepEqual(Object.keys(evidence).sort(), [...TARGET_CHAINS].sort());
console.log('EASTERN_MOUNTAIN_CROSS_SECTION_READABILITY_OK', JSON.stringify({
  policyId: WORLD_REFERENCE_MOUNTAIN_RELIEF_POLICY.id,
  evidence,
}));
