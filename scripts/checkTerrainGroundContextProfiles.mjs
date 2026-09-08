#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_GROUND_CONTEXT_PROFILES,
  listTerrainGroundContextProfiles,
  resolveTerrainGroundContextProfile,
  evaluateTerrainGroundContextAgainstProfile,
  serializeTerrainGroundContextProfile,
} from '../src/3d/world/terrainGroundContextProfiles.js';
import { buildTerrainGroundContext, resolveTerrainAgentPlacementQuery } from '../src/3d/world/terrainGroundContext.js';

const expected = ['vegetation', 'tree', 'rock', 'building', 'settlement', 'bridge', 'waterside'];
assert.deepEqual(listTerrainGroundContextProfiles(), expected);
for (const category of expected) {
  const profile = resolveTerrainGroundContextProfile(category);
  assert.equal(profile.id, category);
  assert(Object.isFrozen(profile));
  assert(Object.isFrozen(profile.forbiddenBiomes));
  assert(Object.isFrozen(profile.allowedBiomes));
  assert(Object.isFrozen(profile.allowedWaterTypes));
  assert(Object.isFrozen(profile.forbiddenWaterTypes));
  assert(Number.isFinite(profile.maxSlopeDegrees));
  assert(typeof serializeTerrainGroundContextProfile(category), 'string');
  assert.equal(JSON.parse(serializeTerrainGroundContextProfile(category)).id, category);
}

const plain = buildTerrainGroundContext({
  heightAboveSeaMeters: 40,
  slopeDegrees: 8,
  biomeName: 'grassland',
  biome: { grass: 0.8, forest: 0.2, rock: 0.05, snow: 0.02 },
  roadDistanceMeters: 10,
  settlementDistanceMeters: 20,
});
for (const category of ['vegetation', 'tree', 'building', 'settlement']) {
  const result = evaluateTerrainGroundContextAgainstProfile(plain, category);
  assert.equal(result.accepted, true, `plain should accept ${category}`);
}

const steep = buildTerrainGroundContext({
  heightAboveSeaMeters: 40,
  slopeDegrees: 46,
  biomeName: 'rock',
  biome: { rock: 0.8, snow: 0.1 },
  roadDistanceMeters: 10,
  settlementDistanceMeters: 20,
});
assert.equal(evaluateTerrainGroundContextAgainstProfile(steep, 'tree').accepted, false);
assert.equal(evaluateTerrainGroundContextAgainstProfile(steep, 'building').accepted, false);
assert.equal(evaluateTerrainGroundContextAgainstProfile(steep, 'rock').accepted, true);

const ocean = buildTerrainGroundContext({
  heightAboveSeaMeters: -20,
  slopeDegrees: 4,
  waterType: 'ocean',
  biomeName: 'ocean',
});
assert.equal(evaluateTerrainGroundContextAgainstProfile(ocean, 'vegetation').accepted, false);
assert.equal(evaluateTerrainGroundContextAgainstProfile(ocean, 'tree').accepted, false);
assert.equal(evaluateTerrainGroundContextAgainstProfile(ocean, 'building').accepted, false);
assert.equal(evaluateTerrainGroundContextAgainstProfile(ocean, 'bridge').accepted, false);

const shore = buildTerrainGroundContext({
  heightAboveSeaMeters: 0,
  slopeDegrees: 7,
  waterType: 'shore',
  biomeName: 'shore',
  biome: { rock: 0.35, snow: 0.05 },
});
assert.equal(evaluateTerrainGroundContextAgainstProfile(shore, 'waterside').accepted, true);
assert.equal(evaluateTerrainGroundContextAgainstProfile(shore, 'tree').accepted, false);

const shallow = buildTerrainGroundContext({
  heightAboveSeaMeters: -2,
  slopeDegrees: 12,
  waterType: 'shallow',
  biomeName: 'marsh',
});
assert.equal(evaluateTerrainGroundContextAgainstProfile(shallow, 'bridge').accepted, true);
assert.equal(evaluateTerrainGroundContextAgainstProfile(shallow, 'waterside').accepted, true);
assert.equal(evaluateTerrainGroundContextAgainstProfile(shallow, 'vegetation').accepted, false);

const custom = evaluateTerrainGroundContextAgainstProfile(plain, 'tree', { maxSlopeDegrees: 6 });
assert.equal(custom.accepted, false);
assert.equal(custom.reason, 'slope');

const unknown = resolveTerrainGroundContextProfile('unknown-category');
assert.equal(unknown.id, 'vegetation');

const placement = resolveTerrainAgentPlacementQuery(plain, { category: 'tree', preferWalkable: true });
assert.equal(placement.accepted, true);
assert.equal(placement.profile.category, 'tree');
assert.equal(placement.reason, 'accepted');

const blockedPlacement = resolveTerrainAgentPlacementQuery(steep, { category: 'building', preferBuildable: true });
assert.equal(blockedPlacement.accepted, false);
assert.notEqual(blockedPlacement.reason, 'accepted');

assert.equal(TERRAIN_GROUND_CONTEXT_PROFILES.vegetation.maxSlopeDegrees, 38);
assert.equal(TERRAIN_GROUND_CONTEXT_PROFILES.tree.maxSlopeDegrees, 34);
assert.equal(TERRAIN_GROUND_CONTEXT_PROFILES.building.maxSlopeDegrees, 12);
assert.equal(TERRAIN_GROUND_CONTEXT_PROFILES.bridge.maxSlopeDegrees, 24);
assert.equal(TERRAIN_GROUND_CONTEXT_PROFILES.waterside.maxSlopeDegrees, 18);

console.log('[checkTerrainGroundContextProfiles] PASS', JSON.stringify({ profileCount: expected.length, categories: expected }));
