import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV66, validateEnvironmentRuntimeV66, createV66IntegrationSnapshot } from '../src/3d/world/environmentRuntimeIntegrationV66.js';
import { createV66VisualAcceptanceMatrix } from '../src/3d/world/environmentRuntimeV66Audit.js';
import { createV66ScenarioProfiles } from '../src/3d/world/environmentRuntimeExperienceV66.js';

const sample = (overrides = {}) => ({ x: 120, z: 240, elevation: 420, slope: 10, moisture: 0.62, rainfall: 0.28, soilDepth: 0.68, vegetationCover: 0.72, rockExposure: 0.12, waterDistance: 65, roadDistance: 110, settlementDistance: 260, confidence: 0.95, biome: 'forest', ...overrides });
const profiles = [
  { weather: { precipitation: 0.05, humidity: 0.22, wind: 0.18, cloud: 0.1, temperature: 0.64 }, season: 'summer', time: 12 },
  { weather: { precipitation: 0.88, humidity: 0.96, wind: 0.74, cloud: 0.86, temperature: 0.34 }, season: 'autumn', time: 18 },
  { weather: { precipitation: 0.36, humidity: 0.82, wind: 0.54, cloud: 0.76, temperature: 0.16 }, season: 'winter', time: 7 },
  { weather: { precipitation: 0.03, humidity: 0.14, wind: 0.3, cloud: 0.05, temperature: 0.88 }, season: 'summer', time: 15 },
];

const failures = [];
const check = (id, fn) => { try { fn(); console.log(`ok:${id}`); } catch (error) { failures.push(`${id}:${error?.stack || error}`); console.error(`fail:${id}`); } };

check('visual-matrix', () => {
  const matrix = createV66VisualAcceptanceMatrix();
  assert.equal(matrix.length, 6);
  assert.ok(matrix.every((item) => item.id && item.expected.length >= 2));
});

for (let i = 0; i < profiles.length; i += 1) {
  check(`profile-${i}`, () => {
    const p = profiles[i];
    const samples = [
      sample(),
      sample({ x: 210, z: 260, biome: i === 2 ? 'taiga' : 'grassland', slope: i === 1 ? 34 : 18, waterDistance: i === 1 ? 8 : 90, rainfall: p.weather.precipitation }),
      sample({ x: 310, z: 300, biome: i === 2 ? 'alpine' : i === 3 ? 'steppe' : 'wetland', elevation: i === 2 ? 1900 : 260, waterDistance: i === 1 ? 4 : 130, slope: i === 2 ? 38 : 9 }),
    ];
    const runtime = buildEnvironmentRuntimeV66({ samples, weather: p.weather, dayOfYear: p.season === 'winter' ? 30 : 190, season: p.season, time: p.time, camera: { distance: 1400, mode: 'walk' }, platform: i === 3 ? 'mobile' : 'desktop' });
    const validation = validateEnvironmentRuntimeV66(runtime);
    assert.equal(validation.ok, true, validation.errors.join(','));
    assert.equal(runtime.audit.p0Pass, true);
    assert.equal(runtime.contract.noWorldMutation, true);
    assert.match(runtime.digest, /^[0-9a-f]{8}$/);
    const snapshot = createV66IntegrationSnapshot(runtime);
    assert.equal(snapshot.digest, runtime.digest);
  });
}

check('cross-profile-determinism', () => {
  const p = profiles[1];
  const input = { samples: [sample(), sample({ x: 180, waterDistance: 12, biome: 'wetland' })], weather: p.weather, season: p.season, time: p.time, dayOfYear: 270, camera: { distance: 900 }, platform: 'desktop' };
  const a = buildEnvironmentRuntimeV66(input);
  const b = buildEnvironmentRuntimeV66(input);
  assert.deepEqual(a, b);
});

check('scenario-count', () => {
  assert.equal(createV66ScenarioProfiles().length, 4);
});

check('mutation-boundary', () => {
  const runtime = buildEnvironmentRuntimeV66({ samples: [sample()] });
  const json = JSON.stringify(runtime);
  assert.equal(runtime.contract.noWorldMutation, true);
  assert.ok(json.includes('WorldAssetPlacementPipeline.js'));
  assert.ok(json.includes('MaterialAssignmentCore.js'));
});

if (failures.length) { console.error(JSON.stringify({ ok: false, failures }, null, 2)); process.exitCode = 1; } else console.log(JSON.stringify({ ok: true, suite: 'v66-integration', checks: 9 }));
