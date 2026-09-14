/**
 * V64 acceptance/evidence helpers. This module is deliberately separate from
 * the runtime planner so shipped-scene callers can retain immutable evidence.
 */

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const round = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(finite(value) * factor) / factor;
};

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

export function createV64VisualQualityLedger(plan) {
  const targets = [
    ['P0.seam', plan?.p0?.seam],
    ['P0.rectangularWater', plan?.p0?.rectangularWater],
    ['P0.moire', plan?.p0?.moire],
    ['P0.cyan', plan?.p0?.cyan],
    ['P1.parity', plan?.p1?.parity?.pass === true ? 0 : 1],
    ['P1.cliffWall', plan?.p1?.geology?.cliffWall],
    ['P1.snowSheet', plan?.p1?.geology?.snowSheet],
    ['P2.placeholder', plan?.quality?.placeholder],
    ['P2.missingMaterial', plan?.quality?.missingMaterial],
    ['P3.invalidPlacement', plan?.p3?.rejectedCount],
    ['P4.waterRisk', plan?.p4?.water?.rectangularRisk ?? 0],
    ['P4.moireRisk', plan?.p4?.water?.stripeRisk ?? 0],
    ['P5.blackSky', plan?.p5?.blackSky],
  ];
  const breaches = targets.filter(([, value]) => finite(value) > 0).map(([id]) => id);
  return freeze({
    contract: plan?.contract ?? 'unknown',
    riskScore: round(plan?.riskScore),
    breaches: Object.freeze(breaches),
    pass: breaches.length === 0,
    targetCount: targets.length,
    cleanTargetCount: targets.length - breaches.length,
    fingerprint: hashString(JSON.stringify({ targets, riskScore: plan?.riskScore })),
  });
}

export function createV64CameraEvidence(profile, camera = {}) {
  const known = new Set(['full-world', 'far', 'terrain-near-center', 'terrain-near-northwest']);
  const width = finite(camera.width, 1536);
  const height = finite(camera.height, 1024);
  const orthographicDegrees = finite(camera.orthographicDegrees, 90);
  const valid = known.has(profile) && width === 1536 && height === 1024 && orthographicDegrees === 90;
  return freeze({
    profile: known.has(profile) ? profile : 'unknown',
    width,
    height,
    orthographicDegrees,
    deterministic: Boolean(camera.seed),
    valid,
    fingerprint: hashString(`${profile}|${width}|${height}|${orthographicDegrees}|${camera.seed ?? 'none'}`),
  });
}

export function createV64BeforeAfterEvidence(beforePlan, afterPlan) {
  const before = createV64VisualQualityLedger(beforePlan);
  const after = createV64VisualQualityLedger(afterPlan);
  const beforePbr = beforePlan?.p2?.pbr ?? {};
  const afterPbr = afterPlan?.p2?.pbr ?? {};
  const visualDetailDelta = round(
    (afterPbr.macroContrast ?? 0) + (afterPbr.microDetail ?? 0) -
    ((beforePbr.macroContrast ?? 0) + (beforePbr.microDetail ?? 0)),
  );
  return freeze({
    beforePass: before.pass,
    afterPass: after.pass,
    breachDelta: before.breaches.length - after.breaches.length,
    visualDetailDelta,
    cameraComparable: beforePlan?.sampleId === afterPlan?.sampleId ||
      JSON.stringify(beforePlan?.p5 ?? {}) === JSON.stringify(afterPlan?.p5 ?? {}),
    sameCoordinate: beforePlan?.sampleId === afterPlan?.sampleId,
    improved: after.breaches.length <= before.breaches.length && visualDetailDelta >= 0,
    fingerprint: hashString(`${before.fingerprint}|${after.fingerprint}|${visualDetailDelta}`),
  });
}

export function createV64PlacementManifest(plan) {
  const placement = plan?.p3?.dressing ?? [];
  return freeze({
    sequence: Object.freeze([
      'asset-hydrate-load',
      'surface-analysis',
      'multi-material-recipe',
      'validateMaterialAssignment',
      'ground-transform',
      'placement-manifest',
      'scene-attach',
    ]),
    owner: 'Buzul Muhafızı',
    sharedMaterialCore: 'src/3d/materials/MaterialAssignmentCore.js',
    sharedPlacementPipeline: 'src/3d/world/WorldAssetPlacementPipeline.js',
    mergedSuccessor: 590,
    count: placement.length,
    entries: Object.freeze(placement.map((item) => Object.freeze({
      assetId: item.assetId,
      category: item.category,
      family: item.family,
      pbrRole: item.pbrRole,
      instanceBatch: item.instanceBatch,
      groundedBy: 'caller-owned ground query',
      transform: item.transform,
    }))),
    editorRuntimeImported: false,
    geometryCreated: false,
  });
}

