import assert from 'node:assert/strict';
import { createEnvironmentObservation, applyEnvironmentObservation, stable } from '../src/3d/world/environmentObservationBridgeV40.js';

const input = {
  scene: { backgroundLuminance: 0.03, exposure: 4.5, fogNear: 80, fogFar: 20, cameraRelativeSky: false },
  samples: [
    { id: 'coast', x: 10, z: 20, biome: 'coast', surface: 'water', slope: 4, elevation: 2, moisture: 0.9, waterDistance: 0.5, waterCoverage: 1, waterDepth: 3, normalVariance: 0.4, macroVariance: 0.2, textureRepeatRisk: 0.9, visibleRectangularWater: true, visibleWaterMoire: true },
    { id: 'alpine', x: 80, z: 120, biome: 'alpine', surface: 'snow', slope: 22, elevation: 810, waterDistance: 100, canonicalHeight: 810, renderedHeight: 810.1, colliderHeight: 809.9, permanentSnow: true },
    { id: 'forest', x: 4, z: 8, biome: 'forest', surface: 'grass', slope: 12, elevation: 120, moisture: 0.75, waterDistance: 40, canonicalHeight: 120, renderedHeight: 120, colliderHeight: 120, assetReady: true },
  ],
};

const first = createEnvironmentObservation(input);
const second = createEnvironmentObservation(input);
assert.deepEqual(first, second, 'bridge output must be deterministic');
assert.equal(Object.isFrozen(first), true);
assert.equal(first.camera.width, 1536);
assert.equal(first.camera.height, 1024);
assert.equal(first.totals.rectangularWater, 1);
assert.equal(first.totals.waterMoire, 1);
assert.equal(first.totals.blackSky, 0);
assert.equal(first.rows.find((row) => row.sample.id === 'alpine').vegetation.eligible, false);
assert.equal(first.rows.find((row) => row.sample.id === 'forest').vegetation.eligible, true);
assert.equal(first.acceptance.p0, false);
assert.equal(first.acceptance.p1, true);
assert.equal(stable(first).includes('environment-observation-bridge-v40'), true);

const applied = applyEnvironmentObservation(input.scene, first);
assert.ok(applied.backgroundLuminance >= 0.12);
assert.ok(applied.fogFar > applied.fogNear);

const malformed = createEnvironmentObservation({ samples: [{ id: 'bad', slope: NaN, elevation: Infinity, waterCoverage: 'bad' }] });
assert.equal(Number.isFinite(malformed.rows[0].sample.slope), true);
assert.equal(Number.isFinite(malformed.rows[0].sample.elevation), true);
console.log('environment-observation-bridge-v40: PASS');
