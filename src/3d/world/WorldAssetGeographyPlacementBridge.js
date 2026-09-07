/**
 * Geography-aware adapter for the existing world asset placement pipeline.
 *
 * The established placement pipeline remains the source of truth for geometry, grounding, terrain,
 * hydrology and material assignment. This bridge adds an orthogonal ecological profile after the
 * placement gate has approved the surface. It is deliberately opt-in so existing callers keep exactly
 * the same placement semantics until they migrate.
 *
 * The bridge records a deterministic explanation of why an asset belongs where it was placed:
 * geography family, dominant domains, climate signal, material response, cohort, preferred rotation,
 * regional character and distribution decision. None of these values modify the canonical map or the
 * already-grounded transform. A strict caller can request rejection when geographic plausibility is too
 * low; the default is advisory mode so production content cannot disappear merely because a new policy
 * is introduced.
 *
 * @module world/WorldAssetGeographyPlacementBridge
 */

import {
  auditWorldAssetPlacement,
  attachPreparedWorldAsset,
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
import {
  sampleRegionalAssetAnchor,
  applyRegionalAnchorToPlacementScore,
  regionalAssetMaterialBias,
} from './worldAssetRegionalAnchors.js';

export const WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY = Object.freeze({
  id: 'world-asset-geography-placement-bridge-2026-09-07-v2-regional-coordinate-preservation',
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
  regionalCharacterOptIn: true,
  explicitNormalizedCoordinatesOnly: true,
});

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function optionalFinite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function surfaceForProfile(prepared) {
  const surface = prepared?.surface;
  if (!surface || typeof surface !== 'object') return null;
  const position = prepared.object?.position;
  const footprintSample = prepared.footprint?.samples?.[0] ?? null;
  const centerX = optionalFinite(surface.x);
  const centerZ = optionalFinite(surface.z);
  return {
    ...surface,
    ...(footprintSample ?? {}),
    // Footprint sampling is useful for relief/moisture aggregation, but the object transform is the
    // authoritative world-space location for a geography profile. Do not let the first footprint sample
    // silently move the asset into another ecological patch.
    x: centerX ?? optionalFinite(position?.x) ?? optionalFinite(footprintSample?.x) ?? 0,
    z: centerZ ?? optionalFinite(position?.z) ?? optionalFinite(footprintSample?.z) ?? 0,
  };
}

function normalizedRegionCoordinates(surface = {}, metadata = {}, object = null) {
  const candidatesX = [
    surface.normalizedX,
    surface.regionNormalizedX,
    surface.mapNormalizedX,
    metadata.normalizedX,
    metadata.regionNormalizedX,
    object?.userData?.normalizedWorldX,
    object?.userData?.worldNormalizedX,
  ];
  const candidatesY = [
    surface.normalizedZ,
    surface.normalizedY,
    surface.regionNormalizedY,
    surface.mapNormalizedY,
    metadata.normalizedZ,
    metadata.normalizedY,
    metadata.regionNormalizedY,
    object?.userData?.normalizedWorldZ,
    object?.userData?.worldNormalizedZ,
  ];
  const x = candidatesX.map(optionalFinite).find((value) => value !== null);
  const y = candidatesY.map(optionalFinite).find((value) => value !== null);
  if (x === null || y === null) return null;
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
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

function attachGeographyMetadata(object, profile, decision, summary, regional = null) {
  if (!object) return;
  object.userData ||= {};
  object.userData.worldAssetGeographyProfile = profile;
  object.userData.worldAssetGeographyDecision = decision;
  object.userData.worldAssetGeographySummary = summary;
  object.userData.worldAssetGeographyRegional = regional;
  object.userData.worldAssetGeographyPolicy = WORLD_ASSET_GEOGRAPHY_PLACEMENT_BRIDGE_POLICY.id;
  object.userData.worldAssetGeographyProfilePolicy = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.id;
}

function augmentManifest(prepared, profile, decision, summary, regional = null) {
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
      regional: regional ?? null,
      decision,
    },
  };
  if (prepared.object) prepared.object.userData.worldPlacementManifest = manifest;
  return manifest;
}

