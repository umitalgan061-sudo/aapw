import assert from 'node:assert/strict';
import { createLivingWorldStimulusSnapshot, snapshotDigest } from '../src/3d/gameplay/livingWorldStimulusSnapshot.js';
import { resolveLivingWorldStimulusConflicts } from '../src/3d/gameplay/livingWorldStimulusPriorityPolicy.js';
import { assessLivingWorldStimulusHealth, recoveryRecommendations } from '../src/3d/gameplay/livingWorldStimulusRecovery.js';
import { createLivingWorldStimulusBatchCoordinator } from '../src/3d/gameplay/livingWorldStimulusBatchCoordinator.js';

const batch = createLivingWorldStimulusBatchCoordinator();
batch.push('perception', [{ id: 'same', kind: 'threat', channel: 'visual', position: { x: 0, y: 0, z: 0 }, confidence: 0.8, intensity: 0.8, timestampMs: 1 }], 0);
batch.push('combat', [{ id: 'same-combat', kind: 'threat', channel: 'tactical', position: { x: 0.2, y: 0, z: 0.1 }, confidence: 0.9, intensity: 0.9, timestampMs: 1.1 }], 0);
const sealed = batch.seal(0.1);
const conflict = resolveLivingWorldStimulusConflicts(sealed.signals);
assert.ok(conflict.selected.length >= 1);
const snapshot = createLivingWorldStimulusSnapshot({ tick: 1, nowSeconds: 0.1, signals: conflict.selected.map((x) => x.stimulus), plans: [] });
assert.equal(snapshotDigest(snapshot), snapshotDigest(createLivingWorldStimulusSnapshot({ tick: 1, nowSeconds: 0.1, signals: [...conflict.selected.map((x) => x.stimulus)].reverse(), plans: [] })));
const health = assessLivingWorldStimulusHealth({ frame: { decisions: [], memory: { size: 0, maxRecords: 192 } }, telemetry: { counters: {} } });
assert.equal(health.mode, 'normal');
assert.ok(recoveryRecommendations(health).length > 0);
batch.dispose();
console.log('living-world stimulus final contract: PASS');
