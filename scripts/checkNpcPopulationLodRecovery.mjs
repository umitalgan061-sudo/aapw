#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createNpcSimulationLod, deterministicNpcPhaseSeconds } from '../src/3d/gameplay/npc.js';

const lod = createNpcSimulationLod({
  id: 'population-lod-recovery-probe',
  nearRadiusMeters: 20,
  farIntervalSeconds: 0.5,
  distantRadiusMeters: 100,
  distantIntervalSeconds: 1.5,
  maxStepSeconds: 0.25,
  hysteresisMeters: 5,
  distantHysteresisMeters: 10,
});

const sampleTier = (distanceMeters, ticks, urgent = false) => {
  let simulated = 0;
  let skipped = 0;
  for (let i = 0; i < ticks; i += 1) {
    if (lod.step(0.25, distanceMeters, urgent) > 0) simulated += 1;
    else skipped += 1;
  }
  return { simulated, skipped, tier: lod.tier };
};

const near = sampleTier(10, 4);
assert.deepEqual(near, { simulated: 4, skipped: 0, tier: 'near' },
  'near NPCs must remain full-rate');

const far = sampleTier(50, 12);
assert.equal(far.tier, 'far', 'mid-distance NPCs must enter far tier');
assert.ok(far.simulated > 0 && far.skipped > 0,
  'far NPCs must throttle without starving simulation');

const distant = sampleTier(130, 16);
assert.equal(distant.tier, 'distant', 'very distant NPCs must enter distant tier');
assert.ok(distant.simulated > 0 && distant.skipped > distant.simulated,
  'distant NPCs must run materially fewer behavior ticks than frames');

const urgentDelta = lod.step(0.25, 130, true);
assert.ok(urgentDelta > 0, 'urgent work must wake a distant NPC immediately');
assert.equal(lod.tier, 'urgent', 'urgent wake must expose urgent tier');

const postUrgentDistant = sampleTier(130, 16);
assert.equal(postUrgentDistant.tier, 'distant',
  'distant NPC must leave urgent tier after urgent work clears');
assert.ok(postUrgentDistant.simulated > 0 && postUrgentDistant.skipped > postUrgentDistant.simulated,
  'post-urgent distant NPC must recover throttled non-starving simulation');

const hysteresisHold = sampleTier(95, 4);
assert.equal(hysteresisHold.tier, 'distant',
  'distant hysteresis must prevent tier flapping near the boundary');

const farRecovery = sampleTier(85, 8);
assert.equal(farRecovery.tier, 'far',
  'NPC must recover from distant to far after crossing the lower hysteresis boundary');
assert.ok(farRecovery.simulated > 0 && farRecovery.skipped > 0,
  'far recovery must resume throttled non-starving simulation');

const bootstrap = sampleTier(Infinity, 8);
assert.equal(bootstrap.tier, 'bootstrap',
  'offscreen/unknown-distance simulation must use bootstrap tier');
assert.ok(bootstrap.simulated > 0 && bootstrap.skipped > 0,
  'bootstrap simulation must remain throttled without starvation');

const budgetLod = createNpcSimulationLod({
  id: 'population-lod-frame-budget-probe',
  nearRadiusMeters: 20,
  farIntervalSeconds: 0.5,
  distantRadiusMeters: 100,
  distantIntervalSeconds: 1.5,
  maxStepSeconds: 0.25,
});
const invalidDeltas = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];
for (const delta of invalidDeltas) {
  assert.equal(budgetLod.step(delta, 10), 0,
    `invalid/non-positive frame delta ${String(delta)} must not advance near NPC simulation`);
}
const oversizedNearDelta = budgetLod.step(5, 10);
assert.equal(oversizedNearDelta, 0.25,
  'near NPC simulation must clamp a long frame to maxStepSeconds');

let maxOffscreenDelta = 0;
let offscreenSimulations = 0;
for (let i = 0; i < 16; i += 1) {
  const simulationDelta = budgetLod.step(5, Infinity);
  maxOffscreenDelta = Math.max(maxOffscreenDelta, simulationDelta);
  if (simulationDelta > 0) offscreenSimulations += 1;
}
assert.ok(offscreenSimulations > 0 && offscreenSimulations < 16,
  'oversized offscreen frames must remain throttled without starvation');
assert.ok(maxOffscreenDelta <= 0.25,
  'offscreen simulation must never exceed maxStepSeconds after a long frame');

const phaseIds = Array.from({ length: 24 }, (_, index) => `population-lod-phase-${index}`);
const phaseSamples = phaseIds.map((id) => deterministicNpcPhaseSeconds(id, 1.5));
assert.deepEqual(
  phaseSamples,
  phaseIds.map((id) => deterministicNpcPhaseSeconds(id, 1.5)),
  'population LOD phase offsets must be deterministic for the same NPC ids',
);
assert.ok(phaseSamples.every((phase) => phase >= 0 && phase < 1.5),
  'population LOD phase offsets must stay inside the distant tick interval');
assert.ok(new Set(phaseSamples.map((phase) => phase.toFixed(6))).size >= 20,
  'population LOD phase offsets must distribute distant NPC wakeups instead of synchronizing the herd');

const phasedLods = phaseIds.map((id) => createNpcSimulationLod({
  id,
  nearRadiusMeters: 20,
  farIntervalSeconds: 0.5,
  distantRadiusMeters: 100,
  distantIntervalSeconds: 1.5,
  maxStepSeconds: 0.25,
}));
const distantWakeCounts = Array.from({ length: 6 }, () => 0);
for (let frame = 0; frame < distantWakeCounts.length; frame += 1) {
  for (const phasedLod of phasedLods) {
    if (phasedLod.step(0.25, 150) > 0) distantWakeCounts[frame] += 1;
  }
}
assert.equal(distantWakeCounts.reduce((sum, count) => sum + count, 0), phaseIds.length,
  'each distant NPC must receive one non-starving simulation wake across a full distant interval');
assert.ok(Math.max(...distantWakeCounts) < phaseIds.length,
  'deterministic phase staggering must prevent all distant NPCs waking on one frame');
assert.ok(distantWakeCounts.filter((count) => count > 0).length >= 4,
  'distant population wakes must be spread across most frames in the interval');

const frameBudget = { oversizedNearDelta, offscreenSimulations, maxOffscreenDelta };
const phaseBudget = {
  population: phaseIds.length,
  uniquePhases: new Set(phaseSamples.map((phase) => phase.toFixed(6))).size,
  distantWakeCounts,
};

console.log('NPC_POPULATION_LOD_RECOVERY_PASS', JSON.stringify({
  near,
  far,
  distant,
  urgentDelta,
  postUrgentDistant,
  hysteresisHold,
  farRecovery,
  bootstrap,
  frameBudget,
  phaseBudget,
}));
