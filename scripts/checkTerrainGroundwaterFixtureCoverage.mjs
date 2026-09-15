#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_FIXTURES } from '../src/3d/world/terrainGroundwaterFixturesLowland.js';
import { FIXTURES as UPLAND_FIXTURES } from '../src/3d/world/terrainGroundwaterFixturesUpland.js';
import { resolveTerrainGroundwaterState } from '../src/3d/world/terrainGroundwaterRegime.js';

const all = [...TERRAIN_GROUNDWATER_FIXTURES, ...UPLAND_FIXTURES];
let checks = 0;
function check(name, fn) { fn(); checks += 1; console.log(`[groundwater-coverage] PASS: ${name}`); }
function bounded(v, label) { assert.ok(Number.isFinite(v), `${label} finite`); assert.ok(v >= 0 && v <= 1, `${label} bounded`); }

check('combined fixture corpus is non-empty', () => assert.ok(all.length >= 40));
check('fixture identifiers are unique', () => { const ids = all.map((fixture) => fixture.id); assert.equal(new Set(ids).size, ids.length); });
check('world coordinates are numeric', () => { for (const fixture of all) { assert.ok(Number.isFinite(fixture.worldX)); assert.ok(Number.isFinite(fixture.worldZ)); } });
check('terrain heights span multiple bands', () => { const heights = new Set(all.map((fixture) => fixture.heightMeters)); assert.ok(heights.size >= 8); });
check('slopes span flat to steep', () => { const slopes = all.map((fixture) => fixture.slopeDegrees); assert.ok(Math.min(...slopes) <= 1); assert.ok(Math.max(...slopes) >= 40); });
check('water distances span near and far', () => { const distances = all.map((fixture) => fixture.waterDistanceMeters); assert.ok(Math.min(...distances) <= 5); assert.ok(Math.max(...distances) >= 200); });
check('groundwater depths span shallow and deep', () => { const depths = all.map((fixture) => fixture.groundwaterDepthMeters); assert.ok(Math.min(...depths) <= 3); assert.ok(Math.max(...depths) >= 90); });
check('substrate diversity is eight', () => { assert.equal(new Set(all.map((fixture) => fixture.substrate)).size, 8); });
check('biome diversity is eight', () => { assert.equal(new Set(all.map((fixture) => fixture.biome)).size, 8); });
check('seasonal coverage spans the year', () => { const days = all.map((fixture) => fixture.dayOfYear); assert.ok(Math.min(...days) === 0); assert.ok(Math.max(...days) >= 340); });

for (const fixture of all) {
  check(`coverage resolves ${fixture.id}`, () => {
    const state = resolveTerrainGroundwaterState(fixture);
    for (const key of ['rechargePotential','waterTableProximity','capillaryRise','seepageFace','surfaceSaturation','saturationMemory','dryingResistance','surfaceFilm','puddlePersistence','marshEdgeFactor']) bounded(state[key], `${fixture.id}:${key}`);
  });
}

for (const substrate of [...new Set(all.map((fixture) => fixture.substrate))]) {
  check(`substrate coverage ${substrate}`, () => {
    const subset = all.filter((fixture) => fixture.substrate === substrate);
    assert.ok(subset.length >= 4);
  });
}
for (const biome of [...new Set(all.map((fixture) => fixture.biome))]) {
  check(`biome coverage ${biome}`, () => {
    const subset = all.filter((fixture) => fixture.biome === biome);
    assert.ok(subset.length >= 4);
  });
}

console.log(`[groundwater-coverage] PASS: ${checks} checks across ${all.length} fixtures`);
