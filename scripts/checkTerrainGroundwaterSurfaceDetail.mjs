#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  TERRAIN_GROUNDWATER_DETAIL_POLICY,
  TERRAIN_GROUNDWATER_DETAIL_CHANNELS,
  TERRAIN_GROUNDWATER_DETAIL_CANONICAL_INVARIANTS,
  resolveGroundwaterSurfaceDetail,
  blendSurfaceDetail,
  detailMaterialResponse,
  detailEventDelta,
  applyDetailEvent,
  detailCanonicalAudit,
  detailSignature,
  compareSurfaceDetails,
  surfaceDetailDistance,
  classifySurfaceDetail,
  detailEnvelope,
  detailWeightedWetness,
  detailDrynessRisk,
  detailHydroBalance,
  detailRenderTier,
  detailTelemetry,
  detailGrid,
  detailNeighborhoodStats,
} from '../src/3d/world/terrainGroundwaterSurfaceDetail.js';
import { groundwaterSurfaceDetailShaderReplacements, shaderInvariantReport } from '../src/3d/world/terrainGroundwaterSurfaceDetailShader.js';

const BASE = Object.freeze({ worldX: 120, worldZ: -80, heightMeters: 42, slopeDegrees: 6, moisture: .58, rainfall: .62, runoff: .18, soilDepth: 1.35, permeability: .46, waterDistanceMeters: 38, groundwaterDepthMeters: 14, wetDays: 10, dryDays: 3, dayOfYear: 143, temperatureC: 14, drainage: .42, windExposure: .34, substrate: 'loam', biome: 'temperate' });
let checks = 0;
function check(name, fn){ fn(); checks += 1; console.log(`[groundwater-detail] PASS: ${name}`); }
function bounded(value,label){ assert.ok(Number.isFinite(value),`${label} finite`); assert.ok(value>=0&&value<=1,`${label} bounded`); }

check('policy is frozen',()=>assert.equal(Object.isFrozen(TERRAIN_GROUNDWATER_DETAIL_POLICY),true));
check('channel contract is frozen',()=>{assert.equal(Object.isFrozen(TERRAIN_GROUNDWATER_DETAIL_CHANNELS),true);assert.equal(TERRAIN_GROUNDWATER_DETAIL_CHANNELS.length,14);});
check('canonical invariant contract',()=>assert.deepEqual(TERRAIN_GROUNDWATER_DETAIL_CANONICAL_INVARIANTS,['canonicalHeightUnchanged','canonicalHydrologyUnchanged','canonicalCoastlineUnchanged','canonicalColliderUnchanged','canonicalVegetationPlacementUnchanged','newGeographyIntroduced:false']));

const detail=resolveGroundwaterSurfaceDetail(BASE);
check('detail resolves',()=>assert.equal(detail.policyId,TERRAIN_GROUNDWATER_DETAIL_POLICY.id));
check('state remains sourced from groundwater',()=>assert.equal(detail.state.policyId,'terrain-groundwater-regime-2026-09-15-v1'));
check('detail channels cover contract',()=>assert.deepEqual(Object.keys(detail.channels),[...TERRAIN_GROUNDWATER_DETAIL_CHANNELS]));
check('all detail channels are bounded',()=>TERRAIN_GROUNDWATER_DETAIL_CHANNELS.forEach(k=>bounded(detail.channels[k],k)));
check('envelope passes',()=>assert.equal(detailEnvelope(detail).ok,true));
check('canonical audit passes',()=>assert.equal(detailCanonicalAudit(detail).ok,true));
check('telemetry is deterministic',()=>assert.deepEqual(detailTelemetry(BASE),detailTelemetry(BASE)));
check('signature is deterministic',()=>assert.deepEqual(detailSignature(detail),detailSignature(resolveGroundwaterSurfaceDetail(BASE))));
check('distance to self is zero',()=>assert.ok(surfaceDetailDistance(detail,detail)<1e-12));
check('compare self is zero',()=>assert.ok(Object.values(compareSurfaceDetails(detail,detail)).every(v=>v===0)));

for(const slope of [0,1.5,3,6,9,14,22,31,45,60,89]) check(`slope-${slope}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,slopeDegrees:slope});for(const key of TERRAIN_GROUNDWATER_DETAIL_CHANNELS)bounded(d.channels[key],`${key}@${slope}`);});
for(const heightMeters of [-30,0,8,20,42,90,180,400,1200,2200,5000]) check(`height-${heightMeters}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,heightMeters});assert.equal(detailEnvelope(d).ok,true);});
for(const temperatureC of [-40,-15,-5,0,5,12,20,35,55]) check(`temperature-${temperatureC}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,temperatureC});assert.equal(detailEnvelope(d).ok,true);});
for(const dayOfYear of [-720,-360,-1,0,1,89,179,269,359,360,721]) check(`day-${dayOfYear}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,dayOfYear});assert.equal(detailEnvelope(d).ok,true);});
for(const moisture of [0,.1,.25,.5,.75,.9,1]) check(`moisture-${moisture}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,moisture});assert.equal(detailEnvelope(d).ok,true);});
for(const rainfall of [0,.15,.35,.55,.75,.9,1]) check(`rain-${rainfall}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,rainfall});assert.equal(detailEnvelope(d).ok,true);});
for(const runoff of [0,.1,.3,.6,.9,1]) check(`runoff-${runoff}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,runoff});assert.equal(detailEnvelope(d).ok,true);});
for(const drainage of [0,.1,.3,.5,.75,.95,1]) check(`drainage-${drainage}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,drainage});assert.equal(detailEnvelope(d).ok,true);});
for(const windExposure of [0,.2,.45,.7,.9,1]) check(`wind-${windExposure}`,()=>{const d=resolveGroundwaterSurfaceDetail({...BASE,windExposure});assert.equal(detailEnvelope(d).ok,true);});

