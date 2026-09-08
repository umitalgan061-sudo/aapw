import assert from 'node:assert/strict';
import {
  blendPolicyAudit,
  resolvePlayerCombatAnimationBlend,
} from '../src/3d/gameplay/playerCombatAnimationBlendPolicy.js';

const idle = resolvePlayerCombatAnimationBlend({ state: 'idle', speedMps: 0 });
assert.equal(idle.action, 'idle');
assert.equal(idle.locomotionWeight, 0);
assert.equal(idle.attackWeight, 0);

const run = resolvePlayerCombatAnimationBlend({ state: 'idle', speedMps: 20 });
assert.equal(run.action, 'run');
assert.equal(run.speedMps, 8.2);
assert.ok(run.locomotionWeight <= 1);

const heavy = resolvePlayerCombatAnimationBlend({
  state: 'heavy-attack',
  attackKind: 'heavy',
  comboStep: 9,
  speedMps: 3,
  equipment: { mainHand: 'greatsword', armorWeight: 2 },
});
assert.equal(heavy.action, 'heavy');
assert.equal(heavy.attackWeight, 1);
assert.equal(heavy.locomotionWeight, 0);
assert.equal(heavy.comboStep, 3);
assert.equal(heavy.equipment.mainHand, 'greatsword');
assert.equal(heavy.equipment.armorWeight, 1);

const reaction = resolvePlayerCombatAnimationBlend({
  state: 'hit-stagger',
  feedbackIntensity: 0.2,
});
assert.equal(reaction.action, 'hit-stagger');
assert.equal(reaction.reactionWeight, 0.45);
assert.ok(reaction.crossfadeSeconds < idle.crossfadeSeconds);

const airborne = resolvePlayerCombatAnimationBlend({ state: 'idle', speedMps: 6, grounded: false });
assert.equal(airborne.action, 'idle');
assert.equal(airborne.locomotionWeight, 0);

const first = resolvePlayerCombatAnimationBlend({ state: 'guard', guarding: true, speedMps: 2, equipment: { offHand: 'buckler' } });
const second = resolvePlayerCombatAnimationBlend({ state: 'guard', guarding: true, speedMps: 2, equipment: { offHand: 'buckler' } });
assert.deepEqual(first, second);
assert.deepEqual(blendPolicyAudit(heavy), { ok: true, errors: [] });

console.log('Player combat animation blend policy: PASS');
