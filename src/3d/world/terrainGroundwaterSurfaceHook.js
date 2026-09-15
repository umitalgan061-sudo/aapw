import { installTerrainGroundwater, TERRAIN_GROUNDWATER_POLICY } from './terrainGroundwaterSurface.js';
import { installTerrainGroundwater as installV2, TERRAIN_GROUNDWATER_V2_POLICY, resolveGroundwaterV2 } from './terrainGroundwaterSurfaceV2.js';

const freeze=(v)=>Object.freeze(v);
const finite=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const clamp=(v)=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));

export const TERRAIN_GROUNDWATER_HOOK_POLICY=freeze({
 id:'terrain-groundwater-surface-hook-2026-09-15-v1',
 deterministic:true,
 renderOnly:true,
 canonicalHeightUnchanged:true,
 canonicalHydrologyUnchanged:true,
 canonicalCoastlineUnchanged:true,
 canonicalColliderUnchanged:true,
 canonicalVegetationPlacementUnchanged:true,
 legacyPolicyId:TERRAIN_GROUNDWATER_POLICY.id,
 activePolicyId:TERRAIN_GROUNDWATER_V2_POLICY.id,
 materialKey:'terrain-groundwater-hook-v1',
});

export function normalizeHookInput(input={}){return freeze({worldX:finite(input.worldX),worldZ:finite(input.worldZ),heightMeters:finite(input.heightMeters),slopeDegrees:finite(input.slopeDegrees),moisture:clamp(input.moisture),rainfall:clamp(input.rainfall),runoff:clamp(input.runoff),soilDepth:clamp(input.soilDepth),vegetationCover:clamp(input.vegetationCover),substrate:String(input.substrate??'alluvium'),waterDistance:Math.max(0,finite(input.waterDistance,99999)),confidence:clamp(input.confidence??1)});}

export function resolveGroundwaterHookState(input={}){const normalized=normalizeHookInput(input);const state=resolveGroundwaterV2(normalized);return freeze({normalized,state,policyId:TERRAIN_GROUNDWATER_HOOK_POLICY.id,canonicalTerrainUntouched:true});}

export function groundwaterSurfaceIntent(input={}){const hook=resolveGroundwaterHookState(input);const s=hook.state;return freeze({wetBlend:s.surface.wet,sheenBlend:s.surface.sheen,mudBlend:s.surface.mud,seepageBlend:s.seepage.seepage,springBlend:s.spring.emergence,waterlineBlend:s.surface.wet*.38+s.seepage.seepage*.42+s.spring.emergence*.2,roughnessDelta:-s.surface.wet*.04-s.surface.sheen*.025+s.surface.mud*.05,normalEnergy:s.seepage.seepage*.03+s.surface.standing*.012,policyId:TERRAIN_GROUNDWATER_HOOK_POLICY.id});}

export function installTerrainGroundwaterSurfaceHook(material,{legacy=false}={}){return legacy?installTerrainGroundwater(material):installV2(material);}

export function attachGroundwaterTelemetry(userData={},state){const telemetry={terrainGroundwaterPolicyId:TERRAIN_GROUNDWATER_HOOK_POLICY.id,terrainGroundwaterRenderOnly:true,terrainGroundwaterCanonicalTerrainUntouched:true,terrainGroundwaterDepthMeters:finite(state?.waterTable?.depthMeters),terrainGroundwaterSeepage:clamp(state?.seepage?.seepage),terrainGroundwaterSpring:clamp(state?.spring?.emergence),terrainGroundwaterWet:clamp(state?.surface?.wet)};return {...userData,...telemetry};}

export function groundwaterHookSnapshot(){return freeze({policy:TERRAIN_GROUNDWATER_HOOK_POLICY,legacyPolicy:TERRAIN_GROUNDWATER_POLICY,activePolicy:TERRAIN_GROUNDWATER_V2_POLICY});}
