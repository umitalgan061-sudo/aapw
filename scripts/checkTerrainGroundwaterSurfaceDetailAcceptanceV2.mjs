#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_DETAIL_LOWLAND_FIXTURES } from '../src/3d/world/terrainGroundwaterSurfaceDetailFixturesLowland.js';
import { TERRAIN_GROUNDWATER_DETAIL_UPLAND_FIXTURES } from '../src/3d/world/terrainGroundwaterSurfaceDetailFixturesUpland.js';
import { TERRAIN_GROUNDWATER_DETAIL_TRANSITION_FIXTURES } from '../src/3d/world/terrainGroundwaterSurfaceDetailFixturesTransitions.js';
import { resolveGroundwaterSurfaceDetail, detailEnvelope, detailCanonicalAudit, detailMaterialResponse, detailEventDelta, applyDetailEvent, detailWeightedWetness, detailDrynessRisk } from '../src/3d/world/terrainGroundwaterSurfaceDetail.js';
import { shaderInvariantReport } from '../src/3d/world/terrainGroundwaterSurfaceDetailShader.js';
import { resolveGroundwaterDetailStack, detailStackAudit } from '../src/3d/world/terrainGroundwaterSurfaceDetailStack.js';
import { presetAudit, resolveDetailPreset } from '../src/3d/world/terrainGroundwaterSurfaceDetailPresets.js';
import { calibrationAudit } from '../src/3d/world/terrainGroundwaterSurfaceDetailCalibration.js';
const fixtures=[...TERRAIN_GROUNDWATER_DETAIL_LOWLAND_FIXTURES,...TERRAIN_GROUNDWATER_DETAIL_UPLAND_FIXTURES,...TERRAIN_GROUNDWATER_DETAIL_TRANSITION_FIXTURES];
let passed=0;
const gate=(name,fn)=>{fn();passed+=1;console.log(`[groundwater-detail-acceptance-v2] PASS: ${name}`)};
const bounded=v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1;
const base={color:{r:.43,g:.36,b:.29},roughness:.86,normalStrength:0,wetness:0};

gate('fixture corpus exceeds 150 records',()=>assert.ok(fixtures.length>150));
gate('fixture identifiers are unique',()=>assert.equal(new Set(fixtures.map(v=>v.id)).size,fixtures.length));
gate('calibration audit passes',()=>assert.equal(calibrationAudit().ok,true));
gate('preset audit passes',()=>assert.equal(presetAudit().ok,true));
gate('shader invariant report passes',()=>assert.equal(shaderInvariantReport().ok,true));
for(const input of fixtures){
  gate(`resolve-${input.id}`,()=>{const d=resolveGroundwaterSurfaceDetail(input);assert.equal(d.policyId,'terrain-groundwater-surface-detail-2026-09-15-v1');assert.equal(detailEnvelope(d).ok,true);assert.equal(detailCanonicalAudit(d).ok,true);});
  gate(`material-${input.id}`,()=>{const d=resolveGroundwaterSurfaceDetail(input),m=detailMaterialResponse(d,base.color,base.roughness);assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));Object.values(m.color).forEach(v=>assert.ok(bounded(v)))});
}
for(const type of ['storm','drought','freeze-thaw','snowmelt','recovery']) gate(`event-${type}`,()=>fixtures.slice(0,20).forEach(input=>{const d=resolveGroundwaterSurfaceDetail(input),delta=detailEventDelta(d,{type,intensity:.75}),m=applyDetailEvent(detailMaterialResponse(d),delta);Object.values(delta).forEach(v=>assert.ok(Number.isFinite(v)));assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));}));
gate('stack resolves baseline',()=>assert.equal(detailStackAudit(resolveGroundwaterDetailStack(fixtures[0],base)).ok,true));
gate('stack resolves dryland',()=>{const input=fixtures.find(v=>v.biome==='temperate')??fixtures[0];assert.equal(detailStackAudit(resolveGroundwaterDetailStack(input,base)).ok,true)});
gate('stack resolves alpine',()=>{const input=fixtures.find(v=>v.biome==='alpine')??fixtures[0];assert.equal(detailStackAudit(resolveGroundwaterDetailStack(input,base)).ok,true)});
gate('preset lookup returns calibrated profile',()=>{const p=resolveDetailPreset({biome:'wetland',substrate:'peat'});assert.equal(p.biome,'wetland');assert.equal(p.calibrationProfile.biome,'wetland')});
gate('weighted wetness bounded',()=>fixtures.forEach(i=>assert.ok(bounded(detailWeightedWetness(resolveGroundwaterSurfaceDetail(i))))));
gate('dryness bounded',()=>fixtures.forEach(i=>assert.ok(bounded(detailDrynessRisk(resolveGroundwaterSurfaceDetail(i))))));
gate('sparse sample remains safe',()=>assert.equal(detailEnvelope(resolveGroundwaterSurfaceDetail({})).ok,true));
gate('extreme sample remains safe',()=>assert.equal(detailEnvelope(resolveGroundwaterSurfaceDetail({worldX:1e9,worldZ:-1e9,heightMeters:1e9,slopeDegrees:999,moisture:999,rainfall:-999,runoff:999,soilDepth:999,permeability:-1,waterDistanceMeters:1e9,groundwaterDepthMeters:1e9,wetDays:1e9,dryDays:1e9,dayOfYear:1e9,temperatureC:1e9,drainage:999,windExposure:-999})).ok,true));
console.log(`[groundwater-detail-acceptance-v2] PASS: ${passed} gates over ${fixtures.length} fixtures`);