export function validateV64PlacementManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') errors.push('manifest-not-object');
  if (manifest?.editorRuntimeImported) errors.push('editor-runtime-import');
  if (manifest?.geometryCreated) errors.push('geometry-created');
  if (manifest?.sharedMaterialCore !== 'src/3d/materials/MaterialAssignmentCore.js') errors.push('wrong-material-core');
  if (manifest?.sharedPlacementPipeline !== 'src/3d/world/WorldAssetPlacementPipeline.js') errors.push('wrong-placement-pipeline');
  if (!Array.isArray(manifest?.entries)) errors.push('entries-missing');
  if (manifest?.count !== manifest?.entries?.length) errors.push('count-mismatch');
  return freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function createV64SceneEvidence(plan, { beforePlan = null } = {}) {
  const ledger = createV64VisualQualityLedger(plan);
  const camera = createV64CameraEvidence(plan?.p5?.cameraProfile ?? 'terrain-near-center', plan?.p5 ?? {});
  const manifest = createV64PlacementManifest(plan);
  const beforeAfter = beforePlan ? createV64BeforeAfterEvidence(beforePlan, plan) : null;
  return freeze({
    contract: plan?.contract ?? 'unknown',
    sampleId: plan?.sampleId ?? 'unknown',
    ledger,
    camera,
    placement: manifest,
    beforeAfter,
    acceptance: Object.freeze({
      targetVisibility: ledger.breaches.length === 0,
      parity: plan?.p1?.parity?.pass === true,
      grounded: (plan?.p3?.rejectedCount ?? 1) === 0,
      atmosphericReadability: plan?.p5?.blackSky === 0,
    }),
    fingerprint: hashString(JSON.stringify({ ledger, camera, manifest, beforeAfter })),
  });
}

export function createV64HydrologyMatrix(seed = 'v64-water') {
  const classes = ['sea', 'lake', 'river', 'land'];
  return freeze(classes.map((waterClass, index) => freeze({
    seed,
    sampleId: `${seed}-${waterClass}`,
    waterClass,
    depth: waterClass === 'land' ? 0 : 2 + index * 7,
    distance: waterClass === 'land' ? 240 : 2 + index * 4,
    shorelineWeight: waterClass === 'land' ? 0 : clamp01(1 - index * 0.17),
    requiresDeepShallowBlend: waterClass !== 'land',
    requiresWetEdge: waterClass !== 'land',
    requiresFoamGuard: waterClass !== 'land',
  })));
}

export function createV64BiomeMatrix() {
  const rows = [
    ['forest', 0.72, 0.38, 0.05],
    ['taiga', 0.58, 0.74, 0.18],
    ['wetland', 0.86, 0.22, 0.02],
    ['coastal', 0.5, 0.28, 0.04],
    ['steppe', 0.31, 0.34, 0],
    ['grassland', 0.4, 0.26, 0],
    ['alpine', 0.44, 0.9, 0.72],
    ['tundra', 0.5, 0.95, 0.84],
    ['desert', 0.08, 0.52, 0],
  ];
  return freeze(rows.map(([biome, moisture, elevation01, snowWeight]) => freeze({ biome, moisture, elevation01, snowWeight })));
}

export function createV64DeterminismRecord(first, second) {
  const firstFingerprint = first?.fingerprint ?? '';
  const secondFingerprint = second?.fingerprint ?? '';
  return freeze({
    equal: firstFingerprint === secondFingerprint,
    firstFingerprint,
    secondFingerprint,
    mismatch: firstFingerprint !== secondFingerprint ? 'fingerprint-mismatch' : null,
  });
}

export function summarizeV64(plan) {
  return freeze({
    contract: plan?.contract ?? 'unknown',
    sampleId: plan?.sampleId ?? 'unknown',
    qualityScore: round(1 - clamp01(plan?.riskScore)),
    p0Clean: (plan?.p0?.seam ?? 0) === 0 && (plan?.p0?.rectangularWater ?? 0) === 0 && (plan?.p0?.moire ?? 0) === 0,
    geologySignal: round((plan?.p1?.geology?.rockExposure ?? 0) + (plan?.p1?.geology?.talus ?? 0)),
    surfaceSignal: round((plan?.p2?.surfaces?.breakup ?? 0) + (plan?.p2?.pbr?.microDetail ?? 0)),
    habitatSignal: round(plan?.p3?.eligibleCount ?? 0),
    waterSignal: round((plan?.p4?.water?.wetEdge ?? 0) + (plan?.p4?.water?.shore ?? 0)),
    atmosphereReadable: plan?.p5?.blackSky === 0,
    fingerprint: plan?.fingerprint ?? 'none',
  });
}
