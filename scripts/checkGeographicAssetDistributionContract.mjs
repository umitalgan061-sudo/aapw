import assert from 'node:assert/strict';
import {
  GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION,
  CHARACTER_SURFACE_REQUIREMENTS,
  CHARACTER_ASSET_PROFILES,
  GEOGRAPHIC_BIOME_VISUAL_PROFILES,
  GEOGRAPHIC_DISTRIBUTION_RULES,
  getCharacterAssetProfile,
  getGeographicBiomeVisualProfile,
  getSurfaceRequirements,
  isAssetAllowedInBiome,
  summarizeGeographicDistribution,
} from '../src/3d/world/geographicAssetDistributionContract.js';

const failures = [];
const check = (condition, message) => { try { assert.ok(condition, message); } catch (error) { failures.push(error.message); } };
const equal = (actual, expected, message) => { try { assert.deepEqual(actual, expected, message); } catch (error) { failures.push(error.message); } };

function testVersionAndCoverage() {
  check(/^2026-09-07\.v1$/.test(GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION), 'distribution contract version drifted');
  check(Object.keys(GEOGRAPHIC_BIOME_VISUAL_PROFILES).length >= 10, 'geographic visual coverage unexpectedly shrank');
  check(Object.keys(CHARACTER_ASSET_PROFILES).length >= 5, 'real asset profile catalog unexpectedly shrank');
  check(Object.keys(CHARACTER_SURFACE_REQUIREMENTS).includes('human'), 'human surface contract missing');
  check(Object.keys(CHARACTER_SURFACE_REQUIREMENTS).includes('horse'), 'horse surface contract missing');
  check(Object.keys(CHARACTER_SURFACE_REQUIREMENTS).includes('wolf'), 'wolf surface contract missing');
  check(Object.keys(CHARACTER_SURFACE_REQUIREMENTS).includes('dragon'), 'dragon surface contract missing');
}

function testSurfaceVocabulary() {
  const expected = {
    human: ['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear'],
    horse: ['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness'],
    wolf: ['fur', 'eye', 'claw', 'tooth'],
    creature: ['body', 'eye', 'claw', 'tooth'],
    dragon: ['scale', 'wing', 'eye', 'horn', 'claw'],
  };
  for (const [family, surfaces] of Object.entries(expected)) equal([...CHARACTER_SURFACE_REQUIREMENTS[family].requiredSemanticSurfaces], surfaces, `${family} material semantic vocabulary drifted`);
  for (const family of Object.keys(CHARACTER_SURFACE_REQUIREMENTS)) {
    check(getSurfaceRequirements(family) === CHARACTER_SURFACE_REQUIREMENTS[family], `${family} getter must return canonical surface contract`);
    check(['named-or-layered'].includes(CHARACTER_SURFACE_REQUIREMENTS[family].materialSeparation), `${family} material separation contract drifted`);
  }
}

function testAssetProfiles() {
  for (const [assetId, profile] of Object.entries(CHARACTER_ASSET_PROFILES)) {
    check(profile.source.startsWith('assets/models/'), `${assetId} is not backed by a real assets/models source`);
    check(profile.family in CHARACTER_SURFACE_REQUIREMENTS, `${assetId} family has no surface contract`);
    check(profile.preferredBiomes.length > 0, `${assetId} has no geographic habitat preference`);
    check(profile.authoredMaterialPolicy === 'preserve-when-present', `${assetId} may overwrite authored materials unexpectedly`);
    equal(getCharacterAssetProfile(assetId), profile, `${assetId} getter must return the canonical profile`);
    for (const biome of profile.preferredBiomes) check(isAssetAllowedInBiome(assetId, biome), `${assetId} should be allowed in preferred biome ${biome}`);
  }
  check(getCharacterAssetProfile('missing-asset') === null, 'unknown asset profile must resolve to null');
  check(!isAssetAllowedInBiome('missing-asset', 'lush-grassland'), 'unknown asset must never be allowed in a biome');
}

