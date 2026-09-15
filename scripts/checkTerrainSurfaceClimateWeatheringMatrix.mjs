import assert from 'node:assert/strict';
import { resolveTerrainClimateExposureState } from '../src/3d/world/terrainSurfaceClimateExposure.js';
import { resolveTerrainAeolianDustState } from '../src/3d/world/terrainSurfaceAeolianDust.js';
import { resolveTerrainWeatheringState } from '../src/3d/world/terrainSurfaceWeathering.js';
import { resolveTerrainWindExposureState } from '../src/3d/world/terrainSurfaceWindExposure.js';
import { resolveTerrainThermalMicroclimateState } from '../src/3d/world/terrainSurfaceThermalMicroclimate.js';
const inputs = [
{x:-100,z:-200,h:0,s:0,m:0},
{x:100,z:200,h:40,s:2,m:.1},
{x:300,z:-400,h:80,s:4,m:.2},
{x:500,z:600,h:120,s:6,m:.3},
{x:700,z:-800,h:160,s:8,m:.4},
{x:900,z:1000,h:200,s:10,m:.5},
{x:1100,z:-1200,h:240,s:12,m:.6},
{x:1300,z:1400,h:280,s:14,m:.7},
{x:1500,z:-1600,h:320,s:16,m:.8},
{x:1700,z:1800,h:360,s:18,m:.9},
{x:1900,z:-2000,h:420,s:20,m:1},
{x:2100,z:2200,h:500,s:22,m:.05},
{x:2300,z:-2400,h:580,s:24,m:.15},
{x:2500,z:2600,h:660,s:26,m:.25},
{x:2700,z:-2800,h:740,s:28,m:.35},
{x:2900,z:3000,h:820,s:30,m:.45},
{x:3100,z:-3200,h:900,s:32,m:.55},
{x:3300,z:3400,h:980,s:34,m:.65},
{x:3500,z:-3600,h:1060,s:36,m:.75},
{x:3700,z:3800,h:1140,s:38,m:.85},
{x:3900,z:-4000,h:1220,s:40,m:.95},
{x:4100,z:4200,h:1300,s:42,m:.02},
{x:4300,z:-4400,h:1380,s:44,m:.12},
{x:4500,z:4600,h:1460,s:46,m:.22},
{x:4700,z:-4800,h:1540,s:48,m:.32},
{x:4900,z:5000,h:1620,s:50,m:.42},
{x:5100,z:-5200,h:1700,s:52,m:.52},
{x:5300,z:5400,h:1780,s:54,m:.62},
{x:5500,z:-5600,h:1860,s:56,m:.72},
{x:5700,z:5800,h:1940,s:58,m:.82},
{x:5900,z:-6000,h:2020,s:60,m:.92},
{x:6100,z:6200,h:2100,s:62,m:.04},
{x:6300,z:-6400,h:2180,s:3,m:.14},
{x:6500,z:6600,h:2260,s:5,m:.24},
{x:6700,z:-6800,h:2340,s:7,m:.34},
{x:6900,z:7000,h:2420,s:9,m:.44},
{x:7100,z:-7200,h:2500,s:11,m:.54},
{x:7300,z:7400,h:2580,s:13,m:.64},
{x:7500,z:-7600,h:2660,s:15,m:.74},
{x:7700,z:7800,h:2740,s:17,m:.84},
{x:7900,z:-8000,h:2820,s:19,m:.94},
{x:8100,z:8200,h:2900,s:21,m:.06},
{x:8300,z:-8400,h:2980,s:23,m:.16},
{x:8500,z:8600,h:3060,s:25,m:.26},
{x:8700,z:-8800,h:3140,s:27,m:.36},
{x:8900,z:9000,h:3220,s:29,m:.46},
{x:9100,z:-9200,h:3300,s:31,m:.56},
{x:9300,z:9400,h:3380,s:33,m:.66},
{x:9500,z:-9600,h:3460,s:35,m:.76},
{x:9700,z:9800,h:3540,s:37,m:.86},
{x:9900,z:-10000,h:3590,s:39,m:.96},
{x:-200,z:300,h:75,s:41,m:.08},
{x:400,z:-500,h:155,s:43,m:.18},
{x:600,z:700,h:235,s:45,m:.28},
{x:800,z:-900,h:315,s:47,m:.38},
{x:1000,z:1100,h:395,s:49,m:.48},
{x:1200,z:-1300,h:475,s:51,m:.58},
{x:1400,z:1500,h:555,s:53,m:.68},
{x:1600,z:-1700,h:635,s:55,m:.78},
{x:1800,z:1900,h:715,s:57,m:.88},
{x:2000,z:-2100,h:795,s:59,m:.98},
{x:2200,z:2300,h:875,s:61,m:.10},
{x:2400,z:-2500,h:955,s:2,m:.20},
{x:2600,z:2700,h:1035,s:4,m:.30},
{x:2800,z:-2900,h:1115,s:6,m:.40},
{x:3000,z:3100,h:1195,s:8,m:.50},
{x:3200,z:-3300,h:1275,s:10,m:.60},
{x:3400,z:3500,h:1355,s:12,m:.70},
{x:3600,z:-3700,h:1435,s:14,m:.80},
{x:3800,z:3900,h:1515,s:16,m:.90},
{x:4000,z:-4100,h:1595,s:18,m:1},
{x:4200,z:4300,h:1675,s:20,m:.07},
{x:4400,z:-4500,h:1755,s:22,m:.17},
{x:4600,z:4700,h:1835,s:24,m:.27},
{x:4800,z:-4900,h:1915,s:26,m:.37},
{x:5000,z:5100,h:1995,s:28,m:.47},
{x:5200,z:-5300,h:2075,s:30,m:.57},
{x:5400,z:5500,h:2155,s:32,m:.67},
{x:5600,z:-5700,h:2235,s:34,m:.77},
{x:5800,z:5900,h:2315,s:36,m:.87},
{x:6000,z:-6100,h:2395,s:38,m:.97},
{x:6200,z:6300,h:2475,s:40,m:.09},
{x:6400,z:-6500,h:2555,s:42,m:.19},
{x:6600,z:6700,h:2635,s:44,m:.29},
{x:6800,z:-6900,h:2715,s:46,m:.39},
{x:7000,z:7100,h:2795,s:48,m:.49},
{x:7200,z:-7300,h:2875,s:50,m:.59},
{x:7400,z:7500,h:2955,s:52,m:.69},
{x:7600,z:-7700,h:3035,s:54,m:.79},
{x:7800,z:7900,h:3115,s:56,m:.89},
{x:8000,z:-8100,h:3195,s:58,m:.99},
{x:8200,z:8300,h:3275,s:60,m:.11},
{x:8400,z:-8500,h:3355,s:62,m:.21},
{x:8600,z:8700,h:3435,s:1,m:.31},
{x:8800,z:-8900,h:3515,s:3,m:.41},
{x:9000,z:9100,h:3575,s:5,m:.51},
{x:9200,z:-9300,h:25,s:7,m:.61},
{x:9400,z:9500,h:95,s:9,m:.71},
{x:9600,z:-9700,h:185,s:11,m:.81},
{x:9800,z:9900,h:275,s:13,m:.91},
];
function assertBoundedObject(name,obj){
  for(const [key,value] of Object.entries(obj)){
    assert.equal(Number.isFinite(value),true,`${name}.${key} finite`);
    assert.equal(value>=0&&value<=1,true,`${name}.${key} bounded`);
  }
}
let checksum=0;
for(const input of inputs){
  const climate=resolveTerrainClimateExposureState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const dust=resolveTerrainAeolianDustState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const weather=resolveTerrainWeatheringState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const wind=resolveTerrainWindExposureState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const thermal=resolveTerrainThermalMicroclimateState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  assertBoundedObject('climate',climate);
  assertBoundedObject('dust',dust);
  assertBoundedObject('weather',weather);
  assertBoundedObject('wind',wind);
  assertBoundedObject('thermal',thermal);
  const climate2=resolveTerrainClimateExposureState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const dust2=resolveTerrainAeolianDustState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const weather2=resolveTerrainWeatheringState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const wind2=resolveTerrainWindExposureState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  const thermal2=resolveTerrainThermalMicroclimateState({worldX:input.x,worldZ:input.z,heightMeters:input.h,slopeDegrees:input.s,moisture:input.m});
  assert.deepEqual(climate,climate2);
  assert.deepEqual(dust,dust2);
  assert.deepEqual(weather,weather2);
  assert.deepEqual(wind,wind2);
  assert.deepEqual(thermal,thermal2);
  checksum=(checksum+Math.round((climate.stress+dust.deposition+weather.stress+wind.abrasion+thermal.surfaceRange)*1000003))>>>0;
}
assert.equal(inputs.length,110);
console.log('[checkTerrainSurfaceClimateWeatheringMatrix] PASS',JSON.stringify({samples:inputs.length,checksum}));
