import assert from 'node:assert/strict';
import {
  applyEnvironmentSurfaceFieldV49,
  buildEnvironmentSurfaceFieldV49,
} from '../src/3d/world/environmentSurfaceFieldV49.js';

const input = {
  seed: 'v49-fixture',
  samples: [
    {
      id: 'shore-1', position: { x: 4, y: 0, z: 9 }, normal: { x: 0.1, y: 0.92, z: 0.1 },
      slope: 0.18, elevation: 0.2, moisture: 0.84, waterDistance: 2,
      canopy: 0.5, waterCoverage: 0.32, waterDepth: 0.5, textureRepeatRisk: 0.7,
      tileBoundaryDistance: 1, skyLuminance: 0.5, ambient: 0.6, biome: 'temperate',
    },
    {
      id: 'cliff-1', position: { x: 44, y: 8, z: 12 }, normal: { x: 0.78, y: 0.2, z: 0.55 },
      slope: 0.92, elevation: 0.85, moisture: 0.12, waterDistance: 90,
      canopy: 0.05, waterCoverage: 0, waterDepth: 0, textureRepeatRisk: 0.1,
      tileBoundaryDistance: 90, skyLuminance: 0.72, ambient: 0.55, biome: 'alpine',
    },
    {
      id: 'forest-1', position: { x: 10, y: 2, z: 30 }, normal: { x: 0.02, y: 0.99, z: 0.04 },
      slope: 0.08, elevation: 0.35, moisture: 0.7, waterDistance: 30,
      canopy: 0.82, waterCoverage: 0, waterDepth: 0, textureRepeatRisk: 0.2,
      tileBoundaryDistance: 30, skyLuminance: 0.7, ambient: 0.6, biome: 'taiga',
    },
  ],
};

const first = buildEnvironmentSurfaceFieldV49(input);
const second = buildEnvironmentSurfaceFieldV49(input);
assert.deepEqual(first, second, 'same seed/input must be deterministic');
assert.equal(first.acceptanceCamera.width, 1536);
assert.equal(first.acceptanceCamera.height, 1024);
assert.equal(first.summary.riskCounts.waterMoire, 1);
assert.equal(first.summary.riskCounts.seam, 1);
assert.equal(first.rows[0].placement.eligible, false);
assert.equal(first.rows[0].placement.blockedReason, 'water');
assert.equal(first.rows[1].placement.blockedReason, 'steep-cliff');
assert.equal(first.rows[2].placement.eligible, true);
assert.equal(first.rows[2].placement.instancingGroup, 'conifer:forest');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.rows[0].weights), true);

const target = {};
assert.equal(applyEnvironmentSurfaceFieldV49(target, first), target);
assert.equal(target.environmentSurfaceFieldV49.digest, first.digest);

const malformed = buildEnvironmentSurfaceFieldV49({ samples: [{ id: 'bad', position: { x: NaN, y: Infinity, z: null }, normal: { x: NaN, y: NaN, z: NaN }, skyLuminance: -4 }] });
assert.equal(Number.isFinite(malformed.rows[0].position.x), true);
assert.equal(Number.isFinite(malformed.rows[0].position.y), true);
assert.equal(malformed.rows[0].atmosphere.skyLuminance, 0);
console.log('environment surface field v49: PASS');
