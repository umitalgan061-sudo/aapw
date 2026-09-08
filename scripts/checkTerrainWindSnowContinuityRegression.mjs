#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_WIND_SNOW_SURFACE_FABRIC_POLICY as P,
  SNOW_RELIEF_FAMILIES,
  resolveTerrainWindSnowSurfaceFabric,
  terrainWindSnowSurfaceFabricDigest,
  resolveTerrainWindSnowContinuity,
  resolveTerrainWindSnowToneHints,
  buildTerrainWindSnowSurfaceFamilyMatrix,
  buildTerrainWindSnowSurfaceProbeLadder,
  summarizeTerrainWindSnowSurfaceFabric,
} from '../src/3d/world/terrainWindSnowSurfaceFabric.js';
import {
  TERRAIN_WIND_SNOW_POLICY as WIND,
  terrainWindExposureFromNeighbours,
  resolveTerrainWindSnowAdjustment,
} from '../src/3d/world/terrainWindSnowExposure.js';
import {
  TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY as SNOW,
  resolveTerrainSnowRelief,
  terrainSnowReliefDigest,
  validateTerrainSnowReliefResult,
} from '../src/3d/world/terrainSnowReliefDirector.js';
import {
  TERRAIN_GROUND_CONTEXT_POLICY as GROUND,
  buildTerrainGroundContext,
  resolveTerrainGroundPlacementSafety,
  resolveTerrainAgentPlacementQuery,
  validateTerrainGroundContext,
} from '../src/3d/world/terrainGroundContext.js';
import {
  TERRAIN_GROUND_CONTEXT_PROFILES,
  evaluateTerrainGroundContextAgainstProfile,
} from '../src/3d/world/terrainGroundContextProfiles.js';

const EPS = 1e-9;
const finite = (value) => Number.isFinite(value);
const bounded = (value, min = 0, max = 1) => finite(value) && value >= min - EPS && value <= max + EPS;
const fabricKeys = [
  'slope', 'steepness', 'cliff', 'directional', 'crosswindNeutrality', 'foldStrength',
  'ridgeShoulder', 'brokenRidge', 'shelteredPocket', 'valleyContinuity', 'slopeTransition',
  'windwardAlignment', 'leeAlignment', 'leeRetention', 'retention', 'ridgeCrust', 'leePowder',
  'continuity',
];

function checkFabric(fabric, label) {
  assert(Object.isFrozen(fabric), `${label}: fabric must be immutable`);
  for (const key of fabricKeys) assert(bounded(fabric[key]), `${label}: ${key} out of bounds`);
  assert(bounded(fabric.windwardGain, P.minGain, P.maxGain), `${label}: windward gain`);
  assert(bounded(fabric.leeGain, P.minGain, P.maxGain), `${label}: lee gain`);
  assert(bounded(fabric.materialTemperatureBias, -1, 1), `${label}: temperature bias`);
  assert(bounded(fabric.materialBrightnessBias, -1, 1), `${label}: brightness bias`);
  return fabric;
}

function fixture(slopeDegrees, aspectDot, foldGradient, leeRetention = 1) {
  return { slopeDegrees, aspectDot, foldGradient, leeRetention };
}

assert.equal(P.renderOnly, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.hydrologyAuthorityUnchanged, true);
assert.equal(P.colliderAuthorityUnchanged, true);
assert.equal(P.placementAuthorityUnchanged, true);
assert.equal(P.chunkSeamSafe, true);
assert.equal(P.secondHeightAuthority, false);
assert.equal(P.worldGridOverlay, false);
assert.equal(P.periodicStriping, false);
assert.equal(P.binaryMasking, false);
assert(P.minGain < 1 && P.maxGain > 1);
assert(P.curvatureScale > 0 && P.ridgeCrustScale > 0 && P.leePowderScale > 0);

assert.equal(WIND.renderOnly, true);
assert.equal(WIND.heightAuthorityUnchanged, true);
assert.equal(WIND.northWindwardScourMax, 0.18);
assert.equal(WIND.northLeeDepositMax, 0.11);
assert.equal(SNOW.renderOnly, true);
assert.equal(SNOW.heightAuthorityUnchanged, true);
assert.equal(SNOW.hydrologyAuthorityUnchanged, true);
assert.equal(SNOW.colliderAuthorityUnchanged, true);
assert.equal(GROUND.readOnly, true);
assert.equal(GROUND.heightAuthorityUnchanged, true);
assert.equal(GROUND.hydrologyAuthorityUnchanged, true);
assert.equal(GROUND.colliderAuthorityUnchanged, true);
assert.equal(GROUND.navigationAuthorityUnchanged, true);

