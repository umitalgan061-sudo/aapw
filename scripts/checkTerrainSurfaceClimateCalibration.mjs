import assert from 'node:assert/strict';
import { TERRAIN_CLIMATE_CALIBRATION, terrainClimateCalibrationAt } from '../src/3d/world/terrainSurfaceClimateCalibration.js';
import { TERRAIN_CLIMATE_WEATHERING_BOUNDARIES } from './fixtures/terrainClimateWeatheringBoundaryCatalog.js';
import { TERRAIN_CLIMATE_WEATHERING_GRID_A } from './fixtures/terrainClimateWeatheringExplicitGridA.js';
import { TERRAIN_CLIMATE_WEATHERING_GRID_B } from './fixtures/terrainClimateWeatheringExplicitGridB.js';
import { TERRAIN_CLIMATE_WEATHERING_PROBES } from './fixtures/terrainClimateWeatheringProbeCatalog.js';
import { TERRAIN_MACROCLIMATE_PROBES } from './fixtures/terrainSurfaceMacroclimateProbeCatalog.js';
assert(TERRAIN_CLIMATE_CALIBRATION.length>=120);
for(let i=0;i<TERRAIN_CLIMATE_CALIBRATION.length;i+=1){const row=terrainClimateCalibrationAt(i);for(const value of Object.values(row))assert(Number.isFinite(value)&&value>=0&&value<=1,`row ${i}`);assert.equal(row,terrainClimateCalibrationAt(i));}
for(const [name,items] of [['boundaries',TERRAIN_CLIMATE_WEATHERING_BOUNDARIES],['gridA',TERRAIN_CLIMATE_WEATHERING_GRID_A],['gridB',TERRAIN_CLIMATE_WEATHERING_GRID_B],['probes',TERRAIN_CLIMATE_WEATHERING_PROBES],['macro',TERRAIN_MACROCLIMATE_PROBES]]){assert(items.length>0,`${name} empty`);const ids=new Set(items.map(item=>item.index));assert.equal(ids.size,items.length,`${name} duplicate ids`);}
console.log('[checkTerrainSurfaceClimateCalibration] PASS',JSON.stringify({calibrationRows:TERRAIN_CLIMATE_CALIBRATION.length,boundaries:TERRAIN_CLIMATE_WEATHERING_BOUNDARIES.length,gridA:TERRAIN_CLIMATE_WEATHERING_GRID_A.length,gridB:TERRAIN_CLIMATE_WEATHERING_GRID_B.length,probes:TERRAIN_CLIMATE_WEATHERING_PROBES.length,macro:TERRAIN_MACROCLIMATE_PROBES.length}));
