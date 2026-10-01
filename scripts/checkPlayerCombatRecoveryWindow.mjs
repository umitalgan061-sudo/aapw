import assert from 'node:assert/strict';
import { projectCombatRecoveryWindow, validateCombatRecoveryWindow } from '../src/3d/gameplay/playerCombatRecoveryWindow.js';

const dodge = projectCombatRecoveryWindow({ phase: 'dodge', elapsedSeconds: 0.1 });
assert.equal(dodge.phase, 'dodge');
assert.equal(dodge.invulnerable, true);
assert.equal(dodge.recoveryLocked, true);
assert.equal(validateCombatRecoveryWindow(dodge), true);

const stagger = projectCombatRecoveryWindow({ phase: 'hit-stagger', elapsedSeconds: 0.32 });
assert.equal(stagger.remainingSeconds, 0);
assert.equal(stagger.canQueueAttack, true);
assert.equal(stagger.canTurn, false);

const malformed = projectCombatRecoveryWindow({ phase: '???', elapsedSeconds: NaN, recoverySeconds: Infinity });
assert.equal(malformed.phase, 'idle');
assert.equal(malformed.elapsedSeconds, 0);
assert.equal(malformed.remainingSeconds, 0);
assert.equal(Object.isFrozen(malformed), true);

const first = projectCombatRecoveryWindow({ phase: 'guard-break', elapsedSeconds: 0.2 });
const second = projectCombatRecoveryWindow({ elapsedSeconds: 0.2, phase: 'guard-break' });
assert.deepEqual(first, second);
assert.equal(validateCombatRecoveryWindow(first), true);

console.log('player combat recovery window regression: ok');
