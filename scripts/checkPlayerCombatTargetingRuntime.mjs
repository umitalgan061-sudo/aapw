import assert from 'node:assert/strict';
import { createPlayerCombatTargetingRuntime, PLAYER_COMBAT_TARGETING_EVENT } from '../src/3d/gameplay/playerCombatTargetingRuntime.js';

const events = [];
const target = {
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  dispatchEvent(event) { events.push(event); return true; },
};
const actors = [
  { id: 'alpha', position: { x: 0.4, z: 4 }, priority: 0, health: 0.8 },
  { id: 'bravo', position: { x: -0.6, z: 4.2 }, priority: 0, health: 0.8 },
];
const runtime = createPlayerCombatTargetingRuntime({
  target,
  options: { acquireScoreMargin: 0.5, lostGraceSeconds: 0.2 },
  isTargetVisible: (actor) => actor.id !== 'hidden',
});

const acquired = runtime.update({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors, deltaSeconds: 0.016 });
assert.equal(acquired.reason, 'acquire');
assert.ok(acquired.targetId);
assert.equal(runtime.lockedTargetId, acquired.targetId);

const nearTie = runtime.update({
  playerPosition: { x: 0, z: 0 },
  forward: { x: 0, z: 1 },
  actors: [
    { id: acquired.targetId, position: { x: 0.7, z: 4 }, priority: 0 },
    { id: acquired.targetId === 'alpha' ? 'bravo' : 'alpha', position: { x: -0.71, z: 4 }, priority: 0 },
  ],
  deltaSeconds: 0.016,
});
assert.equal(nearTie.targetId, acquired.targetId);
assert.equal(nearTie.reason, 'retain');

const hiddenActor = { id: acquired.targetId, position: { x: 0, z: 4 } };
const grace = runtime.update({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: [hiddenActor], deltaSeconds: 0.1 });
assert.equal(grace.reason, 'grace');
assert.equal(grace.visible, false);

const released = runtime.update({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors: [hiddenActor], deltaSeconds: 0.2 });
assert.equal(released.reason, 'release');
assert.equal(runtime.lockedTargetId, null);

const reacquired = runtime.update({ playerPosition: { x: 0, z: 0 }, forward: { x: 0, z: 1 }, actors, deltaSeconds: 0.016 });
assert.equal(reacquired.reason, 'acquire');
runtime.clear('manual');
assert.equal(runtime.lockedTargetId, null);
assert.equal(events.some((event) => event.type === PLAYER_COMBAT_TARGETING_EVENT), true);

console.log(JSON.stringify({ ok: true, suite: 'player-combat-targeting-runtime', events: events.length, acquired: acquired.targetId, final: runtime.lastSnapshot.reason }));
