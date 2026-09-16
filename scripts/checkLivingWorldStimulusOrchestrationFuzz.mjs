import assert from 'node:assert/strict';
import { createLivingWorldStimulusOrchestrator } from '../src/3d/gameplay/livingWorldStimulusOrchestrator.js';
import { createLivingWorldStimulusDecisionRuntime } from '../src/3d/gameplay/livingWorldStimulusDecisionRuntime.js';

function value(seed, index) {
  const x = Math.imul(seed ^ (index * 2654435761), 1597334677) >>> 0;
  return x / 0xffffffff;
}

function fuzzSignal(seed, index) {
  const strange = index % 11 === 0;
  return {
    id: `fuzz-${index}`,
    kind: index % 7 === 0 ? { nope: true } : ['threat', 'noise', 'combat', 'sighting', 'weather'][index % 5],
    channel: ['visual', 'auditory', 'tactical', 'environmental'][index % 4],
    actorId: `actor-${index % 32}`,
    targetId: index % 3 === 0 ? 'player' : null,
    position: strange ? { x: NaN, y: Infinity, z: -Infinity } : { x: (value(seed, index) - 0.5) * 200, y: 0, z: (value(seed + 3, index) - 0.5) * 200 },
    confidence: strange ? NaN : value(seed, index),
    intensity: index % 13 === 0 ? Infinity : value(seed + 7, index),
    radius: index % 17 === 0 ? -100 : value(seed + 11, index) * 100,
    timestampMs: index * 16,
    sequence: index,
  };
}

const actors = Array.from({ length: 48 }, (_, index) => ({
  id: `actor-${index}`,
  position: { x: index * 1.4, y: 0, z: index % 4 },
  staminaRatio: index % 5 === 0 ? NaN : value(13, index),
  healthRatio: index % 9 === 0 ? Infinity : value(19, index),
  role: ['civilian', 'guard', 'hunter', 'predator', 'prey'][index % 5],
  capabilities: { canAttack: index % 10 !== 0, canAssist: true, canPursue: index % 8 !== 0 },
}));

for (const seed of [1, 7, 17, 31, 97]) {
  const signals = Array.from({ length: 500 }, (_, index) => fuzzSignal(seed, index));
  const runtimeA = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 64, maxPlansPerTick: 16 } });
  const runtimeB = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 64, maxPlansPerTick: 16 } });
  const a = runtimeA.tickOnce({ deltaSeconds: 0.16, nowSeconds: 10, actors, signals });
  const b = runtimeB.tickOnce({ deltaSeconds: 0.16, nowSeconds: 10, actors: [...actors].reverse(), signals: [...signals].reverse() });
  assert.ok(a.decisions.length <= 16);
  assert.ok(a.memory.size <= 192);
  assert.deepEqual(a.decisions.map((x) => [x.actorId, x.plan.planId]), b.decisions.map((x) => [x.actorId, x.plan.planId]));
  runtimeA.dispose();
  runtimeB.dispose();
}

const decisionRuntime = createLivingWorldStimulusDecisionRuntime();
assert.deepEqual(decisionRuntime.decideMany(actors, 1).map((x) => x.actorId), []);
decisionRuntime.base.tickOnce({ deltaSeconds: 0.2, nowSeconds: 1, actors, signals: Array.from({ length: 20 }, (_, i) => fuzzSignal(77, i)) });
const decisions = decisionRuntime.decideMany(actors, 1.1);
assert.ok(decisions.length > 0);
assert.ok(decisions.every((decision) => decision.confidence >= 0 && decision.confidence <= 1));
decisionRuntime.dispose();
console.log('living-world stimulus fuzz/determinism: PASS');