const slopes = [0, 2, 4, 8, 12, 16, 20, 24, 30, 34, 38, 42, 46, 52, 58, 66, 78, 90];
const aspects = [-1, -0.92, -0.75, -0.55, -0.35, -0.12, 0, 0.12, 0.35, 0.55, 0.75, 0.92, 1];
const folds = [0, 0.01, 0.025, 0.04, 0.08, 0.12, 0.16, 0.20, 0.28];
const retentions = [0, 0.25, 0.5, 0.75, 1];

const baseline = checkFabric(resolveTerrainWindSnowSurfaceFabric(fixture(28, 0.72, 0.10)), 'baseline');
const baselineAgain = resolveTerrainWindSnowSurfaceFabric(fixture(28, 0.72, 0.10));
assert.equal(terrainWindSnowSurfaceFabricDigest(baseline), terrainWindSnowSurfaceFabricDigest(baselineAgain));
assert.equal(resolveTerrainWindSnowContinuity(fixture(28, 0.72, 0.10)), resolveTerrainWindSnowContinuity(fixture(28, 0.72, 0.10)));

const records = [];
for (const slope of slopes) {
  for (const aspect of aspects) {
    for (const fold of folds) {
      for (const retention of retentions) {
        const input = fixture(slope, aspect, fold, retention);
        const fabric = checkFabric(resolveTerrainWindSnowSurfaceFabric(input), `grid-${slope}-${aspect}-${fold}-${retention}`);
        const digest = terrainWindSnowSurfaceFabricDigest(fabric);
        assert.equal(digest, terrainWindSnowSurfaceFabricDigest(resolveTerrainWindSnowSurfaceFabric(input)));
        const continuity = resolveTerrainWindSnowContinuity(input);
        assert(bounded(continuity), 'continuity bounds');
        const hints = resolveTerrainWindSnowToneHints(input);
        assert(bounded(hints.packedBias));
        assert(bounded(hints.accumulatedBias));
        assert(bounded(hints.cooling));
        assert(bounded(hints.warming));
        assert(bounded(hints.continuity));
        assert(bounded(hints.brightness, -1, 1));
        records.push({ slope, aspect, fold, retention, fabric, digest, continuity, hints });
      }
    }
  }
}
assert(records.length === slopes.length * aspects.length * folds.length * retentions.length);
assert(new Set(records.map((row) => row.digest)).size > records.length * 0.18);

const flat = resolveTerrainWindSnowSurfaceFabric(fixture(0, 0.9, 0.4));
assert.equal(flat.windwardAlignment, 0);
assert.equal(flat.leeAlignment, 0);
assert.equal(flat.ridgeCrust, 0);
assert.equal(flat.leePowder, 0);
assert.equal(flat.slope, 0);
assert(flat.crosswindNeutrality > 0.99);

for (const slope of slopes) {
  const cross = checkFabric(resolveTerrainWindSnowSurfaceFabric(fixture(slope, 0, 0.18)), `crosswind-${slope}`);
  assert.equal(cross.windwardAlignment, 0);
  assert.equal(cross.leeAlignment, 0);
  assert(cross.crosswindNeutrality >= 0.99 || slope < 4);
  assert(cross.ridgeCrust < 0.05, `crosswind ridge crust fabricated at slope ${slope}`);
  assert(cross.leePowder < 0.05, `crosswind powder fabricated at slope ${slope}`);
}

