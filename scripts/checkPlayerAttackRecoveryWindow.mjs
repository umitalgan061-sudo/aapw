import assert from 'node:assert/strict';
import { resolvePlayerAttackRecoveryWindow } from '../src/3d/gameplay/playerAttackRecoveryWindow.js';

const light = resolvePlayerAttackRecoveryWindow({ action: 'lightAttack', progress: 0.8, bufferedAction: 'heavyAttack' });
assert.equal(light.action, 'light');
assert.equal(light.phase, 'recovery');
assert.equal(light.cancelable, true);
assert.equal(light.queueAccepted, true);
assert.equal(light.bufferedAction, 'heavy');

const blocked = resolvePlayerAttackRecoveryWindow({ action: 'heavy', progress: 0.9, bufferedAction: 'light', stunned: true });
assert.equal(blocked.cancelable, false);
assert.equal(blocked.queueAccepted, false);
assert.equal(blocked.bufferedAction, null);

const active = resolvePlayerAttackRecoveryWindow({ action: 'ranged', progress: 0.5 });
assert.equal(active.phase, 'active');
assert.equal(active.remainingRecovery, 0.42);

const malformed = resolvePlayerAttackRecoveryWindow({ action: '???', progress: Number.NaN, grounded: 0 });
assert.equal(malformed.action, 'light');
assert.equal(malformed.progress, 0);
assert.equal(malformed.cancelable, false);
assert.ok(Object.isFrozen(malformed));
assert.deepEqual(JSON.stringify(light), JSON.stringify(resolvePlayerAttackRecoveryWindow({ action: 'lightAttack', progress: 0.8, bufferedAction: 'heavyAttack' })));
console.log('PLAYER_ATTACK_RECOVERY_WINDOW_OK');
