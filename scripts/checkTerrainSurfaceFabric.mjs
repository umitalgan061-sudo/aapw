import assert from 'node:assert/strict';
import {
  TERRAIN_SURFACE_FABRIC_POLICY,
  TERRAIN_SURFACE_FABRIC_CHANNELS,
  terrainSurfaceNoise,
  terrainSurfaceReliefContext,
  terrainSurfaceColorMultiplier,
  terrainSurfaceRoughness,
  terrainSurfaceNormalGain,
  chooseTerrainSubstrate,
  buildTerrainSurfaceManifest,
  validateTerrainSurfaceFabricPolicy,
} from '../src/3d/world/terrainSurfaceFabric.js';
import {
  TERRAIN_ENVIRONMENT_PROFILE_POLICY,
  TERRAIN_ENVIRONMENT_ASSET_PROFILES,
  resolveTerrainEnvironmentProfile,
  environmentSurfaceScore,
  validateTerrainEnvironmentPlacement,
  deterministicAssetTransform,
  makeEnvironmentAssetManifest,
} from '../src/3d/world/terrainEnvironmentProfiles.js';
import {
  ENVIRONMENT_ASSET_REGISTRY_POLICY,
  VERIFIED_VEGETATION_ASSETS,
  VERIFIED_PROP_ASSETS,
  findVerifiedEnvironmentAsset,
  selectVerifiedEnvironmentCandidates,
  environmentAssetRequirement,
  validateVerifiedEnvironmentAsset,
  environmentAssetPlacementPlan,
  deterministicEnvironmentSeed,
  registrySummary,
} from '../src/3d/world/terrainEnvironmentAssetRegistry.js';
import {
  TERRAIN_ENVIRONMENT_CONTRACT,
  analyzeTerrainSurfaceForEnvironment,
  prepareTerrainEnvironmentAssetContext,
  assertTerrainEnvironmentAttachReady,
  environmentContextForOtherOwners,
  validateTerrainEnvironmentContract,
} from '../src/3d/world/terrainEnvironmentContract.js';

const failures = [];
function check(label, fn) {
  try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); }
}
function approx(value, min, max, label) {
  assert.ok(Number.isFinite(value), `${label} is not finite`);
  assert.ok(value >= min && value <= max, `${label} ${value} outside [${min}, ${max}]`);
}
function finiteObject(object, label) {
  for (const [key, value] of Object.entries(object)) {
    assert.ok(Number.isFinite(value), `${label}.${key} is not finite`);
  }
}

check('policy is render-only and canonical-neutral', () => {
  const result = validateTerrainSurfaceFabricPolicy();
  assert.equal(result.ok, true, result.errors.join(','));
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.renderOnly, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHeightUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHydrologyUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalColliderUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalRoadsUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalSettlementsUnchanged, true);
  assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.periodicDetailTextureIsSupplemental, true);
});

check('world-space scales span macro to micro without a short repeat loop', () => {
  const scales = TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters;
  assert.equal(scales.length >= 5, true);
  for (let i = 1; i < scales.length; i += 1) assert.ok(scales[i] > scales[i - 1]);
  assert.ok(scales.at(-1) >= 3000);
  assert.ok(scales[0] >= 40);
});

check('all semantic surface channels are represented', () => {
  const expected = ['meadow', 'dampMoss', 'dryHeath', 'ferricEarth', 'granite', 'quartz', 'scree', 'snow', 'shoreline'];
  assert.deepEqual(Object.keys(TERRAIN_SURFACE_FABRIC_CHANNELS).sort(), [...expected].sort());
  for (const key of expected) {
    assert.ok(TERRAIN_SURFACE_FABRIC_CHANNELS[key].hueBias);
    assert.ok(TERRAIN_SURFACE_FABRIC_CHANNELS[key].roughness);
    approx(TERRAIN_SURFACE_FABRIC_CHANNELS[key].macro, 0, 1, `${key}.macro`);
  }
});

