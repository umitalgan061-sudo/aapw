import assert from 'node:assert/strict';
import {
  LIVING_WORLD_FAUNA_DIRECTOR_POLICY,
  applyFaunaTick,
  planFaunaTick,
} from '../src/3d/gameplay/livingWorldFaunaDirector.js';
import {
  applyFaunaEcologyTick,
  LIVING_WORLD_FAUNA_ECOLOGY_POLICY,
  planFaunaEcologyTick,
  validateFaunaEcologyPlan,
} from '../src/3d/gameplay/livingWorldFaunaEcologyRuntime.js';

const frozen = (value, label) => assert.equal(Object.isFrozen(value), true, `${label} frozen`);

function makeHabitat(id, biome, x, z, overrides = {}) {
  return {
    id,
    biome,
    score: 0.82,
    occupancy: 0.12,
    food: 0.78,
    cover: 0.62,
    danger: 0.28,
    travel: 0.84,
    waterDepth: 0.04,
    slope: 0.16,
    position: { x, z },
    navReachable: true,
    groundValid: true,
    waterValid: true,
    canonicalBiome: biome,
    ...overrides,
  };
}

function makeCandidate(id, species, lod, x, z, overrides = {}) {
  return {
    id,
    species,
    lod,
    position: { x, z },
    ageSeconds: 5,
    spawnTime: 0,
    health: 1,
    groupId: `${species}-group`,
    habitatId: 'forest',
    protected: false,
    distanceMeters: 100,
    lastThreatAt: 9999,
    active: true,
    ...overrides,
  };
}

function makeThreat(id, kind, distanceMeters, overrides = {}) {
  return {
    id,
    kind,
    distanceMeters,
    ageSeconds: 0,
    hostile: true,
    visible: true,
    heard: false,
    confidence: 1,
    position: { x: distanceMeters, z: 0 },
    ...overrides,
  };
}

assert.equal(LIVING_WORLD_FAUNA_DIRECTOR_POLICY.deterministic, true);
assert.equal(LIVING_WORLD_FAUNA_ECOLOGY_POLICY.deterministic, true);
assertFrozen(LIVING_WORLD_FAUNA_DIRECTOR_POLICY, 'director policy');
assertFrozen(LIVING_WORLD_FAUNA_ECOLOGY_POLICY, 'ecology policy');

const simple = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('forest', 'forest', 20, 20)],
  candidates: [makeCandidate('wolf-1', 'wolf', 'near', 20, 20)],
  threats: [makeThreat('player', 'player', 20)],
});
assertFrozen(simple, 'simple plan');
assert.equal(simple.updates.length, 1);
assert.equal(simple.updates[0].state, 'flee');
assert.equal(simple.spawn.length, 1);
assert.equal(simple.spawn[0].placementContract, 'WorldAssetPlacementPipeline');
assert.equal(simple.spawn[0].materialContract, 'MaterialAssignmentCore');

const appliedSimpleCalls = [];
const appliedSimple = applyFaunaTick(simple, {
  spawnGroup: (directive) => {
    appliedSimpleCalls.push(`spawn:${directive.id}`);
    return directive.id;
  },
  updateActor: (update) => {
    appliedSimpleCalls.push(`update:${update.id}:${update.state}`);
    return update.id;
  },
});
assert.equal(appliedSimple.spawned.length, 1);
assert.equal(appliedSimple.updated, simple.updates.length);
assert.deepEqual(appliedSimpleCalls, ['spawn:forest:deer:1', 'update:wolf-1:flee']);

const calm = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('forest', 'forest', 20, 20)],
  candidates: [makeCandidate('deer-1', 'deer', 'near', 20, 20)],
  threats: [],
});
assert.equal(calm.updates[0].state, 'roam');
assert.equal(calm.updates[0].pressure, 0);

const stale = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('forest', 'forest', 20, 20)],
  candidates: [makeCandidate('deer-1', 'deer', 'near', 20, 20)],
  threats: [makeThreat('player', 'player', 5, { ageSeconds: 999 })],
});
assert.equal(stale.updates[0].state, 'roam');
assert.equal(stale.updates[0].threatId, '');

const prey = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('forest', 'forest', 20, 20)],
  candidates: [makeCandidate('wolf-1', 'wolf', 'near', 20, 20)],
  threats: [makeThreat('deer', 'deer', 20)],
});
assert.equal(prey.updates[0].state, 'stalk');
assert.equal(prey.updates[0].threatKind, 'deer');

