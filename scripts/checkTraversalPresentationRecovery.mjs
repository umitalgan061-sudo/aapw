import assert from 'node:assert/strict';
import { buildTraversalRecoveryPresentation, resolveTraversalRecoveryChannels, getTraversalRecoveryProfile, isTraversalRecoveryComplete } from '../src/3d/gameplay/playerTraversalPresentationRecoveryPolicy.js';
for (const state of ['vault','climb','drop','land','blocked','cancelled','recover']) {
  const profile=getTraversalRecoveryProfile(state);
  assert.ok(profile.duration>0);
  const zero=resolveTraversalRecoveryChannels(state,0);
  const done=resolveTraversalRecoveryChannels(state,profile.duration);
  assert.equal(zero.progress,0);
  assert.equal(done.progress,1);
  assert.ok(done.recovery<=1);
}
const presentation=buildTraversalRecoveryPresentation({state:'vault'},{state:'clear'},1);
assert.equal(typeof presentation.readyForReentry,'boolean');
assert.equal(isTraversalRecoveryComplete(presentation),presentation.readyForReentry);
console.log('traversal recovery presentation passed');
