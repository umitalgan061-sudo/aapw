#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveGroundwaterDetailStack, detailStackAudit, detailStackHealth, detailStackEvent, detailStackBlend, detailStackBatch, detailStackStatistics, TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER } from '../src/3d/world/terrainGroundwaterSurfaceDetailStack.js';
import { installTerrainGroundwaterSurfaceDetailShader, shaderInvariantReport } from '../src/3d/world/terrainGroundwaterSurfaceDetailShader.js';
import { resolveGroundwaterSurfaceDetail, detailEnvelope, detailCanonicalAudit, detailMaterialResponse } from '../src/3d/world/terrainGroundwaterSurfaceDetail.js';
import { diagnosticQuickCheck, diagnosticRunManifest } from '../src/3d/world/terrainGroundwaterSurfaceDetailDiagnostics.js';
const base={color:{r:.42,g:.35,b:.28},roughness:.86,normalStrength:0,wetness:0};
const input={worldX:210,worldZ:-330,heightMeters:46,slopeDegrees:6,moisture:.66,rainfall:.71,runoff:.26,soilDepth:1.45,permeability:.43,waterDistanceMeters:37,groundwaterDepthMeters:12,wetDays:13,dryDays:2,dayOfYear:88,temperatureC:14,drainage:.29,windExposure:.22,biome:'temperate',substrate:'loam'};
let passed=0;
const gate=(name,fn)=>{fn();passed+=1;console.log(`[groundwater-detail-integration] PASS: ${name}`)};

gate('detail stack order contains groundwater stage',()=>assert.ok(TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER.includes('groundwater')));
gate('detail stack order contains detail stage',()=>assert.ok(TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER.includes('groundwater-detail')));
gate('detail stack order keeps final budget after detail',()=>assert.ok(TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER.indexOf('material-budget')>TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER.indexOf('groundwater-detail')));
const frame=resolveGroundwaterDetailStack(input,base);
gate('stack frame policy is exact',()=>assert.equal(frame.policyId,'terrain-groundwater-surface-detail-stack-2026-09-15-v1'));
gate('stack frame source is exact',()=>assert.equal(frame.sourcePolicyId,'terrain-groundwater-regime-2026-09-15-v1'));
gate('stack frame audit passes',()=>assert.equal(detailStackAudit(frame).ok,true));
gate('stack frame health passes',()=>assert.equal(detailStackHealth(frame).ok,true));
gate('stack frame detail envelope passes',()=>assert.equal(detailEnvelope(frame.detail).ok,true));
gate('stack frame detail canonical passes',()=>assert.equal(detailCanonicalAudit(frame.detail).ok,true));
gate('stack material roughness bounded',()=>assert.ok(frame.material.roughness>=0&&frame.material.roughness<=1));
gate('stack material normal bounded',()=>assert.ok(frame.material.normalStrength>=0&&frame.material.normalStrength<=1));
gate('stack material wetness bounded',()=>assert.ok(frame.material.wetness>=0&&frame.material.wetness<=1));
gate('stack signature exists',()=>assert.equal(typeof frame.signature,'object'));
gate('stack hydro balance finite',()=>assert.ok(Number.isFinite(frame.hydroBalance.net)));

for(const type of ['storm','drought','freeze-thaw','snowmelt','recovery']) gate(`stack event ${type}`,()=>{const out=detailStackEvent(frame,{type,intensity:.75});assert.ok(out.material.roughness>=0&&out.material.roughness<=1);assert.ok(out.material.normalStrength>=0&&out.material.normalStrength<=1);assert.ok(out.material.wetness>=0&&out.material.wetness<=1)});
const second=resolveGroundwaterDetailStack({...input,moisture:.3,temperatureC:29,drainage:.82},base);
gate('stack blend audit',()=>assert.equal(detailStackBlend(frame,second,.5).canonical.heightUnchanged,true));
gate('stack blend material bounded',()=>{const m=detailStackBlend(frame,second,.5).material;assert.ok(m.roughness>=0&&m.roughness<=1);assert.ok(m.normalStrength>=0&&m.normalStrength<=1);assert.ok(m.wetness>=0&&m.wetness<=1)});
gate('stack blend inputs remain unchanged',()=>{const before=JSON.stringify(frame);detailStackBlend(frame,second,.5);assert.equal(JSON.stringify(frame),before)});
gate('stack batch preserves count',()=>assert.equal(detailStackBatch([input,second],base).length,2));
gate('stack statistics count',()=>assert.equal(detailStackStatistics([frame,second]).count,2));
gate('stack statistics finite',()=>{const s=detailStackStatistics([frame,second]);assert.ok(Number.isFinite(s.wetMean));assert.ok(Number.isFinite(s.dryMean));assert.ok(Number.isFinite(s.netMean))});

gate('diagnostic quick check passes',()=>assert.equal(diagnosticQuickCheck(input).ok,true));
gate('diagnostic manifest is explicit',()=>{const m=diagnosticRunManifest(2);assert.equal(m.inputCount,2);assert.ok(m.stages.length>=10)});
gate('shader invariant report passes',()=>assert.equal(shaderInvariantReport().ok,true));
gate('shader installation is idempotent',()=>{const material={userData:{},customProgramCacheKey:()=>''};const first=installTerrainGroundwaterSurfaceDetailShader(material);const secondInstall=installTerrainGroundwaterSurfaceDetailShader(first);assert.equal(first,secondInstall);assert.equal(first.userData.terrainGroundwaterSurfaceDetailShaderInstalled,true)});
gate('base material response remains bounded',()=>{const d=resolveGroundwaterSurfaceDetail(input),m=detailMaterialResponse(d,base.color,base.roughness);assert.ok(m.roughness>=0&&m.roughness<=1);assert.ok(m.normalStrength>=0&&m.normalStrength<=1);assert.ok(m.wetness>=0&&m.wetness<=1)});
console.log(`[groundwater-detail-integration] PASS: ${passed} checks`);