const far = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('forest', 'forest', 20, 20)],
  candidates: [makeCandidate('deer-far', 'deer', 'far', 20, 20)],
  threats: [],
});
assert.equal(far.updates[0].lod, 'far');
assert.equal(far.updates[0].tickIntervalSeconds, 2);

const distant = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('forest', 'forest', 20, 20)],
  candidates: [makeCandidate('deer-distant', 'deer', 'distant', 20, 20)],
  threats: [],
});
assert.equal(distant.updates[0].lod, 'distant');
assert.equal(distant.updates[0].tickIntervalSeconds, 0.75);

const near = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('forest', 'forest', 20, 20)],
  candidates: [makeCandidate('deer-near', 'deer', 'near', 20, 20)],
  threats: [],
});
assert.equal(near.updates[0].lod, 'near');
assert.equal(near.updates[0].tickIntervalSeconds, 0);

const blocked = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('ocean', 'ocean', 20, 20, { score: 1, occupancy: 0, waterDepth: 2 })],
  candidates: [],
  threats: [],
});
assert.equal(blocked.spawn.length, 0);

const occupied = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('crowded', 'forest', 20, 20, { occupancy: 0.99 })],
  candidates: [],
  threats: [],
});
assert.equal(occupied.spawn.length, 0);

const lowScore = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('low', 'forest', 20, 20, { score: 0.1 })],
  candidates: [],
  threats: [],
});
assert.equal(lowScore.spawn.length, 0);

const noPosition = planFaunaTick({
  worldSeed: 'bridge',
  tick: 1,
  habitats: [makeHabitat('no-position', 'forest', 20, 20, { position: null })],
  candidates: [],
  threats: [],
});
assert.equal(noPosition.spawn.length, 0);

const malformed = planFaunaTick({
  worldSeed: 'bridge',
  tick: NaN,
  habitats: [
    { id: null, biome: null, score: NaN, occupancy: Infinity, position: null },
  ],
  candidates: [
    { id: null, species: null, lod: null },
  ],
  threats: [
    { id: null, kind: null, distanceMeters: Infinity, ageSeconds: NaN },
  ],
});
assertFrozen(malformed, 'malformed director plan');
assert.equal(malformed.tick, 0);
assert.equal(Array.isArray(malformed.spawn), true);
assert.equal(Array.isArray(malformed.updates), true);

const orderA = planFaunaTick({
  worldSeed: 'order',
  tick: 17,
  habitats: [makeHabitat('a', 'forest', 10, 20), makeHabitat('b', 'meadow', 30, 40)],
  candidates: [makeCandidate('z', 'wolf', 'near', 10, 20), makeCandidate('a', 'deer', 'near', 30, 40)],
  threats: [makeThreat('p2', 'player', 45), makeThreat('p1', 'player', 12)],
});
const orderB = planFaunaTick({
  worldSeed: 'order',
  tick: 17,
  habitats: [makeHabitat('b', 'meadow', 30, 40), makeHabitat('a', 'forest', 10, 20)],
  candidates: [makeCandidate('a', 'deer', 'near', 30, 40), makeCandidate('z', 'wolf', 'near', 10, 20)],
  threats: [makeThreat('p1', 'player', 12), makeThreat('p2', 'player', 45)],
});
assert.deepEqual(orderA, orderB);

const ecologyCases = [
  { id: 'deer-forest-day', species: 'deer', biome: 'forest', hour: 12, expectedRest: false },
  { id: 'deer-forest-night', species: 'deer', biome: 'forest', hour: 23, expectedRest: true },
  { id: 'deer-meadow-dawn', species: 'deer', biome: 'meadow', hour: 6, expectedRest: false },
  { id: 'deer-hills-dusk', species: 'deer', biome: 'hills', hour: 19, expectedRest: false },
  { id: 'wolf-taiga-night', species: 'wolf', biome: 'taiga', hour: 23, expectedRest: false },
  { id: 'wolf-taiga-day', species: 'wolf', biome: 'taiga', hour: 12, expectedRest: true },
  { id: 'wolf-forest-dawn', species: 'wolf', biome: 'forest', hour: 7, expectedRest: false },
  { id: 'wolf-hills-dusk', species: 'wolf', biome: 'hills', hour: 19, expectedRest: false },
  { id: 'horse-meadow-day', species: 'horse', biome: 'meadow', hour: 12, expectedRest: false },
  { id: 'horse-meadow-night', species: 'horse', biome: 'meadow', hour: 23, expectedRest: true },
  { id: 'horse-roadside-dawn', species: 'horse', biome: 'roadside', hour: 6, expectedRest: false },
  { id: 'horse-edge-dusk', species: 'horse', biome: 'settlement-edge', hour: 19, expectedRest: false },
  { id: 'dragon-mountain-day', species: 'dragon', biome: 'mountain', hour: 12, expectedRest: false },
  { id: 'dragon-volcanic-dusk', species: 'dragon', biome: 'volcanic', hour: 19, expectedRest: false },
  { id: 'dragon-ruins-night', species: 'dragon', biome: 'ruins', hour: 23, expectedRest: true },
  { id: 'dragon-mountain-dawn', species: 'dragon', biome: 'mountain', hour: 6, expectedRest: false },
];

