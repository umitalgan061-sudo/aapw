import assert from 'node:assert/strict';
import {
  buildPlayerCombatReactionWindow,
  buildPlayerCombatReactionSummary,
  serializePlayerCombatReactionWindow,
} from '../src/3d/gameplay/playerCombatReactionWindow.js';

const profile = { attack: { light: { activeStart: 0.14, activeEnd: 0.26, duration: 0.44 }, heavy: { activeStart: 0.28, activeEnd: 0.46, duration: 0.72 } } };

const light = buildPlayerCombatReactionWindow({ action: 'light', elapsed: 0.1, profile });
assert.equal(light.attackActive, false);
assert.equal(buildPlayerCombatReactionWindow({ action: 'light', elapsed: 0.1, profile }).attackActive, false);

const activeHeavy = buildPlayerCombatReactionWindow({ action: 'heavy', elapsed: 0.3, profile });
assert.equal(activeHeavy.attackActive, true);
assert.equal(activeHeavy.response, 'none');

const parry = buildPlayerCombatReactionWindow({ action: 'parry', elapsed: 0.05, incoming: { active: true, kind: 'heavy', strength: 120 } });
assert.equal(parry.parryWindow, true);
assert.equal(parry.response, 'parried');
assert.equal(parry.canDeflect, true);

const dodge = buildPlayerCombatReactionWindow({ action: 'dodge', elapsed: 0.2, incoming: { active: true, kind: 'light', strength: 10 } });
assert.equal(dodge.dodgeIFrames, true);
assert.equal(dodge.response, 'dodged');

const guard = buildPlayerCombatReactionWindow({ action: 'guard', elapsed: 0.2, incoming: { active: true, kind: 'light', strength: 10 } });
assert.equal(guard.response, 'blocked');

const malformed = buildPlayerCombatReactionWindow({ action: '??', elapsed: 'bad', incoming: { active: true, strength: 'bad' } });
assert.equal(malformed.action, 'idle');
assert.equal(malformed.elapsed, 0);
assert.equal(malformed.incoming.strength, 0);
assert.equal(Object.isFrozen(malformed), true);

const summary = buildPlayerCombatReactionSummary({ action: 'dodge', elapsed: 0.2, incoming: { active: true, kind: 'light' } });
assert.equal(summary.invulnerable, true);
assert.equal(summary.perfectDefense, false);
assert.equal(serializePlayerCombatReactionWindow(summary), serializePlayerCombatReactionWindow(summary));

console.log('player combat reaction window contract: ok');
