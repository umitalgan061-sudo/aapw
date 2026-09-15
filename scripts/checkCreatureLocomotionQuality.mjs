import assert from 'node:assert/strict';
import { CREATURE_LOCOMOTION_STATE_FIXTURES } from '../src/3d/gameplay/fixtures/creatureLocomotionStateFixtures.js';
import { buildCreatureLocomotionQualityReport, checkCreatureLocomotionScenario, checkCreatureLocomotionState, checkCreatureLocomotionDeterminism, CREATURE_LOCOMOTION_INVARIANTS } from '../src/3d/gameplay/creatureLocomotionStateQuality.js';

assert.ok(CREATURE_LOCOMOTION_INVARIANTS.length >= 10);
const rows = [];
for (const fixture of CREATURE_LOCOMOTION_STATE_FIXTURES) {
  const result = checkCreatureLocomotionScenario(fixture.input);
  assert.deepEqual(result.errors, [], `${fixture.id}: ${result.errors.join(', ')}`);
  assert.equal(result.state.state, fixture.expectedState, fixture.id);
  assert.equal(result.state.gait, fixture.expectedGait, fixture.id);
  rows.push({ id: fixture.id, input: fixture.input });
}

for (const fixture of CREATURE_LOCOMOTION_STATE_FIXTURES.slice(0, 12)) {
  const deterministic = checkCreatureLocomotionDeterminism(fixture.input);
  assert.equal(deterministic.equal, true, `${fixture.id}: deterministic`);
}

const report = buildCreatureLocomotionQualityReport(rows);
assert.equal(report.summary.invalid, 0);
assert.equal(report.summary.deterministic, report.summary.total);
assert.equal(report.summary.validRatio, 1);
assert.equal(report.summary.deterministicRatio, 1);

const airborne = checkCreatureLocomotionScenario({ speciesId: 'kuzgun', flightEnabled: true, flightPhase: 'cruise', grounded: false, moving: true, speedMps: 7, targetSpeedMps: 7 });
assert.deepEqual(airborne.errors, []);
assert.equal(airborne.state.state, 'flight-cruise');
assert.equal(airborne.state.gait, 'flap');

const landing = checkCreatureLocomotionScenario({ speciesId: 'kartal', grounded: true, moving: false, impactMps: 7, airTimeSeconds: 2, flightEnabled: true });
assert.deepEqual(landing.errors, []);
assert.equal(landing.state.state, 'landing-hard');
assert.equal(landing.state.gait, 'walk');

const malformed = checkCreatureLocomotionScenario({ grounded: 'yes', surfaceSlip: 'not-a-number', confidence: Infinity });
assert.deepEqual(malformed.errors, []);

const output = checkCreatureLocomotionState(landing.state, landing.state);
assert.deepEqual(output, []);

console.log(`Creature locomotion quality checks passed: ${report.summary.total}`);
