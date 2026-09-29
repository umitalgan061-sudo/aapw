import type { EntityId, QualityTier } from './liveCoreTypes.ts';
import { clamp, stableHash } from './liveCoreTypes.ts';

export type EntityLod=0|1|2|3;
export interface EntityCandidate{readonly id:EntityId;readonly distance:number;readonly importance:number;readonly estimatedBytes:number;readonly updateCostMs:number;readonly alwaysResident?:boolean;readonly active?:boolean;}
export interface EntityBudgetPolicy{readonly maxEntities:number;readonly maxResidentBytes:number;readonly maxUpdateMs:number;readonly lodDistances:readonly [number,number,number];}
export interface EntityResidency{readonly id:EntityId;readonly lod:EntityLod;readonly active:boolean;readonly estimatedBytes:number;readonly updateCostMs:number;readonly priority:number;}
export interface EntityBudgetPlan{readonly quality:QualityTier;readonly resident:readonly EntityResidency[];readonly dormant:readonly EntityId[];readonly residentBytes:number;readonly updateMs:number;readonly digest:string;}
export const DEFAULT_ENTITY_BUDGET_POLICY:EntityBudgetPolicy=Object.freeze({maxEntities:10000,maxResidentBytes:256*1024*1024,maxUpdateMs:4,lodDistances:[35,90,180] as const});

const lodFor=(distance:number,d:readonly [number,number,number]):EntityLod=>distance<=d[0]?0:distance<=d[1]?1:distance<=d[2]?2:3;
const qualityFactor=(q:QualityTier)=>q==='ultra'?1:q==='high'?.9:q==='medium'?.72:q==='low'?.55:.4;

export class StrictEntityBudgetRuntime{
 #policy:EntityBudgetPolicy;#disposed=false;
 constructor(policy:EntityBudgetPolicy=DEFAULT_ENTITY_BUDGET_POLICY){this.#policy=Object.freeze({...policy});}
 plan(quality:QualityTier,candidates:readonly EntityCandidate[]):EntityBudgetPlan{if(this.#disposed)return Object.freeze({quality,resident:[],dormant:[],residentBytes:0,updateMs:0,digest:stableHash({disposed:true})});const factor=qualityFactor(quality);const sorted=[...candidates].sort((a,b)=>(b.importance/(1+b.distance))-(a.importance/(1+a.distance))||a.id.localeCompare(b.id));const resident:EntityResidency[]=[];const dormant:EntityId[]=[];let bytes=0,updateMs=0;for(const c of sorted){const lod=lodFor(Math.max(0,c.distance),this.#policy.lodDistances);const lodFactor=(lod===0?1:lod===1?.55:lod===2?.25:0);const estimatedBytes=Math.floor(Math.max(0,c.estimatedBytes)*lodFactor);const cost=Math.max(0,c.updateCostMs)*(lod===3?0:lod===2?.35:lod===1?.7:1);const mandatory=Boolean(c.alwaysResident);const affordable=resident.length<this.#policy.maxEntities&&bytes+estimatedBytes<=this.#policy.maxResidentBytes&&updateMs+cost<=this.#policy.maxUpdateMs;const visible=lod<3&&factor>0.45;if((affordable&&visible)||mandatory){resident.push(Object.freeze({id:c.id,lod:mandatory?Math.min(lod,1) as EntityLod:lod,active:c.active!==false,estimatedBytes,updateCostMs:cost,priority:c.importance/(1+c.distance)}));bytes+=estimatedBytes;updateMs+=cost;}else dormant.push(c.id);}return Object.freeze({quality,resident:Object.freeze(resident),dormant:Object.freeze(dormant),residentBytes:bytes,updateMs,digest:stableHash({quality,resident:resident.map(r=>({id:r.id,lod:r.lod,active:r.active})),dormant})});}
}