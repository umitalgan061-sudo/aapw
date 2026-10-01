import assert from 'node:assert/strict';
import { createEnvironmentVisualAcceptancePlan, applyEnvironmentVisualAcceptancePlan } from '../src/3d/world/environmentVisualAcceptanceV61.js';

const sample = { x: 12, z: 8, canonicalY: 10, renderedY: 10.04, colliderY: 9.98, confidence: 1, assetReady: true, tileEdgeDistance: 5, cameraDistance: 24,
  surface: { slope: 0.38, elevation: 0.35, moisture: 0.62, snow: 0.06, waterDepth: 0, waterDistance: 30, biome: 'temperate', waterClass: 'land' },
  roadDistance: 8, settlementDistance: 12 };
const wetShore = { ...sample, tileEdgeDistance: 0.4, cameraDistance: 64, surface: { ...sample.surface, moisture: 0.84, waterDistance: 4, waterClass: 'river', waterDepth: 0.2 } };
const alpine = { ...sample, cameraDistance: 180, surface: { ...sample.surface, slope: 0.82, elevation: 0.9, snow: 0.94, biome: 'alpine' } };
const input = { samples: [sample, wetShore, alpine], atmosphere: { backgroundLuminance: 0.02, fogNear: 60, fogFar: 1400, exposure: 1.1 } };
const a = createEnvironmentVisualAcceptancePlan(input);
const b = createEnvironmentVisualAcceptancePlan(input);
assert.equal(a.digest, b.digest);
assert.deepEqual(a.camera.profiles, ['full-world','far','terrain-near','northwest-near']);
assert.equal(a.camera.width, 1536); assert.equal(a.camera.height, 1024);
assert.equal(a.atmosphere.blackSkyRisk, true);
assert.equal(a.samples[1].water.rectangularCoverageRisk, 0.95);
assert.equal(a.samples[2].placement.eligible, false);
assert.equal(a.samples[2].surface.scree > a.samples[0].surface.scree, true);
assert.equal(a.samples[0].parity.withinTolerance, true);
assert.equal(Object.isFrozen(a), true);
const target = {}; assert.equal(applyEnvironmentVisualAcceptancePlan(a, target), true); assert.equal(target.environmentVisualAcceptance.digest, a.digest);
const malformed = createEnvironmentVisualAcceptancePlan({ samples: [{ surface: { slope: NaN, moisture: Infinity, waterClass: 'land' } }] });
for (const entry of malformed.samples) for (const value of Object.values(entry.surface)) assert.equal(typeof value, 'number');
console.log('environment visual acceptance v61: PASS');
