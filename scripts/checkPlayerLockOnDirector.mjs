import assert from 'node:assert/strict';
import { createPlayerLockOnDirector, isPlayerLockOnState, PLAYER_LOCK_ON_EVENT } from '../src/3d/gameplay/playerLockOnDirector.ts';

const events = [];
const target = {
  addEventListener() {},
  dispatchEvent(event) { events.push(event); return true; },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
};

const director = createPlayerLockOnDirector({
  equipmentProvider: () => ({ mainHand: { id: 'iron-sword', reachMultiplier: 1 }, chest: { id: 'leather', staminaDrainMultiplier: 1 } }),
  target,
});

const acquired = director.acquire([
  { id: 'far', distanceMeters: 9, angleRad: 0.8, priority: 0.1 },
  { id: 'near', distanceMeters: 4, angleRad: 0.2, priority: 0.4 },
]);
assert.equal(acquired.active, true);
assert.equal(acquired.targetId, 'near');
assert.equal(acquired.rules.eligible, true);
assert.ok(acquired.score > 0);
assert.equal(events.at(-1).type, PLAYER_LOCK_ON_EVENT);
assert.equal(isPlayerLockOnState(acquired), true);

const refreshed = director.refresh([{ id: 'near', distanceMeters: 5, angleRad: 0.25, priority: 0.4 }]);
assert.equal(refreshed.active, true);
assert.equal(refreshed.targetId, 'near');
assert.equal(refreshed.rules.maintain, true);

const broken = director.refresh([{ id: 'near', distanceMeters: 99, angleRad: 0.25, priority: 0.4 }]);
assert.equal(broken.active, false);
assert.equal(broken.reason, 'break-lock');

const noTarget = director.acquire([
  { id: 'behind', distanceMeters: 3, angleRad: 2.4, priority: 1 },
  { id: 'dead', distanceMeters: 2, angleRad: 0.1, alive: false },
]);
assert.equal(noTarget.active, false);
assert.equal(noTarget.targetId, null);

const historyLength = director.readHistory().length;
assert.ok(historyLength >= 4);
director.dispose();
assert.equal(director.readHistory().length, 0);

console.log('checkPlayerLockOnDirector: PASS');
