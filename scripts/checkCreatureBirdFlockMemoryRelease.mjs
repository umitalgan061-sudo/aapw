#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const livingSource = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const exportMarker = source.indexOf(`export function ${name}`);
  const plainMarker = source.indexOf(`function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : plainMarker;
  assert.ok(start >= 0, `${name} must exist in production source`);
  const signatureEnd = source.indexOf(') {', start);
  assert.ok(signatureEnd >= 0, `${name} signature must terminate`);
  const bodyStart = source.indexOf('{', signatureEnd);
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

const wrapCreatureWithThreatMemory = new Function(
  `${extractFunction(livingSource, 'wrapCreatureWithThreatMemory')}; return wrapCreatureWithThreatMemory;`,
)();

function makeCreature(id, x, z) {
  const object3D = { name: id, position: { x, y: 0, z }, userData: {} };
  let fleeing = false;
  let lastSyntheticThreat = null;
  return {
    object3D,
    get isFleeing() { return fleeing; },
    get lastSyntheticThreat() { return lastSyntheticThreat; },
    update(_delta, playerPosition, herdmateReactivePositions = []) {
      lastSyntheticThreat = playerPosition ? { x: playerPosition.x, z: playerPosition.z } : null;
      const distance = playerPosition
        ? Math.hypot(object3D.position.x - playerPosition.x, object3D.position.z - playerPosition.z)
        : Infinity;
      fleeing = distance < 9 || herdmateReactivePositions.length > 0;
    },
    dispose() {},
  };
}

const herdRegistry = new Map();
const ecologyRegistry = new Map();
const controllers = [];

function add(id, x, z) {
  const raw = makeCreature(id, x, z);
  const controller = wrapCreatureWithThreatMemory(raw, {
    triggerRadiusMeters: 9,
    reactiveDirection: 'away',
    memorySeconds: 1.25,
    speciesId: 'kuzgun',
    packAlertRadiusMeters: 12,
    herdRegistry,
    ecologyRegistry,
    sourceId: id,
  });
  controllers.push({ raw, controller });
  return { raw, controller };
}

const leaderA = add('leader-a', 0, 0);
const receiver = add('receiver', 8, 0);
const relay = add('relay', 19, 0);
const leaderB = add('leader-b', 16, 0);
const farPlayer = { x: 500, z: 500 };

// Two direct sources may overlap one receiver. Both are legitimate publishers, while the receiver and
// relay are not. This catches stale Set membership and accidental receiver->relay propagation.
leaderA.controller.update(1 / 60, { x: 0, z: 4 }, []);
leaderB.controller.update(1 / 60, { x: 16, z: 4 }, []);
assert.equal(receiver.controller.isFleeing, true, 'receiver must wake while either direct source is active');
receiver.controller.update(1 / 60, farPlayer, []);
assert.equal(receiver.controller.object3D.userData.creatureThreat.phase, 'herd-flee');
assert.equal(receiver.controller.object3D.userData.creatureThreat.herdReactiveCount, 2,
  'overlapping direct alarms must remain observable without turning the receiver into a publisher');
assert.equal(relay.controller.isFleeing, true,
  'relay is legitimately inside leader-b radius; this fixture must not mislabel direct-source coverage as relaying');

// Removing one live publisher must immediately shrink the receiver's source set; no tombstone may
// survive in the shared registry. The remaining leader keeps the receiver awake.
leaderA.controller.dispose();
assert.equal(receiver.controller.isFleeing, true, 'remaining direct source must keep receiver urgent');
receiver.controller.update(1 / 60, farPlayer, []);
assert.equal(receiver.controller.object3D.userData.creatureThreat.herdReactiveCount, 1,
  'disposing a publisher must remove it from the live alarm set immediately');
assert.equal(herdRegistry.get('kuzgun')?.size, 3, 'registry must shrink synchronously after disposal');

// Direct-threat memory is deliberately short. Once the surviving leader has spent >1.25s away from
// the player, it must stop publishing and all receivers must be eligible to return to calm/LOD cadence.
for (let i = 0; i < 6; i += 1) leaderB.controller.update(0.25, farPlayer, []);
assert.equal(leaderB.controller.object3D.userData.creatureThreat.memoryRemainingSeconds, 0,
  'direct source memory must drain to zero after the authored 1.25s window');
assert.equal(receiver.controller.isFleeing, false, 'receiver must release urgency after the last direct memory expires');
receiver.controller.update(1 / 60, farPlayer, []);
assert.equal(receiver.controller.object3D.userData.creatureThreat.phase, 'roam',
  'receiver telemetry must return to roam after flock memory release');
assert.equal(receiver.controller.object3D.userData.creatureThreat.herdReactiveCount, 0,
  'no stale alarm source may remain after memory release');

// A receiver that was previously alarmed never becomes a source itself. With both direct leaders gone,
// the geometrically adjacent relay must remain calm even if the receiver ticks first.
leaderB.controller.dispose();
receiver.controller.update(1 / 60, farPlayer, []);
relay.controller.update(1 / 60, farPlayer, []);
assert.equal(receiver.controller.isFleeing, false, 'former receiver must stay non-publishing when calm');
assert.equal(relay.controller.isFleeing, false, 'former receiver must not relay a stale flock alarm');
assert.equal(relay.controller.object3D.userData.creatureThreat.phase, 'roam');

receiver.controller.dispose();
relay.controller.dispose();
assert.equal(herdRegistry.size, 0, 'all flock registry state must be released after final disposal');
assert.equal(ecologyRegistry.size, 0, 'all ecology registry state must be released after final disposal');

console.log('CREATURE_BIRD_FLOCK_MEMORY_RELEASE_PASS', JSON.stringify({
  memorySeconds: 1.25,
  overlappingDirectSources: 2,
  disposedSourceRemovedImmediately: true,
  staleRelay: false,
  registryClean: true,
}));
