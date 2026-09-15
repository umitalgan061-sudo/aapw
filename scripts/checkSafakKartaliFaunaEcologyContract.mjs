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

const habitat = {
  biome: 'forest',
  moisture: 0.72,
  slopeDegrees: 18,
  waterDepthMeters: 0,
  distanceToSettlementMeters: 260,
  distanceToRoadMeters: 48,
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

const malformed = evaluateHabitat('not-a-real-species', context);
assert.equal(malformed.accepted, false, 'unknown species must fail closed');
assert.ok(malformed.reasons.includes('unknown-species'));

console.log(JSON.stringify({
  contract: 'safak-kartali-fauna-ecology',
  deterministic: firstDigest === secondDigest,
  habitatSafety: safe,
  blockedHabitat: blocked,
  malformedInputRejected: malformed.accepted === false,
  activity: activityA,
  groupSize: groupA,
  competition,
}));
