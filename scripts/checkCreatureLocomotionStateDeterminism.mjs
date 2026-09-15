import assert from 'node:assert/strict';
import { CREATURE_LOCOMOTION_SEQUENCE_FIXTURES } from '../src/3d/gameplay/fixtures/creatureLocomotionStateFixtures.js';
import { replayCreatureLocomotionInputs, deterministicReplayFingerprint } from '../src/3d/gameplay/creatureLocomotionStateReplay.js';

for (const [index, sequence] of CREATURE_LOCOMOTION_SEQUENCE_FIXTURES.entries()) {
  const left = replayCreatureLocomotionInputs(sequence, { id: `det-${index}` });
  const right = replayCreatureLocomotionInputs(sequence, { id: `det-${index}` });
  assert.equal(deterministicReplayFingerprint(left), deterministicReplayFingerprint(right), `sequence ${index}`);
  assert.deepEqual(left.states, right.states, `states ${index}`);
  assert.deepEqual(left.timestamps, right.timestamps, `timestamps ${index}`);
}
console.log(`Creature locomotion determinism checks passed: ${CREATURE_LOCOMOTION_SEQUENCE_FIXTURES.length}`);
