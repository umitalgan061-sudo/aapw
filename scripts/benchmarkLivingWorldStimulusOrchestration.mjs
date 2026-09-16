import { performance } from 'node:perf_hooks';
import { createLivingWorldStimulusOrchestrator } from '../src/3d/gameplay/livingWorldStimulusOrchestrator.js';
import { createLivingWorldStimulusWorkBudget } from '../src/3d/gameplay/livingWorldStimulusWorkBudget.js';

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    state = Math.imul(state ^ (state >>> 13), 3266489917) >>> 0;
    return ((state ^ (state >>> 16)) >>> 0) / 0xffffffff;
  };
}

const random = seeded(20260916);
const actors = Array.from({ length: 256 }, (_, index) => ({
  id: `perf-actor-${index}`,
  role: ['civilian', 'guard', 'hunter', 'predator'][index % 4],
  position: { x: Math.floor(random() * 1000) / 10, y: 0, z: Math.floor(random() * 1000) / 10 },
  staminaRatio: random(),
  healthRatio: 0.5 + random() * 0.5,
  inCombat: index % 13 === 0,
  capabilities: { canAttack: index % 7 !== 0, canAssist: true, canPursue: index % 11 !== 0 },
}));
const signals = Array.from({ length: 512 }, (_, index) => ({
  id: `perf-signal-${index}`,
  kind: ['threat', 'noise', 'combat', 'sighting', 'weather'][index % 5],
  channel: ['visual', 'auditory', 'tactical'][index % 3],
  actorId: `perf-actor-${index % 256}`,
  targetId: index % 3 === 0 ? 'player' : `perf-target-${index % 32}`,
  position: { x: random() * 1000, y: 0, z: random() * 1000 },
  confidence: random(),
  intensity: random(),
  radius: 20 + random() * 120,
  timestampMs: index * 16,
  sequence: index,
}));

const runtime = createLivingWorldStimulusOrchestrator({ policy: { maxSignalsPerTick: 64, maxActorsPerTick: 64, maxPlansPerTick: 16 } });
const samples = [];
for (let iteration = 0; iteration < 60; iteration += 1) {
  const start = performance.now();
  const frame = runtime.tickOnce({
    deltaSeconds: 0.12,
    nowSeconds: iteration * 0.12,
    actors: actors.slice(iteration % 64, iteration % 64 + 64),
    signals: signals.slice(iteration * 3, iteration * 3 + 64),
  });
  samples.push(performance.now() - start);
  if (frame.decisions.length > 16 || frame.memory.size > 192) process.exitCode = 1;
}

const sorted = [...samples].sort((a, b) => a - b);
const percentile = (fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
const budget = createLivingWorldStimulusWorkBudget({ bucketCount: 8 });
const budgetStart = performance.now();
for (let iteration = 0; iteration < 200; iteration += 1) budget.select(actors, 64);
const budgetElapsed = performance.now() - budgetStart;

console.log(JSON.stringify({
  runtime: { samples: samples.length, avgMs: Number(average.toFixed(4)), p50Ms: Number(percentile(0.5).toFixed(4)), p95Ms: Number(percentile(0.95).toFixed(4)), p99Ms: Number(percentile(0.99).toFixed(4)) },
  workload: { iterations: 200, totalMs: Number(budgetElapsed.toFixed(4)), avgMs: Number((budgetElapsed / 200).toFixed(4)) },
}));
runtime.dispose();
