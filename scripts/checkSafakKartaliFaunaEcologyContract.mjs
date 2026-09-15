import assert from 'node:assert/strict';
import {
  LIVING_WORLD_ECOLOGY_POLICY,
  getSpeciesProfile,
  evaluateHabitat,
  chooseEcologyActivity,
  chooseGroupSize,
  speciesCompetitionScore,
  normalizeEcologyContext,
  ecologyDigest,
} from '../src/3d/gameplay/livingWorldEcologyPolicy.js';
import {
  planLivingWorldFaunaEcologyTick,
  applyLivingWorldFaunaEcologyPlan,
  buildFaunaEcologyReplayTape,
  compareFaunaEcologyReplays,
  auditFaunaEcologyAssetBearingSpawns,
  validateFaunaEcologyInput,
  summarizeFaunaEcology,
  getFaunaEcologyLod,
  getFaunaEcologyTickInterval,
} from '../src/3d/gameplay/livingWorldFaunaEcologyDirector.js';

const habitat = {
  id: 'pine-edge',
  biome: 'forest',
  canonicalBiome: 'forest',
  position: { x: 12, z: -8 },
  score: 0.88,
  occupancy: 0.18,
  food: 0.82,
  water: 0.7,
  cover: 0.76,
  danger: 0.12,
  slopeDegrees: 18,
  waterDepthMeters: 0,
  distanceToSettlementMeters: 260,
  distanceToRoadMeters: 48,
  groundValid: true,
  navReachable: true,
  roadAccess: 0.55,
  waterAccess: 0.8,
  reproductionPressure: 0.2,
  resourceRegeneration: 0.64,
};

const context = normalizeEcologyContext({
  biome: habitat.biome,
  moisture: habitat.moisture,
  slopeDegrees: habitat.slopeDegrees,
  waterDepthMeters: habitat.waterDepthMeters,
  distanceToSettlementMeters: habitat.distanceToSettlementMeters,
  distanceToRoadMeters: habitat.distanceToRoadMeters,
  nearWater: true,
  threatLevel: 0.12,
  clockSeconds: 13 * 3600,
  season: 'summer',
});

assert.equal(context.season, 'summer');
assert.equal(context.nearWater, true);
assert.equal(context.threatLevel, 0.12);
assert.equal(LIVING_WORLD_ECOLOGY_POLICY.deterministic, true);

const safe = evaluateHabitat('wolf', context);
assert.equal(safe.accepted, true, `canonical habitat must be safe: ${JSON.stringify(safe)}`);

const blocked = evaluateHabitat('wolf', normalizeEcologyContext({
  ...context,
  waterDepthMeters: LIVING_WORLD_ECOLOGY_POLICY.maxWaterDepthMeters + 1,
}));
assert.equal(blocked.accepted, false);
assert.ok(blocked.reasons.includes('water-depth'));

assert.ok(getSpeciesProfile('horse'));
assert.ok(getSpeciesProfile('wolf'));
assert.ok(getSpeciesProfile('bird'));

const activityA = chooseEcologyActivity('wolf', context, 'safak-kartali-fauna-contract', context.clockSeconds);
const activityB = chooseEcologyActivity('wolf', context, 'safak-kartali-fauna-contract', context.clockSeconds);
assert.equal(activityA, activityB);

const groupA = chooseGroupSize('wolf', 'safak-kartali-fauna-contract', 0.4);
const groupB = chooseGroupSize('wolf', 'safak-kartali-fauna-contract', 0.4);
assert.equal(groupA, groupB);
assert.ok(groupA >= 1 && groupA <= LIVING_WORLD_ECOLOGY_POLICY.maxGroupSize);

const competition = speciesCompetitionScore('wolf', ['deer'], context);
assert.equal(Number.isFinite(competition), true);
assert.ok(competition >= 0 && competition <= 1);

const digestInput = {
  context,
  habitat: safe,
  activity: activityA,
  groupSize: groupA,
  competition,
};
const firstDigest = ecologyDigest(digestInput);
const secondDigest = ecologyDigest(JSON.parse(JSON.stringify(digestInput)));
assert.equal(firstDigest, secondDigest);