const windwardRows = slopes.map((slope) => ({
  slope,
  fabric: resolveTerrainWindSnowSurfaceFabric(fixture(slope, 0.92, 0.16)),
}));
const leeRows = slopes.map((slope) => ({
  slope,
  fabric: resolveTerrainWindSnowSurfaceFabric(fixture(slope, -0.92, 0.16)),
}));
for (const row of windwardRows) checkFabric(row.fabric, `windward-${row.slope}`);
for (const row of leeRows) checkFabric(row.fabric, `lee-${row.slope}`);
for (const row of windwardRows) {
  const counterpart = leeRows.find((entry) => entry.slope === row.slope).fabric;
  assert(row.fabric.windwardAlignment >= 0);
  assert(counterpart.leeAlignment >= 0);
  assert(row.fabric.ridgeCrust >= counterpart.ridgeCrust - 0.15);
  assert(counterpart.leePowder >= row.fabric.leePowder - 0.15);
}

for (const fold of folds) {
  const low = resolveTerrainWindSnowSurfaceFabric(fixture(30, 0.82, fold));
  const high = resolveTerrainWindSnowSurfaceFabric(fixture(30, 0.82, fold));
  assert.equal(terrainWindSnowSurfaceFabricDigest(low), terrainWindSnowSurfaceFabricDigest(high));
}

let priorFold = -EPS;
for (const fold of folds) {
  const response = resolveTerrainWindSnowSurfaceFabric(fixture(30, 0.82, fold));
  assert(response.foldStrength + EPS >= priorFold, `fold strength regressed at ${fold}`);
  priorFold = response.foldStrength;
}
let priorSlope = -EPS;
for (const slope of slopes) {
  const response = resolveTerrainWindSnowSurfaceFabric(fixture(slope, 0.82, 0.12));
  assert(response.slope + EPS >= priorSlope, `slope normalization regressed at ${slope}`);
  priorSlope = response.slope;
}

const translationStencils = [
  [84, 116, 96, 104, 16],
  [124, 76, 98, 102, 18],
  [62, 138, 111, 89, 22],
  [101, 99, 80, 120, 20],
  [130, 70, 70, 130, 15],
];
for (const [west, east, north, south, spacing] of translationStencils) {
  const a = terrainWindExposureFromNeighbours(west, east, north, south, spacing);
  const b = terrainWindExposureFromNeighbours(west + 700, east + 700, north + 700, south + 700, spacing);
  for (const key of ['slopeDegrees', 'foldGradient', 'aspectDot', 'windward', 'lee']) {
    assert(Math.abs(a[key] - b[key]) < EPS, `translation invariance failed for ${key}`);
  }
  assert.equal(terrainWindSnowSurfaceFabricDigest(a.surfaceFabric), terrainWindSnowSurfaceFabricDigest(b.surfaceFabric));
}

const scaleStencils = [
  [80, 120, 100, 100, 10],
  [60, 140, 100, 100, 20],
  [90, 110, 98, 102, 5],
  [72, 128, 96, 104, 14],
];
for (const [west, east, north, south, spacing] of scaleStencils) {
  const factor = 2;
  const a = terrainWindExposureFromNeighbours(west, east, north, south, spacing);
  const b = terrainWindExposureFromNeighbours(
    100 + (west - 100) * factor,
    100 + (east - 100) * factor,
    100 + (north - 100) * factor,
    100 + (south - 100) * factor,
    spacing * factor,
  );
  assert(Math.abs(a.slopeDegrees - b.slopeDegrees) < EPS);
  assert(Math.abs(a.aspectDot - b.aspectDot) < EPS);
  assert(Math.abs(a.foldGradient - b.foldGradient) < EPS);
  assert(Math.abs(a.windward - b.windward) < EPS);
  assert(Math.abs(a.lee - b.lee) < EPS);
}

const mirrorFixtures = [
  [80, 120, 92, 108, 10],
  [70, 130, 98, 102, 15],
  [86, 114, 80, 120, 12],
  [55, 145, 110, 90, 25],
  [90, 110, 60, 140, 20],
];
for (const stencil of mirrorFixtures) {
  const [west, east, north, south, spacing] = stencil;
  const a = terrainWindExposureFromNeighbours(west, east, north, south, spacing);
  const b = terrainWindExposureFromNeighbours(east, west, south, north, spacing);
  assert(Math.abs(a.slopeDegrees - b.slopeDegrees) < EPS);
  assert(Math.abs(a.aspectDot + b.aspectDot) < 0.08);
  assert(Math.abs(a.windward - b.lee) < 0.20);
  assert(Math.abs(a.lee - b.windward) < 0.20);
  assert(b.surfaceFabric.leePowder >= 0);
  assert(a.surfaceFabric.ridgeCrust >= 0);
}

