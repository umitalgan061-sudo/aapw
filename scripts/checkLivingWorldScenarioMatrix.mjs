import assert from 'node:assert/strict';
import { createLivingWorldDirector, auditLivingWorldDirector } from '../src/3d/gameplay/livingWorldDirector.js';
import { buildGroupTacticalSnapshot, chooseTacticalIntent } from '../src/3d/gameplay/livingWorldGroupTacticsPolicy.js';
import { buildFaunaDirective, advanceFaunaNeeds, buildFaunaGroupDirective } from '../src/3d/gameplay/livingWorldFaunaNeedsPolicy.js';
import { buildAmbientEvents } from '../src/3d/gameplay/livingWorldAmbientEventPolicy.js';
import { navigationIntent, validatePath } from '../src/3d/gameplay/livingWorldNavigationSafetyPolicy.js';
import { buildSpawnIntent, habitatGate } from '../src/3d/gameplay/livingWorldSpawnAdmission.js';
import { summarizeFrameTimes, budgetVerdict } from '../src/3d/gameplay/livingWorldPerformanceEvidence.js';

const makeActor = (id, kind, position, extra = {}) => ({
  id,
  kind,
  position,
  health: 100,
  perception: { range: 40, hearing: 24 },
  ...extra,
});

const actorSet = () => ({
  guard: makeActor('guard-main', 'npc', { x: 0, z: 0 }, { occupation: 'guard', factionId: 'watch', role: 'guard' }),
  farmer: makeActor('farmer-main', 'npc', { x: 12, z: 2 }, { occupation: 'farmer', factionId: 'village' }),
  wolf: makeActor('wolf-main', 'animal', { x: 18, z: 0 }, { species: 'wolf', factionId: 'wild' }),
  deer: makeActor('deer-main', 'animal', { x: 60, z: 50 }, { species: 'deer', factionId: 'wild' }),
  dragon: makeActor('dragon-main', 'dragon', { x: 400, z: 250 }, { species: 'dragon', factionId: 'wild' }),
});

function servicesFor(calls = []) {
  return {
    perception: {
      sense(actor) {
        if (actor.id === 'guard-main') {
          return [{ targetId: 'wolf-main', modality: 'vision', confidence: .8, visible: true, hostile: true, position: { x: 18, z: 0 } }];
        }
        return [];
      },
    },
    faction: { getRelation: () => 'hostile' },
    reputation: { get: () => -30 },
    diplomacy: { getRelation: () => 'neutral' },
    law: { report: (payload) => calls.push(['law', payload]) },
    encounters: { resolve: (payload) => calls.push(['encounter', payload]) },
    navigation: {
      moveTo: (payload) => calls.push(['move', payload]),
      patrol: (payload) => calls.push(['patrol', payload]),
      returnToPost: (payload) => calls.push(['return', payload]),
      flee: (payload) => calls.push(['flee', payload]),
    },
    combat: { engage: (payload) => calls.push(['combat', payload]) },
    worldEventsPublisher: (payload) => calls.push(['world-event', payload]),
  };
}

function runScenario(name, options) {
  const calls = [];
  const actors = actorSet();
  const director = createLivingWorldDirector({ seed: 900 + name.length, services: servicesFor(calls), clockSeconds: 100 });
  const snapshot = director.tick({
    deltaSeconds: .2,
    collections: {
      npcs: [actors.guard, actors.farmer],
      animals: [actors.wolf, actors.deer],
      creatures: [],
      dragons: [actors.dragon],
    },
    playerPosition: options.playerPosition ?? { x: 0, z: 0 },
    worldContext: options.worldContext,
    faunaContext: options.faunaContext,
    perceptionSignals: options.perceptionSignals,
    crimeIncidents: options.crimeIncidents,
    groups: options.groups,
    groupContext: options.groupContext,
    ambientContext: options.ambientContext,
    navigationContext: options.navigationContext,
    spawnCandidates: options.spawnCandidates,
    eventTypes: options.eventTypes,
    worldEvents: options.worldEvents,
    occupations: options.occupations,
    settlements: options.settlements,
    placementCandidates: options.placementCandidates,
  });
  return { name, snapshot, calls, audit: auditLivingWorldDirector(snapshot) };
}

