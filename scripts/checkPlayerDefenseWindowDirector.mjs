import assert from 'node:assert/strict';
import { resolvePlayerDefenseWindow, serializePlayerDefenseWindow } from '../src/3d/gameplay/playerDefenseWindowDirector.js';

const parry = resolvePlayerDefenseWindow({ action: 'parry', mode: 'incoming', staminaRatio: 1, poiseRatio: 1, bufferMs: 80 });
assert.equal(parry.action, 'parry');
assert.equal(parry.canExecute, true);
assert.equal(parry.consumesStamina, true);
assert.ok(parry.perfectWindowMs > 0 && parry.perfectWindowMs < parry.windowMs);

const exhausted = resolvePlayerDefenseWindow({ action: 'dodge', mode: 'neutral', stamina: 0 });
assert.equal(exhausted.outcome, 'resource-gated');
assert.equal(exhausted.canExecute, false);

const recoveryBlock = resolvePlayerDefenseWindow({ action: 'block', mode: 'recovery', active: true });
assert.equal(recoveryBlock.canExecute, true);

const inactive = resolvePlayerDefenseWindow({ action: 'parry', mode: 'recovery', active: false });
assert.equal(inactive.outcome, 'inactive');

const malformed = resolvePlayerDefenseWindow({ action: 'unknown', mode: 'bad', staminaRatio: 'nope', poiseRatio: Infinity, bufferMs: -20 });
assert.equal(malformed.action, 'block');
assert.equal(malformed.mode, 'neutral');
assert.equal(malformed.bufferMs, 0);
assert.equal(Object.isFrozen(malformed), true);
assert.equal(serializePlayerDefenseWindow(parry), serializePlayerDefenseWindow(resolvePlayerDefenseWindow({ action: 'parry', mode: 'incoming', staminaRatio: 1, poiseRatio: 1, bufferMs: 80 })));

console.log('playerDefenseWindowDirector: PASS');
