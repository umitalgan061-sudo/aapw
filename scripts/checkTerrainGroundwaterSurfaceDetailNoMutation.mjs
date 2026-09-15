#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_DETAIL_POLICY, TERRAIN_GROUNDWATER_DETAIL_CHANNELS, resolveGroundwaterSurfaceDetail, blendSurfaceDetail, detailMaterialResponse, applyDetailEvent, detailCanonicalAudit } from '../src/3d/world/terrainGroundwaterSurfaceDetail.js';
import { TERRAIN_GROUNDWATER_DETAIL_SHADER_INVARIANTS, TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY, TERRAIN_GROUNDWATER_DETAIL_GLSL } from '../src/3d/world/terrainGroundwaterSurfaceDetailShader.js';
import { TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY, TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER, resolveGroundwaterDetailStack, detailStackAudit } from '../src/3d/world/terrainGroundwaterSurfaceDetailStack.js';

const input=Object.freeze({worldX:123,worldZ:-321,heightMeters:62,slopeDegrees:8,moisture:.61,rainfall:.54,runoff:.22,soilDepth:1.4,permeability:.46,waterDistanceMeters:74,groundwaterDepthMeters:21,wetDays:9,dryDays:3,dayOfYear:144,temperatureC:18,drainage:.38,windExposure:.31,substrate:'loam',biome:'temperate'});
let passed=0;
const check=(name,fn)=>{fn();passed+=1;console.log(`[groundwater-detail-ownership] PASS: ${name}`)};

check('detail policy is frozen',()=>assert.ok(Object.isFrozen(TERRAIN_GROUNDWATER_DETAIL_POLICY)));
check('detail channels are frozen',()=>assert.ok(Object.isFrozen(TERRAIN_GROUNDWATER_DETAIL_CHANNELS)));
check('detail shader policy is frozen',()=>assert.ok(Object.isFrozen(TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY)));
check('stack policy is frozen',()=>assert.ok(Object.isFrozen(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY)));
check('detail result is frozen',()=>assert.ok(Object.isFrozen(resolveGroundwaterSurfaceDetail(input))));
check('detail channels object is frozen',()=>assert.ok(Object.isFrozen(resolveGroundwaterSurfaceDetail(input).channels)));
check('detail canonical object is frozen',()=>assert.ok(Object.isFrozen(resolveGroundwaterSurfaceDetail(input).canonical)));
check('detail canonical audit reports zero mutations',()=>assert.equal(detailCanonicalAudit(resolveGroundwaterSurfaceDetail(input)).mutationCount,0));
check('canonical height true',()=>assert.equal(resolveGroundwaterSurfaceDetail(input).canonical.heightUnchanged,true));
check('canonical hydrology true',()=>assert.equal(resolveGroundwaterSurfaceDetail(input).canonical.hydrologyUnchanged,true));
check('canonical coastline true',()=>assert.equal(resolveGroundwaterSurfaceDetail(input).canonical.coastlineUnchanged,true));
check('canonical collider true',()=>assert.equal(resolveGroundwaterSurfaceDetail(input).canonical.colliderUnchanged,true));
check('canonical vegetation true',()=>assert.equal(resolveGroundwaterSurfaceDetail(input).canonical.vegetationPlacementUnchanged,true));
check('new geography false',()=>assert.equal(resolveGroundwaterSurfaceDetail(input).canonical.newGeographyIntroduced,false));

check('shader has no vertex assignment',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('position ='),false));
check('shader has no position increment',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('position +='),false));
check('shader has no height assignment',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('vTerrainLowWorldPosition.y +='),false));
check('shader has no texture write',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('imageStore'),false));
check('shader has no random call',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_GLSL.includes('random('),false));
check('shader invariant includes vertex protection',()=>assert.ok(TERRAIN_GROUNDWATER_DETAIL_SHADER_INVARIANTS.includes('no-vertex-position-write')));
check('shader invariant includes height protection',()=>assert.ok(TERRAIN_GROUNDWATER_DETAIL_SHADER_INVARIANTS.includes('no-height-map-write')));
check('shader invariant includes topology protection',()=>assert.ok(TERRAIN_GROUNDWATER_DETAIL_SHADER_INVARIANTS.includes('no-hydrology-topology-write')));

const a=resolveGroundwaterSurfaceDetail(input);
const b=resolveGroundwaterSurfaceDetail({...input,moisture:.3,temperatureC:30,drainage:.8});
check('blend does not mutate left',()=>{const before=JSON.stringify(a);blendSurfaceDetail(a,b,.5);assert.equal(JSON.stringify(a),before)});
check('blend does not mutate right',()=>{const before=JSON.stringify(b);blendSurfaceDetail(a,b,.5);assert.equal(JSON.stringify(b),before)});
check('material response does not mutate detail',()=>{const before=JSON.stringify(a);detailMaterialResponse(a);assert.equal(JSON.stringify(a),before)});
check('event delta does not mutate detail',()=>{const before=JSON.stringify(a);applyDetailEvent(detailMaterialResponse(a),{color:.1,roughness:.01,normal:.01,wetness:.02});assert.equal(JSON.stringify(a),before)});
check('input is unchanged after resolve',()=>{const before=JSON.stringify(input);resolveGroundwaterSurfaceDetail(input);assert.equal(JSON.stringify(input),before)});
check('stack resolves without input mutation',()=>{const before=JSON.stringify(input);resolveGroundwaterDetailStack(input);assert.equal(JSON.stringify(input),before)});
check('stack order has detail stage',()=>assert.ok(TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER.indexOf('groundwater-detail')>=0));
check('stack audit is positive',()=>assert.equal(detailStackAudit(resolveGroundwaterDetailStack(input)).ok,true));
check('stack policy canonical height true',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.canonicalHeightUnchanged,true));
check('stack policy canonical hydrology true',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.canonicalHydrologyUnchanged,true));
check('stack policy canonical coastline true',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.canonicalCoastlineUnchanged,true));
check('stack policy canonical collider true',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.canonicalColliderUnchanged,true));
check('stack policy canonical vegetation true',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.canonicalVegetationPlacementUnchanged,true));
check('stack policy new geography false',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.newGeographyIntroduced,false));

const material=Object.freeze({color:Object.freeze({r:.4,g:.35,b:.3}),roughness:.86,normalStrength:.01,wetness:.1});
check('material remains unchanged after read',()=>{const before=JSON.stringify(material);detailMaterialResponse(a,material.color,material.roughness);assert.equal(JSON.stringify(material),before)});
check('detail channels remain complete',()=>assert.equal(Object.keys(a.channels).length,14));
check('detail channel ordering is stable',()=>assert.deepEqual(Object.keys(a.channels),[...TERRAIN_GROUNDWATER_DETAIL_CHANNELS]));
check('policy identity stable',()=>assert.equal(a.policyId,TERRAIN_GROUNDWATER_DETAIL_POLICY.id));
check('shader policy identity stable',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY.sourcePolicyId,TERRAIN_GROUNDWATER_DETAIL_POLICY.id));
check('stack policy identity stable',()=>assert.equal(TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.sourcePolicyId,'terrain-groundwater-regime-2026-09-15-v1'));
check('all channels are immutable values',()=>assert.ok(Object.values(a.channels).every(v=>typeof v==='number')));
check('canonical audit stays empty',()=>assert.deepEqual(detailCanonicalAudit(a).failures,[]));
console.log(`[groundwater-detail-ownership] PASS: ${passed} checks`);
