#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_DETAIL_SCENARIOS } from '../src/3d/world/terrainGroundwaterSurfaceDetailScenarioCatalog.js';
import { resolveGroundwaterSurfaceDetail, detailSignature, detailEnvelope, detailCanonicalAudit, detailWeightedWetness, detailDrynessRisk, blendSurfaceDetail, detailMaterialResponse, detailEventDelta, applyDetailEvent } from '../src/3d/world/terrainGroundwaterSurfaceDetail.js';

let passed=0;
const test=(name,fn)=>{fn();passed+=1;console.log(`[groundwater-detail-metamorphic] PASS: ${name}`)};
const cases=TERRAIN_GROUNDWATER_DETAIL_SCENARIOS;
const finite=v=>Number.isFinite(Number(v));
const bounded=v=>finite(v)&&v>=0&&v<=1;
const material={color:{r:.44,g:.37,b:.3},roughness:.86,normalStrength:0,wetness:0};

 test('scenario catalog is diverse',()=>{assert.ok(new Set(cases.map(c=>c.kind)).size>=10);assert.ok(cases.length>=70)});
 test('scenario coordinates vary',()=>{assert.ok(new Set(cases.map(c=>c.worldX)).size>=30);assert.ok(new Set(cases.map(c=>c.worldZ)).size>=3)});
 test('scenario days vary',()=>assert.ok(new Set(cases.map(c=>c.day)).size>=30));
 test('scenario slopes cover low and high',()=>{assert.ok(Math.min(...cases.map(c=>c.slope))<5);assert.ok(Math.max(...cases.map(c=>c.slope))>45)});
 test('scenario moisture covers wet and dry',()=>{assert.ok(Math.min(...cases.map(c=>c.moisture))<.25);assert.ok(Math.max(...cases.map(c=>c.moisture))>.8)});
 test('scenario drainage covers both ends',()=>{assert.ok(Math.min(...cases.map(c=>c.drain))<.2);assert.ok(Math.max(...cases.map(c=>c.drain))>.9)});

const details=cases.map(c=>resolveGroundwaterSurfaceDetail({worldX:c.worldX,worldZ:c.worldZ,heightMeters:c.height,slopeDegrees:c.slope,moisture:c.moisture,rainfall:c.rain,runoff:c.runoff,soilDepth:c.soil,permeability:c.perm,waterDistanceMeters:c.water,groundwaterDepthMeters:c.table,wetDays:c.wetDays,dryDays:c.dryDays,temperatureC:c.temp,drainage:c.drain,windExposure:c.wind,dayOfYear:c.day}));

for(let i=0;i<details.length;i+=1){const d=details[i],c=cases[i];
 test(`finite-${c.id}`,()=>Object.values(d.channels).forEach(v=>assert.ok(finite(v))));
 test(`bounded-${c.id}`,()=>Object.values(d.channels).forEach(v=>assert.ok(bounded(v))));
 test(`canonical-${c.id}`,()=>assert.equal(detailCanonicalAudit(d).ok,true));
 test(`envelope-${c.id}`,()=>assert.equal(detailEnvelope(d).ok,true));
 test(`repeat-${c.id}`,()=>assert.deepEqual(detailSignature(d),detailSignature(resolveGroundwaterSurfaceDetail({worldX:c.worldX,worldZ:c.worldZ,heightMeters:c.height,slopeDegrees:c.slope,moisture:c.moisture,rainfall:c.rain,runoff:c.runoff,soilDepth:c.soil,permeability:c.perm,waterDistanceMeters:c.water,groundwaterDepthMeters:c.table,wetDays:c.wetDays,dryDays:c.dryDays,temperatureC:c.temp,drainage:c.drain,windExposure:c.wind,dayOfYear:c.day}))));
}

const wetCases=cases.filter(c=>c.moisture>.75&&c.rain>.7&&c.drain<.3);
const dryCases=cases.filter(c=>c.moisture<.35&&c.rain<.35&&c.drain>.75);
test('wet cohort exists',()=>assert.ok(wetCases.length>=5));
test('dry cohort exists',()=>assert.ok(dryCases.length>=5));
test('wet cohort has finite weighted wetness',()=>wetCases.forEach(c=>{const d=resolveGroundwaterSurfaceDetail({worldX:c.worldX,worldZ:c.worldZ,heightMeters:c.height,slopeDegrees:c.slope,moisture:c.moisture,rainfall:c.rain,runoff:c.runoff,soilDepth:c.soil,permeability:c.perm,waterDistanceMeters:c.water,groundwaterDepthMeters:c.table,wetDays:c.wetDays,dryDays:c.dryDays,temperatureC:c.temp,drainage:c.drain,windExposure:c.wind,dayOfYear:c.day});assert.ok(bounded(detailWeightedWetness(d)))}));
test('dry cohort has finite dryness',()=>dryCases.forEach(c=>{const d=resolveGroundwaterSurfaceDetail({worldX:c.worldX,worldZ:c.worldZ,heightMeters:c.height,slopeDegrees:c.slope,moisture:c.moisture,rainfall:c.rain,runoff:c.runoff,soilDepth:c.soil,permeability:c.perm,waterDistanceMeters:c.water,groundwaterDepthMeters:c.table,wetDays:c.wetDays,dryDays:c.dryDays,temperatureC:c.temp,drainage:c.drain,windExposure:c.wind,dayOfYear:c.day});assert.ok(bounded(detailDrynessRisk(d)))}));

