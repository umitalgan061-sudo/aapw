#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainSnowCoverage } from '../src/3d/world/terrainBiomeShading.js';
import {
  TERRAIN_WIND_SNOW_POLICY,
  resolveTerrainWindSnowAdjustment,
  terrainWindExposureFromNeighbours,
} from '../src/3d/world/terrainWindSnowExposure.js';

const EPSILON = 1e-9;

assert.equal(TERRAIN_WIND_SNOW_POLICY.renderOnly, true,
  'wind snow exposure must stay render-only');
assert.equal(TERRAIN_WIND_SNOW_POLICY.heightAuthorityUnchanged, true,
  'wind snow exposure must never become terrain/collider height authority');
assert(Math.abs(Math.hypot(
  TERRAIN_WIND_SNOW_POLICY.prevailingSourceX,
  TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ,
) - 1) < EPSILON, 'prevailing wind source vector must remain normalized');
assert(TERRAIN_WIND_SNOW_POLICY.prevailingSourceX < 0 && TERRAIN_WIND_SNOW_POLICY.prevailingSourceZ < 0,
  'prevailing source must remain in the north-west quadrant');
assert(TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeStartDegrees
  < TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeFullDegrees,
'lee retention fade must have a valid slope interval');

const flat = terrainWindExposureFromNeighbours(100, 100, 100, 100, 10);
assert.equal(flat.windward, 0, 'flat terrain must not invent a windward face');
assert.equal(flat.lee, 0, 'flat terrain must not invent a lee face');
assert.equal(flat.slopeAspectStrength, 0, 'flat terrain must suppress slope-aspect redistribution');

const westFacing = terrainWindExposureFromNeighbours(90, 110, 100, 100, 10);
const eastFacing = terrainWindExposureFromNeighbours(110, 90, 100, 100, 10);
assert(westFacing.windward > westFacing.lee,
  'west-facing terrain should be windward under NW prevailing flow');
assert(eastFacing.lee > eastFacing.windward,
  'east-facing terrain should be lee-side under NW prevailing flow');
assert(Math.abs(westFacing.slopeDegrees - eastFacing.slopeDegrees) < EPSILON,
  'opposite aspects with equal gradient magnitude must preserve identical slope');
assert(Math.abs(westFacing.aspectDot + eastFacing.aspectDot) < EPSILON,
  'reversed slope aspect must invert directional exposure');

const northWestFacing = terrainWindExposureFromNeighbours(94, 106, 94, 106, 10);
const southEastFacing = terrainWindExposureFromNeighbours(106, 94, 106, 94, 10);
assert(northWestFacing.aspectDot > westFacing.aspectDot,
  'NW-facing slope should align more strongly with the authored prevailing source');
assert(northWestFacing.windward > 0.9 * northWestFacing.slopeAspectStrength,
  'directly exposed NW slope should approach full windward weighting');
assert(southEastFacing.lee > 0.9 * southEastFacing.slopeAspectStrength,
  'ordinary SE slope should approach full lee weighting before cliff shedding begins');
assert.equal(southEastFacing.leeRetention, 1,
  'ordinary mountain lee slope should retain the full directional deposition signal');

const cliffNorthWestFacing = terrainWindExposureFromNeighbours(80, 120, 80, 120, 10);
const cliffSouthEastFacing = terrainWindExposureFromNeighbours(120, 80, 120, 80, 10);
assert(cliffSouthEastFacing.slopeDegrees > TERRAIN_WIND_SNOW_POLICY.leeRetentionFadeFullDegrees,
  'cliff fixture must exceed the authored lee retention fade');
assert.equal(cliffSouthEastFacing.leeRetention, 0,
  'near-cliff lee face must shed loose deposition instead of painting snow onto rock');
assert.equal(cliffSouthEastFacing.lee, 0,
  'near-cliff SE face must expose no lee deposition weight after gravity shedding');
assert(cliffNorthWestFacing.windward > 0.9,
  'near-cliff NW face should remain strongly windward even when lee retention is zero');

