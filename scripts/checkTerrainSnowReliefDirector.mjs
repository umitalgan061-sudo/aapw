#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_SNOW_RELIEF_DIRECTOR_POLICY as P,
  SNOW_RELIEF_MATERIAL_FAMILIES,
  applyTerrainSnowReliefToColor,
  buildTerrainSnowReliefField,
  reliefMacroNoise,
  reliefMicroBreakup,
  resolveTerrainSnowRelief,
  resolveTerrainSnowReliefSafely,
  summarizeTerrainSnowReliefField,
  terrainSnowReliefDigest,
  validateTerrainSnowReliefResult,
} from '../src/3d/world/terrainSnowReliefDirector.js';

const finite = (value) => Number.isFinite(value);
const bounded = (value) => finite(value) && value >= 0 && value <= 1;
const allWeights = ['visible','packed','accumulated','firn','crust','powder','glacial','rock','scree'];
const assertValid = (result, label) => {
  const validation = validateTerrainSnowReliefResult(result);
  assert.equal(validation.ok, true, `${label}: invalid ${JSON.stringify(validation)}`);
  for (const key of allWeights) assert(bounded(result.weights[key]), `${label}: ${key} out of bounds`);
  assert(finite(result.palette.temperatureBias), `${label}: temperature bias non-finite`);
  assert(finite(result.palette.brightnessBias), `${label}: brightness bias non-finite`);
  assert.equal(result.heightAuthorityUnchanged, true);
  assert.equal(result.hydrologyAuthorityUnchanged, true);
  assert.equal(result.colliderAuthorityUnchanged, true);
};

assert.equal(P.renderOnly, true);
assert.equal(P.heightAuthorityUnchanged, true);
assert.equal(P.hydrologyAuthorityUnchanged, true);
assert.equal(P.colliderAuthorityUnchanged, true);
assert.equal(P.worldGridOverlay, false);
assert.equal(P.periodicStriping, false);
assert(P.textureRepeatMeters > 0);
assert(P.macroScalesMeters.length >= 5);
assert(Object.isFrozen(P));
assert(Object.isFrozen(SNOW_RELIEF_MATERIAL_FAMILIES));

const flat = resolveTerrainSnowRelief({ snowAmount: 0.3, permanentIce: 0, tundra: 0, slopeDegrees: 2, worldX: 0, worldZ: 0 });
assertValid(flat, 'flat');
assert(flat.weights.rock < 0.5);

const windward = resolveTerrainSnowRelief({
  snowAmount: 0.86,
  permanentIce: 1,
  tundra: 1,
  windwardScour: 0.95,
  leeDeposit: 0,
  ridgeExposure: 0.92,
  concavityHold: 0.05,
  gentleSlope: 0.22,
  slopeDegrees: 34,
  heightAboveSeaMeters: 320,
  worldX: -430,
  worldZ: -720,
  rockWeight: 0.34,
  screeWeight: 0.25,
  moisture: 0.44,
});
assertValid(windward, 'windward');
assert(windward.weights.crust > windward.weights.powder);
assert(windward.weights.packed > 0.12);
assert(windward.palette.temperatureBias < 0);
assert.equal(windward.dominantFamily, 'snow-crust');

const lee = resolveTerrainSnowRelief({
  snowAmount: 0.86,
  permanentIce: 1,
  tundra: 1,
  windwardScour: 0,
  leeDeposit: 0.92,
  ridgeExposure: 0.05,
  concavityHold: 0.88,
  gentleSlope: 0.92,
  slopeDegrees: 18,
  heightAboveSeaMeters: 180,
  worldX: 280,
  worldZ: -260,
  rockWeight: 0.08,
  screeWeight: 0.04,
  moisture: 0.73,
});
assertValid(lee, 'lee');
assert(lee.weights.powder > lee.weights.crust);
assert(lee.weights.accumulated > windward.weights.accumulated);
assert(lee.palette.temperatureBias > windward.palette.temperatureBias);
assert.equal(lee.dominantFamily, 'snow-powder');

const cliff = resolveTerrainSnowRelief({ snowAmount: 0.95, permanentIce: 1, tundra: 1, slopeDegrees: 78, ridgeExposure: 0.8, rockWeight: 0.6, screeWeight: 0.55, worldX: 30, worldZ: -10 });
assertValid(cliff, 'cliff');
assert(cliff.weights.rock > flat.weights.rock);
assert(cliff.weights.scree > flat.weights.scree);
assert(cliff.terrain.cliffSuppression > 0.95);