const familyMatrix = buildTerrainWindSnowSurfaceFamilyMatrix({ directions: 32, aspectMagnitude: 0.84 });
assert.equal(familyMatrix.length, SNOW_RELIEF_FAMILIES.length * 32);
for (const family of SNOW_RELIEF_FAMILIES) {
  const rows = familyMatrix.filter((row) => row.family === family.id);
  assert.equal(rows.length, 32);
  assert(new Set(rows.map((row) => row.digest)).size >= 10, `${family.id} directional collapse`);
  const crossRows = rows.filter((row) => Math.abs(row.aspectDot) < 0.08);
  assert(crossRows.length >= 1, `${family.id} has no neutral probe`);
  for (const row of rows) checkFabric(row.fabric, `family-${family.id}-${row.index}`);
}

const ladder = buildTerrainWindSnowSurfaceProbeLadder({
  slopes: [0, 8, 18, 30, 46, 62, 80],
  folds: [0, 0.025, 0.08, 0.16, 0.24],
  aspects: [-1, -0.7, -0.35, 0, 0.35, 0.7, 1],
});
assert.equal(ladder.length, 7 * 5 * 7);
assert(new Set(ladder.map((row) => row.digest)).size > ladder.length * 0.35);
for (const row of ladder) {
  assert(bounded(row.continuity));
  assert(bounded(row.ridgeCrust));
  assert(bounded(row.leePowder));
  assert(bounded(row.windwardGain, P.minGain, P.maxGain));
  assert(bounded(row.leeGain, P.minGain, P.maxGain));
}

const nearCliff = [52, 58, 66, 72, 84].map((slope) => resolveTerrainWindSnowSurfaceFabric(fixture(slope, -0.92, 0.18)));
for (const response of nearCliff) checkFabric(response, 'near-cliff');
for (let i = 1; i < nearCliff.length; i += 1) {
  assert(nearCliff[i].cliff >= nearCliff[i - 1].cliff - EPS);
  assert(nearCliff[i].leeGain <= nearCliff[i - 1].leeGain + 0.09);
  assert(nearCliff[i].leePowder <= nearCliff[i - 1].leePowder + 0.05);
}

const sheltered = retentions.map((retention) => resolveTerrainWindSnowSurfaceFabric(fixture(22, -0.86, 0.18, retention)));
for (const response of sheltered) checkFabric(response, `retention-${response.leeRetention}`);
assert(sheltered[0].leeRetention === 0);
assert(sheltered.at(-1).leeRetention === 1);
for (let i = 1; i < sheltered.length; i += 1) {
  assert(sheltered[i].leeRetention >= sheltered[i - 1].leeRetention - EPS);
}

const adjustmentCases = [
  { windward: 0, lee: 0, permanentIce: 0, tundra: 0 },
  { windward: 1, lee: 0, permanentIce: 1, tundra: 1 },
  { windward: 0, lee: 1, permanentIce: 1, tundra: 1 },
  { windward: 0.4, lee: 0.8, permanentIce: 0.5, tundra: 0.5, ridgelineExposure: 0.9, shelterPocket: 0.8, snowMobility: 0.7, crustScour: 0.6, packGain: 0.8 },
];
for (const input of adjustmentCases) {
  const a = resolveTerrainWindSnowAdjustment(input);
  const b = resolveTerrainWindSnowAdjustment(input);
  assert.deepEqual(a, b);
  for (const key of ['windwardScour', 'leeDeposit', 'scourMax', 'depositMax', 'scourProfile', 'depositProfile', 'ridgelineExposure', 'shelterPocket', 'snowMobility', 'crustScour', 'packGain']) assert(finite(a[key]));
  assert(bounded(a.windwardScour));
  assert(bounded(a.leeDeposit));
  assert(a.windwardScour <= a.scourMax + EPS);
  assert(a.leeDeposit <= a.depositMax + EPS);
}

