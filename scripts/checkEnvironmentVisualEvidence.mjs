import assert from 'node:assert/strict';
import { buildEnvironmentVisualEvidence, serializeEnvironmentVisualEvidence } from '../src/3d/world/environmentVisualEvidence.js';

const samples = [
  { id: 'shore-a', x: 12, z: 18, elevation: 20, slope: 2, moisture: .9, waterDistance: 1, waterCoverage: .98, waterGradient: .02, biome: 'coast', skyLuminance: .5, surfaceLuminance: .4, canonicalHeight: 20, renderedHeight: 20, colliderHeight: 20, seamDistance: 9, assetState: 'grounded', assetRole: 'environment' },
  { id: 'ridge-a', x: 140, z: 260, elevation: 850, slope: 61, moisture: .2, waterDistance: 90, waterCoverage: 0, waterGradient: 0, biome: 'alpine-snow', skyLuminance: .45, surfaceLuminance: .3, canonicalHeight: 850, renderedHeight: 850.3, colliderHeight: 850.1, seamDistance: 9, assetState: 'grounded', assetRole: 'rock' },
  { id: 'bad-a', x: 0, z: 0, biome: 'forest', skyLuminance: 0, surfaceLuminance: .5, seamDistance: 1, assetState: 'floating', assetRole: 'primitive', canonicalHeight: 3, renderedHeight: 9, colliderHeight: 9 },
];

const first = buildEnvironmentVisualEvidence({ samples, seed: 'proof-seed' });
const second = buildEnvironmentVisualEvidence({ samples, seed: 'proof-seed' });
assert.deepEqual(first, second);
assert.equal(first.cameras.length, 4);
assert.equal(first.cameras[0].width, 1536);
assert.ok(first.summary.visibleGridOrSeam >= 1);
assert.ok(first.summary.visibleRectangularWater >= 1);
assert.ok(first.summary.visibleWaterMoire >= 1);
assert.ok(first.summary.blackSkyFailure >= 1);
assert.ok(first.summary.floatingOrInterpenetrating >= 1);
assert.ok(first.summary.placeholderAsset >= 1);
assert.ok(first.summary.targetBreaches.includes('visibleGridOrSeam'));
assert.ok(first.samples.every((row) => Object.isFrozen(row)));
assert.throws(() => { first.samples[0].band = 'mutated'; }, TypeError);
assert.equal(serializeEnvironmentVisualEvidence(first), serializeEnvironmentVisualEvidence(second));
const malformed = buildEnvironmentVisualEvidence({ samples: null, targets: null });
assert.equal(malformed.summary.sampleCount, 0);
assert.equal(typeof malformed.digest, 'string');
console.log('environment-visual-evidence-v37: ok');
