#!/usr/bin/env node
/**
 * Production-wiring regression gate for directional macro weathering.
 *
 * The low-level contract and statistics checks prove the weathering field itself is stable. This
 * check proves that field is actually consumed by the shipped relief path, remains behind the
 * existing coastal/water safety gates, and stays compatible with the seat taper owned by terrain.js.
 * It intentionally avoids rendering: every assertion is deterministic and can run in plain Node.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  TERRAIN_RELIEF_DETAIL_POLICY,
  coastWarpOffsets,
  reliefDetailMeters,
  signedFbmNoise,
} from '../src/3d/world/terrainReliefDetail.js';
import {
  TERRAIN_MACRO_WEATHERING_POLICY,
  terrainMacroWeatheringResidualMeters,
  terrainMacroWeatheringSignals,
} from '../src/3d/world/terrainMacroWeathering.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELIEF_PATH = resolve(HERE, '../src/3d/world/terrainReliefDetail.js');
const EPSILON = 1e-10;
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function close(actual, expected, epsilon, label) {
  assert(
    Math.abs(actual - expected) <= epsilon,
    `${label}: ${actual} !== ${expected} (eps ${epsilon})`,
  );
}

function sampleGrid(context, width = 31, height = 23) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const nx = 0.04 + (x / (width - 1)) * 0.92;
      const ny = 0.04 + (y / (height - 1)) * 0.92;
      rows.push({
        nx,
        ny,
        residual: terrainMacroWeatheringResidualMeters(nx, ny, context),
        combined: reliefDetailMeters(nx, ny, context),
        signals: terrainMacroWeatheringSignals(nx, ny, context),
      });
    }
  }
  return rows;
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return {
    min: sorted[0],
    max: sorted.at(-1),
    mean,
    meanAbsolute: values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length,
    sd: Math.sqrt(variance),
    p10: percentile(0.10),
    p50: percentile(0.50),
    p90: percentile(0.90),
  };
}

function assertFiniteRows(rows, label) {
  for (const row of rows) {
    assert(Number.isFinite(row.residual), `${label} macro residual must be finite`);
    assert(Number.isFinite(row.combined), `${label} combined relief must be finite`);
    for (const [key, value] of Object.entries(row.signals)) {
      if (typeof value === 'number') assert(Number.isFinite(value), `${label} signal ${key} must be finite`);
    }
  }
}

// ---------------------------------------------------------------------------
// Policy and production wiring
// ---------------------------------------------------------------------------

assert.equal(
  TERRAIN_RELIEF_DETAIL_POLICY.id,
  'terrain-coast-warp-and-relief-detail-2026-08-26-v2-directional-weathering',
);
assert.equal(TERRAIN_RELIEF_DETAIL_POLICY.directionalMacroWeathering, true);
assert.equal(
  TERRAIN_MACRO_WEATHERING_POLICY.id,
  'terrain-macro-hydrology-weathering-2026-08-26-v1',
);
assert.equal(TERRAIN_MACRO_WEATHERING_POLICY.renderOnly, false);
assert.equal(TERRAIN_MACRO_WEATHERING_POLICY.deterministicWorldSpace, true);
assert.equal(TERRAIN_MACRO_WEATHERING_POLICY.canonicalSurfaceAuthorityPreserved, true);
assert.equal(TERRAIN_MACRO_WEATHERING_POLICY.settlementTaperOwnedByCaller, true);

const reliefSource = readFileSync(RELIEF_PATH, 'utf8');
assert(
  reliefSource.includes("from './terrainMacroWeathering.js'"),
  'production relief module must import directional macro weathering',
);
assert(
  reliefSource.includes('terrainMacroWeatheringResidualMeters(normalizedX, normalizedY'),
  'production relief function must consume the macro weathering residual',
);
const weatheringCall = reliefSource.indexOf('terrainMacroWeatheringResidualMeters(normalizedX, normalizedY');
const lowGroundDamping = reliefSource.indexOf('if (metres < 0) metres *= clamp01');
const mountainCragGate = reliefSource.indexOf('const mountainGate = clamp01');
assert(weatheringCall > 0, 'weathering call marker missing');
assert(lowGroundDamping > weatheringCall, 'existing low-ground negative relief damping must remain after weathering');
assert(mountainCragGate > lowGroundDamping, 'canonical mountain crags must remain after low-ground damping');

// The legacy public noise/coast APIs are still live because terrain biome shading and terrain.js
// consume them. This catches accidental "cleanup" that would replace the established interfaces.
for (const point of [
  [0.12, 0.18],
  [0.50, 0.50],
  [0.83, 0.67],
]) {
  const [nx, ny] = point;
  assert(Number.isFinite(signedFbmNoise(nx * 11, ny * 13, 4)));
  const warp = coastWarpOffsets(nx, ny);
  assert(Number.isFinite(warp.du));
  assert(Number.isFinite(warp.dv));
  assert(Math.abs(warp.du) <= TERRAIN_RELIEF_DETAIL_POLICY.coastWarpU * 1.05);
  assert(Math.abs(warp.dv) <= TERRAIN_RELIEF_DETAIL_POLICY.coastWarpV * 1.05);
}

// ---------------------------------------------------------------------------
// Exact wetness and shoreline ownership
// ---------------------------------------------------------------------------

const waterContexts = [
  { heightAboveSeaMeters: -5, reliefInfluence: 0.8, rockWeight: 0.8, snowWeight: 0.3, waterWeight: 1 },
  { heightAboveSeaMeters: 0, reliefInfluence: 1, rockWeight: 1, snowWeight: 1, waterWeight: 1 },
  { heightAboveSeaMeters: 50, reliefInfluence: 1, rockWeight: 1, snowWeight: 1, waterWeight: 1 },
];
for (const context of waterContexts) {
  for (const [nx, ny] of [[0.1, 0.2], [0.45, 0.7], [0.91, 0.13]]) {
    close(terrainMacroWeatheringResidualMeters(nx, ny, context), 0, EPSILON, 'open water weathering');
    close(reliefDetailMeters(nx, ny, context), 0, EPSILON, 'open water combined relief');
  }
}

// Below the historical 0.3 m shore fade start, the shipped relief path must be exact-neutral even
// though the standalone macro field has its own independent shore gate. The established owner stays
// authoritative and prevents new ponds/spikes at the wet/dry edge.
const subShore = {
  heightAboveSeaMeters: TERRAIN_RELIEF_DETAIL_POLICY.shoreFadeStartMeters * 0.5,
  reliefInfluence: 0.55,
  rockWeight: 0.35,
  snowWeight: 0,
  waterWeight: 0,
};
for (let index = 0; index < 64; index += 1) {
  const nx = 0.08 + ((index * 37) % 83) / 100;
  const ny = 0.06 + ((index * 53) % 87) / 100;
  close(reliefDetailMeters(clamp01(nx), clamp01(ny), subShore), 0, EPSILON, 'sub-shore combined relief');
}

// ---------------------------------------------------------------------------
// Determinism and seam continuity through the production entry point
// ---------------------------------------------------------------------------

const upland = {
  heightAboveSeaMeters: 110,
  reliefInfluence: 0.34,
  rockWeight: 0.25,
  snowWeight: 0.03,
  waterWeight: 0,
};
const mountain = {
  heightAboveSeaMeters: 420,
  reliefInfluence: 0.86,
  rockWeight: 0.72,
  snowWeight: 0.20,
  waterWeight: 0,
};

for (const context of [upland, mountain]) {
  for (let i = 0; i < 80; i += 1) {
    const nx = 0.03 + (((i * 29) % 94) / 100);
    const ny = 0.02 + (((i * 47) % 95) / 100);
    const first = reliefDetailMeters(nx, ny, context);
    const second = reliefDetailMeters(nx, ny, { ...context });
    close(first, second, EPSILON, 'combined relief determinism');

    const residualA = terrainMacroWeatheringResidualMeters(nx, ny, context);
    const residualB = terrainMacroWeatheringResidualMeters(nx, ny, { ...context });
    close(residualA, residualB, EPSILON, 'macro residual determinism');
  }
}

// Adjacent chunks sample identical world coordinates on their shared boundary. There is no chunk
// coordinate in either implementation, so checking an exact boundary sequence proves the residual
// cannot invent seams as chunks stream in different orders.
const boundaryX = 0.5;
for (let row = 0; row <= 96; row += 1) {
  const ny = row / 96;
  const left = reliefDetailMeters(boundaryX, ny, upland);
  const right = reliefDetailMeters(boundaryX, ny, upland);
  close(left, right, EPSILON, `production boundary ${row}`);

  const delta = 1e-7;
  const west = reliefDetailMeters(boundaryX - delta, ny, upland);
  const east = reliefDetailMeters(boundaryX + delta, ny, upland);
  assert(Math.abs(west - east) < 0.015, `sub-millimetric coordinate step exposed discontinuity at row ${row}`);
}

// ---------------------------------------------------------------------------
// Production-scale contribution envelopes
// ---------------------------------------------------------------------------

const lowland = {
  heightAboveSeaMeters: 18,
  reliefInfluence: 0.10,
  rockWeight: 0.08,
  snowWeight: 0,
  waterWeight: 0,
};
const lowlandRows = sampleGrid(lowland);
const uplandRows = sampleGrid(upland);
const mountainRows = sampleGrid(mountain);
for (const [label, rows] of [
  ['lowland', lowlandRows],
  ['upland', uplandRows],
  ['mountain', mountainRows],
]) assertFiniteRows(rows, label);

const lowlandMacro = stats(lowlandRows.map((row) => row.residual));
const uplandMacro = stats(uplandRows.map((row) => row.residual));
const mountainMacro = stats(mountainRows.map((row) => row.residual));
const uplandCombined = stats(uplandRows.map((row) => row.combined));
const mountainCombined = stats(mountainRows.map((row) => row.combined));

assert(lowlandMacro.meanAbsolute > 0.20 && lowlandMacro.meanAbsolute < 1.5, 'lowland weathering should be visible but restrained');
assert(uplandMacro.sd > lowlandMacro.sd * 1.6, 'upland weathering should carry more relief than lowlands');
assert(mountainMacro.sd > uplandMacro.sd * 1.6, 'mountain weathering should scale with landform height');
assert(mountainMacro.min >= -TERRAIN_MACRO_WEATHERING_POLICY.maxNegativeResidualMeters - EPSILON);
assert(mountainMacro.max <= TERRAIN_MACRO_WEATHERING_POLICY.maxPositiveResidualMeters + EPSILON);
assert(uplandCombined.sd > 8, 'established relief layers must remain present around new upland weathering');
assert(mountainCombined.sd > uplandCombined.sd, 'mountain production relief should remain stronger than upland relief');

// Drainage-conditioned subsets must actually affect production relief distribution rather than just
// publishing diagnostic masks that never reach height.
const strongChannels = uplandRows.filter((row) => row.signals.drainage.channel > 0.58);
const quietInterfluves = uplandRows.filter((row) => row.signals.drainage.channel < 0.10);
assert(strongChannels.length >= 8, `expected strong channel samples, got ${strongChannels.length}`);
assert(quietInterfluves.length >= 80, `expected quiet interfluves, got ${quietInterfluves.length}`);
const channelResidualMean = strongChannels.reduce((sum, row) => sum + row.residual, 0) / strongChannels.length;
const quietResidualMean = quietInterfluves.reduce((sum, row) => sum + row.residual, 0) / quietInterfluves.length;
assert(channelResidualMean < quietResidualMean - 0.35, 'drainage channels must lower terrain relative to interfluves');

// Talus/scarp behavior is deliberately mountain-weighted. Require a non-trivial population but not
// broad coverage: if most vertices become talus, the world would read as a repeated texture band.
const uplandTalus = uplandRows.filter((row) => row.signals.talus.deposit > 0.12).length / uplandRows.length;
const mountainTalus = mountainRows.filter((row) => row.signals.talus.deposit > 0.12).length / mountainRows.length;
assert(uplandTalus < 0.12, `upland talus coverage too broad: ${uplandTalus}`);
assert(mountainTalus > uplandTalus * 1.7, 'mountains must carry substantially more talus than uplands');
assert(mountainTalus < 0.25, `mountain talus coverage too broad: ${mountainTalus}`);

// Aspect residual should have both signs across the world. A one-sign field would lift or sink whole
// regions instead of reading as windward/lee weathering.
const aspects = mountainRows.map((row) => row.signals.componentsMeters.aspect);
assert(aspects.some((value) => value < -0.15), 'lee-side negative aspect residual missing');
assert(aspects.some((value) => value > 0.15), 'windward positive aspect residual missing');
const aspectStats = stats(aspects);
assert(Math.abs(aspectStats.mean) < 0.35, `aspect residual has a biased global mean: ${aspectStats.mean}`);

// A partial wetness ramp must monotonically suppress the new residual envelope. This catches any
// future refactor that accidentally applies drainage carving under broad submerged shelves.
const wetnessLevels = [0, 0.25, 0.50, 0.75, 0.95, 1];
const wetnessEnergy = wetnessLevels.map((waterWeight) => {
  const context = { ...upland, waterWeight };
  const values = sampleGrid(context, 17, 13).map((row) => Math.abs(row.residual));
  return values.reduce((sum, value) => sum + value, 0) / values.length;
});
for (let index = 1; index < wetnessEnergy.length; index += 1) {
  assert(
    wetnessEnergy[index] <= wetnessEnergy[index - 1] + 1e-8,
    `weathering energy must fall with wetness: ${wetnessEnergy.join(', ')}`,
  );
}
close(wetnessEnergy.at(-1), 0, EPSILON, 'fully wet residual energy');

const report = {
  reliefPolicyId: TERRAIN_RELIEF_DETAIL_POLICY.id,
  macroPolicyId: TERRAIN_MACRO_WEATHERING_POLICY.id,
  lowlandMacro,
  uplandMacro,
  mountainMacro,
  uplandCombined,
  mountainCombined,
  drainage: {
    strongChannelSamples: strongChannels.length,
    quietInterfluveSamples: quietInterfluves.length,
    channelResidualMean,
    quietResidualMean,
  },
  talus: { uplandFraction: uplandTalus, mountainFraction: mountainTalus },
  aspect: aspectStats,
  wetnessEnergy,
};

console.log('[checkTerrainMacroWeatheringIntegration] PASS');
console.log(JSON.stringify(report, null, 2));
