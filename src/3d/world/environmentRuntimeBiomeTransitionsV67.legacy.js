import { clamp01, finiteV67, normalizeSampleV67, meanV67 } from './environmentRuntimeV67.js';

export const BIOME_TRANSITIONS_V67=Object.freeze({id:'biome-transitions-v67',version:67,deterministic:true,noWorldMutation:true});
const BIOMES=Object.freeze(['alpine','tundra','taiga','forest','grassland','scrub','wetland','temperate']);
const TARGETS=Object.freeze({
 alpine:{e:.82,m:.25,c:.08},
 tundra:{e:.58,m:.34,c:.04},
 taiga:{e:.48,m:.58,c:.72},
 forest:{e:.32,m:.68,c:.84},
 grassland:{e:.3,m:.42,c:.16},
 scrub:{e:.28,m:.3,c:.24},
 wetland:{e:.1,m:.86,c:.2},
 temperate:{e:.3,m:.55,c:.58},
});
export const blendFactorV67=(distance=0,scale=120)=>clamp01(1-Math.max(0,finiteV67(distance))/Math.max(1,finiteV67(scale,120)));
export const profileDistanceV67=(sample={},biome='temperate')=>{const s=normalizeSampleV67(sample);const t=TARGETS[biome]??TARGETS.temperate;return Math.min(1,Math.abs(s.elevation/2000-t.e)*.35+Math.abs(s.moisture-t.m)*.35+Math.abs(s.canopy-t.c)*.3);};
export const nearestBiomeV67=(sample={})=>BIOMES.map(biome=>({biome,distance:profileDistanceV67(sample,biome)})).sort((a,b)=>a.distance-b.distance)[0];
export const transitionCandidatesV67=(sample={})=>BIOMES.map(biome=>({biome,weight:clamp01(1-profileDistanceV67(sample,biome))})).sort((a,b)=>b.weight-a.weight);
export const ecotoneStrengthV67=(sample={},neighbor={})=>{const a=nearestBiomeV67(sample);const b=nearestBiomeV67(neighbor);return a.biome===b.biome?0:clamp01(1-(a.distance+b.distance)/2);};
export const terrainMismatchV67=(a={},b={})=>clamp01(Math.abs(finiteV67(a.elevation)-finiteV67(b.elevation))/1000*.35+Math.abs(clamp01(a.moisture)-clamp01(b.moisture))*.3+Math.abs(clamp01(a.slope/90)-clamp01(b.slope/90))*.35);
export const buildTransitionV67=(sample={},neighbor={})=>{const nearest=nearestBiomeV67(sample);const candidates=transitionCandidatesV67(sample);return{id:normalizeSampleV67(sample).id,primary:nearest.biome,secondary:candidates[1]?.biome??nearest.biome,primaryWeight:nearest.weight,secondaryWeight:candidates[1]?.weight??0,ecotone:ecotoneStrengthV67(sample,neighbor),terrainMismatch:terrainMismatchV67(sample,neighbor)};};
export const buildTransitionFieldV67=(samples=[])=>samples.map((sample,i)=>buildTransitionV67(sample,samples[i+1]??sample));
export const transitionClassV67=(transition={})=>transition.ecotone>.72?'strong':transition.ecotone>.42?'soft':'stable';
export const transitionPaletteWeightsV67=(transition={})=>({primary:clamp01(transition.primaryWeight),secondary:clamp01(transition.secondaryWeight*.75),ecotone:clamp01(transition.ecotone*.55)});
export const transitionSummaryV67=(field=[])=>({samples:field.length,meanEcotone:meanV67(field.map(x=>x.ecotone)),strong:field.filter(x=>transitionClassV67(x)==='strong').length,stable:field.filter(x=>transitionClassV67(x)==='stable').length});
export const validateTransitionsV67=(field=[])=>{const errors=[];if(!Array.isArray(field))errors.push('field');if(field.some(x=>x.primaryWeight<0||x.primaryWeight>1))errors.push('primary');if(field.some(x=>x.ecotone<0||x.ecotone>1))errors.push('ecotone');return{ok:errors.length===0,errors};};
export const transitionTelemetryV67=(field=[])=>({policy:BIOME_TRANSITIONS_V67.id,valid:validateTransitionsV67(field).ok,summary:transitionSummaryV67(field)});
export const neighborContinuityV67=(left={},right={})=>clamp01(1-terrainMismatchV67(left,right));
export const transitionHysteresisV67=(previous='stable',next='stable')=>previous===next?'hold':`${previous}->${next}`;
export const transitionIntentV67=(transition={})=>({blend:blendFactorV67(transition.terrainMismatch*120),class:transitionClassV67(transition),palette:transitionPaletteWeightsV67(transition)});
