import assert from 'node:assert/strict';
import { TERRAIN_SEDIMENT_POLICY } from '../src/3d/world/terrainSurfaceSediment.js';
import { TERRAIN_CLIMATE_EXPOSURE_GLSL } from '../src/3d/world/terrainSurfaceClimateExposure.js';
import { TERRAIN_AEOLIAN_DUST_GLSL } from '../src/3d/world/terrainSurfaceAeolianDust.js';
import { TERRAIN_WEATHERING_GLSL } from '../src/3d/world/terrainSurfaceWeathering.js';
import { TERRAIN_WIND_EXPOSURE_GLSL } from '../src/3d/world/terrainSurfaceWindExposure.js';
import { TERRAIN_THERMAL_MICROCLIMATE_GLSL } from '../src/3d/world/terrainSurfaceThermalMicroclimate.js';
const markers = [
  [TERRAIN_CLIMATE_EXPOSURE_GLSL,'terrainClimateApplyColor'],
  [TERRAIN_CLIMATE_EXPOSURE_GLSL,'terrainClimateApplyRoughness'],
  [TERRAIN_CLIMATE_EXPOSURE_GLSL,'terrainClimateApplyNormal'],
  [TERRAIN_AEOLIAN_DUST_GLSL,'terrainAeolianDustApplyColor'],
  [TERRAIN_AEOLIAN_DUST_GLSL,'terrainAeolianDustApplyRoughness'],
  [TERRAIN_AEOLIAN_DUST_GLSL,'terrainAeolianDustApplyNormal'],
  [TERRAIN_WEATHERING_GLSL,'terrainWeatheringApplyColor'],
  [TERRAIN_WEATHERING_GLSL,'terrainWeatheringApplyRoughness'],
  [TERRAIN_WEATHERING_GLSL,'terrainWeatheringApplyNormal'],
  [TERRAIN_WIND_EXPOSURE_GLSL,'terrainWindExposureApplyColor'],
  [TERRAIN_WIND_EXPOSURE_GLSL,'terrainWindExposureApplyRoughness'],
  [TERRAIN_WIND_EXPOSURE_GLSL,'terrainWindExposureApplyNormal'],
  [TERRAIN_THERMAL_MICROCLIMATE_GLSL,'terrainThermalApplyColor'],
  [TERRAIN_THERMAL_MICROCLIMATE_GLSL,'terrainThermalApplyRoughness'],
  [TERRAIN_THERMAL_MICROCLIMATE_GLSL,'terrainThermalApplyNormal'],
];
for(const [shader,marker] of markers){assert.equal(shader.includes(marker),true,`missing GLSL marker: ${marker}`);assert.equal(shader.includes('NaN'),false,`${marker} contains NaN`);assert.equal(shader.includes('Infinity'),false,`${marker} contains Infinity`);}
for(const shader of [TERRAIN_CLIMATE_EXPOSURE_GLSL,TERRAIN_AEOLIAN_DUST_GLSL,TERRAIN_WEATHERING_GLSL,TERRAIN_WIND_EXPOSURE_GLSL,TERRAIN_THERMAL_MICROCLIMATE_GLSL]){assert(shader.includes('normalize'));assert(shader.includes('clamp'));assert(shader.length<20000);}
assert.equal(TERRAIN_SEDIMENT_POLICY.renderOnly,true);
assert.equal(TERRAIN_SEDIMENT_POLICY.deterministic,true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalHeightUnchanged,true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalHydrologyUnchanged,true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalCoastlineUnchanged,true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalColliderUnchanged,true);
assert.equal(TERRAIN_SEDIMENT_POLICY.canonicalVegetationPlacementUnchanged,true);
assert.equal(TERRAIN_SEDIMENT_POLICY.newGeographyIntroduced,false);
assert.equal(TERRAIN_SEDIMENT_POLICY.stackPolicies.length,9);
assert(TERRAIN_SEDIMENT_POLICY.materialKey.includes('v5'));
console.log('[checkTerrainSurfaceClimateWeatheringShaderContract] PASS',JSON.stringify({markers:markers.length,shaderBytes:markers.reduce((n,[s])=>n+s.length,0),stackPolicies:TERRAIN_SEDIMENT_POLICY.stackPolicies.length}));
