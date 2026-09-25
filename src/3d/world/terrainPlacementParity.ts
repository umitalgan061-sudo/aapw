/**
 * Shared terrain/collider parity contract for environment placement consumers.
 *
 * This module is intentionally observation-only: it does not own scene mutation,
 * materials, asset loading or placement. WorldAssetPlacementPipeline remains the
 * sole placement authority. Consumers can use this contract before attaching an
 * asset to prove that sampled rendered terrain and collider heights agree at the
 * same world coordinates and that a footprint does not span an unsafe grade.
 */

export type TerrainParitySample = Readonly<{
  x: number;
  z: number;
  renderedHeight: number;
  colliderHeight: number;
}>;

export type TerrainParityPolicy = Readonly<{
  maxHeightDeltaMeters?: number;
  maxFootprintRangeMeters?: number;
  requireFinite?: boolean;
}>;

export type TerrainParityResult = Readonly<{
  ok: boolean;
  maxHeightDeltaMeters: number;
  maxFootprintRangeMeters: number;
  sampleCount: number;
  failures: readonly string[];
}>;

const DEFAULT_POLICY: Required<TerrainParityPolicy> = Object.freeze({
  maxHeightDeltaMeters: 0.35,
  maxFootprintRangeMeters: 1.25,
  requireFinite: true,
});

const FAILURE_ORDER = Object.freeze([
  'invalid-sample',
  'invalid-coordinate',
  'non-finite-sample',
  'missing-samples',
  'terrain-collider-parity',
  'unsafe-footprint-grade',
]);

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePolicy(policy: TerrainParityPolicy = {}): Required<TerrainParityPolicy> {
  const maxHeightDeltaMeters = Number(policy.maxHeightDeltaMeters ?? DEFAULT_POLICY.maxHeightDeltaMeters);
  const maxFootprintRangeMeters = Number(policy.maxFootprintRangeMeters ?? DEFAULT_POLICY.maxFootprintRangeMeters);
  const requireFinite = policy.requireFinite !== false;

  if (!finite(maxHeightDeltaMeters) || maxHeightDeltaMeters < 0) {
    throw new TypeError('maxHeightDeltaMeters must be a finite non-negative number');
  }
  if (!finite(maxFootprintRangeMeters) || maxFootprintRangeMeters < 0) {
    throw new TypeError('maxFootprintRangeMeters must be a finite non-negative number');
  }

  return Object.freeze({ maxHeightDeltaMeters, maxFootprintRangeMeters, requireFinite });
}

function orderFailures(failures: readonly string[]): readonly string[] {
  const present = new Set(failures);
  return Object.freeze(FAILURE_ORDER.filter((failure) => present.has(failure)));
}

export function evaluateTerrainPlacementParity(
  samples: readonly TerrainParitySample[],
  policy: TerrainParityPolicy = {},
): TerrainParityResult {
  const normalizedPolicy = normalizePolicy(policy);
  const failures: string[] = [];
  let maxHeightDeltaMeters = 0;
  let minFootprintHeight = Infinity;
  let maxFootprintHeight = -Infinity;

  if (!Array.isArray(samples) || samples.length === 0) {
    failures.push('missing-samples');
  }

  for (const sample of Array.isArray(samples) ? samples : []) {
    if (!sample || typeof sample !== 'object') {
      failures.push('invalid-sample');
      continue;
    }

    const coordinates = [sample.x, sample.z];
    if (coordinates.some((value) => !finite(value))) {
      failures.push('invalid-coordinate');
      continue;
    }

    const heights = [sample.renderedHeight, sample.colliderHeight];
    if (normalizedPolicy.requireFinite && heights.some((value) => !finite(value))) {
      failures.push('non-finite-sample');
      continue;
    }

    const renderedHeight = Number(sample.renderedHeight);
    const colliderHeight = Number(sample.colliderHeight);
    const heightDelta = Math.abs(renderedHeight - colliderHeight);
    if (!Number.isFinite(heightDelta)) {
      failures.push('non-finite-sample');
      continue;
    }

    maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, heightDelta);
    // Grade safety must cover both surfaces. A collider-only ramp can still
    // interpenetrate or float even when the rendered samples look flat.
    minFootprintHeight = Math.min(minFootprintHeight, renderedHeight, colliderHeight);
    maxFootprintHeight = Math.max(maxFootprintHeight, renderedHeight, colliderHeight);
  }

  const maxFootprintRangeMeters = Number.isFinite(minFootprintHeight)
    ? maxFootprintHeight - minFootprintHeight
    : 0;

  if (maxHeightDeltaMeters > normalizedPolicy.maxHeightDeltaMeters) {
    failures.push('terrain-collider-parity');
  }
  if (maxFootprintRangeMeters > normalizedPolicy.maxFootprintRangeMeters) {
    failures.push('unsafe-footprint-grade');
  }

  const orderedFailures = orderFailures(failures);
  return Object.freeze({
    ok: orderedFailures.length === 0,
    maxHeightDeltaMeters,
    maxFootprintRangeMeters,
    sampleCount: Array.isArray(samples) ? samples.length : 0,
    failures: orderedFailures,
  });
}

export function assertTerrainPlacementParity(
  samples: readonly TerrainParitySample[],
  policy: TerrainParityPolicy = {},
): TerrainParityResult {
  const result = evaluateTerrainPlacementParity(samples, policy);
  if (!result.ok) {
    throw new Error(`Terrain placement parity rejected: ${result.failures.join(',')}`);
  }
  return result;
}

export const TERRAIN_PLACEMENT_PARITY_DEFAULTS = DEFAULT_POLICY;
