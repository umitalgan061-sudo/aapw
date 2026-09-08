import assert from 'node:assert/strict';
import {
	evaluateHabitat,
	getSpeciesProfile,
	chooseEcologyActivity,
	chooseGroupSize,
	normalizeEcologyContext,
	planFaunaGroup,
	planHabitatSpecies,
	auditEcologyPlan,
	ecologyDigest,
	speciesCompetitionScore,
	LIVING_WORLD_ECOLOGY_POLICY,
} from '../src/3d/gameplay/livingWorldEcologyPolicy.js';

const snowForest = normalizeEcologyContext({
	biome: 'snow',
	temperatureC: -6,
	moisture: 0.58,
	slopeDegrees: 18,
	waterDepthMeters: 0,
	distanceToSettlementMeters: 420,
	distanceToRoadMeters: 80,
	clockSeconds: 2 * 3600,
	season: 'winter',
});

assert.equal(getSpeciesProfile('wolf')?.kind, 'predator');
assert.equal(getSpeciesProfile('WOLF')?.preferredMoisture, getSpeciesProfile('wolf')?.preferredMoisture);
const wolf = evaluateHabitat('wolf', snowForest);
assert.equal(wolf.accepted, true);
assert.equal(wolf.reasons.length, 0);
assert(wolf.score >= LIVING_WORLD_ECOLOGY_POLICY.minimumSpawnScore);

const desertWolf = evaluateHabitat('wolf', normalizeEcologyContext({
	biome: 'desert',
	temperatureC: 42,
	distanceToSettlementMeters: 10,
	distanceToRoadMeters: 4,
}));
assert.equal(desertWolf.accepted, false);
assert(desertWolf.reasons.includes('temperature'));
assert(desertWolf.reasons.includes('biome'));
assert(desertWolf.reasons.includes('settlement-buffer'));

const deepWater = evaluateHabitat('deer', normalizeEcologyContext({ biome: 'meadow', waterDepthMeters: 12, distanceToSettlementMeters: 400 }));
assert.equal(deepWater.accepted, false);
assert(deepWater.reasons.includes('water-depth'));

assert.equal(chooseEcologyActivity('wolf', { threatLevel: 0.9 }, 'seed', 22 * 3600), 'flee');
assert.equal(chooseEcologyActivity('deer', { threatLevel: 0, nearWater: true }, 'seed', 11 * 3600), 'drink');
assert.equal(chooseEcologyActivity('bee', { threatLevel: 0 }, 'seed', 10 * 3600), 'forage');

const countA = chooseGroupSize('wolf', 'pack-a', 1);
const countB = chooseGroupSize('wolf', 'pack-a', 1);
assert.equal(countA, countB);
assert(countA >= 2 && countA <= 6);
assert.equal(chooseGroupSize('bear', 'bear-a', 1), 1);

const group = planFaunaGroup({
	species: 'wolf',
	centerX: 100,
	centerZ: -50,
	radiusMeters: 30,
	seed: 'same-seed',
	context: snowForest,
});
assert.equal(group.accepted, true);
assert(group.points.length === group.groupSize);
assert.equal(auditEcologyPlan(group).ok, true);
assert.equal(ecologyDigest(group), ecologyDigest(JSON.parse(JSON.stringify(group))));
const groupRepeat = planFaunaGroup({
	species: 'wolf', centerX: 100, centerZ: -50, radiusMeters: 30, seed: 'same-seed', context: snowForest,
});
assert.deepEqual(group, groupRepeat);

const candidates = planHabitatSpecies({
	species: ['wolf', 'bear', 'deer', 'bison', 'goat', 'fox'],
	context: snowForest,
	seed: 'habitat',
	maxSpecies: 4,
});
assert.equal(candidates.length, 4);
assert.equal(new Set(candidates.map((entry) => entry.species)).size, 4);
for (let index = 1; index < candidates.length; index += 1) assert(candidates[index - 1].score >= candidates[index].score);

const competition = speciesCompetitionScore('wolf', ['bear', 'fox'], snowForest);
assert(competition >= 0 && competition <= 1);
assert.equal(auditEcologyPlan(null).ok, false);

console.log(JSON.stringify({
	pass: true,	wolfScore: wolf.score,	groupSize: group.groupSize,	selectedSpecies: candidates.map((entry) => entry.species),
	digest: ecologyDigest(group),
}, null, 2));
