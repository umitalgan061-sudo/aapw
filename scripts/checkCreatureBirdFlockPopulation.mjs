#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const livingSource = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');
const spawnerSource = fs.readFileSync(new URL('../src/3d/gameplay/creatureSpawner.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = source.indexOf(`function ${name}`);
  const exportMarker = source.indexOf(`export function ${name}`);
  const start = exportMarker >= 0 ? exportMarker : marker;
  assert.ok(start >= 0, `${name} must exist in production source`);
  const bodyStart = source.indexOf('{', source.indexOf(')', start));
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

const wrapCreatureWithThreatMemory = new Function(
  `${extractFunction(livingSource, 'wrapCreatureWithThreatMemory')}; return wrapCreatureWithThreatMemory;`,
)();

function countObjectLiteralEntries(source, exportName) {
  const start = source.indexOf(`export const ${exportName} = Object.freeze({`);
  assert.ok(start >= 0, `${exportName} must exist`);
  const end = source.indexOf('\n});', start);
  assert.ok(end > start, `${exportName} must terminate`);
  const block = source.slice(start, end);
  const matches = block.match(/\b[a-zA-Z0-9_]+:\s*\d+/g) ?? [];
  return matches.reduce((sum, entry) => sum + Number(entry.match(/\d+$/)?.[0] ?? 0), 0);
}

const desktopPopulation = countObjectLiteralEntries(spawnerSource, 'DESKTOP_SPECIES_COUNTS');
const mobilePopulation = countObjectLiteralEntries(spawnerSource, 'MOBILE_SPECIES_COUNTS');
assert.equal(desktopPopulation, 80, 'desktop procedural creature ceiling must remain 80');
assert.equal(mobilePopulation, 12, 'mobile procedural creature ceiling must remain 12');

function makeCreature(id, speciesId, x, z) {
  const object3D = { name: id, position: { x, y: 0, z }, userData: {} };
  let fleeing = false;
  let updates = 0;
  let lastHerdmateCount = 0;
  return {
    object3D,
    get isFleeing() { return fleeing; },
    get updates() { return updates; },
    get lastHerdmateCount() { return lastHerdmateCount; },
    update(_delta, playerPosition, herdmateReactivePositions = []) {
      updates += 1;
      lastHerdmateCount = herdmateReactivePositions.length;
      const playerDistance = playerPosition
        ? Math.hypot(object3D.position.x - playerPosition.x, object3D.position.z - playerPosition.z)
        : Infinity;
      fleeing = playerDistance < 9 || herdmateReactivePositions.length > 0;
    },
    dispose() {},
    speciesId,
  };
}

const herdRegistry = new Map();
const ecologyRegistry = new Map();
const wrapped = [];

function add(id, speciesId, x, z, packAlertRadiusMeters, triggerRadiusMeters = 9) {
  const raw = makeCreature(id, speciesId, x, z);
  const controller = wrapCreatureWithThreatMemory(raw, {
    triggerRadiusMeters,
    reactiveDirection: 'away',
    memorySeconds: 1.25,
    speciesId,
    packAlertRadiusMeters,
    herdRegistry,
    ecologyRegistry,
    sourceId: id,
  });
  wrapped.push({ id, speciesId, raw, controller });
  return controller;
}

// Fill the exact desktop population ceiling with deterministic rows. The first raven chain is arranged
// so member #2 is outside the leader's 12m radius but within #1's radius; it must stay calm because a
// receiver-only bird is not allowed to relay. Eagles and chickens overlap spatially to prove species
// partitioning rather than accidental geometric isolation.
const ravenLeader = add('raven-0', 'kuzgun', 0, 0, 12);
const ravenNearA = add('raven-1', 'kuzgun', 6, 0, 12);
const ravenNearB = add('raven-2', 'kuzgun', 11.5, 0, 12);
const ravenRelayCandidate = add('raven-3', 'kuzgun', 18, 0, 12);
for (let i = 4; i < 32; i += 1) add(`raven-${i}`, 'kuzgun', 30 + i * 3, (i % 3) * 2, 12);
for (let i = 0; i < 24; i += 1) add(`eagle-${i}`, 'kartal', 4 + i * 4, (i % 2) * 3, 20, 16);
for (let i = 0; i < 24; i += 1) add(`chicken-${i}`, 'tavuk', 5 + i * 2.5, -3 - (i % 4), 8, 5);
assert.equal(wrapped.length, 80, 'stress fixture must equal the shipped desktop creature ceiling');

const playerNearLeader = { x: 0, z: 4 };
ravenLeader.update(1 / 60, playerNearLeader, []);
assert.equal(ravenLeader.isFleeing, true, 'directly startled raven must publish an alarm source');
assert.equal(ravenNearA.isFleeing, true, 'same-species raven within 12m must wake before its own tick');
assert.equal(ravenNearB.isFleeing, true, 'same-species raven on the bounded inner edge must wake');
assert.equal(ravenRelayCandidate.isFleeing, false, 'raven outside leader radius must not wake through a receiver relay');

const eagleAtOverlap = wrapped.find((entry) => entry.id === 'eagle-0').controller;
const chickenAtOverlap = wrapped.find((entry) => entry.id === 'chicken-0').controller;
assert.equal(eagleAtOverlap.isFleeing, false, 'overlapping eagle must ignore raven alarm');
assert.equal(chickenAtOverlap.isFleeing, false, 'overlapping chicken must ignore raven alarm');

const farPlayer = { x: 500, z: 500 };
ravenNearA.update(1 / 60, farPlayer, []);
ravenNearB.update(1 / 60, farPlayer, []);
assert.equal(ravenNearA.object3D.userData.creatureThreat.phase, 'herd-flee');
assert.equal(ravenNearB.object3D.userData.creatureThreat.phase, 'herd-flee');
assert.ok(ravenNearA.object3D.userData.creatureThreat.herdReactiveCount <= 1,
  'receiver should react to the direct source, not an expanding relay set');
assert.ok(ravenNearB.object3D.userData.creatureThreat.herdReactiveCount <= 1,
  'bounded direct-source semantics must hold under population stress');
assert.equal(ravenRelayCandidate.isFleeing, false, 'receiver ticks must not convert them into alarm publishers');

const registrySpecies = [...herdRegistry.keys()].sort();
assert.deepEqual(registrySpecies, ['kartal', 'kuzgun', 'tavuk'], 'registry must remain partitioned to the three authored bird species');
assert.equal([...herdRegistry.values()].reduce((sum, members) => sum + members.size, 0), 80,
  'registry membership must be bounded by the shipped population ceiling');

// Worst-case one full same-species scan per creature is still hard-bounded by 80*80 candidates; the
// actual runtime usually does much less because creature LOD throttles calm far/distant population.
const theoreticalCandidateChecks = desktopPopulation * desktopPopulation;
assert.equal(theoreticalCandidateChecks, 6400);
assert.ok(theoreticalCandidateChecks < 10_000, 'desktop flock scan upper bound must stay below 10k candidate checks');

for (const entry of wrapped) entry.controller.dispose();
assert.equal(herdRegistry.size, 0, 'disposing the population must fully release herd/flock registry state');
assert.equal(ecologyRegistry.size, 0, 'disposing the population must fully release ecology registry state');

console.log('CREATURE_BIRD_FLOCK_POPULATION_PASS', JSON.stringify({
  desktopPopulation,
  mobilePopulation,
  theoreticalCandidateChecks,
  directRavenReceivers: 2,
  relayStorm: false,
  crossSpeciesIsolation: true,
  registryClean: true,
}));
