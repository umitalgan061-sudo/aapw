import assert from 'node:assert/strict';
import { planFaunaPopulationTick, auditFaunaPopulationPlan } from '../src/3d/gameplay/livingWorldFaunaPopulationDirector.js';
import { planFaunaThreatResponses, auditFaunaThreatResponses } from '../src/3d/gameplay/livingWorldFaunaThreatResponsePolicy.js';

const base = {
  seed: 'safak-threat-response',
  tick: 7,
  hour: 18,
  species: ['wolf', 'dragon', 'deer'],
  habitats: [
    { id: 'forest-edge', biome: 'forest', canonicalBiome: 'forest', position: { x: 12, y: 0, z: 18 }, groundValid: true, navReachable: true, score: 0.88, cover: 0.9, food: 0.7 },
    { id: 'high-crag', biome: 'highland', canonicalBiome: 'highland', position: { x: 100, y: 4, z: 120 }, groundValid: true, navReachable: true, score: 0.91, cover: 0.3, food: 0.2 },
  ],
  fauna: [
    { id: 'wolf-alpha', species: 'wolf', groupId: 'wolf-pack', habitatId: 'forest-edge', position: { x: 12, y: 0, z: 18 }, distanceMeters: 20, visible: true, active: true, health: 1 },
    { id: 'dragon-ancient', species: 'dragon', groupId: 'dragon-roost', habitatId: 'high-crag', position: { x: 100, y: 4, z: 120 }, distanceMeters: 160, visible: false, active: true, health: 1 },
  ],
  threats: [
    { id: 'player-noise', kind: 'intruder', distanceMeters: 64, confidence: 0.82, visible: false, heard: true, hostile: true, ageSeconds: 1 },
  ],
};

function run() {
  const population = planFaunaPopulationTick(base);
  assert.equal(auditFaunaPopulationPlan(population).ok, true);
  assert.equal(population.deterministic, true);

  const response = planFaunaThreatResponses(population);
  const audit = auditFaunaThreatResponses(response);
  assert.equal(audit.ok, true);
  assert.equal(response.deterministic, true);
  assert.ok(response.responses.length > 0);
  assert.ok(response.responses.some((row) => ['flee', 'stalk', 'attack', 'investigate'].includes(row.state)));
  assert.ok(response.responses.every((row) => row.command && row.memberCount <= 24));

  const replay = planFaunaThreatResponses(planFaunaPopulationTick(base));
  assert.equal(replay.digest, response.digest);

  console.log(JSON.stringify({
    ok: true,
    populationDigest: population.digest,
    responseDigest: response.digest,
    counts: response.counts,
    groups: response.responses.length,
    states: response.responses.map((row) => ({ groupId: row.groupId, state: row.state, action: row.command.action })),
  }));
}

run();
