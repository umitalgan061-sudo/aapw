/**
 * V63 diagnostics layer: converts runtime signals into production-safe actions.
 * It intentionally stays advisory/read-only; scene mutation and canonical owners
 * remain with existing callers and shared #590 placement infrastructure.
 */
import {
  V63_CONTRACT,
  createGroundedVisualRuntimeV63,
  createStreamingPlanV63,
  createHabitatDensityV63,
  createNaturalTransformV63,
  createWaterOpticalResponseV63,
  createShorelineBandProfileV63,
  createParityDiagnosticsV63,
} from './environmentGroundedVisualRuntimeV63.js';

const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const text = (v, fallback) => typeof v === 'string' && v.trim() ? v.trim() : fallback;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function hash(value) {
  let h = 2166136261;
  const source = String(value);
  for (let index = 0; index < source.length; index += 1) {
    h ^= source.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function classifyP0FailureV63(plan) {
  const failures = [];
  if (plan?.p0?.seam) failures.push('seam');
  if (plan?.p0?.rectangularWater) failures.push('rectangular-water');
  if (plan?.p0?.moire) failures.push('water-moire');
  if (plan?.p0?.cyan) failures.push('cyan-overlay');
  return freeze(failures);
}

export function classifyP1FailureV63(plan) {
  const failures = [];
  if (plan?.geometry?.cliffWall) failures.push('smooth-cliff-wall');
  if (plan?.geometry?.flatRelief) failures.push('flat-relief');
  if (plan?.geometry?.snowSheet) failures.push('snow-sheet');
  if (!plan?.geometry?.parityPass) failures.push('canonical-rendered-collider-parity');
  return freeze(failures);
}

export function classifyP2FailureV63(plan) {
  const failures = [];
  if (plan?.risks?.P2?.missingMaterial) failures.push('missing-material');
  if (plan?.risks?.P2?.placeholder) failures.push('placeholder-material');
  if (plan?.risks?.P2?.materialMismatch) failures.push('single-surface-mismatch');
  if (plan?.risks?.P2?.macroMicroWeak) failures.push('weak-breakup');
  return freeze(failures);
}

export function classifyP3FailureV63(plan) {
  const failures = [];
  if (plan?.risks?.P3?.floatingPlacement) failures.push('floating-vegetation');
  if (plan?.risks?.P3?.invalidPlacement) failures.push('invalid-vegetation-placement');
  if (plan?.vegetation?.batches?.some((batch) => batch.count > V63_CONTRACT.thresholds.maxInstancesPerBatch)) failures.push('instance-batch-cap');
  return freeze(failures);
}

export function classifyP4FailureV63(plan) {
  const failures = [];
  if (plan?.water?.rectangularRisk) failures.push('rectangular-water');
  if (plan?.water?.shorelineIntegrity === false && plan?.water?.recognized) failures.push('shoreline-integrity');
  if (plan?.water?.moireSuppression > 0.5) failures.push('water-moire');
  if (plan?.water?.cyanSuppression > 0.5) failures.push('cyan-water');
  return freeze(failures);
}

export function classifyP5FailureV63(plan) {
  const failures = [];
  if (plan?.risks?.P5?.blackSky) failures.push('black-sky');
  if (plan?.risks?.P5?.unreadableBackground) failures.push('unreadable-background');
  if (plan?.atmosphere?.fogDensity <= 0) failures.push('missing-fog');
  return freeze(failures);
}

export function createFailurePriorityV63(plan) {
  const failures = Object.freeze({
    P0: classifyP0FailureV63(plan),
    P1: classifyP1FailureV63(plan),
    P2: classifyP2FailureV63(plan),
    P3: classifyP3FailureV63(plan),
    P4: classifyP4FailureV63(plan),
    P5: classifyP5FailureV63(plan),
  });
  const ordered = [];
  for (const p of ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']) for (const failure of failures[p]) ordered.push(`${p}:${failure}`);
  return freeze({ failures, ordered: freeze(ordered), topPriority: ordered[0] || null });
}

export function createRuntimeActionPlanV63(observation) {
  const plan = createGroundedVisualRuntimeV63(observation);
  const priority = createFailurePriorityV63(plan);
  const actions = [];
  if (priority.failures.P0.length) actions.push('fix-render-adoption-before-material-polish');
  if (priority.failures.P1.length) actions.push('preserve-canonical-height-and-improve-relief-breakup');
  if (priority.failures.P2.length) actions.push('increase-context-aware-pbr-breakup');
  if (priority.failures.P3.length) actions.push('reject-invalid-placement-and-use-instanced-lod');
  if (priority.failures.P4.length) actions.push('blend-shoreline-and-suppress-water-artifacts');
  if (priority.failures.P5.length) actions.push('restore-camera-relative-atmosphere-readability');
  if (!actions.length) actions.push('retain-clean-runtime-plan');
  return freeze({
    contract: V63_CONTRACT.id,
    sampleId: plan.sampleId,
    priority,
    actions: freeze(actions),
    mergeEligible: plan.acceptance.mergeEligible,
    riskScore: plan.riskScore,
    fingerprint: plan.fingerprint,
  });
}

export function createMaterialActionPlanV63({ terrain = {}, material = {}, camera = {} } = {}) {
  const slope = Math.min(90, Math.max(0, finite(terrain.slope)));
  const moisture = clamp01(terrain.moisture);
  const elevation = clamp01(terrain.elevation01);
  const roughness = clamp01(terrain.roughness ?? material.roughness ?? 0.7);
  const near = finite(camera.distance, 500) < 500;
  const rockExposure = clamp01((slope - 28) / 42);
  const snowline = clamp01((elevation - 0.66) / 0.34);
  return freeze({
    primaryLayer: slope > 55 ? 'rock' : moisture > 0.75 ? 'wet' : snowline > 0.6 ? 'snow' : terrain.surface || 'grass',
    secondaryLayer: rockExposure > 0.35 ? 'scree' : moisture > 0.55 ? 'soil' : 'grass',
    macroContrast: clamp01(0.45 + roughness * 0.5),
    microDetail: clamp01(0.42 + roughness * 0.46 + (near ? 0.12 : 0)),
    normalEnergy: clamp01(0.35 + roughness * 0.55 + (slope / 160)),
    antiTiling: true,
    triplanar: slope > 42 || near,
    snowlineTransition: snowline,
    rockExposure,
  });
}

export function createVegetationActionPlanV63({ biome = 'temperate', slope = 10, moisture = 0.5, elevation01 = 0.5, waterDistance = 100, roadDistance = 100, settlementDistance = 100 } = {}) {
  const habitat = createHabitatDensityV63({ biome, slope, moisture, elevation01, waterDistance, roadDistance, settlementDistance });
  const plantCategories = biome === 'forest' || biome === 'taiga'
    ? ['tree', 'shrub', 'grass']
    : biome === 'alpine' || biome === 'tundra'
      ? ['shrub', 'grass', 'ground-detail']
      : biome === 'desert'
        ? ['shrub', 'ground-detail']
        : ['tree', 'shrub', 'grass', 'ground-detail'];
  return freeze({
    density: habitat.density,
    clearingRadius: habitat.clearingRadius,
    categories: freeze(plantCategories),
    useClusteredDistribution: habitat.density > 0.42,
    useSparseDistribution: habitat.density <= 0.42,
    preferInstances: habitat.density > 0.25,
    groundDetail: habitat.groundDetail,
  });
}

export function createWaterActionPlanV63({ waterClass = 'sea', depth = 5, distance = 4, wetEdge = 0.7, foam = 0.2, cyanRisk = 0.1, moireRisk = 0 } = {}) {
  const optical = createWaterOpticalResponseV63({ waterClass, depth, distance, wetEdge, foam, cyanRisk, moireRisk });
  const shore = createShorelineBandProfileV63({ waterClass, distance, depth, wetEdge, foam });
  return freeze({
    recognized: optical.recognized,
    blend: freeze({ deep: optical.deep, shallow: optical.shallow, shore: optical.shoreBand }),
    antiMoiré: optical.moireSuppression,
    cyanSuppression: optical.cyanSuppression,
    shorelineBands: shore.bands,
    antiHalo: shore.antiHalo ?? 0,
    requiresCoverageRebuild: !optical.recognized,
  });
}

export function createPerformanceActionPlanV63(options = {}) {
  const plan = createStreamingPlanV63(options);
  return freeze({
    lodBand: plan.lodBand,
    overBudget: plan.overBudget,
    chunkCulling: plan.chunkCulling,
    frustumCulling: plan.frustumCulling,
    actions: freeze(plan.actions),
    budgets: freeze({ vegetationInstances: plan.maxVegetationInstances, textureMemoryMb: plan.maxTextureMemoryMb }),
  });
}

export function createGroundingActionPlanV63(options = {}) {
  const parity = createParityDiagnosticsV63(options);
  const grounded = finite(options.groundConfidence, 1) >= V63_CONTRACT.thresholds.minGroundConfidence && options.grounded === true;
  return freeze({
    grounded,
    parityPass: parity.sameCoordinate,
    acceptSceneAttach: grounded && parity.sameCoordinate,
    snapRequired: grounded && !parity.sameCoordinate,
    lateralErrorMeters: Math.max(parity.visualPlanDelta, parity.colliderPlanDelta),
  });
}

export function createEnvironmentDoctorReportV63(observation) {
  const plan = createGroundedVisualRuntimeV63(observation);
  const actions = createRuntimeActionPlanV63(observation);
  const material = createMaterialActionPlanV63({ terrain: plan.input.terrain, material: plan.input.material, camera: plan.input.camera });
  const habitat = createVegetationActionPlanV63({ biome: plan.input.terrain.biome, slope: plan.input.terrain.slope, moisture: plan.input.terrain.moisture, elevation01: plan.input.terrain.elevation01, waterDistance: plan.input.water.distance, roadDistance: 100, settlementDistance: 100 });
  const water = createWaterActionPlanV63({ waterClass: plan.input.water.class, depth: plan.input.water.depth, distance: plan.input.water.distance, wetEdge: plan.input.water.wetEdge, foam: plan.input.water.foam, cyanRisk: plan.input.water.cyanRisk, moireRisk: plan.input.water.moireRisk });
  const performance = createPerformanceActionPlanV63({ cameraDistance: plan.input.camera.distance, visibleChunks: 16, residentChunks: 20, vegetationInstances: plan.vegetation.eligible, textureMemoryMb: 320, mobile: false });
  return freeze({
    contract: V63_CONTRACT.id,
    sampleId: plan.sampleId,
    priority: actions.priority,
    actionPlan: actions,
    material,
    habitat,
    water,
    performance,
    mergeEligible: plan.acceptance.mergeEligible,
    fingerprint: hash(`${plan.fingerprint}:${actions.priority.topPriority || 'clean'}:${material.primaryLayer}:${water.cyanSuppression}:${performance.overBudget}`),
  });
}
