#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  distributeWorldAssetCandidates,
  rankWorldAssetDistributionCandidates,
} from '../src/3d/world/worldAssetGeographyDistributionPlanner.js';
import {
  sampleWorldAssetGeographyProfile,
  validateAssetGeographyProfile,
} from '../src/3d/world/worldAssetGeographyProfile.js';
import { sampleWorldAssetTransitionField } from '../src/3d/world/worldAssetTransitionField.js';
import { regionalAnchorInfluences } from '../src/3d/world/worldAssetRegionalAnchors.js';

const families = ['tree', 'vegetation', 'shrub', 'rock', 'snow', 'building', 'settlement', 'waterside'];
const biomes = ['woodland', 'meadow', 'dry heath', 'wetland marsh', 'riparian meadow', 'coast', 'alpine ridge', 'scree', 'snowfield', 'volcanic'];
const sizes = [4, 12, 28];

function finite(value) {
  return Number.isFinite(value);
}

function fixture(index, family, biome, size) {
  const gx = index % 20;
  const gz = Math.floor(index / 20);
  const normalizedX = gx / 19;
  const normalizedY = gz / 19;
  const coastDistance = biome === 'coast' ? 8 + (gx % 11) * 7 : 300 + gx * 21;
  const riverDistance = /riparian|wetland|meadow/.test(biome) ? 6 + (gz % 13) * 5 : 250 + gz * 17;
  const slopeDegrees = /alpine|scree/.test(biome) ? 34 + (gx % 20) : /meadow|woodland/.test(biome) ? 4 + (gz % 12) : 12 + ((gx + gz) % 22);
  const moisture = /wetland|riparian/.test(biome) ? 0.82 + (index % 7) * 0.02 : /dry heath|volcanic/.test(biome) ? 0.12 + (index % 6) * 0.025 : 0.34 + ((index * 13) % 40) / 100;
  const snow = biome === 'snowfield' ? 0.82 : /alpine|scree/.test(biome) ? 0.30 + (index % 5) * 0.10 : biome === 'volcanic' ? 0.04 : 0;
  const lithic = /scree|alpine|volcanic|coast/.test(biome) ? 0.72 + (index % 6) * 0.035 : 0.20 + (index % 8) * 0.04;
  return {
    id: `stress-${size}-${biome}-${family}-${index}`,
    family,
    x: gx * size,
    z: gz * size,
    normalizedX,
    normalizedY,
    surface: {
      x: gx * size,
      z: gz * size,
      height: 20 + gz * 8 + Math.sin(gx * 0.31) * 6,
      slopeDegrees,
      aspectRadians: ((gx + gz) % 16) / 16 * Math.PI * 2,
      moisture: Math.max(0, Math.min(1, moisture)),
      biome,
      waterDepth: biome === 'wetland marsh' ? 0.12 : 0,
      riverDistance,
      lakeDistance: biome === 'wetland marsh' ? 12 + (gx % 9) * 7 : 400,
      coastDistance,
      roadDistance: 6 + ((gx * 7 + gz) % 90),
      settlementDistance: 10 + ((gz * 9 + gx) % 130),
      snow,
      concavity: 0.25 + ((gx + gz) % 7) * 0.09,
      shelter: 0.18 + ((gz + 2 * gx) % 8) * 0.10,
      erosion: /scree|alpine|coast/.test(biome) ? 0.62 : 0.24 + (gz % 7) * 0.07,
      deposition: /meadow|wetland|riparian/.test(biome) ? 0.72 : 0.28 + (gx % 6) * 0.06,
      lithic,
    },
    metadata: { id: `stress-${size}-${biome}-${family}-${index}`, family },
  };
}

let profileCount = 0;
let transitionCount = 0;
let anchorCount = 0;
let plannerCases = 0;
let determinismCases = 0;

for (const family of families) {
  for (const biome of biomes) {
    for (const size of sizes) {
      for (let index = 0; index < 24; index++) {
        const candidate = fixture(index, family, biome, size);
        const profile = sampleWorldAssetGeographyProfile(candidate.surface, candidate.metadata);
        const validation = validateAssetGeographyProfile(profile);
        assert.equal(validation.ok, true, `${family}/${biome}/${size}/${index} profile must validate`);
        assert.ok(finite(profile.placementScore));
        assert.ok(profile.placementScore >= 0 && profile.placementScore <= 1);
        profileCount++;

        const transition = sampleWorldAssetTransitionField(candidate.surface);
        assert.ok(transition.policyId.length > 0);
        for (const key of ['moisture', 'slope', 'snow', 'exposure', 'wetland', 'meadow', 'heath', 'alpine', 'talus', 'riparian', 'maritime', 'dryness', 'frost', 'access']) {
          assert.ok(finite(transition[key]), `${key} must be finite`);
          assert.ok(transition[key] >= 0 && transition[key] <= 1, `${key} must be bounded`);
        }
        transitionCount++;

        const anchors = regionalAnchorInfluences(candidate.normalizedX, candidate.normalizedY);
        assert.ok(Object.keys(anchors).length >= 8, 'regional anchor set must retain broad coverage');
        for (const value of Object.values(anchors)) {
          assert.ok(finite(value));
          assert.ok(value >= 0 && value <= 1);
        }
        anchorCount++;
      }

      const batch = Array.from({ length: 76 }, (_, index) => fixture(index, family, biome, size));
      const rankedA = rankWorldAssetDistributionCandidates(batch, { seed: 0x44aa + size });
      const rankedB = rankWorldAssetDistributionCandidates(batch, { seed: 0x44aa + size });
      assert.deepEqual(
        rankedA.map((entry) => [entry.id, entry.score, entry.continuityHint]),
        rankedB.map((entry) => [entry.id, entry.score, entry.continuityHint]),
        'ranking must remain deterministic in stress mode',
      );
      const distributedA = distributeWorldAssetCandidates(batch, {
        seed: 0x8844 + size,
        limit: 32,
        minimumScore: 0.20,
      });
      const distributedB = distributeWorldAssetCandidates(batch, {
        seed: 0x8844 + size,
        limit: 32,
        minimumScore: 0.20,
      });
      assert.deepEqual(
        distributedA.selected.map((entry) => entry.id),
        distributedB.selected.map((entry) => entry.id),
        'selection must remain deterministic in stress mode',
      );
      assert.ok(distributedA.selected.length <= 32);
      assert.ok(distributedA.diagnostics.maxScore <= 1);
      assert.ok(distributedA.diagnostics.minScore >= 0);
      plannerCases++;
      determinismCases += 2;
    }
  }
}

const edgeCandidates = [
  fixture(2, 'waterside', 'coast', 12),
  fixture(3, 'tree', 'woodland', 12),
  fixture(4, 'rock', 'scree', 12),
  fixture(5, 'snow', 'snowfield', 12),
  fixture(6, 'shrub', 'dry heath', 12),
];
const strict = distributeWorldAssetCandidates(edgeCandidates, {
  seed: 123456,
  limit: 5,
  minimumScore: 0.85,
  rejectPoor: true,
});
assert.ok(strict.selected.length <= 5);
for (const entry of strict.selected) assert.ok(entry.score >= 0.85);

console.log(JSON.stringify({
  ok: true,
  profileCount,
  transitionCount,
  anchorCount,
  plannerCases,
  determinismCases,
  strictSelectionCount: strict.selected.length,
}, null, 2));
