import assert from 'node:assert/strict';
import {
  createBeforeAfterEnvironmentDelta,
  createEnvironmentRenderEvidence,
  serializeEnvironmentRenderEvidence,
} from '../src/3d/world/environmentRenderEvidenceAdapter.js';

const cleanSample = {
  id: 'center-near',
  coordinate: { x: 14.25, y: 211.5, z: -32.75 },
  canonical: {
    height: 211.5,
    slope: 0.18,
    moisture: 0.48,
    waterDistance: 24,
    biome: 'forest',
    waterBody: 'none',
    roadDistance: 40,
    settlementDistance: 140,
  },
  rendered: {
    height: 211.6,
    luminance: 0.42,
    cyanRatio: 0.01,
    tileBoundaryRisk: 0.01,
    moireRisk: 0.01,
    blackSkyRisk: 0.01,
    placeholderRisk: 0,
    textureRepeatRisk: 0.05,
    vegetationVoidRisk: 0.1,
  },
  collider: { height: 211.55, grounded: true, valid: true },
  environment: { normalEnergy: 0.74, macroBreakup: 0.75, microBreakup: 0.68, atmosphericDepth: 0.35, exposure: 1.1 },
};

const waterSample = {
  ...cleanSample,
  id: 'shore-water',
  canonical: { ...cleanSample.canonical, waterDistance: 0.4, waterBody: 'sea' },
  rendered: { ...cleanSample.rendered, cyanRatio: 0.72, moireRisk: 0.8, tileBoundaryRisk: 0.7 },
};

const alpineSample = {
  ...cleanSample,
  id: 'alpine-ridge',
  canonical: { ...cleanSample.canonical, height: 2600, slope: 0.84, biome: 'alpine-snow' },
  rendered: { ...cleanSample.rendered, luminance: 0.26, textureRepeatRisk: 0.4 },
  environment: { ...cleanSample.environment, macroBreakup: 0.15, normalEnergy: 0.2 },
};

const evidence = createEnvironmentRenderEvidence({ seed: 'test-seed', samples: [cleanSample, waterSample, alpineSample] });
assert.equal(evidence.version, 'environment-render-evidence-v27');
assert.equal(evidence.cameras.length, 4);
assert.equal(evidence.summary.sampleCount, 3);
assert.equal(evidence.summary.passCount, 1);
assert.equal(evidence.summary.failCount, 2);
assert.ok(evidence.summary.riskCounts['cyan-water-block'] >= 1);
assert.ok(evidence.summary.riskCounts['water-moire'] >= 1);
assert.ok(evidence.summary.riskCounts['flat-alpine'] >= 1);
assert.equal(evidence.acceptance.status, 'guarded');
assert.ok(Object.isFrozen(evidence));
assert.ok(Object.isFrozen(evidence.samples));
assert.equal(evidence.digest, createEnvironmentRenderEvidence({ seed: 'test-seed', samples: [alpineSample, cleanSample, waterSample] }).digest);
assert.equal(serializeEnvironmentRenderEvidence(evidence), serializeEnvironmentRenderEvidence(createEnvironmentRenderEvidence({ seed: 'test-seed', samples: [waterSample, alpineSample, cleanSample] })));

const malformed = createEnvironmentRenderEvidence({
  cameras: [{ id: 'broken', width: Number.NaN, height: Infinity, position: { x: 'bad' } }],
  samples: [{ id: 'bad', canonical: { slope: Infinity, waterDistance: -5 }, rendered: { luminance: Number.NaN } }],
});
assert.equal(malformed.samples.length, 1);
assert.ok(Number.isFinite(malformed.samples[0].visualQuality));
assert.ok(Number.isFinite(malformed.cameras[0].width));

const before = createEnvironmentRenderEvidence({ samples: [waterSample] });
const after = createEnvironmentRenderEvidence({ samples: [cleanSample] });
const delta = createBeforeAfterEnvironmentDelta(before, after);
assert.ok(delta.passRateDelta > 0);
assert.ok(delta.visualQualityDelta > 0);
assert.ok(Object.isFrozen(delta));

console.log(JSON.stringify({
  status: 'pass',
  digest: evidence.digest,
  summary: evidence.summary,
  acceptance: evidence.acceptance,
  delta,
}));
