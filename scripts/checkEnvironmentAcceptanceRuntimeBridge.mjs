import assert from 'node:assert/strict';
import {
  createEnvironmentAcceptanceRuntimeBridge,
  serializeEnvironmentAcceptanceRuntimeBridge,
} from '../src/3d/world/environmentAcceptanceRuntimeBridge.js';

const base = {
  coordinate: { x: 10, y: 100, z: -20 },
  canonical: { height: 100, slope: 0.18, moisture: 0.5, waterDistance: 28, waterBody: 'none', biome: 'forest', roadDistance: 45, settlementDistance: 160 },
  rendered: { height: 100.1, luminance: 0.42, cyanRatio: 0.02, moireRisk: 0.03, tileBoundaryRisk: 0.02, blackSkyRisk: 0.02, textureRepeatRisk: 0.08, vegetationVoidRisk: 0.1 },
  environment: { macroBreakup: 0.72 },
};
const shore = { ...base, id: 'shore', canonical: { ...base.canonical, waterDistance: 0.5, waterBody: 'sea' }, rendered: { ...base.rendered, cyanRatio: 0.8, moireRisk: 0.7, tileBoundaryRisk: 0.65 } };
const alpine = { ...base, id: 'alpine', canonical: { ...base.canonical, height: 2400, slope: 0.86, biome: 'alpine-snow' }, environment: { macroBreakup: 0.1 }, rendered: { ...base.rendered, vegetationVoidRisk: 0.9 } };

const result = createEnvironmentAcceptanceRuntimeBridge({ observations: [alpine, base, shore], frameTimeMs: 16.7, mobile: false });
assert.equal(result.version, 'environment-acceptance-runtime-bridge-v28');
assert.equal(result.observations.length, 3);
assert.deepEqual(result.observations.map(item => item.id), ['alpine', 'base', 'shore']);
assert.equal(result.acceptance.targets.visibleWaterMoire, 0);
assert.equal(result.plans.find(item => item.id === 'shore').hints.water.suppressMoiré, true);
assert.equal(result.plans.find(item => item.id === 'alpine').hints.vegetation.allow, false);
assert.ok(Object.isFrozen(result));
assert.equal(result.digest, createEnvironmentAcceptanceRuntimeBridge({ observations: [shore, alpine, base], frameTimeMs: 16.7 }).digest);
assert.equal(serializeEnvironmentAcceptanceRuntimeBridge(result), serializeEnvironmentAcceptanceRuntimeBridge(createEnvironmentAcceptanceRuntimeBridge({ observations: [base, shore, alpine] })));

const malformed = createEnvironmentAcceptanceRuntimeBridge({ observations: [{ id: 'bad', canonical: { slope: Infinity, waterDistance: -4 }, rendered: { cyanRatio: NaN } }], frameTimeMs: NaN, mobile: true });
assert.ok(Number.isFinite(malformed.frameTimeMs));
assert.ok(Number.isFinite(malformed.observations[0].risk.visibleArtifactRisk));
assert.equal(malformed.plans[0].hints.atmosphere.cameraRelativeSky, true);

console.log(JSON.stringify({ status: 'pass', digest: result.digest, tier: result.tier, acceptance: result.acceptance }));
