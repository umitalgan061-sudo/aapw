import assert from 'node:assert/strict';
import { createPlayerVitalsCombatFrame, isPlayerVitalsCombatFrame } from '../src/3d/gameplay/playerVitalsCombatFrame.ts';

const healthy = createPlayerVitalsCombatFrame({ health: 100, stamina: 100, poise: 100, isGrounded: true });
assert.equal(healthy.combatState, 'idle');
assert.equal(healthy.presentationSeverity, 'clear');
assert.ok(Object.isFrozen(healthy));

const attack = createPlayerVitalsCombatFrame({ health: 60, stamina: 20, poise: 80, attackKind: 'heavy', attackActive: true, attackComboStep: 2, isGrounded: true });
assert.equal(attack.combatState, 'attack');
assert.equal(attack.attackComboStep, 2);
assert.equal(attack.locomotionLocked, true);
assert.equal(attack.presentationSeverity, 'warning');

const guardBreak = createPlayerVitalsCombatFrame({ health: 20, stamina: 0, poise: 0, guardBreakRemaining: 0.5, guarding: true });
assert.equal(guardBreak.combatState, 'guard-break');
assert.equal(guardBreak.presentationSeverity, 'critical');
assert.equal(guardBreak.locomotionLocked, true);

const a = createPlayerVitalsCombatFrame({ stamina: 44, poise: 72, attackKind: 'light', attackComboStep: 1 });
const b = createPlayerVitalsCombatFrame({ poise: 72, attackComboStep: 1, attackKind: 'light', stamina: 44 });
assert.deepEqual(a, b);
assert.ok(isPlayerVitalsCombatFrame(a));
assert.equal(isPlayerVitalsCombatFrame({}), false);

console.log('player vitals combat frame checks passed');
