import assert from 'node:assert/strict';
import { createLivingWorldStimulusOrchestrator } from '../src/3d/gameplay/livingWorldStimulusOrchestrator.js';
import { livingWorldStimulusDigest, auditLivingWorldStimulusFrame } from '../src/3d/gameplay/livingWorldStimulusAudit.js';

const cases = [
  {
    name: 'silent village',
    actors: [{ id: 'villager', role: 'civilian', position: { x: 0, y: 0, z: 0 }, staminaRatio: 1, healthRatio: 1 }],
    signals: [],
  },
  {
    name: 'guarded alarm',
    actors: [{ id: 'guard', role: 'guard', position: { x: 0, y: 0, z: 0 }, staminaRatio: 0.8, healthRatio: 1, capabilities: { canAttack: true, canPursue: true } }],
    signals: [{ id: 'alarm', kind: 'alarm', channel: 'auditory', position: { x: 4, y: 0, z: 0 }, confidence: 0.95, intensity: 0.85, radius: 40, timestampMs: 10, sequence: 1 }],
  },
  {
    name: 'hunter threat',
    actors: [{ id: 'hunter', role: 'hunter', position: { x: 2, y: 0, z: 2 }, staminaRatio: 0.9, healthRatio: 0.95, capabilities: { canAttack: true, canPursue: true } }],
    signals: [
      { id: 'threat', kind: 'threat', channel: 'visual', actorId: 'hunter', targetId: 'prey', position: { x: 3, y: 0, z: 3 }, confidence: 1, intensity: 0.8, radius: 60, timestampMs: 20, sequence: 2 },
      { id: 'noise', kind: 'noise', channel: 'auditory', position: { x: 10, y: 0, z: 8 }, confidence: 0.6, intensity: 0.35, radius: 30, timestampMs: 19, sequence: 1 },
    ],
  },
  {
    name: 'injured predator',
    actors: [{ id: 'beast', role: 'predator', position: { x: 1, y: 0, z: 1 }, staminaRatio: 0.1, healthRatio: 0.12, inCombat: true }],
    signals: [{ id: 'damage', kind: 'damage', channel: 'tactical', actorId: 'beast', position: { x: 1, y: 0, z: 1 }, confidence: 1, intensity: 0.9, radius: 12, timestampMs: 30, sequence: 1 }],
  },
  {
    name: 'fire and weather',
    actors: [{ id: 'traveler', role: 'traveler', position: { x: 0, y: 0, z: 0 }, staminaRatio: 0.7, healthRatio: 0.9 }],
    signals: [
      { id: 'fire', kind: 'fire', channel: 'environmental', position: { x: 5, y: 0, z: 0 }, confidence: 0.95, intensity: 0.9, radius: 20, timestampMs: 40, sequence: 1 },
      { id: 'storm', kind: 'weather', channel: 'environmental', position: { x: 0, y: 0, z: 0 }, confidence: 0.8, intensity: 0.7, radius: 100, timestampMs: 41, sequence: 2, metadata: { persistent: true } },
    ],
  },
];

function runCase(testCase, reverse = false) {
  const runtime = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 48, maxPlansPerTick: 12, historySize: 8 } });
  const frame = runtime.tickOnce({
    deltaSeconds: 0.1,
    nowSeconds: 1,
    actors: reverse ? [...testCase.actors].reverse() : testCase.actors,
    signals: reverse ? [...testCase.signals].reverse() : testCase.signals,
  });
  const audit = auditLivingWorldStimulusFrame(frame);
  const digest = livingWorldStimulusDigest(frame);
  runtime.dispose();
  return { frame, audit, digest };
}

for (const testCase of cases) {
  const first = runCase(testCase, false);
  const second = runCase(testCase, true);
  assert.equal(first.audit.valid, true, `${testCase.name}: audit should pass`);
  assert.equal(first.digest, second.digest, `${testCase.name}: replay digest must be reorder invariant`);
  assert.deepEqual(first.frame.stats, second.frame.stats);
}

const longRun = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 24, maxPlansPerTick: 8, historySize: 5 } });
let previousDigest = '';
for (let tick = 0; tick < 50; tick += 1) {
  const frame = longRun.tickOnce({
    deltaSeconds: 0.1,
    nowSeconds: tick * 0.1,
    actors: [{ id: 'replay-actor', role: tick % 2 ? 'guard' : 'prey', position: { x: 0, y: 0, z: 0 }, staminaRatio: 0.7, healthRatio: 1 }],
    signals: tick % 4 === 0 ? [{ id: `signal-${tick}`, kind: 'threat', channel: 'visual', targetId: 'replay-actor', position: { x: 3, y: 0, z: 2 }, confidence: 0.9, intensity: 0.7, radius: 20, timestampMs: tick, sequence: tick }] : [],
  });
  const digest = livingWorldStimulusDigest(frame);
  assert.notEqual(digest.length, 0);
  if (tick > 0) assert.ok(frame.memory.size <= 192);
  previousDigest = digest;
}
assert.equal(longRun.snapshot().history.length, 5);
assert.ok(previousDigest.length > 0);
longRun.dispose();
console.log(`living-world stimulus replay corpus: PASS (${cases.length} scenarios + 50-tick trace)`);
