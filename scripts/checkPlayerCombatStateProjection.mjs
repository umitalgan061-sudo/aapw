import assert from 'node:assert/strict';
import projectPlayerCombatState from '../src/3d/gameplay/playerCombatStateProjection.js';

const base = {
  action: 'heavy', health: 85, maxHealth: 100, stamina: 40, maxStamina: 60,
  poise: 30, maxPoise: 50, comboIndex: 2, lockedTargetId: 'enemy-7', equipmentRevision: 'loadout-3',
};

const first = projectPlayerCombatState(base);
const second = projectPlayerCombatState({ ...base });
assert.deepEqual(first, second);
assert.equal(first.action, 'heavy');
assert.equal(first.stance, 'combat');
assert.equal(first.health.ratio, 0.85);
assert.equal(first.stamina.ratio, 2 / 3);
assert.equal(first.lockOn.active, true);
assert.equal(first.capabilities.canAttack, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.capabilities), true);
assert.equal(first.digest, JSON.stringify(first, (key, value) => key === 'digest' ? undefined : value));

const guarded = projectPlayerCombatState({ ...base, action: 'parry' });
assert.equal(guarded.stance, 'guarding');
assert.equal(guarded.capabilities.canDodge, true);

const failClosed = projectPlayerCombatState({ action: 'unknown', health: 'bad', poise: 0, recovery: 8, lockedTargetId: 42 });
assert.equal(failClosed.action, 'idle');
assert.equal(failClosed.stance, 'stunned');
assert.equal(failClosed.alive, false);
assert.equal(failClosed.lockOn.active, false);
assert.equal(failClosed.capabilities.canAttack, false);
assert.equal(Number.isFinite(failClosed.health.ratio), true);

console.log('player combat state projection contract: PASS');
