import assert from 'node:assert/strict';
import { createEnvironmentSurfaceResponseV46, applyEnvironmentSurfaceResponseV46 } from '../src/3d/world/environmentSurfaceResponseV46.js';

const samples = [
  { x: 10, y: 2, z: 5, elevation: 0.2, slope: 0.18, moisture: 0.4, waterDistance: 30, biome: 'temperate', canonicalHeight: 2, renderedHeight: 2.04, colliderHeight: 2.02 },
  { x: 20, y: 8, z: 12, elevation: 0.86, slope: 0.72, moisture: 0.25, waterDistance: 40, biome: 'alpine', canonicalHeight: 8, renderedHeight: 8.06, colliderHeight: 8.08, visibleTextureTiling: true },
  { x: 30, y: 0, z: 18, elevation: 0.1, slope: 0.05, moisture: 0.8, waterDistance: 2, waterCoverage: 0.7, shallowDepth: 0.2, foam: 0.8, visibleRectangularWater: true, visibleWaterMoire: true, canonicalHeight: 0, renderedHeight: 0.02, colliderHeight: 0.01 },
  { x: 40, y: 3, z: 20, elevation: 0.4, slope: 0.15, biome: 'temperate', waterCoverage: 0.2, road: true, canonicalHeight: 3, renderedHeight: 3.9, colliderHeight: 3.0 },
];

const first = createEnvironmentSurfaceResponseV46({ samples });
const second = createEnvironmentSurfaceResponseV46({ samples });
assert.deepEqual(first, second);
assert.equal(first.summary.sampleCount, 4);
assert.equal(first.summary.riskCounts.rectangularWater, 1);
assert.equal(first.summary.riskCounts.waterMoire, 1);
assert.equal(first.observations[2].water.category, 'shore');
assert.equal(first.observations[2].water.antiMoire, true);
assert.equal(first.observations[1].grounding.eligible, true);
assert.equal(first.observations[3].grounding.eligible, false);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.observations[0]), true);
const target = {};
assert.equal(applyEnvironmentSurfaceResponseV46(target, first), true);
assert.equal(target.environmentSurfaceResponseV46, first);
console.log('environment surface response v46 checks passed');
