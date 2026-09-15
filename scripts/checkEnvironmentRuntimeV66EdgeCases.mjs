import assert from 'node:assert/strict';
import { buildMicroErosionFieldV66, buildErosionScenarioV66 } from '../src/3d/world/environmentRuntimeErosionV66.js';
import { buildRiverCorridorV66, predictFloodRiskV66 } from '../src/3d/world/environmentRuntimeWaterDynamicsV66.js';
import { chooseHabitatSpeciesV66, buildWildlifeCorridorV66 } from '../src/3d/world/environmentRuntimeWildlifeV66.js';
import { computeTerrainExposureV66, computeFogVisibilityV66 } from '../src/3d/world/environmentRuntimeExposureV66.js';
import { classifyTraversalV66, buildRouteEdgeV66, selectSafeDetourV66 } from '../src/3d/world/environmentRuntimeNavigationV66.js';
import { buildSeasonalEcologyV66, buildVegetationLayerWeightsV66 } from '../src/3d/world/environmentRuntimeEcologyV66.js';

const sample = (overrides = {}) => ({ x: 0, z: 0, elevation: 320, slope: 12, moisture: 0.6, rainfall: 0.2, soilDepth: 0.65, vegetationCover: 0.62, rockExposure: 0.18, waterDistance: 80, roadDistance: 100, settlementDistance: 260, confidence: 0.92, biome: 'forest', ...overrides });
const cases = [];
const check = (id, fn) => { try { fn(); cases.push({ id, pass: true }); console.log(`ok:${id}`); } catch (error) { cases.push({ id, pass: false }); console.error(`fail:${id}:${error.message}`); } };

