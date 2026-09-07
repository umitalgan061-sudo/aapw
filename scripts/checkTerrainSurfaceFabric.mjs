import assert from 'node:assert/strict';
import { TERRAIN_SURFACE_FABRIC_POLICY, terrainSurfaceNoise, terrainSurfaceReliefContext, terrainSurfaceColorMultiplier, terrainSurfaceRoughness, terrainSurfaceNormalGain, chooseTerrainSubstrate, validateTerrainSurfaceFabricPolicy } from '../src/3d/world/terrainSurfaceFabric.js';
import { TERRAIN_ENVIRONMENT_VISUAL_ENVELOPE, evaluateTerrainSurfaceSample, compareSurfaceSamples } from '../src/3d/world/terrainEnvironmentVisualEnvelope.js';
assert.equal(validateTerrainSurfaceFabricPolicy().ok,true);
assert.deepEqual(terrainSurfaceNoise(10,20),terrainSurfaceNoise(10,20));
assert.notDeepEqual(terrainSurfaceNoise(10,20),terrainSurfaceNoise(230,20));
const cases=[
 {worldX:0,worldZ:0,heightAboveSeaMeters:5,slopeDegrees:5,rockWeight:.05,snowWeight:0,waterWeight:.4,concavityMeters:-1},
 {worldX:800,worldZ:-350,heightAboveSeaMeters:42,slopeDegrees:11,rockWeight:.04,snowWeight:0,waterWeight:.01,concavityMeters:.4},
 {worldX:-1200,worldZ:1100,heightAboveSeaMeters:240,slopeDegrees:43,rockWeight:.61,snowWeight:.32,waterWeight:0,concavityMeters:2},
 {worldX:2100,worldZ:1800,heightAboveSeaMeters:470,slopeDegrees:31,rockWeight:.55,snowWeight:.83,waterWeight:0,concavityMeters:1.2},
];
for(const sample of cases){const c=terrainSurfaceReliefContext(sample);assert.ok(Number.isFinite(terrainSurfaceColorMultiplier(c)));assert.ok(terrainSurfaceRoughness(c)>=.48&&terrainSurfaceRoughness(c)<=1);assert.ok(terrainSurfaceNormalGain(c)>=.02&&terrainSurfaceNormalGain(c)<=.18);assert.ok(typeof chooseTerrainSubstrate(c)==='string');assert.equal(evaluateTerrainSurfaceSample(sample).ok,true);}
const a=compareSurfaceSamples(cases[1],cases[2]);assert.ok(Number.isFinite(a.delta.colorMultiplier));assert.ok(Number.isFinite(a.delta.roughness));assert.ok(Number.isFinite(a.delta.normalGain));
assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.renderOnly,true);assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHeightUnchanged,true);assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.canonicalHydrologyUnchanged,true);assert.equal(TERRAIN_SURFACE_FABRIC_POLICY.periodicDetailTextureIsSupplemental,true);
assert.ok(TERRAIN_ENVIRONMENT_VISUAL_ENVELOPE.nearGround.minNormalGain>0);
console.log(JSON.stringify({ok:true,samples:cases.length,policy:TERRAIN_SURFACE_FABRIC_POLICY.id}));
