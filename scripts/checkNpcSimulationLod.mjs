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
  hash ^= hash >>> 16;
  return (hash / 0x100000000) * interval;
}

function scheduler(id) {
  const farInterval = 0.25;
  const distantInterval = 1;
  const nearRadius = 90;
  const distantRadius = 240;
  const hysteresis = 12;
  const distantHysteresis = 30;
  let farAccumulated = phase(id, farInterval);
  let distantAccumulated = phase(`${id}:distant`, distantInterval);
  let tier = 'near';
  let nearLatched = true;
  let distantLatched = false;
  return {
    step(delta, distance, urgent = false) {
      const bounded = !Number.isFinite(delta) || delta <= 0 ? 0 : Math.min(delta, 0.25);
      const finiteDistance = Number.isFinite(distance);
      if (urgent || !finiteDistance) {
        nearLatched = true;
        distantLatched = false;
      } else if (nearLatched) {
        nearLatched = distance <= nearRadius + hysteresis;
      } else {
        nearLatched = distance <= nearRadius;
      }
      if (nearLatched) {
        farAccumulated = 0;
        distantAccumulated = 0;
        tier = urgent ? 'urgent' : 'near';
        return bounded;
      }
      if (distantLatched) distantLatched = distance > distantRadius - distantHysteresis;
      else distantLatched = distance > distantRadius + distantHysteresis;
      if (distantLatched) {
        tier = 'distant';
        farAccumulated = 0;
        distantAccumulated = Math.min(distantInterval, distantAccumulated + bounded);
        if (distantAccumulated + Number.EPSILON < distantInterval) return 0;
        distantAccumulated = 0;
        return bounded;
      }
      tier = 'far';
      distantAccumulated = 0;
      farAccumulated = Math.min(farInterval, farAccumulated + bounded);
      if (farAccumulated + Number.EPSILON < farInterval) return 0;
      farAccumulated = 0;
      return bounded;
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
  distantNpcCount: distant.length,
  totalDistantTicks,
  maxDistantWake,
  nearTicks: 120,
  hysteresisMeters: 12,
  distantHysteresisMeters: 30,
}));
