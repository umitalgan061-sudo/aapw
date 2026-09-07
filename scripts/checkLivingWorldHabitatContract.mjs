import assert from 'node:assert/strict';
import {
  habitatDecision,
  normalizeLivingWorldHabitatSample,
  validateLivingWorldHabitatSample,
} from '../src/3d/gameplay/livingWorldHabitatContract.js';

const farmer = normalizeLivingWorldHabitatSample({ kind: 'npc', biome: 'reach', water: false, slopeDegrees: 8, navReachable: true });
assert.equal(farmer.kind, 'npc');
assert.equal(validateLivingWorldHabitatSample(farmer).valid, true);

assert.equal(habitatDecision({ kind: 'npc', water: true }).accepted, false);
assert.equal(habitatDecision({ kind: 'wildlife', roadDistance: 4, settlementDistance: 20 }).reason, 'road-buffer');
assert.equal(habitatDecision({ kind: 'wildlife', roadDistance: 20, settlementDistance: 20, slopeDegrees: 12 }).accepted, true);
assert.equal(habitatDecision({ kind: 'dragon', water: true, settlementDistance: 4 }).accepted, false);
assert.deepEqual(validateLivingWorldHabitatSample({ kind: 'horse', slopeDegrees: 31 }).failures, ['slope-too-steep']);

console.log('living-world habitat contract checks passed');
