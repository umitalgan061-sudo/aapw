import assert from 'node:assert/strict';
import {
  createEnvironmentVisualAdoptionV55,
  createTerrainEnvironmentQueryV55,
  createAcceptanceEvidenceV55,
  validateEnvironmentVisualAdoptionV55,
  applyEnvironmentVisualAdoptionV55,
  stableDigest,
  stableSerialize
} from '../src/3d/world/environmentVisualAdoptionV55.js';

const alpine = {
  id: 'alpine-01', x: 100, y: 220, z: -40, elevation: 2400, slope: 52,
  moisture: 0.22, snow: 0.64, biome: 'alpine-rock', waterCoverage: 0,
  waterDepth: 0, waterDistance: 90, sameCoordinate: true,
  canonicalHeight: 220, renderedHeight: 220.03, colliderHeight: 220.02,
  cameraDistance: 120, seed: 17, assetPresent: true
};
const coast = {
  id: 'coast-01', x: -12, y: 10, z: 8, elevation: 10, slope: 4,
  moisture: 0.78, snow: 0, biome: 'temperate-coast', waterCoverage: 0.9,
  waterDepth: 0.4, waterDistance: 0, shoreGradient: 0.48, isSea: true,
  sameCoordinate: true, canonicalHeight: 10, renderedHeight: 10, colliderHeight: 10,
  backgroundLuminance: 0.2, waterCyan: 0.2, cameraDistance: 40, seed: 3,
  assetPresent: false
};
const clean = createEnvironmentVisualAdoptionV55({ samples: [coast, alpine] });
assert.equal(clean.id, 'environment-visual-adoption-v55');
assert.equal(clean.version, 55);
assert.equal(clean.samples.length, 2);
assert.equal(validateEnvironmentVisualAdoptionV55(clean).valid, true);
assert.equal(stableDigest(clean), clean.digest);
assert.equal(stableSerialize(clean), stableSerialize(JSON.parse(stableSerialize(clean))));
assert(Object.isFrozen(clean));
assert(Object.isFrozen(clean.samples[0]));
assert.equal(clean.samples.find(s => s.id === 'coast-01').water.category, 'sea');
assert.equal(clean.samples.find(s => s.id === 'coast-01').placement.eligible, false);
assert.equal(clean.samples.find(s => s.id === 'coast-01').placement.rejectionReasons.includes('water'), true);
assert.equal(clean.samples.find(s => s.id === 'alpine-01').bands.alpine, true);
assert.equal(clean.samples.find(s => s.id === 'alpine-01').placement.eligible, false);
assert.equal(clean.samples.find(s => s.id === 'alpine-01').placement.rejectionReasons.includes('steep-slope'), true);

const reordered = createEnvironmentVisualAdoptionV55({ samples: [alpine, coast] });
assert.equal(reordered.digest, clean.digest);

const malformed = createEnvironmentVisualAdoptionV55({ samples: [{ id: 'bad', elevation: NaN, slope: Infinity, moisture: -2, snow: 4, waterCoverage: 2 }] });
assert.equal(validateEnvironmentVisualAdoptionV55(malformed).valid, true);
assert.equal(malformed.samples[0].surface.weights.grass >= 0, true);
assert.equal(malformed.samples[0].water.coverage, 1);

const capped = createEnvironmentVisualAdoptionV55({ samples: Array.from({ length: 900 }, (_, index) => ({ id: `s-${index}` })) });
assert.equal(capped.samples.length, 768);

const query = createTerrainEnvironmentQueryV55(alpine);
assert.equal(query.biome, 'alpine');
assert.equal(query.ground.parity.eligible, true);
assert.equal(query.placement.rejectionReasons.includes('steep-slope'), true);
assert.equal(query.material.worldSpaceAntiTiling, true);

const appliedTarget = {};
const applied = applyEnvironmentVisualAdoptionV55(appliedTarget, clean);
assert.equal(applied.applied, true);
assert.equal(appliedTarget.environmentVisualAdoptionV55.cameraRelativeSky, true);
assert.equal(applyEnvironmentVisualAdoptionV55({}, { id: 'wrong' }).applied, false);

const evidence = createAcceptanceEvidenceV55({ samples: [alpine], beforeDigest: 'before-v55' });
assert.equal(evidence.validation.valid, true);
assert.equal(evidence.beforeAfter.sameSeed, true);
assert.equal(evidence.beforeAfter.sameCoordinates, true);
assert.equal(evidence.beforeAfter.beforeDigest, 'before-v55');
assert.equal(evidence.visualRequirements.fullWorld, '1536x1024-orthographic');
assert.equal(evidence.visualRequirements.shippedRuntime, 'createScene');

const risky = createEnvironmentVisualAdoptionV55({ samples: [{
  id: 'risk', slope: 60, snow: 0.98, waterCoverage: 0.8, waterDepth: 0.1,
  waterMaskRectangular: true, waterStripe: true, blackSky: true,
  canonicalHeight: 0, renderedHeight: 0, colliderHeight: 0,
  assetBaseHeight: 2, backgroundLuminance: 0.01, waterCyan: 0.99,
  assetPresent: true
}] });
assert.equal(risky.summary.riskCounts.rectangularWater, 1);
assert.equal(risky.summary.riskCounts.waterMoire, 1);
assert.equal(risky.summary.riskCounts.blackSky, 1);
assert.equal(risky.summary.riskCounts.neonWater, 1);
assert(risky.summary.visibleFailureTotal >= 6);

console.log(JSON.stringify({
  id: clean.id,
  digest: clean.digest,
  sampleCount: clean.summary.sampleCount,
  clean: clean.summary.clean,
  cappedSampleCount: capped.samples.length,
  riskyFailures: risky.summary.visibleFailureTotal
}, null, 2));
