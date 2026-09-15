import assert from 'node:assert/strict';
import { resolveGroundwaterHookState, groundwaterSurfaceIntent, attachGroundwaterTelemetry, groundwaterHookSnapshot, TERRAIN_GROUNDWATER_HOOK_POLICY } from '../src/3d/world/terrainGroundwaterSurfaceHook.js';

assert.equal(TERRAIN_GROUNDWATER_HOOK_POLICY.renderOnly,true);
assert.equal(TERRAIN_GROUNDWATER_HOOK_POLICY.deterministic,true);
assert.equal(TERRAIN_GROUNDWATER_HOOK_POLICY.canonicalHeightUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_HOOK_POLICY.canonicalHydrologyUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_HOOK_POLICY.canonicalCoastlineUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_HOOK_POLICY.canonicalColliderUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_HOOK_POLICY.canonicalVegetationPlacementUnchanged,true);

const samples=[
 {worldX:0,worldZ:0,heightMeters:30,slopeDegrees:3,moisture:.72,rainfall:.68,soilDepth:.72,vegetationCover:.6,substrate:'alluvium'},
 {worldX:400,worldZ:-220,heightMeters:74,slopeDegrees:12,moisture:.52,rainfall:.55,soilDepth:.48,vegetationCover:.44,substrate:'sandstone'},
 {worldX:-700,worldZ:160,heightMeters:116,slopeDegrees:28,moisture:.31,rainfall:.37,soilDepth:.22,vegetationCover:.2,substrate:'granite'},
 {worldX:900,worldZ:510,heightMeters:14,slopeDegrees:2,moisture:.91,rainfall:.82,soilDepth:.86,vegetationCover:.74,substrate:'peat'},
];
for(const input of samples){
 const hook=resolveGroundwaterHookState(input);
 const intent=groundwaterSurfaceIntent(input);
 assert.equal(hook.canonicalTerrainUntouched,true);
 for(const value of [intent.wetBlend,intent.sheenBlend,intent.mudBlend,intent.seepageBlend,intent.springBlend,intent.waterlineBlend,intent.normalEnergy])assert(value>=0&&value<=1);
 const telemetry=attachGroundwaterTelemetry({existing:true},hook.state);
 assert.equal(telemetry.existing,true);
 assert.equal(telemetry.terrainGroundwaterRenderOnly,true);
 assert.equal(telemetry.terrainGroundwaterCanonicalTerrainUntouched,true);
 assert(Number.isFinite(telemetry.terrainGroundwaterDepthMeters));
}
const snapshot=groundwaterHookSnapshot();
assert.equal(snapshot.policy.id,TERRAIN_GROUNDWATER_HOOK_POLICY.id);
assert.equal(snapshot.activePolicy.deterministic,true);
console.log(JSON.stringify({ok:true,policy:TERRAIN_GROUNDWATER_HOOK_POLICY.id,cases:samples.length}));