check('zero-rain', () => {
  const field = buildMicroErosionFieldV66({ samples: [sample({ rainfall: 0 })], weather: { precipitation: 0, humidity: 0.1 }, seed: 1 });
  assert.ok(field.field[0].sediment < 0.12);
});
check('cloudburst-runoff', () => {
  const field = buildMicroErosionFieldV66({ samples: [sample({ slope: 48, rainfall: 1, vegetationCover: 0.12, soilDepth: 0.18 })], weather: { precipitation: 1, humidity: 1, stormPulse: 1 }, seed: 9 });
  assert.ok(field.field[0].washStrength > 0.3);
});
check('steep-bank', () => {
  const scenario = buildErosionScenarioV66({ sample: sample({ slope: 57, waterDistance: 7, bankHeight: 0.8 }), weather: { precipitation: 0.9, humidity: 0.92 } });
  assert.ok(scenario.stability.slippageRisk > 0.2);
});
check('flood-critical-candidate', () => {
  const result = predictFloodRiskV66(sample({ channelWidth: 2, bankHeight: 0.4, soilSaturation: 0.96, waterDistance: 1 }), { precipitation: 0.98 }, { rainfall: 1, upstream: [sample({ flow: 20 }), sample({ flow: 24 })] });
  assert.ok(result.risk >= 0.7);
});
check('river-ascending', () => {
  const corridor = buildRiverCorridorV66({ samples: [sample({ z: 0, waterDistance: 5, flow: 1 }), sample({ z: 40, waterDistance: 3, flow: 3 }), sample({ z: 80, waterDistance: 2, flow: 6 })], weather: { precipitation: 0.4 } });
  assert.equal(corridor.corridor.length, 3);
  assert.ok(corridor.corridor.every((item) => item.width >= 2));
});
check('wildlife-urban-avoidance', () => {
  const result = chooseHabitatSpeciesV66(sample({ settlementDistance: 12, roadDistance: 10 }), { time: 22 });
  assert.ok(result.candidates.every((item) => item.reasons.includes('settlement-buffer') || item.reasons.includes('road-buffer')));
});
check('wildlife-alpine', () => {
  const runtime = buildWildlifeCorridorV66({ samples: [sample({ biome: 'alpine', elevation: 2200, slope: 44, waterDistance: 140, vegetationCover: 0.2 })], time: 6, seed: 88 });
  assert.ok(runtime.corridors.length >= 0);
});
check('solar-noon', () => {
  const a = computeTerrainExposureV66(sample({ latitude: 41, dayOfYear: 172, hour: 12, cloud: 0.05 }));
  const b = computeTerrainExposureV66(sample({ latitude: 41, dayOfYear: 172, hour: 4, cloud: 0.05 }));
  assert.ok(a.exposure > b.exposure);
});
check('fog-extreme', () => {
  const fog = computeFogVisibilityV66({ humidity: 1, precipitation: 1, cloud: 1 }, 5000);
  assert.ok(fog.visibility < 0.2);
  assert.ok(fog.visibility >= 0);
});
check('traversal-water', () => {
  const dry = classifyTraversalV66(sample({ waterDepth: 0 }), 'walk');
  const wet = classifyTraversalV66(sample({ waterDepth: 0.8 }), 'walk');
  assert.equal(dry.blocked, false);
  assert.equal(wet.blocked, true);
});
check('traversal-sprint', () => {
  const walk = classifyTraversalV66(sample({ slope: 27 }), 'walk');
  const sprint = classifyTraversalV66(sample({ slope: 27 }), 'sprint');
  assert.equal(walk.blocked, false);
  assert.equal(sprint.blocked, true);
});
check('route-edge', () => {
  const edge = buildRouteEdgeV66(sample(), sample({ x: 24, z: 18, slope: 16 }), { hazard: 0.2 });
  assert.ok(edge.length > 0);
  assert.ok(Number.isFinite(edge.cost));
});
check('detour', () => {
  const choice = selectSafeDetourV66(sample(), [sample({ x: 20, slope: 12 }), sample({ x: 40, slope: 46 }), sample({ x: 8, waterDepth: 0.5 })], { mode: 'walk', target: { x: 80, z: 10 }, targetDistance: 80 });
  assert.equal(choice.traversal.blocked, false);
});
check('ecology-desert', () => {
  const weights = buildVegetationLayerWeightsV66(sample({ biome: 'desert', moisture: 0.04, temperature: 0.95 }));
  assert.ok(weights.grass < 0.25);
  assert.ok(weights.bare > 0);
});
check('ecology-wetland', () => {
  const weights = buildVegetationLayerWeightsV66(sample({ biome: 'wetland', moisture: 0.96, waterDistance: 3 }));
  assert.ok(weights.moss > weights.grass * 0.5);
});
check('season-contrast', () => {
  const summer = buildSeasonalEcologyV66({ season: 'summer', samples: [sample(), sample({ biome: 'taiga' })] });
  const winter = buildSeasonalEcologyV66({ season: 'winter', samples: [sample(), sample({ biome: 'taiga' })] });
  assert.ok(winter.meanForage < summer.meanForage);
});
check('coordinate-extreme', () => {
  const field = buildMicroErosionFieldV66({ samples: [sample({ x: 900000, z: -900000 })], weather: { precipitation: 0.3 }, seed: 66 });
  assert.equal(field.field[0].x, 900000);
});
check('negative-input-normalization', () => {
  const traversal = classifyTraversalV66(sample({ slope: -20, waterDepth: -1, confidence: -3 }), 'walk');
  assert.ok(traversal.risk >= 0 && traversal.risk <= 1);
});
check('duplicate-points', () => {
  const corridor = buildRiverCorridorV66({ samples: [sample(), sample(), sample()], weather: {} });
  assert.equal(corridor.corridor.length, 3);
});
check('large-sample', () => {
  const samples = Array.from({ length: 60 }, (_, index) => sample({ x: index * 12, z: (index % 5) * 16, slope: index % 42 }));
  const field = buildMicroErosionFieldV66({ samples, weather: { precipitation: 0.22 }, seed: 123 });
  assert.equal(field.count, 60);
});
check('deterministic-edge', () => {
  const input = { samples: [sample({ x: 10 }), sample({ x: 20, biome: 'steppe' })], weather: { precipitation: 0.41, humidity: 0.55 }, seed: 321 };
  const a = buildMicroErosionFieldV66(input);
  const b = buildMicroErosionFieldV66(input);
  assert.deepEqual(a, b);
});

if (cases.some((entry) => !entry.pass)) { console.error(JSON.stringify(cases, null, 2)); process.exitCode = 1; } else console.log(JSON.stringify({ ok: true, suite: 'v66-edge-cases', checks: cases.length }));
