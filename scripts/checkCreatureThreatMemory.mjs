#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const exportMarker = source.indexOf(`export function ${name}`);
  const plainMarker = source.indexOf(`function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : plainMarker;
  assert.ok(start >= 0, `${name} must exist`);
  const openParen = source.indexOf('(', start);
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) { closeParen = i; break; }
    }
  }
  const brace = source.indexOf('{', closeParen);
  let depth = 0;
  let end = -1;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(closeParen > openParen && end > brace, `${name} must have a complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

const wrapCreatureWithThreatMemory = new Function(
  `${extractFunction('wrapCreatureWithThreatMemory')}; return wrapCreatureWithThreatMemory;`,
)();

function makeCreature(x = 0, z = 0) {
  const object3D = { position: { x, y: 0, z }, userData: {} };
  let fleeing = false;
  let disposed = false;
  return {
    object3D,
    get isFleeing() { return fleeing; },
    update(delta, playerPosition, herdmates = []) {
      if (!playerPosition) { fleeing = false; return; }
      const dx = object3D.position.x - playerPosition.x;
      const dz = object3D.position.z - playerPosition.z;
      const distance = Math.hypot(dx, dz);
      const herdAlert = herdmates.some((mate) => Math.hypot(mate.x - object3D.position.x, mate.z - object3D.position.z) <= 18);
      fleeing = distance < 8 || herdAlert;
      if (!fleeing) return;
      const threat = distance < 8 ? playerPosition : herdmates[0];
      const awayX = object3D.position.x - threat.x;
      const awayZ = object3D.position.z - threat.z;
      const safeDistance = Math.max(Math.hypot(awayX, awayZ), 1e-6);
      object3D.position.x += awayX / safeDistance * 4 * delta;
      object3D.position.z += awayZ / safeDistance * 4 * delta;
    },
    dispose() { disposed = true; },
    get disposed() { return disposed; },
  };
}

const dt = 1 / 60;
const registry = new Map();
const leaderInner = makeCreature(0, 0);
const leader = wrapCreatureWithThreatMemory(leaderInner, {
  triggerRadiusMeters: 8,
  reactiveDirection: 'away',
  memorySeconds: 1.25,
  speciesId: 'geyik',
  packAlertRadiusMeters: 18,
  herdRegistry: registry,
  sourceId: 'geyik-leader',
});
const wingmanInner = makeCreature(12, 0);
const wingman = wrapCreatureWithThreatMemory(wingmanInner, {
  triggerRadiusMeters: 8,
  reactiveDirection: 'away',
  memorySeconds: 1.25,
  speciesId: 'geyik',
  packAlertRadiusMeters: 18,
  herdRegistry: registry,
  sourceId: 'geyik-wingman',
});
const goatInner = makeCreature(12, 1);
const goat = wrapCreatureWithThreatMemory(goatInner, {
  triggerRadiusMeters: 8,
  reactiveDirection: 'away',
  memorySeconds: 1.25,
  speciesId: 'keci',
  packAlertRadiusMeters: 10,
  herdRegistry: registry,
  sourceId: 'keci-neighbor',
});

leader.update(dt, { x: 0, z: 4 }, []);
assert.equal(leader.isFleeing, true, 'direct nearby threat must enter flee immediately');
assert.equal(leaderInner.object3D.userData.creatureThreat.phase, 'flee');
assert.equal(wingman.isFleeing, true, 'same-species nearby herd mate must become urgent before its own tick');
wingman.update(dt, { x: 100, z: 100 }, [{ x: 999, z: 999 }]);
assert.equal(wingmanInner.object3D.userData.creatureThreat.phase, 'herd-flee');
assert.equal(wingmanInner.object3D.userData.creatureThreat.herd, true);
assert.equal(wingmanInner.object3D.userData.creatureThreat.herdReactiveCount, 1);
assert.equal(goat.isFleeing, false, 'cross-species neighbor must not inherit deer herd alert');
goat.update(dt, { x: 100, z: 100 }, [{ x: leader.object3D.position.x, z: leader.object3D.position.z }]);
assert.equal(goatInner.object3D.userData.creatureThreat.phase, 'roam', 'legacy all-species game-loop list must be ignored when registry isolation is active');

const relayInner = makeCreature(28, 0);
const relay = wrapCreatureWithThreatMemory(relayInner, {
  triggerRadiusMeters: 8,
  reactiveDirection: 'away',
  memorySeconds: 1.25,
  speciesId: 'geyik',
  packAlertRadiusMeters: 18,
  herdRegistry: registry,
  sourceId: 'geyik-relay-check',
});
wingman.update(dt, { x: 100, z: 100 }, []);
assert.equal(relay.isFleeing, false, 'herd-triggered receiver must not rebroadcast/relay alarm beyond the direct source radius');

const afterDirect = leaderInner.object3D.position.z;
leader.update(dt, { x: 0, z: 30 }, []);
assert.equal(leader.isFleeing, true, 'crossing the exact trigger boundary must retain bounded flee memory');
assert.equal(leaderInner.object3D.userData.creatureThreat.phase, 'recover');
assert.ok(leaderInner.object3D.position.z < afterDirect, 'memory phase must continue moving away along the last threat heading');
for (let i = 0; i < 90; i += 1) leader.update(dt, { x: 0, z: 30 }, []);
assert.equal(leader.isFleeing, false, 'threat memory must expire instead of becoming permanent flee');
assert.equal(leaderInner.object3D.userData.creatureThreat.phase, 'roam');

const friendlyInner = makeCreature();
const friendly = wrapCreatureWithThreatMemory(friendlyInner, {
  triggerRadiusMeters: 10,
  reactiveDirection: 'toward',
  memorySeconds: 1.25,
  speciesId: 'kopek',
  packAlertRadiusMeters: null,
  herdRegistry: registry,
});
friendly.update(dt, { x: 0, z: 4 });
friendly.update(dt, { x: 0, z: 30 });
assert.equal(friendly.isFleeing, false, 'approach-friendly species must not inherit wildlife flee memory');

leader.dispose();
wingman.dispose();
goat.dispose();
relay.dispose();
friendly.dispose();
assert.equal(leaderInner.disposed, true, 'wrapper must preserve dispose contract');
assert.equal(registry.size, 0, 'disposing wrapped creatures must remove bounded herd registry members');

assert.match(source, /CREATURE_BEHAVIOR_PROFILES\[speciesId\]/, 'shipped wiring must use authored species behavior profile');
assert.match(source, /speciesId,[\s\S]*packAlertRadiusMeters: profile\?\.packAlertRadiusMeters[\s\S]*herdRegistry: creatureHerdRegistry/,
  'shipped wiring must bind each creature to its authored same-species herd radius');
assert.match(source, /other === member \|\| !other\.isDirectAlarmSource/, 'herd propagation must use only direct/memory alarm sources and reject relays');
assert.match(source, /herdEnabled \? herdReactivePositions : _herdmateReactivePositions/,
  'registry-enabled herd species must replace the legacy all-species game-loop list');
assert.match(source, /wrapCreatureWithThreatMemory\(creature,[\s\S]*wrapCreatureWithSimulationLod\(threatAwareCreature/,
  'threat memory/herd urgency must wrap the creature before simulation LOD');
assert.equal(source.includes('EditorMaterialStudio'), false, 'living-world runtime must not import editor material UI');

console.log('CREATURE_THREAT_MEMORY_PASS', JSON.stringify({
  directFlee: true,
  boundedRecoverySeconds: 1.25,
  sameSpeciesHerdAlert: true,
  crossSpeciesIsolation: true,
  noHerdRelayStorm: true,
  urgentBeforeLod: true,
}));