const shallow = terrainWindExposureFromNeighbours(99.7, 100.3, 100, 100, 10);
const steep = terrainWindExposureFromNeighbours(90, 110, 100, 100, 10);
assert(shallow.slopeAspectStrength < steep.slopeAspectStrength,
  'aspect redistribution must fade out on shallow lowland slopes');

const northWindward = resolveTerrainWindSnowAdjustment({
  windward: northWestFacing.windward,
  lee: 0,
  permanentIce: 1,
  tundra: 1,
});
const northLee = resolveTerrainWindSnowAdjustment({
  windward: 0,
  lee: southEastFacing.lee,
  permanentIce: 1,
  tundra: 1,
});
const northCliffLee = resolveTerrainWindSnowAdjustment({
  windward: 0,
  lee: cliffSouthEastFacing.lee,
  permanentIce: 1,
  tundra: 1,
});
const tundraWindward = resolveTerrainWindSnowAdjustment({
  windward: northWestFacing.windward,
  lee: 0,
  permanentIce: 0,
  tundra: 1,
});
const tundraLee = resolveTerrainWindSnowAdjustment({
  windward: 0,
  lee: southEastFacing.lee,
  permanentIce: 0,
  tundra: 1,
});

assert(northWindward.windwardScour > tundraWindward.windwardScour,
  'permanent-ice windward scour should be stronger than tundra scour');
assert(northLee.leeDeposit > tundraLee.leeDeposit,
  'permanent-ice lee deposition should be stronger than tundra deposition');
assert.equal(northCliffLee.leeDeposit, 0,
  'cliff-safe exposure must suppress runtime lee snow deposition');
assert(northWindward.windwardScour <= TERRAIN_WIND_SNOW_POLICY.northWindwardScourMax + EPSILON,
  'windward scour must stay inside its authored permanent-ice ceiling');
assert(northLee.leeDeposit <= TERRAIN_WIND_SNOW_POLICY.northLeeDepositMax + EPSILON,
  'lee deposition must stay inside its authored permanent-ice ceiling');
assert(tundraWindward.windwardScour <= TERRAIN_WIND_SNOW_POLICY.tundraWindwardScourMax + EPSILON,
  'tundra scour must stay inside its restrained ceiling');
assert(tundraLee.leeDeposit <= TERRAIN_WIND_SNOW_POLICY.tundraLeeDepositMax + EPSILON,
  'tundra deposition must stay inside its restrained ceiling');

const south = resolveTerrainWindSnowAdjustment({
  windward: 1,
  lee: 1,
  permanentIce: 0,
  tundra: 0,
});
assert.equal(south.windwardScour, 0,
  'temperate south must receive no north-climate wind snow scour');
assert.equal(south.leeDeposit, 0,
  'temperate south must receive no north-climate lee snow deposition');

// Integration contract: the same directional signal must now alter the authoritative render snow
// coverage, not merely exist as a detached helper. Use an extreme north worldZ so climate clamping
// gives permanentIce=1 without depending on a particular world-scale constant in this contract.
// Keep the height below the full permanent-ice snowline so the neutral sample is not clamped to 1;
// otherwise a valid lee deposit becomes unobservable at the snowSupply ceiling.
const northBaseInput = {
  heightAboveSeaMeters: 60,
  slopeDegrees: northWestFacing.slopeDegrees,
  snowWeight: 0.25,
  worldZ: -1e9,
  terrainConcavityMeters: 0,
};
const neutralCoverage = resolveTerrainSnowCoverage(northBaseInput);
const windwardCoverage = resolveTerrainSnowCoverage({
  ...northBaseInput,
  terrainWindward: northWestFacing.windward,
  terrainLee: 0,
});
const leeCoverage = resolveTerrainSnowCoverage({
  ...northBaseInput,
  terrainWindward: 0,
  terrainLee: southEastFacing.lee,
});
const cliffLeeCoverage = resolveTerrainSnowCoverage({
  ...northBaseInput,
  slopeDegrees: cliffSouthEastFacing.slopeDegrees,
  terrainWindward: 0,
  terrainLee: cliffSouthEastFacing.lee,
});
const cliffNeutralCoverage = resolveTerrainSnowCoverage({
  ...northBaseInput,
  slopeDegrees: cliffSouthEastFacing.slopeDegrees,
});
assert(neutralCoverage.snowSupply < 1,
  'integration fixture must preserve headroom for measurable lee deposition');
