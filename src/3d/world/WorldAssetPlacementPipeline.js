/**
 * Geographic facade for the shared world asset placement pipeline.
 *
 * The established grounding/surface implementation lives unchanged in WorldAssetPlacementPipelineCore.
 * This facade adds one post-placement ecological/presentation stage without becoming a geography
 * authority: canonical north cryosphere plus the core's existing surface sample determine whether
 * autonomous vegetation/tree/rock/waterside assets are ecologically plausible and how their already
 * assigned material weathers. Authored structures are never moved or rejected by this layer.
 */

import * as Core from './WorldAssetPlacementPipelineCore.js';
import {
  WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY,
  evaluateWorldAssetGeographicEligibility,
  geographicDensityScaleForWorldAsset,
  resolveWorldAssetGeographicProfile,
} from './worldAssetGeographicProfile.js';
import {
  WORLD_ASSET_SURFACE_WEATHERING_POLICY,
  applyWorldAssetGeographicWeathering,
  auditWorldAssetGeographicWeathering,
} from './worldAssetSurfaceWeathering.js';

export * from './WorldAssetPlacementPipelineCore.js';

export const WORLD_ASSET_GEOGRAPHIC_ADAPTATION_POLICY = Object.freeze({
  id: 'world-asset-placement-geographic-adaptation-2026-09-02-v1',
  corePlacementAuthority: 'WorldAssetPlacementPipelineCore.js',
  geographicProfilePolicyId: WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.id,
  weatheringPolicyId: WORLD_ASSET_SURFACE_WEATHERING_POLICY.id,
  canonicalGeographyUnchanged: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  authoredStructurePlacementUnchanged: true,
  autonomousEcologicalEligibility: true,
  densityMetadata: true,
  renderOnlyWeathering: true,
});

function adaptationOptions(options = {}) {
  return Object.freeze({
    enforceGeographicEligibility: options.enforceGeographicEligibility !== false,
    applyGeographicWeathering: options.applyGeographicWeathering !== false,
  });
}

function adaptationRecord(profile, eligibility, densityScale, weathering) {
  return Object.freeze({
    policyId: WORLD_ASSET_GEOGRAPHIC_ADAPTATION_POLICY.id,
    profilePolicyId: profile.policyId,
    weatheringPolicyId: WORLD_ASSET_SURFACE_WEATHERING_POLICY.id,
    category: profile.category,
    autonomous: profile.autonomous,
    structure: profile.structure,
    eligible: eligibility.ok,
    eligibilityReason: eligibility.reason,
    suitabilityScore: profile.suitability.score,
    densityScale,
    weatheringApplied: Boolean(weathering?.ok),
    weatheredMaterialCount: weathering?.materialCount ?? 0,
    canonicalGeographyUnchanged: true,
  });
}

export function prepareWorldAssetForPlacement(object, options = {}) {
  const prepared = Core.prepareWorldAssetForPlacement(object, options);
  if (!prepared.ok) return prepared;

  const metadata = options.metadata || {};
  const profile = resolveWorldAssetGeographicProfile({
    worldX: object.position.x,
    worldZ: object.position.z,
    surface: prepared.surface || {},
    metadata,
    objectMetadata: object.userData || {},
  });
  const mode = adaptationOptions(options);
  const eligibility = evaluateWorldAssetGeographicEligibility(profile, {
    enforceAutonomous: mode.enforceGeographicEligibility,
  });
  const densityScale = geographicDensityScaleForWorldAsset(profile);

  object.userData ||= {};
  object.userData.worldAssetGeographicProfile = profile;
  object.userData.worldAssetGeographicDensityScale = densityScale;

  if (!eligibility.ok) {
    const adaptation = adaptationRecord(profile, eligibility, densityScale, null);
    object.userData.worldAssetGeographicAdaptation = adaptation;
    object.userData.materialReadyForWorld = false;
    return {
      ok: false,
      error: `geography:${eligibility.reason}`,
      object,
      material: prepared.material,
      validation: prepared.validation,
      surface: prepared.surface,
      footprint: prepared.footprint,
      placementPolicy: prepared.placementPolicy,
      geographicProfile: profile,
      geographicEligibility: eligibility,
      geographicDensityScale: densityScale,
      geographicAdaptation: adaptation,
    };
  }

  const weathering = mode.applyGeographicWeathering
    ? applyWorldAssetGeographicWeathering(object, profile, { metadata })
    : Object.freeze({ ok: true, materialCount: 0, status: 'disabled-by-caller' });
  if (!weathering.ok) {
    object.userData.materialReadyForWorld = false;
    return {
      ...prepared,
      ok: false,
      error: `geographic-weathering:${weathering.error || 'failed'}`,
      geographicProfile: profile,
      geographicEligibility: eligibility,
      geographicDensityScale: densityScale,
      geographicWeathering: weathering,
    };
  }

  const adaptation = adaptationRecord(profile, eligibility, densityScale, weathering);
  const manifest = {
    ...prepared.manifest,
    geographicAdaptation: adaptation,
    geographicProfile: {
      policyId: profile.policyId,
      category: profile.category,
      autonomous: profile.autonomous,
      structure: profile.structure,
      suitabilityScore: profile.suitability.score,
      densityScale,
      climate: { ...profile.climate },
      surface: { ...profile.surface },
      weathering: { ...profile.weathering },
    },
  };

  object.userData.worldAssetGeographicAdaptation = adaptation;
  object.userData.worldPlacementManifest = manifest;
  object.userData.materialReadyForWorld = true;

  return {
    ...prepared,
    manifest,
    geographicProfile: profile,
    geographicEligibility: eligibility,
    geographicDensityScale: densityScale,
    geographicWeathering: weathering,
    geographicAdaptation: adaptation,
  };
}

export function attachPreparedWorldAsset(scene, prepared) {
  return Core.attachPreparedWorldAsset(scene, prepared);
}

export function placeWorldAsset(scene, object, options = {}) {
  const prepared = prepareWorldAssetForPlacement(object, options);
  if (!prepared.ok) return prepared;
  const attached = attachPreparedWorldAsset(scene, prepared);
  return attached.ok ? prepared : attached;
}

export function auditWorldAssetPlacement(object) {
  const coreAudit = Core.auditWorldAssetPlacement(object);
  const errors = [...coreAudit.errors];
  const warnings = [...coreAudit.warnings];
  const adaptation = object?.userData?.worldAssetGeographicAdaptation || null;
  const profile = object?.userData?.worldAssetGeographicProfile || null;

  if (!profile) {
    warnings.push('missing-geographic-profile');
  } else {
    const eligibility = evaluateWorldAssetGeographicEligibility(profile, { enforceAutonomous: true });
    if (!eligibility.ok) errors.push(`geography:${eligibility.reason}`);
  }

  if (adaptation?.weatheringApplied) {
    const weatheringAudit = auditWorldAssetGeographicWeathering(object);
    errors.push(...weatheringAudit.errors.map((error) => `weathering:${error}`));
    warnings.push(...weatheringAudit.warnings.map((warning) => `weathering:${warning}`));
  }

  return {
    ...coreAudit,
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    geographicProfile: profile,
    geographicAdaptation: adaptation,
  };
}
