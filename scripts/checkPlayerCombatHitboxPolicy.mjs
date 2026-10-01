import assert from 'node:assert/strict';
import {
  createPlayerCombatHitboxPolicy,
  evaluatePlayerCombatHit,
  resolvePlayerCombatHitbox,
} from '../src/3d/gameplay/playerCombatHitboxPolicy.js';

const policy = createPlayerCombatHitboxPolicy({
  reach: 2,
  hurtboxPadding: 0.06,
  torso: { radius: 0.3, height: 0.8, offsetY: 1.1 },
});
assert.equal(policy.reach, 2);
assert.equal(policy.torso.radius, 0.3);
assert.equal(resolvePlayerCombatHitbox(policy, 'torso').radius, 0.36);
assert.equal(resolvePlayerCombatHitbox(policy, 'unknown').part, 'body');
assert.ok(resolvePlayerCombatHitbox(policy, 'head').isFinite);

const closeHit = evaluatePlayerCombatHit({
  attackerDistance: 2.2,
  targetHeight: 1.8,
  hitbox: resolvePlayerCombatHitbox(policy, 'torso'),
  verticalOffset: 0.2,
});
assert.equal(closeHit.hit, true);

const farMiss = evaluatePlayerCombatHit({
  attackerDistance: 4,
  hitbox: resolvePlayerCombatHitbox(policy, 'body'),
});
assert.equal(farMiss.hit, false);

const verticalMiss = evaluatePlayerCombatHit({
  attackerDistance: 1,
  targetHeight: 1.7,
  hitbox: resolvePlayerCombatHitbox(policy, 'head'),
  verticalOffset: 2,
});
assert.equal(verticalMiss.hit, false);

const deterministicA = JSON.stringify(createPlayerCombatHitboxPolicy({ reach: 999, hurtboxPadding: -3 }));
const deterministicB = JSON.stringify(createPlayerCombatHitboxPolicy({ reach: 999, hurtboxPadding: -3 }));
assert.equal(deterministicA, deterministicB);
console.log('[checkPlayerCombatHitboxPolicy] PASS');
