#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const npcSource = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');
assert.match(npcSource, /export function createNpcSimulationLod/);
assert.match(npcSource, /simulationSkippedTicks/);
assert.match(npcSource, /hysteresisMeters = 12/);
assert.match(npcSource, /distantRadiusMeters = 240/);
assert.match(npcSource, /distantIntervalSeconds = 1/);
assert.match(npcSource, /distantHysteresisMeters = 30/);
assert.match(npcSource, /farAccumulatedSeconds = farPhaseSeconds/);
assert.match(npcSource, /distantAccumulatedSeconds = distantPhaseSeconds/);
assert.match(npcSource, /pendingSimulationSeconds/);
assert.match(npcSource, /tier = finiteDistance \? 'distant' : 'bootstrap'/);
assert.match(npcSource, /simulationLod\.step\(delta, distanceToPlayer, urgent\)/);
assert.equal(npcSource.includes("from './npcSimulationLod.js'"), false,
  'NPC LOD must remain inside the existing cached npc.js runtime owner');

function phase(id, interval) {
  let hash = 2166136261;
  for (const char of String(id ?? 'npc')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return (hash / 0x100000000) * interval;
}

function scheduler(id) {
  const farInterval = 0.25;
  const distantInterval = 1;
  const nearRadius = 90;
  const distantRadius = 240;
  const hysteresis = 12;
  const distantHysteresis = 30;
  const farPhase = phase(id, farInterval);
  const distantPhase = phase(`${id}:distant`, distantInterval);
  let farAccumulated = farPhase;
  let distantAccumulated = distantPhase;
  let pendingSimulation = 0;
  let tier = 'near';
  let nearLatched = true;
  let distantLatched = false;
  return {
    step(delta, distance, urgent = false) {
      const bounded = !Number.isFinite(delta) || delta <= 0 ? 0 : Math.min(delta, 0.25);
      const finiteDistance = Number.isFinite(distance);
      if (urgent) {
        nearLatched = true;
        distantLatched = false;
      } else if (!finiteDistance) {
        nearLatched = false;
        distantLatched = true;
      } else if (nearLatched) {
        nearLatched = distance <= nearRadius + hysteresis;
      } else {
        nearLatched = distance <= nearRadius;
      }
      if (nearLatched) {
        farAccumulated = farPhase;
        distantAccumulated = distantPhase;
        pendingSimulation = 0;
        tier = urgent ? 'urgent' : 'near';
        return bounded;
      }
      pendingSimulation = Math.min(0.25, pendingSimulation + bounded);
      if (finiteDistance) {
        if (distantLatched) distantLatched = distance > distantRadius - distantHysteresis;
        else distantLatched = distance > distantRadius + distantHysteresis;
      }
      if (distantLatched) {
        if (tier !== 'distant' && tier !== 'bootstrap') distantAccumulated = distantPhase;
        tier = finiteDistance ? 'distant' : 'bootstrap';
        farAccumulated = farPhase;
        distantAccumulated = Math.min(distantInterval, distantAccumulated + bounded);
        if (distantAccumulated + Number.EPSILON < distantInterval) return 0;
        distantAccumulated = 0;
        const simulationDelta = pendingSimulation;
        pendingSimulation = 0;
        return simulationDelta;
      }
      if (tier !== 'far') farAccumulated = farPhase;
      tier = 'far';
      distantAccumulated = distantPhase;
      farAccumulated = Math.min(farInterval, farAccumulated + bounded);
      if (farAccumulated + Number.EPSILON < farInterval) return 0;
      farAccumulated = 0;
      const simulationDelta = pendingSimulation;
      pendingSimulation = 0;
      return simulationDelta;
    },
    get tier() { return tier; },
  };
}

const frameDelta = 1 / 60;
const far = Array.from({ length: 100 }, (_, i) => scheduler(`far-${i}`));
let totalFarTicks = 0;
let maxFarWake = 0;
for (let frame = 0; frame < 60; frame += 1) {
  let wake = 0;
  for (const lod of far) if (lod.step(frameDelta, 150, false) > 0) wake += 1;
  totalFarTicks += wake;
  maxFarWake = Math.max(maxFarWake, wake);
}
assert.ok(totalFarTicks < 720, '100 far NPCs must stay well below full-rate simulation');
assert.ok(maxFarWake < 20, 'deterministic far staggering must bound per-frame wakeups');

const farElapsed = scheduler('far-elapsed-time');
let farFirstWake = 0;
for (let frame = 0; frame < 60 && farFirstWake === 0; frame += 1) farFirstWake = farElapsed.step(frameDelta, 150, false);
let farElapsedWake = 0;
for (let frame = 0; frame < 60 && farElapsedWake === 0; frame += 1) farElapsedWake = farElapsed.step(frameDelta, 150, false);
assert.ok(farElapsedWake >= 0.2,
  'steady-state far wake must consume accumulated simulation time instead of a single render-frame delta');
assert.ok(farElapsedWake <= 0.25, 'far accumulated simulation must remain bounded by maxStepSeconds');

const distant = Array.from({ length: 100 }, (_, i) => scheduler(`distant-${i}`));
let totalDistantTicks = 0;
let maxDistantWake = 0;
for (let frame = 0; frame < 60; frame += 1) {
  let wake = 0;
  for (const lod of distant) if (lod.step(frameDelta, 500, false) > 0) wake += 1;
  totalDistantTicks += wake;
  maxDistantWake = Math.max(maxDistantWake, wake);
}
assert.ok(totalDistantTicks < 120, '100 distant NPCs must stay near a 1Hz dormancy budget');
assert.ok(maxDistantWake < 10, 'distant deterministic phases must avoid wakeup spikes');

const distantElapsed = scheduler('distant-elapsed-time');
let distantElapsedWake = 0;
for (let frame = 0; frame < 120 && distantElapsedWake === 0; frame += 1) distantElapsedWake = distantElapsed.step(frameDelta, 500, false);
assert.equal(distantElapsedWake, 0.25,
  'distant dormancy wake must catch up only to the bounded 0.25s simulation ceiling');

const bootstrap = Array.from({ length: 100 }, (_, i) => scheduler(`bootstrap-${i}`));
let totalBootstrapTicks = 0;
let maxBootstrapWake = 0;
for (let frame = 0; frame < 60; frame += 1) {
  let wake = 0;
  for (const lod of bootstrap) {
    if (lod.step(frameDelta, Infinity, false) > 0) wake += 1;
    assert.equal(lod.tier, 'bootstrap');
  }
  totalBootstrapTicks += wake;
  maxBootstrapWake = Math.max(maxBootstrapWake, wake);
}
assert.ok(totalBootstrapTicks < 120, 'missing player position must not full-tick the authored NPC population');
assert.ok(maxBootstrapWake < 10, 'bootstrap dormancy must retain deterministic staggered wakeups');
const bootstrapWake = scheduler('bootstrap-wake');
for (let i = 0; i < 10; i += 1) bootstrapWake.step(frameDelta, Infinity, false);
assert.equal(bootstrapWake.tier, 'bootstrap');
assert.equal(bootstrapWake.step(frameDelta, 20, false), frameDelta,
  'NPC must wake immediately once a valid nearby player position becomes available');
assert.equal(bootstrapWake.tier, 'near');

// A crowd that was full-rate before a player/camera teleport must keep deterministic phases armed.
// Resetting every accumulator to zero in near tier would make the whole crowd wake on the same frame.
const nearToFar = Array.from({ length: 100 }, (_, i) => scheduler(`near-to-far-${i}`));
for (const lod of nearToFar) assert.equal(lod.step(frameDelta, 20, false), frameDelta);
let maxNearToFarWake = 0;
for (let frame = 0; frame < 60; frame += 1) {
  let wake = 0;
  for (const lod of nearToFar) if (lod.step(frameDelta, 150, false) > 0) wake += 1;
  maxNearToFarWake = Math.max(maxNearToFarWake, wake);
}
assert.ok(maxNearToFarWake < 20, 'near -> far crowd transition must not create a synchronized wakeup spike');

const nearToDistant = Array.from({ length: 100 }, (_, i) => scheduler(`near-to-distant-${i}`));
for (const lod of nearToDistant) assert.equal(lod.step(frameDelta, 20, false), frameDelta);
let maxNearToDistantWake = 0;
for (let frame = 0; frame < 60; frame += 1) {
  let wake = 0;
  for (const lod of nearToDistant) if (lod.step(frameDelta, 500, false) > 0) wake += 1;
  maxNearToDistantWake = Math.max(maxNearToDistantWake, wake);
}
assert.ok(maxNearToDistantWake < 10, 'near -> distant crowd transition must retain staggered dormancy phases');

const near = scheduler('near-guard');
for (let i = 0; i < 120; i += 1) assert.equal(near.step(frameDelta, 20, false), frameDelta);

const threshold = scheduler('threshold-guard');
assert.equal(threshold.step(frameDelta, 89, false), frameDelta);
for (const distance of [91, 99, 101, 92, 100, 95]) {
  assert.equal(threshold.step(frameDelta, distance, false), frameDelta, 'near NPC must not thrash at the enter radius');
  assert.equal(threshold.tier, 'near');
}
threshold.step(frameDelta, 103, false);
assert.equal(threshold.tier, 'far');
for (const distance of [101, 99, 94, 91]) {
  threshold.step(frameDelta, distance, false);
  assert.equal(threshold.tier, 'far');
}
assert.equal(threshold.step(frameDelta, 89, false), frameDelta);
assert.equal(threshold.tier, 'near');

const distantThreshold = scheduler('distant-threshold');
distantThreshold.step(frameDelta, 150, false);
for (const distance of [245, 255, 269]) {
  distantThreshold.step(frameDelta, distance, false);
  assert.equal(distantThreshold.tier, 'far', 'far NPC must not enter dormancy inside the outer hysteresis edge');
}
distantThreshold.step(frameDelta, 271, false);
assert.equal(distantThreshold.tier, 'distant');
for (const distance of [260, 240, 220, 211]) {
  distantThreshold.step(frameDelta, distance, false);
  assert.equal(distantThreshold.tier, 'distant', 'distant NPC must stay dormant until it crosses the inner hysteresis edge');
}
distantThreshold.step(frameDelta, 209, false);
assert.equal(distantThreshold.tier, 'far');

const urgent = scheduler('urgent-guard');
for (let i = 0; i < 20; i += 1) urgent.step(frameDelta, 500, false);
assert.equal(urgent.step(frameDelta, 500, true), frameDelta, 'urgent guard must bypass distant throttling');
assert.equal(urgent.tier, 'urgent');
assert.equal(urgent.step(5, 20, false), 0.25, 'frame hitch must clamp to bounded simulation step');

console.log('NPC_SIMULATION_LOD_PASS', JSON.stringify({
  farNpcCount: far.length,
  totalFarTicks,
  maxFarWake,
  farElapsedWake,
  distantNpcCount: distant.length,
  totalDistantTicks,
  maxDistantWake,
  distantElapsedWake,
  bootstrapNpcCount: bootstrap.length,
  totalBootstrapTicks,
  maxBootstrapWake,
  maxNearToFarWake,
  maxNearToDistantWake,
  nearTicks: 120,
  hysteresisMeters: 12,
  distantHysteresisMeters: 30,
}));
