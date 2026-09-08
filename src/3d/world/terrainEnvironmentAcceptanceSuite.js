/**
 * Environment acceptance suite.
 *
 * A compact, deterministic qualification layer for geography, authored sources, material
 * readiness, seasonality and runtime boundaries. It returns reports; it does not mutate the scene.
 */

import { TERRAIN_ENVIRONMENT_CONTRACT, validateTerrainEnvironmentContract, buildTerrainEnvironmentProductionPlan } from './terrainEnvironmentContract.js';
import { validateRockAssetCoverage, rankRockEnvironmentAssets } from './terrainEnvironmentRockAssetCatalog.js';
import { geologyCoverageReport, geologyResponseAtWorld } from './terrainEnvironmentGeologyResponse.js';
import { seasonalGeographyCoverage, seasonalEnvironmentResponse } from './terrainEnvironmentSeasonalGeography.js';
import { buildRuntimeEnvironmentBatch, resolveTerrainEnvironmentRuntimeRequest, validateTerrainEnvironmentRuntimeRequest } from './terrainEnvironmentRuntimeIntegration.js';
import { sourceCoverageSummary, validateSourceRequest } from './terrainEnvironmentAssetSourceAdapter.js';
import { validateVerifiedEnvironmentAsset, registrySummary, VERIFIED_ENVIRONMENT_ASSETS } from './terrainEnvironmentAssetRegistry.js';
import { buildEnvironmentMaterialManifest, validateEnvironmentMaterialManifest } from './terrainEnvironmentMaterialDirector.js';
import { TERRAIN_ENVIRONMENT_PROFILE_POLICY, resolveTerrainEnvironmentProfile } from './terrainEnvironmentProfiles.js';

const freeze = (v) => Object.freeze(v);
const norm = (v) => String(v ?? '').trim().toLowerCase();
const finite = (v, f = 0) => Number.isFinite(v) ? v : f;

export const TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY = freeze({
  id: 'terrain-environment-acceptance-suite-2026-09-08-v1',
  deterministic: true,
  mutationFree: true,
  authoredOnly: true,
  noPlaceholder: true,
  noProceduralReplacement: true,
  noTerrainMutation: true,
  noHydrologyMutation: true,
  noColliderMutation: true,
  requiredContractId: TERRAIN_ENVIRONMENT_CONTRACT.id,
  requiredMaterialAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,
  minimumRegistryAssets: 12,
  requiredGeologyCategories: freeze(['rock', 'cliff', 'scree']),
  requiredSeasons: freeze(['spring', 'summer', 'autumn', 'winter']),
});

const canonicalSamples = freeze([
  { name: 'temperate-forest-floor', category: 'tree', biome: 'forest', climate: 'temperate', season: 'spring', slopeDegrees: 11, moisture: 0.62, heightAboveSeaMeters: 80, rockExposure: 0.12, talusWeight: 0.08 },
  { name: 'forest-edge-outcrop', category: 'rock', biome: 'forest-edge', climate: 'temperate', season: 'autumn', slopeDegrees: 27, moisture: 0.42, heightAboveSeaMeters: 210, rockExposure: 0.72, talusWeight: 0.45 },
  { name: 'highland-cliff', category: 'cliff', biome: 'alpine-bare', climate: 'temperate', season: 'winter', slopeDegrees: 48, moisture: 0.22, heightAboveSeaMeters: 980, rockExposure: 0.90, talusWeight: 0.76, windExposure: 0.82, snowDepthMeters: 0.72 },
  { name: 'dryland-scree', category: 'scree', biome: 'dryland', climate: 'dryland', season: 'summer', slopeDegrees: 31, moisture: 0.10, heightAboveSeaMeters: 320, rockExposure: 0.81, talusWeight: 0.86 },
  { name: 'tundra-deadwood', category: 'dead-tree', biome: 'tundra', climate: 'tundra', season: 'winter', slopeDegrees: 9, moisture: 0.54, heightAboveSeaMeters: 1040, rockExposure: 0.38, talusWeight: 0.18, windExposure: 0.72, snowDepthMeters: 0.92 },
]);

function safeCall(label, fn) {
  try {
    return freeze({ label, ok: true, result: fn() });
  } catch (error) {
    return freeze({ label, ok: false, error: error?.message ?? String(error) });
  }
}