for (const item of ecologyCases) {
  const speciesHabitat = makeHabitat(`${item.id}-habitat`, item.biome, 100, 200, {
    waterDepth: item.species === 'dragon' ? 0.2 : 0.05,
    slope: item.species === 'dragon' ? 0.4 : 0.14,
    canonicalBiome: item.biome,
  });
  const ecology = planFaunaEcologyTick({
    worldSeed: `matrix:${item.id}`,
    now: item.hour * 3600,
    clock: { hour: item.hour, day: 5, season: 'summer', weather: 'clear' },
    habitats: [speciesHabitat],
    candidates: [makeCandidate(`${item.id}:actor`, item.species, 'near', 100, 200, { habitatId: speciesHabitat.id })],
    threats: [],
    population: [{ species: item.species, habitatId: speciesHabitat.id, count: 0, juveniles: 0, adults: 0, lastSpawnAt: -999 }],
  });
  assert.equal(validateFaunaEcologyPlan(ecology).ok, true, item.id);
  assert.equal(ecology.updates[0].species, item.species, item.id);
  assert.equal(ecology.updates[0].schedule.rest, item.expectedRest, item.id);
  assert.equal(ecology.governance.materialOwner, 'MaterialAssignmentCore');
  assert.equal(ecology.governance.placementOwner, 'WorldAssetPlacementPipeline');
  frozen(ecology.updates[0], `${item.id} update`);
}

const threatCases = [
  { species: 'deer', kind: 'player', distance: 12, expected: 'flee' },
  { species: 'deer', kind: 'wolf', distance: 20, expected: 'flee' },
  { species: 'deer', kind: 'dragon', distance: 20, expected: 'flee' },
  { species: 'deer', kind: 'guard', distance: 20, expected: 'flee' },
  { species: 'horse', kind: 'wolf', distance: 12, expected: 'flee' },
  { species: 'horse', kind: 'dragon', distance: 16, expected: 'flee' },
  { species: 'horse', kind: 'player', distance: 16, expected: 'roam' },
  { species: 'wolf', kind: 'player', distance: 12, expected: 'flee' },
  { species: 'wolf', kind: 'dragon', distance: 14, expected: 'flee' },
  { species: 'wolf', kind: 'deer', distance: 20, expected: 'stalk' },
  { species: 'dragon', kind: 'player', distance: 18, expected: 'flee' },
  { species: 'dragon', kind: 'guard', distance: 18, expected: 'flee' },
];

for (const item of threatCases) {
  const habitatBiome = item.species === 'dragon' ? 'mountain' : item.species === 'horse' ? 'meadow' : 'forest';
  const result = planFaunaEcologyTick({
    worldSeed: `threat:${item.species}:${item.kind}`,
    now: 12 * 3600,
    clock: { hour: 12, day: 5, season: 'summer', weather: 'clear' },
    habitats: [makeHabitat(`threat:${item.species}`, habitatBiome, 200, 200, { slope: item.species === 'dragon' ? 0.3 : 0.12, waterDepth: 0.04 })],
    candidates: [makeCandidate(`threat:${item.species}`, item.species, 'near', 200, 200)],
    threats: [makeThreat(`threat:${item.kind}`, item.kind, item.distance)],
    population: [],
  });
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].state, item.expected, `${item.species}/${item.kind}`);
}

const lodInputs = [
  [10, 'near', 0],
  [179, 'near', 0],
  [180, 'distant', 0.75],
  [649, 'distant', 0.75],
  [650, 'far', 2],
  [1499, 'far', 2],
  [1500, 'far', 2],
  [4199, 'culled', 10],
  [4200, 'culled', 10],
  [9999, 'culled', 10],
];

