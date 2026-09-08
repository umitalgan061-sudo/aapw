/**
 * Runtime environment integration gate.
 *
 * This is intentionally an adapter/gate, not a second placement engine. The live scene and
 * WorldAssetPlacementPipeline remain the owners of actual object creation and transforms.
 */
import { buildTerrainEnvironmentProductionPlan, validateTerrainEnvironmentContract } from './terrainEnvironmentContract.js';
import { findVerifiedEnvironmentAsset, environmentAssetPlacementPlan } from './terrainEnvironmentAssetRegistry.js';
import { selectRockEnvironmentAsset } from './terrainEnvironmentRockAssetCatalog.js';
import { scoreEnvironmentAssetGeography } from './terrainEnvironmentAssetGeographyMatrix.js';
import { auditEnvironmentObject } from './terrainEnvironmentSceneBridge.js';
import { shouldCullEnvironment, resolveEnvironmentLod } from './terrainEnvironmentLodPolicy.js';
import { deterministicSpatialOrdinal } from './terrainEnvironmentSpatialPolicy.js';
import { climateMaterialResponse, climateMaterialFamily, seasonalAssetWeights } from './terrainEnvironmentClimateTransitions.js';

const freeze = (value) => Object.freeze(value);
const norm = (value) => String(value ?? '').trim().replaceAll('\\', '/').toLowerCase();
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));

export const TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY = freeze({
  id: 'terrain-environment-runtime-integration-2026-09-08-v2',
  authoredOnly: true,
  runtimeGeometryCreation: false,
  runtimeGeometryReplacement: false,
  runtimeMovement: false,
  terrainMutation: false,
  hydrologyMutation: false,
  colliderMutation: false,
  materialAuthority: 'src/3d/materials/MaterialAssignmentCore.js',
  placementAuthority: 'src/3d/world/WorldAssetPlacementPipeline.js',
  terrainAuthority: 'src/3d/world/terrain.js',
  allowedPhases: freeze(['resolve', 'validate', 'attach-request', 'audit']),
  forbiddenPhases: freeze(['invent', 'clone', 'replace', 'move', 'scatter-uniformly']),
  requireSourceVerification: true,
  requireGeographyAcceptance: true,
  requireMaterialAcceptance: true,
  requireGroundAcceptance: true,
  requireContractAcceptance: true,
});

