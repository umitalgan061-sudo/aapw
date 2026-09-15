#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveGroundwaterSurfaceDetail, detailGrid, detailNeighborhoodStats, detailSignature, detailMaterialResponse } from '../src/3d/world/terrainGroundwaterSurfaceDetail.js';
import { resolveGroundwaterDetailStack, detailStackBatch, detailStackStatistics } from '../src/3d/world/terrainGroundwaterSurfaceDetailStack.js';
import { diagnosticBatch, diagnosticBatchSummary } from '../src/3d/world/terrainGroundwaterSurfaceDetailDiagnostics.js';
import { TERRAIN_GROUNDWATER_DETAIL_SCENARIOS } from '../src/3d/world/terrainGroundwaterSurfaceDetailScenarioCatalog.js';

const base={color:{r:.43,g:.36,b:.29},roughness:.86,normalStrength:0,wetness:0};
const inputs=TERRAIN_GROUNDWATER_DETAIL_SCENARIOS.slice(0,72).map(c=>({worldX:c.worldX,worldZ:c.worldZ,heightMeters:c.height,slopeDegrees:c.slope,moisture:c.moisture,rainfall:c.rain,runoff:c.runoff,soilDepth:c.soil,permeability:c.perm,waterDistanceMeters:c.water,groundwaterDepthMeters:c.table,wetDays:c.wetDays,dryDays:c.dryDays,temperatureC:c.temp,drainage:c.drain,windExposure:c.wind,dayOfYear:c.day}));
let passed=0;
const check=(name,fn)=>{fn();passed+=1;console.log(`[groundwater-detail-performance] PASS: ${name}`)};
const bounded=v=>Number.isFinite(Number(v))&&Number(v)>=0&&Number(v)<=1;

check('scenario input count is bounded',()=>assert.ok(inputs.length>0&&inputs.length<=100));
check('single resolve is finite',()=>Object.values(resolveGroundwaterSurfaceDetail(inputs[0]).channels).forEach(v=>assert.ok(bounded(v))));
check('single material response is bounded',()=>{const m=detailMaterialResponse(resolveGroundwaterSurfaceDetail(inputs[0]),base.color,base.roughness);assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness));});
check('signature key order is stable',()=>{const a=Object.keys(detailSignature(resolveGroundwaterSurfaceDetail(inputs[0])));const b=Object.keys(detailSignature(resolveGroundwaterSurfaceDetail(inputs[0])));assert.deepEqual(a,b)});
check('grid default produces 25 cells',()=>assert.equal(detailGrid({}).length,25));
check('grid forty by forty is capped exactly',()=>assert.equal(detailGrid({columns:40,rows:40}).length,1600));
check('grid oversized columns are capped',()=>assert.equal(detailGrid({columns:100,rows:2}).length,80));
check('grid oversized rows are capped',()=>assert.equal(detailGrid({columns:2,rows:100}).length,80));
check('neighborhood stats scale with input count',()=>{const ds=inputs.slice(0,32).map(resolveGroundwaterSurfaceDetail);assert.equal(detailNeighborhoodStats(ds).count,32)});
check('stack batch preserves count',()=>assert.equal(detailStackBatch(inputs.slice(0,32),base).length,32));
check('stack batch empty is safe',()=>assert.equal(detailStackBatch([],base).length,0));
check('stack statistics preserve count',()=>assert.equal(detailStackStatistics(inputs.slice(0,16).map(i=>resolveGroundwaterDetailStack(i,base))).count,16));
check('diagnostic batch preserves count',()=>assert.equal(diagnosticBatch(inputs.slice(0,24),base).length,24));
check('diagnostic summary reaches full pass rate',()=>{const s=diagnosticBatchSummary(diagnosticBatch(inputs.slice(0,24),base));assert.equal(s.failed,0);assert.equal(s.passRate,1)});
check('repeated resolves remain deterministic',()=>{for(let i=0;i<inputs.length;i+=1){const a=resolveGroundwaterSurfaceDetail(inputs[i]);const b=resolveGroundwaterSurfaceDetail({...inputs[i]});assert.deepEqual(detailSignature(a),detailSignature(b))}});
check('material evaluation remains finite over corpus',()=>inputs.forEach(i=>{const m=detailMaterialResponse(resolveGroundwaterSurfaceDetail(i),base.color,base.roughness);assert.ok(Object.values(m.color).every(bounded));assert.ok(bounded(m.roughness));assert.ok(bounded(m.normalStrength));assert.ok(bounded(m.wetness))}));
check('grid values remain bounded',()=>detailGrid({originX:120,originZ:-80,columns:12,rows:8}).forEach(c=>{assert.ok(bounded(c.wetness));assert.ok(bounded(c.dryness))}));
check('neighborhood values remain bounded',()=>{const s=detailNeighborhoodStats(inputs.map(resolveGroundwaterSurfaceDetail));assert.ok(bounded(s.wetMean));assert.ok(bounded(s.wetMin));assert.ok(bounded(s.wetMax));assert.ok(bounded(s.dryMean));assert.ok(bounded(s.dryMin));assert.ok(bounded(s.dryMax));assert.ok(bounded(s.contrast))});
console.log(`[groundwater-detail-performance] PASS: ${passed} checks over ${inputs.length} scenario inputs`);
