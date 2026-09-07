/**
 * Şafak Kartalı — geographic actor surface contract.
 * Pure contract layer over the existing geography adapter and shared material/placement pipeline.
 * It does not spawn actors, edit terrain or introduce a second biome/material framework.
 */
import { materialSurfaceRolesForLivingWorld, resolveLivingWorldGeography, auditLivingWorldAsset } from './livingWorldGeographyAdapter.js';
import { LIVING_WORLD_VISUAL_POLICY, inspectLivingWorldAssetVisual } from './livingWorldAssetVisualAdapter.js';

export const LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY = Object.freeze({
  id: 'living-world-geographic-surface-contract-2026-09-07-v1',
  deterministic: true,
  geographyAuthority: 'livingWorldGeographyAdapter.js',
  materialAuthority: 'MaterialAssignmentCore.js',
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  noSecondBiomeFramework: true,
  noTerrainOwnership: true,
  noSpawnOwnership: true,
  settlementEdgeMeters: 140,
  roadCorridorMeters: 28,
  riparianWaterDepthMeters: 0.08,
  steepSlopeDegrees: 24,
});

function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function normalize(value) { return String(value ?? '').trim().toLowerCase(); }
function distance2D(a, b) { return Math.hypot(finite(a?.x) - finite(b?.x), finite(a?.z) - finite(b?.z)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, finite(value, min))); }

function nearestSettlement(position, seats) {
  let nearest = Infinity;
  for (const seat of seats || []) if (Number.isFinite(seat?.x) && Number.isFinite(seat?.z)) nearest = Math.min(nearest, distance2D(position, seat));
  return nearest;
}

function nearestRoad(position, edges) {
  let nearest = Infinity;
  for (const edge of edges || []) {
    const points = Array.isArray(edge?.points) ? edge.points : [];
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1]; const b = points[i];
      if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) continue;
      const dx = b.x - a.x; const dz = b.z - a.z; const len2 = dx * dx + dz * dz || 1;
      const t = clamp(((position.x - a.x) * dx + (position.z - a.z) * dz) / len2, 0, 1);
      nearest = Math.min(nearest, Math.hypot(position.x - (a.x + dx * t), position.z - (a.z + dz * t)));
    }
  }
  return nearest;
}

export function classifyGeographicSurfaceContext({
  position,
  slopeDegrees = 0,
  waterDepth = 0,
  settlementSeats = [],
  roadEdges = [],
  moisture = 0,
  region = 'temperate',
} = {}) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return Object.freeze({ ok: false, zone: 'invalid', reason: 'invalid-position' });
  const settlementDistance = nearestSettlement(position, settlementSeats);
  const roadDistance = nearestRoad(position, roadEdges);
  const slope = Math.max(0, finite(slopeDegrees));
  const water = Math.max(0, finite(waterDepth));
  const wet = Math.max(0, finite(moisture));
  let zone = 'wilderness';
  if (Number.isFinite(settlementDistance) && settlementDistance <= LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.settlementEdgeMeters) zone = 'settlement-edge';
  if (Number.isFinite(roadDistance) && roadDistance <= LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.roadCorridorMeters) zone = 'road-corridor';
  if (water >= LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.riparianWaterDepthMeters || wet >= 0.72) zone = 'riparian';
  if (slope >= LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.steepSlopeDegrees) zone = 'steep-exposure';
  if (zone === 'wilderness' && ['reach', 'westerlands', 'temperate', 'steppe'].includes(normalize(region)) && slope < 12 && water < 0.02) zone = 'open-field';
  return Object.freeze({
    ok: true, zone, region: normalize(region) || 'temperate', settlementDistance, roadDistance,
    slopeDegrees: slope, waterDepth: water, moisture: wet,
    flags: Object.freeze({ nearSettlement: settlementDistance <= LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.settlementEdgeMeters, nearRoad: roadDistance <= LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.roadCorridorMeters, riparian: zone === 'riparian', steep: slope >= LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.steepSlopeDegrees, openField: zone === 'open-field' }),
  });
}

export function resolveLivingWorldActorSurfaceProfile({
  worldX = 0,
  worldZ = 0,
  role = 'guard',
  speciesId = null,
  groundHeight = null,
  slopeDegrees = 0,
  waterDepth = 0,
  settlementSeats = [],
  roadEdges = [],
  moisture = 0,
  seed = 0x51afac,
} = {}) {
  const position = { x: worldX, z: worldZ };
  const surface = classifyGeographicSurfaceContext({ position, slopeDegrees, waterDepth, settlementSeats, roadEdges, moisture });
  const geography = resolveLivingWorldGeography({ worldX, worldZ, role, speciesId, groundHeight, slopeDegrees, waterDepth, settlementDistance: surface.settlementDistance, roadDistance: surface.roadDistance, seed });
  const materialRoles = materialSurfaceRolesForLivingWorld({ role, speciesId, worldX, worldZ });
  return Object.freeze({
    ok: geography.ok && surface.ok,
    region: geography.region,
    profileId: geography.profileId,
    reason: geography.reason,
    normalizedReference: geography.normalizedReference,
    surface,
    materialRoles,
    placement: Object.freeze({ groundHeight: geography.groundHeight, slopeDegrees: surface.slopeDegrees, waterDepth: surface.waterDepth, requireSurfaceContext: true, habitatValid: geography.ok }),
  });
}