for (const [distanceMeters, expectedLevel, expectedInterval] of lodInputs) {
  const result = planFaunaEcologyTick({
    worldSeed: `lod:${distanceMeters}`,
    now: 100,
    clock: { hour: 12 },
    habitats: [makeHabitat(`lod:${distanceMeters}`, 'forest', 10, 10)],
    candidates: [makeCandidate(`lod:${distanceMeters}`, 'deer', '', 10, 10, { distanceMeters })],
    threats: [],
  });
  assert.equal(result.updates[0].lod, expectedLevel, `lod ${distanceMeters}`);
  assert.equal(result.updates[0].tickIntervalSeconds, expectedInterval, `interval ${distanceMeters}`);
}

const commandPlan = planFaunaEcologyTick({
  worldSeed: 'commands',
  now: 500,
  clock: { hour: 18 },
  habitats: [makeHabitat('commands', 'forest', 10, 10)],
  candidates: [
    makeCandidate('flee-command', 'deer', 'near', 10, 10, { distanceMeters: 20 }),
    makeCandidate('roam-command', 'deer', 'distant', 10, 10, { distanceMeters: 500, groupId: 'herd' }),
  ],
  threats: [makeThreat('player', 'player', 15)],
});
assert.ok(commandPlan.commands.length >= 2);
assert.ok(commandPlan.commands.some((item) => item.type === 'flee'));
assert.ok(commandPlan.commands.some((item) => item.type === 'roam' || item.type === 'despawn'));
assert.ok(commandPlan.commands.every((item) => item.expiresAfterSeconds > 0));

const appliedEcology = applyFaunaEcologyTick(commandPlan, {
  dispatchCommand: (command) => command.id,
  updateActor: (payload) => payload.id || payload.actorId,
  spawnGroup: (directive) => directive.id,
  despawn: (payload) => payload.id,
}, 501);
assert.equal(appliedEcology.ok, true);
assert.equal(appliedEcology.errors.length, 0);
assert.ok(appliedEcology.dispatched >= commandPlan.commands.length);

const ownerFailure = applyFaunaEcologyTick(commandPlan, {
  dispatchCommand: () => { throw new Error('owner exploded'); },
  updateActor: () => { throw new Error('actor exploded'); },
  spawnGroup: () => { throw new Error('spawn exploded'); },
  despawn: () => { throw new Error('despawn exploded'); },
}, 502);
assert.equal(ownerFailure.ok, false);
assert.ok(ownerFailure.errors.length > 0);

const stress = planFaunaEcologyTick({
  worldSeed: 'stress',
  now: 999,
  clock: { hour: 22, day: 9, season: 'winter', weather: 'storm' },
  habitats: Array.from({ length: 90 }, (_, index) => makeHabitat(`stress-h${index}`, index % 3 === 0 ? 'taiga' : 'forest', index * 8, index * 9)),
  candidates: Array.from({ length: 140 }, (_, index) => makeCandidate(`stress-c${index}`, ['deer', 'wolf', 'horse', 'dragon'][index % 4], ['near', 'distant', 'far'][index % 3], index, index * 2, { distanceMeters: 60 + index * 40 })),
  threats: Array.from({ length: 80 }, (_, index) => makeThreat(`stress-t${index}`, ['player', 'wolf', 'dragon', 'guard'][index % 4], 10 + index * 5)),
  population: Array.from({ length: 100 }, (_, index) => ({ species: ['deer', 'wolf', 'horse', 'dragon'][index % 4], habitatId: `stress-h${index % 12}`, count: index % 7 })),
});
assert.ok(stress.updates.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCandidates);
assert.ok(stress.spawn.length <= 4);
assert.ok(stress.events.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxEvents);
assert.ok(stress.commands.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxCommands);
assert.ok(stress.schedule.length <= LIVING_WORLD_FAUNA_ECOLOGY_POLICY.maxPopulationRows);
assert.equal(validateFaunaEcologyPlan(stress).ok, true);

const noOwnerEcology = applyFaunaEcologyTick(stress, {}, 1000);
assert.equal(noOwnerEcology.ok, true);
assert.equal(noOwnerEcology.errors.length, 0);

const emptyDirectorApply = applyFaunaTick(null, {});
assert.equal(emptyDirectorApply.spawned.length, 0);
assert.equal(emptyDirectorApply.updated, 0);

const emptyEcologyApply = applyFaunaEcologyTick(null, {}, 1);
assert.equal(emptyEcologyApply.dispatched, 0);
assert.equal(emptyEcologyApply.ok, true);

console.log('LIVING_WORLD_FAUNA_DIRECTOR_BRIDGE_OK');
