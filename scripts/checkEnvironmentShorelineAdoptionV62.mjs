import assert from 'node:assert/strict';
import { createEnvironmentShorelineAdoptionPlan, applyEnvironmentShorelineAdoptionPlan } from '../src/3d/world/environmentShorelineAdoptionV62.js';

const input = {
  atmosphere: { backgroundLuminance: 0.34 },
  samples: [
    { x: 0, z: 0, canonicalY: 10, renderedY: 10.04, colliderY: 10.02, tileEdgeDistance: 8, cameraDistance: 18, confidence: 0.96, surface: { biome: 'temperate', slope: 0.18, elevation: 0.32, moisture: 0.62, snow: 0.04, waterDepth: 0, waterDistance: 40, waterClass: 'land', roadDistance: 8, settlementDistance: 8 } },
    { x: 4, z: 2, canonicalY: 4, renderedY: 4.02, colliderY: 4.01, tileEdgeDistance: 5, cameraDistance: 80, confidence: 0.93, surface: { biome: 'coast', slope: 0.22, elevation: 0.14, moisture: 0.86, snow: 0, waterDepth: 0.5, waterDistance: 0.5, waterClass: 'sea', roadDistance: 8, settlementDistance: 8 } },
    { x: 8, z: 6, canonicalY: 34, renderedY: 34.8, colliderY: 34.7, tileEdgeDistance: 1, cameraDistance: 220, confidence: 0.55, surface: { biome: 'alpine', slope: 0.86, elevation: 0.95, moisture: 0.35, snow: 0.96, waterDepth: 0, waterDistance: 60, waterClass: 'land', roadDistance: 0.5, settlementDistance: 20 } },
  ],
};

const first = createEnvironmentShorelineAdoptionPlan(input);
const second = createEnvironmentShorelineAdoptionPlan(JSON.parse(JSON.stringify(input)));
assert.equal(first.digest, second.digest, 'plan digest must be deterministic');
assert.equal(first.camera.width, 1536);
assert.equal(first.camera.height, 1024);
assert.equal(first.samples[1].water.class, 'sea');
assert.ok(first.samples[1].surface.wetEdge > 0);
assert.equal(first.samples[2].placement.eligible, false);
assert.ok(first.riskCounts.seam >= 1);
assert.ok(first.riskCounts.rectangularWater >= 1);
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.samples[0]));
assert.throws(() => { first.samples.push({}); }, TypeError);

const target = {};
assert.equal(applyEnvironmentShorelineAdoptionPlan(first, target), true);
assert.equal(target.environmentShorelineAdoption.digest, first.digest);
assert.equal(applyEnvironmentShorelineAdoptionPlan(null, target), false);

const malformed = createEnvironmentShorelineAdoptionPlan({ samples: [{ surface: { slope: 'bad', waterDistance: 'bad', waterClass: 'river' } }], atmosphere: { backgroundLuminance: -10 } });
assert.ok(Number.isFinite(malformed.samples[0].surface.grass));
assert.equal(malformed.atmosphere.blackSkyRisk, true);

console.log(JSON.stringify({ ok: true, digest: first.digest, riskCounts: first.riskCounts }));
