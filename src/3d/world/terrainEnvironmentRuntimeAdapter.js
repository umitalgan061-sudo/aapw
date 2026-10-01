import { planBiomeClusterSet, distributionAudit } from './terrainEnvironmentDistributionPlanner.js';

const freeze = (value) => Object.freeze(value);

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function normalizeRegion(region = {}) {
  return {
    centerX: finite(region.centerX),
    centerZ: finite(region.centerZ),
    radiusMeters: Math.max(1, finite(region.radiusMeters, 100)),
    count: Math.max(0, Math.floor(finite(region.count, 0))),
    context: { ...(region.context ?? {}) },
  };
}

/**
 * Runtime-facing, scene-agnostic adapter for the shipped environment planner.
 * It deliberately returns placement intent only; callers still own asset hydration,
 * MaterialAssignmentCore/WorldAssetPlacementPipeline, scene attach and disposal.
 */
export function buildEnvironmentRuntimePlan({
  regions = [],
  categories = ['tree', 'shrub', 'grass', 'rock', 'snowPatch'],
  seed = 0,
  distanceMeters = 0,
  visibility = 1,
} = {}) {
  const normalizedRegions = regions.map(normalizeRegion);
  const plans = categories.map((category) => {
    const plan = planBiomeClusterSet({
      regions: normalizedRegions.map((region) => ({
        ...region,
        context: { ...region.context, distanceMeters, visibility },
      })),
      category,
      seed: `${seed}:${category}`,
    });
    return freeze({
      category,
      plan,
      audit: distributionAudit(plan.clusters[0] ?? { points: [], acceptance: { uniformGrid: false } }),
    });
  });
  const total = plans.reduce((sum, item) => sum + item.plan.summary.total, 0);
  return freeze({
    version: 1,
    seed,
    regionCount: normalizedRegions.length,
    categories: freeze(plans),
    summary: freeze({ totalPlanned: total, categories: plans.length }),
    attachContract: freeze({
      hydrate: 'asset-hydrate-or-load',
      surfaceAnalysis: 'MaterialAssignmentCore',
      validation: 'validateMaterialAssignment',
      groundTransform: 'WorldAssetPlacementPipeline',
      manifest: 'createMaterialManifest',
      sceneAttach: 'WorldAssetPlacementPipeline',
    }),
  });
}

export function auditEnvironmentRuntimePlan(plan) {
  const errors = [];
  if (!plan || !Array.isArray(plan.categories)) errors.push('missing-plan');
  for (const category of plan?.categories ?? []) {
    if (!category.plan?.acceptance?.ok) errors.push(`${category.category}:plan-rejected`);
    if (!category.audit?.ok) errors.push(`${category.category}:audit-failed`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors) });
}
