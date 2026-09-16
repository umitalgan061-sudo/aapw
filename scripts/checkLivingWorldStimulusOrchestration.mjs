import assert from 'node:assert/strict';
import { normalizeLivingWorldStimulusBatch } from '../src/3d/gameplay/livingWorldStimulusNormalizer.js';
import { createLivingWorldStimulusMemory } from '../src/3d/gameplay/livingWorldStimulusMemory.js';
import { rankLivingWorldStimuli } from '../src/3d/gameplay/livingWorldStimulusSalience.js';
import { arbitrateLivingWorldIntent } from '../src/3d/gameplay/livingWorldIntentArbiter.js';
import { generateLivingWorldPlan } from '../src/3d/gameplay/livingWorldPlanGenerator.js';
import { createLivingWorldStimulusOrchestrator } from '../src/3d/gameplay/livingWorldStimulusOrchestrator.js';
import { createLivingWorldStimulusAdapter } from '../src/3d/gameplay/livingWorldStimulusAdapter.js';
import { livingWorldStimulusDigest, auditLivingWorldStimulusFrame, reorderInvariantStimuliDigest } from '../src/3d/gameplay/livingWorldStimulusAudit.js';

const actor = {
  id: 'wolf-alpha', position: { x: 0, y: 0, z: 0 }, staminaRatio: 0.8, healthRatio: 1,
  currentIntent: 'observe', capabilities: { canAttack: true, canAssist: true, canPursue: true },
};
const signals = [
  { id: 'danger-1', kind: 'threat', channel: 'visual', actorId: 'wolf-alpha', targetId: 'player', position: { x: 4, y: 0, z: 3 }, confidence: 1, intensity: 0.8, radius: 30, timestampMs: 1000, sequence: 2 },
  { id: 'noise-1', kind: 'noise', channel: 'auditory', actorId: 'player', position: { x: 8, y: 0, z: 0 }, confidence: 0.8, intensity: 0.4, radius: 50, timestampMs: 900, sequence: 1 },
  { id: 'weather-1', kind: 'weather', channel: 'environmental', position: { x: 0, y: 0, z: 0 }, confidence: 0.9, intensity: 0.3, persistent: true, timestampMs: 800, sequence: 0 },
];

const normalized = normalizeLivingWorldStimulusBatch(signals);
assert.equal(normalized.length, 3);
assert.equal(normalized[0].id, 'weather-1');
assert.equal(Object.isFrozen(normalized[0]), true);
assert.equal(normalizeLivingWorldStimulusBatch(new Array(600).fill(signals[0])).length, 256);

const memory = createLivingWorldStimulusMemory();
for (const signal of normalized) assert.equal(memory.accept(signal, 1), true);
assert.equal(memory.summary(1).size, 3);
assert.ok(memory.strongest({}, 1));
assert.equal(memory.query({ kind: 'threat' }, 1).length, 1);
assert.equal(memory.query({}, 1000).length, 0);
memory.dispose();
assert.equal(memory.accept(normalized[0], 1001), false);

const ranked = rankLivingWorldStimuli(normalized, { observerPosition: actor.position });
assert.equal(ranked.length, 3);
assert.ok(ranked[0].score >= ranked[1].score);
assert.ok(ranked.every((entry) => entry.score >= 0 && entry.score <= 1));

const decision = arbitrateLivingWorldIntent({ stimuli: ranked.map((entry) => ({ ...entry.stimulus, salience: entry.score })), state: actor, capabilities: actor.capabilities });
assert.ok(['attack', 'defend', 'alert', 'flee', 'observe', 'retreat', 'pursue'].includes(decision.intent));
assert.ok(decision.confidence >= 0 && decision.confidence <= 1);

const plan = generateLivingWorldPlan({ intent: decision.intent, confidence: decision.confidence, targetCandidates: [{ id: 'player', kind: 'threat', position: actor.position, score: 1 }], context: { tick: 4, urgency: decision.confidence } });
assert.ok(plan.steps.length >= 2);
assert.equal(plan.target.id, 'player');
assert.ok(plan.steps.every((step) => step.durationSeconds > 0 && step.durationSeconds <= 5));

const runtime = createLivingWorldStimulusOrchestrator();
const first = runtime.tickOnce({ deltaSeconds: 0.2, nowSeconds: 1, actors: [actor], signals });
const second = runtime.tickOnce({ deltaSeconds: 0.2, nowSeconds: 2, actors: [actor], signals: [] });
assert.equal(first.tick, 1);
assert.equal(second.tick, 2);
assert.ok(first.decisions.length >= 1);
assert.ok(first.stats.acceptedSignals >= 3);
const audited = auditLivingWorldStimulusFrame(first);
assert.equal(audited.valid, true);
assert.equal(audited.digest, livingWorldStimulusDigest(first));

const adapter = createLivingWorldStimulusAdapter();
let consumerFrames = 0;
const unsubscribe = adapter.subscribe('test', () => { consumerFrames += 1; });
const adapted = adapter.tick({ deltaSeconds: 0.2, nowSeconds: 1, actors: [actor], signals });
assert.equal(consumerFrames, 1);
assert.equal(adapted.audit.valid, true);
unsubscribe();
adapter.dispose();
assert.equal(adapter.disposed, true);

const invariant = reorderInvariantStimuliDigest(() => createLivingWorldStimulusOrchestrator(), { actors: [actor], signals });
assert.equal(invariant.equal, true, `reorder invariance failed: ${invariant.first} vs ${invariant.second}`);

runtime.dispose();
assert.equal(runtime.disposed, true);
console.log('living-world stimulus orchestration: PASS');