const samples = [
  { worldX: 0, worldZ: 0 },
  { worldX: 312.5, worldZ: -487.25 },
  { worldX: 1820, worldZ: 910 },
  { worldX: -3210, worldZ: 2240 },
  { worldX: 8192, worldZ: -7168 },
  { worldX: -14050, worldZ: -6200 },
  { worldX: 25000, worldZ: 14000 },
  { worldX: -28000, worldZ: 12000 },
];
for (const point of samples) {
  check(`noise deterministic ${point.worldX},${point.worldZ}`, () => {
    const first = terrainSurfaceNoise(point.worldX, point.worldZ);
    const second = terrainSurfaceNoise(point.worldX, point.worldZ);
    assert.deepEqual(first, second);
    for (const [key, value] of Object.entries(first)) approx(value, 0, 1, `noise.${key}`);
  });
}

const contexts = [
  {
    label: 'lowland meadow',
    args: { worldX: 240, worldZ: 180, heightAboveSeaMeters: 12, slopeDegrees: 2, concavityMeters: 0.5, rockWeight: 0.02, snowWeight: 0, waterWeight: 0 },
    expected: ['meadow', 'dampMoss', 'dryHeath', 'ferricEarth'],
  },
  {
    label: 'steep granite face',
    args: { worldX: 880, worldZ: -320, heightAboveSeaMeters: 260, slopeDegrees: 58, concavityMeters: 1.2, rockWeight: 0.9, snowWeight: 0.06, waterWeight: 0 },
    expected: ['granite', 'quartz', 'scree'],
  },
  {
    label: 'snow shoulder',
    args: { worldX: -910, worldZ: 1180, heightAboveSeaMeters: 420, slopeDegrees: 17, concavityMeters: 2.8, rockWeight: 0.1, snowWeight: 0.92, waterWeight: 0 },
    expected: ['snow'],
  },
  {
    label: 'wet shore',
    args: { worldX: 1720, worldZ: 80, heightAboveSeaMeters: 3.8, slopeDegrees: 5, concavityMeters: 0.2, rockWeight: 0.06, snowWeight: 0, waterWeight: 0.9 },
    expected: ['shoreline'],
  },
];
const resolvedContexts = [];
for (const fixture of contexts) {
  check(`context ${fixture.label}`, () => {
    const context = terrainSurfaceReliefContext(fixture.args);
    resolvedContexts.push({ fixture, context });
    approx(context.slope01, 0, 1, 'slope01');
    approx(context.elevation01, 0, 1, 'elevation01');
    approx(context.wet01, 0, 1, 'wet01');
    approx(context.exposedRock, 0, 1, 'exposedRock');
    approx(context.substrate, 0, 1, 'substrate');
    assert.equal(context.policyId, TERRAIN_SURFACE_FABRIC_POLICY.id);
    finiteObject(context.antiTilingOffset, 'antiTilingOffset');
    assert.ok(fixture.expected.includes(chooseTerrainSubstrate(context)), `unexpected substrate ${chooseTerrainSubstrate(context)}`);
  });
}
for (const { fixture, context } of resolvedContexts) {
  check(`response ${fixture.label}`, () => {
    const multiplier = terrainSurfaceColorMultiplier(context);
    const roughness = terrainSurfaceRoughness(context);
    const normalGain = terrainSurfaceNormalGain(context);
    approx(multiplier, 0.72, 1.28, 'colorMultiplier');
    approx(roughness, 0.48, 1, 'roughness');
    approx(normalGain, 0.02, 0.18, 'normalGain');
  });
}

check('manifest is immutable and canonical-neutral', () => {
  const manifest = buildTerrainSurfaceManifest({
    sample: {
      worldX: 915,
      worldZ: -205,
      heightAboveSeaMeters: 215,
      slopeDegrees: 42,
      concavityMeters: 1.3,
      rockWeight: 0.74,
      snowWeight: 0.08,
      waterWeight: 0,
    },
    sourceMapPolicyId: 'westeros-full-owner-map-current-terrain-2026-08-27-v2-valyria-geology',
  });
  assert.equal(manifest.canonical.heightUnchanged, true);
  assert.equal(manifest.canonical.hydrologyUnchanged, true);
  assert.equal(manifest.canonical.colliderUnchanged, true);
  assert.equal(manifest.canonical.routeUnchanged, true);
  assert.equal(manifest.canonical.settlementUnchanged, true);
  assert.equal(manifest.antiTiling.worldSpace, true);
  assert.equal(manifest.antiTiling.repeatedTextureIsSupplemental, true);
  assert.ok(manifest.response.colorMultiplier >= 0.72);
  assert.ok(manifest.response.colorMultiplier <= 1.28);
  assert.ok(Object.isFrozen(manifest));
});

