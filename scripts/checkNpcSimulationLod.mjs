#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const npcSource = fs.readFileSync(new URL('../src/3d/gameplay/npc.js', import.meta.url), 'utf8');
assert.match(npcSource, /export function createNpcSimulationLod/);
assert.match(npcSource, /simulationSkippedTicks/);
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
  let accumulated = phase(id, interval);
  return (delta, distance, urgent = false) => {
    const bounded = !Number.isFinite(delta) || delta <= 0 ? 0 : Math.min(delta, 0.25);
    if (urgent || !Number.isFinite(distance) || distance <= 90) {
      accumulated = 0;
      return bounded;
    }
    accumulated = Math.min(0.25, accumulated + bounded);
    if (accumulated + Number.EPSILON < interval) return 0;
    const step = Math.min(accumulated, 0.25);
    accumulated = 0;
    return step;
  };
}

const frameDelta = 1 / 60;
const far = Array.from({ length: 100 }, (_, i) => scheduler(`far-${i}`));
let totalFarTicks = 0;
let maxWake = 0;
for (let frame = 0; frame < 60; frame += 1) {
  let wake = 0;
  for (const step of far) if (step(frameDelta, 500, false) > 0) wake += 1;
  totalFarTicks += wake;
  maxWake = Math.max(maxWake, wake);
}
assert.ok(totalFarTicks < 720, '100 far NPCs must stay well below full-rate simulation');
assert.ok(maxWake < 20, 'deterministic phase staggering must bound per-frame wakeups');

const near = scheduler('near-guard');
for (let i = 0; i < 120; i += 1) assert.equal(near(frameDelta, 20, false), frameDelta);
const urgent = scheduler('urgent-guard');
for (let i = 0; i < 20; i += 1) urgent(frameDelta, 500, false);
assert.equal(urgent(frameDelta, 500, true), frameDelta, 'urgent guard must bypass far throttling');
assert.equal(urgent(5, 20, false), 0.25, 'frame hitch must clamp to bounded simulation step');

console.log('NPC_SIMULATION_LOD_PASS', JSON.stringify({ farNpcCount: far.length, totalFarTicks, maxWake, nearTicks: 120 }));
