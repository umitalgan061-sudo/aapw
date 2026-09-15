import assert from 'node:assert/strict';
import { inspectEnvironmentSample, inspectEnvironmentBatch } from '../src/3d/world/environmentAcceptanceProbeV45.js';

const fixture = {
  id: 'northwest-near', x: 41.25, y: 18.5, z: -12.75,
  canonicalHeight: 18.5, renderedHeight: 18.5, colliderHeight: 18.5,
  slope: 0.72, elevation: 0.88, moisture: 0.18, waterDistance: 24,
  waterDepth: 0, waterCoverage: 0, biome: 'alpine', surface: 'snowline',
  assetFamily: 'env-rock', assetReady: true, cliff: false, permanentSnow: false,
  materialRoles: ['rock', 'scree', 'snow']
};

const first = inspectEnvironmentSample(fixture);
const second = inspectEnvironmentSample({ ...fixture });
assert.deepEqual(first, second, 'sample output must be deterministic');
assert.equal(first.acceptance.renderColliderParity, 0);
assert.equal(first.vegetation.eligible, true);
assert.ok(first.surfaces.scree > 0 || first.surfaces.rock > 0);
assert.ok(first.materials.microRelief > 0.2);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.surfaces), true);

const blocked = inspectEnvironmentSample({ ...fixture, waterCoverage: 0.8, waterDepth: 2 });
assert.equal(blocked.vegetation.eligible, false);
assert.equal(blocked.vegetation.reason, 'water');
assert.equal(blocked.acceptance.visibleRectangularWater, 0);

const risks = inspectEnvironmentBatch([
  fixture,
  { ...fixture, id: 'water', visibleRectangularWater: true, visibleWaterMoire: true, waterCoverage: 1, waterDepth: 6 },
  { ...fixture, id: 'seam', visibleSeam: true, visibleTextureTiling: true, blackSky: true, floatingOrInterpenetrating: true }
]);
assert.equal(risks.summary.total, 3);
assert.equal(risks.summary.rectangularWater, 1);
assert.equal(risks.summary.waterMoire, 1);
assert.equal(risks.summary.seams, 1);
assert.equal(risks.summary.textureTiling, 1);
assert.equal(risks.summary.invalidGrounding, 1);
assert.equal(risks.summary.blackSky, 1);
assert.equal(Object.isFrozen(risks), true);

const malformed = inspectEnvironmentSample({ slope: 'bad', elevation: NaN, waterDistance: null });
assert.ok(Number.isFinite(malformed.materials.roughness));
assert.ok(Number.isFinite(malformed.materials.normalEnergy));
assert.equal(typeof malformed.digest, 'string');
assert.ok(malformed.digest.length > 0);

console.log('environment-acceptance-probe-v45: PASS');
