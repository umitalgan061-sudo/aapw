import assert from 'node:assert/strict';
import {
  resolvePlayerCombatAnimationBlend,
  validatePlayerCombatAnimationBlend,
} from '../src/3d/gameplay/playerCombatAnimationBlend.js';

const idle = resolvePlayerCombatAnimationBlend({ semanticState: 'idle', planarSpeedMps: 0 });
assert.equal(idle.locomotionWeight, 0);
assert.equal(idle.combatOverlayWeight, 0);
assert.equal(validatePlayerCombatAnimationBlend(idle), true);

const sprint = resolvePlayerCombatAnimationBlend({ semanticState: 'locomotion', planarSpeedMps: 6.5 });
assert.ok(sprint.locomotionWeight > 0.99);
assert.ok(sprint.baseWeight < 0.01);
assert.equal(validatePlayerCombatAnimationBlend(sprint), true);

const light = resolvePlayerCombatAnimationBlend({ semanticState: 'light-attack', planarSpeedMps: 3.2, attackPhase: 0.65 });
assert.equal(light.combatOverlayWeight, 0.9);
assert.ok(light.attackWeight > 0.5);
assert.ok(light.locomotionWeight < 0.1);
assert.equal(validatePlayerCombatAnimationBlend(light), true);

const guard = resolvePlayerCombatAnimationBlend({ semanticState: 'guard', planarSpeedMps: 2, guardWeight: 0.7 });
assert.equal(guard.guardWeight, 0.7);
assert.equal(validatePlayerCombatAnimationBlend(guard), true);

const malformed = resolvePlayerCombatAnimationBlend({ semanticState: 'dodge', planarSpeedMps: Infinity, additiveFeedbackWeight: NaN });
assert.equal(malformed.speedMps, 0);
assert.equal(malformed.additiveFeedbackWeight, 0);
assert.equal(validatePlayerCombatAnimationBlend(malformed), true);

const deterministicA = JSON.stringify(resolvePlayerCombatAnimationBlend({ semanticState: 'heavy-attack', planarSpeedMps: 4.25, attackPhase: 0.4 }));
const deterministicB = JSON.stringify(resolvePlayerCombatAnimationBlend({ semanticState: 'heavy-attack', planarSpeedMps: 4.25, attackPhase: 0.4 }));
assert.equal(deterministicA, deterministicB);

console.log('player-combat-animation-blend: PASS');
