/**
 * Buzul Muhafızı — live scene integration boundary for photorealism.
 *
 * This adapter is intentionally renderer-agnostic: it maps existing createScene
 * targets to the deterministic controller and never becomes a terrain/material/
 * placement authority. Callers provide the already-created runtime targets.
 */
import type {
  CanonicalEnvironmentObservation,
  EnvironmentPassPlan,
} from './photorealismEnvironmentPass.ts';
import {
  createPhotorealismRuntimeController,
  type RuntimeControllerReceipt,
  type RuntimeControllerOptions,
  type RuntimeTarget,
} from './photorealismRuntimeController.ts';
import {
  createPhotorealismSceneTargets,
  type PhotorealismSceneTargetCallbacks,
} from './photorealismSceneTargetFactory.ts';
import {
  createSharedMaterialAssignmentRequestFromSample,
  type SharedMaterialAssignmentRequest,
} from './photorealismMaterialAssignmentAdapter.ts';
import type { EnvironmentSample } from './photorealismDirector.ts';

export interface PhotorealismSceneIntegration {
  readonly controller: ReturnType<typeof createPhotorealismRuntimeController>;
  readonly evaluate: (observation: CanonicalEnvironmentObservation) => EnvironmentPassPlan;
  readonly apply: (
    observation: CanonicalEnvironmentObservation,
    targets: readonly RuntimeTarget[],
  ) => RuntimeControllerReceipt;
  readonly createTargets: (callbacks: PhotorealismSceneTargetCallbacks) => readonly RuntimeTarget[];
  readonly materialRequest: (
    assetId: string,
    seed: number,
    sample: EnvironmentSample,
    targetMeshIndex?: number,
  ) => SharedMaterialAssignmentRequest;
}

export function createPhotorealismSceneIntegration(
  options: RuntimeControllerOptions,
): PhotorealismSceneIntegration {
  const controller = createPhotorealismRuntimeController(options);
  return Object.freeze({
    controller,
    evaluate: (observation) => controller.plan(observation),
    apply: (observation, targets) => controller.applyObservation(observation, targets),
    createTargets: (callbacks) => createPhotorealismSceneTargets(callbacks),
    materialRequest: (assetId, seed, sample, targetMeshIndex = 0) =>
      createSharedMaterialAssignmentRequestFromSample(assetId, seed, sample, targetMeshIndex),
  });
}

export function applyPhotorealismToSceneTargets(
  integration: PhotorealismSceneIntegration,
  observation: CanonicalEnvironmentObservation,
  targets: readonly RuntimeTarget[],
): RuntimeControllerReceipt {
  return integration.apply(observation, targets);
}
