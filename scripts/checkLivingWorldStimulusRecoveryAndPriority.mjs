import assert from 'node:assert/strict';
import { assessLivingWorldStimulusHealth, recoveryRecommendations, validateRecoveryHealth } from '../src/3d/gameplay/livingWorldStimulusRecovery.js';
import { resolveLivingWorldStimulusConflicts, priorityScore } from '../src/3d/gameplay/livingWorldStimulusPriorityPolicy.js';
import { createLivingWorldStimulusStarvationScheduler } from '../src/3d/gameplay/livingWorldStimulusStarvationScheduler.js';

const normal = assessLivingWorldStimulusHealth({ frame: { decisions: [], memory: { size: 1, maxRecords: 192 }, stats: {} }, telemetry: { counters: {} } });
assert.equal(normal.mode, 'normal');
assert.equal(validateRecoveryHealth(normal), true);
assert.ok(recoveryRecommendations(normal).length > 0);

const degraded = assessLivingWorldStimulusHealth({
  frame: { decisions: Array.from({ length: 12 }, () => ({})), memory: { size: 180, maxRecords: 192 }, stats: {} },
  telemetry: { counters: { 'consumer.errors': 4, 'audit.failures': 2 } },
});
assert.ok(['reduced', 'severe', 'safe'].includes(degraded.mode));
assert.ok(degraded.failures.length >= 1);
assert.ok(recoveryRecommendations(degraded).some((value) => value.includes('urgent')));

const duplicateSignals = [
  { id: 'perception', source: 'perception', kind: 'threat', targetId: 'player', position: { x: 1, y: 0, z: 1 }, confidence: 0.8, intensity: 0.8, timestampMs: 100 },
  { id: 'combat', source: 'combat', kind: 'threat', targetId: 'player', position: { x: 1.2, y: 0, z: 1.1 }, confidence: 0.82, intensity: 0.75, timestampMs: 110 },
  { id: 'weather', source: 'weather', kind: 'weather', position: { x: 2, y: 0, z: 3 }, confidence: 0.9, intensity: 0.4, timestampMs: 110 },
];
const resolved = resolveLivingWorldStimulusConflicts(duplicateSignals);
assert.equal(resolved.selected.length, 2);
assert.equal(resolved.suppressed.length, 1);
assert.equal(resolved.selected[0].stimulus.source, 'combat');
assert.ok(priorityScore(resolved.selected[0].stimulus) > 0);

const scheduler = createLivingWorldStimulusStarvationScheduler({ policy: { maxPerTick: 4, maxStarvationTicks: 10 } });
for (let tick = 0; tick < 15; tick += 1) scheduler.select([
  { id: 'urgent', urgency: 1, cooldownRatio: 0 },
  { id: 'normal-a', urgency: 0.1, cooldownRatio: 0 },
  { id: 'normal-b', urgency: 0.05, cooldownRatio: 0 },
  { id: 'normal-c', urgency: 0, cooldownRatio: 0 },
  { id: 'normal-d', urgency: 0, cooldownRatio: 0 },
], 2, 4);
const selected = scheduler.select([
  { id: 'urgent', urgency: 1 },
  { id: 'normal-a', urgency: 0 },
  { id: 'normal-b', urgency: 0 },
  { id: 'normal-c', urgency: 0 },
  { id: 'normal-d', urgency: 0 },
], 2, 4);
assert.equal(selected.selected.length, 2);
assert.equal(selected.selected[0].id, 'urgent');
assert.ok(selected.starvation.some((value) => value.ticks >= 1));
scheduler.reset();
assert.equal(scheduler.tick, 0);
console.log('living-world stimulus recovery/priority: PASS');
