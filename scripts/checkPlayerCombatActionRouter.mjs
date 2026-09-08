import assert from 'node:assert/strict';
import { createPlayerCombatActionRouter, PLAYER_COMBAT_INPUT_EVENT } from '../src/3d/gameplay/playerCombatActionRouter.js';

const emitted = [];
const target = { CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, dispatchEvent(event) { emitted.push(event); return true; } };
let clock = 1000;
const router = createPlayerCombatActionRouter({ target, now: () => clock });

assert.equal(router.emit('lightAttack', 'gamepad'), true);
assert.equal(emitted[0].type, PLAYER_COMBAT_INPUT_EVENT);
assert.deepEqual(emitted[0].detail, { kind: 'light', source: 'gamepad', sequence: 1, timestamp: 1000 });
assert.equal(router.emit('heavyAttack', 'touch', 1100), true);
assert.equal(emitted[1].detail.kind, 'heavy');
assert.equal(router.enqueue('dodge', 'keyboard'), false);
router.enqueue('light', 'keyboard', 100);
clock = 2000;
assert.deepEqual(router.drain(), []);
router.enqueue('light', 'keyboard', 2000);
router.enqueue('heavy', 'keyboard', 2001);
assert.deepEqual(router.drain({ max: 1 }).map(({ kind }) => kind), ['light']);
assert.deepEqual(router.drain().map(({ kind }) => kind), ['heavy']);
router.reset();
assert.deepEqual(router.drain(), []);
console.log('player combat action router contract: PASS');
