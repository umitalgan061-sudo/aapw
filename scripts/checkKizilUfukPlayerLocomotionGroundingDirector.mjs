import assert from 'node:assert/strict';
import { createPlayerLocomotionGroundingDirector } from '../src/3d/gameplay/playerLocomotionGroundingDirector.js';

const input = {
  grounded: true,
  surface: 'terrain-slope-01',
  slopeRadians: 0.22,
  phase: 0.2,
  left: { contact: 1, height: 0.03, confidence: 0.94, phase: 0.2 },
  right: { contact: 1, height: 0.12, confidence: 0.88, phase: 0.7 },
};

function run() {
  const director = createPlayerLocomotionGroundingDirector({ maxHistory: 2 });
  const first = director.sample(input);
  assert.equal(first.grounded, true);
  assert.equal(first.preferredLead, 'left');
  assert.equal(first.ik.enabled, true);
  assert.equal(director.validate(first), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.ik), true);
  const second = director.sample({ ...input, phase: 0.8 });
  assert.equal(second.preferredLead, 'right');
  const third = director.sample({ ...input, grounded: false });
  assert.equal(third.ik.enabled, false);
  assert.equal(director.snapshot().history.length, 2);

  const replay = createPlayerLocomotionGroundingDirector({ maxHistory: 2 });
  assert.deepEqual(replay.sample(input), first);
  assert.deepEqual(replay.sample({ ...input, phase: 0.8 }), second);

  director.dispose();
  assert.throws(() => director.sample(input), /disposed/);
  assert.equal(director.reset(), false);
}

run();
console.log('Kızıl Ufuk locomotion grounding director checks passed');