const scenarios = [
  {
    name: 'guard-patrol-detection',
    worldContext: { biome: 'forest', habitatScore: .9, distanceToSettlementMeters: 60 },
    perceptionSignals: { 'guard-main': [{ targetId: 'wolf-main', modality: 'vision', confidence: .9, visible: true, hostile: true, position: { x: 18, z: 0 } }] },
  },
  {
    name: 'stealth-in-darkness',
    worldContext: { biome: 'forest', timeOfDay: 2, habitatScore: .8, distanceToSettlementMeters: 100 },
    perceptionSignals: { 'guard-main': [{ targetId: 'wolf-main', modality: 'vision', confidence: .4, stealth: .9, noise: .05, position: { x: 18, z: 0 } }] },
  },
  {
    name: 'hearing-contact',
    worldContext: { biome: 'forest', habitatScore: .8 },
    perceptionSignals: { 'guard-main': [{ targetId: 'wolf-main', modality: 'hearing', confidence: .4, noise: .9, position: { x: 25, z: 2 } }] },
  },
  {
    name: 'crime-visible',
    worldContext: { biome: 'city', populationDensity: .8, distanceToSettlementMeters: 5 },
    crimeIncidents: [{ id: 'crime-1', actorId: 'farmer-main', factionId: 'watch', type: 'assault', severity: .55, witnesses: ['guard-main'], timestamp: 102 }],
  },
  {
    name: 'crime-unwitnessed',
    worldContext: { biome: 'city', populationDensity: .7, distanceToSettlementMeters: 10 },
    crimeIncidents: [{ id: 'crime-2', actorId: 'farmer-main', factionId: 'watch', type: 'theft', severity: .3, witnesses: [], timestamp: 102 }],
  },
  {
    name: 'forest-ambient',
    worldContext: { biome: 'forest', populationDensity: .3, timeOfDay: 13, weather: 'clear', distanceToSettlementMeters: 180 },
    ambientContext: { biome: 'forest', populationDensity: .6, danger: .1, timeOfDay: 13, season: 'summer' },
    eventTypes: ['festival', 'storm', 'migration'],
  },
  {
    name: 'autumn-migration',
    worldContext: { biome: 'meadow', populationDensity: .5 },
    ambientContext: { biome: 'meadow', populationDensity: .8, danger: .2, timeOfDay: 10, season: 'autumn' },
    eventTypes: ['migration'],
  },
  {
    name: 'predator-stampede',
    worldContext: { biome: 'meadow', populationDensity: .7 },
    faunaContext: { populationDensity: .8, faunaThreats: { 'deer-main': [{ id: 'wolf-main', kind: 'predator', severity: .9, position: { x: 50, z: 45 } }] } },
    ambientContext: { biome: 'meadow', populationDensity: .9, danger: .8, groupCount: 8, predatorThreat: .9, noise: .8, timeOfDay: 15 },
    eventTypes: ['stampede'],
  },
  {
    name: 'dragon-roost-pressure',
    worldContext: { biome: 'mountain', populationDensity: .2, distanceToSettlementMeters: 400 },
    faunaContext: { populationDensity: .8, faunaTravelRequired: { 'dragon-main': true }, faunaDestination: { 'dragon-main': { x: 500, z: 500 } } },
  },
  {
    name: 'mobile-population',
    worldContext: { biome: 'forest', populationDensity: 1, distanceToSettlementMeters: 120, mobile: true },
  },
  {
    name: 'pwa-population',
    worldContext: { biome: 'forest', populationDensity: 1, distanceToSettlementMeters: 120, pwa: true },
  },
  {
    name: 'nav-blocked-slope',
    worldContext: { biome: 'mountain', habitatScore: .8 },
    navigationContext: {
      paths: { 'guard-main': [{ x: 0, z: 0, groundY: 2, slopeDegrees: 50, walkable: true }] },
      navigationByActor: { 'guard-main': { returnHome: true, pathSamples: [{ x: 0, z: 0, groundY: 2, slopeDegrees: 50, walkable: true }] } },
    },
  },
  {
    name: 'nav-flee-water',
    worldContext: { biome: 'coast', habitatScore: .7 },
    navigationContext: {
      threatByActor: { 'wolf-main': { x: 20, z: 0 } },
      safePositions: [{ x: 40, z: 30 }],
      paths: { 'wolf-main': [{ x: 18, z: 0, groundY: 1, slopeDegrees: 4, waterDepth: 0, walkable: true }] },
      navigationByActor: { 'wolf-main': { fleePosition: { x: 40, z: 30 }, pathSamples: [{ x: 18, z: 0, groundY: 1, slopeDegrees: 4, waterDepth: 0, walkable: true }] } },
    },
  },
  {
    name: 'spawn-habitat-accepted',
    worldContext: { biome: 'forest', habitatScore: .95, distanceToSettlementMeters: 150, spawnKind: 'animal', spawnCapacity: 20, navReady: true },
    spawnCandidates: [{ id: 'wolf-spawn', kind: 'animal', species: 'wolf', priority: .3 }],
  },
  {
    name: 'spawn-habitat-blocked',
    worldContext: { biome: 'city', habitatScore: 1, insideSettlement: true, spawnKind: 'animal', spawnCapacity: 20 },
    spawnCandidates: [{ id: 'wolf-spawn-blocked', kind: 'animal', species: 'wolf', priority: .4 }],
  },
  {
    name: 'group-engage',
    worldContext: { biome: 'steppe', habitatScore: .8 },
    groups: [{ id: 'watch-alpha', memberIds: ['guard-main', 'farmer-main'], leaderId: 'guard-main', formation: 'wedge' }],
    groupContext: { groupThreats: { 'watch-alpha': [{ id: 'wolf-main', severity: .9, distanceMeters: 12, targetingGroup: true }] } },
  },
  {
    name: 'group-protect-civilian',
    worldContext: { biome: 'village', habitatScore: .9 },
    groups: [{ id: 'watch-beta', memberIds: ['guard-main', 'farmer-main'], leaderId: 'guard-main', civilianIds: ['farmer-main'] }],
    groupContext: { civilianThreats: { 'watch-beta': true }, civilianPositions: { 'watch-beta': { x: 12, z: 2 } }, groupThreats: { 'watch-beta': [{ id: 'wolf-main', severity: .8, position: { x: 15, z: 2 } }] } },
  },
  {
    name: 'group-retreat',
    worldContext: { biome: 'mountain', habitatScore: .6 },
    groups: [{ id: 'watch-gamma', memberIds: ['guard-main', 'farmer-main'] }],
    groupContext: { groupRuntime: { 'watch-gamma': { elapsedSeconds: 20, maxPursuitSeconds: 18, pursuitTimeout: true } } },
  },
  {
    name: 'fauna-rest',
    worldContext: { biome: 'forest', habitatScore: .9 },
    faunaContext: { faunaThreats: {}, distanceToFoodMeters: { 'deer-main': 200 }, distanceToWaterMeters: { 'deer-main': 200 } },
  },
  {
    name: 'fauna-flee',
    worldContext: { biome: 'forest', habitatScore: .9 },
    faunaContext: { faunaThreats: { 'deer-main': [{ id: 'wolf-main', kind: 'predator', severity: .9, position: { x: 60, z: 50 } }] } },
  },
  {
    name: 'settlement-farmer',
    worldContext: { biome: 'meadow', habitatScore: .9, distanceToSettlementMeters: 40 },
    settlements: [{ settlementId: 'farm-town', position: { x: 20, z: 0 }, farmland: 1, market: .8, services: ['market'], capacity: 200, population: 80 }],
  },
  {
    name: 'mixed-weather',
    worldContext: { biome: 'coast', weather: 'storm', weatherRisk: .9, populationDensity: .4 },
    ambientContext: { biome: 'coast', weather: 'storm', weatherRisk: .9, populationDensity: .6, danger: .4, timeOfDay: 17 },
    eventTypes: ['storm'],
  },
  {
    name: 'event-danger-too-high',
    worldContext: { biome: 'city', populationDensity: .9 },
    ambientContext: { biome: 'city', populationDensity: .9, danger: .9, timeOfDay: 19 },
    eventTypes: ['festival'],
  },
  {
    name: 'determinism-a',
    worldContext: { biome: 'forest', populationDensity: .5, distanceToSettlementMeters: 90 },
    worldEvents: [{ type: 'patrol-alert', actorId: 'guard-main', tick: 1 }],
  },
  {
    name: 'determinism-b',
    worldContext: { biome: 'forest', populationDensity: .5, distanceToSettlementMeters: 90 },
    worldEvents: [{ tick: 1, actorId: 'guard-main', type: 'patrol-alert' }],
  },
];

