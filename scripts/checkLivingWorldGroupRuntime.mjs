import assert from 'node:assert/strict';
import { createLivingWorldGroup } from '../src/3d/gameplay/livingWorldGroupDirector.js';

const events = [];
const make = (id, x, z, kind = 'npc') => ({
  id,
  kind,
  position: { x, z },
  agent: {
    id,
    state: 'patrol',
    observe(input) {
      this.lastObserve = input;
      this.state = input.threat ? 'threatened' : 'investigating';
      return { state: this.state };
    },
  },
});

const leader = make('guard-a', 0, 0);
const near = make('guard-b', 4, 0);
const far = make('guard-c', 40, 0);
const group = createLivingWorldGroup({
  id: 'group:guards:0',
  members: [far, near, leader],
  alertRadiusMeters: 12,
  cohesionRadiusMeters: 10,
  maxPropagationPerTick: 1,
  onGroupEvent: (event) => events.push(event),
});

const calm = group.tick(0.1, { targetPosition: { x: 100, z: 0 }, threat: true });
assert.equal(calm.leaderId, 'guard-a');
assert.equal(calm.propagated.length, 0);

const alert = group.tick(0.1, { targetPosition: { x: 6, z: 0 }, threat: true });
assert.equal(alert.propagated.length, 1);
assert.equal(alert.propagated[0].id, 'guard-b');
assert.equal(near.agent.lastObserve.targetPosition.x, 6);
assert.deepEqual(alert.rejected, []);
assert.ok(events.some((event) => event.type === 'alert-propagated'));

const rejected = group.tick(0.1, {
  targetPosition: { x: 6, z: 0 },
  threat: true,
  sampleGeography: () => ({ ok: false, reason: 'steep-exposure' }),
});
assert.equal(rejected.propagated.length, 0);
assert.equal(rejected.rejected[0].reason, 'steep-exposure');
assert.ok(rejected.cohesionViolations.includes('guard-c'));

const snapshot = group.snapshot();
assert.deepEqual(snapshot.memberIds, ['guard-a', 'guard-b', 'guard-c']);
assert.equal(typeof snapshot.formationSeed, 'number');
console.log(JSON.stringify({ ok: true, leader: snapshot.leaderId, propagated: alert.propagated, rejected: rejected.rejected }));
console.log('LIVING_WORLD_GROUP_RUNTIME_PASS');
