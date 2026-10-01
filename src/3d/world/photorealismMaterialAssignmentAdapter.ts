/**
 * Buzul Muhafızı — shared material contract adapter.
 *
 * This module is deliberately a request builder, not a second material engine.
 * MaterialAssignmentCore.js remains the only owner allowed to inspect meshes,
 * choose palettes, validate slots, mutate materials, and create manifests.
 */
import type {
  EnvironmentSample,
  PhotorealismFrame,
} from './photorealismDirector.ts';
import {
  buildPhotorealismFrame,
  frameToMaterialRecipe,
  validatePhotorealismFrame,
} from './photorealismDirector.ts';

export type MaterialSurfaceIntent =
  | 'deep-water'
  | 'shallow-water'
  | 'wet-edge'
  | 'grass'
  | 'soil'
  | 'mud'
  | 'rock'
  | 'scree'
  | 'snow'
  | 'road';

export interface SharedMaterialAssignmentRequest {
  readonly schemaVersion: 1;
  readonly assetId: string;
  readonly targetMeshIndex: number;
  readonly surfaceIntents: readonly MaterialSurfaceIntent[];
  readonly recipe: Readonly<{
    recipeVersion: 1;
    baseColor: readonly [number, number, number];
    roughness: number;
    metalness: number;
    normalStrength: number;
    ao: number;
    clearcoat: number;
    transmission: number;
    antiTiling: Readonly<PhotorealismFrame['antiTiling']>;
  }>;
  readonly validation: Readonly<{
    ok: boolean;
    errors: readonly string[];
  }>;
  readonly provenance: Readonly<{
    sourceAuthority: 'canonical-world-terrain';
    materialAuthority: 'MaterialAssignmentCore.js';
    placementAuthority: 'WorldAssetPlacementPipeline.js';
    deterministicKey: string;
  }>;
}

const SURFACES: readonly MaterialSurfaceIntent[] = [
  'deep-water',
  'shallow-water',
  'wet-edge',
  'grass',
  'soil',
  'mud',
  'rock',
  'scree',
  'snow',
  'road',
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeAssetId(assetId: string): string {
  const normalized = String(assetId || '').trim();
  if (!normalized) throw new Error('assetId must be non-empty');
  return normalized.slice(0, 160);
}

function sortSurfaceIntents(frame: PhotorealismFrame): readonly MaterialSurfaceIntent[] {
  return Object.freeze(
    SURFACES.filter((surface) => clamp01(frame.weights[surface]) >= 0.035),
  );
}

function cloneRecipe(frame: PhotorealismFrame): SharedMaterialAssignmentRequest['recipe'] {
  const source = frameToMaterialRecipe(frame);
  return Object.freeze({
    recipeVersion: 1,
    baseColor: Object.freeze([
      clamp01(source.baseColor[0]),
      clamp01(source.baseColor[1]),
      clamp01(source.baseColor[2]),
    ] as [number, number, number]),
    roughness: clamp01(source.roughness),
    metalness: clamp01(source.metalness),
    normalStrength: Math.max(0, Math.min(1.35, Number(source.normalStrength) || 0)),
    ao: clamp01(source.ao),
    clearcoat: clamp01(source.clearcoat),
    transmission: clamp01(source.transmission),
    antiTiling: Object.freeze({
      macroMeters: Math.max(1, Number(source.antiTiling.macroMeters) || 1),
      microMeters: Math.max(0.25, Number(source.antiTiling.microMeters) || 0.25),
      triplanarBlend: clamp01(source.antiTiling.triplanarBlend),
      phaseX: Number(source.antiTiling.phaseX) || 0,
      phaseZ: Number(source.antiTiling.phaseZ) || 0,
    }),
  });
}

export function createSharedMaterialAssignmentRequest(
  assetId: string,
  frame: PhotorealismFrame,
  targetMeshIndex = 0,
): SharedMaterialAssignmentRequest {
  const normalizedAssetId = normalizeAssetId(assetId);
  const errors = validatePhotorealismFrame(frame);
  const safeMeshIndex = Number.isInteger(targetMeshIndex) && targetMeshIndex >= 0
    ? targetMeshIndex
    : 0;

  return Object.freeze({
    schemaVersion: 1,
    assetId: normalizedAssetId,
    targetMeshIndex: safeMeshIndex,
    surfaceIntents: sortSurfaceIntents(frame),
    recipe: cloneRecipe(frame),
    validation: Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze([...errors]),
    }),
    provenance: Object.freeze({
      sourceAuthority: 'canonical-world-terrain',
      materialAuthority: 'MaterialAssignmentCore.js',
      placementAuthority: 'WorldAssetPlacementPipeline.js',
      deterministicKey: frame.manifest.deterministicKey,
    }),
  });
}

export function createSharedMaterialAssignmentRequestFromSample(
  assetId: string,
  seed: number,
  sample: EnvironmentSample,
  targetMeshIndex = 0,
): SharedMaterialAssignmentRequest {
  return createSharedMaterialAssignmentRequest(
    assetId,
    buildPhotorealismFrame(seed, sample),
    targetMeshIndex,
  );
}

export function canApplySharedMaterialAssignmentRequest(
  request: SharedMaterialAssignmentRequest,
): boolean {
  return request.validation.ok
    && request.provenance.materialAuthority === 'MaterialAssignmentCore.js'
    && request.surfaceIntents.length > 0
    && request.recipe.recipeVersion === 1;
}

export function isSharedMaterialAssignmentRequest(
  value: unknown,
): value is SharedMaterialAssignmentRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<SharedMaterialAssignmentRequest>;
  return request.schemaVersion === 1
    && typeof request.assetId === 'string'
    && Number.isInteger(request.targetMeshIndex)
    && Array.isArray(request.surfaceIntents)
    && Boolean(request.recipe)
    && Boolean(request.provenance)
    && request.provenance?.materialAuthority === 'MaterialAssignmentCore.js'
    && request.provenance?.placementAuthority === 'WorldAssetPlacementPipeline.js';
}