test('blend symmetry under complementary mixes',()=>{const a=details[2],b=details[31];const x=blendSurfaceDetail(a,b,.25),y=blendSurfaceDetail(b,a,.75);assert.deepEqual(x.channels,y.channels)});
test('blend endpoints preserved',()=>{const a=details[0],b=details[1];assert.deepEqual(blendSurfaceDetail(a,b,0).channels,a.channels);assert.deepEqual(blendSurfaceDetail(a,b,1).channels,b.channels)});
test('blend half channels bounded',()=>Object.values(blendSurfaceDetail(details[4],details[46],.5).channels).forEach(v=>assert.ok(bounded(v))));

test('zero event intensity produces no delta',()=>{const d=details[3];for(const type of ['storm','drought','freeze-thaw','snowmelt','recovery'])assert.deepEqual(detailEventDelta(d,{type,intensity:0}),{color:0,roughness:0,normal:0,wetness:0})});
test('full event intensity remains finite',()=>{const d=details[12];for(const type of ['storm','drought','freeze-thaw','snowmelt','recovery'])for(const v of Object.values(detailEventDelta(d,{type,intensity:1})))assert.ok(finite(v))});
test('unknown event behaves neutral',()=>assert.deepEqual(detailEventDelta(details[12],{type:'future-event',intensity:1}),{color:0,roughness:0,normal:0,wetness:0}));
test('event application remains bounded',()=>{const d=details[19];for(const type of ['storm','drought','freeze-thaw','snowmelt','recovery']){const m=applyDetailEvent(detailMaterialResponse(d,material.color,material.roughness),detailEventDelta(d,{type,intensity:1}));assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));}});

test('base color remains valid after response',()=>{const m=detailMaterialResponse(details[23],material.color,material.roughness);for(const v of Object.values(m.color))assert.ok(bounded(v))});
test('normal response respects policy',()=>{const m=detailMaterialResponse(details[33],material.color,material.roughness);assert.ok(m.normalStrength<=.055)});
test('roughness remains bounded for all scenarios',()=>details.forEach(d=>assert.ok(bounded(detailMaterialResponse(d).roughness))));
test('wetness remains bounded for all scenarios',()=>details.forEach(d=>assert.ok(bounded(detailMaterialResponse(d).wetness))));

for(const axis of ['height','slope','moisture','rain','runoff','soil','perm','water','table','wetDays','dryDays','temp','drain','wind']){
 test(`axis-${axis}-stable`,()=>{const c=cases[17];const base={worldX:c.worldX,worldZ:c.worldZ,heightMeters:c.height,slopeDegrees:c.slope,moisture:c.moisture,rainfall:c.rain,runoff:c.runoff,soilDepth:c.soil,permeability:c.perm,waterDistanceMeters:c.water,groundwaterDepthMeters:c.table,wetDays:c.wetDays,dryDays:c.dryDays,temperatureC:c.temp,drainage:c.drain,windExposure:c.wind,dayOfYear:c.day};const variants={height:[-20,0,100,500],slope:[0,8,30,60,89],moisture:[0,.25,.5,.75,1],rain:[0,.25,.5,.75,1],runoff:[0,.25,.5,.75,1],soil:[0,.5,1.5,3,6],perm:[0,.25,.5,.75,1],water:[0,25,100,500,5000],table:[0,10,50,500,5000],wetDays:[0,7,28,90,365],dryDays:[0,7,42,120,365],temp:[-40,-10,0,20,55],drain:[0,.25,.5,.75,1],wind:[0,.25,.5,.75,1]}[axis];for(const value of variants){const p={...base};p[{height:'height',slope:'slopeDegrees',moisture:'moisture',rain:'rainfall',runoff:'runoff',soil:'soilDepth',perm:'permeability',water:'waterDistanceMeters',table:'groundwaterDepthMeters',wetDays:'wetDays',dryDays:'dryDays',temp:'temperatureC',drain:'drainage',wind:'windExposure'}[axis]]=value;const d=resolveGroundwaterSurfaceDetail(p);assert.equal(detailEnvelope(d).ok,true);}});
}

console.log(`[groundwater-detail-metamorphic] PASS: ${passed} checks over ${cases.length} scenarios`);