function worldFingerprint({ x = 0, y = 0, z = 0, category = '', assetId = '' } = {}) {
  const text = `${norm(category)}|${norm(assetId)}|${finite(x).toFixed(2)}|${finite(y).toFixed(2)}|${finite(z).toFixed(2)}`;
  let hash = 2166136261;
  for (const ch of text) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function phaseAllowed(phase) { return TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.allowedPhases.includes(norm(phase)); }

function deriveAssetRequest({ category, asset = null, sample = {}, season = '' }) {
  let selected = asset ? findVerifiedEnvironmentAsset(asset.src ?? asset.id) : null;
  if (!selected && ['rock', 'cliff', 'scree'].includes(norm(category))) selected = selectRockEnvironmentAsset({ category, sample, season })?.asset ?? null;
  return selected;
}

function buildSampleContext(sample = {}) {
  return freeze({
    biome: norm(sample.biome), climate: norm(sample.climate), season: norm(sample.season), slopeDegrees: finite(sample.slopeDegrees), moisture: clamp01(sample.moisture), heightAboveSeaMeters: finite(sample.heightAboveSeaMeters), settlementDistanceMeters: finite(sample.settlementDistanceMeters, Infinity), roadDistanceMeters: finite(sample.roadDistanceMeters, Infinity), shorelineDistanceMeters: finite(sample.shorelineDistanceMeters, Infinity), snowDepthMeters: Math.max(0, finite(sample.snowDepthMeters)), windExposure: clamp01(sample.windExposure), rockExposure: clamp01(sample.rockExposure), talusWeight: clamp01(sample.talusWeight),
  });
}

function runtimeLod(category, distanceMeters = 0, mobile = false) { return resolveEnvironmentLod(category, { distanceMeters: Math.max(0, finite(distanceMeters)), mobile }); }
function runtimeCull(category, { distanceMeters = 0, mobile = false, visible = true } = {}) { return shouldCullEnvironment(category, { distanceMeters: Math.max(0, finite(distanceMeters)), mobile, visible }); }
function sourceHealth(asset) { if (!asset) return freeze({ ok: false, score: 0, reason: 'missing-source' }); const verified = findVerifiedEnvironmentAsset(asset.src ?? asset.id); return verified ? freeze({ ok: true, score: 1, reason: 'verified-authored-source', src: verified.src }) : freeze({ ok: false, score: 0, reason: 'unverified-source' }); }
function geographyHealth(category, asset, sample, season) {
  if (!asset) return freeze({ ok: false, score: 0, reason: 'missing-asset' });
  try { const result = scoreEnvironmentAssetGeography(asset, { category, sample, season }); return freeze({ ok: Boolean(result?.accepted ?? result?.ok), score: finite(result?.score, 0), reason: result?.reason ?? null, detail: result }); }
  catch (error) { return freeze({ ok: false, score: 0, reason: `geography-error:${error?.message ?? 'unknown'}` }); }
}
function contractHealth() {
  try { const result = validateTerrainEnvironmentContract(); return freeze({ ok: result?.ok !== false, result }); }
  catch (error) { return freeze({ ok: false, error: error?.message ?? String(error) }); }
}
function seasonalResponse(sample, season, category) {
  const payload = { biome: sample.biome || 'temperate', season: season || 'spring', category, moisture: sample.moisture, temperatureC: finite(sample.temperatureC, 12), exposure: finite(sample.windExposure, 0.5), rockWeight: sample.rockExposure, snowWeight: sample.snowDepthMeters > 0 ? clamp01(sample.snowDepthMeters / 0.75) : 0 };
  const material = climateMaterialResponse(payload);
  const family = climateMaterialFamily(category, { ...payload, biome: payload.biome, moisture: payload.moisture, elevationMeters: sample.heightAboveSeaMeters, slopeDegrees: sample.slopeDegrees, temperatureC: payload.temperatureC });
  const seasonalWeights = seasonalAssetWeights(payload);
  return freeze({ family, material, seasonalWeights });
}

export function resolveTerrainEnvironmentRuntimeRequest({ category, asset = null, sample = {}, season = '', worldX = 0, worldY = 0, worldZ = 0, distanceMeters = 0, mobile = false, visible = true } = {}) {
  const key = norm(category);
  const normalizedSample = buildSampleContext({ ...sample, season: season || sample.season });
  const selectedAsset = deriveAssetRequest({ category: key, asset, sample: normalizedSample, season: season || normalizedSample.season });
  const source = sourceHealth(selectedAsset);
  const geography = geographyHealth(key, selectedAsset, normalizedSample, season || normalizedSample.season);
  const lod = runtimeLod(key, distanceMeters, mobile);
  const cull = runtimeCull(key, { distanceMeters, mobile, visible });
  const seasonal = seasonalResponse(normalizedSample, season || normalizedSample.season, key);
  const spatialOrdinal = deterministicSpatialOrdinal(key, worldX, worldZ);
  const fingerprint = worldFingerprint({ x: worldX, y: worldY, z: worldZ, category: key, assetId: selectedAsset?.id });
  return freeze({ policyId: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id, category: key, asset: selectedAsset, source, geography, lod, cull, seasonal, sample: normalizedSample, spatialOrdinal, fingerprint, phase: 'resolve', accepted: Boolean(selectedAsset && source.ok && geography.ok && !cull), mutations: freeze({ geometry: false, movement: false, terrain: false, hydrology: false, collider: false }) });
}

export function validateTerrainEnvironmentRuntimeRequest(request, { requireVisible = true } = {}) {
  const errors = [];
  if (!phaseAllowed('validate')) errors.push('validate-phase-forbidden');
  if (!request?.category) errors.push('missing-category');
  if (!request?.asset) errors.push('missing-authored-asset');
  if (!request?.source?.ok) errors.push(request?.source?.reason ?? 'source-not-verified');
  if (!request?.geography?.ok) errors.push(request?.geography?.reason ?? 'geography-rejected');
  if (requireVisible && request?.cull) errors.push('runtime-cull-active');
  if (request?.mutations?.geometry !== false) errors.push('geometry-mutation-requested');
  if (request?.mutations?.movement !== false) errors.push('movement-mutation-requested');
  if (request?.mutations?.terrain !== false) errors.push('terrain-mutation-requested');
  if (request?.mutations?.hydrology !== false) errors.push('hydrology-mutation-requested');
  if (request?.mutations?.collider !== false) errors.push('collider-mutation-requested');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), policyId: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id });
}

export function buildTerrainEnvironmentAttachRequest({ request, runtimeContext = {} } = {}) {
  const validation = validateTerrainEnvironmentRuntimeRequest(request);
  const assetPlan = request?.asset ? environmentAssetPlacementPlan(request.asset, { category: request.category, sample: request.sample, worldX: runtimeContext.worldX ?? 0, worldZ: runtimeContext.worldZ ?? 0 }) : null;
  const contract = contractHealth();
  return freeze({ policyId: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id, phase: 'attach-request', accepted: Boolean(validation.ok && contract.ok && assetPlan?.validation?.ok), validation, contract, assetPlan, source: request?.asset?.src ?? null, category: request?.category, world: freeze({ x: finite(runtimeContext.worldX), y: finite(runtimeContext.worldY), z: finite(runtimeContext.worldZ) }), runtimeContext: freeze({ ...runtimeContext, geometryOwner: 'WorldAssetPlacementPipeline', materialOwner: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.materialAuthority }), forbiddenActions: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.forbiddenPhases });
}

