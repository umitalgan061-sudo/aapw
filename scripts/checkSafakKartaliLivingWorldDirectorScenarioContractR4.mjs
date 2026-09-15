import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createLivingWorldDirectorScenario,
  scenarioToRuntimeCollections,
  auditLivingWorldDirectorScenario,
  LIVING_WORLD_DIRECTOR_SCENARIO_POLICY,
} from '../src/3d/gameplay/livingWorldDirectorScenarioContract.js';
import { createLivingWorldDirector, auditDirectorPolicy, directorDigest } from '../src/3d/gameplay/livingWorldDirectorRuntimeAdapter.js';

const INPUT = 'artifacts/safak-kartali-living-world-director-scenario-r4-cases.jsonl';
const lines = fs.readFileSync(INPUT, 'utf8').trim().split(/\r?\n/);
const header = JSON.parse(lines[0]);
const rows = lines.slice(1).map((line) => JSON.parse(line));

assert.equal(header.schema, 'aapw-living-world-director-scenario-r4-cases');
assert.equal(header.version, 4);
assert.equal(header.cases, 4096);
assert.equal(header.roleCount, 16);
assert.equal(header.contextCount, 16);
assert.deepEqual(header.dimensions, ['role', 'context', 'urgency', 'threat']);
assert.equal(rows.length, 4096);

const roles = ['guard','merchant','healer','courier','farmer','hunter','blacksmith','innkeeper','scholar','scout','ranger','fisher','priest','noble','farrier','watcher'];
const contexts = ['quiet','day','dusk','night','market','road','forest','river','shore','village','town','frontier','storm','festival','combat','siege'];
const bands = [0, 0.25, 0.5, 0.75];
const ids = new Set();
const digests = new Set();
const roleCounts = new Map();
const contextCounts = new Map();
const urgencyCounts = new Map();
const threatCounts = new Map();
let acceptedTicks = 0;
let boundedActors = 0;

for (const row of rows) {
  assert.equal(row.index, ids.size);
  assert.equal(ids.has(row.caseId), false);
  ids.add(row.caseId);
  assert.ok(roles.includes(row.role));
  assert.ok(contexts.includes(row.context));
  assert.ok(bands.includes(row.urgency));
  assert.ok(bands.includes(row.threat));

  const scenario = createLivingWorldDirectorScenario({
    seed: 1000 + row.index,
    deltaSeconds: 0.016 + (row.index % 4) * 0.041,
    clockSeconds: (row.index * 7.5) % 86400,
    playerPosition: { x: row.distanceMeters * 0.1, z: -row.distanceMeters * 0.05 },
    actors: [
      { id: `${row.caseId}-npc`, kind: 'npc', state: `${row.context}:${row.role}`, x: 0, z: 0 },
      { id: `${row.caseId}-animal`, kind: 'animal', state: row.threat >= 0.5 ? 'flee' : 'forage', x: 12, z: -8 },
    ],
    eventContext: {
      urgency: row.urgency,
      threat: row.threat,
      scarcity: row.scarcity,
      socialNeed: row.socialNeed,
      travelRisk: row.travelRisk,
      weather: row.context,
    },
  });

  assert.equal(auditLivingWorldDirectorScenario(scenario).ok, true);
  const collections = scenarioToRuntimeCollections(scenario);
  const updates = [];
  const makeController = (actor) => ({
    id: actor.id,
    state: actor.state,
    object3D: { name: actor.id, position: { ...actor.position }, userData: {} },
    update(delta) { updates.push(delta); },
  });

  const runtime = createLivingWorldDirector({
    seed: scenario.seed,
    clockSeconds: scenario.clockSeconds,
    worldEventPublisher() {},
  });
  const result = runtime.tick({
    deltaSeconds: scenario.deltaSeconds,
    collections: {
      npcs: collections.npcs.map(makeController),
      animals: collections.animals.map(makeController),
      creatures: collections.creatures.map(makeController),
      dragons: collections.dragons.map(makeController),
    },
    playerPosition: scenario.playerPosition,
    eventContext: scenario.eventContext,
  });

  assert.equal(auditDirectorPolicy(result).ok, true);
  assert.equal(result.accepted, true);
  assert.ok(result.actorsUpdated <= LIVING_WORLD_DIRECTOR_SCENARIO_POLICY.maxRuntimeActors);
  assert.ok(updates.length <= LIVING_WORLD_DIRECTOR_SCENARIO_POLICY.maxRuntimeActors);
  const digest = directorDigest(result);
  assert.equal(digest.length, 8);
  digests.add(digest);

  roleCounts.set(row.role, (roleCounts.get(row.role) ?? 0) + 1);
  contextCounts.set(row.context, (contextCounts.get(row.context) ?? 0) + 1);
  urgencyCounts.set(row.urgency, (urgencyCounts.get(row.urgency) ?? 0) + 1);
  threatCounts.set(row.threat, (threatCounts.get(row.threat) ?? 0) + 1);
  acceptedTicks += 1;
  boundedActors += result.actorsUpdated;
  runtime.dispose();
  assert.equal(runtime.disposed, true);
}

assert.equal(ids.size, 4096);
assert.equal(acceptedTicks, 4096);
assert.ok(digests.size > 1);
assert.ok(boundedActors > 0);
for (const role of roles) assert.equal(roleCounts.get(role), 256);
for (const context of contexts) assert.equal(contextCounts.get(context), 256);
for (const band of bands) {
  assert.equal(urgencyCounts.get(band), 1024);
  assert.equal(threatCounts.get(band), 1024);
}

const malformed = createLivingWorldDirectorScenario({
  deltaSeconds: Infinity,
  playerPosition: { x: NaN, z: Infinity },
  actors: Array.from({ length: 32 }, (_, index) => ({ id: `overflow-${index}`, kind: 'npc', x: index, z: -index })),
  eventContext: { urgency: NaN, threat: Infinity },
});
assert.equal(auditLivingWorldDirectorScenario(malformed).ok, true);
assert.equal(malformed.actors.length, 8);
assert.ok(malformed.deltaSeconds <= LIVING_WORLD_DIRECTOR_SCENARIO_POLICY.maxDeltaSeconds);

console.log(JSON.stringify({ ok: true, rows: rows.length, uniqueIds: ids.size, uniqueDigests: digests.size, acceptedTicks, boundedActors }));
