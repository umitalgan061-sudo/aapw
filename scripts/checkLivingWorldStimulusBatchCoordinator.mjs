import assert from 'node:assert/strict';
import { createLivingWorldStimulusBatchCoordinator } from '../src/3d/gameplay/livingWorldStimulusBatchCoordinator.js';

const coordinator = createLivingWorldStimulusBatchCoordinator({ policy: { maxSignalsPerFrame: 24, maxPending: 32, maxSources: 4 } });
for (let source = 0; source < 4; source += 1) {
  const signals = Array.from({ length: 16 }, (_, index) => ({
    id: `${source}-${index}`,
    kind: index % 2 ? 'noise' : 'threat',
    channel: index % 2 ? 'auditory' : 'visual',
    actorId: `actor-${index % 8}`,
    position: { x: index, y: 0, z: source },
    confidence: 0.8,
    intensity: 0.5,
    timestampMs: index,
  }));
  assert.equal(coordinator.push(`source-${source}`, signals, 1), true);
}
const before = coordinator.inspect();
assert.equal(before.sourceCount, 4);
assert.ok(before.pendingSignals <= 128);
const frame = coordinator.seal(1.1);
assert.ok(frame.signals.length <= 24);
assert.ok(frame.signals.every((signal) => signal.id));
assert.equal(coordinator.inspect().pendingSignals, 0);

const stale = createLivingWorldStimulusBatchCoordinator();
stale.push('late', [{ id: 'old', kind: 'noise', channel: 'auditory', timestampMs: 0 }], 0);
const staleFrame = stale.seal(10);
assert.equal(staleFrame.signals.length, 0);
stale.dispose();
assert.equal(stale.push('late', [{ id: 'x' }], 1), false);
assert.equal(stale.seal(2).disposed, true);

coordinator.reset();
assert.equal(coordinator.inspect().pendingSignals, 0);
coordinator.dispose();
assert.equal(coordinator.disposed, true);
console.log('living-world stimulus batch coordinator: PASS');
