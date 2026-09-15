#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_PRESETS, presetInput, resolveGroundwaterPreset, seasonForDay, seasonInput, sampleAllPresetSignatures, interpolatePreset, groundwaterPresetMatrix, rankGroundwaterPresets, compareSubstratesAtLocation } from '../src/3d/world/terrainGroundwaterPresets.js';

let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-presets] PASS: ${name}`); }
function bounded(value, label) { assert.ok(Number.isFinite(value), `${label} finite`); assert.ok(value >= 0 && value <= 1, `${label} bounded`); }

check('preset count is 24', () => assert.equal(TERRAIN_GROUNDWATER_PRESETS.length, 24));
check('preset ids are unique', () => { const ids = TERRAIN_GROUNDWATER_PRESETS.map((row) => row.id); assert.equal(new Set(ids).size, 24); });
check('preset catalog is frozen', () => assert.equal(Object.isFrozen(TERRAIN_GROUNDWATER_PRESETS), true));
check('all presets are frozen', () => { for (const row of TERRAIN_GROUNDWATER_PRESETS) assert.equal(Object.isFrozen(row), true); });

for (const preset of TERRAIN_GROUNDWATER_PRESETS) {
  check(`preset ${preset.id} normalizes`, () => {
    const input = presetInput(preset.id, { windExposure: .73 });
    assert.equal(input.windExposure, .73);
    assert.equal(input.biome, preset.biome);
    assert.equal(input.substrate, preset.substrate);
  });
  check(`preset ${preset.id} resolves`, () => {
    const state = resolveGroundwaterPreset(preset.id, { dayOfYear: 140 });
    for (const key of ['rechargePotential','waterTableProximity','capillaryRise','seepageFace','surfaceSaturation','saturationMemory','dryingResistance','surfaceFilm','puddlePersistence','marshEdgeFactor']) bounded(state[key], `${preset.id} ${key}`);
  });
}

for (const day of [0, 29, 30, 59, 60, 89, 90, 119, 120, 149, 150, 179, 180, 209, 210, 239, 240, 269, 270, 299, 300, 329, 330, 359]) {
  check(`season boundary ${day}`, () => { const season = seasonForDay(day); const input = seasonInput(day); assert.equal(input.dayOfYear, day); assert.ok(day >= season.dayStart && day <= season.dayEnd); bounded(input.rainfall, 'season rainfall'); });
}

check('signature catalog size is stable', () => { const catalog = sampleAllPresetSignatures(180); assert.equal(catalog.length, 24); assert.equal(catalog, sampleAllPresetSignatures(180)); });
check('preset matrix size at 30-day step', () => { const matrix = groundwaterPresetMatrix({ dayStep: 30, origins: [{ worldX: 0, worldZ: 0 }] }); assert.equal(matrix.length, 288); });
check('preset matrix is deterministic', () => { const a = groundwaterPresetMatrix({ dayStep: 45, origins: [{ worldX: 0, worldZ: 0 }] }); const b = groundwaterPresetMatrix({ dayStep: 45, origins: [{ worldX: 0, worldZ: 0 }] }); assert.deepEqual(a, b); });
check('ranking returns every preset', () => { const rows = rankGroundwaterPresets({ metric: 'surfaceFilm', dayOfYear: 150 }); assert.equal(rows.length, 24); assert.equal(new Set(rows.map((row) => row.id)).size, 24); });
check('ranking is descending', () => { const rows = rankGroundwaterPresets({ metric: 'surfaceSaturation', dayOfYear: 150 }); for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].value >= rows[i].value - 1e-12); });
check('unsupported ranking metric is rejected', () => assert.throws(() => rankGroundwaterPresets({ metric: 'not-real' }), RangeError));
check('substrate comparison covers eight classes', () => { const rows = compareSubstratesAtLocation({ worldX: 20, worldZ: -30, dayOfYear: 150 }); assert.equal(rows.length, 8); assert.equal(new Set(rows.map((row) => row.substrate)).size, 8); });
check('substrate comparison bounded', () => { const rows = compareSubstratesAtLocation(); for (const row of rows) { bounded(row.permeability, row.substrate); bounded(row.drainage, row.substrate); bounded(row.film, `${row.substrate} film`); bounded(row.saturation, `${row.substrate} saturation`); bounded(row.capillary, `${row.substrate} capillary`); } });

const pairs = [['temperate-loam-valley','humid-peat-flat'],['temperate-clay-basin','steppe-clay-pan'],['alpine-gravel-fan','coastal-sand-swale'],['mediterranean-marl-bench','coastal-limestone-runoff'],['monsoon-clay-fan','boreal-gravel-outwash']];
for (const [a,b] of pairs) {
  for (const mix of [0,.25,.5,.75,1]) {
    check(`interpolation ${a}/${b}/${mix}`, () => {
      const input = interpolatePreset(a, b, mix, { worldX: 100, worldZ: -200, dayOfYear: 205 });
      const state = resolveGroundwaterPreset(a, { worldX: 100, worldZ: -200, dayOfYear: 205 });
      assert.ok(input.worldX === 100 && input.worldZ === -200);
      assert.ok(state.policyId.length > 0);
      assert.ok(input.permeability >= 0 && input.permeability <= 1);
    });
  }
}

console.log(`[groundwater-presets] PASS: ${checks} checks`);
