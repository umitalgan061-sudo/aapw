import assert from 'node:assert/strict';
import buildEnvironmentGroundingEvidence, { serializeEnvironmentGroundingEvidence } from '../src/3d/world/environmentGroundingEvidence.js';

const input = {
  blackSkyRisk: false,
  budgetPressure: 0.25,
  observations: [
    { id: 'shore', position: { x: 10, y: 4, z: 20 }, canonicalHeight: 4, renderedHeight: 4.01, colliderHeight: 4, slope: 0.22, moisture: 0.88, waterDistance: 0.5, biome: 'temperate-forest', hardWaterMask: true },
    { id: 'alpine', position: { x: 80, y: 40, z: 120 }, canonicalHeight: 40, renderedHeight: 40.02, colliderHeight: 40.01, slope: 0.86, moisture: 0.2, waterDistance: 200, elevation: 0.92, biome: 'alpine' },
    { id: 'ground', position: { x: 40, y: 5, z: 70 }, canonicalHeight: 5, renderedHeight: 5, colliderHeight: 5, slope: 0.31, moisture: 0.42, waterDistance: 90, biome: 'grassland' },
  ],
};

const first = buildEnvironmentGroundingEvidence(input);
const second = buildEnvironmentGroundingEvidence(input);
assert.equal(first.digest, second.digest, 'digest must be deterministic');
assert.deepEqual(first.records.map((record) => record.id), ['shore', 'alpine', 'ground']);
assert.equal(first.acceptance.visibleRectangularWater, 1);
assert.equal(first.acceptance.visibleGridOrSeam, 0);
assert.equal(first.summary.renderColliderParity, true);
assert.equal(first.records[0].water.moireGuard, true);
assert.equal(first.records[1].vegetation.eligible, false);
assert.equal(first.records[1].vegetation.exclusionReason, 'alpine-snow-slope');
assert.equal(first.records[2].vegetation.eligible, true);
assert.equal(first.records[0].material.surface, 'wet-edge');
assert.equal(first.records[1].material.surface, 'snow');
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.records[0]));
assert.equal(serializeEnvironmentGroundingEvidence(first), serializeEnvironmentGroundingEvidence(second));

const malformed = buildEnvironmentGroundingEvidence({ observations: [{ position: { x: NaN, z: Infinity }, canonicalHeight: NaN, renderedHeight: Infinity, colliderHeight: -Infinity, slope: -2, moisture: 4, waterDistance: -1 }] });
assert.equal(malformed.summary.sampleCount, 1);
assert.equal(Number.isFinite(malformed.records[0].position.x), true);
assert.equal(Number.isFinite(malformed.records[0].renderDelta), true);
assert.equal(malformed.records[0].slope, 0);
assert.equal(malformed.records[0].moisture, 1);
console.log('environment grounding evidence: PASS');
