import assert from 'node:assert/strict';
import { createEnvironmentVisualBudget, applyEnvironmentVisualBudget, stable } from '../src/3d/world/environmentVisualBudgetV39.js';

const input = {
  scene: { backgroundLuminance: 0.03, exposure: 4, fogNear: 60, fogFar: 20, cameraRelativeSky: false },
  samples: [
    { id: 'coast', x: 10, z: 20, biome: 'coast', surface: 'water', slope: 4, elevation: 2, moisture: 0.9, waterDistance: 0.5, waterCoverage: 1, waterDepth: 3, normalVariance: 0.4, macroVariance: 0.2, textureRepeatRisk: 0.9, visibleRectangularWater: true, visibleWaterMoire: true },
    { id: 'alpine', x: 80, z: 120, biome: 'alpine', surface: 'snow', slope: 22, elevation: 810, moisture: 0.2, waterDistance: 100, canonicalHeight: 810, renderedHeight: 810.1, colliderHeight: 809.9, permanentSnow: true, distanceToCamera: 200 },
    { id: 'forest', x: 4, z: 8, biome: 'forest', surface: 'grass', slope: 12, elevation: 120, moisture: 0.75, waterDistance: 40, canonicalHeight: 120, renderedHeight: 120, colliderHeight: 120, distanceToCamera: 30, assetReady: true },
  ],
};

const first = createEnvironmentVisualBudget(input);
const second = createEnvironmentVisualBudget(input);
assert.deepEqual(first, second, 'output must be deterministic');
assert.equal(Object.isFrozen(first), true, 'payload must be frozen');
assert.equal(first.camera.width, 1536);
assert.equal(first.camera.height, 1024);
assert.equal(first.totals.visibleRectangularWater, 1);
assert.equal(first.totals.visibleWaterMoire, 1);
assert.equal(first.totals.blackSkyFailure, 1);
assert.equal(first.rows.find((row) => row.sample.id === 'alpine').vegetation.eligible, false);
assert.equal(first.rows.find((row) => row.sample.id === 'forest').vegetation.eligible, true);
assert.equal(first.acceptance.p0, false);
assert.equal(first.acceptance.p5, false);
assert.equal(stable(first).includes('environment-visual-budget'), true);

const applied = applyEnvironmentVisualBudget(input.scene, first);
assert.ok(applied.backgroundLuminance >= 0.12);
assert.ok(applied.fogFar > applied.fogNear);
assert.equal(applied.cameraRelativeSky, false);

const malformed = createEnvironmentVisualBudget({ samples: [{ id: 'bad', slope: NaN, elevation: Infinity, waterCoverage: 'x' }] });
assert.equal(Number.isFinite(malformed.rows[0].sample.slope), true);
assert.equal(Number.isFinite(malformed.rows[0].sample.elevation), true);
console.log('environment-visual-budget-v39: PASS');