function enrichRegionalCharacter(profile, surface, metadata, object, decision) {
  const coordinates = normalizedRegionCoordinates(surface, metadata, object);
  if (!coordinates) {
    return Object.freeze({
      enabled: false,
      reason: 'missing-explicit-normalized-coordinates',
      score: finite(profile?.placementScore, 0),
      materialBias: null,
    });
  }
  const family = profile?.family || resolveGeographyFamily(metadata, object);
  const anchor = sampleRegionalAssetAnchor(coordinates.x, coordinates.y, family);
  const regionalScore = applyRegionalAnchorToPlacementScore(
    profile?.placementScore ?? 0,
    family,
    anchor,
  );
  const materialBias = regionalAssetMaterialBias(coordinates.x, coordinates.y, family);
  return Object.freeze({
    enabled: true,
    normalizedX: coordinates.x,
    normalizedY: coordinates.y,
    dominantAnchor: anchor?.dominantAnchor ?? anchor?.id ?? null,
    anchors: anchor?.anchors ?? anchor?.topAnchors ?? [],
    family,
    familyResponse: finite(anchor?.familyResponse, 0.5),
    regionalScore: finite(regionalScore, decision?.score ?? profile?.placementScore ?? 0),
    climate: anchor?.climate ?? null,
    surface: anchor?.surface ?? null,
    materialBias: materialBias ?? null,
  });
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
    const manifest = augmentManifest(prepared, {
      family: resolveGeographyFamily(metadata, object),
      placementScore: 0.5,
      placementClass: 'unknown',
      climateSignal: 0,
      cohort: 0.5,
      preferredAspect: 0,
      preferredRotationRadians: 0,
      material: null,
    }, decision, null, null);
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

  const baseDecision = assetGeographyPlacementDecision(profile, {
    rejectPoor: strictGeography,
    minimumScore,
  });
  const regional = enrichRegionalCharacter(
    profile,
    surface,
    metadata,
    object,
    baseDecision,
  );
  const decision = regional.enabled && Number.isFinite(regional.regionalScore)
    ? Object.freeze({
      ...baseDecision,
      baseScore: baseDecision.score,
      regionalScore: regional.regionalScore,
      score: regional.regionalScore,
      regionalApplied: true,
      accept: !strictGeography || regional.regionalScore >= minimumScore,
    })
    : baseDecision;
  const summary = summarizeAssetGeography(profile);
  const manifest = augmentManifest(prepared, profile, decision, summary, regional);
  attachGeographyMetadata(prepared.object, profile, decision, summary, regional);

  if (strictGeography && !decision.accept) {
    return {
      ...prepared,
      ok: false,
      error: `geography:${decision.reasons?.join(',') || 'placement-not-plausible'}`,
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
    geographyRegional: regional,
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
    geographyRegional: prepared.geographyRegional ?? null,
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
  const footprint = object?.userData?.worldPlacementFootprint;
  const surface = storedSurface
    ? {
      ...storedSurface,
      ...(footprint?.samples?.[0] ?? {}),
      x: optionalFinite(storedSurface.x) ?? optionalFinite(object?.position?.x) ?? optionalFinite(footprint?.samples?.[0]?.x) ?? 0,
      z: optionalFinite(storedSurface.z) ?? optionalFinite(object?.position?.z) ?? optionalFinite(footprint?.samples?.[0]?.z) ?? 0,
    }
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

  const profileMetadata = metadataForProfile(metadata, object);
  const profile = sampleWorldAssetGeographyProfile(surface, profileMetadata);
  const validity = validateAssetGeographyProfile(profile);
  const baseDecision = validity.ok
    ? assetGeographyPlacementDecision(profile, { rejectPoor: strictGeography, minimumScore })
    : Object.freeze({
      accept: false,
      decision: 'invalid-profile',
      score: profile?.placementScore ?? null,
      plausible: false,
      reasons: validity.errors,
    });
  const regional = validity.ok
    ? enrichRegionalCharacter(profile, surface, metadata, object, baseDecision)
    : null;
  const decision = validity.ok && regional?.enabled
    ? Object.freeze({
      ...baseDecision,
      baseScore: baseDecision.score,
      regionalScore: regional.regionalScore,
      score: regional.regionalScore,
      regionalApplied: true,
      accept: !strictGeography || regional.regionalScore >= minimumScore,
    })
    : baseDecision;
  return {
    ...placementAudit,
    ok: placementAudit.ok && (!strictGeography || decision.accept),
    geography: profile,
    geographyDecision: decision,
    geographyValidation: validity,
    geographyRegional: regional,
    geographySummary: summarizeAssetGeography(profile),
  };
}

export function evaluateWorldAssetGeographyOnly(object, {
  metadata = {},
  minimumScore = WORLD_ASSET_GEOGRAPHY_PROFILE_POLICY.scoreFloor,
} = {}) {
  const surface = object?.userData?.worldPlacementSurface;
  if (!surface) return Object.freeze({ ok: false, error: 'missing-surface-context' });
  const resolvedSurface = {
    ...surface,
    x: optionalFinite(surface.x) ?? optionalFinite(object?.position?.x) ?? 0,
    z: optionalFinite(surface.z) ?? optionalFinite(object?.position?.z) ?? 0,
  };
  const profile = sampleWorldAssetGeographyProfile(resolvedSurface, metadataForProfile(metadata, object));
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
