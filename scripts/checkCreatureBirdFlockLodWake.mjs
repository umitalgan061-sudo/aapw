#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const exportStart = source.indexOf(`export function ${name}`);
  const plainStart = source.indexOf(`function ${name}`);
  const start = exportStart >= 0 ? exportStart : plainStart;
  assert.ok(start >= 0, `${name} must exist`);
  const paramsEnd = source.indexOf(')', start);
  const bodyStart = source.indexOf('{', paramsEnd);
  assert.ok(bodyStart >= 0, `${name} body must exist`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1).replace(/^export\s+/, '');
    }
  }
  throw new Error(`unterminated ${name}`);
}

const runtime = new Function(`
  ${extractFunction('clampCreatureSimulationDelta')}
  ${extractFunction('deterministicCreaturePhaseSeconds')}
  ${extractFunction('createCreatureSimulationLod')}
  ${extractFunction('wrapCreatureWithSimulationLod')}
  return { createCreatureSimulationLod, wrapCreatureWithSimulationLod };
`)();

function makeCreature(id) {
  let fleeing = false;
  let updates = 0;
  let totalSimulationSeconds = 0;
  const deltas = [];
  const object3D = { name: id, position: { x: 240, y: 0, z: 0 }, userData: {} };
  return {
    object3D,
    get isFleeing() { return fleeing; },
    setFleeing(value) { fleeing = Boolean(value); },
    get updates() { return updates; },
    get totalSimulationSeconds() { return totalSimulationSeconds; },
    get deltas() { return deltas.slice(); },
    update(delta) {
      updates += 1;
      totalSimulationSeconds += delta;
      deltas.push(delta);
    },
    dispose() {},
  };
}

const raw = makeCreature('flock-lod-raven');
const controller = runtime.wrapCreatureWithSimulationLod(raw, {
  id: 'flock-lod-raven',
  nearRadiusMeters: 70,
  farIntervalSeconds: 0.25,
  distantRadiusMeters: 180,
  distantIntervalSeconds: 1,
  maxStepSeconds: 0.25,
});

const dt = 1 / 60;
const playerFar = { x: 0, z: 0 };

// Calm bird at 240m should remain on the distant cadence, not execute every render frame.
for (let i = 0; i < 120; i += 1) controller.update(dt, playerFar, []);
const calmTicks = raw.updates;
assert.equal(controller.object3D.userData.simulationLodTier, 'distant', '240m calm bird must settle into distant LOD');
assert.ok(calmTicks >= 1 && calmTicks <= 4, `two calm seconds should execute about 1Hz, got ${calmTicks} ticks`);
assert.ok(controller.object3D.userData.simulationSkippedTicks >= 110, 'distant bird must skip the overwhelming majority of render ticks');

// A flock/herd alarm becomes `isFleeing=true` before the receiver's own tick. The existing LOD wrapper
// must see that urgency immediately and execute on the very next render frame, even from 240m away.
const ticksBeforeUrgent = raw.updates;
raw.setFleeing(true);
controller.update(dt, playerFar, [{ x: 228, z: 0 }]);
assert.equal(raw.updates, ticksBeforeUrgent + 1, 'flock alarm must wake distant bird on the very next frame');
assert.equal(controller.object3D.userData.simulationLodTier, 'urgent', 'flock alarm must bypass distant throttle');
assert.ok(controller.object3D.userData.simulationLastStepSeconds > 0, 'urgent wake must run a real simulation step');
assert.ok(controller.object3D.userData.simulationLastStepSeconds <= 0.25, 'urgent wake must preserve the 250ms step ceiling');

// Sustained flock flight remains full-rate while the group threat is active.
const urgentStartTicks = raw.updates;
for (let i = 0; i < 60; i += 1) controller.update(dt, playerFar, [{ x: 228, z: 0 }]);
const urgentTicks = raw.updates - urgentStartTicks;
assert.equal(urgentTicks, 60, 'active flock escape must remain full-rate for every render frame');
assert.equal(controller.object3D.userData.simulationLodTier, 'urgent');

// Clearing the group threat must not leave a stale urgent latch. The controller should return to
// distant cadence immediately, then resume approximately 1Hz work instead of continuing 60Hz forever.
raw.setFleeing(false);
const ticksBeforeRecovery = raw.updates;
controller.update(dt, playerFar, []);
assert.notEqual(controller.object3D.userData.simulationLodTier, 'urgent', 'cleared flock threat must release urgent tier immediately');
for (let i = 0; i < 120; i += 1) controller.update(dt, playerFar, []);
const recoveryTicks = raw.updates - ticksBeforeRecovery;
assert.ok(recoveryTicks >= 1 && recoveryTicks <= 5, `recovered distant bird should return to ~1Hz cadence, got ${recoveryTicks} ticks`);
assert.equal(controller.object3D.userData.simulationLodTier, 'distant');

for (const delta of raw.deltas) {
  assert.ok(delta > 0 && delta <= 0.25, `all executed bird simulation deltas must be bounded, saw ${delta}`);
}

// The scheduler itself must remain deterministic for the same creature id and input stream.
function replay(id) {
  const lod = runtime.createCreatureSimulationLod({
    id,
    nearRadiusMeters: 70,
    farIntervalSeconds: 0.25,
    distantRadiusMeters: 180,
    distantIntervalSeconds: 1,
    maxStepSeconds: 0.25,
  });
  const samples = [];
  for (let i = 0; i < 180; i += 1) {
    const urgent = i >= 70 && i < 90;
    samples.push([lod.step(dt, 240, urgent), lod.tier]);
  }
  return samples;
}
assert.deepEqual(replay('flock-lod-raven'), replay('flock-lod-raven'), 'same bird id must replay the same LOD wake schedule');
assert.notDeepEqual(replay('flock-lod-raven'), replay('flock-lod-raven-b'), 'different bird ids should retain staggered distant phases');

controller.dispose();

console.log('CREATURE_BIRD_FLOCK_LOD_WAKE_PASS', JSON.stringify({
  calmTicks,
  urgentTicks,
  recoveryTicks,
  immediateUrgentWake: true,
  urgentReleased: true,
  maxStepSeconds: 0.25,
  deterministicReplay: true,
}));
