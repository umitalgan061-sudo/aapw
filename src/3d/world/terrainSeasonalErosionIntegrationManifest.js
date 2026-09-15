import { TERRAIN_SEASONAL_EROSION_POLICY } from './terrainSeasonalErosionProfiles.js';
import { TERRAIN_SEASONAL_CYCLE_POLICY, TERRAIN_SEASONAL_CYCLE_SCHEMA } from './terrainSeasonalErosionCycle.js';
import { TERRAIN_SEASONAL_EROSION_RUNTIME_POLICY } from './terrainSeasonalErosionRuntime.js';
import { TERRAIN_SEASONAL_EROSION_EVENT_POLICY, TERRAIN_SEASONAL_EVENT_TYPES } from './terrainSeasonalErosionEvents.js';
import { TERRAIN_SEASONAL_EROSION_RESPONSE_BOOK_POLICY } from './terrainSeasonalErosionResponseBook.js';
import { TERRAIN_SEASONAL_EROSION_SHADER_POLICY } from './terrainSeasonalErosionShader.js';
const freeze=v=>Object.freeze(v);
export const TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST=freeze({
 version:1,
 feature:'seasonal-erosion-freeze-thaw-surface-aging',
 policies:freeze({profile:TERRAIN_SEASONAL_EROSION_POLICY.id,cycle:TERRAIN_SEASONAL_CYCLE_POLICY.id,runtime:TERRAIN_SEASONAL_EROSION_RUNTIME_POLICY.id,event:TERRAIN_SEASONAL_EROSION_EVENT_POLICY.id,responseBook:TERRAIN_SEASONAL_EROSION_RESPONSE_BOOK_POLICY.id,shader:TERRAIN_SEASONAL_EROSION_SHADER_POLICY.id}),
 contracts:freeze({renderOnly:true,deterministic:true,canonicalHeightUnchanged:true,canonicalHydrologyUnchanged:true,canonicalCoastlineUnchanged:true,canonicalColliderUnchanged:true,canonicalVegetationPlacementUnchanged:true}),
 schema:TERRAIN_SEASONAL_CYCLE_SCHEMA,
 eventTypes:TERRAIN_SEASONAL_EVENT_TYPES,
 inputs:freeze(['worldX','worldZ','dayOfYear','heightMeters','slopeDegrees','moisture','rainfall','snowWeight','windExposure','drainage','canopy','climate','temperatureC','substrate','profileIndex','frozenDays','dryDays']),
 stages:freeze(['profile-calibration','seasonal-forcing','snowpack','freeze-thaw','runoff-pulse','moisture-memory','wind-drying','seasonal-response','sediment-composition','shader-modulation']),
 outputs:freeze(['season','erosion','frostWear','deposition','mud','crust','seasonalAge','color','roughness','normalStrength','specularDamping']),
});
export function integrationManifestSnapshot(){return freeze(JSON.parse(JSON.stringify(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST)));}
export function integrationManifestKeys(){return freeze(Object.keys(TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.policies));}
export function validateIntegrationManifest(manifest=TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST){const errors=[];for(const key of ['profile','cycle','runtime','event','responseBook','shader'])if(!manifest?.policies?.[key])errors.push(`policy:${key}`);for(const key of ['renderOnly','deterministic','canonicalHeightUnchanged','canonicalHydrologyUnchanged','canonicalCoastlineUnchanged','canonicalColliderUnchanged','canonicalVegetationPlacementUnchanged'])if(manifest?.contracts?.[key]!==true)errors.push(`contract:${key}`);if(manifest?.schema?.version!==1)errors.push('schema');if(!Array.isArray(manifest?.eventTypes)||manifest.eventTypes.length<12)errors.push('events');if(!Array.isArray(manifest?.stages)||manifest.stages.length<8)errors.push('stages');return freeze({ok:errors.length===0,errors:freeze(errors)});}
export function dependencyGraph(){return freeze({profile:['cycle','runtime'],cycle:['runtime','event'],runtime:['shader'],event:['runtime'],responseBook:['event','runtime'],shader:['runtime'],sediment:['runtime']});}
export function topologicalIntegrationOrder(){return freeze(['profile','cycle','sediment','event','runtime','responseBook','shader']);}
export function boundaryContract(){return freeze({height:false,hydrology:false,coastline:false,collider:false,vegetationPlacement:false,newGeography:false});}
export function integrationManifestReport(){const validation=validateIntegrationManifest();const graph=dependencyGraph();return freeze({feature:TERRAIN_SEASONAL_EROSION_INTEGRATION_MANIFEST.feature,version:1,validation,graph,order:topologicalIntegrationOrder(),boundary:boundaryContract()});}
export const TERRAIN_SEASONAL_EROSION_INTEGRATION_ASSERTIONS=freeze({mustRemainRenderOnly:true,mustRemainDeterministic:true,mustNotMutateGeometry:true,mustNotMutateHydrology:true,mustNotMutateCollision:true,mustNotRelocateVegetation:true});
