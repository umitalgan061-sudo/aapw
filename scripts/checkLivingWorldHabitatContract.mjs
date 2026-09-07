import assert from 'node:assert/strict';
import {
  habitatDecision,
  habitatEvidence,
  normalizeLivingWorldHabitatSample,
  validateLivingWorldHabitatSample,
} from '../src/3d/gameplay/livingWorldHabitatContract.js';

const farmer = normalizeLivingWorldHabitatSample({ kind: 'npc', biome: 'reach', water: false, slopeDegrees: 8, navReachable: true });
assert.equal(farmer.kind, 'npc');
assert.equal(validateLivingWorldHabitatSample(farmer).valid, true);
assert.equal(normalizeLivingWorldHabitatSample({ biome: 'frozen' }).biome, 'snow');

assert.equal(habitatDecision({ kind: 'npc', water: true }).accepted, false);
assert.equal(habitatDecision({ kind: 'wildlife', roadDistance: 4, settlementDistance: 20 }).reason, 'road-buffer');
assert.equal(habitatDecision({ kind: 'wildlife', roadDistance: 20, settlementDistance: 20, slopeDegrees: 12 }).accepted, true);
assert.equal(habitatDecision({ kind: 'dragon', biome: 'reach', water: false, settlementDistance: 20 }).reason, 'biome-mismatch');
assert.equal(habitatDecision({ kind: 'dragon', biome: 'mountain', water: true, settlementDistance: 20 }).accepted, true);
assert.equal(habitatDecision({ kind: 'wildlife', surface: 'settlement-edge', roadDistance: 20, settlementDistance: 20 }).reason, 'settlement-edge-wildlife');
assert.deepEqual(validateLivingWorldHabitatSample({ kind: 'horse', slopeDegrees: 31 }).failures, ['slope-too-steep']);

const evidenceA = habitatEvidence({ kind: 'horse', biome: 'north', groundY: 4, habitatKey: 'stable:1' });
const evidenceB = habitatEvidence({ kind: 'horse', biome: 'north', groundY: 4, habitatKey: 'stable:1' });
assert.equal(evidenceA.digest, evidenceB.digest);
assert.equal(evidenceA.context.groundAligned, true);

console.log('living-world habitat contract checks passed');
