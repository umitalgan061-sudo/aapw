import assert from 'node:assert/strict';
import { climateMaterialResponse, biomeTransitionWeights, seasonalAssetWeights, climateExposureEnvelope, validateClimateTransitionSample } from '../src/3d/world/terrainEnvironmentClimateTransitions.js';
const lush=biomeTransitionWeights({biome:'forest',moisture:.86,elevationMeters:45,slopeDegrees:8,temperatureC:12});
const cold=biomeTransitionWeights({biome:'tundra',moisture:.42,elevationMeters:410,slopeDegrees:32,temperatureC:-4});
assert.ok(lush.wetForest>cold.wetForest);assert.ok(cold.tundra>lush.tundra);
const wet=climateMaterialResponse({moisture:.9,temperatureC:8,exposure:.25,rockWeight:.15,snowWeight:0});const dry=climateMaterialResponse({moisture:.2,temperatureC:24,exposure:.8,rockWeight:.15,snowWeight:0});assert.ok(wet.roughnessOffset<dry.roughnessOffset);assert.ok(wet.albedoValue<dry.albedoValue);
assert.ok(seasonalAssetWeights({season:'winter',snowWeight:.8,temperatureC:-3,biome:'tundra'}).winterVegetation>seasonalAssetWeights({season:'summer',snowWeight:0,temperatureC:20,biome:'meadow'}).winterVegetation);
assert.ok(climateExposureEnvelope({temperatureC:12,moisture:.72,windExposure:.2,elevationMeters:80}).forestScore>climateExposureEnvelope({temperatureC:4,moisture:.25,windExposure:.85,elevationMeters:420}).forestScore);
assert.equal(validateClimateTransitionSample({moisture:.6,temperatureC:10,elevationMeters:80,slopeDegrees:9,exposure:.3}).ok,true);console.log(JSON.stringify({ok:true,lush,cold}));
