import assert from 'node:assert/strict';
import { createLivingWorldStimulusOrchestrator } from '../src/3d/gameplay/livingWorldStimulusOrchestrator.js';
import { createLivingWorldStimulusWorkBudget } from '../src/3d/gameplay/livingWorldStimulusWorkBudget.js';
import { applyRoleTuningToIntentScores, getLivingWorldRoleProfile } from '../src/3d/gameplay/livingWorldStimulusRolePolicy.js';
import { normalizeLivingWorldStimulus } from '../src/3d/gameplay/livingWorldStimulusNormalizer.js';
import { scoreLivingWorldStimulus } from '../src/3d/gameplay/livingWorldStimulusSalience.js';

function makeActors(count = 100) {
  return Array.from({ length: count }, (_, index) => ({
    id: `actor-${index}`,
    position: { x: index % 10, y: 0, z: Math.floor(index / 10) },
    staminaRatio: ((index * 13) % 100) / 100,
    healthRatio: 0.5 + (((index * 7) % 50) / 100),
    capabilities: { canAttack: index % 9 !== 0, canAssist: true, canPursue: index % 11 !== 0 },
  }));
}

const actors = makeActors();
const signals = Array.from({ length: 300 }, (_, index) => ({
  id: `signal-${index}`,
  kind: index % 5 === 0 ? 'threat' : index % 3 === 0 ? 'noise' : 'sighting',
  channel: index % 2 ? 'visual' : 'auditory',
  actorId: `actor-${index % 100}`,
  targetId: index % 4 === 0 ? 'player' : null,
  position: { x: index % 10, y: 0, z: Math.floor(index / 10) },
  confidence: ((index * 17) % 100) / 100,
  intensity: ((index * 29) % 100) / 100,
  radius: 20 + (index % 50),
  timestampMs: index * 10,
  sequence: index,
}));

const firstRuntime = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 48, maxPlansPerTick: 12 } });
const first = firstRuntime.tickOnce({ deltaSeconds: 0.12, nowSeconds: 10, actors, signals });
assert.equal(first.stats.acceptedSignals, 48, 'per-tick signal ingress must be bounded');
assert.ok(first.decisions.length <= 12, 'plan generation must respect the hard plan budget');
assert.ok(first.memory.size <= 192, 'memory must remain bounded');

const secondRuntime = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 48, maxPlansPerTick: 12 } });
const second = secondRuntime.tickOnce({ deltaSeconds: 0.12, nowSeconds: 10, actors: [...actors].reverse(), signals: [...signals].reverse() });
assert.deepEqual(first.decisions.map((d) => [d.actorId, d.plan.planId]), second.decisions.map((d) => [d.actorId, d.plan.planId]), 'reordering must not change the semantic outcome');
assert.deepEqual(first.stats, second.stats, 'reordering must preserve aggregate stats');

const budget = createLivingWorldStimulusWorkBudget({ bucketCount: 8 });
const work = budget.select(actors.map((actor, index) => ({ ...actor, urgency: index % 20 === 0 ? 1 : 0.2 })), 20);
assert.equal(work.selected.length, 20);
assert.ok(work.selected.filter((actor) => actor.urgency >= 0.8).length <= 8, 'urgent work must be hard capped');
assert.equal(new Set(work.selected.map((actor) => actor.id)).size, work.selected.length);
assert.equal(work.buckets.length, 8);

const guard = budget.starvationSnapshot();
assert.ok(Array.isArray(guard.starving));
budget.reset();
assert.equal(budget.tick, 0);

const civilian = getLivingWorldRoleProfile('civilian');
const predator = getLivingWorldRoleProfile('predator');
assert.ok(civilian.caution > predator.caution);
const tuned = applyRoleTuningToIntentScores([
  { intent: 'attack', score: 0.7 },
  { intent: 'flee', score: 0.7 },
], 'civilian');
assert.notEqual(tuned[0].score, tuned[1].score, 'role tuning must differentiate intents');

const malformed = normalizeLivingWorldStimulus({ id: null, kind: { nope: true }, confidence: NaN, intensity: Infinity, position: { x: NaN, z: Infinity } }, 9);
assert.equal(malformed.kind, 'unknown');
assert.equal(malformed.position, null);
assert.equal(malformed.confidence, 0);
assert.equal(malformed.intensity, 0);

const nearThreat = normalizeLivingWorldStimulus({ id: 'near', kind: 'threat', channel: 'visual', position: { x: 1, y: 0, z: 1 }, confidence: 1, intensity: 1, radius: 50 });
const farThreat = normalizeLivingWorldStimulus({ id: 'far', kind: 'threat', channel: 'visual', position: { x: 1000, y: 0, z: 1000 }, confidence: 1, intensity: 1, radius: 50 });
assert.ok(scoreLivingWorldStimulus(nearThreat, { observerPosition: { x: 0, y: 0, z: 0 } }) > scoreLivingWorldStimulus(farThreat, { observerPosition: { x: 0, y: 0, z: 0 } }));

const historyRuntime = createLivingWorldStimulusOrchestrator({ policy: { historySize: 3 } });
for (let tick = 0; tick < 12; tick += 1) historyRuntime.tickOnce({ deltaSeconds: 0.2, nowSeconds: tick * 0.2, actors: [actors[tick]], signals: [signals[tick]] });
const history = historyRuntime.snapshot().history;
assert.equal(history.length, 3, 'history must obey configured bound');
historyRuntime.dispose();
firstRuntime.dispose();
secondRuntime.dispose();
assert.equal(firstRuntime.disposed, true);
assert.equal(secondRuntime.disposed, true);
console.log('living-world stimulus orchestration extended: PASS');
