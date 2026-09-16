import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

const directorSource = await readFile(new URL('../src/3d/gameplay/livingWorldFaunaEcologyDirector.js', import.meta.url), 'utf8');
assert.match(directorSource, /export function planLivingWorldFaunaEcologyTick/);
assert.match(directorSource, /export function buildFaunaEcologyReplayTape/);
assert.match(directorSource, /export function applyLivingWorldFaunaEcologyPlan/);

const sourceWithoutComments = directorSource
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\n)\s*\/\/.*$/gm, '$1');
const importSurface = sourceWithoutComments
  .replace(/'(?:\\.|[^'\\])*'|\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`/g, '');
assert.doesNotMatch(sourceWithoutComments, /^\s*import(?:[\s\S]*?)\sfrom\s+['\"]three['\"];?\s*$/m);
assert.doesNotMatch(sourceWithoutComments, /^\s*import\s+['\"]three['\"];?\s*$/m);
assert.doesNotMatch(importSurface, /\bdocument\s*\./);

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
  moisture: 0.5,
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
assert.equal(Number.isFinite(safe.score), true);
assert.ok(safe.score >= 0 && safe.score <= 1);

const blocked = evaluateHabitat('wolf', normalizeEcologyContext({
  ...context,
  waterDepthMeters: LIVING_WORLD_ECOLOGY_POLICY.maxWaterDepthMeters + 1,
}));
assert.equal(blocked.accepted, false);
assert.ok(blocked.reasons.includes('water-depth'));

for (const species of ['horse', 'wolf', 'bird']) {
  const profile = getSpeciesProfile(species);
  assert.ok(profile, `missing species profile: ${species}`);
  assert.equal(typeof profile.id, 'string');
  assert.equal(Number.isFinite(profile.maxGroupSize), true);
  assert.ok(profile.maxGroupSize >= 1);
}
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

const digestInput = { context, habitat: safe, activity: activityA, groupSize: groupA, competition };
const firstDigest = ecologyDigest(digestInput);
const secondDigest = ecologyDigest(JSON.parse(JSON.stringify(digestInput)));
assert.equal(firstDigest, secondDigest);

const malformed = evaluateHabitat('not-a-real-species', context);
assert.equal(malformed.accepted, false);
assert.ok(Array.isArray(malformed.reasons));
assert.ok(malformed.reasons.length > 0);

console.log(JSON.stringify({
  contract: 'safak-kartali-fauna-ecology',
  deterministic: firstDigest === secondDigest && activityA === activityB && groupA === groupB,
  runtimeSourceContract: true,
  habitatSafety: safe,
  blockedHabitat: blocked,
  malformedInputRejected: true,
  activity: activityA,
  groupSize: groupA,
  competition,
}));
