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
  assert.ok(closeParen > openParen && end > brace, `${name} must have complete body`);
  return source.slice(start, end).replace(/^export\s+/, '');
}

const wrapCreatureWithThreatMemory = new Function(`${extractFunction('wrapCreatureWithThreatMemory')}; return wrapCreatureWithThreatMemory;`)();

function makeCreature(x, z) {
  const object3D = { position: { x, y: 0, z }, userData: {} };
  let fleeing = false;
  return {
    object3D,
    get isFleeing() { return fleeing; },
    update(delta, threatPosition, herdmates = []) {
      if (!threatPosition) { fleeing = false; return; }
      const dx = object3D.position.x - threatPosition.x;
      const dz = object3D.position.z - threatPosition.z;
      const distance = Math.hypot(dx, dz);
      const herd = herdmates.some((mate) => Math.hypot(mate.x - object3D.position.x, mate.z - object3D.position.z) <= 18);
      fleeing = distance < 15 || herd;
      if (!fleeing) return;
      const source = distance < 15 ? threatPosition : herdmates[0];
      const awayX = object3D.position.x - source.x;
      const awayZ = object3D.position.z - source.z;
      const safe = Math.max(Math.hypot(awayX, awayZ), 1e-6);
      object3D.position.x += awayX / safe * 6 * delta;
      object3D.position.z += awayZ / safe * 6 * delta;
    },
    dispose() {},
  };
}

const ecologyRegistry = new Map();
const herdRegistry = new Map();
function wrap(inner, speciesId, sourceId, predatorSpeciesIds = [], predatorThreatRadiusMeters = 0) {
  return wrapCreatureWithThreatMemory(inner, {
    triggerRadiusMeters: speciesId === 'geyik' ? 15 : 12,
    reactiveDirection: 'away',
    memorySeconds: 1.25,
    speciesId,
    packAlertRadiusMeters: speciesId === 'geyik' ? 18 : null,
    herdRegistry,
    sourceId,
    predatorSpeciesIds,
    predatorThreatRadiusMeters,
    ecologyRegistry,
  });
}

const preyInner = makeCreature(0, 0);
const prey = wrap(preyInner, 'geyik', 'prey', ['aslan', 'ayi'], 24);
const lionInner = makeCreature(18, 0);
const lion = wrap(lionInner, 'aslan', 'lion');
const goatInner = makeCreature(2, 0);
const goat = wrap(goatInner, 'keci', 'goat', ['aslan', 'ayi'], 20);
const dt = 1 / 60;
const farPlayer = { x: 200, z: 200 };

assert.equal(prey.isFleeing, true, 'near authored predator must wake prey before its own tick for LOD urgency');
const beforeX = preyInner.object3D.position.x;
prey.update(dt, farPlayer, []);
assert.equal(preyInner.object3D.userData.creatureThreat.phase, 'predator-flee');
assert.equal(preyInner.object3D.userData.creatureThreat.predator, true);
assert.equal(preyInner.object3D.userData.creatureThreat.predatorSpeciesId, 'aslan');
assert.ok(preyInner.object3D.position.x < beforeX, 'prey must physically move away from nearest predator');
assert.equal(lion.isFleeing, false, 'predator must not inherit prey fear');

lionInner.object3D.position.x = 30;
prey.update(dt, farPlayer, []);
assert.equal(prey.isFleeing, false, 'predator threat must stop after the next normal brain tick outside the bounded authored radius');
assert.equal(preyInner.object3D.userData.creatureThreat.phase, 'roam', 'predator departure must return prey to normal roam without predator memory');
assert.equal(preyInner.object3D.userData.creatureThreat.predator, false, 'predator telemetry must clear after leaving authored radius');
assert.equal(preyInner.object3D.userData.creatureThreat.predatorSpeciesId, null, 'departed predator identity must not remain latched');
assert.equal(goat.isFleeing, false, 'prey species with smaller radius must not overreact to a distant predator');

assert.match(source, /CREATURE_PREDATOR_THREAT_RULES = Object\.freeze/, 'runtime must expose authored predator-prey rules');
assert.match(source, /nearbyPredatorSources\(\)/, 'runtime must query bounded predator sources');
assert.match(source, /result\.sort\(\(a, b\) => a\.distanceMeters - b\.distanceMeters/, 'nearest predator selection must be deterministic');
assert.match(source, /phase: fleeing \? \(predator \? 'predator-flee'/, 'telemetry must distinguish predator flee');
assert.match(source, /get isDirectAlarmSource\(\) \{ return directThreatActive \|\| memoryRemainingSeconds > 0; \}/,
  'predator-triggered flee must not become a herd relay source');
assert.match(source, /predatorSpeciesIds: predatorRule\?\.predatorSpeciesIds/, 'shipped population must wire authored predator species');
assert.match(source, /ecologyRegistry: creatureEcologyRegistry/, 'shipped population must share one bounded ecology registry');
assert.equal(source.includes('EditorMaterialStudio'), false, 'living-world runtime must not import editor material UI');

prey.dispose();
lion.dispose();
goat.dispose();
assert.equal(ecologyRegistry.size, 0, 'dispose must clear ecology registry membership');
assert.equal(herdRegistry.size, 0, 'dispose must preserve herd registry cleanup');

console.log('CREATURE_PREDATOR_PREY_PASS', JSON.stringify({
  deerPredators: ['aslan', 'ayi'],
  deerThreatRadiusMeters: 24,
  urgentBeforeTick: true,
  nearestPredatorDirection: true,
  predatorDepartureReturnsToRoam: true,
  noFearRelay: true,
  boundedEcologyRegistry: true,
}));
