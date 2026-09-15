/**
 * Safe runtime entrypoint for scene observations.
 *
 * The v51 adapter rounds distances after applying defaults. A missing
 * optional distance must therefore become a finite far-away sentinel before
 * crossing that boundary; otherwise an absent distance can collapse to 0.
 */

import { createWorldCoverageRuntimeSnapshotV51 } from './worldCoverageRuntimeAdapterV51.js';

const FAR_DISTANCE = 1_000_000_000;
const DISTANCE_KEYS = Object.freeze(['waterDistance', 'roadDistance', 'settlementDistance']);

const safeDistance = (value) => {
  if (value == null || !Number.isFinite(value)) return FAR_DISTANCE;
  return Math.max(0, value);
};

const normalizeObservation = (source = {}) => ({
  ...source,
  ...Object.fromEntries(DISTANCE_KEYS.map(key => [key, safeDistance(source[key])])),
});

export function createWorldCoverageRuntimeSafeSnapshotV51(input = {}) {
  const observations = Array.isArray(input.observations)
    ? input.observations
    : Array.isArray(input.samples)
      ? input.samples
      : [];
  return createWorldCoverageRuntimeSnapshotV51({
    ...input,
    observations: observations.map(normalizeObservation),
  });
}

export const WORLD_COVERAGE_RUNTIME_SAFETY_V51 = Object.freeze({
  version: 'v51-runtime-safety',
  farDistanceSentinel: FAR_DISTANCE,
  normalizedDistanceKeys: DISTANCE_KEYS,
});
