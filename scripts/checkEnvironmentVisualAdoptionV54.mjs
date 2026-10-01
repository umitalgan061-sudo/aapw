import assert from 'node:assert/strict';
import {
  createAcceptanceEvidenceV54,
  createEnvironmentVisualAdoptionV54,
  createTerrainEnvironmentQueryV54,
  stableDigest,
  stableSerialize,
  validateEnvironmentVisualAdoptionV54,
  applyEnvironmentVisualAdoptionV54,
} from '../src/3d/world/environmentVisualAdoptionV54.js';

const sample = {
  id: 'alpine-01', x: 1200, y: 420, z: 800, elevation: 2200, slope: 48,
  moisture: 0.18, snow: 0.63, biome: 'alpine-rock', waterCoverage: 0,
  waterDepth: 0, waterDistance: 80, sameCoordinate: true,
  canonicalHeight: 420, renderedHeight: 420.04, colliderHeight: 420.02,
  cameraDistance: 120, seed: 17, asset: { family: 'rock-scree' }
};
const water = {
  id: 'shore-01', elevation: 12, slope: 4, moisture: 0.72, snow: 0,
  biome: 'temperate-coast', waterCoverage: 0.9, waterDepth: 0.5,
  waterDistance: 0, shoreGradient: 0.48, isSea: true, sameCoordinate: true,
  canonicalHeight: 12, renderedHeight: 12, colliderHeight: 12,
  backgroundLuminance: 0.2, waterCyan: 0.32, cameraDistance: 40, seed: 3
};
const clean = createEnvironmentVisualAdoptionV54({ samples: [sample, water] });
assert.equal(clean.id, 'environment-visual-adoption-v54');
assert.equal(clean.version, 54);
assert.equal(clean.samples.length, 2);
assert.equal(clean.acceptance.actualCreateSceneRequired, true);
assert.equal(clean.acceptance.postProcessForbidden, true);
assert.equal(validateEnvironmentVisualAdoptionV54(clean).valid, true);
assert.equal(stableDigest(clean), clean.digest);
assert.equal(stableSerialize(clean), stableSerialize(JSON.parse(stableSerialize(clean))));
assert(Object.isFrozen(clean));
assert(Object.isFrozen(clean.samples[0]));
assert.equal(clean.samples[0].surface.bands.alpine, true);
assert.equal(clean.samples[0].vegetation.eligible, false);
assert(clean.samples[0].vegetation.rejectionReasons.includes('steep-slope'));
assert.equal(clean.samples[1].surface.water.category, 'sea');
assert(clean.samples[1].surface.weights.wetEdge > 0);
assert.equal(clean.samples[1].vegetation.eligible, false);
assert(clean.samples[1].vegetation.rejectionReasons.includes('water'));

const malformed = createEnvironmentVisualAdoptionV54({
  samples: [{ id: 'bad', elevation: NaN, slope: Infinity, moisture: -2, snow: 4, waterCoverage: 2 }]
});
assert.equal(validateEnvironmentVisualAdoptionV54(malformed).valid, true);
assert.equal(malformed.samples[0].surface.slope, 0);
assert.equal(malformed.samples[0].surface.moisture, 0);
assert.equal(malformed.samples[0].surface.snow, 1);

const capped = createEnvironmentVisualAdoptionV54({ samples: Array.from({ length: 600 }, (_, i) => ({ id: `s-${i}` })) });
assert.equal(capped.samples.length, 512);

const query = createTerrainEnvironmentQueryV54(sample);
assert.equal(query.biome, 'alpine-rock');
assert.equal(query.ground.parity.eligible, false);
assert.equal(query.ground.parity.reasons.includes('steep-slope'), true);

const applied = applyEnvironmentVisualAdoptionV54({ fogDensity: 9, exposure: 0, backgroundLuminance: 0 }, clean);
assert.equal(applied.applied, true);
assert.equal(applied.hint.fogDensity, 0.92);
assert.equal(applied.hint.exposure, 0.55);
assert.equal(applied.hint.backgroundLuminance, 0.12);
assert.equal(applied.hint.antiMoire, true);
assert.equal(applyEnvironmentVisualAdoptionV54({}, { id: 'wrong' }).applied, false);

const evidence = createAcceptanceEvidenceV54({ samples: [sample], beforeDigest: 'before-123' });
assert.equal(evidence.validation.valid, true);
assert.equal(evidence.beforeAfter.sameSeed, true);
assert.equal(evidence.beforeAfter.sameCoordinates, true);
assert.equal(evidence.beforeAfter.beforeDigest, 'before-123');
assert.equal(evidence.visualRequirements.fullWorld, '1536x1024-orthographic');
assert.equal(evidence.visualRequirements.shippedRuntime, 'createScene');

const reordered = createEnvironmentVisualAdoptionV54({ samples: [water, sample] });
assert.equal(reordered.digest, clean.digest);

const risky = createEnvironmentVisualAdoptionV54({ samples: [{
  id: 'risk', slope: 1, snow: 0.95, waterCoverage: 0.8, waterDepth: 0.1,
  waterMaskRectangular: true, waterStripe: true, blackSky: true,
  canonicalHeight: 0, renderedHeight: 0, colliderHeight: 0,
  assetBaseHeight: 2, backgroundLuminance: 0.01, waterCyan: 0.99
}] });
assert(risky.summary.visibleFailureTotal >= 6);
assert.equal(risky.samples[0].risks.rectangularWater, 1);
assert.equal(risky.samples[0].risks.waterMoire, 1);
assert.equal(risky.samples[0].risks.blackSky, 1);
assert.equal(risky.samples[0].risks.neonWater, 1);

console.log(JSON.stringify({
  id: clean.id,
  digest: clean.digest,
  sampleCount: clean.summary.sampleCount,
  riskFree: clean.summary.clean,
  cappedSampleCount: capped.samples.length,
  evidenceValid: evidence.validation.valid,
  riskyFailures: risky.summary.visibleFailureTotal
}, null, 2));
