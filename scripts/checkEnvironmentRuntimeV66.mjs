import assert from 'node:assert/strict';
import { buildErosionScenarioV66, buildMicroErosionFieldV66, validateErosionFieldV66 } from '../src/3d/world/environmentRuntimeErosionV66.js';
import { buildRiverCorridorV66, buildWaterSurfaceStateV66, predictFloodRiskV66, validateWaterDynamicsV66 } from '../src/3d/world/environmentRuntimeWaterDynamicsV66.js';
import { buildWildlifeCorridorV66, chooseHabitatSpeciesV66, validateWildlifeRuntimeV66 } from '../src/3d/world/environmentRuntimeWildlifeV66.js';
import { buildCameraExposureV66, buildSkyLumaEnvelopeV66, validateExposureRuntimeV66 } from '../src/3d/world/environmentRuntimeExposureV66.js';
import { buildNavigationFieldV66, buildPlayerSafetyEnvelopeV66, validateNavigationRuntimeV66 } from '../src/3d/world/environmentRuntimeNavigationV66.js';
import { buildSeasonalEcologyV66, computeEcotoneV66, validateEcologyRuntimeV66 } from '../src/3d/world/environmentRuntimeEcologyV66.js';
import { buildV66ExperienceRuntime, validateV66ExperienceRuntime, createV66ScenarioProfiles, evaluateV66Scenario } from '../src/3d/world/environmentRuntimeExperienceV66.js';
import { ENVIRONMENT_RUNTIME_V66_MANIFEST } from '../src/3d/world/environmentRuntimeV66Manifest.js';

const failures = [];
const check = (id, fn) => { try { fn(); console.log(`ok:${id}`); } catch (error) { failures.push(`${id}:${error?.stack || error}`); console.error(`fail:${id}`); } };
const sample = (overrides = {}) => ({ x: 120, z: 240, elevation: 420, slope: 8, moisture: 0.64, rainfall: 0.22, runoff: 0.18, soilDepth: 0.7, vegetationCover: 0.72, rockExposure: 0.12, waterDistance: 65, roadDistance: 90, settlementDistance: 220, confidence: 0.95, biome: 'forest', ...overrides });
const weather = { precipitation: 0.34, humidity: 0.72, wind: 0.32, cloud: 0.46, temperature: 0.28 };

check('manifest-contract', () => {
  assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.version, 66);
  assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.deterministic, true);
  assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.noWorldMutation, true);
  assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.acceptance.width, 1536);
  assert.equal(ENVIRONMENT_RUNTIME_V66_MANIFEST.features.length, 19);
});

check('erosion-field', () => {
  const field = buildMicroErosionFieldV66({ seed: 66, samples: [sample(), sample({ x: 160, slope: 26 }), sample({ x: 220, z: 280, rainfall: 0.8 })], weather });
  assert.equal(validateErosionFieldV66(field).ok, true);
  assert.equal(field.field.length, 3);
  assert.ok(field.field.some((item) => item.channelBias > 0));
});

check('erosion-scenario', () => {
  const scenario = buildErosionScenarioV66({ sample: sample({ slope: 42, rainfall: 0.8 }), weather: { ...weather, precipitation: 0.86, stormPulse: 0.8 }, usage: { traffic: 0.42, grazing: 0.2, freezeThaw: 0.1 }, neighbors: [sample({ slope: 48 })] });
  assert.ok(scenario.sediment.sediment >= 0);
  assert.ok(scenario.stability.slippageRisk >= 0);
  assert.ok(scenario.surfaceIntent.dirtBlend >= 0 && scenario.surfaceIntent.dirtBlend <= 1);
});

check('water-surface', () => {
  const state = buildWaterSurfaceStateV66(sample({ waterDistance: 4 }), { ...weather, tide: 0.7 }, 0.25);
  assert.equal(state.depthClass, 'shallows');
  assert.ok(state.foamStrength > 0);
});

check('water-flood', () => {
  const flood = predictFloodRiskV66(sample({ waterDistance: 6, channelWidth: 5, bankHeight: 1.1, soilSaturation: 0.86 }), { precipitation: 0.62 }, { rainfall: 0.84, upstream: [sample({ flow: 7 }), sample({ flow: 9 })] });
  assert.ok(['critical', 'elevated', 'watch', 'stable'].includes(flood.class));
  assert.ok(flood.projectedDischarge >= 0);
});

check('water-corridor', () => {
  const corridor = buildRiverCorridorV66({ samples: [sample({ x: 0, z: 0, waterDistance: 3, flow: 3, channelWidth: 6 }), sample({ x: 0, z: 20, waterDistance: 2, flow: 4, channelWidth: 7 }), sample({ x: 5, z: 40, waterDistance: 4, flow: 5, channelWidth: 8 })], weather });
  assert.equal(validateWaterDynamicsV66(corridor).ok, true);
  assert.equal(corridor.corridor.length, 3);
});

