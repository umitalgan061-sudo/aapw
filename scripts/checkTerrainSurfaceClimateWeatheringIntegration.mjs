import assert from 'node:assert/strict';
import { resolveTerrainClimateExposureState } from '../src/3d/world/terrainSurfaceClimateExposure.js';
import { resolveTerrainAeolianDustState } from '../src/3d/world/terrainSurfaceAeolianDust.js';
import { resolveTerrainWeatheringState } from '../src/3d/world/terrainSurfaceWeathering.js';
import { resolveTerrainWindExposureState } from '../src/3d/world/terrainSurfaceWindExposure.js';
import { resolveTerrainThermalMicroclimateState } from '../src/3d/world/terrainSurfaceThermalMicroclimate.js';

const checkpoints = [
  [-1000, -1000, 0, 0, 0],
  [-500, -500, 45, 2, .10],
  [0, 0, 120, 5, .20],
  [500, 500, 260, 9, .30],
  [1000, 1000, 520, 14, .40],
  [1500, 1500, 900, 19, .50],
  [2000, 2000, 1250, 24, .60],
  [2500, 2500, 1550, 31, .70],
  [3000, 3000, 1900, 38, .80],
  [3500, 3500, 2300, 45, .90],
  [4000, 4000, 2800, 52, 1],
  [4500, 4500, 3300, 60, .35],
];

function assertState(name, state) {
  for (const [key, value] of Object.entries(state)) {
    assert.equal(Number.isFinite(value), true, `${name}.${key} finite`);
    assert.equal(value >= 0 && value <= 1, true, `${name}.${key} bounded`);
  }
}

let checksum = 0;
for (const [x, z, h, s, m] of checkpoints) {
  const climate = resolveTerrainClimateExposureState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m });
  const dust = resolveTerrainAeolianDustState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m });
  const weather = resolveTerrainWeatheringState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m });
  const wind = resolveTerrainWindExposureState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m });
  const thermal = resolveTerrainThermalMicroclimateState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m });
  assertState('climate', climate);
  assertState('dust', dust);
  assertState('weather', weather);
  assertState('wind', wind);
  assertState('thermal', thermal);
  const repeat = [
    resolveTerrainClimateExposureState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m }),
    resolveTerrainAeolianDustState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m }),
    resolveTerrainWeatheringState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m }),
    resolveTerrainWindExposureState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m }),
    resolveTerrainThermalMicroclimateState({ worldX: x, worldZ: z, heightMeters: h, slopeDegrees: s, moisture: m }),
  ];
  assert.deepEqual([climate, dust, weather, wind, thermal], repeat);
  checksum = (checksum + Math.round((climate.stress + dust.deposition + weather.stress + wind.abrasion + thermal.surfaceRange) * 1000003)) >>> 0;
}

const dry = resolveTerrainThermalMicroclimateState({ worldX: 800, worldZ: 900, heightMeters: 1200, slopeDegrees: 22, moisture: .05 });
const wet = resolveTerrainThermalMicroclimateState({ worldX: 800, worldZ: 900, heightMeters: 1200, slopeDegrees: 22, moisture: .95 });
assert(dry.drying > wet.drying);
assert(wet.dewRetention > dry.dewRetention);

const gentle = resolveTerrainClimateExposureState({ worldX: -700, worldZ: 600, heightMeters: 1550, slopeDegrees: 2, moisture: .8 });
const steep = resolveTerrainClimateExposureState({ worldX: -700, worldZ: 600, heightMeters: 1550, slopeDegrees: 42, moisture: .8 });
assert(steep.slopeExposure > gentle.slopeExposure);
assert(steep.exposedMineral >= gentle.exposedMineral);

const sheltered = resolveTerrainWindExposureState({ worldX: 300, worldZ: -700, heightMeters: 600, slopeDegrees: 4, moisture: .7 });
const exposed = resolveTerrainWindExposureState({ worldX: 1800, worldZ: -700, heightMeters: 1800, slopeDegrees: 34, moisture: .15 });
assert(exposed.windward >= 0);
assert(sheltered.calmPocket >= 0);

console.log('[checkTerrainSurfaceClimateWeatheringIntegration] PASS', JSON.stringify({ checkpoints: checkpoints.length, checksum }));
