#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  CREATURE_HABITAT_RULES,
  DESKTOP_SPECIES_COUNTS,
  MOBILE_SPECIES_COUNTS,
  isCreatureHabitatCompatible,
} from '../src/3d/gameplay/creatureSpawner.js';

const seats = [{ id: 'winterfell', x: 0, z: 0 }, { id: 'dragonstone', x: 2000, z: 0 }];
const flat = () => 140;
const seaLevelMeters = 40;

assert.equal(isCreatureHabitatCompatible('kedi', 200, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), true,
  'domestic cat should fit settlement hinterland');
assert.equal(isCreatureHabitatCompatible('kedi', 900, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), false,
  'domestic cat must not scatter far outside settlement hinterland');
assert.equal(isCreatureHabitatCompatible('geyik', 80, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), false,
  'wild deer must not spawn beside a keep');
assert.equal(isCreatureHabitatCompatible('geyik', 400, 0, { sampleHeightMeters: flat, seaLevelMeters, seats }), true,
  'wild deer should fit grounded hinterland beyond keep exclusion');
assert.equal(isCreatureHabitatCompatible('ayi', 500, 0, { sampleHeightMeters: () => 80, seaLevelMeters, seats }), false,
  'bear must reject terrain below its authored highland floor');
assert.equal(isCreatureHabitatCompatible('ayi', 500, 0, { sampleHeightMeters: () => 220, seaLevelMeters, seats }), true,
  'bear should accept elevated terrain away from settlements');
assert.equal(isCreatureHabitatCompatible('zurafa', 600, 0, { sampleHeightMeters: () => 700, seaLevelMeters, seats }), false,
  'giraffe must reject terrain above its lowland ceiling');
assert.equal(isCreatureHabitatCompatible('kuzgun', 5000, 5000, { sampleHeightMeters: flat, seaLevelMeters, seats }), true,
  'unconstrained birds must retain canonical placement behavior');
assert.equal(isCreatureHabitatCompatible('kedi', 200, 0, { sampleHeightMeters: null, seaLevelMeters, seats }), false,
  'habitat-constrained species must fail closed without canonical height sampling');

for (const [speciesId, rule] of Object.entries(CREATURE_HABITAT_RULES)) {
  assert.ok(Object.isFrozen(rule), `${speciesId} habitat rule must be immutable`);
  if (rule.minSeatDistanceMeters != null && rule.maxSeatDistanceMeters != null) {
    assert.ok(rule.maxSeatDistanceMeters > rule.minSeatDistanceMeters, `${speciesId} seat envelope must be non-empty`);
  }
  if (rule.minElevationAboveSeaMeters != null && rule.maxElevationAboveSeaMeters != null) {
    assert.ok(rule.maxElevationAboveSeaMeters > rule.minElevationAboveSeaMeters, `${speciesId} elevation envelope must be non-empty`);
  }
}

const desktopTotal = Object.values(DESKTOP_SPECIES_COUNTS).reduce((sum, count) => sum + count, 0);
const mobileTotal = Object.values(MOBILE_SPECIES_COUNTS).reduce((sum, count) => sum + count, 0);
assert.equal(desktopTotal, 80, 'existing desktop fauna budget must remain capped at 80');
assert.equal(mobileTotal, 12, 'existing mobile fauna budget must remain capped at 12');

console.log('CREATURE_HABITAT_PLACEMENT_PASS', JSON.stringify({
  habitatRuleCount: Object.keys(CREATURE_HABITAT_RULES).length,
  desktopBudget: desktopTotal,
  mobileBudget: mobileTotal,
  canonicalPhysicalGatePreserved: true,
  settlementEnvelopeBounded: true,
  elevationEnvelopeBounded: true,
}));