check('distinct far-apart locations do not collapse into an identical noise tuple', () => {
  const a = terrainSurfaceNoise(0, 0);
  const b = terrainSurfaceNoise(18000, -15000);
  const same = Object.keys(a).every((key) => a[key] === b[key]);
  assert.equal(same, false);
});

check('no 22m repeat is declared by the new fabric', () => {
  assert.ok(!TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters.includes(22));
  assert.ok(TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters[0] > 22);
});

check('lowland and exposed-rock responses remain materially distinct', () => {
  const low = terrainSurfaceReliefContext({ heightAboveSeaMeters: 14, slopeDegrees: 3, rockWeight: 0.02, snowWeight: 0, waterWeight: 0 });
  const rock = terrainSurfaceReliefContext({ heightAboveSeaMeters: 280, slopeDegrees: 61, rockWeight: 0.91, snowWeight: 0, waterWeight: 0 });
  const lowResponse = terrainSurfaceColorMultiplier(low);
  const rockResponse = terrainSurfaceColorMultiplier(rock);
  assert.ok(Math.abs(lowResponse - rockResponse) > 0.002);
  assert.ok(rock.exposedRock > low.exposedRock);
});

check('terrain environment profile policy has no editor shortcut', () => {
  assert.equal(TERRAIN_ENVIRONMENT_PROFILE_POLICY.editorRuntimeImportAllowed, false);
  assert.equal(TERRAIN_ENVIRONMENT_PROFILE_POLICY.proceduralPlaceholderAllowed, false);
  assert.equal(TERRAIN_ENVIRONMENT_PROFILE_POLICY.deterministicTransformRequired, true);
  assert.equal(TERRAIN_ENVIRONMENT_PROFILE_POLICY.manifestRequired, true);
});

check('every environment profile resolves and has real PBR surface requirements', () => {
  for (const [category, profile] of Object.entries(TERRAIN_ENVIRONMENT_ASSET_PROFILES)) {
    const resolved = resolveTerrainEnvironmentProfile(category);
    assert.equal(resolved.category, profile.category);
    assert.ok(profile.requiredSurfaces.length >= 1, `${category} has no surface requirement`);
    assert.ok(profile.preferredPalettes.length >= 1, `${category} has no palette preference`);
    assert.ok(profile.lod.maxVisibleMeters > 0, `${category} has no LOD horizon`);
  }
});

check('authored asset registry is grounded in observed repository families', () => {
  assert.ok(VERIFIED_VEGETATION_ASSETS.length >= 6);
  assert.ok(VERIFIED_PROP_ASSETS.length >= 6);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.placeholderAllowed, false);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.requireHydratedAssetBeforeSceneAttach, true);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.requireManifestBeforeSceneAttach, true);
  const summary = registrySummary();
  assert.equal(summary.totalVerifiedAssets, VERIFIED_VEGETATION_ASSETS.length + VERIFIED_PROP_ASSETS.length);
});

check('verified authored tree lookup is deterministic', () => {
  const tree = findVerifiedEnvironmentAsset('assets/models/vegetation/birch_trees_R7qMWzb7nk.glb');
  assert.ok(tree);
  assert.equal(tree.family, 'tree');
  assert.equal(findVerifiedEnvironmentAsset(tree.src).src, tree.src);
  assert.equal(findVerifiedEnvironmentAsset(tree.src.toUpperCase()).src, tree.src);
});