check('extreme environment remains bounded',()=>{
  const d=resolveGroundwaterSurfaceDetail({worldX:1e9,worldZ:-1e9,heightMeters:1e9,slopeDegrees:999,moisture:999,rainfall:-999,runoff:999,soilDepth:999,permeability:-1,waterDistanceMeters:99999,groundwaterDepthMeters:99999,wetDays:9999,dryDays:9999,dayOfYear:9999,temperatureC:999,drainage:999,windExposure:-1});
  assert.equal(detailEnvelope(d).ok,true);
});

check('blend zero returns left',()=>assert.deepEqual(blendSurfaceDetail(detail,resolveGroundwaterSurfaceDetail({...BASE,moisture:.1}),0).channels,detail.channels));
check('blend one returns right',()=>{const right=resolveGroundwaterSurfaceDetail({...BASE,moisture:.1});assert.deepEqual(blendSurfaceDetail(detail,right,1).channels,right.channels);});
check('blend is bounded',()=>TERRAIN_GROUNDWATER_DETAIL_CHANNELS.forEach(k=>bounded(blendSurfaceDetail(detail,resolveGroundwaterSurfaceDetail({...BASE,slopeDegrees:32}),.5).channels[k],`blend:${k}`)));
check('blend clamps negative mix',()=>assert.deepEqual(blendSurfaceDetail(detail,resolveGroundwaterSurfaceDetail({...BASE,slopeDegrees:32}),-1).channels,detail.channels));
check('blend clamps high mix',()=>{const right=resolveGroundwaterSurfaceDetail({...BASE,slopeDegrees:32});assert.deepEqual(blendSurfaceDetail(detail,right,2).channels,right.channels);});

const material=detailMaterialResponse(detail);
check('material channels finite',()=>{for(const key of ['r','g','b'])assert.ok(Number.isFinite(material.color[key]));assert.ok(Number.isFinite(material.roughness));assert.ok(Number.isFinite(material.normalStrength));assert.ok(Number.isFinite(material.wetness));});
check('material is bounded',()=>{for(const key of ['r','g','b'])bounded(material.color[key],`color.${key}`);bounded(material.roughness,'roughness');bounded(material.normalStrength,'normalStrength');bounded(material.wetness,'wetness');});
check('event neutral is zero',()=>assert.deepEqual(detailEventDelta(detail,{type:'neutral',intensity:.5}),{color:0,roughness:0,normal:0,wetness:0}));
for(const type of ['storm','drought','freeze-thaw','snowmelt','recovery']) for(const intensity of [0,.25,.5,.75,1]) check(`event-${type}-${intensity}`,()=>{const delta=detailEventDelta(detail,{type,intensity});for(const value of Object.values(delta))assert.ok(Number.isFinite(value));const out=applyDetailEvent(material,delta);assert.ok(Number.isFinite(out.roughness));assert.ok(Number.isFinite(out.normalStrength));bounded(out.roughness,`${type}.roughness`);bounded(out.normalStrength,`${type}.normal`);bounded(out.wetness,`${type}.wetness`);});

check('classification is known',()=>assert.ok(['puddle-core','marsh-transition','seepage-band','evaporative-crust','capillary-damp','freeze-wet-edge','drying-front','wet-rim','neutral'].includes(classifySurfaceDetail(detail))));
check('weighted wetness is bounded',()=>bounded(detailWeightedWetness(detail),'weightedWetness'));
check('dryness risk is bounded',()=>bounded(detailDrynessRisk(detail),'drynessRisk'));
check('hydro balance is finite',()=>{const balance=detailHydroBalance(detail);assert.ok(Number.isFinite(balance.net));assert.ok(balance.net<=1&&balance.net>=-1);});
check('render tier is known',()=>assert.ok(['suppressed','low','medium','high'].includes(detailRenderTier(detail))));
check('detail grid respects dimensions',()=>assert.equal(detailGrid({columns:6,rows:4}).length,24));
check('detail grid is bounded',()=>detailGrid({columns:6,rows:4}).forEach(row=>{bounded(row.wetness,'grid.wetness');bounded(row.dryness,'grid.dryness');}));
check('neighborhood stats empty is safe',()=>assert.deepEqual(detailNeighborhoodStats([]),{count:0,wetMean:0,wetMin:0,wetMax:0,dryMean:0,dryMin:0,dryMax:0,contrast:0}));
check('neighborhood stats computes contrast',()=>{const details=[...Array(12)].map((_,i)=>resolveGroundwaterSurfaceDetail({...BASE,worldX:BASE.worldX+i*17}));const stats=detailNeighborhoodStats(details);assert.equal(stats.count,12);assert.ok(stats.contrast>=0);});

check('shader common payload exists',()=>assert.equal(groundwaterSurfaceDetailShaderReplacements().common,true));
check('shader color hook exists',()=>assert.equal(groundwaterSurfaceDetailShaderReplacements().color,true));
check('shader roughness hook exists',()=>assert.equal(groundwaterSurfaceDetailShaderReplacements().roughness,true));
check('shader normal hook exists',()=>assert.equal(groundwaterSurfaceDetailShaderReplacements().normal,true));
check('shader has no vertex displacement',()=>assert.equal(groundwaterSurfaceDetailShaderReplacements().vertexDisplacement,true));
check('shader has no height write',()=>assert.equal(groundwaterSurfaceDetailShaderReplacements().heightWrite,true));
check('shader invariant report passes',()=>assert.equal(shaderInvariantReport().ok,true));

console.log(`[groundwater-detail] PASS: ${checks} checks`);
