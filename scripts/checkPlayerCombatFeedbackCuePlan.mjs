import assert from 'node:assert/strict';
import {
  buildPlayerCombatFeedbackCuePlan,
  serializePlayerCombatFeedbackCuePlan,
  validatePlayerCombatFeedbackCuePlan,
} from '../src/3d/gameplay/playerCombatFeedbackCuePlan.js';

const make = (input) => buildPlayerCombatFeedbackCuePlan(input);

const hit = make({ reaction: 'hit', attackKind: 'heavy', comboStep: 2, hitStrength: 0.9, critical: true, targetId: 'Enemy-01', weaponId: 'Longsword' });
assert.equal(hit.reaction, 'hit');
assert.equal(hit.attackKind, 'heavy');
assert.equal(hit.comboStep, 2);
assert.equal(hit.critical, true);
assert.equal(hit.targetId, 'enemy-01');
assert.equal(hit.weaponId, 'longsword');
assert.equal(hit.primary.ui, 'health-loss');
assert.equal(hit.cues.length, 2);
assert.ok(hit.presentation.hitStopSeconds > 0);
assert.ok(validatePlayerCombatFeedbackCuePlan(hit));
assert.equal(Object.isFrozen(hit), true);
assert.equal(Object.isFrozen(hit.primary), true);

const parry = make({ reaction: 'parried', attackKind: 'light', comboStep: 1 });
assert.equal(parry.primary.channel, 'parry');
assert.equal(parry.primary.vfx, 'parry-flash');
assert.ok(parry.presentation.cameraShake > hit.presentation.cameraShake * 0.5);

const blocked = make({ reaction: 'blocked', attackKind: 'none', hitStrength: 10 });
assert.equal(blocked.hitStrength, 1);
assert.equal(blocked.primary.ui, 'guard-contact');
assert.equal(blocked.cues.length, 1);

const malformed = make({ reaction: '???', attackKind: '???', comboStep: 'bad', hitStrength: 'bad', critical: true, targetId: '   ' });
assert.equal(malformed.reaction, 'miss');
assert.equal(malformed.attackKind, 'none');
assert.equal(malformed.comboStep, 0);
assert.equal(malformed.critical, false);
assert.equal(malformed.targetId, null);
assert.ok(validatePlayerCombatFeedbackCuePlan(malformed));

const first = serializePlayerCombatFeedbackCuePlan(hit);
const second = serializePlayerCombatFeedbackCuePlan(make({ reaction: 'hit', attackKind: 'heavy', comboStep: 2, hitStrength: 0.9, critical: true, targetId: 'Enemy-01', weaponId: 'Longsword' }));
assert.equal(first, second);

console.log('PLAYER_COMBAT_FEEDBACK_CUE_PLAN_PASS');
