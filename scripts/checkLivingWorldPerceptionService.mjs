import assert from 'node:assert/strict';
import { createLivingWorldPerceptionService } from '../src/3d/gameplay/livingWorldPerceptionService.js';

const calls = [];
const perception = createLivingWorldPerceptionService({
  maxSignals: 2,
  source: {
    sense: (actor, nowSeconds) => {
      calls.push({ actorId: actor.id, nowSeconds });
      return [
        { id: 'late-duplicate', kind: 'visual', targetId: 'raider-1', position: { x: 5, z: 0 }, confidence: 0.7, distanceMeters: 5, visible: true, suspicious: true },
        { id: 'best-duplicate', kind: 'visual', targetId: 'raider-1', position: { x: 5, z: 0 }, confidence: 1, distanceMeters: 5, visible: true, suspicious: true, factionId: 'raiders', wanted: 80 },
        { id: 'silent-noise', kind: 'unknown', targetId: 'noise-1', confidence: 1, distanceMeters: 1 },
        { id: 'wolf-heard', kind: 'audio', targetId: 'wolf-1', confidence: 0.8, distanceMeters: 12, audible: true, factionId: 'wildlife' },
      ];
    },
  },
});

const actor = { id: 'guard-1' };
const first = perception.sense(actor, 1.5, { lod: 'near' });
assert.equal(calls.length, 1);
assert.equal(first.length, 2);
assert.equal(first[0].id, 'best-duplicate');
assert.equal(first[0].target.id, 'raider-1');
assert.equal(first[0].target.wanted, 80);
assert.equal(first[1].id, 'wolf-heard');
assert.ok(first.every((signal) => signal.visible || signal.audible));

const reversed = createLivingWorldPerceptionService({
  maxSignals: 2,
  source: {
    sense: () => [...first].reverse(),
  },
});
const second = reversed.sense(actor, 1.5);
assert.deepEqual(second, first);

const rejectInvisible = createLivingWorldPerceptionService({
  source: { sense: () => [{ id: 'ghost', targetId: 'ghost', confidence: 1 }] },
});
assert.deepEqual(rejectInvisible.sense(actor, 0), []);

console.log(JSON.stringify({ marker: 'PERCEPTION_SERVICE_OK', signals: first.map((signal) => signal.id), count: first.length }));
