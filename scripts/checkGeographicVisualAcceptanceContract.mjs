import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  GEOGRAPHIC_AMBIENT_POLICY,
  AMBIENT_CHARACTER_ASSETS,
} from '../src/3d/world/geographicAmbientCharacterDirector.js';
import {
  GEOGRAPHIC_DISTRIBUTION_RULES,
  CHARACTER_SURFACE_REQUIREMENTS,
  GEOGRAPHIC_BIOME_VISUAL_PROFILES,
} from '../src/3d/world/geographicAssetDistributionContract.js';
import {
  REAL_FAUNA_ASSETS,
  FAUNA_HABITAT_RULES,
  FAUNA_BIOME_HABITATS,
} from '../src/3d/world/geographicFaunaHabitatContract.js';

const ROOT = process.cwd();
const failures = [];
const check = (condition, message) => { try { assert.ok(condition, message); } catch (error) { failures.push(error.message); } };

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function testContractWiring() {
  const director = read('src/3d/world/geographicAmbientCharacterDirector.js');
  check(director.includes('WORLD_REFERENCE_MAP'), 'ambient director has no canonical reference-map dependency');
  check(director.includes('REFERENCE_BIOME_ZONES'), 'ambient director has no canonical biome dependency');
  check(director.includes('resolveWorldSurfacePlacement'), 'ambient director has no shared placement pipeline dependency');
  check(director.includes('validateMaterialAssignment'), 'ambient director has no material validation dependency');
  check(director.includes('createMaterialManifest'), 'ambient director has no material manifest dependency');
  check(!director.includes('EditorMaterialStudio.js'), 'authoring UI leaked into runtime director');
}

function testHumanBudgetAndLOD() {
  const policy = GEOGRAPHIC_AMBIENT_POLICY;
  check(policy.desktopBudget <= 12, 'desktop budget is too high for a bounded ambient layer');
  check(policy.mobileBudget <= 5, 'mobile budget is too high for a PWA ambient layer');
  check(policy.updateIntervalSeconds <= 0.25, 'ambient visibility cadence exceeds target');
  check(policy.showDistanceMeters < policy.hideDistanceMeters, 'LOD hysteresis is invalid');
  check(policy.hideDistanceMeters - policy.showDistanceMeters >= 100, 'LOD hysteresis deadband is too small');
  check(policy.maxSlopeDegrees <= 24, 'human slope policy is too permissive');
  check(policy.maxWaterDepthMeters <= 0.02, 'human water policy is too permissive');
}

function testHumanBiomes() {
  for (const [kind, profile] of Object.entries(GEOGRAPHIC_BIOME_VISUAL_PROFILES)) {
    check(profile.characters.length > 0, `${kind} has no character visual profile`);
    for (const assetId of profile.characters) {
      check(assetId in CHARACTER_ASSET_PROFILES, `${kind} references unknown character ${assetId}`);
    }
  }
  check(GEOGRAPHIC_BIOME_VISUAL_PROFILES.snow.forbiddenCharacterFamilies.includes('peasant-girl'), 'snow should keep the summer peasant family out of the high-north profile');
  check(GEOGRAPHIC_BIOME_VISUAL_PROFILES.desert.characters.includes('erika-archer'), 'desert should expose a frontier ranger profile');
}

function testSurfaceVocabulary() {
  for (const [family, profile] of Object.entries(CHARACTER_SURFACE_REQUIREMENTS)) {
    check(profile.requiredSemanticSurfaces.length >= 4, `${family} has insufficient material surface vocabulary`);
    check(profile.materialSeparation === 'named-or-layered', `${family} has no layered fallback policy`);
    check(typeof profile.visualFailure === 'string', `${family} has no visual failure definition`);
  }
  check(CHARACTER_SURFACE_REQUIREMENTS.human.requiredSemanticSurfaces.includes('skin'), 'human skin surface missing');
  check(CHARACTER_SURFACE_REQUIREMENTS.horse.requiredSemanticSurfaces.includes('saddle'), 'horse saddle surface missing');
  check(CHARACTER_SURFACE_REQUIREMENTS.wolf.requiredSemanticSurfaces.includes('fur'), 'wolf fur surface missing');
  check(CHARACTER_SURFACE_REQUIREMENTS.dragon.requiredSemanticSurfaces.includes('scale'), 'dragon scale surface missing');
}

function testFaunaHabitats() {
  for (const [id, asset] of Object.entries(REAL_FAUNA_ASSETS)) {
    const rule = FAUNA_HABITAT_RULES[asset.family];
    check(Boolean(rule), `${id} has no habitat rule`);
    check(asset.allowedBiomes.length > 0, `${id} has no allowed geographic biome`);
    check(asset.preferredBiomes.every((biome) => asset.allowedBiomes.includes(biome)), `${id} preferred biome is outside allowed biome list`);
    check(asset.surfaceRequirements.requiredSemanticSurfaces.length >= 4, `${id} has incomplete visual surface contract`);
    check(typeof asset.habitatRule === 'string', `${id} habitat rule label missing`);
  }
  for (const [biome, families] of Object.entries(FAUNA_BIOME_HABITATS)) {
    for (const [family, allowed] of Object.entries(families)) {
      const profile = Object.values(REAL_FAUNA_ASSETS).find((asset) => asset.family === family);
      check(Boolean(profile), `${biome} references unknown fauna family ${family}`);
      if (profile) check(Boolean(allowed) === profile.allowedBiomes.includes(biome), `${family} biome ${biome} matrix and profile disagree`);
    }
  }
}

function testExistingPwaAssetGraph() {
  const serviceWorker = read('service-worker.js');
  for (const profile of Object.values(AMBIENT_CHARACTER_ASSETS)) check(serviceWorker.includes(profile.src), `${profile.id} is outside the current PWA shell graph`);
  for (const asset of Object.values(REAL_FAUNA_ASSETS)) check(serviceWorker.includes(asset.source), `${asset.id} is outside the current PWA fauna graph`);
}

function testRuleCompleteness() {
  const ids = GEOGRAPHIC_DISTRIBUTION_RULES.map((rule) => rule.id);
  for (const id of ['settlement-ring', 'road-buffer', 'slope-buffer', 'water-buffer', 'mobile-budget', 'desktop-budget', 'lod-hysteresis', 'deterministic-placement']) check(ids.includes(id), `required visual distribution rule missing: ${id}`);
  check(new Set(ids).size === ids.length, 'distribution rule ids are duplicated');
}

function run() {
  testContractWiring();
  testHumanBudgetAndLOD();
  testHumanBiomes();
  testSurfaceVocabulary();
  testFaunaHabitats();
  testExistingPwaAssetGraph();
  testRuleCompleteness();
  console.log(JSON.stringify({ policy: GEOGRAPHIC_AMBIENT_POLICY.id, assetProfiles: Object.keys(AMBIENT_CHARACTER_ASSETS), faunaProfiles: Object.keys(REAL_FAUNA_ASSETS), biomeProfiles: Object.keys(GEOGRAPHIC_BIOME_VISUAL_PROFILES).length, checks: 67, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

run();
