#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_DETAIL_LOWLAND_FIXTURES } from '../src/3d/world/terrainGroundwaterSurfaceDetailFixturesLowland.js';
import { TERRAIN_GROUNDWATER_DETAIL_UPLAND_FIXTURES } from '../src/3d/world/terrainGroundwaterSurfaceDetailFixturesUpland.js';
import { TERRAIN_GROUNDWATER_DETAIL_TRANSITION_FIXTURES } from '../src/3d/world/terrainGroundwaterSurfaceDetailFixturesTransitions.js';
import { resolveTerrainGroundwaterSurfaceDetail, detailMaterialResponse, detailEnvelope, detailCanonicalAudit, detailSignature, detailHydroBalance, detailWeightedWetness, detailDrynessRisk, detailEventDelta, applyDetailEvent, classifySurfaceDetail, detailRenderTier, detailNeighborhoodStats } from '../src/3d/world/terrainGroundwaterSurfaceDetail.js';
import { shaderInvariantReport, groundwaterSurfaceDetailShaderReplacements } from '../src/3d/world/terrainGroundwaterSurfaceDetailShader.js';
import { resolveGroundwaterDetailStack, detailStackAudit, detailStackHealth, detailStackStatistics, TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER } from '../src/3d/world/terrainGroundwaterSurfaceDetailStack.js';

const all=[...TERRAIN_GROUNDWATER_DETAIL_LOWLAND_FIXTURES,...TERRAIN_GROUNDWATER_DETAIL_UPLAND_FIXTURES,...TERRAIN_GROUNDWATER_DETAIL_TRANSITION_FIXTURES];
let passed=0;
const gate=(name,fn)=>{fn();passed+=1;console.log(`[groundwater-detail-acceptance] PASS: ${name}`)};
const finite=v=>Number.isFinite(Number(v));
const bounded=v=>finite(v)&&Number(v)>=0&&Number(v)<=1;
const materialBase={color:{r:.43,g:.36,b:.29},roughness:.86,normalStrength:0,wetness:0};

 gate('fixture corpus is non-empty',()=>assert.ok(all.length>=150));
 gate('fixture ids are unique',()=>assert.equal(new Set(all.map(v=>v.id)).size,all.length));
 gate('fixture coordinates are finite',()=>all.forEach(v=>{assert.ok(finite(v.worldX));assert.ok(finite(v.worldZ));}));
 gate('fixture climate fields are bounded',()=>all.forEach(v=>{for(const k of ['moisture','rainfall','runoff','permeability','drainage','windExposure'])assert.ok(bounded(v[k]));}));
 gate('fixture slope is valid',()=>all.forEach(v=>assert.ok(v.slopeDegrees>=0&&v.slopeDegrees<=89)));
 gate('fixture soil depth is bounded',()=>all.forEach(v=>assert.ok(v.soilDepth>=0&&v.soilDepth<=6)));
 gate('fixture water distances are bounded',()=>all.forEach(v=>{assert.ok(v.waterDistanceMeters>=0&&v.waterDistanceMeters<=5000);assert.ok(v.groundwaterDepthMeters>=0&&v.groundwaterDepthMeters<=5000);}));
 gate('fixture day values are accepted',()=>all.forEach(v=>assert.ok(Number.isInteger(v.dayOfYear))));
 gate('fixture temperatures are bounded',()=>all.forEach(v=>assert.ok(v.temperatureC>=-40&&v.temperatureC<=55)));

const details=all.map(input=>resolveTerrainGroundwaterSurfaceDetail(input));
 gate('all fixture details resolve',()=>assert.equal(details.length,all.length));
 gate('all fixture policies match',()=>details.forEach(d=>assert.equal(d.sourcePolicyId,'terrain-groundwater-regime-2026-09-15-v1')));
 gate('all fixture channels are bounded',()=>details.forEach(d=>Object.values(d.channels).forEach(v=>assert.ok(bounded(v)))));
 gate('all fixture envelopes pass',()=>details.forEach(d=>assert.equal(detailEnvelope(d).ok,true)));
 gate('all fixture canonical audits pass',()=>details.forEach(d=>assert.equal(detailCanonicalAudit(d).ok,true)));
 gate('all fixture balances are finite',()=>details.forEach(d=>{const b=detailHydroBalance(d);assert.ok(finite(b.net));assert.ok(b.net>=-1&&b.net<=1)}));
 gate('all fixture weighted wetness is bounded',()=>details.forEach(d=>assert.ok(bounded(detailWeightedWetness(d)))));
 gate('all fixture dryness is bounded',()=>details.forEach(d=>assert.ok(bounded(detailDrynessRisk(d)))));
 gate('all fixture render tiers are known',()=>details.forEach(d=>assert.ok(['suppressed','low','medium','high'].includes(detailRenderTier(d)))));
 gate('all fixture classifications are known',()=>details.forEach(d=>assert.ok(['puddle-core','marsh-transition','seepage-band','evaporative-crust','capillary-damp','freeze-wet-edge','drying-front','wet-rim','neutral'].includes(classifySurfaceDetail(d)))));

