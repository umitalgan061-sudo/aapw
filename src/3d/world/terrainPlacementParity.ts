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

export function evaluateTerrainPlacementParity(
  samples: readonly TerrainParitySample[],
  policy: TerrainParityPolicy = {},
): TerrainParityResult {
  const normalizedPolicy = normalizePolicy(policy);
  const failures: string[] = [];
  let maxHeightDeltaMeters = 0;
  let minRenderedHeight = Infinity;
  let maxRenderedHeight = -Infinity;

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

    const heightDelta = Math.abs(Number(sample.renderedHeight) - Number(sample.colliderHeight));
    if (!Number.isFinite(heightDelta)) {
      failures.push('non-finite-sample');
      continue;
    }

    maxHeightDeltaMeters = Math.max(maxHeightDeltaMeters, heightDelta);
    minRenderedHeight = Math.min(minRenderedHeight, Number(sample.renderedHeight));
    maxRenderedHeight = Math.max(maxRenderedHeight, Number(sample.renderedHeight));
  }

  const maxFootprintRangeMeters = Number.isFinite(minRenderedHeight)
    ? maxRenderedHeight - minRenderedHeight
    : 0;

  if (maxHeightDeltaMeters > normalizedPolicy.maxHeightDeltaMeters) {
    failures.push('terrain-collider-parity');
  }
  if (maxFootprintRangeMeters > normalizedPolicy.maxFootprintRangeMeters) {
    failures.push('unsafe-footprint-grade');
  }

  return Object.freeze({
    ok: failures.length === 0,
    maxHeightDeltaMeters,
    maxFootprintRangeMeters,
    sampleCount: Array.isArray(samples) ? samples.length : 0,
    failures: Object.freeze([...new Set(failures)]),
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