export function runContractQualification() {
  const result = safeCall('contract-validation', () => validateTerrainEnvironmentContract());
  return freeze({
    ...result,
    expectedContractId: TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY.requiredContractId,
    observedContractId: TERRAIN_ENVIRONMENT_CONTRACT.id,
    exactId: TERRAIN_ENVIRONMENT_CONTRACT.id === TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY.requiredContractId,
  });
}

export function runRegistryQualification() {
  const summary = registrySummary();
  const errors = [];
  if (summary.total < TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY.minimumRegistryAssets) errors.push(`registry-too-small:${summary.total}`);
  for (const asset of VERIFIED_ENVIRONMENT_ASSETS) {
    const validation = validateVerifiedEnvironmentAsset(asset, { category: asset.family });
    if (!validation.ok) errors.push(`registry-invalid:${asset.id}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), summary });
}

export function runSourceQualification() {
  const coverage = sourceCoverageSummary();
  const errors = [...coverage.missing];
  for (const sample of canonicalSamples) {
    const result = validateSourceRequest({ category: sample.category, sample });
    if (!result.ok) errors.push(`source-request:${sample.category}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze([...new Set(errors)]), coverage });
}

export function runGeologyQualification() {
  const coverage = validateRockAssetCoverage();
  const responseCoverage = geologyCoverageReport();
  const errors = [...coverage.errors, ...responseCoverage.missing.map((value) => `geology:${value}`)];
  const probes = canonicalSamples.filter((sample) => ['rock', 'cliff', 'scree'].includes(sample.category)).map((sample) => {
    const response = geologyResponseAtWorld({ worldX: sample.heightAboveSeaMeters * 0.71, worldZ: sample.slopeDegrees * -13.2, sample });
    const ranked = rankRockEnvironmentAssets({ category: sample.category, sample });
    return freeze({ sample: sample.name, geographyClass: response.geographyClass, density: response.density, selected: ranked[0]?.asset?.id ?? null, selectedScore: ranked[0]?.score ?? 0 });
  });
  return freeze({ ok: errors.length === 0, errors: freeze(errors), coverage, responseCoverage, probes: freeze(probes) });
}

export function runSeasonQualification() {
  const coverage = seasonalGeographyCoverage();
  const errors = [...coverage.missing];
  const probes = [];
  for (const category of ['tree', 'rock', 'cliff', 'scree', 'dead-tree']) {
    for (const season of TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY.requiredSeasons) {
      const sample = { biome: ['rock', 'cliff', 'scree'].includes(category) ? 'highland' : category === 'dead-tree' ? 'tundra' : 'forest', climate: category === 'dead-tree' ? 'tundra' : 'temperate', slopeDegrees: ['rock', 'cliff', 'scree'].includes(category) ? 28 : 12, moisture: 0.5, heightAboveSeaMeters: category === 'dead-tree' ? 900 : 120 };
      const response = seasonalEnvironmentResponse({ category, season, ...sample });
      if (!response.selectedAsset) errors.push(`seasonal-selection:${category}:${season}`);
      probes.push(freeze({ category, season, selected: response.selectedAsset?.id ?? null, factor: response.envelope.seasonalFactor, snow: response.envelope.snow, materialFamily: response.materialFamily ?? null }));
    }
  }
  return freeze({ ok: errors.length === 0, errors: freeze([...new Set(errors)]), coverage, probes: freeze(probes) });
}

export function runMaterialQualification() {
  const manifest = buildEnvironmentMaterialManifest();
  const validation = validateEnvironmentMaterialManifest(manifest);
  return freeze({ ok: Boolean(validation.ok), errors: freeze(validation.errors ?? []), validation, manifestSummary: freeze({ count: manifest?.assets?.length ?? manifest?.entries?.length ?? 0, policyId: manifest?.policyId ?? null }) });
}

export function runRuntimeQualification() {
  const requests = canonicalSamples.map((sample, index) => resolveTerrainEnvironmentRuntimeRequest({
    category: sample.category,
    sample,
    season: sample.season,
    worldX: index * 93 - 186,
    worldY: sample.heightAboveSeaMeters,
    worldZ: index * -47 + 61,
    distanceMeters: 22 + index * 13,
    mobile: index % 2 === 1,
  }));
  const batch = buildRuntimeEnvironmentBatch(requests);
  const validations = requests.map((request) => validateTerrainEnvironmentRuntimeRequest(request));
  const errors = validations.flatMap((result) => result.ok ? [] : result.errors);
  return freeze({ ok: errors.length === 0, errors: freeze([...new Set(errors)]), batch, validations: freeze(validations) });
}