const results = scenarios.map((scenario) => runScenario(scenario.name, scenario));
for (const result of results) {
  assert.equal(result.snapshot.accepted, true, `${result.name} rejected`);
  assert.equal(result.audit.ok, true, `${result.name} audit failed`);
  assert.ok(result.snapshot.fingerprints.director.length > 0, `${result.name} missing director fingerprint`);
}

const determinismA = results.find((row) => row.name === 'determinism-a');
const determinismB = results.find((row) => row.name === 'determinism-b');
assert.equal(determinismA.snapshot.fingerprints.director, determinismB.snapshot.fingerprints.director);

const tactical = buildGroupTacticalSnapshot({
  id: 'matrix-group',
  members: [makeActor('g1', 'npc', { x: 0, z: 0 }, { role: 'guard', leadership: .9 }), makeActor('g2', 'npc', { x: 6, z: 0 }, { role: 'archer', leadership: .4 })],
}, { threats: [{ id: 'hostile', severity: .9, distanceMeters: 10, targetingGroup: true }], rangedAdvantage: true });
assert.equal(tactical.intent, 'focus-fire');
assert.equal(tactical.memberIntents[1].action, 'ranged-focus');

const faunaState = advanceFaunaNeeds({ energy: 1, hunger: .1, thirst: .1, stress: 0, territoryPressure: 0 }, 20, { predatorNearby: true, density: .7 });
const faunaDirective = buildFaunaDirective(makeActor('fauna', 'animal', { x: 0, z: 0 }, { species: 'deer' }), faunaState, { threats: [{ id: 'predator', kind: 'predator', severity: .9, position: { x: 2, z: 0 } }], position: { x: 0, z: 0 } });
assert.equal(faunaDirective.activity, 'flee');
const faunaGroup = buildFaunaGroupDirective({ id: 'herd', species: 'deer', memberIds: ['a', 'b'], population: 7, territoryRadiusMeters: 90, rivalGroups: 2 }, { threats: [{ severity: .8 }] });
assert.ok(['flee', 'travel-territory', 'graze-roam'].includes(faunaGroup.intent));

