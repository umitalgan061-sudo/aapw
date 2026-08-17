#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createCreatureSimulationLod,
  deterministicCreaturePhaseSeconds,
  wrapCreatureWithSimulationLod,
} from '../src/3d/gameplay/creatureSimulationLod.js';

const interval = 0.25;
const phaseA = deterministicCreaturePhaseSeconds('deer:1', interval);
const phaseB = deterministicCreaturePhaseSeconds('deer:1', interval);
const phaseC = deterministicCreaturePhaseSeconds('bear:2', interval);
assert.equal(phaseA, phaseB, 'same creature id must produce the same deterministic phase');
assert.ok(phaseA >= 0 && phaseA < interval, 'phase must stay inside its interval');
assert.notEqual(phaseA, phaseC, 'different creature ids should not wake in lockstep');

function tickLod(distanceMeters, seconds, urgent = false) {
  const lod = createCreatureSimulationLod({
    id: `probe:${distanceMeters}:${urgent}`,
    nearRadiusMeters: 70,
    farIntervalSeconds: 0.25,
    distantRadiusMeters: 180,
    distantIntervalSeconds: 1,
    maxStepSeconds: 0.25,
  });
  let executed = 0;
  let maxStep = 0;
  for (let i = 0; i < seconds * 60; i += 1) {
    const step = lod.step(1 / 60, distanceMeters, urgent);
    if (step > 0) {
      executed += 1;
      maxStep = Math.max(maxStep, step);
    }
  }
  return { executed, maxStep, tier: lod.tier };
}

const near = tickLod(20, 2);
assert.equal(near.executed, 120, 'near fauna must preserve full-rate behavior ticks');
assert.equal(near.tier, 'near');

const far = tickLod(110, 2);
assert.ok(far.executed >= 6 && far.executed <= 9, `far fauna must run near 4Hz, got ${far.executed} ticks`);
assert.equal(far.tier, 'far');

const distant = tickLod(250, 3);
assert.ok(distant.executed >= 2 && distant.executed <= 4, `distant fauna must run near 1Hz, got ${distant.executed} ticks`);
assert.equal(distant.tier, 'distant');
assert.ok(distant.maxStep <= 0.25, 'distant catch-up work must remain bounded to 250ms');

const urgent = tickLod(250, 1, true);
assert.equal(urgent.executed, 60, 'fleeing/threatened fauna must bypass distant throttling');
assert.equal(urgent.tier, 'urgent');

const calls = [];
let fleeing = false;
let disposed = false;
const creature = {
  object3D: { position: { x: 0, z: 0 }, userData: {} },
  get isFleeing() { return fleeing; },
  update(delta, playerPosition, herd) { calls.push({ delta, playerPosition, herd }); },
  dispose() { disposed = true; },
};
const wrapped = wrapCreatureWithSimulationLod(creature, {
  id: 'wrapper-deer',
  nearRadiusMeters: 70,
  farIntervalSeconds: 0.25,
  distantRadiusMeters: 180,
  distantIntervalSeconds: 1,
  maxStepSeconds: 0.25,
});
const herd = [{ x: 3, z: 4 }];
for (let i = 0; i < 60; i += 1) wrapped.update(1 / 60, { x: 120, z: 0 }, herd);
assert.ok(calls.length >= 3 && calls.length <= 5, `wrapper must throttle far updates, got ${calls.length}`);
assert.equal(calls.at(-1).herd, herd, 'wrapper must preserve the established herdmate contract');
const ticksBeforeFlee = calls.length;
fleeing = true;
for (let i = 0; i < 30; i += 1) wrapped.update(1 / 60, { x: 220, z: 0 }, herd);
assert.equal(calls.length - ticksBeforeFlee, 30, 'active flee must wake the real creature brain every frame');
assert.equal(wrapped.isFleeing, true, 'wrapper must forward the existing isFleeing getter');
assert.equal(creature.object3D.userData.simulationLodTier, 'urgent');
assert.ok(creature.object3D.userData.simulationSkippedTicks > 0, 'telemetry must report skipped far ticks');
assert.ok(creature.object3D.userData.simulationTicks > 0, 'telemetry must report executed ticks');
wrapped.dispose();
assert.equal(disposed, true, 'wrapper must forward controller disposal');

const spawnerSource = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');
assert.match(spawnerSource, /wrapCreatureWithSimulationLod/, 'shipped living-world spawn path must install creature behavior LOD');
assert.match(spawnerSource, /nearRadiusMeters:\s*70/, 'shipped near radius must remain 70m');
assert.match(spawnerSource, /farIntervalSeconds:\s*0\.25/, 'shipped far cadence must remain 4Hz');
assert.match(spawnerSource, /distantRadiusMeters:\s*180/, 'shipped distant boundary must remain 180m');
assert.match(spawnerSource, /distantIntervalSeconds:\s*1/, 'shipped distant cadence must remain 1Hz');
assert.equal(spawnerSource.includes('EditorMaterialStudio'), false, 'living-world runtime must not import editor material UI');

console.log('CREATURE_SIMULATION_LOD_PASS', JSON.stringify({
  nearTicksPerSecond: 60,
  farTicksPerSecondApprox: 4,
  distantTicksPerSecondApprox: 1,
  nearRadiusMeters: 70,
  distantRadiusMeters: 180,
  urgentFleeBypass: true,
  maxStepSeconds: 0.25,
  deterministicPhase: true,
  wrapperContractPreserved: true,
}));