check('wildlife-choice', () => {
  const choice = chooseHabitatSpeciesV66(sample({ biome: 'forest', vegetationCover: 0.8, waterDistance: 40 }), { time: 23 });
  assert.ok(choice.selected);
  assert.equal(choice.deterministic, true);
});

check('wildlife-corridor', () => {
  const runtime = buildWildlifeCorridorV66({ samples: [sample(), sample({ biome: 'wetland', waterDistance: 9, vegetationCover: 0.6 }), sample({ biome: 'alpine', elevation: 1900, slope: 34 })], time: 21, seed: 66, weather: { storm: 0.2 } });
  assert.equal(validateWildlifeRuntimeV66(runtime).ok, true);
  assert.ok(runtime.corridors.length >= 1);
});

check('exposure-sky', () => {
  const sky = buildSkyLumaEnvelopeV66({ samples: [sample(), sample({ slope: 45, cloud: 0.85, humidity: 0.9 })], weather: { cloud: 0.5, humidity: 0.7 } });
  assert.ok(sky.skyLumaFloor >= 0.08);
  assert.equal(sky.blackSkyRisk, 'low');
});

check('exposure-camera', () => {
  const exposure = buildCameraExposureV66({ camera: { distance: 1700 }, weather, terrain: sample({ slope: 31, aspect: 220, latitude: 41, dayOfYear: 170, hour: 16 }) });
  assert.ok(Number.isFinite(exposure.targetEV));
  assert.equal(exposure.preserveSnowHighlight, false);
});

check('navigation-field', () => {
  const runtime = buildNavigationFieldV66({ mode: 'walk', samples: [sample(), sample({ x: 150, slope: 28 }), sample({ x: 190, waterDepth: 0.4 })] });
  assert.equal(validateNavigationRuntimeV66({ policy: 'environment-runtime-navigation-v66-2026-09-15', deterministic: true, field: runtime }).ok, true);
  assert.ok(runtime[2].traversal.blocked);
});

check('navigation-safety', () => {
  const envelope = buildPlayerSafetyEnvelopeV66({ mode: 'walk', samples: [sample(), sample({ slope: 24 }), sample({ slope: 31 })] });
  assert.equal(envelope.mode, 'walk');
  assert.ok(envelope.blockedRatio <= 1);
});

check('ecology-ecotone', () => {
  const result = computeEcotoneV66(sample({ biome: 'forest', neighborBiome: 'grassland', moisture: 0.58 }));
  assert.ok(result.strength > 0);
  assert.ok(['broad', 'moderate', 'narrow', 'quiet'].includes(result.band));
});

check('ecology-season', () => {
  const runtime = buildSeasonalEcologyV66({ season: 'winter', samples: [sample(), sample({ biome: 'taiga', temperature: 0.18 }), sample({ biome: 'steppe', moisture: 0.22 })] });
  assert.equal(validateEcologyRuntimeV66({ policy: 'environment-runtime-ecology-v66-2026-09-15', deterministic: true, ...runtime }).ok, true);
  assert.ok(runtime.meanForage >= 0);
});

check('experience-runtime', () => {
  const runtime = buildV66ExperienceRuntime({ samples: [sample(), sample({ x: 180, neighborBiome: 'grassland' }), sample({ biome: 'wetland', x: 260, waterDistance: 8, rainfall: 0.74 })], weather, season: 'autumn', dayOfYear: 292, time: 20, camera: { distance: 1400, mode: 'walk' }, platform: 'desktop' });
  assert.equal(validateV66ExperienceRuntime(runtime).ok, true);
  assert.match(runtime.digest, /^[0-9a-f]{8}$/);
});

check('scenario-profiles', () => {
  const profiles = createV66ScenarioProfiles();
  assert.equal(profiles.length, 4);
  const runtime = buildV66ExperienceRuntime({ samples: [sample()], weather: { precipitation: 0.84, humidity: 0.93, wind: 0.76, cloud: 0.7 }, season: 'autumn' });
  assert.equal(evaluateV66Scenario(profiles[0], runtime).pass, true);
});

check('replay-determinism', () => {
  const input = { samples: [sample(), sample({ x: 200, slope: 27 })], weather, season: 'summer', dayOfYear: 180, time: 12, camera: { distance: 900 }, platform: 'mobile' };
  const a = buildV66ExperienceRuntime(input);
  const b = buildV66ExperienceRuntime(input);
  assert.equal(a.digest, b.digest);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v66', checks: 17 }));
}
