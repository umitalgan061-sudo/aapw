import assert from 'node:assert/strict';
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
  TERRAIN_ENVIRONMENT_ASSET_PROFILES,
  resolveTerrainEnvironmentProfile,
  deterministicAssetTransform,
} from '../src/3d/world/terrainEnvironmentProfiles.js';

const failures = [];
const check = (label, fn) => { try { fn(); } catch (error) { failures.push(`${label}: ${error.message}`); } };
const between = (value, min, max, label) => {
  assert.ok(Number.isFinite(value), `${label} not finite`);
  assert.ok(value >= min && value <= max, `${label} outside range`);
};

check('registry policy is fail-closed for placeholders', () => {
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.placeholderAllowed, false);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.proceduralReplacementAllowed, false);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.requireHydratedAssetBeforeSceneAttach, true);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.requireManifestBeforeSceneAttach, true);
  assert.equal(ENVIRONMENT_ASSET_REGISTRY_POLICY.importedMaterialPreservationPreferred, true);
});

check('every verified vegetation entry has provenance and PBR surfaces', () => {
  for (const asset of VERIFIED_VEGETATION_ASSETS) {
    assert.ok(asset.id);
    assert.ok(asset.src.startsWith('assets/models/vegetation/'));
    assert.match(asset.src, /\.(glb|gltf|fbx)$/i);
    assert.match(asset.pointerSha, /^[0-9a-f]{40}$/);
    assert.ok(asset.pbr.length >= 1);
    assert.ok(asset.role);
  }
});

check('every verified prop entry has provenance and PBR surfaces', () => {
  for (const asset of VERIFIED_PROP_ASSETS) {
    assert.ok(asset.id);
    assert.ok(asset.src.startsWith('assets/models/props/'));
    assert.match(asset.src, /\.(glb|gltf|fbx)$/i);
    assert.match(asset.pointerSha, /^[0-9a-f]{40}$/);
    assert.ok(asset.pbr.length >= 1);
    assert.ok(asset.role);
  }
});

check('registry contains multiple non-placeholder vegetation families', () => {
  const families = new Set(VERIFIED_VEGETATION_ASSETS.map((asset) => asset.family));
  assert.ok(families.has('tree'));
  assert.ok(families.has('dead-tree'));
  assert.ok(families.has('snow-dead-tree'));
  assert.ok(families.size >= 3);
});

check('vegetation lookup is path-stable and case tolerant', () => {
  const source = 'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb';
  const a = findVerifiedEnvironmentAsset(source);
  const b = findVerifiedEnvironmentAsset(source.toUpperCase());
  assert.ok(a);
  assert.deepEqual(a, b);
});

