import assert from 'node:assert/strict';
import { TERRAIN_ENVIRONMENT_PRODUCTION_GATE, evaluateEnvironmentProductionRequest } from '../src/3d/world/terrainEnvironmentProductionGate.js';
import { TERRAIN_ENVIRONMENT_ASSET_MANIFEST } from '../src/3d/world/terrainEnvironmentAssetManifest.js';
const sample={worldX:160,worldZ:90,heightMeters:34,heightAboveSeaMeters:26,slopeDegrees:7,rockWeight:.08,snowWeight:0,waterWeight:.01,moisture:.65,biome:'forest',waterDepth:0,concavityMeters:.1,climate:'temperate',settlementDistanceMeters:260,roadDistanceMeters:35,distanceFromGroveCenterMeters:45,groveRadiusMeters:160};
const report=evaluateEnvironmentProductionRequest({category:'tree',assetManifest:TERRAIN_ENVIRONMENT_ASSET_MANIFEST,biome:'forest',season:'temperate-winter',winter:true,context:'temperate',sample,distanceMeters:40,importance:1,seed:31});
assert.equal(TERRAIN_ENVIRONMENT_PRODUCTION_GATE.placeholderAllowed,false);assert.ok(report.selection?.entry?.src);assert.equal(report.selectionValidation.ok,true);assert.equal(report.lod.category,'tree');assert.equal(report.culled,false);assert.ok(Number.isFinite(report.readiness));
console.log(JSON.stringify({ok:true,asset:report.selection.entry.src,readiness:report.readiness,lod:report.lod.detail,errors:report.errors}));
