#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const npcSource = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');
assert.match(npcSource, /export function createNpcSimulationLod/);
assert.match(npcSource, /simulationSkippedTicks/);
assert.match(npcSource, /hysteresisMeters = 12/);
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
  const interval = 0.25;
  const nearRadius = 90;
  const hysteresis = 12;
  let accumulated = phase(id, interval);
  let tier = 'near';
  let nearLatched = true;
  return {
    step(delta, distance, urgent = false) {
      const bounded = !Number.isFinite(delta) || delta <= 0 ? 0 : Math.min(delta, 0.25);
      const finiteDistance = Number.isFinite(distance);
      if (urgent || !finiteDistance) {
        nearLatched = true;
      } else if (nearLatched) {
        nearLatched = distance <= nearRadius + hysteresis;
      } else {
        nearLatched = distance <= nearRadius;
      }
      if (nearLatched) {
        accumulated = 0;
        tier = urgent ? 'urgent' : 'near';
        return bounded;
      }
      tier = 'far';
      accumulated = Math.min(0.25, accumulated + bounded);
      if (accumulated + Number.EPSILON < interval) return 0;
      const step = Math.min(accumulated, 0.25);
      accumulated = 0;
      return step;
    },
    get tier() { return tier; },
  };
}

const frameDelta = 1 / 60;
const far = Array.from({ length: 100 }, (_, i) => scheduler(`far-${i}`));
let totalFarTicks = 0;
let maxWake = 0;
for (let frame = 0; frame < 60; frame += 1) {
  let wake = 0;
  for (const lod of far) if (lod.step(frameDelta, 500, false) > 0) wake += 1;
  totalFarTicks += wake;
  maxWake = Math.max(maxWake, wake);
}
assert.ok(totalFarTicks < 720, '100 far NPCs must stay well below full-rate simulation');
assert.ok(maxWake < 20, 'deterministic phase staggering must bound per-frame wakeups');

const near = scheduler('near-guard');
for (let i = 0; i < 120; i += 1) assert.equal(near.step(frameDelta, 20, false), frameDelta);

const threshold = scheduler('threshold-guard');
assert.equal(threshold.step(frameDelta, 89, false), frameDelta);
for (const distance of [91, 99, 101, 92, 100, 95]) {
  assert.equal(threshold.step(frameDelta, distance, false), frameDelta, 'near NPC must not thrash at the enter radius');
  assert.equal(threshold.tier, 'near');
}
threshold.step(frameDelta, 103, false);
assert.equal(threshold.tier, 'far', 'NPC must leave near tier beyond the hysteresis exit radius');
for (const distance of [101, 99, 94, 91]) {
  threshold.step(frameDelta, distance, false);
  assert.equal(threshold.tier, 'far', 'far NPC must not re-enter until it crosses the near enter radius');
}
assert.equal(threshold.step(frameDelta, 89, false), frameDelta);
assert.equal(threshold.tier, 'near', 'NPC must re-enter near tier at the original responsiveness radius');

const urgent = scheduler('urgent-guard');
for (let i = 0; i < 20; i += 1) urgent.step(frameDelta, 500, false);
assert.equal(urgent.step(frameDelta, 500, true), frameDelta, 'urgent guard must bypass far throttling');
assert.equal(urgent.tier, 'urgent');
assert.equal(urgent.step(5, 20, false), 0.25, 'frame hitch must clamp to bounded simulation step');

console.log('NPC_SIMULATION_LOD_PASS', JSON.stringify({ farNpcCount: far.length, totalFarTicks, maxWake, nearTicks: 120, hysteresisMeters: 12 }));
