import assert from 'node:assert/strict';
import { projectPlayerCombatTargetFocus } from '../src/3d/gameplay/playerCombatTargetFocus.ts';

const focused = projectPlayerCombatTargetFocus({
  targetId: 'wolf-1',
  distanceMeters: 4.56789,
  angleRadians: 0.12345,
  candidateCount: 3,
}, { lockRequested: true, lockStrength: 0.8 });

assert.equal(focused.mode, 'locked');
assert.equal(focused.targetId, 'wolf-1');
assert.equal(focused.distanceMeters, 4.568);
assert.equal(focused.angleRadians, 0.1235);
assert.equal(focused.candidateCount, 3);
assert.equal(focused.focusKey, 'locked|wolf-1|4.568|0.1235|3');

const empty = projectPlayerCombatTargetFocus(null, { lockRequested: true });
assert.equal(empty.mode, 'none');
assert.equal(empty.lockRequested, false);
assert.equal(empty.targetId, null);

console.log(JSON.stringify({ ok: true, suite: 'player-combat-target-focus-projection' }));
