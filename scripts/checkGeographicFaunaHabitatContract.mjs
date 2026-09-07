import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GEOGRAPHIC_FAUNA_HABITAT_VERSION,
  REAL_FAUNA_ASSETS,
  FAUNA_HABITAT_RULES,
  FAUNA_BIOME_HABITATS,
  getFaunaHabitatRule,
  getRealFaunaAsset,
  isFaunaAllowedInBiome,
  describeFaunaVisualContract,
  summarizeFaunaHabitatContract,
} from '../src/3d/world/geographicFaunaHabitatContract.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICE_WORKER = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
const errors = [];
const check = (condition, message) => { try { assert.ok(condition, message); } catch (error) { errors.push(error.message); } };

function testAssets() {
  for (const [id, asset] of Object.entries(REAL_FAUNA_ASSETS)) {
    check(asset.source.startsWith('assets/models/'), `${id} source must be a real asset path`);
    check(asset.allowedBiomes.length > 0, `${id} must have habitat coverage`);
    check(asset.preferredBiomes.every((biome) => asset.allowedBiomes.includes(biome)), `${id} preferred habitats must be a subset of allowed habitats`);
    check(asset.surfaceRequirements.requiredSemanticSurfaces.length >= 4, `${id} needs semantic material surface coverage`);
    check(SERVICE_WORKER.includes(asset.source), `${id} source is missing from the existing offline asset graph`);
    check(getRealFaunaAsset(id) === asset, `${id} getter must return canonical asset profile`);
    check(describeFaunaVisualContract(asset.family)?.source === asset.source, `${id} visual contract must expose the real asset source`);
  }
}

function testBiomeMatrix() {
  for (const [biome, flags] of Object.entries(FAUNA_BIOME_HABITATS)) {
    for (const [family, allowed] of Object.entries(flags)) {
      const id = Object.entries(REAL_FAUNA_ASSETS).find(([, asset]) => asset.family === family)?.[0];
      if (!id) continue;
      equalAllowed(id, biome, allowed);
    }
  }
}

function equalAllowed(assetId, biome, expected) {
  const actual = isFaunaAllowedInBiome(assetId, biome);
  check(actual === expected, `${assetId} biome ${biome} expected ${expected} but resolved ${actual}`);
}

function testRules() {
  check(FAUNA_HABITAT_RULES.horse.maxSlopeDegrees <= 25, 'horse slope policy too permissive');
  check(FAUNA_HABITAT_RULES.wolf.maxSettlementDistanceMeters > FAUNA_HABITAT_RULES.wolf.minSettlementDistanceMeters, 'wolf settlement range inverted');
  check(FAUNA_HABITAT_RULES.dragon.maxSlopeDegrees > 80, 'dragon should be allowed to originate over steep aerial terrain');
  for (const family of ['horse', 'wolf', 'dragon']) check(getFaunaHabitatRule(family) === FAUNA_HABITAT_RULES[family], `${family} habitat getter drifted`);
  check(getFaunaHabitatRule('unknown') === null, 'unknown habitat rule must be null');
}

function testRepresentativeHabitats() {
  const cases = [
    ['horse', 'lush-grassland', true], ['horse', 'snow', false], ['horse', 'mountain', false],
    ['wolf', 'snow', true], ['wolf', 'mountain', true], ['wolf', 'lush-grassland', false],
    ['dragon', 'mountain', true], ['dragon', 'desert', true], ['dragon', 'jungle', true], ['dragon', 'lush-grassland', false],
  ];
  for (const [id, biome, expected] of cases) equalAllowed(id, biome, expected);
  check(!isFaunaAllowedInBiome('missing', 'snow'), 'missing fauna must never resolve as allowed');
}

function run() {
  check(/^2026-09-07\.v1$/.test(GEOGRAPHIC_FAUNA_HABITAT_VERSION), 'fauna habitat contract version drifted');
  testAssets();
  testBiomeMatrix();
  testRules();
  testRepresentativeHabitats();
  const summary = summarizeFaunaHabitatContract();
  check(summary.assets.length === Object.keys(REAL_FAUNA_ASSETS).length, 'summary asset count drifted');
  check(summary.habitatKinds.length === Object.keys(FAUNA_BIOME_HABITATS).length, 'summary habitat count drifted');
  check(summary.ruleFamilies.length === Object.keys(FAUNA_HABITAT_RULES).length, 'summary rule-family count drifted');
  console.log(JSON.stringify({ version: GEOGRAPHIC_FAUNA_HABITAT_VERSION, summary, checks: 45, errors }, null, 2));
  if (errors.length) process.exitCode = 1;
}

run();
