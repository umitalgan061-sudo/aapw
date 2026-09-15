import assert from 'node:assert/strict';
import { createEnvironmentGroundedPass, stableSerialize } from '../src/3d/world/environmentGroundedPassV43.js';

const observation = {
  samples: [
    { id: 'shore', biome: 'shore', position: { x: 10, y: 2, z: 5 }, canonicalHeight: 2, renderedHeight: 2.01, colliderHeight: 2.01, slope: 8, moisture: 0.9, elevation: 2, waterDistance: 1.2, rectangularWater: false, waterMoire: false },
    { id: 'ridge', biome: 'alpine-rock', position: { x: 80, y: 740, z: -40 }, canonicalHeight: 740, renderedHeight: 740.01, colliderHeight: 740.01, slope: 46, moisture: 0.2, elevation: 740, waterDistance: 80 },
    { id: 'forest', biome: 'forest', position: { x: -30, y: 210, z: 22 }, canonicalHeight: 210, renderedHeight: 210, colliderHeight: 210, slope: 18, moisture: 0.6, elevation: 210, waterDistance: 24 },
  ],
  assets: [
    { id: 'tree-1', kind: 'tree', scale: 1, yaw: 25 },
    { id: 'rock-1', kind: 'rock', scale: 1.1, yaw: 190 },
  ],
};

const first = createEnvironmentGroundedPass(observation);
const second = createEnvironmentGroundedPass(observation);
assert.equal(stableSerialize(first), stableSerialize(second));
assert.equal(first.schema, 'environment-grounded-pass/v43');
assert.equal(first.cameraProfiles.fullWorld.width, 1536);
assert.equal(first.cameraProfiles.fullWorld.height, 1024);
assert.equal(first.cameraProfiles.fullWorld.orthographic, true);
assert.equal(first.risks.rectangularWater, 0);
assert.equal(first.risks.waterMoire, 0);
assert.equal(first.risks.floatingOrInterpenetrating, 0);
assert.equal(first.assetPlans[0].eligible, true);
assert.equal(first.assetPlans[1].eligible, true);
assert.equal(first.surfaces[0].surface.wetEdge > 0, true);
assert.equal(first.surfaces[1].surface.weights.scree > 0, true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.surfaces), true);

const blocked = createEnvironmentGroundedPass({
  samples: [{ id: 'bad-water', position: { x: 0, y: 0, z: 0 }, rectangularWater: true, waterMoire: true, floating: true, interpenetrating: true, slope: 60, elevation: 800 }],
  assets: [{ id: 'tree-bad', kind: 'tree' }],
});
assert.equal(blocked.accepted, false);
assert.equal(blocked.assetPlans[0].eligible, false);
assert.equal(blocked.targetBreaches.visibleRisks, true);
assert.equal(Number.isFinite(blocked.framePressure), true);

const malformed = createEnvironmentGroundedPass({ samples: [{ id: 'malformed', slope: 'bad', position: { x: NaN, y: Infinity, z: null } }] });
assert.equal(Number.isFinite(malformed.surfaces[0].surface.macroContrast), true);
assert.equal(Number.isFinite(malformed.surfaces[0].surface.microRelief), true);
console.log('environment-grounded-pass-v43: PASS');
