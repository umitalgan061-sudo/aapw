/**
 * Scene-side bridge for the terrain environment contracts.
 *
 * The live scene remains owner of actual Three.js objects. This bridge only annotates/validates already
 * created objects and builds deterministic acceptance manifests. It intentionally does not clone,
 * replace, move or procedurally create geometry.
 */
import { buildTerrainEnvironmentProductionPlan } from './terrainEnvironmentContract.js';
import { auditEnvironmentObject } from './terrainEnvironmentTextureAudit.js';
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from './terrainEnvironmentAssetManifest.js';
import { resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';
import { resolveEnvironmentLod } from './terrainEnvironmentLodPolicy.js';
import { environmentSpatialNoise, ecotoneComposition } from './terrainEnvironmentSpatialPolicy.js';
import { TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY, climateExposureEnvelope, seasonalAssetWeights } from './terrainEnvironmentClimateTransitions.js';
import { TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY, distributionDensity } from './terrainEnvironmentDistributionPlanner.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const norm = (value) => String(value ?? '').trim().toLowerCase();

export const TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY = freeze({
  id: 'terrain-environment-scene-bridge-2026-09-07-v1',
  deterministic: true,
  annotationOnly: true,
  actualObjectOwner: 'live-scene',
  terrainAuthority: 'src/3d/world/terrain.js',
  materialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  placementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  noGeometryReplacement: true,
  noCoordinateRewrite: true,
  noHeightMutation: true,
  noHydrologyMutation: true,
});

function objectPosition(root) {
  return freeze({ x: finite(root?.position?.x), y: finite(root?.position?.y), z: finite(root?.position?.z) });
}

function guessAssetMetadata(root, metadata = {}) {
  if (metadata.src || metadata.id) return metadata;
  const userData = root?.userData ?? {};
  const src = userData.assetSrc ?? userData.sourceAsset ?? userData.modelPath ?? '';
  const id = userData.assetId ?? userData.modelId ?? root?.name ?? '';
  const manifestEntry = TERRAIN_ENVIRONMENT_ASSET_MANIFEST.find((entry) => norm(entry.src) === norm(src));
  return manifestEntry ? { ...manifestEntry, id: manifestEntry.id ?? id } : { id, src };
}

function sampleFromContext(context = {}, root = null) {
  const position = objectPosition(root);
  return {
    ...context,
    worldX: context.worldX ?? position.x,
    worldZ: context.worldZ ?? position.z,
    heightMeters: context.heightMeters ?? position.y,
    heightAboveSeaMeters: context.heightAboveSeaMeters ?? context.heightMeters ?? position.y,
    slopeDegrees: context.slopeDegrees ?? context.slope ?? 0,
    rockWeight: context.rockWeight ?? 0,
    snowWeight: context.snowWeight ?? 0,
    waterWeight: context.waterWeight ?? 0,
    waterDepth: context.waterDepth ?? 0,
    moisture: context.moisture ?? 0.5,
    biome: context.biome ?? '',
    temperatureC: context.temperatureC ?? 12,
    windExposure: context.windExposure ?? 0.5,
    season: context.season ?? 'summer',
    settlementDistance: context.settlementDistance ?? Infinity,
    roadDistance: context.roadDistance ?? Infinity,
    distanceFromGroveCenterMeters: context.distanceFromGroveCenterMeters ?? Infinity,
    groveRadiusMeters: context.groveRadiusMeters ?? 160,
  };
}

export function sceneObjectEnvironmentContext(root, { asset = {}, category = asset.category, sample = {}, distanceMeters = 0, visibility = 1, winter = false, seed = 0, seedOrdinal = 0, auditTextures = true } = {}) {
  if (!root) return freeze({ ok: false, errors: freeze(['missing-object']) });
  const metadata = guessAssetMetadata(root, asset);
  const contextSample = sampleFromContext(sample, root);
  const plan = metadata.src || metadata.id
    ? buildTerrainEnvironmentProductionPlan(metadata, {
      category,
      worldX: contextSample.worldX,
      worldZ: contextSample.worldZ,
      seedOrdinal,
      biome: contextSample.biome,
      climate: contextSample.climate ?? '',
      winter,
      sample: contextSample,
      distanceMeters,
      visibility,
    })
    : null;
  const textureAudit = auditTextures ? auditEnvironmentObject(root, { asset: metadata }) : null;
  const profile = resolveTerrainEnvironmentProfile(category, metadata);
  const lod = resolveEnvironmentLod(category, distanceMeters);
  const ecological = ecotoneComposition(category, { ...contextSample, seed, worldX: contextSample.worldX, worldZ: contextSample.worldZ });
  const climate = climateExposureEnvelope(contextSample);
  const seasonal = seasonalAssetWeights(contextSample);
  const density = distributionDensity(category, contextSample);
  const errors = [];
  if (!profile) errors.push('missing-profile');
  if (plan && !plan.attach.ok) errors.push(...plan.attach.errors);
  if (textureAudit && !textureAudit.ok) errors.push(...textureAudit.errors);
  return freeze({
    ok: errors.length === 0,
    errors: freeze(errors),
    policyId: TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY.id,
    object: root,
    asset: freeze(metadata),
    profile,
    sample: freeze(contextSample),
    plan,
    textureAudit,
    lod,
    spatial: ecological,
    climate,
    seasonal,
    density,
    annotations: freeze({
      position: objectPosition(root),
      contractId: plan?.contractId ?? null,
      climatePolicyId: TERRAIN_ENVIRONMENT_CLIMATE_TRANSITION_POLICY.id,
      distributionPolicyId: TERRAIN_ENVIRONMENT_DISTRIBUTION_PLANNER_POLICY.id,
      terrainHeightUntouched: true,
      hydrologyUntouched: true,
      objectTransformUntouched: true,
    }),
  });
}

export function annotateEnvironmentObject(root, context = {}) {
  const result = sceneObjectEnvironmentContext(root, context);
  if (!root) return result;
  root.userData ??= {};
  root.userData.terrainEnvironmentBridge = freeze({
    policyId: TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY.id,
    assetId: result.asset?.id ?? '',
    category: result.profile?.category ?? context.category ?? '',
    biome: result.sample.biome,
    climateFamily: result.climate?.forestScore > result.climate?.tundraScore ? 'temperate' : 'cold/highland',
    seasonalSignal: result.seasonal?.winterVegetation ?? 0,
    density: result.density,
    lodLevel: result.lod?.level ?? 0,
    textureQuality: result.textureAudit ? result.textureAudit.surfaces.length : null,
    deterministic: true,
    annotationOnly: true,
  });
  return result;
}

export function auditSceneEnvironmentObjects(entries = []) {
  const reports = entries.map((entry) => sceneObjectEnvironmentContext(entry.root, entry.context));
  const errors = reports.flatMap((report) => report.errors);
  const attached = reports.filter((report) => report.object?.parent != null).length;
  return freeze({
    version: 1,
    policyId: TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY.id,
    reports,
    summary: freeze({ objects: reports.length, attached, accepted: reports.filter((report) => report.ok).length, rejected: reports.filter((report) => !report.ok).length }),
    acceptance: freeze({ ok: errors.length === 0, errorCount: errors.length, coordinatesUntouched: reports.every((report) => report.annotations?.objectTransformUntouched !== false) }),
    errors: freeze(errors),
  });
}

export function summarizeSceneEnvironmentByCategory(entries = []) {
  const buckets = new Map();
  for (const entry of entries) {
    const category = norm(entry.context?.category ?? entry.root?.userData?.terrainEnvironmentBridge?.category ?? 'unknown');
    const bucket = buckets.get(category) ?? { category, count: 0, accepted: 0, avgDensity: 0, avgTextureQuality: 0, averageLod: 0 };
    const report = entry.report ?? sceneObjectEnvironmentContext(entry.root, entry.context);
    bucket.count += 1;
    bucket.accepted += report.ok ? 1 : 0;
    bucket.avgDensity += report.density ?? 0;
    bucket.avgTextureQuality += report.textureAudit ? report.textureAudit.surfaces.length : 0;
    bucket.averageLod += report.lod?.level ?? 0;
    buckets.set(category, bucket);
  }
  const summary = [...buckets.values()].map((bucket) => freeze({
    category: bucket.category,
    count: bucket.count,
    accepted: bucket.accepted,
    acceptanceRatio: bucket.count ? bucket.accepted / bucket.count : 0,
    averageDensity: bucket.count ? bucket.avgDensity / bucket.count : 0,
    averageTextureSurfaceCount: bucket.count ? bucket.avgTextureQuality / bucket.count : 0,
    averageLod: bucket.count ? bucket.averageLod / bucket.count : 0,
  }));
  return freeze(summary);
}

export function sceneEnvironmentSpatialFingerprint(entries = []) {
  const fingerprints = entries.map((entry, index) => {
    const report = entry.report ?? sceneObjectEnvironmentContext(entry.root, entry.context);
    const p = report.sample ?? {};
    const n = environmentSpatialNoise(p.worldX, p.worldZ, index + 0x51f15e);
    return freeze({
      index,
      category: report.profile?.category ?? entry.context?.category ?? '',
      worldX: finite(p.worldX),
      worldZ: finite(p.worldZ),
      macro: n.macro,
      broad: n.broad,
      meso: n.meso,
      fine: n.fine,
      density: report.density ?? 0,
    });
  });
  const stableString = fingerprints.map((row) => `${row.category}:${row.worldX.toFixed(2)}:${row.worldZ.toFixed(2)}:${row.macro.toFixed(6)}:${row.density.toFixed(6)}`).join('|');
  let hash = 2166136261;
  for (const character of stableString) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return freeze({ policyId: TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY.id, hash: hash >>> 0, fingerprints });
}

export function compareSceneEnvironmentFingerprints(left, right) {
  return freeze({ equal: left?.hash === right?.hash, leftHash: left?.hash ?? null, rightHash: right?.hash ?? null });
}

export function validateSceneEnvironmentBridge(entries = []) {
  const audit = auditSceneEnvironmentObjects(entries);
  const summaries = summarizeSceneEnvironmentByCategory(entries.map((entry, index) => ({ ...entry, report: audit.reports[index] })));
  const fingerprint = sceneEnvironmentSpatialFingerprint(entries.map((entry, index) => ({ ...entry, report: audit.reports[index] })));
  const errors = [...audit.errors];
  for (const summary of summaries) {
    if (summary.acceptanceRatio < 0) errors.push(`invalid-acceptance:${summary.category}`);
    if (summary.averageDensity < 0) errors.push(`invalid-density:${summary.category}`);
  }
  return freeze({
    ok: errors.length === 0,
    policyId: TERRAIN_ENVIRONMENT_SCENE_BRIDGE_POLICY.id,
    audit,
    summaries,
    fingerprint,
    errors: freeze(errors),
    acceptance: freeze({ ok: errors.length === 0, annotationOnly: true, noGeometryReplacement: true, deterministic: true }),
  });
}
