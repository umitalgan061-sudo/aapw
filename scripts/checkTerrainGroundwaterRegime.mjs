#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_GROUNDWATER_POLICY,
  TERRAIN_GROUNDWATER_CANONICAL_INVARIANTS,
  normalizeGroundwaterSample,
  normalizedDayPhase,
  groundwaterFieldSignal,
  rechargePotential,
  waterTableProximity,
  capillaryRise,
  seepageFace,
  surfaceSaturation,
  saturationMemory,
  dryingResistance,
  surfaceFilm,
  mineralMobilization,
  puddlePersistence,
  marshEdgeFactor,
  groundwaterStress,
  groundwaterMaterialResponse,
  resolveTerrainGroundwaterState,
  compareTerrainGroundwaterStates,
  terrainGroundwaterSignature,
  validateTerrainGroundwaterState,
  buildGroundwaterCatalog,
  groundwaterTrend,
} from '../src/3d/world/terrainGroundwaterRegime.js';

const BASE = Object.freeze({
  worldX: 120,
  worldZ: -80,
  heightMeters: 42,
  slopeDegrees: 8,
  moisture: 0.52,
  rainfall: 0.56,
  runoff: 0.14,
  soilDepth: 1.2,
  permeability: 0.48,
  waterDistanceMeters: 48,
  groundwaterDepthMeters: 16,
  wetDays: 9,
  dryDays: 4,
  dayOfYear: 145,
  temperatureC: 14,
  drainage: 0.48,
  windExposure: 0.5,
  substrate: 'loam',
  biome: 'temperate',
});

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`[groundwater-regime] PASS: ${name}`);
}
function finite01(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} finite`);
  assert.ok(value >= 0 && value <= 1, `${label} range`);
}
function state(overrides = {}) {
  return resolveTerrainGroundwaterState({ ...BASE, ...overrides });
}

check('policy render-only', () => {
  assert.equal(TERRAIN_GROUNDWATER_POLICY.renderOnly, true);
  assert.equal(TERRAIN_GROUNDWATER_POLICY.deterministic, true);
});
check('canonical invariants are explicit', () => {
  assert.deepEqual(TERRAIN_GROUNDWATER_CANONICAL_INVARIANTS, [
    'canonicalHeightUnchanged',
    'canonicalHydrologyUnchanged',
    'canonicalCoastlineUnchanged',
    'canonicalColliderUnchanged',
    'canonicalVegetationPlacementUnchanged',
    'newGeographyIntroduced:false',
  ]);
});
check('normalization clamps slope', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, slopeDegrees: 900 });
  assert.equal(sample.slopeDegrees, 89);
});
check('normalization clamps rainfall', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, rainfall: 8 });
  assert.equal(sample.rainfall, 1);
});
check('normalization clamps runoff', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, runoff: -8 });
  assert.equal(sample.runoff, 0);
});
check('normalization clamps soil depth', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, soilDepth: 99 });
  assert.equal(sample.soilDepth, 6);
});
check('normalization clamps permeability', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, permeability: -2 });
  assert.equal(sample.permeability, 0);
});
check('normalization clamps water distance', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, waterDistanceMeters: 99999 });
  assert.equal(sample.waterDistanceMeters, 5000);
});
check('normalization clamps groundwater depth', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, groundwaterDepthMeters: -1 });
  assert.equal(sample.groundwaterDepthMeters, 0);
});
check('normalization wraps day negative', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, dayOfYear: -1 });
  assert.equal(sample.dayOfYear, 359);
});
check('normalization wraps day over year', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, dayOfYear: 361 });
  assert.equal(sample.dayOfYear, 1);
});
check('normalization stores wind exposure', () => {
  const sample = normalizeGroundwaterSample({ ...BASE, windExposure: 0.91 });
  assert.equal(sample.windExposure, 0.91);
});
check('normalization safely defaults non numeric values', () => {
  const sample = normalizeGroundwaterSample({ rainfall: 'bad', slopeDegrees: null, soilDepth: 'bad' });
  assert.equal(sample.rainfall, 0.5);
  assert.equal(sample.slopeDegrees, 0);
  assert.equal(sample.soilDepth, 0.5);
});

for (const day of [0, 1, 29, 30, 59, 60, 89, 90, 119, 120, 149, 150, 179, 180, 209, 210, 239, 240, 269, 270, 299, 300, 329, 330, 359]) {
  check(`day phase ${day}`, () => {
    const phase = normalizedDayPhase(day);
    assert.equal(phase.day, day);
    assert.equal(phase.phase, day / 360);
    finite01(phase.wetSeason, 'wetSeason');
    finite01(phase.coldSeason, 'coldSeason');
  });
}

for (const point of [
  [0, 0],
  [1, 1],
  [-1, -1],
  [250, -430],
  [-970, 610],
  [4100, -5200],
  [-7200, 8400],
]) {
  check(`field signal ${point.join(',')}`, () => {
    const field = groundwaterFieldSignal(point[0], point[1]);
    for (const key of ['regional', 'local', 'capillary', 'seepage', 'contour', 'combined']) finite01(field[key], key);
  });
}

check('field determinism', () => {
  assert.deepEqual(groundwaterFieldSignal(120, -80), groundwaterFieldSignal(120, -80));
});
check('field changes with location', () => {
  assert.notDeepEqual(groundwaterFieldSignal(120, -80), groundwaterFieldSignal(121, -80));
});
check('recharge bounded baseline', () => finite01(rechargePotential(BASE), 'recharge'));
check('water table bounded baseline', () => finite01(waterTableProximity(BASE), 'waterTable'));
check('capillary bounded baseline', () => finite01(capillaryRise(BASE), 'capillary'));
check('seepage bounded baseline', () => finite01(seepageFace(BASE), 'seepage'));
check('saturation bounded baseline', () => finite01(surfaceSaturation(BASE), 'saturation'));
check('memory bounded baseline', () => finite01(saturationMemory(BASE), 'memory'));
check('drying bounded baseline', () => finite01(dryingResistance(BASE), 'drying'));
check('film bounded baseline', () => finite01(surfaceFilm(BASE), 'film'));
check('mineral bounded baseline', () => { const value = mineralMobilization(BASE); finite01(value.fineTransport, 'fineTransport'); finite01(value.saltRing, 'saltRing'); finite01(value.total, 'mineralTotal'); });
check('puddle bounded baseline', () => finite01(puddlePersistence(BASE), 'puddle'));
check('marsh bounded baseline', () => finite01(marshEdgeFactor(BASE), 'marsh'));
check('stress bounded baseline', () => { const value = groundwaterStress(BASE); finite01(value.saturationStress, 'saturationStress'); finite01(value.freezeStress, 'freezeStress'); finite01(value.droughtStress, 'droughtStress'); finite01(value.total, 'stress'); });
check('material response bounded baseline', () => { const value = groundwaterMaterialResponse({ state: state(), baseColor: { r: 0.4, g: 0.35, b: 0.28 }, baseRoughness: 0.86 }); finite01(value.color.r, 'material r'); finite01(value.color.g, 'material g'); finite01(value.color.b, 'material b'); finite01(value.roughness, 'material roughness'); finite01(value.normalStrength, 'material normal'); finite01(value.wetness, 'material wetness'); });

const depthCases = [0, 1, 3, 7, 12, 18, 24, 32, 40, 55, 80, 120, 250, 500, 1000, 2500, 5000];
for (const depth of depthCases) {
  check(`groundwater depth ${depth}`, () => {
    const value = state({ groundwaterDepthMeters: depth });
    finite01(value.waterTableProximity, `proximity ${depth}`);
    finite01(value.capillaryRise, `capillary ${depth}`);
    finite01(value.surfaceSaturation, `saturation ${depth}`);
    finite01(value.surfaceFilm, `film ${depth}`);
  });
}

for (const slope of [0, 0.5, 1, 2, 4, 8, 12, 16, 20, 24, 31, 38, 44, 52, 64, 78, 89]) {
  check(`slope envelope ${slope}`, () => {
    const value = state({ slopeDegrees: slope });
    for (const key of ['rechargePotential', 'waterTableProximity', 'capillaryRise', 'seepageFace', 'surfaceSaturation', 'saturationMemory', 'dryingResistance', 'surfaceFilm', 'puddlePersistence', 'marshEdgeFactor']) finite01(value[key], `${key} slope ${slope}`);
  });
}

for (const moisture of [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95, 1]) {
  check(`moisture envelope ${moisture}`, () => {
    const value = state({ moisture });
    finite01(value.capillaryRise, `capillary moisture ${moisture}`);
    finite01(value.dryingResistance, `drying moisture ${moisture}`);
    finite01(value.surfaceFilm, `film moisture ${moisture}`);
  });
}

for (const rainfall of [0, 0.05, 0.15, 0.25, 0.4, 0.55, 0.7, 0.85, 0.95, 1]) {
  check(`rainfall envelope ${rainfall}`, () => {
    const value = state({ rainfall });
    finite01(value.rechargePotential, `recharge rainfall ${rainfall}`);
    finite01(value.surfaceSaturation, `saturation rainfall ${rainfall}`);
  });
}

for (const drainage of [0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1]) {
  check(`drainage envelope ${drainage}`, () => {
    const value = state({ drainage });
    finite01(value.puddlePersistence, `puddle drainage ${drainage}`);
    finite01(value.rechargePotential, `recharge drainage ${drainage}`);
  });
}

for (const temperature of [-40, -25, -12, -8, -2, 0, 4, 8, 12, 18, 24, 31, 38, 46, 55]) {
  check(`temperature envelope ${temperature}`, () => {
    const value = state({ temperatureC: temperature });
    const stress = value.stress;
    finite01(stress.freezeStress, `freeze ${temperature}`);
    finite01(stress.droughtStress, `drought ${temperature}`);
    finite01(value.surfaceFilm, `film ${temperature}`);
  });
}

for (const windExposure of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
  check(`wind exposure ${windExposure}`, () => {
    const value = state({ windExposure });
    finite01(value.dryingResistance, `drying wind ${windExposure}`);
  });
}

for (const wetDays of [0, 1, 2, 4, 7, 14, 21, 28, 45, 90, 180, 365]) {
  check(`wet memory ${wetDays}`, () => finite01(state({ wetDays }).saturationMemory, `memory wet ${wetDays}`));
}
for (const dryDays of [0, 1, 2, 4, 7, 14, 21, 42, 60, 90, 180, 365]) {
  check(`dry memory ${dryDays}`, () => finite01(state({ dryDays }).saturationMemory, `memory dry ${dryDays}`));
}

const biomeNames = ['temperate','mediterranean','alpine','boreal','steppe','humid','monsoon','coastal'];
for (const biome of biomeNames) {
  check(`biome ${biome}`, () => {
    const value = state({ biome });
    assert.equal(value.sample.biome, biome);
    assert.equal(validateTerrainGroundwaterState(value).ok, true);
  });
}

const substrateNames = ['loam','clay','sand','gravel','peat','marl','shale','limestone'];
for (const substrate of substrateNames) {
  check(`substrate ${substrate}`, () => {
    const value = state({ substrate });
    assert.equal(value.sample.substrate, substrate);
    assert.equal(validateTerrainGroundwaterState(value).ok, true);
  });
}

check('signature is compact and stable', () => {
  const signature = terrainGroundwaterSignature(BASE);
  assert.equal(signature.policyId, TERRAIN_GROUNDWATER_POLICY.id);
  assert.equal(Object.keys(signature).length, 12);
  assert.deepEqual(signature, terrainGroundwaterSignature(BASE));
});
check('state validation passes baseline', () => assert.equal(validateTerrainGroundwaterState(state()).ok, true));
check('state comparison baseline equals zero', () => { const delta = compareTerrainGroundwaterStates(BASE, BASE); for (const value of Object.values(delta)) assert.equal(value, 0); });
check('trend baseline equals zero', () => { const trend = groundwaterTrend(BASE, BASE); for (const value of Object.values(trend)) assert.equal(value, 0); });
check('catalog has expected deterministic size', () => { const catalog = buildGroundwaterCatalog({ dayStep: 30, origins: [{ worldX: 0, worldZ: 0 }] }); assert.equal(catalog.length, 12); });
check('catalog deterministic', () => { const a = buildGroundwaterCatalog({ dayStep: 30, origins: [{ worldX: 0, worldZ: 0 }] }); const b = buildGroundwaterCatalog({ dayStep: 30, origins: [{ worldX: 0, worldZ: 0 }] }); assert.deepEqual(a, b); });
check('immutability policy', () => { assert.throws(() => { TERRAIN_GROUNDWATER_POLICY.id = 'mutated'; }, TypeError); });
check('state objects frozen', () => { const value = state(); assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.sample), true); assert.equal(Object.isFrozen(value.field), true); });
check('base state does not mutate input', () => { const input = { ...BASE }; resolveTerrainGroundwaterState(input); assert.deepEqual(input, BASE); });

console.log(`[groundwater-regime] PASS: ${checks} checks`);
