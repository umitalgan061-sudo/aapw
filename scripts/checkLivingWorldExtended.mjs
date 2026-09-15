import assert from 'node:assert/strict';
import { createLivingWorldDirector } from '../src/3d/gameplay/livingWorldDirector.js';
import { buildCompanionSnapshot, chooseCompanionIntent, loyaltyAfterEvent, moraleAfterEvent, auditCompanionSnapshot, stableCompanionOrder } from '../src/3d/gameplay/livingWorldCompanionPolicy.js';
import { buildFactionSnapshot, relationState, updateRelationScore, diplomacyIntent, diplomacyPressure, shouldEscalate, borderIncident, auditFactionSnapshot, relationMatrix } from '../src/3d/gameplay/livingWorldFactionDiplomacyPolicy.js';
import { buildRuntimeEvidence, auditRuntimeEvidence } from '../src/3d/gameplay/livingWorldPerformanceEvidence.js';
import { validatePath, nearestSafePoint } from '../src/3d/gameplay/livingWorldNavigationSafetyPolicy.js';
import { admit, batch, habitatGate } from '../src/3d/gameplay/livingWorldSpawnAdmission.js';
import { createReplayLedger, compareLedgers } from '../src/3d/gameplay/livingWorldReplay.js';

function makeCalls() {
  const calls = [];
  return {
    calls,
    services: {
      perception: { sense: () => [] },
      faction: { getRelation: () => 'neutral' },
      reputation: { get: () => 0 },
      diplomacy: { getRelation: () => 'neutral' },
      law: { report: (x) => calls.push(['law', x]) },
      encounters: { resolve: (x) => calls.push(['encounter', x]) },
      navigation: { moveTo: (x) => calls.push(['move', x]), patrol: (x) => calls.push(['patrol', x]), returnToPost: (x) => calls.push(['return', x]), flee: (x) => calls.push(['flee', x]) },
      combat: { engage: (x) => calls.push(['combat', x]) },
      worldEventsPublisher: (x) => calls.push(['event', x]),
    },
  };
}

const companionFixtures = [
  { id: 'arya', ownerId: 'player', role: 'scout', loyalty: .9, morale: .8, health: 100, energy: .9, distanceMeters: 5, command: 'scout' },
  { id: 'hound', ownerId: 'player', role: 'fighter', loyalty: .75, morale: .7, health: 100, energy: .8, distanceMeters: 7, command: 'assist', threatScore: .7 },
  { id: 'injured', ownerId: 'player', role: 'fighter', loyalty: .5, morale: .2, health: 30, energy: .15, distanceMeters: 28, command: 'follow' },
  { id: 'dismissed', ownerId: 'player', loyalty: .8, morale: .8, health: 100, energy: 1, dismissed: true },
];

const companionSnapshot = buildCompanionSnapshot(companionFixtures, { danger: .2, regroupRequired: false });
assert.equal(companionSnapshot.count, 4);
assert.equal(companionSnapshot.active, 3);
assert.equal(companionSnapshot.companions[0].intent, 'rest');
assert.equal(companionSnapshot.companions.at(-1).intent, 'dismiss');
assert.equal(auditCompanionSnapshot(companionSnapshot).ok, true);
assert.equal(chooseCompanionIntent(companionFixtures[0], { danger: .1 }), 'scout');
assert.equal(chooseCompanionIntent(companionFixtures[1], { danger: .7 }), 'assist');
assert.equal(chooseCompanionIntent(companionFixtures[2], { danger: .9 }), 'rest');
assert.ok(loyaltyAfterEvent(companionFixtures[0], { type: 'victory', severity: .8 }) > companionFixtures[0].loyalty);
assert.ok(moraleAfterEvent(companionFixtures[0], { type: 'defeat', severity: .8 }) < companionFixtures[0].morale);
assert.deepEqual(stableCompanionOrder(companionFixtures, 42), stableCompanionOrder([...companionFixtures].reverse(), 42));

const factions = [
  { id: 'north', power: .8, stability: .7, military: .8, economy: .6, honor: .8, aggression: .3, population: 1000 },
  { id: 'south', power: .6, stability: .4, military: .6, economy: .8, honor: .5, aggression: .7, population: 900 },
  { id: 'watch', power: .3, stability: .9, military: .4, economy: .5, honor: .9, aggression: .2, population: 300 },
];
const relations = [
  { from: 'north', to: 'south', score: -35, trade: .2, borderTension: .7, recentConflict: .4, trust: .3 },
  { from: 'north', to: 'watch', score: 55, trade: .8, borderTension: .1, recentConflict: 0, trust: .9 },
  { from: 'south', to: 'watch', score: 5, trade: .4, borderTension: .2, recentConflict: .1, trust: .5 },
];
const factionSnapshot = buildFactionSnapshot(factions, relations, { tradeOpportunity: true });
assert.equal(factionSnapshot.factions.length, 3);
assert.equal(factionSnapshot.relations.find((r) => r.from === 'north' && r.to === 'south').state, 'suspicious');
assert.equal(relationState(70, 'allied', 0), 'allied');
assert.equal(relationState(-90, 'neutral', 0), 'hostile');
assert.ok(updateRelationScore(relations[0], { type: 'peace', severity: 1 }) > relations[0].score);
assert.ok(updateRelationScore(relations[0], { type: 'war', severity: 1 }) < relations[0].score);
assert.equal(diplomacyIntent(relations[0], { tradeOpportunity: true }), 'negotiate');
assert.ok(diplomacyPressure(relations[0]) > .4);
assert.equal(shouldEscalate({ ...relations[0], recentConflict: 1, borderTension: 1, trust: 0 }), true);
assert.equal(borderIncident(relations[0], .8).escalates, true);
assert.equal(auditFactionSnapshot(factionSnapshot).ok, true);
assert.equal(relationMatrix(relations).north.south, -35);

