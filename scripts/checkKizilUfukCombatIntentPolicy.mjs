import assert from 'node:assert/strict';
import { createCombatIntent, normalizeCombatAction, sortCombatIntents, validateCombatIntent } from '../src/3d/gameplay/playerCombatIntentPolicy.js';
import { createPlayerCombatActionRouter } from '../src/3d/gameplay/playerCombatActionRouter.js';

assert.equal(normalizeCombatAction('lightAttack'), 'light');
assert.equal(normalizeCombatAction('parryStart'), 'parry');
assert.equal(normalizeCombatAction('bowShot'), 'archery');
assert.equal(normalizeCombatAction('unknown'), null);

const intents = [
  createCombatIntent('light', 'keyboard', 100, 3),
  createCombatIntent('guard', 'gamepad', 101, 4),
  createCombatIntent('parryStart', 'touch', 102, 5),
  createCombatIntent('dodgeRoll', 'mouse', 103, 6),
];
assert.ok(intents.every(validateCombatIntent));
assert.deepEqual(sortCombatIntents(intents).map(({ kind }) => kind), ['parry', 'guard', 'dodge', 'light']);

const dispatched = [];
const target = {
  CustomEvent: class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init.detail; }
  },
  dispatchEvent(event) { dispatched.push(event); },
};
const router = createPlayerCombatActionRouter({ target, now: () => 1000 });
assert.equal(router.enqueue('lightAttack', 'keyboard', 1000), true);
assert.equal(router.enqueue('guardStart', 'gamepad', 1001), true);
assert.equal(router.enqueue('rangedAttack', 'mouse', 1002), true);
assert.equal(router.enqueue('not-real', 'keyboard', 1003), false);
assert.deepEqual(router.drain({ currentTime: 1003, max: 3 }).map(({ kind }) => kind), ['guard', 'ranged', 'light']);
assert.equal(router.emit('bowShot', 'touch', 1004), true);
assert.equal(dispatched[0].detail.kind, 'archery');
assert.equal(dispatched[0].detail.priority, 50);
router.reset();
assert.deepEqual(router.drain({ currentTime: 1004 }), []);

console.log('KIZIL_UFUK_COMBAT_INTENT_POLICY_PASS');