const shore = resolveTerrainSnowRelief({ snowAmount: 0.7, permanentIce: 1, tundra: 0.7, shorelineDistanceMeters: 0.2, slopeDegrees: 8, leeDeposit: 0.3, concavityHold: 0.2, worldX: 40, worldZ: -500 });
assertValid(shore, 'shore');
assert(shore.terrain.shoreSuppression > 0.5);

const safe = resolveTerrainSnowReliefSafely({ snowAmount: NaN, slopeDegrees: Infinity, worldX: 'bad', worldZ: null });
assertValid(safe, 'safe');
assert.equal(safe.fallback, false);
const safeNull = resolveTerrainSnowReliefSafely(null);
assertValid(safeNull, 'safe-null');

const digestA = terrainSnowReliefDigest(lee);
const digestB = terrainSnowReliefDigest(resolveTerrainSnowRelief({
  snowAmount: 0.86, permanentIce: 1, tundra: 1, leeDeposit: 0.92, ridgeExposure: 0.05,
  concavityHold: 0.88, gentleSlope: 0.92, slopeDegrees: 18, heightAboveSeaMeters: 180,
  worldX: 280, worldZ: -260, rockWeight: 0.08, screeWeight: 0.04, moisture: 0.73,
}));
assert.equal(digestA, digestB);
assert.equal(digestA.split('|').length, 14);

const firstNoise = reliefMacroNoise(100, -200);
const secondNoise = reliefMacroNoise(100, -200);
assert.equal(firstNoise, secondNoise);
assert(firstNoise >= 0 && firstNoise <= 1);
const micro = reliefMicroBreakup(100, -200);
for (const value of Object.values(micro)) if (typeof value === 'number') assert(finite(value));
assert(micro.breakup >= 0 && micro.breakup <= 1);

const field = buildTerrainSnowReliefField({
  xMin: -1200, xMax: 1200, zMin: -900, zMax: 900, columns: 17, rows: 13,
  sample: ({ worldX, worldZ }) => ({
    snowAmount: 0.18 + 0.70 * Math.max(0, Math.min(1, (-worldZ + 900) / 1800)),
    permanentIce: worldZ < -250 ? 1 : 0,
    tundra: worldZ < 50 ? 0.8 : 0.1,
    windwardScour: Math.max(0, Math.sin(worldX / 290) * 0.5 + 0.5),
    leeDeposit: Math.max(0, Math.cos(worldX / 310) * 0.5 + 0.5),
    ridgeExposure: Math.max(0, Math.sin(worldZ / 170) * 0.5 + 0.5),
    concavityHold: Math.max(0, Math.cos((worldX + worldZ) / 340) * 0.5 + 0.5),
    gentleSlope: 0.25 + 0.7 * Math.max(0, Math.min(1, Math.cos(worldX / 440) * 0.5 + 0.5)),
    slopeDegrees: 8 + 38 * Math.max(0, Math.min(1, Math.sin(worldZ / 260) * 0.5 + 0.5)),
    heightAboveSeaMeters: 40 + 300 * Math.max(0, Math.min(1, (-worldZ + 900) / 1800)),
    rockWeight: Math.max(0, Math.min(1, Math.sin(worldX / 190) * 0.5 + 0.5)),
    screeWeight: Math.max(0, Math.min(1, Math.cos(worldZ / 210) * 0.5 + 0.5)),
    moisture: Math.max(0, Math.min(1, Math.cos((worldX - worldZ) / 510) * 0.5 + 0.5)),
  }),
});
assert.equal(field.length, 17 * 13);
for (const row of field) assertValid(row.result, `field-${row.row}-${row.column}`);
const summary = summarizeTerrainSnowReliefField(field);
assert.equal(summary.count, field.length);
assert(summary.uniqueDigests > 50);
assert(summary.dominantFamilies.length >= 2);
assert(summary.maxSnow >= summary.minSnow);

const changedColor = applyTerrainSnowReliefToColor({ r: 0.82, g: 0.84, b: 0.88 }, lee);
assert(bounded(changedColor.r) && bounded(changedColor.g) && bounded(changedColor.b));
assert.equal(changedColor.dominantFamily, 'snow-powder');

console.log('[checkTerrainSnowReliefDirector] PASS', JSON.stringify({
  policy: P.id,
  windward: { digest: terrainSnowReliefDigest(windward), family: windward.dominantFamily },
  lee: { digest: terrainSnowReliefDigest(lee), family: lee.dominantFamily },
  cliff: { rock: cliff.weights.rock, scree: cliff.weights.scree },
  field: summary,
}));