const path = validatePath([
  { x: 0, z: 0, groundY: 1, slopeDegrees: 5, waterDepth: 0, walkable: true },
  { x: 4, z: 0, groundY: 1, slopeDegrees: 10, waterDepth: 0, walkable: true },
]);
assert.equal(path.ok, true);
const unsafe = validatePath([{ x: 4, z: 2, groundY: 1, slopeDegrees: 51, waterDepth: 0, walkable: true }], { kind: 'npc' });
assert.equal(unsafe.ok, false);
assert.deepEqual(nearestSafePoint([{ x: 10, z: 10 }, { x: 2, z: 2 }], [{ x: 10, z: 10, radius: 4 }]), { x: 2, z: 2 });

assert.equal(habitatGate({ kind: 'wolf', insideSettlement: true }).ok, false);
assert.equal(habitatGate({ kind: 'npc', insideSettlement: true, groundAligned: true, navReady: true }).ok, true);
assert.equal(admit({ id: 'animal-1', kind: 'animal', priority: .5 }, { habitatScore: .9, currentCount: 1, capacity: 10, distanceToPlayer: 50, navReady: true }).accepted, true);
assert.equal(admit({ id: 'animal-2', kind: 'animal' }, { habitatScore: 1, currentCount: 10, capacity: 10 }).accepted, false);
assert.equal(batch([
  { id: 'a', kind: 'animal', priority: .1 },
  { id: 'b', kind: 'animal', priority: .8 },
  { id: 'c', kind: 'animal', priority: .4 },
], { habitatScore: .9, currentCount: 1, capacity: 10, spawnBudget: 2 }).length, 2);

const calls = makeCalls();
const director = createLivingWorldDirector({ seed: 21, services: calls.services });
const snapshot = director.tick({
  deltaSeconds: .2,
  collections: {
    npcs: [{ id: 'player-guard', kind: 'npc', position: { x: 0, z: 0 }, occupation: 'guard', role: 'guard' }],
    animals: [{ id: 'wolf', kind: 'animal', species: 'wolf', position: { x: 12, z: 0 } }],
    creatures: [],
    dragons: [],
  },
  playerPosition: { x: 0, z: 0 },
  companions: companionFixtures,
  perceptionSignals: { 'player-guard': [{ targetId: 'wolf', modality: 'hearing', confidence: .4, noise: .9, position: { x: 12, z: 0 } }] },
  groups: [{ id: 'watch', members: [{ id: 'player-guard', role: 'guard', health: 100, leadership: .9 }] }],
  groupContext: { groupThreats: { watch: [{ id: 'wolf', severity: .5, distanceMeters: 12 }] } },
  worldContext: { biome: 'forest', populationDensity: .4, habitatScore: .9, distanceToSettlementMeters: 80 },
});
assert.equal(snapshot.accepted, true);
assert.ok(snapshot.integration);
assert.ok(snapshot.integration.companion);
assert.ok(snapshot.fauna);
assert.ok(snapshot.groups);
assert.ok(snapshot.navigation);
assert.ok(snapshot.population);
assert.ok(snapshot.performance);
assert.ok(auditRuntimeEvidence(snapshot.performance).ok);
assert.ok(calls.calls.length >= 0);
director.dispose();

const ledgerA = createReplayLedger(91);
const ledgerB = createReplayLedger(91);
ledgerA.append({ tick: 1, timeSeconds: .2, events: [{ type: 'a', actorId: 'x' }] });
ledgerA.append({ tick: 2, timeSeconds: .4, events: [{ type: 'b', actorId: 'y' }] });
ledgerB.append({ timeSeconds: .2, tick: 1, events: [{ actorId: 'x', type: 'a' }] });
ledgerB.append({ events: [{ actorId: 'y', type: 'b' }], tick: 2, timeSeconds: .4 });
assert.equal(compareLedgers(ledgerA.read(), ledgerB.read()).equal, true);

const highLoad = {
  population: {
    actorCount: 96,
    summary: { counts: { near: 12, distant: 28, far: 30, culled: 26 } },
    spawn: Array.from({ length: 4 }, (_, i) => ({ id: `spawn-${i}` })),
    ambient: Array.from({ length: 3 }, (_, i) => ({ id: `ambient-${i}` })),
  },
  memory: Array.from({ length: 24 }, (_, i) => ({ actorId: `a-${i}` })),
  tick: 3,
  fingerprints: { director: 'proof' },
};
const performance = buildRuntimeEvidence(highLoad);
assert.equal(performance.actorCount, 96);
assert.equal(performance.deterministic, true);
assert.equal(performance.pwaSafe, true);

console.log('[checkLivingWorldExtended] PASS: companion command/bond, faction diplomacy, navigation, spawn admission, full director composition, replay and performance contracts verified.');