const snowInputs = [
  { snowAmount: 0, permanentIce: 0, tundra: 0, slopeDegrees: 2, worldX: 0, worldZ: 0 },
  { snowAmount: 0.2, permanentIce: 0, tundra: 0.3, slopeDegrees: 16, worldX: 120, worldZ: -80 },
  { snowAmount: 0.72, permanentIce: 0.7, tundra: 0.9, windwardScour: 0.8, ridgeExposure: 0.7, slopeDegrees: 34, worldX: -420, worldZ: -710 },
  { snowAmount: 0.82, permanentIce: 1, tundra: 1, leeDeposit: 0.9, concavityHold: 0.95, gentleSlope: 0.9, slopeDegrees: 18, worldX: 350, worldZ: -260 },
];
for (const input of snowInputs) {
  const result = resolveTerrainSnowRelief(input);
  const validation = validateTerrainSnowReliefResult(result);
  assert.equal(validation.ok, true, JSON.stringify(validation));
  assert(Object.isFrozen(result));
  assert.equal(terrainSnowReliefDigest(result), terrainSnowReliefDigest(resolveTerrainSnowRelief(input)));
}
const snowFlat = resolveTerrainSnowRelief(snowInputs[0]);
const snowWind = resolveTerrainSnowRelief(snowInputs[2]);
const snowLee = resolveTerrainSnowRelief(snowInputs[3]);
assert(snowWind.weights.crust >= snowFlat.weights.crust);
assert(snowLee.weights.powder >= snowWind.weights.powder - 0.1);
assert(snowLee.palette.temperatureBias >= snowWind.palette.temperatureBias - 0.1);

const biomeGrid = ['grassland', 'forest', 'tundra', 'desert', 'rock', 'snow'];
const groundContexts = [];
for (const biomeName of biomeGrid) {
  for (const slope of [3, 10, 18, 28, 40]) {
    for (const waterType of [null, 'shore', 'shallow', 'deep']) {
      const aboveSea = waterType === null ? 42 : waterType === 'shore' ? 0 : waterType === 'shallow' ? -2 : -20;
      const context = buildTerrainGroundContext({
        worldX: slope * 3,
        worldY: aboveSea,
        worldZ: -slope,
        heightAboveSeaMeters: aboveSea,
        slopeDegrees: slope,
        biomeName,
        biome: { grass: 0.4, forest: biomeName === 'forest' ? 0.9 : 0.1, tundra: biomeName === 'tundra' ? 0.9 : 0.05, desert: biomeName === 'desert' ? 0.9 : 0.1, rock: biomeName === 'rock' ? 0.9 : 0.2, snow: biomeName === 'snow' ? 0.9 : 0.1 },
        waterType,
        waterDistanceMeters: waterType === null ? 100 : waterType === 'shore' ? 0.5 : waterType === 'shallow' ? 1.5 : 10,
        roadDistanceMeters: 8,
        settlementDistanceMeters: 12,
      });
      const validation = validateTerrainGroundContext(context);
      assert.equal(validation.pass, true, `ground validation ${biomeName}/${slope}/${waterType}`);
      groundContexts.push(context);
    }
  }
}
assert(groundContexts.length === biomeGrid.length * 5 * 4);

for (const context of groundContexts) {
  const placement = resolveTerrainGroundPlacementSafety({
    slopeDegrees: context.slope.degrees,
    heightAboveSeaMeters: context.heightAboveSeaMeters,
    waterDistanceMeters: context.distance.waterMeters,
    roadDistanceMeters: context.distance.roadMeters,
    settlementDistanceMeters: context.distance.settlementMeters,
    biome: context.biome,
  });
  assert(typeof placement.slopeSafe === 'boolean');
  assert(typeof placement.waterSafe === 'boolean');
  assert(typeof placement.buildable === 'boolean');
  assert(typeof placement.walkable === 'boolean');
}

for (const [category, profile] of Object.entries(TERRAIN_GROUND_CONTEXT_PROFILES)) {
  assert(Object.isFrozen(profile), `${category} profile not frozen`);
  for (const context of groundContexts.slice(0, 20)) {
    const a = evaluateTerrainGroundContextAgainstProfile(context, category);
    const b = evaluateTerrainGroundContextAgainstProfile(context, category);
    assert.deepEqual(a, b, `${category} determinism`);
    assert.equal(a.profile.id, category);
    assert(typeof a.accepted === 'boolean');
  }
}