const profileFixtures = [
  { category: 'tree', biome: 'meadow', sample: { slopeDegrees: 8, heightMeters: 42, moisture: 0.66, waterDepth: 0, biome: 'meadow' }, winter: false },
  { category: 'tree', biome: 'tundra', sample: { slopeDegrees: 12, heightMeters: 210, moisture: 0.61, waterDepth: 0, biome: 'tundra' }, winter: true },
  { category: 'rock', biome: 'highland', sample: { slopeDegrees: 43, heightMeters: 180, moisture: 0.34, waterDepth: 0, biome: 'highland' }, winter: false },
  { category: 'scree', biome: 'alpine-bare', sample: { slopeDegrees: 39, heightMeters: 310, moisture: 0.29, waterDepth: 0, biome: 'alpine-bare' }, winter: false },
  { category: 'grass', biome: 'meadow', sample: { slopeDegrees: 11, heightMeters: 18, moisture: 0.70, waterDepth: 0, biome: 'meadow' }, winter: false },
];
for (const fixture of profileFixtures) {
  check(`environment candidate ${fixture.category}/${fixture.biome}`, () => {
    const candidates = selectVerifiedEnvironmentCandidates(fixture.category, {
      biome: fixture.biome,
      winter: fixture.winter,
    });
    if (fixture.category === 'tree') assert.ok(candidates.length >= 1);
    const profile = resolveTerrainEnvironmentProfile(fixture.category);
    const score = environmentSurfaceScore(profile, fixture.sample);
    approx(score, 0, 1, `${fixture.category} score`);
    const validity = validateTerrainEnvironmentPlacement(profile, fixture.sample);
    assert.equal(validity.ok, true, validity.errors.join(','));
    const requirement = environmentAssetRequirement(fixture.category);
    assert.ok(requirement);
    assert.equal(requirement.manifestRequired, true);
  });
}

