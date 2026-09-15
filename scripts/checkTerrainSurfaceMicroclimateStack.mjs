import assert from 'node:assert/strict';
import { resolveTerrainWindExposureState } from '../src/3d/world/terrainSurfaceWindExposure.js';
import { resolveTerrainThermalMicroclimateState } from '../src/3d/world/terrainSurfaceThermalMicroclimate.js';
const bounded=v=>Number.isFinite(v)&&v>=0&&v<=1;
let checksum=0;
for(let i=0;i<640;i+=1){const p={worldX:-16000+((i*179)%32000),worldZ:-12000+((i*137)%24000),heightMeters:(i*43)%3000,slopeDegrees:(i*9)%64,moisture:((i*17)%101)/100};const a=resolveTerrainWindExposureState(p),b=resolveTerrainWindExposureState(p),c=resolveTerrainThermalMicroclimateState(p),d=resolveTerrainThermalMicroclimateState(p);assert.deepEqual(a,b);assert.deepEqual(c,d);for(const v of Object.values(a))assert.equal(bounded(v),true);for(const v of Object.values(c))assert.equal(bounded(v),true);checksum=(checksum+Math.round((a.abrasion+a.driftMask+c.freezeRisk+c.heatLoad)*1000003))>>>0;}
const calm=resolveTerrainWindExposureState({worldX:1,worldZ:2,heightMeters:400,slopeDegrees:2,moisture:.9});const steep=resolveTerrainWindExposureState({worldX:1,worldZ:2,heightMeters:1800,slopeDegrees:42,moisture:.1});assert(steep.windward>0);assert(calm.calmPocket>=0);
console.log('[checkTerrainSurfaceMicroclimateStack] PASS',JSON.stringify({samples:640,checksum}));
