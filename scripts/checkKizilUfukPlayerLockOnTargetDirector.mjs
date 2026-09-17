import assert from 'node:assert/strict';
import { rankPlayerLockOnTargets, createPlayerLockOnTargetDirector } from '../src/3d/gameplay/playerLockOnTargetDirector.js';

const profile = { mainHand: { id: 'sword', damageMultiplier: 1, reachMultiplier: 1, poiseMultiplier: 1 }, armor: { movementMultiplier: 1, staminaDrainMultiplier: 1, poiseBonus: 0 }, ranged: false, twoHanded: false, shieldEquipped: false, effectiveGuardMultiplier: 1 };
const candidates = [
  { id: 'far', distanceMeters: 12, angleRad: 0.2, priority: 0.1 },
  { id: 'near', distanceMeters: 4, angleRad: 0.4, priority: 0.2 },
  { id: 'hidden', distanceMeters: 2, angleRad: 0.1, visible: false, priority: 1 },
];

const first = rankPlayerLockOnTargets(profile, candidates, { maxResults: 8 });
const second = rankPlayerLockOnTargets(profile, candidates, { maxResults: 8 });
assert.deepEqual(first, second);
assert.equal(first.best.id, 'near');
assert.equal(first.eligible.length, 2);
assert.equal(Object.isFrozen(first), true);

const director = createPlayerLockOnTargetDirector({ profile, maxHistory: 2 });
const acquired = director.evaluate(candidates);
assert.equal(acquired.decision, 'acquire');
assert.equal(acquired.nextTargetId, 'near');
const maintained = director.evaluate(candidates);
assert.equal(maintained.decision, 'maintain');
const broken = director.evaluate([{ id: 'near', distanceMeters: 30, angleRad: 0.1 }]);
assert.equal(broken.decision, 'break');
assert.equal(director.snapshot().history.length, 2);
director.dispose();
assert.equal(director.evaluate(candidates).disposed, true);
console.log('lock-on target director: ok');
