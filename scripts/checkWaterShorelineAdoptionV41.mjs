import assert from 'node:assert/strict';
import { applyWaterShorelineAdoption, buildWaterShorelineAdoption } from '../src/3d/world/waterShorelineAdoptionV41.js';

const sample = {
  worldX: 12.5,
  worldZ: -7.25,
  canonicalHeight: 0.72,
  renderedHeight: 0.73,
  colliderHeight: 0.71,
  slope: 0.21,
  moisture: 0.8,
  elevation: 0.56,
  waterDistance: 4,
  depth: 0.22,
  isWater: true,
  footprint: { width: 40, height: 32, regularity: 0.98 },
  cyanBias: 0.85,
  normalRepeat: 0.92,
  frequencyVariance: 0.08,
  edgeGradient: 0.9,
  edgeBlend: 0.1,
  macroVariation: 0.75,
  microVariation: 0.62,
  cameraDistance: 80,
  backgroundLuminance: 0.08,
};

const first = buildWaterShorelineAdoption(sample, { seed: 'v41', cameraProfile: 'terrain-near-center' });
const second = buildWaterShorelineAdoption(sample, { seed: 'v41', cameraProfile: 'terrain-near-center' });
assert.deepEqual(first, second);
assert.equal(Object.isFrozen(first), true);
assert.equal(first.camera.width, 1536);
assert.equal(first.camera.height, 1024);
assert.equal(first.acceptance.visibleRectangularWater, true);
assert.equal(first.acceptance.visibleWaterMoire, true);
assert.equal(first.acceptance.shorelineHardEdge, true);
assert.equal(first.terrain.parity.parityPass, true);
assert.equal(first.vegetation.grounded, false);
assert.ok(first.water.opacity >= 0.62 && first.water.opacity <= 0.82);
assert.ok(first.water.roughness >= 0.24 && first.water.roughness <= 0.55);

const malformed = buildWaterShorelineAdoption({ worldX: NaN, slope: Infinity, isWater: false });
assert.equal(Number.isFinite(malformed.terrain.parity.renderError), true);
assert.equal(malformed.vegetation.grounded, true);
assert.equal(malformed.acceptance.blackSky, false);

const material = {};
applyWaterShorelineAdoption(material, first);
assert.equal(material.opacity, first.water.opacity);
assert.equal(material.roughness, first.water.roughness);
assert.equal(material.antiTilingPhase, first.terrain.antiTilingPhase);

console.log('water-shoreline-adoption-v41: ok');
