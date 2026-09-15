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
  id: 'forest-edge',
  biome: 'forest',
  canonicalBiome: 'forest',
  position: { x: 14, z: -8 },
  score: 0.86,
  food: 0.72,
  water: 0.68,
  cover: 0.7,
  danger: 0.12,
  slopeDegrees: 18,
  waterDepthMeters: 0,
  distanceToSettlementMeters: 260,
  distanceToRoadMeters: 48,
  groundValid: true,
  navReachable: true,
  waterAccess: 0.9,
};

const context = normalizeEcologyContext({
  seed: 'safak-kartali-fauna-contract',
  tick: 42,
  clockSeconds: 13 * 3600,
  hour: 13,
  season: 'summer',
  weather: 'clear',
});

assert.equal(context.season, 'summer');
assert.equal(context.weather, 'clear');
assert.equal(LIVING_WORLD_ECOLOGY_POLICY.deterministic, true);

const safe = evaluateHabitat(habitat, 'wolf', context);
assert.equal(safe.accepted, true, `canonical habitat must be safe: ${JSON.stringify(safe)}`);

const blocked = evaluateHabitat({ ...habitat, canonicalBiome: 'ocean', biome: 'ocean' }, 'wolf', context);
assert.equal(blocked.accepted, false);

assert.ok(getSpeciesProfile('horse'));
assert.ok(getSpeciesProfile('dragon'));
assert.ok(getSpeciesProfile('wolf'));

const activityA = chooseEcologyActivity('wolf', { nearWater: true, threatLevel: 0.12 }, context.seed, context.clockSeconds);
const activityB = chooseEcologyActivity('wolf', { nearWater: true, threatLevel: 0.12 }, context.seed, context.clockSeconds);
assert.equal(activityA, activityB);

const groupA = chooseGroupSize('wolf', 'safak-kartali-fauna-contract', 0.4);
const groupB = chooseGroupSize('wolf', 'safak-kartali-fauna-contract', 0.4);
assert.equal(groupA, groupB);
assert.ok(groupA >= 1 && groupA <= LIVING_WORLD_ECOLOGY_POLICY.maxGroupSize);

const competition = speciesCompetitionScore('wolf', 'deer');
assert.equal(Number.isFinite(competition), true);

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

const malformed = evaluateHabitat({ ...habitat, position: { x: Number.NaN, z: 0 } }, 'wolf', context);
assert.equal(malformed.accepted, false, 'malformed habitat coordinates must fail closed');

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
