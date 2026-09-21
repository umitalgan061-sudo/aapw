import { clamp01, meanV67 } from './environmentRuntimeV67.js';

export const CONTINUITY_V67=Object.freeze({id:'continuity-v67',version:67,deterministic:true,noWorldMutation:true});
export const edgeDifferenceV67=(left={},right={})=>clamp01(
  Math.abs((left.elevation??0)-(right.elevation??0))/900*.34+
  Math.abs((left.moisture??0)-(right.moisture??0))*.22+
  Math.abs((left.visibility??0)-(right.visibility??0))*.18+
  Math.abs((left.slope??0)-(right.slope??0))*.26,
);
export const continuityRateV67=(difference=0)=>clamp01(1-clamp01(difference));
export const seamRiskV67=(left={},right={})=>clamp01(edgeDifferenceV67(left,right)*1.18);
export const healingWeightV67=(risk=0)=>clamp01(risk*.72);
export const buildContinuityLinkV67=(left={},right={})=>{const difference=edgeDifferenceV67(left,right);return{left:left.id??'left',right:right.id??'right',difference,rate:continuityRateV67(difference),seamRisk:seamRiskV67(left,right),healing:healingWeightV67(seamRiskV67(left,right))};};
export const buildContinuityFieldV67=(samples=[])=>{const links=[];for(let i=1;i<samples.length;i++)links.push(buildContinuityLinkV67(samples[i-1],samples[i]));return links;};
export const continuityHealingV67=(links=[])=>links.map(link=>({...link,healedRate:clamp01(link.rate+link.healing*.35)}));
export const continuitySummaryV67=(links=[])=>({links:links.length,meanRate:meanV67(links.map(x=>x.rate)),meanHealed:meanV67(links.map(x=>x.healedRate??x.rate)),seams:links.filter(x=>x.seamRisk>.55).length});
export const validateContinuityV67=(links=[])=>{const errors=[];if(!Array.isArray(links))errors.push('links');if(links.some(x=>x.rate<0||x.rate>1))errors.push('rate');if(links.some(x=>x.seamRisk<0||x.seamRisk>1))errors.push('seam');return{ok:errors.length===0,errors};};
export const continuityTelemetryV67=(links=[])=>({policy:CONTINUITY_V67.id,valid:validateContinuityV67(links).ok,summary:continuitySummaryV67(continuityHealingV67(links))});
export const compareContinuityV67=(before=[],after=[])=>({before:continuitySummaryV67(before),after:continuitySummaryV67(after),improved:continuitySummaryV67(after).meanHealed>=continuitySummaryV67(before).meanHealed});
export const continuityClassV67=(rate=0)=>rate>.82?'seamless':rate>.62?'soft-seam':'visible-seam';
export const continuityMatrixV67=(links=[])=>links.map(x=>({from:x.left,to:x.right,class:continuityClassV67(x.healedRate??x.rate),rate:x.healedRate??x.rate}));