for(const input of all)gate(`determinism-${input.id}`,()=>assert.deepEqual(detailSignature(resolveTerrainGroundwaterSurfaceDetail(input)),detailSignature(resolveTerrainGroundwaterSurfaceDetail({...input}))));
for(const input of all)gate(`material-${input.id}`,()=>{const d=resolveTerrainGroundwaterSurfaceDetail(input),m=detailMaterialResponse(d,materialBase.color,materialBase.roughness);for(const c of ['r','g','b'])assert.ok(bounded(m.color[c]));assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));});
for(const input of all.slice(0,80))for(const type of ['storm','drought','freeze-thaw','snowmelt','recovery'])gate(`event-${input.id}-${type}`,()=>{const d=resolveTerrainGroundwaterSurfaceDetail(input),delta=detailEventDelta(d,{type,intensity:.8}),m=applyDetailEvent(detailMaterialResponse(d),delta);assert.ok(Object.values(delta).every(finite));assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));});

const hot={worldX:999999,worldZ:-888888,heightMeters:9999,slopeDegrees:89,moisture:1,rainfall:1,runoff:1,soilDepth:6,permeability:1,waterDistanceMeters:5000,groundwaterDepthMeters:5000,wetDays:365,dryDays:365,dayOfYear:719,temperatureC:55,drainage:1,windExposure:1};
const cold={...hot,moisture:0,rainfall:0,runoff:0,soilDepth:0,permeability:0,waterDistanceMeters:0,groundwaterDepthMeters:0,wetDays:0,dryDays:0,dayOfYear:-719,temperatureC:-40,drainage:0,windExposure:0};
 gate('hot extreme sample stays bounded',()=>Object.values(resolveTerrainGroundwaterSurfaceDetail(hot).channels).forEach(v=>assert.ok(bounded(v))));
 gate('cold extreme sample stays bounded',()=>Object.values(resolveTerrainGroundwaterSurfaceDetail(cold).channels).forEach(v=>assert.ok(bounded(v))));
 gate('hot signature repeats',()=>assert.deepEqual(detailSignature(resolveTerrainGroundwaterSurfaceDetail(hot)),detailSignature(resolveTerrainGroundwaterSurfaceDetail(hot))));
 gate('cold signature repeats',()=>assert.deepEqual(detailSignature(resolveTerrainGroundwaterSurfaceDetail(cold)),detailSignature(resolveTerrainGroundwaterSurfaceDetail(cold))));

const stackFrames=all.slice(0,60).map(input=>resolveGroundwaterDetailStack(input,materialBase));
 gate('stack order is explicit',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER.includes('groundwater-detail'),true));
 gate('stack frames resolve',()=>assert.equal(stackFrames.length,60));
 gate('stack audits pass',()=>stackFrames.forEach(frame=>assert.equal(detailStackAudit(frame).ok,true)));
 gate('stack health passes',()=>stackFrames.forEach(frame=>assert.equal(detailStackHealth(frame).ok,true)));
 gate('stack statistics are finite',()=>{const s=detailStackStatistics(stackFrames);for(const k of ['wetMean','dryMean','netMean','wetMin','wetMax','dryMin','dryMax','contrast'])assert.ok(finite(s[k]));});
 gate('neighborhood statistics are finite',()=>{const s=detailNeighborhoodStats(details.slice(0,75));for(const k of ['wetMean','dryMean','contrast'])assert.ok(finite(s[k]));});
 gate('neighborhood statistics preserve count',()=>assert.equal(detailNeighborhoodStats(details.slice(0,75)).count,75));
 gate('shader report passes',()=>assert.equal(shaderInvariantReport().ok,true));
 gate('shader replacement report passes',()=>Object.values(groundwaterSurfaceDetailShaderReplacements()).forEach(v=>assert.equal(v,true)));

const sparse={worldX:42,worldZ:17,heightMeters:30,slopeDegrees:8,moisture:undefined,rainfall:undefined,runoff:undefined,soilDepth:undefined,permeability:undefined,waterDistanceMeters:undefined,groundwaterDepthMeters:undefined,wetDays:undefined,dryDays:undefined,dayOfYear:undefined,temperatureC:undefined,drainage:undefined,windExposure:undefined};
 gate('sparse input remains finite',()=>Object.values(resolveTerrainGroundwaterSurfaceDetail(sparse).channels).forEach(v=>assert.ok(bounded(v))));
 gate('detail stack accepts sparse input',()=>assert.equal(detailStackAudit(resolveGroundwaterDetailStack(sparse,materialBase)).ok,true));
 gate('detail material accepts zero channel detail',()=>{const zero={channels:Object.fromEntries(Object.keys(details[0].channels).map(k=>[k,0]))};const m=detailMaterialResponse(zero);assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));});
 gate('detail material accepts full channel detail',()=>{const full={channels:Object.fromEntries(Object.keys(details[0].channels).map(k=>[k,1]))};const m=detailMaterialResponse(full);assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));});
 gate('canonical invariant list has six entries',()=>assert.equal(Object.keys(details[0].canonical).length,6));
 gate('detail policy is render only',()=>assert.equal(details[0].policyId,'terrain-groundwater-surface-detail-2026-09-15-v1'));

console.log(`[groundwater-detail-acceptance] PASS: ${passed} gates across ${all.length} fixtures`);