export function auditTerrainEnvironmentRuntimeObject(object, options = {}) {
  let sceneAudit;
  try { sceneAudit = auditEnvironmentObject(object, options); } catch (error) { sceneAudit = { ok: false, error: error?.message ?? String(error) }; }
  const objectUserData = object?.userData ?? {};
  return freeze({ policyId: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id, phase: 'audit', ok: Boolean(sceneAudit?.ok), sceneAudit, bridge: objectUserData.terrainEnvironmentBridge ?? null, geometryState: freeze({ objectId: object?.uuid ?? null, position: freeze({ x: finite(object?.position?.x), y: finite(object?.position?.y), z: finite(object?.position?.z) }), scale: freeze({ x: finite(object?.scale?.x, 1), y: finite(object?.scale?.y, 1), z: finite(object?.scale?.z, 1) }), hasGeometry: Boolean(object?.isMesh && object?.geometry) }), mutations: freeze({ moved: false, replaced: false, cloned: false }) });
}

export function buildRuntimeEnvironmentBatch(requests = [], options = {}) {
  const input = Array.isArray(requests) ? requests : [];
  const resolved = input.map((request) => request?.policyId === TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id ? request : resolveTerrainEnvironmentRuntimeRequest({ ...request, mobile: options.mobile ?? request.mobile }));
  const accepted = resolved.filter((item) => item.accepted), rejected = resolved.filter((item) => !item.accepted), byCategory = {};
  for (const item of resolved) { byCategory[item.category] = byCategory[item.category] ?? { accepted: 0, rejected: 0, count: 0 }; byCategory[item.category].count += 1; byCategory[item.category][item.accepted ? 'accepted' : 'rejected'] += 1; }
  return freeze({ policyId: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id, count: resolved.length, acceptedCount: accepted.length, rejectedCount: rejected.length, accepted: freeze(accepted), rejected: freeze(rejected), byCategory: freeze(Object.fromEntries(Object.entries(byCategory).map(([key, value]) => [key, freeze(value)]))), deterministicFingerprints: freeze(resolved.map((item) => item.fingerprint)), policyBoundaries: freeze({ authoredOnly: true, noGeometryCreation: true, noUniformGrid: true }) });
}

export function buildTerrainEnvironmentIntegrationReport({ requests = [], runtimeObjects = [], options = {} } = {}) {
  const batch = buildRuntimeEnvironmentBatch(requests, options);
  const audits = (Array.isArray(runtimeObjects) ? runtimeObjects : []).map((object) => auditTerrainEnvironmentRuntimeObject(object, options));
  const auditFailures = audits.filter((audit) => !audit.ok);
  return freeze({ policyId: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id, accepted: batch.rejectedCount === 0 && auditFailures.length === 0, batch, audits: freeze(audits), auditFailureCount: auditFailures.length, authority: freeze({ terrain: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.terrainAuthority, material: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.materialAuthority, placement: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.placementAuthority }) });
}

export function assertTerrainEnvironmentRuntimeRequestReady(request) { const validation = validateTerrainEnvironmentRuntimeRequest(request); if (!validation.ok) throw new Error(`Terrain environment runtime request rejected: ${validation.errors.join(', ')}`); return true; }
export function runtimePolicySummary() { return freeze({ id: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.id, authoredOnly: true, noProceduralReplacement: true, noRuntimeMovement: true, noTerrainMutation: true, noHydrologyMutation: true, noColliderMutation: true, allowedPhases: TERRAIN_ENVIRONMENT_RUNTIME_INTEGRATION_POLICY.allowedPhases }); }
export function createRuntimeRequestMatrix(categories = ['tree', 'grass', 'rock', 'cliff', 'scree']) {
  const rows = [];
  for (const category of categories) { const request = resolveTerrainEnvironmentRuntimeRequest({ category, sample: { biome: category === 'rock' || category === 'cliff' || category === 'scree' ? 'highland' : 'forest', climate: 'temperate', slopeDegrees: category === 'rock' || category === 'cliff' || category === 'scree' ? 24 : 12, moisture: 0.52, heightAboveSeaMeters: 85 }, season: 'spring', worldX: rows.length * 37, worldY: 0, worldZ: rows.length * -29, distanceMeters: 32 }); rows.push(freeze({ category, accepted: request.accepted, source: request.source.reason, fingerprint: request.fingerprint, lod: request.lod?.id ?? request.lod?.tier ?? null })); }
  return freeze(rows);
}