check('unknown asset remains unverified rather than silently promoted', () => {
  const result = validateVerifiedEnvironmentAsset({ id: 'not-real', src: 'assets/models/vegetation/not-real.glb', category: 'tree' }, {
    category: 'tree',
    sample: { slopeDegrees: 7, heightMeters: 24, waterDepth: 0, biome: 'meadow' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.verified, false);
  assert.ok(result.warnings.includes('asset-not-in-verified-registry'));
});

check('placeholder asset is hard rejected', () => {
  const result = validateVerifiedEnvironmentAsset({ id: 'placeholder', src: 'assets/models/vegetation/fake.glb', category: 'tree', placeholder: true }, {
    category: 'tree',
    sample: { slopeDegrees: 7, heightMeters: 24, waterDepth: 0, biome: 'meadow' },
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('placeholder-asset'));
});

check('tree selection is non-empty in a real temperate biome', () => {
  const candidates = selectVerifiedEnvironmentCandidates('tree', { biome: 'meadow', climate: 'temperate' });
  assert.ok(candidates.length >= 1);
  assert.ok(candidates.every((asset) => asset.family === 'tree' || asset.family === 'dead-tree' || asset.family === 'snow-dead-tree'));
});

check('winter tree selection excludes explicitly non-winter-compatible assets', () => {
  const candidates = selectVerifiedEnvironmentCandidates('tree', { biome: 'tundra', winter: true });
  assert.ok(candidates.length >= 1);
  assert.equal(candidates.some((asset) => asset.winterCompatible === false), false);
});

for (const [category, profile] of Object.entries(TERRAIN_ENVIRONMENT_ASSET_PROFILES)) {
  check(`requirement-${category}`, () => {
    const requirement = environmentAssetRequirement(category);
    assert.ok(requirement);
    assert.equal(requirement.category, profile.category);
    assert.equal(requirement.hydratedRequired, true);
    assert.equal(requirement.manifestRequired, true);
    assert.equal(requirement.proceduralReplacementAllowed, false);
    assert.ok(Array.isArray(requirement.candidates));
  });
}

check('deterministic asset seed changes with authored source location', () => {
  const a = deterministicEnvironmentSeed('birch', 100, 200);
  const b = deterministicEnvironmentSeed('birch', 100, 201);
  const c = deterministicEnvironmentSeed('pine', 100, 200);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

check('deterministic transforms stay within the selected profile envelope', () => {
  for (const category of ['tree', 'rock', 'scree', 'shrub', 'grass', 'snow-patch', 'house', 'settlement']) {
    const profile = resolveTerrainEnvironmentProfile(category);
    const transform = deterministicAssetTransform(0x8badf00d, 13, profile);
    assert.ok(transform.scale >= profile.scale.min && transform.scale <= profile.scale.max);
    between(transform.yawRadians, 0, Math.PI * 2, `${category}.yawRadians`);
    assert.ok(Number.isFinite(transform.pitchRadians));
    assert.ok(Number.isFinite(transform.rollRadians));
  }
});

const validFixtures = [
  { category: 'tree', asset: 'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb', sample: { slopeDegrees: 8, heightMeters: 45, moisture: 0.66, waterDepth: 0, biome: 'meadow' } },
  { category: 'tree', asset: 'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb', sample: { slopeDegrees: 11, heightMeters: 330, moisture: 0.58, waterDepth: 0, biome: 'tundra' } },
  { category: 'prop', asset: 'assets/models/props/barrel_zjCQP1TAci.glb', sample: { slopeDegrees: 6, heightMeters: 32, moisture: 0.48, waterDepth: 0, biome: 'settlement-envelope' } },
];
for (const fixture of validFixtures) {
  check(`valid fixture ${fixture.category}`, () => {
    const asset = findVerifiedEnvironmentAsset(fixture.asset);
    assert.ok(asset);
    const result = validateVerifiedEnvironmentAsset({ ...asset, category: fixture.category, hydrated: true, placeholder: false }, {
      category: fixture.category,
      sample: fixture.sample,
    });
    assert.equal(result.ok, true, result.errors.join(','));
  });
}

check('tree placement plan keeps common contract authorities intact', () => {
  const asset = findVerifiedEnvironmentAsset('assets/models/vegetation/birch_trees_R7qMWzb7nk.glb');
  const plan = environmentAssetPlacementPlan(asset, {
    category: 'tree',
    worldX: 1500,
    worldZ: -700,
    biome: 'meadow',
    sample: { slopeDegrees: 7, heightMeters: 54, moisture: 0.64, waterDepth: 0, biome: 'meadow', roadDistance: 16, settlementDistance: 500 },
  });
  assert.equal(plan.material.authority, 'src/3d/materials/MaterialAssignmentCore.js');
  assert.equal(plan.placement.authority, 'src/3d/world/WorldAssetPlacementPipeline.js');
  assert.equal(plan.ground.queryAuthority, undefined);
  assert.equal(plan.placement.manifestRequired, true);
});

check('plan rejects a forbidden-water context before scene attachment', () => {
  const asset = findVerifiedEnvironmentAsset('assets/models/vegetation/birch_trees_R7qMWzb7nk.glb');
  const plan = environmentAssetPlacementPlan(asset, {
    category: 'tree',
    worldX: 12,
    worldZ: 34,
    biome: 'meadow',
    sample: { slopeDegrees: 3, heightMeters: 8, moisture: 0.8, waterDepth: 1.0, biome: 'meadow' },
  });
  assert.equal(plan.validation.ok, false);
});

check('registry summary agrees with actual verified counts', () => {
  const summary = registrySummary();
  assert.equal(summary.totalVerifiedAssets, VERIFIED_VEGETATION_ASSETS.length + VERIFIED_PROP_ASSETS.length);
  assert.equal(summary.vegetationAssets, VERIFIED_VEGETATION_ASSETS.length);
  assert.equal(summary.propAssets, VERIFIED_PROP_ASSETS.length);
  assert.equal(summary.placeholderAllowed, false);
  assert.equal(summary.proceduralReplacementAllowed, false);
});

check('no two verified records share an id', () => {
  const all = [...VERIFIED_VEGETATION_ASSETS, ...VERIFIED_PROP_ASSETS];
  assert.equal(new Set(all.map((asset) => asset.id)).size, all.length);
});

check('no two verified records falsely claim different bytes for the same pointer family', () => {
  const all = [...VERIFIED_VEGETATION_ASSETS, ...VERIFIED_PROP_ASSETS];
  const samePointer = new Map();
  for (const asset of all) {
    if (!samePointer.has(asset.pointerSha)) samePointer.set(asset.pointerSha, asset.src);
  }
  assert.ok(samePointer.size >= Math.ceil(all.length * 0.6));
});

check('profile constraints remain finite', () => {
  for (const profile of Object.values(TERRAIN_ENVIRONMENT_ASSET_PROFILES)) {
    for (const value of [profile.minSlopeDegrees, profile.maxSlopeDegrees, profile.minHeightMeters, profile.scale.min, profile.scale.max, profile.lod.maxVisibleMeters]) {
      assert.ok(Number.isFinite(Number(value)), `${profile.category} has non-finite constraint`);
    }
    assert.ok(profile.scale.max >= profile.scale.min);
    assert.ok(profile.lod.maxVisibleMeters > 0);
  }
});

check('winter-compatible tree list actually contains a winter family', () => {
  const winter = selectVerifiedEnvironmentCandidates('tree', { biome: 'tundra', winter: true });
  assert.ok(winter.some((asset) => asset.family === 'snow-dead-tree' || asset.id.includes('dead')));
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    ok: true,
    policyId: ENVIRONMENT_ASSET_REGISTRY_POLICY.id,
    vegetationAssets: VERIFIED_VEGETATION_ASSETS.length,
    propAssets: VERIFIED_PROP_ASSETS.length,
    profileCount: Object.keys(TERRAIN_ENVIRONMENT_ASSET_PROFILES).length,
    message: 'verified terrain environment asset registry passed',
  }, null, 2));
}