assert(windwardCoverage.windwardScour > 0,
  'runtime snow coverage must consume windward exposure');
assert(leeCoverage.leeDeposit > 0,
  'runtime snow coverage must consume lee exposure');
assert(windwardCoverage.snowSupply < neutralCoverage.snowSupply,
  'windward terrain must lose loose snow supply');
assert(leeCoverage.snowSupply > neutralCoverage.snowSupply,
  'lee terrain must gain retained snow supply');
assert.equal(cliffLeeCoverage.leeDeposit, 0,
  'runtime cliff coverage must not receive lee deposition');
assert.equal(cliffLeeCoverage.snowSupply, cliffNeutralCoverage.snowSupply,
  'cliff lee aspect must not inflate snow supply after gravity shedding');

const southNeutralCoverage = resolveTerrainSnowCoverage({
  ...northBaseInput,
  worldZ: 1e9,
});
const southDirectionalCoverage = resolveTerrainSnowCoverage({
  ...northBaseInput,
  worldZ: 1e9,
  terrainWindward: 1,
  terrainLee: 1,
});
assert.equal(southDirectionalCoverage.windwardScour, 0,
  'temperate runtime coverage must not receive wind scour');
assert.equal(southDirectionalCoverage.leeDeposit, 0,
  'temperate runtime coverage must not receive lee deposition');
assert.equal(southDirectionalCoverage.snowSupply, southNeutralCoverage.snowSupply,
  'temperate snow supply must remain unchanged by directional inputs');

for (const sample of [
  flat,
  westFacing,
  eastFacing,
  northWestFacing,
  southEastFacing,
  cliffNorthWestFacing,
  cliffSouthEastFacing,
  shallow,
  steep,
]) {
  assert(Number.isFinite(sample.slopeDegrees) && Number.isFinite(sample.aspectDot),
    'terrain wind exposure outputs must remain finite');
  assert(sample.windward >= 0 && sample.windward <= 1 && sample.lee >= 0 && sample.lee <= 1,
    'terrain wind exposure weights must remain normalized');
  assert(sample.leeRetention >= 0 && sample.leeRetention <= 1,
    'lee retention must remain normalized');
}

console.log('[checkTerrainWindSnowExposure] PASS', JSON.stringify({
  policy: TERRAIN_WIND_SNOW_POLICY.id,
  westFacing: {
    slopeDegrees: westFacing.slopeDegrees,
    aspectDot: westFacing.aspectDot,
    windward: westFacing.windward,
  },
  northWestFacing: {
    slopeDegrees: northWestFacing.slopeDegrees,
    aspectDot: northWestFacing.aspectDot,
    windward: northWestFacing.windward,
  },
  southEastFacing: {
    slopeDegrees: southEastFacing.slopeDegrees,
    lee: southEastFacing.lee,
    leeRetention: southEastFacing.leeRetention,
  },
  cliffSouthEastFacing: {
    slopeDegrees: cliffSouthEastFacing.slopeDegrees,
    lee: cliffSouthEastFacing.lee,
    leeRetention: cliffSouthEastFacing.leeRetention,
  },
  permanentIce: {
    windwardScour: northWindward.windwardScour,
    leeDeposit: northLee.leeDeposit,
    neutralSnowSupply: neutralCoverage.snowSupply,
    windwardSnowSupply: windwardCoverage.snowSupply,
    leeSnowSupply: leeCoverage.snowSupply,
  },
  tundra: {
    windwardScour: tundraWindward.windwardScour,
    leeDeposit: tundraLee.leeDeposit,
  },
}));