function testBiomeProfiles() {
  for (const [biomeKind, profile] of Object.entries(GEOGRAPHIC_BIOME_VISUAL_PROFILES)) {
    check(profile.visualIdentity.length > 4, `${biomeKind} visual identity missing`);
    check(profile.groundMood.length > 3, `${biomeKind} ground mood missing`);
    check(profile.characters.length >= 1, `${biomeKind} must have at least one character family for visual review`);
    for (const assetId of profile.characters) check(isAssetAllowedInBiome(assetId, biomeKind), `${biomeKind} lists character ${assetId} outside its geographic preference contract`);
    for (const forbidden of profile.forbiddenCharacterFamilies) check(!profile.characters.includes(forbidden), `${biomeKind} both allows and forbids ${forbidden}`);
    check(getGeographicBiomeVisualProfile(biomeKind) === profile, `${biomeKind} getter must return the canonical profile`);
  }
  check(getGeographicBiomeVisualProfile('not-a-biome') === null, 'unknown biome profile must resolve to null');
}

function testRepresentativeGeography() {
  const cases = [
    ['snow', 'paladin-j-nordstrom', true],
    ['snow', 'peasant-girl', false],
    ['mountain', 'paladin-j-nordstrom', true],
    ['mountain', 'dragon-baked-fbx', true],
    ['marsh', 'peasant-girl', true],
    ['marsh', 'paladin-j-nordstrom', false],
    ['desert', 'erika-archer', true],
    ['desert', 'peasant-girl', false],
    ['steppe', 'erika-archer', true],
    ['jungle', 'erika-archer', true],
  ];
  for (const [biome, assetId, expected] of cases) equal(isAssetAllowedInBiome(assetId, biome), expected, `${assetId} geography rule in ${biome} drifted`);
}

function testRulesAndSummary() {
  const ids = GEOGRAPHIC_DISTRIBUTION_RULES.map((rule) => rule.id);
  check(ids.length >= 8, 'geographic rule set is unexpectedly small');
  check(new Set(ids).size === ids.length, 'geographic rule ids must be unique');
  check(ids.includes('settlement-ring'), 'settlement ring rule missing');
  check(ids.includes('road-buffer'), 'road buffer rule missing');
  check(ids.includes('slope-buffer'), 'slope buffer rule missing');
  check(ids.includes('water-buffer'), 'water buffer rule missing');
  check(ids.includes('mobile-budget'), 'mobile budget rule missing');
  check(ids.includes('desktop-budget'), 'desktop budget rule missing');
  check(ids.includes('lod-hysteresis'), 'LOD hysteresis rule missing');
  check(ids.includes('deterministic-placement'), 'deterministic placement rule missing');
  const summary = summarizeGeographicDistribution();
  equal(summary.version, GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION, 'summary version drifted');
  equal(summary.biomeCount, Object.keys(GEOGRAPHIC_BIOME_VISUAL_PROFILES).length, 'summary biome count drifted');
  equal(summary.assetProfileCount, Object.keys(CHARACTER_ASSET_PROFILES).length, 'summary asset count drifted');
  equal(summary.familyCount, Object.keys(CHARACTER_SURFACE_REQUIREMENTS).length, 'summary family count drifted');
  equal(summary.rules, ids, 'summary rule ids drifted');
}

function run() {
  testVersionAndCoverage();
  testSurfaceVocabulary();
  testAssetProfiles();
  testBiomeProfiles();
  testRepresentativeGeography();
  testRulesAndSummary();
  console.log(JSON.stringify({ version: GEOGRAPHIC_ASSET_DISTRIBUTION_VERSION, biomeCount: Object.keys(GEOGRAPHIC_BIOME_VISUAL_PROFILES).length, assetProfileCount: Object.keys(CHARACTER_ASSET_PROFILES).length, surfaceFamilies: Object.keys(CHARACTER_SURFACE_REQUIREMENTS), checks: 74, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
}

run();
