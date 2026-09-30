/**
 * Render-only facade combining groundwater regime, detail channels and the
 * existing groundwater material stack. This is deliberately not a simulation.
 */
import { TERRAIN_GROUNDWATER_POLICY, resolveTerrainGroundwaterState } from './terrainGroundwaterRegime.js';
import { TERRAIN_GROUNDWATER_STACK_POLICY, resolveGroundwaterStackFrame } from './terrainGroundwaterMaterialStack.js';
import { resolveGroundwaterSurfaceDetail, detailMaterialResponse, blendSurfaceDetail, detailEventDelta, applyDetailEvent, detailEnvelope, detailCanonicalAudit, detailWeightedWetness, detailDrynessRisk, detailHydroBalance, detailSignature } from './terrainGroundwaterSurfaceDetail.js';
import { installTerrainGroundwaterSurfaceDetailShader, TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY } from './terrainGroundwaterSurfaceDetailShader.js';

const freeze=Object.freeze;
const clamp01=v=>Math.max(0,Math.min(1,Number.isFinite(Number(v))?Number(v):0));
const safe=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
const lerp=(a,b,t)=>a+(b-a)*t;

export const TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY=freeze({
  id:'terrain-groundwater-surface-detail-stack-2026-09-15-v1',
  sourcePolicyId:TERRAIN_GROUNDWATER_POLICY.id,
  groundwaterStackPolicyId:TERRAIN_GROUNDWATER_STACK_POLICY.id,
  shaderPolicyId:TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY.id,
  renderOnly:true,
  deterministic:true,
  canonicalHeightUnchanged:true,
  canonicalHydrologyUnchanged:true,
  canonicalCoastlineUnchanged:true,
  canonicalColliderUnchanged:true,
  canonicalVegetationPlacementUnchanged:true,
  newGeographyIntroduced:false,
  stageCount:11,
  maxDetailNormal:.055,
});

export const TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER=freeze([
  'base-terrain','sediment','soil-structure','seasonality','climate-exposure','wind-drying','thermal-microclimate','groundwater','groundwater-detail','material-budget',
]);

const canonical=()=>freeze({heightUnchanged:true,hydrologyUnchanged:true,coastlineUnchanged:true,colliderUnchanged:true,vegetationPlacementUnchanged:true,newGeographyIntroduced:false});

export function detailStackManifest(){return freeze({policyId:TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.id,order:TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER,sourcePolicyId:TERRAIN_GROUNDWATER_POLICY.id,groundwaterStackPolicyId:TERRAIN_GROUNDWATER_STACK_POLICY.id,shaderPolicyId:TERRAIN_GROUNDWATER_DETAIL_SHADER_POLICY.id,canonical:canonical()});}

export function detailStackMaterial(baseMaterial={},detail,weight=1){
  const d=detail??resolveGroundwaterSurfaceDetail({});
  const response=detailMaterialResponse(d,baseMaterial.color??{r:.42,g:.36,b:.28},safe(baseMaterial.roughness,.86));
  const t=clamp01(weight);
  const color=freeze({r:lerp(safe(baseMaterial.color?.r,.42),response.color.r,t),g:lerp(safe(baseMaterial.color?.g,.36),response.color.g,t),b:lerp(safe(baseMaterial.color?.b,.28),response.color.b,t)});
  return freeze({color,roughness:lerp(safe(baseMaterial.roughness,.86),response.roughness,t),normalStrength:clamp01(lerp(safe(baseMaterial.normalStrength),response.normalStrength,t)),wetness:clamp01(lerp(safe(baseMaterial.wetness),response.wetness,t))});
}

export function resolveGroundwaterDetailStack(input={},baseMaterial={},options={}){
  const groundwater=resolveGroundwaterStackFrame(input,baseMaterial,options);
  const detail=resolveGroundwaterSurfaceDetail(input);
  const material=detailStackMaterial(groundwater.material,detail,options.detailWeight??1);
  return freeze({policyId:TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.id,sourcePolicyId:TERRAIN_GROUNDWATER_POLICY.id,groundwaterPolicyId:groundwater.policyId,groundwater,detail,material,signature:detailSignature(detail),hydroBalance:detailHydroBalance(detail),canonical:canonical()});
}