const ambient = buildAmbientEvents({ biome: 'forest', populationDensity: .7, danger: .1, season: 'autumn', timeOfDay: 11 }, ['migration', 'festival'], 55);
assert.ok(ambient.some((row) => row.type === 'migration'));

const blockedNav = validatePath([{ x: 0, z: 0, groundY: 2, slopeDegrees: 60, walkable: true }], { kind: 'npc' });
assert.equal(blockedNav.ok, false);
assert.equal(navigationIntent({}, { pathSamples: [{ x: 0, z: 0, groundY: 2, slopeDegrees: 60, walkable: true }] }).intent, 'repath');

assert.equal(habitatGate({ kind: 'animal', insideSettlement: true }).ok, false);
assert.equal(buildSpawnIntent({ id: 'x', kind: 'animal', species: 'wolf' }, { habitatScore: .9, currentCount: 1, capacity: 10, navReady: true }).accepted, true);

const frameEvidence = summarizeFrameTimes([3, 4, 4, 5, 6, 7, 7]);
assert.equal(frameEvidence.withinBudget, true);
assert.equal(budgetVerdict(4, 8).ok, true);

console.log(`[checkLivingWorldScenarioMatrix] PASS: ${results.length} deterministic living-world scenarios plus tactical/fauna/ambient/navigation/spawn/perf unit proofs.`);
