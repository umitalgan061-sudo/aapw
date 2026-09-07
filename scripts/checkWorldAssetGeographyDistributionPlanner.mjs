#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY,
  distributeWorldAssetCandidates,
  evaluateWorldAssetDistributionCandidate,
  rankWorldAssetDistributionCandidates,
  summarizeWorldAssetDistribution,
} from '../src/3d/world/worldAssetGeographyDistributionPlanner.js';

function fixture({
  id,
  family,
  x,
  z,
  moisture = 0.52,
  slopeDegrees = 8,
  coastDistance = 500,
  riverDistance = 500,
  lakeDistance = 500,
  roadDistance = 80,
  settlementDistance = 120,
  snow = 0,
  biome = 'meadow',
  lithic = 0.25,
  deposition = 0.55,
  erosion = 0.35,
  shelter = 0.62,
  normalizedX,
  normalizedY,
}) {
  return {
    id,
    family,
    x,
    z,
    normalizedX,
    normalizedY,
    surface: {
      x,
      z,
      height: 50 + z * 0.01,
      slopeDegrees,
      aspectRadians: 0.3,
      moisture,
      biome,
      waterDepth: 0,
      riverDistance,
      lakeDistance,
      coastDistance,
      roadDistance,
      settlementDistance,
      snow,
      lithic,
      deposition,
      erosion,
      shelter,
    },
    metadata: { id, family },
  };
}

function meadowCandidate(index) {
  return fixture({
    id: `meadow-tree-${index}`,
    family: index % 4 === 0 ? 'shrub' : 'tree',
    x: (index % 8) * 14,
    z: Math.floor(index / 8) * 17,
    normalizedX: 0.30 + ((index % 8) / 8) * 0.10,
    normalizedY: 0.45 + (Math.floor(index / 8) / 8) * 0.10,
  });
}

const candidates = Array.from({ length: 64 }, (_, index) => meadowCandidate(index));
for (let index = 0; index < 10; index++) {
  candidates.push(fixture({
    id: `river-bank-${index}`,
    family: 'waterside',
    x: 20 + index * 15,
    z: 140 + Math.sin(index) * 12,
    riverDistance: 7 + index,
    lakeDistance: 300,
    moisture: 0.78,
    biome: 'riparian meadow',
    normalizedX: 0.39,
    normalizedY: 0.52 + index * 0.005,
  }));
}
for (let index = 0; index < 10; index++) {
  candidates.push(fixture({
    id: `coast-rock-${index}`,
    family: 'rock',
    x: 250 + index * 16,
    z: 220 + Math.cos(index) * 10,
    coastDistance: 12 + index * 6,
    moisture: 0.46,
    biome: 'coastal cliff',
    lithic: 0.86,
    erosion: 0.72,
    normalizedX: 0.52 + index * 0.006,
    normalizedY: 0.70,
  }));
}

const firstRank = rankWorldAssetDistributionCandidates(candidates, { seed: 0x7733 });
const secondRank = rankWorldAssetDistributionCandidates(candidates, { seed: 0x7733 });
assert.deepEqual(
  firstRank.map((candidate) => [candidate.id, candidate.score, candidate.continuityHint]),
  secondRank.map((candidate) => [candidate.id, candidate.score, candidate.continuityHint]),
  'ranking must be deterministic for identical inputs',
);
assert.equal(firstRank.length, candidates.length, 'all valid candidates should remain rankable');

const selected = distributeWorldAssetCandidates(candidates, {
  seed: 0x7733,
  limit: 28,
  minimumScore: 0.22,
  quotas: {
    tree: { minimum: 4, target: 10 },
    shrub: { minimum: 2, target: 5 },
    waterside: { minimum: 3, target: 5 },
  },
});
assert.ok(selected.selected.length > 0, 'planner must select candidates');
assert.ok(selected.selected.length <= 28, 'planner must respect hard limit');
assert.ok(selected.selectedIds instanceof Set, 'selectedIds should be a Set');
assert.equal(selected.selectedIds.size, selected.selected.length, 'selected IDs should be unique');

const counts = selected.diagnostics.selectedFamilyCounts;
assert.ok((counts.tree ?? 0) >= 4, 'tree minimum quota must be satisfiable in the fixture');
assert.ok((counts.shrub ?? 0) >= 2, 'shrub minimum quota must be satisfiable in the fixture');
assert.ok((counts.waterside ?? 0) >= 3, 'waterside minimum quota must be satisfiable in the fixture');
assert.ok(selected.diagnostics.selectedMeanScore >= WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.neighbourSuppressionMeters / 100);

const direct = evaluateWorldAssetDistributionCandidate(candidates[0], { seed: 0x7733 });
assert.equal(direct.id, candidates[0].id);
assert.ok(Number.isFinite(direct.score));
assert.ok(Number.isFinite(direct.baseScore));
assert.ok(direct.profile);
assert.ok(direct.validity.ok);
assert.ok(direct.context.domains.length > 0);
assert.ok(Number.isFinite(direct.transitionFactor));
assert.ok(Number.isFinite(direct.corridorFactor));

const coastal = evaluateWorldAssetDistributionCandidate(candidates.at(-1), { seed: 0x7733 });
assert.equal(coastal.family, 'rock');
assert.ok(coastal.corridorFactor > 0.01, 'coastal candidate should expose a non-zero corridor influence');
assert.ok(coastal.context.coast > 0, 'coastal candidate must see coast proximity');

const summary = summarizeWorldAssetDistribution(firstRank, selected.selected, { limit: 28 });
assert.equal(summary.candidateCount, firstRank.length);
assert.equal(summary.selectedCount, selected.selected.length);
assert.equal(summary.requestedLimit, 28);
assert.equal(summary.deterministic, true);

const changedSeed = distributeWorldAssetCandidates(candidates, {
  seed: 0x9911,
  limit: 28,
});
assert.notDeepEqual(
  changedSeed.selected.map((candidate) => candidate.id),
  selected.selected.map((candidate) => candidate.id),
  'seed should be able to alter deterministic tie breaking without changing policy semantics',
);

const strictReject = distributeWorldAssetCandidates(
  [fixture({ id: 'impossible-water-building', family: 'building', x: 0, z: 0, moisture: 0.99, slopeDegrees: 55, waterDepth: 4 })],
  { seed: 1, limit: 1, minimumScore: 0.95, rejectPoor: true },
);
assert.equal(strictReject.selected.length, 0, 'strict high-threshold distribution should reject a poor candidate');

console.log(JSON.stringify({
  ok: true,
  policyId: WORLD_ASSET_DISTRIBUTION_PLANNER_POLICY.id,
  candidateCount: candidates.length,
  rankedCount: firstRank.length,
  selectedCount: selected.selected.length,
  selectedFamilyCounts: selected.diagnostics.selectedFamilyCounts,
  changedSeedSelectionCount: changedSeed.selected.length,
}, null, 2));
