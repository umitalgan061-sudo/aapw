#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const livingSource = fs.readFileSync(new URL('../src/3d/gameplay/livingWorldSpawner.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `${name} must exist in production source`);
  const signatureEnd = source.indexOf(') {', start);
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

let positionReads = 0;
function makeCreature(id, x, z) {
  const position = {};
  for (const [key, value] of Object.entries({ x, y: 0, z })) {
    let current = value;
    Object.defineProperty(position, key, {
      enumerable: true,
      get() { if (key !== 'y') positionReads += 1; return current; },
      set(next) { current = next; },
    });
  }
  const object3D = { name: id, position, userData: {} };
  let fleeing = false;
  return {
    object3D,
    get isFleeing() { return fleeing; },
    update(_delta, playerPosition, herd = []) {
      const distance = playerPosition
        ? Math.hypot(object3D.position.x - playerPosition.x, object3D.position.z - playerPosition.z)
        : Infinity;
      fleeing = distance < 9 || herd.length > 0;
    },
    dispose() {},
  };
}

const herdRegistry = new Map();
const ecologyRegistry = new Map();
const controllers = [];
function add(speciesId, index, x, z, radius) {
  const raw = makeCreature(`${speciesId}-${index}`, x, z);
  const controller = wrapCreatureWithThreatMemory(raw, {
    triggerRadiusMeters: speciesId === 'kuzgun' ? 9 : 6,
    reactiveDirection: 'away',
    memorySeconds: 1.25,
    speciesId,
    packAlertRadiusMeters: radius,
    herdRegistry,
    ecologyRegistry,
    sourceId: `${speciesId}-${index}`,
  });
  controllers.push(controller);
  return controller;
}

// Mirror the shipped desktop budget (80 creatures) while keeping only the authored raven subset in
// the raven herd partition. Flock sensing must scan its species partition, never the whole population.
const ravens = Array.from({ length: 6 }, (_, i) => add('kuzgun', i, i * 4, 0, 12));
for (let i = 0; i < 74; i += 1) add(`other-${i}`, i, 200 + i, 200, null);
assert.equal(controllers.length, 80, 'fixture must match desktop creature population budget');
assert.equal(herdRegistry.get('kuzgun')?.size, 6, 'raven flock registry must remain species-partitioned');

ravens[0].update(1 / 60, { x: 0, z: 4 }, []);
positionReads = 0;
const urgent = ravens[1].isFleeing;
const readsForUrgencyQuery = positionReads;
assert.equal(urgent, true, 'nearby raven must observe the direct alarm source');
assert.ok(readsForUrgencyQuery <= 24,
  `urgency query must stay bounded to six-raven partition, observed ${readsForUrgencyQuery} position reads`);
assert.ok(readsForUrgencyQuery < controllers.length,
  'single flock urgency query must not walk the full desktop creature population');

positionReads = 0;
ravens[1].update(1 / 60, { x: 500, z: 500 }, []);
const readsForTick = positionReads;
assert.equal(ravens[1].object3D.userData.creatureThreat.phase, 'herd-flee');
assert.ok(readsForTick <= 40,
  `one flock receiver tick must remain O(species-members), observed ${readsForTick} position reads`);

for (const controller of controllers) controller.dispose();
assert.equal(herdRegistry.size, 0, 'herd registry must fully release after desktop-scale disposal');
assert.equal(ecologyRegistry.size, 0, 'ecology registry must fully release after desktop-scale disposal');

console.log('CREATURE_BIRD_FLOCK_SCAN_BUDGET_PASS', JSON.stringify({
  desktopPopulation: 80,
  ravenPartition: 6,
  readsForUrgencyQuery,
  readsForTick,
  wholePopulationScan: false,
  registryClean: true,
}));