export function validateGeographicActorSurfaceContext({ profile, allowedZones = null, maxSlopeDegrees = 38, maxWaterDepth = 0.05 } = {}) {
  const errors = [];
  if (!profile?.ok) errors.push('profile-invalid');
  if (!profile?.surface?.ok) errors.push('surface-invalid');
  if (Array.isArray(allowedZones) && allowedZones.length && !allowedZones.includes(profile?.surface?.zone)) errors.push('zone-not-allowed');
  if (finite(profile?.surface?.slopeDegrees) > maxSlopeDegrees) errors.push('slope-limit');
  if (finite(profile?.surface?.waterDepth) > maxWaterDepth) errors.push('water-depth-limit');
  if (!profile?.materialRoles?.assetCandidates?.length) errors.push('no-authored-asset-candidate');
  if (!profile?.materialRoles?.surfaceRoles?.length) errors.push('surface-role-contract-missing');
  return Object.freeze({ ok: errors.length === 0, errors, policyId: LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.id });
}

export function buildLivingWorldSurfaceManifest({ object = null, profile, assetId = null, sourcePath = null, placement = null } = {}) {
  const visual = object ? inspectLivingWorldAssetVisual(object, { role: profile?.materialRoles?.speciesId ? 'wildlife' : 'guard', speciesId: profile?.materialRoles?.speciesId, region: profile?.region, sourcePath, assetId }) : null;
  const manifest = {
    policyId: LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.id,
    asset: { id: assetId || object?.userData?.assetId || null, src: sourcePath || object?.userData?.assetSrc || null, candidates: profile?.materialRoles?.assetCandidates || [] },
    geography: { region: profile?.region || null, profileId: profile?.profileId || null, reference: profile?.normalizedReference || null, microSurface: profile?.surface || null },
    material: { authority: LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.materialAuthority, roles: profile?.materialRoles?.surfaceRoles || [], visualPolicy: LIVING_WORLD_VISUAL_POLICY.id, audit: visual ? { ok: visual.ok, semanticCoverage: visual.semanticCoverage, texturedMaterialRatio: visual.texturedMaterialRatio, normalMappedMaterialRatio: visual.normalMappedMaterialRatio, missingRoles: visual.missingRoles } : null },
    placement: placement || profile?.placement || null,
  };
  return Object.freeze(manifest);
}

export function auditLivingWorldGeographicSurface({ object = null, profile, assetId = null, sourcePath = null, placement = null } = {}) {
  const context = validateGeographicActorSurfaceContext({ profile });
  const manifest = buildLivingWorldSurfaceManifest({ object, profile, assetId, sourcePath, placement });
  const placementAudit = object ? auditLivingWorldAsset(object, profile) : null;
  const errors = [...context.errors];
  if (placementAudit && !placementAudit.ok) errors.push(...placementAudit.errors.map((entry) => `placement:${entry}`));
  if (manifest.material.audit && manifest.material.audit.semanticCoverage < LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold) errors.push('visual-semantic-coverage');
  return Object.freeze({ ok: errors.length === 0, errors, manifest, profile, placementAudit });
}

export function geographicSurfaceDigest(value) {
  const source = JSON.stringify({ policyId: LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.id, region: value?.profile?.region, zone: value?.profile?.surface?.zone, profileId: value?.profile?.profileId, asset: value?.manifest?.asset?.src || null, roles: value?.manifest?.material?.roles || [] });
  let hash = 2166136261;
  for (const char of source) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function summarizeGeographicSurfaceAudit(audit) {
  return Object.freeze({ ok: Boolean(audit?.ok), region: audit?.profile?.region || null, zone: audit?.profile?.surface?.zone || null, slopeDegrees: audit?.profile?.surface?.slopeDegrees || 0, waterDepth: audit?.profile?.surface?.waterDepth || 0, semanticCoverage: audit?.manifest?.material?.audit?.semanticCoverage ?? 0, texturedMaterialRatio: audit?.manifest?.material?.audit?.texturedMaterialRatio ?? 0, missingRoles: [...(audit?.manifest?.material?.audit?.missingRoles || [])], errors: [...(audit?.errors || [])] });
}

export function geographicSurfaceAcceptance(audit) {
  const summary = summarizeGeographicSurfaceAudit(audit);
  return Object.freeze({ ...summary, pass: summary.ok && summary.semanticCoverage >= LIVING_WORLD_VISUAL_POLICY.semanticCoverageThreshold && summary.missingRoles.length === 0, materialAuthority: LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.materialAuthority, placementAuthority: LIVING_WORLD_GEOGRAPHIC_SURFACE_POLICY.placementAuthority });
}