const directorInput = {
  seed: 'safak-kartali-runtime-proof',
  tick: 17,
  clockSeconds: 13 * 3600,
  hour: 13,
  season: 'summer',
  weather: 'clear',
  playerPosition: { x: 0, z: 0 },
  maxSpawns: 3,
  maxTicksPerSecond: 220,
  deltaSeconds: 1.5,
  species: ['horse', 'wolf', 'bird'],
  habitats: [habitat],
  actors: [
    {
      id: 'wolf-1',
      species: 'wolf',
      groupId: 'pack-pine',
      habitatId: 'pine-edge',
      position: { x: 18, z: -6 },
      ageSeconds: 3200,
      health: 0.92,
      hunger: 0.24,
      thirst: 0.2,
      fatigue: 0.18,
      alive: true,
    },
    {
      id: 'horse-1',
      species: 'horse',
      groupId: 'herd-pine',
      habitatId: 'pine-edge',
      position: { x: 26, z: -2 },
      ageSeconds: 4200,
      health: 0.96,
      hunger: 0.2,
      thirst: 0.18,
      fatigue: 0.12,
      alive: true,
    },
  ],
  threats: [
    {
      id: 'threat-1',
      position: { x: 20, z: -5 },
      visible: true,
      heard: false,
      confidence: 0.9,
      ageSeconds: 1,
      factionId: 'rangers',
      wanted: 0.3,
      hostile: false,
    },
  ],
  resources: [
    { id: 'water-1', kind: 'water', habitatId: 'pine-edge', position: { x: 16, z: -8 }, amount: 0.9, regeneration: 0.6 },
    { id: 'food-1', kind: 'food', habitatId: 'pine-edge', position: { x: 22, z: -4 }, amount: 0.8, regeneration: 0.5 },
  ],
};

const plan = planLivingWorldFaunaEcologyTick(directorInput);
assert.equal(plan.deterministic, true);
assert.equal(plan.audit.ok, true, JSON.stringify(plan.audit));
assert.equal(plan.budget.acceptable, true, JSON.stringify(plan.budget));
assert.ok(plan.populationLod.estimatedTicksPerSecond <= 220);
assert.equal(auditFaunaEcologyAssetBearingSpawns(plan).ok, true);
assert.equal(validateFaunaEcologyInput(directorInput).ok, true);
assert.ok(['near', 'distant', 'far', 'culled'].includes(getFaunaEcologyLod(500)));
assert.equal(getFaunaEcologyTickInterval('culled'), 8);

const replayA = buildFaunaEcologyReplayTape(directorInput);
const replayB = buildFaunaEcologyReplayTape(JSON.parse(JSON.stringify(directorInput)));
assert.deepEqual(compareFaunaEcologyReplays(replayA, replayB), {
  equal: true,
  leftDigest: replayA.digest,
  rightDigest: replayB.digest,
});

const ownerCalls = [];
const applied = applyLivingWorldFaunaEcologyPlan(plan, {
  spawnGroup: (spawn) => {
    ownerCalls.push(`spawn:${spawn.species}`);
    return spawn.id;
  },
  updateActor: (intent) => ownerCalls.push(`actor:${intent.id}`),
  updateGroup: (group) => ownerCalls.push(`group:${group.id}`),
  emitWorldEvent: (event) => ownerCalls.push(`event:${event.eventId || event.type}`),
  observeFaction: (hook) => ownerCalls.push(`faction:${hook.factionId}`),
  observeLaw: (hook) => ownerCalls.push(`law:${hook.targetId}`),
});
assert.equal(applied.updated, plan.actorIntents.length);
assert.ok(ownerCalls.length >= applied.updated);

console.log(JSON.stringify({
  contract: 'safak-kartali-fauna-ecology',
  deterministic: firstDigest === secondDigest && replayA.digest === replayB.digest,
  habitatSafety: safe,
  blockedHabitat: blocked,
  malformedInputRejected: evaluateHabitat('not-a-real-species', context).accepted === false,
  activity: activityA,
  groupSize: groupA,
  competition,
  runtime: summarizeFaunaEcology(plan),
  applied,
}));
