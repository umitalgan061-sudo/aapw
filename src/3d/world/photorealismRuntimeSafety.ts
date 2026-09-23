/**
 * Buzul Muhafızı — runtime safety boundary for live photorealism application.
 *
 * Keeps P0/P5 guard decisions explicit at the last mutation boundary. This is
 * deliberately a small predicate layer: it does not create terrain, assets,
 * materials, water meshes, or placement state.
 */
import type { CanonicalEnvironmentObservation } from './photorealismEnvironmentPass.ts';

export interface RuntimeSafetyDecision {
  readonly safeToApply: boolean;
  readonly reason: string | null;
  readonly failedChecks: readonly string[];
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function boundedUnit(value: number): boolean {
  return value >= 0 && value <= 1;
}

function malformedObservation(observation: unknown): boolean {
  return observation === null || typeof observation !== 'object';
}

function decision(
  safeToApply: boolean,
  reason: string | null,
  failedChecks: readonly string[] = [],
): RuntimeSafetyDecision {
  return Object.freeze({
    safeToApply,
    reason,
    failedChecks: Object.freeze([...failedChecks]),
  });
}

export function evaluatePhotorealismRuntimeSafety(
  observation: CanonicalEnvironmentObservation,
): RuntimeSafetyDecision {
  if (malformedObservation(observation)) {
    return decision(false, 'malformed-observation', ['observation-shape']);
  }
  const numericInputs = [
    observation.shorelineGradient,
    observation.waterNormalRepeat,
    observation.skyLuminance,
    observation.renderedHeightMeters,
    observation.colliderHeightMeters,
  ];
  if (numericInputs.some(value => !finite(value))) {
    return decision(false, 'malformed-observation', ['numeric-finiteness']);
  }
  if (
    !boundedUnit(observation.shorelineGradient) ||
    !boundedUnit(observation.waterNormalRepeat) ||
    !boundedUnit(observation.skyLuminance)
  ) {
    return decision(false, 'malformed-observation', ['normalized-range']);
  }
  const visibilityFlags = [
    observation.visibleGridSeam,
    observation.visibleRectangularWater,
    observation.visibleSmoothWall,
    observation.visibleFlatGround,
    observation.visibleSnowSheet,
    observation.visibleSparseCanopy,
    observation.visibleRoadRibbon,
    observation.visibleFloatingAsset,
    observation.visibleMaterialMismatch,
  ];
  if (visibilityFlags.some(value => !boolean(value))) {
    return decision(false, 'malformed-observation', ['visibility-flag-shape']);
  }
  const failureSet = {
    rectangularWater: observation.visibleRectangularWater,
    gridSeam: observation.visibleGridSeam,
    shorelineStep: observation.shorelineGradient < 0.18,
    waterMoire: observation.waterNormalRepeat > 0.72,
    blackSky: observation.skyLuminance < 0.2,
    smoothWall: observation.visibleSmoothWall,
    flatGround: observation.visibleFlatGround,
    snowSheet: observation.visibleSnowSheet,
    sparseCanopy: observation.visibleSparseCanopy,
    roadRibbon: observation.visibleRoadRibbon,
    floatingAsset: observation.visibleFloatingAsset,
    materialMismatch: observation.visibleMaterialMismatch,
  };
  const failedChecks = Object.entries(failureSet)
    .filter(([, failed]) => failed)
    .map(([name]) => name);
  if (failedChecks.length > 0) {
    return decision(false, 'visible-p0-p5-failure', failedChecks);
  }
  const parityError = Math.abs(observation.renderedHeightMeters - observation.colliderHeightMeters);
  if (parityError > 0.35) {
    return decision(false, 'terrain-collider-parity-out-of-bounds', ['terrain-collider-parity']);
  }
  return decision(true, null);
}
