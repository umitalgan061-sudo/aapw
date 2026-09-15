import assert from 'node:assert/strict';
import { routeFaunaSignals, applyFaunaSignals, auditFaunaSignals } from '../src/3d/gameplay/livingWorldFaunaSignalRouter.js';

const input = {
  seed: 'signal-proof', tick: 3,
  groups: [
    { id: 'pack-1', species: 'wolf', position: { x: 0, z: 0 }, memberIds: ['wolf-1', 'wolf-2'], state: 'roam', habitatId: 'forest' },
    { id: 'herd-1', species: 'deer', position: { x: 40, z: 0 }, memberIds: ['deer-1'], state: 'graze', habitatId: 'forest' },
  ],
  members: [
    { id: 'wolf-1', groupId: 'pack-1', species: 'wolf', position: { x: 0, z: 0 }, lod: 'near' },
    { id: 'wolf-2', groupId: 'pack-1', species: 'wolf', position: { x: 2, z: 0 }, lod: 'distant' },
    { id: 'deer-1', groupId: 'herd-1', species: 'deer', position: { x: 40, z: 0 }, lod: 'offscreen' },
  ],
  observations: [{ id: 'player-sight', sourceId: 'player', kind: 'vision', visible: true, hostile: true, confidence: 1, position: { x: 8, z: 0 }, radiusMeters: 25 }],
};
const a = routeFaunaSignals(input);
const b = routeFaunaSignals(input);
assert.deepEqual(a, b);
assert.equal(a.deterministic, true);
assert.ok(a.signals.length >= 2);
assert.ok(a.events.some((event) => event.type === 'fauna-pack-alert'));
assert.ok(a.updates.some((update) => update.id === 'wolf-1' && update.state === 'flee'));
assert.ok(a.updates.some((update) => update.id === 'deer-1' && update.simulatedOffscreen === true));
assert.equal(auditFaunaSignals(a).ok, true);
const calls = [];
const applied = applyFaunaSignals(a, { updateActor: (u) => calls.push(`u:${u.id}`), emitWorldEvent: (e) => calls.push(`e:${e.type}`) });
assert.equal(applied.delegated, calls.length);
console.log('FAUNA_SIGNAL_ROUTER_OK');
