import assert from 'node:assert/strict';
import { buildCombatTimingEvidence, projectCombatClock, validateCombatTimingEvidence } from '../src/3d/gameplay/playerCombatTimingContract.js';

const clamped = projectCombatClock({ elapsedSeconds: 0.2, deltaSeconds: 0.35, phaseSeconds: 0.08, phaseDurationSeconds: 0.15 });
assert.equal(clamped.deltaSeconds, 0.1);
assert.equal(clamped.complete, true);
assert.equal(clamped.remainingSeconds, 0);

const malformed = buildCombatTimingEvidence({ elapsedSeconds: 'bad', deltaSeconds: Infinity, phaseSeconds: -4, phaseDurationSeconds: NaN });
assert.equal(validateCombatTimingEvidence(malformed), true);
assert.equal(malformed.deltaSeconds, 0);
assert.equal(malformed.phaseSeconds, 0);
assert.equal(malformed.phaseDurationSeconds, 0);
assert.equal(Object.isFrozen(malformed), true);
assert.equal(Object.isFrozen(malformed.ownership), true);

const a = JSON.stringify(buildCombatTimingEvidence({ elapsedSeconds: 0.1, deltaSeconds: 0.05, phaseSeconds: 0.02, phaseDurationSeconds: 0.2 }));
const b = JSON.stringify(buildCombatTimingEvidence({ phaseDurationSeconds: 0.2, phaseSeconds: 0.02, deltaSeconds: 0.05, elapsedSeconds: 0.1 }));
assert.equal(a, b);
console.log('PLAYER_COMBAT_TIMING_CONTRACT_OK');