export function runProductionPlanQualification() {
  const errors = [];
  const plans = canonicalSamples.map((sample, index) => {
    const asset = VERIFIED_ENVIRONMENT_ASSETS.find((candidate) => candidate.family === sample.category) ?? VERIFIED_ENVIRONMENT_ASSETS[0];
    const options = { category: sample.category, asset, sample, season: sample.season, worldX: index * 71, worldZ: index * -43 };
    try {
      const plan = buildTerrainEnvironmentProductionPlan(options);
      if (!plan) errors.push(`missing-plan:${sample.category}`);
      return freeze({ sample: sample.name, ok: Boolean(plan), contextOk: Boolean(plan?.context?.ok), attachReady: Boolean(plan?.attachReady) });
    } catch (error) {
      errors.push(`plan-error:${sample.category}:${error?.message ?? 'unknown'}`);
      return freeze({ sample: sample.name, ok: false, error: error?.message ?? String(error) });
    }
  });
  return freeze({ ok: errors.length === 0, errors: freeze(errors), plans: freeze(plans) });
}

export function runMutationBoundaryQualification() {
  const policy = TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY;
  const errors = [];
  if (!policy.mutationFree) errors.push('acceptance-mutation-policy-disabled');
  if (policy.noTerrainMutation !== true) errors.push('terrain-mutation-boundary-open');
  if (policy.noHydrologyMutation !== true) errors.push('hydrology-mutation-boundary-open');
  if (policy.noColliderMutation !== true) errors.push('collider-mutation-boundary-open');
  if (policy.noProceduralReplacement !== true) errors.push('procedural-replacement-boundary-open');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), boundaries: freeze({ terrain: policy.noTerrainMutation, hydrology: policy.noHydrologyMutation, collider: policy.noColliderMutation, replacement: policy.noProceduralReplacement }) });
}

export function runEnvironmentAcceptanceSuite() {
  const sections = [
    runContractQualification(),
    runRegistryQualification(),
    runSourceQualification(),
    runGeologyQualification(),
    runSeasonQualification(),
    runMaterialQualification(),
    runRuntimeQualification(),
    runProductionPlanQualification(),
    runMutationBoundaryQualification(),
  ];
  const errors = sections.flatMap((section) => section.ok ? [] : section.errors ?? [section.error ?? section.label ?? 'unknown-failure']);
  return freeze({
    policyId: TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY.id,
    ok: errors.length === 0,
    errorCount: errors.length,
    errors: freeze([...new Set(errors)]),
    sectionCount: sections.length,
    sections: freeze(sections),
    deterministic: true,
    mutationFree: true,
  });
}

export function acceptanceSummary() {
  const report = runEnvironmentAcceptanceSuite();
  return freeze({ policyId: report.policyId, ok: report.ok, errorCount: report.errorCount, sectionCount: report.sectionCount, errors: report.errors });
}

export function acceptanceMatrixForCategory(category) {
  const key = norm(category);
  const profile = resolveTerrainEnvironmentProfile(key);
  const rows = [];
  for (const biome of profile?.allowedBiomes ?? []) {
    for (const season of TERRAIN_ENVIRONMENT_ACCEPTANCE_POLICY.requiredSeasons) {
      const sample = { biome, climate: biome, slopeDegrees: key === 'rock' || key === 'cliff' || key === 'scree' ? 28 : 12, moisture: 0.5, heightAboveSeaMeters: 160 };
      const runtime = resolveTerrainEnvironmentRuntimeRequest({ category: key, sample, season, worldX: rows.length * 17, worldZ: rows.length * -11, distanceMeters: 32 });
      rows.push(freeze({ biome, season, accepted: runtime.accepted, asset: runtime.asset?.id ?? null, cull: runtime.cull, geography: runtime.geography?.score ?? 0 }));
    }
  }
  return freeze({ category: key, rows, accepted: rows.filter((row) => row.accepted).length, rejected: rows.filter((row) => !row.accepted).length });
}
