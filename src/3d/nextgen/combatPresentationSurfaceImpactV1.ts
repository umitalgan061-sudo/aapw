/** Presentation-only material surface impact adapter; it never mutates MaterialAssignmentCore state. */
import type { DamageType } from './combatSimulation';
import { resolveCombatSurfaceReaction, getCombatDamageTypeProfile, type CombatImpactMaterialResponse } from './combatPresentationDamageTypeV1';

export type CombatSurfaceRole='skin'|'hair'|'cloth'|'leather'|'metal'|'boot'|'stone'|'wood'|'ice';
export interface CombatSurfaceImpactRoute{readonly role:CombatSurfaceRole;readonly damageType:DamageType;readonly response:CombatImpactMaterialResponse;readonly visualWeight:number;readonly audioWeight:number;readonly hapticWeight:number;readonly roughnessResponse:number;readonly metallicResponse:number;readonly heatResponse:number;readonly coldResponse:number;}
export interface CombatSurfaceImpactInput{readonly damageType:DamageType;readonly role:CombatSurfaceRole;readonly baseIntensity:number;readonly armorAbsorption?:number;readonly surfaceConfidence?:number;}

const clamp=(v:number,min=0,max=1)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
const ROLE_FACTORS:Readonly<Record<CombatSurfaceRole,readonly[number,number,number]>>=Object.freeze({skin:[.95,.72,.08],hair:[.35,.42,.03],cloth:[.72,.64,.04],leather:[.82,.7,.12],metal:[.98,.9,.82],boot:[.88,.78,.24],stone:[.92,.88,.55],wood:[.78,.73,.34],ice:[.96,.86,.65]});

export function resolveCombatSurfaceImpact(input:CombatSurfaceImpactInput):CombatSurfaceImpactRoute{
  const confidence=clamp(input.surfaceConfidence??1);
  const absorption=clamp(input.armorAbsorption??0);
  const intensity=clamp(input.baseIntensity)*confidence*(1-absorption*0.65);
  const [visualBase,audioBase,hardness]=ROLE_FACTORS[input.role];
  const reaction=resolveCombatSurfaceReaction(input.damageType,input.role==='boot'?'leather':input.role==='hair'?'skin':input.role==='wood'?'stone':input.role);
  const profile=getCombatDamageTypeProfile(input.damageType);
  const metallic=input.role==='metal'?1:input.role==='ice'?0.5:0.08;
  const roughness=input.role==='metal'?profile.surfaceGlossResponse:input.role==='ice'?0.22:Math.max(.12,1-profile.surfaceGlossResponse);
  return Object.freeze({role:input.role,damageType:input.damageType,response:reaction.response,visualWeight:Number(clamp(intensity*visualBase).toFixed(4)),audioWeight:Number(clamp(intensity*audioBase*profile.audioGain).toFixed(4)),hapticWeight:Number(clamp(intensity*(.4+hardness*.6)*profile.hapticGain).toFixed(4)),roughnessResponse:Number(clamp(roughness).toFixed(4)),metallicResponse:Number(clamp(metallic).toFixed(4)),heatResponse:Number(clamp(input.damageType==='fire'?intensity:0).toFixed(4)),coldResponse:Number(clamp(input.damageType==='frost'?intensity:input.role==='ice'?intensity*.35:0).toFixed(4))});
}

export function buildCombatSurfaceImpactMatrix(damageTypes:readonly DamageType[]=['slash','pierce','blunt','fire','frost','arcane'],roles:readonly CombatSurfaceRole[]=['skin','hair','cloth','leather','metal','boot','stone','wood','ice']):readonly CombatSurfaceImpactRoute[]{
  const routes:CombatSurfaceImpactRoute[]=[];
  for(const damageType of damageTypes)for(const role of roles)routes.push(resolveCombatSurfaceImpact({damageType,role,baseIntensity:1,surfaceConfidence:1}));
  return Object.freeze(routes);
}

export function validateCombatSurfaceImpactRoute(route:CombatSurfaceImpactRoute):boolean{return route.visualWeight>=0&&route.visualWeight<=1&&route.audioWeight>=0&&route.audioWeight<=1&&route.hapticWeight>=0&&route.hapticWeight<=1&&route.roughnessResponse>=0&&route.roughnessResponse<=1&&route.metallicResponse>=0&&route.metallicResponse<=1&&route.heatResponse>=0&&route.heatResponse<=1&&route.coldResponse>=0&&route.coldResponse<=1;}

export function summarizeCombatSurfaceImpactMatrix(routes:readonly CombatSurfaceImpactRoute[]):Readonly<{routes:number;metallicRoutes:number;fireRoutes:number;frostRoutes:number;maxVisual:number;maxHaptic:number}>{return Object.freeze({routes:routes.length,metallicRoutes:routes.filter(r=>r.metallicResponse>.5).length,fireRoutes:routes.filter(r=>r.heatResponse>0).length,frostRoutes:routes.filter(r=>r.coldResponse>0).length,maxVisual:routes.reduce((m,r)=>Math.max(m,r.visualWeight),0),maxHaptic:routes.reduce((m,r)=>Math.max(m,r.hapticWeight),0)});}