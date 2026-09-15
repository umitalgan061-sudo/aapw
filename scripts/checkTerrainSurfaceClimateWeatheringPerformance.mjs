import assert from 'node:assert/strict';
import { resolveTerrainClimateExposureState } from '../src/3d/world/terrainSurfaceClimateExposure.js';
import { resolveTerrainAeolianDustState } from '../src/3d/world/terrainSurfaceAeolianDust.js';
import { resolveTerrainWeatheringState } from '../src/3d/world/terrainSurfaceWeathering.js';

const cases=[];for(let ix=0;ix<80;ix+=1)for(let iz=0;iz<40;iz+=1)cases.push({worldX:(ix-40)*137.25,worldZ:(iz-20)*149.5,heightMeters:(ix*31+iz*17)%2600,slopeDegrees:(ix*7+iz*3)%55,moisture:((ix*11+iz*17)%101)/100});
assert.equal(cases.length,3200);
function run(){let checksum=0;for(const p of cases){const climate=resolveTerrainClimateExposureState(p);const dust=resolveTerrainAeolianDustState(p);const weather=resolveTerrainWeatheringState({...p,baseColor:{r:.34,g:.39,b:.30}});checksum=(checksum+Math.round((climate.stress+dust.deposition+weather.stress)*1000003))>>>0;}return checksum;}
const warmup=run();const start=process.hrtime.bigint();const a=run();const elapsed=Number(process.hrtime.bigint()-start)/1e6;const b=run();assert.equal(a,b);assert.equal(Number.isFinite(elapsed),true);assert(elapsed<180,`3,200-point stack budget exceeded: ${elapsed.toFixed(2)}ms`);console.log('[checkTerrainSurfaceClimateWeatheringPerformance] PASS',JSON.stringify({samples:cases.length,elapsedMs:Number(elapsed.toFixed(3)),checksum:a,warmup}));
