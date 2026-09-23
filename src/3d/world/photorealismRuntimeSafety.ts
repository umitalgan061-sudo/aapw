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

export function evaluatePhotorealismRuntimeSafety(
  observation: CanonicalEnvironmentObservation,
): RuntimeSafetyDecision {
  const numericInputs = [
    observation.waterNormalRepeat,
    observation.skyLuminance,
    observation.renderedHeightMeters,
    observation.colliderHeightMeters,
  ];
  if (numericInputs.some(value => !finite(value))) {
    return Object.freeze({ safeToApply: false, reason: 'malformed-observation' });
  }
  if (!boundedUnit(observation.waterNormalRepeat) || !boundedUnit(observation.skyLuminance)) {
    return Object.freeze({ safeToApply: false, reason: 'malformed-observation' });
  }
  if (!boolean(observation.visibleRectangularWater) || !boolean(observation.visibleGridSeam)) {
    return Object.freeze({ safeToApply: false, reason: 'malformed-observation' });
  }
  const failureSet = {
    rectangularWater: observation.visibleRectangularWater,
    gridSeam: observation.visibleGridSeam,
    waterMoire: observation.waterNormalRepeat > 0.72,
    blackSky: observation.skyLuminance < 0.2,
  };
  if (failureSet.rectangularWater || failureSet.gridSeam || failureSet.waterMoire || failureSet.blackSky) {
    return Object.freeze({ safeToApply: false, reason: 'visible-p0-p5-failure' });
  }
  const parityError = Math.abs(observation.renderedHeightMeters - observation.colliderHeightMeters);
  if (parityError > 0.35) {
    return Object.freeze({ safeToApply: false, reason: 'terrain-collider-parity-out-of-bounds' });
  }
  return Object.freeze({ safeToApply: true, reason: null });
}
