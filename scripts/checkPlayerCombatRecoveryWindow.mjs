import assert from 'node:assert/strict';
import {
  canAcceptPlayerCombatRecoveryAction,
  resolvePlayerCombatRecoveryWindow,
} from '../src/3d/gameplay/playerCombatRecoveryWindow.js';

const windup = resolvePlayerCombatRecoveryWindow({ phase: 'windup', action: 'light', comboIndex: 1, elapsedSeconds: 0.05 });
assert.equal(windup.phase, 'windup');
assert.equal(windup.cancelable, true);
assert.equal(windup.queueable, true);
assert.equal(canAcceptPlayerCombatRecoveryAction(windup, 'heavy'), true);
assert.equal(canAcceptPlayerCombatRecoveryAction(windup, 'unknown'), false);

const active = resolvePlayerCombatRecoveryWindow({ phase: 'active', action: 'heavy', elapsedSeconds: 0.04 });
assert.equal(active.reason, 'queue-window');
assert.equal(active.acceptedActions.includes('dodge'), true);

const recoveryEarly = resolvePlayerCombatRecoveryWindow({ phase: 'recovery', action: 'light', elapsedSeconds: 0.1 });
assert.equal(recoveryEarly.cancelable, false);
assert.equal(recoveryEarly.queueable, false);
assert.deepEqual(recoveryEarly.acceptedActions, ['dodge', 'block']);

const recoveryTail = resolvePlayerCombatRecoveryWindow({ phase: 'recovery', action: 'light', elapsedSeconds: 0.38 });
assert.equal(recoveryTail.reason, 'recovery-tail');
assert.equal(recoveryTail.cancelable, true);
assert.equal(recoveryTail.queueable, true);

const terminal = resolvePlayerCombatRecoveryWindow({ phase: 'defeated', action: 'light', elapsedSeconds: 0.1 });
assert.equal(terminal.cancelable, false);
assert.equal(terminal.queueable, false);
assert.deepEqual(terminal.acceptedActions, []);

const bounded = resolvePlayerCombatRecoveryWindow({ phase: '???', action: 'light', comboIndex: 999, elapsedSeconds: 999 }, {
  recoverySeconds: 99,
  maxComboIndex: 99,
});
assert.equal(bounded.phase, 'idle');
assert.equal(bounded.comboIndex, 9);
assert.equal(bounded.elapsedSeconds, 10);
assert.equal(bounded.durationSeconds, 0);

assert.deepEqual(
  resolvePlayerCombatRecoveryWindow({ phase: 'recovery', action: 'light', elapsedSeconds: 0.38 }),
  resolvePlayerCombatRecoveryWindow({ phase: 'recovery', action: 'light', elapsedSeconds: 0.38 }),
);

console.log(JSON.stringify({ ok: true, contract: 'player-combat-recovery-window' }));
