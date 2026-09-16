import assert from 'node:assert/strict';
import { createLivingWorldStimulusSnapshot, serializeLivingWorldStimulusSnapshot, parseLivingWorldStimulusSnapshot, snapshotDigest } from '../src/3d/gameplay/livingWorldStimulusSnapshot.js';

const snapshot = createLivingWorldStimulusSnapshot({
  tick: 42,
  nowSeconds: 4.2,
  actors: [
    { id: 'b', role: 'guard', position: { x: 2, y: 0, z: 3 }, staminaRatio: 0.8, healthRatio: 1 },
    { id: 'a', role: 'civilian', position: { x: 0, y: 0, z: 0 }, staminaRatio: 1, healthRatio: 1 },
  ],
  signals: [
    { id: 's2', kind: 'noise', channel: 'auditory', timestampMs: 20, sequence: 2, confidence: 0.4, intensity: 0.8 },
    { id: 's1', kind: 'threat', channel: 'visual', timestampMs: 10, sequence: 1, confidence: 0.9, intensity: 0.7 },
  ],
  plans: [
    { actorId: 'b', intent: 'defend', confidence: 0.8, planId: 'p2' },
    { actorId: 'a', intent: 'observe', confidence: 0.3, planId: 'p1' },
  ],
  metadata: { source: 'test', session: 'snapshot-1' },
});
assert.equal(snapshot.schema.includes('living-world-stimulus-snapshot'), true);
assert.equal(snapshot.actors[0].id, 'a');
assert.equal(snapshot.signals[0].id, 's1');
assert.equal(snapshot.plans[0].actorId, 'a');
const serialized = serializeLivingWorldStimulusSnapshot(snapshot);
const parsed = parseLivingWorldStimulusSnapshot(serialized);
assert.ok(parsed);
assert.deepEqual(parsed, snapshot);
assert.equal(snapshotDigest(parsed), snapshotDigest(snapshot));
assert.equal(parseLivingWorldStimulusSnapshot('{"schema":"wrong"}'), null);
assert.equal(parseLivingWorldStimulusSnapshot('not-json'), null);
const bounded = createLivingWorldStimulusSnapshot({ actors: Array.from({ length: 500 }, (_, i) => ({ id: `a-${i}` })), signals: Array.from({ length: 500 }, (_, i) => ({ id: `s-${i}` })) });
assert.equal(bounded.actors.length, 128);
assert.equal(bounded.signals.length, 256);
console.log('living-world stimulus snapshot: PASS');
