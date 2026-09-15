#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTerrainGroundwaterState, validateTerrainGroundwaterState } from '../src/3d/world/terrainGroundwaterRegime.js';

const checks = [];
const check = (name, fn) => { fn(); checks.push(name); console.log(`[groundwater-boundaries] PASS: ${name}`); };
const state = (overrides) => resolveTerrainGroundwaterState({ worldX: 120, worldZ: -80, heightMeters: 42, slopeDegrees: 8, moisture: .52, rainfall: .56, runoff: .14, soilDepth: 1.2, permeability: .48, waterDistanceMeters: 48, groundwaterDepthMeters: 16, wetDays: 9, dryDays: 4, dayOfYear: 145, temperatureC: 14, drainage: .48, substrate: 'loam', biome: 'temperate', ...overrides });

check('baseline valid',()=>{const s=state({});assert.equal(validateTerrainGroundwaterState(s).ok,true);});
check('height low valid',()=>{const s=state({heightMeters:-12});assert.equal(validateTerrainGroundwaterState(s).ok,true);});
check('height high valid',()=>{const s=state({heightMeters:520});assert.equal(validateTerrainGroundwaterState(s).ok,true);});
check('slope zero bounded',()=>{const s=state({slopeDegrees:0});assert.ok(s.surfaceFilm>=0&&s.surfaceFilm<=1);});
check('slope high bounded',()=>{const s=state({slopeDegrees:89});assert.ok(s.surfaceFilm>=0&&s.surfaceFilm<=1);});
check('rain zero bounded',()=>{const s=state({rainfall:0});assert.ok(s.rechargePotential>=0&&s.rechargePotential<=1);});
check('rain one bounded',()=>{const s=state({rainfall:1});assert.ok(s.rechargePotential>=0&&s.rechargePotential<=1);});
check('runoff zero bounded',()=>{const s=state({runoff:0});assert.ok(s.surfaceSaturation>=0&&s.surfaceSaturation<=1);});
check('runoff one bounded',()=>{const s=state({runoff:1});assert.ok(s.surfaceSaturation>=0&&s.surfaceSaturation<=1);});
check('moisture zero bounded',()=>{const s=state({moisture:0});assert.ok(s.capillaryRise>=0&&s.capillaryRise<=1);});
check('moisture one bounded',()=>{const s=state({moisture:1});assert.ok(s.capillaryRise>=0&&s.capillaryRise<=1);});
check('permeability zero bounded',()=>{const s=state({permeability:0});assert.ok(s.surfaceFilm>=0&&s.surfaceFilm<=1);});
check('permeability one bounded',()=>{const s=state({permeability:1});assert.ok(s.surfaceFilm>=0&&s.surfaceFilm<=1);});
check('soil depth zero bounded',()=>{const s=state({soilDepth:0});assert.ok(s.capillaryRise>=0&&s.capillaryRise<=1);});
check('soil depth max bounded',()=>{const s=state({soilDepth:6});assert.ok(s.capillaryRise>=0&&s.capillaryRise<=1);});
check('water distance zero bounded',()=>{const s=state({waterDistanceMeters:0});assert.ok(s.waterTableProximity>=0&&s.waterTableProximity<=1);});
check('water distance far bounded',()=>{const s=state({waterDistanceMeters:5000});assert.ok(s.waterTableProximity>=0&&s.waterTableProximity<=1);});
check('groundwater shallow bounded',()=>{const s=state({groundwaterDepthMeters:0});assert.ok(s.waterTableProximity>=0&&s.waterTableProximity<=1);});
check('groundwater deep bounded',()=>{const s=state({groundwaterDepthMeters:5000});assert.ok(s.waterTableProximity>=0&&s.waterTableProximity<=1);});
check('wet history empty bounded',()=>{const s=state({wetDays:0});assert.ok(s.saturationMemory>=0&&s.saturationMemory<=1);});
check('wet history max bounded',()=>{const s=state({wetDays:365});assert.ok(s.saturationMemory>=0&&s.saturationMemory<=1);});
check('dry history empty bounded',()=>{const s=state({dryDays:0});assert.ok(s.saturationMemory>=0&&s.saturationMemory<=1);});
check('dry history max bounded',()=>{const s=state({dryDays:365});assert.ok(s.saturationMemory>=0&&s.saturationMemory<=1);});
check('day zero bounded',()=>{const s=state({dayOfYear:0});assert.ok(s.surfaceSaturation>=0&&s.surfaceSaturation<=1);});
check('day 359 bounded',()=>{const s=state({dayOfYear:359});assert.ok(s.surfaceSaturation>=0&&s.surfaceSaturation<=1);});
check('cold bounded',()=>{const s=state({temperatureC:-40});assert.ok(s.groundwaterStress.total>=0&&s.groundwaterStress.total<=1);});
check('hot bounded',()=>{const s=state({temperatureC:55});assert.ok(s.groundwaterStress.total>=0&&s.groundwaterStress.total<=1);});
check('drainage zero bounded',()=>{const s=state({drainage:0});assert.ok(s.puddlePersistence>=0&&s.puddlePersistence<=1);});
check('drainage one bounded',()=>{const s=state({drainage:1});assert.ok(s.puddlePersistence>=0&&s.puddlePersistence<=1);});
check('invalid numbers are sanitized',()=>{const s=state({slopeDegrees:NaN,rainfall:Infinity,groundwaterDepthMeters:-9});assert.equal(validateTerrainGroundwaterState(s).ok,true);});

for(let x=-4;x<=4;x++)check(`grid-x-${x}`,()=>{const a=state({worldX:120+x*53});const b=state({worldX:120+x*53,worldX:120+x*53});assert.deepEqual(a,b);});
for(let z=-4;z<=4;z++)check(`grid-z-${z}`,()=>{const a=state({worldZ:-80+z*47});const b=state({worldZ:-80+z*47});assert.deepEqual(a,b);});

console.log(`[groundwater-boundaries] PASS: ${checks.length} checks`);
