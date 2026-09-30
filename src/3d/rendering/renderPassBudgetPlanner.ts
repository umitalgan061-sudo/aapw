/** Strict TypeScript deterministic render-pass budget allocator. */
export type RenderBackend='webgl2'|'webgpu';
export interface RenderPassBudgetPolicy{readonly id:string;readonly maxPasses:number;readonly defaultBudgetMs:number;readonly emergencyBudgetMs:number;readonly qualityReserveMs:number;}
export interface RenderPassDescriptor{readonly id?:string;readonly costMs?:number;readonly priority?:number;readonly optional?:boolean;readonly backend?:RenderBackend;readonly qualityFloor?:number;}
export interface RenderPassContext{readonly budgetMs?:number;readonly emergency?:boolean;}
export interface NormalizedRenderPass{readonly id:string;readonly costMs:number;readonly priority:number;readonly optional:boolean;readonly backend:RenderBackend;readonly qualityFloor:number;}
export interface RenderPassBudgetPlan{readonly revision:number;readonly budgetMs:number;readonly spentMs:number;readonly utilization:number;readonly accepted:readonly NormalizedRenderPass[];readonly rejected:readonly NormalizedRenderPass[];}
export interface RenderPassBudgetPlannerOptions{readonly policy?:Partial<RenderPassBudgetPolicy>;}
export interface RenderPassBudgetPlanner{readonly plan:(passDescriptors?:readonly RenderPassDescriptor[],context?:RenderPassContext)=>RenderPassBudgetPlan;readonly readonly revision:number;}
const freeze=Object.freeze;
const finite=(value:unknown,fallback=0):number=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(value:unknown,min:number,max:number):number=>Math.min(max,Math.max(min,finite(value,min)));
export const RENDER_PASS_BUDGET_POLICY:Readonly<RenderPassBudgetPolicy>=freeze({id:'render-pass-budget-2026-09-v1',maxPasses:32,defaultBudgetMs:8,emergencyBudgetMs:4,qualityReserveMs:.75});
export function createRenderPassBudgetPlanner(options:RenderPassBudgetPlannerOptions={}):RenderPassBudgetPlanner{
 const policy=freeze({...RENDER_PASS_BUDGET_POLICY,...(options.policy??{})});
 let revision=0;
 const plan=(passDescriptors:readonly RenderPassDescriptor[]=[],context:RenderPassContext={}):RenderPassBudgetPlan=>{
  const budget=Math.max(1,finite(context.budgetMs,policy.defaultBudgetMs));
  const emergency=context.emergency===true?Math.min(budget,policy.emergencyBudgetMs):budget;
  const candidates=Array.from(passDescriptors).slice(0,Math.max(0,Math.floor(policy.maxPasses))).map((pass,index)=>freeze({
   id:String(pass?.id||`pass-${index}`).slice(0,96),costMs:Math.max(0,finite(pass?.costMs,0)),priority:clamp(pass?.priority,0,1),
   optional:pass?.optional!==false,backend:pass?.backend==='webgpu'?'webgpu':'webgl2',qualityFloor:clamp(pass?.qualityFloor,0,1),
  }));
  candidates.sort((a,b)=>(Number(a.optional)-Number(b.optional))||(b.priority-a.priority)||(a.costMs-b.costMs)||a.id.localeCompare(b.id));
  const accepted:NormalizedRenderPass[]=[];const rejected:NormalizedRenderPass[]=[];let spent=0;
  for(const pass of candidates){const next=spent+pass.costMs,reserved=accepted.length===0?0:policy.qualityReserveMs;if(!pass.optional||next+reserved<=emergency){accepted.push(pass);spent=next;}else rejected.push(pass);}
  revision+=1;
  return freeze({revision,budgetMs:emergency,spentMs:Number(spent.toFixed(3)),utilization:Number((spent/emergency).toFixed(4)),accepted:freeze(accepted),rejected:freeze(rejected)});
 };
 return freeze({plan,get revision(){return revision;}}) as RenderPassBudgetPlanner;
}
export function passBudgetDigest(result:RenderPassBudgetPlan|null|undefined):string{return[...(result?.accepted??[])].map(pass=>`A:${pass.id}`).concat([...(result?.rejected??[])].map(pass=>`R:${pass.id}`)).sort().join('|');}