check('invalid tree placement fails water policy', () => {
  const profile = resolveTerrainEnvironmentProfile('tree');
  const result = validateTerrainEnvironmentPlacement(profile, { slopeDegrees: 3, heightMeters: 12, waterDepth: 1, biome: 'meadow' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('water-depth-out-of-policy'));
});

check('invalid house placement fails steep-slope policy', () => {
  const profile = resolveTerrainEnvironmentProfile('house');
  const result = validateTerrainEnvironmentPlacement(profile, { slopeDegrees: 18, heightMeters: 20, waterDepth: 0, biome: 'settlement-envelope' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('slope-out-of-policy'));
});

check('deterministic environment transform is stable and bounded', () => {
  const profile = resolveTerrainEnvironmentProfile('rock');
  const a = deterministicAssetTransform(0x4a7b91, 17, profile);
  const b = deterministicAssetTransform(0x4a7b91, 17, profile);
  assert.deepEqual(a, b);
  assert.ok(a.scale >= profile.scale.min && a.scale <= profile.scale.max);
  approx(a.yawRadians, 0, Math.PI * 2, 'yaw');
  assert.ok(Math.abs(a.pitchRadians) < 0.2);
  assert.ok(Math.abs(a.rollRadians) < 0.2);
});

check('environment manifest carries asset/material/placement evidence', () => {
  const asset = findVerifiedEnvironmentAsset('assets/models/vegetation/birch_trees_R7qMWzb7nk.glb');
  const profile = resolveTerrainEnvironmentProfile('tree', asset);
  const manifest = makeEnvironmentAssetManifest({
    asset: { ...asset, category: 'tree', hydrated: true, placeholder: false },
    profile,
    sample: { slopeDegrees: 8, heightMeters: 42, moisture: 0.66, waterDepth: 0, biome: 'meadow' },
    transform: deterministicAssetTransform(42, 1, profile),
    materialManifest: { materialReadyForWorld: true },
    placementManifest: { grounded: true, queried: true },
  });
  assert.equal(manifest.acceptance.profileAccepted, true);
  assert.equal(manifest.acceptance.placementAccepted, true);
  assert.equal(manifest.acceptance.materialContractRequired, true);
  assert.equal(manifest.acceptance.placeholderAllowed, false);
  assert.equal(manifest.acceptance.canonicalGeometryModified, false);
});

check('asset placement plan never authorizes procedural replacement', () => {
  const tree = findVerifiedEnvironmentAsset('assets/models/vegetation/birch_trees_R7qMWzb7nk.glb');
  const plan = environmentAssetPlacementPlan(tree, {
    category: 'tree',
    worldX: 512,
    worldZ: -840,
    biome: 'meadow',
    sample: { slopeDegrees: 8, heightMeters: 42, moisture: 0.66, waterDepth: 0, biome: 'meadow' },
  });
  assert.equal(plan.placement.required, true);
  assert.equal(plan.material.required, true);
  assert.equal(plan.placement.manifestRequired, true);
  assert.equal(plan.validation.ok, true);
});

check('full environment facade preserves the mandatory operation sequence', () => {
  const result = validateTerrainEnvironmentContract();
  assert.equal(result.ok, true, result.errors.join(','));
  assert.deepEqual(TERRAIN_ENVIRONMENT_CONTRACT.sequence, [
    'asset-hydrate',
    'surface-analysis',
    'material-recipe',
    'material-validation',
    'ground-transform',
    'placement-manifest',
    'scene-attach',
  ]);
});

check('surface analysis is deterministic and substrate-aware', () => {
  const sample = { worldX: 730, worldZ: -1240, heightAboveSeaMeters: 260, slopeDegrees: 55, concavityMeters: 1.4, rockWeight: 0.88, snowWeight: 0.04, waterWeight: 0 };
  const a = analyzeTerrainSurfaceForEnvironment(sample);
  const b = analyzeTerrainSurfaceForEnvironment(sample);
  assert.deepEqual(a, b);
  assert.ok(['granite', 'quartz', 'scree'].includes(a.substrate));
});

check('environment context does not authorize editor/runtime shortcuts', () => {
  const asset = findVerifiedEnvironmentAsset('assets/models/vegetation/birch_trees_R7qMWzb7nk.glb');
  const context = prepareTerrainEnvironmentAssetContext(asset, {
    category: 'tree',
    worldX: 120,
    worldZ: 280,
    biome: 'meadow',
    sample: { worldX: 120, worldZ: 280, slopeDegrees: 9, heightMeters: 52, moisture: 0.64, waterDepth: 0, biome: 'meadow' },
  });
  const gate = assertTerrainEnvironmentAttachReady(context);
  assert.equal(gate.ok, true, gate.errors.join(','));
  assert.equal(context.attachAllowed, true);
  assert.equal(context.plan.placement.manifestRequired, true);
});

check('other-owner query stays query-only and exposes common authorities', () => {
  const asset = findVerifiedEnvironmentAsset('assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb');
  const context = environmentContextForOtherOwners('tree', {
    worldX: -500,
    worldZ: 920,
    slopeDegrees: 15,
    heightMeters: 320,
    moisture: 0.58,
    waterDepth: 0,
    biome: 'tundra',
    winter: true,
  }, asset);
  assert.equal(context.queryOnly, true);
  assert.equal(context.heightAuthority, 'src/3d/world/terrain.js');
  assert.equal(context.materialAuthority, 'src/3d/materials/MaterialAssignmentCore.js');
  assert.equal(context.placementAuthority, 'src/3d/world/WorldAssetPlacementPipeline.js');
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    surfacePolicy: TERRAIN_SURFACE_FABRIC_POLICY.id,
    environmentPolicy: TERRAIN_ENVIRONMENT_PROFILE_POLICY.id,
    assetRegistryPolicy: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
    contractId: TERRAIN_ENVIRONMENT_CONTRACT.id,
    fixtureCount: samples.length + contexts.length + profileFixtures.length,
    semanticChannels: Object.keys(TERRAIN_SURFACE_FABRIC_CHANNELS).length,
    verifiedVegetationAssets: VERIFIED_VEGETATION_ASSETS.length,
    verifiedPropAssets: VERIFIED_PROP_ASSETS.length,
    worldSpaceScalesMeters: TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters,
    message: 'terrain surface and environment asset contracts passed',
  }, null, 2));
}
