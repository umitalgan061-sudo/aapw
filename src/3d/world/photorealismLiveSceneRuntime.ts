/**
 * Buzul Muhafızı — live Three.js scene runtime adapter.
 *
 * This module is the concrete bridge between the deterministic photorealism
 * controller and the already-created scene owners. It never creates terrain,
 * materials, water meshes, or placement assets. It only mutates the existing
 * renderer/fog/light/material/water/vegetation owner surfaces through a
 * bounded, idempotent receipt.
 */
import type { CanonicalEnvironmentObservation } from './photorealismEnvironmentPass.ts';
import {
  createPhotorealismSceneIntegration,
  type PhotorealismSceneIntegration,
} from './photorealismSceneIntegration.ts';
import type { RuntimeOperation, RuntimeTarget } from './photorealismRuntimeController.ts';
import { evaluatePhotorealismRuntimeSafety } from './photorealismRuntimeSafety.ts';

export interface LiveSceneRendererLike {
  toneMappingExposure?: number;
  outputColorSpace?: unknown;
  userData?: Record<string, unknown>;
}

export interface LiveSceneFogLike {
  density?: number;
  userData?: Record<string, unknown>;
}

export interface LiveSceneLightLike {
  intensity?: number;
}

export interface LiveSceneMaterialLike {
  userData?: Record<string, unknown>;
}

export interface LiveSceneWaterLike {
  userData?: Record<string, unknown>;
}

export interface LiveSceneVegetationLike {
  userData?: Record<string, unknown>;
}

export interface LiveSceneRuntimeOwners {
  readonly renderer: LiveSceneRendererLike;
  readonly fog?: LiveSceneFogLike;
  readonly sun?: LiveSceneLightLike;
  readonly moon?: LiveSceneLightLike;
  readonly material?: LiveSceneMaterialLike;
  readonly water?: LiveSceneWaterLike;
  readonly vegetation?: LiveSceneVegetationLike;
  readonly placement?: { userData?: Record<string, unknown> };
}

export interface LiveSceneRuntimeReceipt {
  readonly accepted: boolean;
  readonly appliedOperations: number;
  readonly rejectedReason: string | null;
  readonly controllerReceipt: ReturnType<PhotorealismSceneIntegration['controller']['applyObservation']>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ensureUserData(owner: { userData?: Record<string, unknown> }): Record<string, unknown> {
  // Some live Three.js owners can expose an unexpected primitive/null userData
  // after external tooling or serializer hydration. Replace that malformed
  // container before writing the bounded photorealism receipt instead of
  // throwing from a strict-mode property assignment.
  if (!isRecord(owner.userData)) owner.userData = {};
  return owner.userData;
}

function applyOperation(owners: LiveSceneRuntimeOwners, operation: RuntimeOperation, value: number | boolean | Readonly<Record<string, unknown>>): void {
  if (operation === 'set-exposure' && typeof value === 'number') {
    owners.renderer.toneMappingExposure = value;
    return;
  }
  if (operation === 'set-fog-density' && typeof value === 'number' && owners.fog) {
    owners.fog.density = value;
    return;
  }
  if (operation === 'set-aerial-perspective' && typeof value === 'number' && owners.fog) {
    ensureUserData(owners.fog).photorealismAerialPerspective = value;
    return;
  }
  if (operation === 'set-light-energy' && typeof value === 'number') return;
  if (operation === 'set-sky-luminance' && typeof value === 'number') {
    ensureUserData(owners.renderer).photorealismSkyLuminance = value;
    return;
  }
  if (operation === 'apply-material-recipe' && owners.material && typeof value === 'object') {
    ensureUserData(owners.material).photorealismMaterialRecipe = value;
    return;
  }
  if (operation === 'apply-water-policy' && owners.water && typeof value === 'object') {
    ensureUserData(owners.water).photorealismWaterPolicy = value;
    return;
  }
  if (operation === 'apply-vegetation-budget' && owners.vegetation && typeof value === 'object') {
    ensureUserData(owners.vegetation).photorealismVegetationBudget = value;
    return;
  }
  if (operation === 'apply-placement-query' && owners.placement && typeof value === 'object') {
    ensureUserData(owners.placement).photorealismPlacementQuery = value;
    return;
  }
  if (operation === 'apply-performance-budget' && typeof value === 'object') {
    ensureUserData(owners.renderer).photorealismPerformanceBudget = value;
  }
}

function target(id: string, kind: RuntimeTarget['kind'], apply: RuntimeTarget['apply']): RuntimeTarget {
  return Object.freeze({ id, kind, apply });
}

export function createLiveSceneRuntimeOwners(owners: LiveSceneRuntimeOwners, integration: PhotorealismSceneIntegration): readonly RuntimeTarget[] {
  const targets: RuntimeTarget[] = [target('live:renderer', 'renderer', (operation, value) => applyOperation(owners, operation, value))];
  if (owners.fog) targets.push(target('live:fog', 'fog', (operation, value) => applyOperation(owners, operation, value)));
  if (owners.sun) targets.push(target('live:sun', 'sun', (operation, value) => {
    if (operation === 'set-light-energy' && typeof value === 'number') owners.sun!.intensity = value;
  }));
  if (owners.moon) targets.push(target('live:moon', 'moon', (operation, value) => {
    if (operation === 'set-light-energy' && typeof value === 'number') owners.moon!.intensity = value;
  }));
  if (owners.material) targets.push(target('live:material', 'material', (operation, value) => applyOperation(owners, operation, value)));
  if (owners.water) targets.push(target('live:water', 'water', (operation, value) => applyOperation(owners, operation, value)));
  if (owners.vegetation) targets.push(target('live:vegetation', 'vegetation', (operation, value) => applyOperation(owners, operation, value)));
  if (owners.placement) targets.push(target('live:placement', 'placement', (operation, value) => applyOperation(owners, operation, value)));
  return integration.createTargets(targets.reduce((callbacks, runtimeTarget) => {
    callbacks[runtimeTarget.kind] = runtimeTarget.apply;
    return callbacks;
  }, {} as Record<string, RuntimeTarget['apply']>));
}

export function applyLivePhotorealismFrame(
  integration: PhotorealismSceneIntegration,
  owners: LiveSceneRuntimeOwners,
  observation: CanonicalEnvironmentObservation,
): LiveSceneRuntimeReceipt {
  const safety = evaluatePhotorealismRuntimeSafety(observation);
  if (!safety.safeToApply) {
    const controllerReceipt = integration.controller.applyObservation(observation, []);
    return Object.freeze({
      accepted: false,
      appliedOperations: 0,
      rejectedReason: safety.reason,
      controllerReceipt,
    });
  }
  const targets = createLiveSceneRuntimeOwners(owners, integration);
  const controllerReceipt = integration.apply(observation, targets);
  return Object.freeze({
    accepted: controllerReceipt.accepted,
    appliedOperations: controllerReceipt.accepted ? controllerReceipt.operationCount : 0,
    rejectedReason: controllerReceipt.rejectedReason,
    controllerReceipt,
  });
}