export function installGroundwaterDetailStackMaterial(material,options={}){
  const installed=installTerrainGroundwaterSurfaceDetailShader(material);
  installed.userData={...installed.userData,terrainGroundwaterDetailStackInstalled:true,terrainGroundwaterDetailStackPolicyId:TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.id,terrainGroundwaterDetailStackRenderOnly:true,terrainGroundwaterDetailStackStageOrder:[...TERRAIN_GROUNDWATER_DETAIL_STACK_ORDER],terrainGroundwaterDetailStackCanonicalHeightUnchanged:true,terrainGroundwaterDetailStackCanonicalHydrologyUnchanged:true,terrainGroundwaterDetailStackCanonicalCoastlineUnchanged:true,terrainGroundwaterDetailStackCanonicalColliderUnchanged:true,terrainGroundwaterDetailStackCanonicalVegetationPlacementUnchanged:true,...options.userData};
  return installed;
}

export function detailStackAudit(frame){
  const errors=[];
  if(!frame||frame.policyId!==TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.id)errors.push('policy');
  if(!frame.groundwater||frame.groundwater.policyId!==TERRAIN_GROUNDWATER_STACK_POLICY.id)errors.push('groundwater-stack');
  if(!frame.detail||frame.detail.policyId!=='terrain-groundwater-surface-detail-2026-09-15-v1')errors.push('detail');
  if(!detailEnvelope(frame.detail).ok)errors.push('detail-envelope');
  if(!detailCanonicalAudit(frame.detail).ok)errors.push('detail-canonical');
  if(frame.canonical?.heightUnchanged!==true)errors.push('height');
  if(frame.canonical?.hydrologyUnchanged!==true)errors.push('hydrology');
  if(frame.canonical?.coastlineUnchanged!==true)errors.push('coastline');
  if(frame.canonical?.colliderUnchanged!==true)errors.push('collider');
  if(frame.canonical?.vegetationPlacementUnchanged!==true)errors.push('vegetation');
  return freeze({ok:errors.length===0,errors:freeze(errors)});
}

export function detailStackEvent(frame,event={}){
  const delta=detailEventDelta(frame.detail,event);
  const material=applyDetailEvent(frame.material,delta);
  return freeze({...frame,event:freeze({type:event.type??'neutral',intensity:clamp01(event.intensity??.5),delta}),material});
}

export function detailStackBlend(a,b,mix=.5){
  const d=blendSurfaceDetail(a.detail,b.detail,mix);
  const material=detailStackMaterial(a.material,d,1);
  return freeze({policyId:TERRAIN_GROUNDWATER_DETAIL_STACK_POLICY.id,sourcePolicyId:TERRAIN_GROUNDWATER_POLICY.id,detail:d,material,canonical:canonical()});
}

export function detailStackBatch(inputs=[],baseMaterial={},options={}){
  if(!Array.isArray(inputs))throw new TypeError('groundwater detail stack batch requires an array');
  return freeze(inputs.map(input=>resolveGroundwaterDetailStack(input,baseMaterial,options)));
}

export function detailStackStatistics(frames=[]){
  if(!Array.isArray(frames)||!frames.length)return freeze({count:0,wetMean:0,dryMean:0,netMean:0,wetMin:0,wetMax:0,dryMin:0,dryMax:0,contrast:0});
  const wet=frames.map(f=>detailWeightedWetness(f.detail)),dry=frames.map(f=>detailDrynessRisk(f.detail));
  const wm=wet.reduce((s,v)=>s+v,0)/wet.length,dm=dry.reduce((s,v)=>s+v,0)/dry.length,wmin=Math.min(...wet),wmax=Math.max(...wet),dmin=Math.min(...dry),dmax=Math.max(...dry);
  return freeze({count:frames.length,wetMean:wm,dryMean:dm,netMean:wm-dm,wetMin:wmin,wetMax:wmax,dryMin:dmin,dryMax:dmax,contrast:Math.max(wmax-wmin,dmax-dmin)});
}

export function detailStackTier(frame){const confidence=clamp01(frame.detail.channels.surfaceConfidence),max=Math.max(detailWeightedWetness(frame.detail),detailDrynessRisk(frame.detail));if(confidence<.35)return'suppressed';if(max>=.76)return'high';if(max>=.52)return'medium';return'low';}

export function detailStackHealth(frame){const audit=detailStackAudit(frame),stats={wetness:detailWeightedWetness(frame.detail),dryness:detailDrynessRisk(frame.detail),net:detailHydroBalance(frame.detail).net};return freeze({ok:audit.ok,audit,tier:detailStackTier(frame),stats,canonical:canonical()});}
