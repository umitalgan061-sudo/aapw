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

export function evaluatePhotorealismRuntimeSafety(
  observation: CanonicalEnvironmentObservation,
): RuntimeSafetyDecision {
  if (malformedObservation(observation)) {
    return Object.freeze({ safeToApply: false, reason: 'malformed-observation' });
  }
  const numericInputs = [
    observation.shorelineGradient,
    observation.waterNormalRepeat,
    observation.skyLuminance,
    observation.renderedHeightMeters,
    observation.colliderHeightMeters,
  ];
  if (numericInputs.some(value => !finite(value))) {
    return Object.freeze({ safeToApply: false, reason: 'malformed-observation' });
  }
  if (
    !boundedUnit(observation.shorelineGradient) ||
    !boundedUnit(observation.waterNormalRepeat) ||
    !boundedUnit(observation.skyLuminance)
  ) {
    return Object.freeze({ safeToApply: false, reason: 'malformed-observation' });
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
    return Object.freeze({ safeToApply: false, reason: 'malformed-observation' });
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
  if (Object.values(failureSet).some(Boolean)) {
    return Object.freeze({ safeToApply: false, reason: 'visible-p0-p5-failure' });
  }
  const parityError = Math.abs(observation.renderedHeightMeters - observation.colliderHeightMeters);
  if (parityError > 0.35) {
    return Object.freeze({ safeToApply: false, reason: 'terrain-collider-parity-out-of-bounds' });
  }
  return Object.freeze({ safeToApply: true, reason: null });
}
