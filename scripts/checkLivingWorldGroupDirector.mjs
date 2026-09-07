import assert from 'node:assert/strict';
import { createLivingWorldAgent } from '../src/3d/gameplay/livingWorldDirector.js';
import { createLivingWorldGroup } from '../src/3d/gameplay/livingWorldGroupDirector.js';

const make = (id, x, z, kind = 'npc') => ({
  kind,
  agent: createLivingWorldAgent({ id, role: kind === 'creature' ? 'wildlife' : 'guard', home: { x, z }, simulationLod: { step: (delta) => Math.min(0.1, Math.max(0, delta)) } }),
  controller: { object3D: { position: { x, y: 0, z }, userData: {} } },
});

const events = [];
const members = [make('guard-a', 0, 0), make('guard-b', 4, 0), make('guard-c', 50, 0)];
const group = createLivingWorldGroup({ id: 'group:north:0', members, maxPropagationPerTick: 1, cohesionRadiusMeters: 10, onGroupEvent: (event) => events.push(event) });
assert.equal(group.leaderId, 'guard-a');
const alerted = group.tick(0.1, { targetPosition: { x: 3, z: 0 }, threat: true });
assert.equal(alerted.leaderId, 'guard-a');
assert.equal(alerted.propagated.length, 1);
assert.equal(alerted.propagated[0].id, 'guard-b');
assert.equal(events.at(-1).type, 'alert-propagated');
const calm = group.tick(0.25, { targetPosition: null, threat: false });
assert.ok(calm.alertLevel < alerted.alertLevel);
for (let i = 0; i < 10; i += 1) group.tick(0.25, { targetPosition: null, threat: false });
assert.equal(group.alertLevel, 0);
assert.equal(events.at(-1).type, 'alert-cleared');
assert.deepEqual(group.snapshot().memberIds, ['guard-a', 'guard-b', 'guard-c']);
console.log('LIVING_WORLD_GROUP_DIRECTOR_CONTRACT_PASS');
