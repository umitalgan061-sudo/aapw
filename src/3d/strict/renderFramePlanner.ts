import type { RenderPolicy } from './liveCoreTypes.ts';
import { clamp, stableHash } from './liveCoreTypes.ts';

export type RenderPass='depth'|'opaque'|'transparent'|'shadow'|'atmosphere'|'temporal'|'post'|'ui';
export interface RenderCandidate{readonly id:string;readonly distance:number;readonly importance:number;readonly triangles:number;readonly instances:number;readonly transparent?:boolean;readonly castsShadow?:boolean;}
export interface RenderFramePlan{readonly frame:number;readonly backend:RenderPolicy['backend'];readonly scale:number;readonly passes:readonly RenderPass[];readonly visible:readonly RenderCandidate[];readonly omitted:readonly RenderCandidate[];readonly estimatedMs:number;readonly triangleBudget:number;readonly digest:string;}
export interface RenderPlannerPolicy{readonly maxCandidates:number;readonly maxVisible:number;readonly triangleBudget:number;readonly passBudgetMs:number;readonly shadowDistance:number;}

export const DEFAULT_RENDER_PLANNER_POLICY:RenderPlannerPolicy=Object.freeze({maxCandidates:8192,maxVisible:4096,triangleBudget:5_000_000,passBudgetMs:8,shadowDistance:140});

const score=(c:RenderCandidate)=>c.importance*1000+1/(1+Math.max(0,c.distance))*100-c.triangles*.00001;
const uniqueSort=(items:readonly RenderCandidate[])=>[...new Map(items.map(c=>[c.id,c])).values()].sort((a,b)=>score(b)-score(a)||a.id.localeCompare(b.id));
const passesFor=(policy:RenderPolicy)=>{const passes:RenderPass[]=['depth','opaque'];if(policy.shadows)passes.push('shadow');passes.push('transparent','atmosphere');if(policy.temporalEffects)passes.push('temporal');if(policy.postProcessing)passes.push('post');passes.push('ui');return Object.freeze(passes);};

export class StrictRenderFramePlanner{
 #policy:RenderPlannerPolicy;#disposed=false;#frame=0;
 constructor(policy:RenderPlannerPolicy=DEFAULT_RENDER_PLANNER_POLICY){this.#policy=Object.freeze({...policy});}
 plan(renderPolicy:RenderPolicy,candidates:readonly RenderCandidate[],frame?:number):RenderFramePlan{if(this.#disposed)return Object.freeze({frame:0,backend:renderPolicy.backend,scale:renderPolicy.renderScale,passes:[],visible:[],omitted:[],estimatedMs:0,triangleBudget:0,digest:stableHash({disposed:true})});const id=frame===undefined?++this.#frame:Math.max(0,Math.floor(frame));const normalized=uniqueSort(candidates.slice(0,this.#policy.maxCandidates));const visible:RenderCandidate[]=[];let triangles=0;for(const candidate of normalized){const affordable=visible.length<this.#policy.maxVisible&&triangles+Math.max(0,candidate.triangles)<=this.#policy.triangleBudget;if(affordable){visible.push(candidate);triangles+=Math.max(0,candidate.triangles);}}const omitted=normalized.filter(c=>!visible.some(v=>v.id===c.id));const drawCost=visible.length*(renderPolicy.backend==='webgpu'?0.008:0.012);const triangleCost=triangles/1_000_000*(renderPolicy.backend==='webgpu'?0.65:0.95);const shadowCost=renderPolicy.shadows?visible.filter(c=>c.castsShadow&&c.distance<=this.#policy.shadowDistance).length*.015:0;const postCost=renderPolicy.postProcessing?1.2/Math.max(.5,renderPolicy.renderScale):.2;const estimatedMs=drawCost+triangleCost+shadowCost+postCost;return Object.freeze({frame:id,backend:renderPolicy.backend,scale:clamp(renderPolicy.renderScale,.5,1),passes:passesFor(renderPolicy),visible:Object.freeze(visible),omitted:Object.freeze(omitted),estimatedMs,triangleBudget:this.#policy.triangleBudget,digest:stableHash({id,backend:renderPolicy.backend,scale:renderPolicy.renderScale,visible:visible.map(c=>c.id),triangles,passes:passesFor(renderPolicy)})});}
 dispose(){this.#disposed=true;}
}