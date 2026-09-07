/**
 * Geography-aware adapter for the existing world asset placement pipeline.
 *
 * The established placement pipeline remains the source of truth for geometry, grounding, terrain,
 * hydrology and material assignment. This bridge adds an orthogonal ecological profile after the
 * placement gate has approved the surface. It is deliberately opt-in so existing callers keep exactly
 * the same placement semantics until they migrate.
 *
 * The bridge records a deterministic explanation of why an asset belongs where it was placed:
 * geography family, dominant domains, climate signal, material response, cohort, preferred rotation
 * and distribution decision. None of these values modify the canonical map or the already-grounded
 * transform. A strict caller can request rejection when geographic plausibility is too low; the default
 * is advisory mode so production content cannot disappear merely because a new policy is introduced.
 *
 * @module world/WorldAssetGeographyPlacementBridge
 */

import {
  auditWorldAssetPlacement,
  attachPreparedWorldAsset,
  placeWorldAsset,
  prepareWorldAssetForPlacement,
} from './WorldAssetPlacementPipeline.js';
import {
  WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY,
  assetGeographyPlacementDecision,
  deterministicAssetScale,
  deterministicAssetYaw,
  sampleWorldAssetGeographyProfile,
  summarizeAssetGeography,
  validateAssetGeographyProfile,
} from './worldAssetGeographyProfile.js';

export const WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY = Object.freeze({
  id: 'world-asset-geography-placement-bridge-2026-09-07-v1',
  profilePolicyId: WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id,
  advisoryByDefault: true,
  strictOptIn: true,
  placementAuthorityPreserved: true,
  terrainAuthorityPreserved: true,
  hydrologyAuthorityPreserved: true,
  materialAssignmentAuthorityPreserved: true,
  transformAuthorityPreserved: true,
  sourceUvAuthorityPreserved: true,
  manifestAugmentationOnly: true,
});

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function surfaceForProfile(prepared) {
  const surface = prepared?.surface;
  if (!surface || typeof surface !== 'object') return null;
  return {
    ...surface,
    ...(prepared.footprint?.samples?.[0] ?? {}),
  };
}

function metadataForProfile(metadata = {}, object = null) {
  return {
    ...metadata,
    id: metadata.id ?? object?.userData?.assetId,
    category: metadata.category ?? object?.userData?.assetCategory,
    src: metadata.src ?? object?.userData?.assetSrc,
    family: metadata.family ?? metadata.assetFamily ?? object?.userData?.assetFamily,
  };
}

function resolveGeographyFamily(metadata = {}, object = null) {
  return metadata.family
    ?? metadata.assetFamily
    ?? object?.userData?.assetFamily
    ?? metadata.category
    ?? object?.userData?.assetCategory
    ?? 'vegetation';
}

function attachGeographyMetadata(object, profile, decision, summary) {
  if (!object) return;
  object.userData ||= {};
  object.userData.worldAssetGeographyProfile = profile;
  object.userData.worldAssetGeographyDecision = decision;
  object.userData.worldAssetGeographySummary = summary;
  object.userData.worldAssetGeographyPolicy = WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY.id;
  object.userData.worldAssetGeographyProfilePolicy = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id;
}

function augmentManifest(prepared, profile, decision, summary) {
  const manifest = {
    ...(prepared.manifest || {}),
    assetGeography: {
      policyId: WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY.id,
      profilePolicyId: WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id,
      family: profile.family,
      placementScore: profile.placementScore,
      placementClass: profile.placementClass,
      climateSignal: profile.climateSignal,
      dominantDomains: summary?.topDomains ?? [],
      material: summary?.material ?? null,
      cohort: profile.cohort,
      preferredAspect: profile.preferredAspect,
      preferredRotationRadians: profile.preferredRotationRadians,
      deterministicScale: deterministicAssetScale(profile, finite(prepared.object?.position?.x), finite(prepared.object?.position?.z)),
      deterministicYaw: deterministicAssetYaw(profile, finite(prepared.object?.position?.x), finite(prepared.object?.position?.z)),
      decision,
    },
  };
  if (prepared.object) prepared.object.userData.worldPlacementManifest = manifest;
  return manifest;
}

/**
 * Prepare an asset using the existing placement/material pipeline, then attach a deterministic
 * geography profile. The original prepared transform and placement result are never overwritten.
 */