const validGround = buildTerrainGroundContext({
  worldX: 20,
  worldZ: -40,
  heightAboveSeaMeters: 45,
  slopeDegrees: 8,
  biomeName: 'grassland',
  biome: { grass: 0.8, forest: 0.2, rock: 0.05, snow: 0.02 },
  roadDistanceMeters: 10,
  settlementDistanceMeters: 20,
});
const treeQuery = resolveTerrainAgentPlacementQuery(validGround, { category: 'tree', preferWalkable: true });
assert.equal(treeQuery.accepted, true);
assert.equal(treeQuery.reason, 'accepted');
assert(Object.isFrozen(treeQuery));
const steepGround = buildTerrainGroundContext({ heightAboveSeaMeters: 45, slopeDegrees: 60, biomeName: 'rock', biome: { rock: 0.95 }, roadDistanceMeters: 10, settlementDistanceMeters: 20 });
const buildingQuery = resolveTerrainAgentPlacementQuery(steepGround, { category: 'building', preferBuildable: true });
assert.equal(buildingQuery.accepted, false);
assert.notEqual(buildingQuery.reason, 'accepted');
const waterGround = buildTerrainGroundContext({ heightAboveSeaMeters: -12, slopeDegrees: 2, biomeName: 'ocean', waterType: 'deep' });
const vegetationQuery = resolveTerrainAgentPlacementQuery(waterGround, { category: 'vegetation', preferWalkable: true });
assert.equal(vegetationQuery.accepted, false);
assert.equal(vegetationQuery.reason, 'water-depth');

const stressSeeds = [];
for (let i = 0; i < 240; i += 1) {
  stressSeeds.push({
    slopeDegrees: (i * 17) % 91,
    aspectDot: ((i * 29) % 201 - 100) / 100,
    foldGradient: ((i * 13) % 41) / 100,
    leeRetention: ((i * 19) % 101) / 100,
  });
}
for (const [index, input] of stressSeeds.entries()) {
  const a = resolveTerrainWindSnowSurfaceFabric(input);
  const b = resolveTerrainWindSnowSurfaceFabric(input);
  assert.equal(terrainWindSnowSurfaceFabricDigest(a), terrainWindSnowSurfaceFabricDigest(b), `stress digest ${index}`);
  checkFabric(a, `stress-${index}`);
}

const repeated = [];
for (let i = 0; i < 60; i += 1) {
  const input = stressSeeds[i];
  const fabric = resolveTerrainWindSnowSurfaceFabric(input);
  repeated.push(terrainWindSnowSurfaceFabricDigest(fabric));
}
assert.equal(new Set(repeated).size, 60);

const summary = summarizeTerrainWindSnowSurfaceFabric(baseline);
assert.deepEqual(Object.keys(summary).sort(), [
  'continuity', 'crosswindNeutrality', 'leeGain', 'leePowder', 'materialBrightnessBias',
  'materialTemperatureBias', 'ridgeCrust', 'windwardGain',
].sort());
assert(bounded(summary.continuity));
assert(bounded(summary.ridgeCrust));
assert(bounded(summary.leePowder));
assert(bounded(summary.windwardGain, P.minGain, P.maxGain));
assert(bounded(summary.leeGain, P.minGain, P.maxGain));

console.log('[checkTerrainWindSnowContinuityRegression] PASS', JSON.stringify({
  policy: P.id,
  gridRecords: records.length,
  uniqueGridDigests: new Set(records.map((row) => row.digest)).size,
  familyRows: familyMatrix.length,
  ladderRows: ladder.length,
  groundContexts: groundContexts.length,
  stressCases: stressSeeds.length,
  stressUniqueDigests: new Set(repeated).size,
  mirrorCases: mirrorFixtures.length,
  translationCases: translationStencils.length,
  scaleCases: scaleStencils.length,
  authority: {
    height: P.heightAuthorityUnchanged && WIND.heightAuthorityUnchanged && SNOW.heightAuthorityUnchanged && GROUND.heightAuthorityUnchanged,
    hydrology: P.hydrologyAuthorityUnchanged && SNOW.hydrologyAuthorityUnchanged && GROUND.hydrologyAuthorityUnchanged,
    collider: P.colliderAuthorityUnchanged && SNOW.colliderAuthorityUnchanged && GROUND.colliderAuthorityUnchanged,
  },
}));
