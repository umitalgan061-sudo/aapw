import assert from 'node:assert/strict';
import { TERRAIN_GROUNDWATER_V2_POLICY, TERRAIN_GROUNDWATER_V2_SUBSTRATE, normalizeGroundwaterV2, rechargeV2, waterTableV2, capillaryV2, seepageV2, springV2, surfaceWaterV2, resolveGroundwaterV2, groundwaterSignatureV2, validateGroundwaterV2 } from '../src/3d/world/terrainGroundwaterSurfaceV2.js';

assert.equal(TERRAIN_GROUNDWATER_V2_POLICY.renderOnly,true);
assert.equal(TERRAIN_GROUNDWATER_V2_POLICY.deterministic,true);
assert.equal(TERRAIN_GROUNDWATER_V2_POLICY.canonicalHeightUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_V2_POLICY.canonicalHydrologyUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_V2_POLICY.canonicalCoastlineUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_V2_POLICY.canonicalColliderUnchanged,true);
assert.equal(TERRAIN_GROUNDWATER_V2_POLICY.canonicalVegetationPlacementUnchanged,true);

const substrates=Object.keys(TERRAIN_GROUNDWATER_V2_SUBSTRATE);
assert.equal(substrates.length,16);
for(const key of substrates){
  const row=TERRAIN_GROUNDWATER_V2_SUBSTRATE[key];
  assert.equal(row.length,5,`invalid substrate tuple ${key}`);
  for(const value of row)assert(value>=0&&value<=1,`substrate bound ${key}`);
}

const points=[
  {worldX:0,worldZ:0,heightMeters:22,slopeDegrees:3,moisture:.78,rainfall:.72,soilDepth:.74,substrate:'alluvium'},
  {worldX:120,worldZ:-80,heightMeters:91,slopeDegrees:36,moisture:.26,rainfall:.31,soilDepth:.24,substrate:'granite'},
  {worldX:-640,worldZ:440,heightMeters:47,slopeDegrees:11,moisture:.58,rainfall:.61,soilDepth:.61,substrate:'sandstone'},
  {worldX:830,worldZ:190,heightMeters:134,slopeDegrees:18,moisture:.44,rainfall:.49,soilDepth:.44,substrate:'shale'},
  {worldX:-210,worldZ:-390,heightMeters:12,slopeDegrees:2,moisture:.91,rainfall:.84,soilDepth:.82,substrate:'peat'},
  {worldX:510,worldZ:-740,heightMeters:166,slopeDegrees:42,moisture:.18,rainfall:.23,soilDepth:.13,substrate:'gravel'},
];

function checkFiniteRange(name,value){assert(Number.isFinite(value),`${name} finite`);assert(value>=0&&value<=1,`${name} [0,1]`);}

for(const point of points){
  const normalized=normalizeGroundwaterV2(point);
  const recharge=rechargeV2(normalized,{rainfall:point.rainfall,stormPulse:.18});
  assert(recharge.recharge>=0&&recharge.recharge<=1);
  const table=waterTableV2(normalized,recharge);
  assert(table.depthMeters>=2&&table.depthMeters<=84);
  const capillary=capillaryV2(normalized,table);
  checkFiniteRange('capillary',capillary.rise);
  const seepage=seepageV2(normalized,table,capillary);
  checkFiniteRange('seepage',seepage.seepage);
  const spring=springV2(normalized,table,seepage);
  checkFiniteRange('spring',spring.emergence);
  const surface=surfaceWaterV2(normalized,table,seepage);
  checkFiniteRange('wet',surface.wet);
  checkFiniteRange('sheen',surface.sheen);
  checkFiniteRange('mud',surface.mud);
  checkFiniteRange('standing',surface.standing);
  const state=resolveGroundwaterV2(point);
  assert.equal(state.canonicalTerrainUntouched,true);
  assert.equal(validateGroundwaterV2(state).ok,true);
}

for(const point of points){
  const a=groundwaterSignatureV2(point);
  const b=groundwaterSignatureV2({...point});
  assert.deepEqual(a,b,`determinism ${point.worldX}:${point.worldZ}`);
}

for(const substrate of substrates){
  const base={worldX:321,worldZ:-654,heightMeters:55,slopeDegrees:8,moisture:.62,rainfall:.57,soilDepth:.55,substrate};
  const wet=resolveGroundwaterV2({...base,moisture:.92,rainfall:.88});
  const dry=resolveGroundwaterV2({...base,moisture:.12,rainfall:.18});
  assert.notDeepEqual(wet.surface,dry.surface,`surface response must react to moisture: ${substrate}`);
}

const flat=resolveGroundwaterV2({worldX:0,worldZ:0,heightMeters:25,slopeDegrees:2,moisture:.9,rainfall:.9,soilDepth:.9,substrate:'clay'});
const steep=resolveGroundwaterV2({worldX:0,worldZ:0,heightMeters:25,slopeDegrees:38,moisture:.9,rainfall:.9,soilDepth:.9,substrate:'clay'});
assert(steep.recharge.recharge<flat.recharge.recharge,'steep terrain should reduce retained recharge');
assert(steep.recharge.runoff>flat.recharge.runoff,'steep terrain should increase runoff');

const impermeable=resolveGroundwaterV2({worldX:90,worldZ:15,heightMeters:44,slopeDegrees:7,moisture:.82,rainfall:.71,soilDepth:.55,substrate:'clay'});
const permeable=resolveGroundwaterV2({worldX:90,worldZ:15,heightMeters:44,slopeDegrees:7,moisture:.82,rainfall:.71,soilDepth:.55,substrate:'gravel'});
assert(impermeable.seepage.seepage>=0&&permeable.seepage.seepage>=0);
assert.notEqual(impermeable.waterTable.depthMeters,permeable.waterTable.depthMeters);

console.log(JSON.stringify({ok:true,policy:TERRAIN_GROUNDWATER_V2_POLICY.id,substrates:substrates.length,points:points.length,checks:'deterministic-boundary-range-slope-substrate'}));