export function prepareWorldAssetWithGeography(object, {
  metadata = {},
  minimumScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor,
  strictGeography = false,
  ...placementOptions
} = {}) {
  const prepared = prepareWorldAssetForPlacement(object, { metadata, ...placementOptions });
  if (!prepared?.ok) return prepared;

  const surface = surfaceForProfile(prepared);
  if (!surface) {
    const profile = null;
    const decision = Object.freeze({
      accept: true,
      decision: 'advisory-no-surface-context',
      score: null,
      plausible: null,
      reasons: ['missing-surface-context'],
    });
    const manifest = augmentManifest(prepared, { family: resolveGeographyFamily(metadata, object), placementScore: 0.5, placementClass: 'unknown', climateSignal: 0, cohort: 0.5, preferredAspect: 0, preferredRotationRadians: 0, material: null }, decision, null);
    prepared.manifest = manifest;
    return { ...prepared, geography: profile, geographyDecision: decision, manifest };
  }

  const profile = sampleWorldAssetGeographyProfile(
    surface,
    metadataForProfile(metadata, object),
  );
  const validity = validateAssetGeographyProfile(profile);
  if (!validity.ok) {
    return {
      ...prepared,
      ok: false,
      error: `geography:${validity.errors.join(',')}`,
      geography: profile,
      geographyDecision: null,
      geographyValidation: validity,
    };
  }

  const decision = assetGeographyPlacementDecision(profile, {
    rejectPoor: strictGeography,
    minimumScore,
  });
  const summary = summarizeAssetGeography(profile);
  const manifest = augmentManifest(prepared, profile, decision, summary);
  attachGeographyMetadata(prepared.object, profile, decision, summary);

  if (strictGeography && !decision.accept) {
    return {
      ...prepared,
      ok: false,
      error: `geography:${decision.reasons.join(',') || 'placement-not-plausible'}`,
      geography: profile,
      geographyDecision: decision,
      geographyValidation: validity,
      manifest,
    };
  }

  return {
    ...prepared,
    geography: profile,
    geographyDecision: decision,
    geographyValidation: validity,
    manifest,
  };
}

/**
 * Place an asset with geography diagnostics while delegating all actual scene insertion to the
 * existing pipeline. Advisory mode is the safe production default.
 */
export function placeWorldAssetWithGeography(scene, object, options = {}) {
  const prepared = prepareWorldAssetWithGeography(object, options);
  if (!prepared?.ok) return prepared;
  const attached = attachPreparedWorldAsset(scene, prepared);
  if (!attached.ok) return attached;
  return {
    ...prepared,
    object: attached.object,
    manifest: attached.manifest,
  };
}

/**
 * Compatibility helper for code that expects the old placeWorldAsset return shape while still
 * persisting the geography profile. This helper never changes the old placement authority.
 */
export function placeWorldAssetWithGeographyCompatibility(scene, object, options = {}) {
  const prepared = prepareWorldAssetWithGeography(object, options);
  if (!prepared?.ok) return prepared;
  const attached = attachPreparedWorldAsset(scene, prepared);
  return attached.ok ? {
    ok: true,
    object: attached.object,
    material: prepared.material,
    validation: prepared.validation,
    surface: prepared.surface,
    footprint: prepared.footprint,
    placementPolicy: prepared.placementPolicy,
    placementMaterialContext: prepared.placementMaterialContext,
    manifest: attached.manifest,
    geography: prepared.geography,
    geographyDecision: prepared.geographyDecision,
  } : attached;
}

/**
 * Re-audit an already prepared asset. The canonical placement audit remains authoritative; geography
 * is reported as an additional diagnostic layer rather than silently changing a saved object.
 */
export function auditWorldAssetWithGeography(object, {
  metadata = {},
  minimumScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor,
  strictGeography = false,
} = {}) {
  const placementAudit = auditWorldAssetPlacement(object);
  const storedSurface = object?.userData?.worldPlacementSurface;
  const surface = storedSurface
    ? { ...storedSurface, ...(object?.userData?.worldPlacementFootprint?.samples?.[0] ?? {}) }
    : null;
  if (!surface) {
    return {
      ...placementAudit,
      geography: null,
      geographyDecision: Object.freeze({
        accept: !strictGeography,
        decision: strictGeography ? 'reject-no-surface-context' : 'advisory-no-surface-context',
        score: null,
        plausible: null,
        reasons: ['missing-surface-context'],
      }),
      ok: placementAudit.ok && !strictGeography,
    };
  }

  const profile = sampleWorldAssetGeographyProfile(surface, metadataForProfile(metadata, object));
  const validity = validateAssetGeographyProfile(profile);
  const decision = validity.ok
    ? assetGeographyPlacementDecision(profile, { rejectPoor: strictGeography, minimumScore })
    : Object.freeze({
      accept: false,
      decision: 'invalid-profile',
      score: profile?.placementScore ?? null,
      plausible: false,
      reasons: validity.errors,
    });
  return {
    ...placementAudit,
    ok: placementAudit.ok && (!strictGeography || decision.accept),
    geography: profile,
    geographyDecision: decision,
    geographyValidation: validity,
    geographySummary: summarizeAssetGeography(profile),
  };
}

export function evaluateWorldAssetGeographyOnly(object, {
  metadata = {},
  minimumScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor,
} = {}) {
  const surface = object?.userData?.worldPlacementSurface;
  if (!surface) return Object.freeze({ ok: false, error: 'missing-surface-context' });
  const profile = sampleWorldAssetGeographyProfile(surface, metadataForProfile(metadata, object));
  const decision = assetGeographyPlacementDecision(profile, { minimumScore, rejectPoor: true });
  return Object.freeze({
    ok: decision.accept,
    profile,
    decision,
    summary: summarizeAssetGeography(profile),
  });
}

export function geographyPlacementScore(object, options = {}) {
  const result = evaluateWorldAssetGeographyOnly(object, options);
  return finite(result.profile?.placementScore, 0);
}

export function geographyPolicyId() {
  return WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY.id;
}

export function geographyProfilePolicyId() {
  return WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id;
}
