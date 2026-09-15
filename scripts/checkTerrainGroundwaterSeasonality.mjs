#!/usr/bin/env node
import assert from 'node:assert/strict';
import { normalizedDayPhase, resolveTerrainGroundwaterState, terrainGroundwaterSignature } from '../src/3d/world/terrainGroundwaterRegime.js';
import { seasonForDay, seasonInput, TERRAIN_GROUNDWATER_PRESETS, presetInput, resolveGroundwaterPreset } from '../src/3d/world/terrainGroundwaterPresets.js';

const BASE = Object.freeze({
  worldX: -150,
  worldZ: 230,
  heightMeters: 38,
  slopeDegrees: 7,
  moisture: .52,
  rainfall: .58,
  runoff: .17,
  soilDepth: 1.25,
  permeability: .46,
  waterDistanceMeters: 44,
  groundwaterDepthMeters: 15,
  wetDays: 8,
  dryDays: 5,
  temperatureC: 13,
  drainage: .44,
  windExposure: .36,
  substrate: 'loam',
  biome: 'temperate',
});

let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-seasonality] PASS: ${name}`); }
function bounded(value, label) { assert.ok(Number.isFinite(value), `${label} finite`); assert.ok(value >= 0 && value <= 1, `${label} bounded`); }
function sample(day, overrides = {}) { return resolveTerrainGroundwaterState({ ...BASE, ...overrides, dayOfYear: day }); }

const dayBoundaries = [0, 29, 30, 59, 60, 89, 90, 119, 120, 149, 150, 179, 180, 209, 210, 239, 240, 269, 270, 299, 300, 329, 330, 359];
for (const day of dayBoundaries) {
  check(`season lookup ${day}`, () => {
    const season = seasonForDay(day);
    const input = seasonInput(day);
    assert.equal(input.dayOfYear, day);
    assert.equal(typeof season.id, 'string');
    assert.ok(season.dayStart <= day && season.dayEnd >= day);
  });
}

for (let day = 0; day < 360; day += 5) {
  check(`phase bounded ${day}`, () => {
    const phase = normalizedDayPhase(day);
    bounded(phase.wetSeason, `wetSeason ${day}`);
    bounded(phase.coldSeason, `coldSeason ${day}`);
  });
}

check('phase wraps 360 to zero', () => {
  assert.deepEqual(normalizedDayPhase(0), normalizedDayPhase(360));
});
check('phase wraps negative day', () => {
  assert.deepEqual(normalizedDayPhase(-1), normalizedDayPhase(359));
});

const days = Array.from({ length: 36 }, (_, i) => i * 10);
for (const day of days) {
  check(`state bounds day ${day}`, () => {
    const state = sample(day);
    for (const key of ['rechargePotential','waterTableProximity','capillaryRise','seepageFace','surfaceSaturation','saturationMemory','dryingResistance','surfaceFilm','puddlePersistence','marshEdgeFactor']) bounded(state[key], `${key} day ${day}`);
    bounded(state.stress.total, `stress day ${day}`);
  });
}

const wetSeasonDays = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
for (const day of wetSeasonDays) {
  check(`deterministic signature day ${day}`, () => {
    const a = terrainGroundwaterSignature({ ...BASE, dayOfYear: day });
    const b = terrainGroundwaterSignature({ ...BASE, dayOfYear: day });
    assert.deepEqual(a, b);
  });
}

check('wet history increases retention in baseline regime', () => {
  const dry = sample(120, { wetDays: 0, dryDays: 0 });
  const wet = sample(120, { wetDays: 28, dryDays: 0 });
  assert.ok(wet.saturationMemory >= dry.saturationMemory - 1e-6);
});
check('dry history reduces retention in baseline regime', () => {
  const recent = sample(120, { wetDays: 18, dryDays: 0 });
  const recovered = sample(120, { wetDays: 18, dryDays: 90 });
  assert.ok(recovered.saturationMemory <= recent.saturationMemory + 1e-6);
});
check('rainfall has non-negative recharge response', () => {
  const low = sample(90, { rainfall: .1 });
  const high = sample(90, { rainfall: .9 });
  assert.ok(high.rechargePotential >= low.rechargePotential - 1e-6);
});
check('runoff has non-negative saturation response', () => {
  const low = sample(90, { runoff: 0 });
  const high = sample(90, { runoff: 1 });
  assert.ok(high.surfaceSaturation >= low.surfaceSaturation - 1e-6);
});
check('shallower groundwater does not reduce proximity', () => {
  const shallow = sample(90, { groundwaterDepthMeters: 3 });
  const deep = sample(90, { groundwaterDepthMeters: 80 });
  assert.ok(shallow.waterTableProximity >= deep.waterTableProximity - 1e-6);
});
check('nearby surface water does not reduce proximity', () => {
  const near = sample(90, { waterDistanceMeters: 5 });
  const far = sample(90, { waterDistanceMeters: 300 });
  assert.ok(near.waterTableProximity >= far.waterTableProximity - 1e-6);
});
check('flat terrain supports film more than extreme slope', () => {
  const flat = sample(120, { slopeDegrees: 1 });
  const steep = sample(120, { slopeDegrees: 60 });
  assert.ok(flat.surfaceFilm >= steep.surfaceFilm - 1e-6);
});
check('wet soil is not more drying resistant than dry-demand case', () => {
  const damp = sample(120, { moisture: .9 });
  const dry = sample(120, { moisture: .1 });
  assert.ok(dry.capillaryRise >= damp.capillaryRise - 1e-6);
});

const presetDays = [0, 45, 90, 135, 180, 225, 270, 315];
for (const preset of TERRAIN_GROUNDWATER_PRESETS) {
  for (const day of presetDays) {
    check(`preset seasonal ${preset.id} day ${day}`, () => {
      const input = presetInput(preset.id, { dayOfYear: day });
      const state = resolveGroundwaterPreset(preset.id, { dayOfYear: day });
      assert.equal(input.dayOfYear, day);
      assert.equal(state.policyId.length > 0, true);
      bounded(state.surfaceFilm, `${preset.id} film`);
      bounded(state.surfaceSaturation, `${preset.id} saturation`);
    });
  }
}

const seasonalPairs = [
  [0, 180],
  [30, 210],
  [60, 240],
  [90, 270],
  [120, 300],
  [150, 330],
];
for (const [a, b] of seasonalPairs) {
  check(`seasonal pair ${a}-${b} produces finite trend`, () => {
    const first = sample(a);
    const second = sample(b);
    bounded(Math.abs(second.surfaceFilm - first.surfaceFilm), 'film delta');
    bounded(Math.abs(second.surfaceSaturation - first.surfaceSaturation), 'saturation delta');
    assert.notEqual(terrainGroundwaterSignature({ ...BASE, dayOfYear: a }).policyId, undefined);
  });
}

check('all presets preserve supplied override day', () => {
  for (const preset of TERRAIN_GROUNDWATER_PRESETS) {
    const input = presetInput(preset.id, { dayOfYear: 227, windExposure: .77 });
    assert.equal(input.dayOfYear, 227);
    assert.equal(input.windExposure, .77);
  }
});

check('season inputs remain bounded', () => {
  for (const day of dayBoundaries) {
    const input = seasonInput(day);
    bounded(input.rainfall, `season rainfall ${day}`);
    assert.ok(Number.isFinite(input.temperatureC));
  }
});

check('preset ids are unique', () => {
  const ids = TERRAIN_GROUNDWATER_PRESETS.map((preset) => preset.id);
  assert.equal(new Set(ids).size, ids.length);
});
check('preset source policy is stable', () => {
  for (const preset of TERRAIN_GROUNDWATER_PRESETS) assert.ok(preset.sourcePolicyId.includes('terrain-groundwater-regime'));
});

console.log(`[groundwater-seasonality] PASS: ${checks} checks`);
