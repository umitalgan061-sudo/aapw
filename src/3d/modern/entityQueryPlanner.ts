import type { EntityId } from './types';

export interface QueryPlan { readonly required:readonly string[];readonly excluded:readonly string[];readonly tag?:string;readonly activeOnly:boolean;readonly signature:string; }
export interface QueryCacheResult { readonly plan:QueryPlan;readonly ids:readonly EntityId[];readonly createdAt:number;readonly hits:number; }

/** Cached deterministic ECS query plans with explicit invalidation. */
export class EntityQueryPlanner {
 private readonly cache=new Map<string,QueryCacheResult>();private readonly maxEntries:number;private version=0;private disposed=false;
 constructor(maxEntries=128){this.maxEntries=Math.max(8,Math.floor(maxEntries));}
 public makePlan(options:{with?:readonly string[];without?:readonly string[];tag?:string;activeOnly?:boolean}={}):QueryPlan{this.ensure();const required=[...(options.with??[])].sort();const excluded=[...(options.without??[])].sort();const signature=JSON.stringify({required,excluded,tag:options.tag??null,activeOnly:Boolean(options.activeOnly),version:this.version});return{required,excluded,tag:options.tag,activeOnly:Boolean(options.activeOnly),signature};}
 public execute(plan:QueryPlan,source:{query:(filter:{with?:readonly string[];without?:readonly string[];tag?:string;activeOnly?:boolean})=>{ids:readonly EntityId[]}}):QueryCacheResult{this.ensure();const cached=this.cache.get(plan.signature);if(cached)return{...cached,hits:cached.hits+1};const result=source.query({with:plan.required,without:plan.excluded,tag:plan.tag,activeOnly:plan.activeOnly});const value:QueryCacheResult={plan,ids:[...result.ids],createdAt:Date.now(),hits:0};this.cache.set(plan.signature,value);while(this.cache.size>this.maxEntries){const oldest=this.cache.keys().next().value;if(oldest!==undefined)this.cache.delete(oldest);else break;}return value;}
 public invalidateAll():void{this.ensure();this.version+=1;this.cache.clear();}
 public invalidateSignature(signature:string):boolean{this.ensure();return this.cache.delete(signature);}
 public stats():{readonly entries:number;readonly version:number;readonly hits:number}{let hits=0;for(const value of this.cache.values())hits+=value.hits;return{entries:this.cache.size,version:this.version,hits};}
 private ensure():void{if(this.disposed)throw new Error('QUERY_PLANNER_DISPOSED');}
 public dispose():void{if(this.disposed)return;this.cache.clear();this.disposed=true;}
}

export interface BatchGroup<T=EntityId>{readonly key:string;readonly items:readonly T[];readonly start:number;readonly end:number;}
export const stableBatch=(ids:readonly EntityId[],batchSize=256):readonly BatchGroup[]=>{const size=Math.max(1,Math.floor(batchSize));const sorted=[...ids].sort();const groups:BatchGroup[]=[];for(let start=0;start<sorted.length;start+=size){const end=Math.min(sorted.length,start+size);groups.push({key:`batch:${start/div(size)}:${end}`,items:sorted.slice(start,end),start,end});}return groups;};
const div=(a:number,b:number):number=>Math.floor(a/b);

export interface PriorityItem { readonly id:EntityId;readonly priority:number;readonly distance:number;readonly cost:number; }
export const schedulePriorities=(items:readonly PriorityItem[],budget:number):readonly EntityId[]=>{let remaining=Math.max(0,budget);return[...items].sort((a,b)=>b.priority-a.priority||a.cost-b.cost||a.distance-b.distance||a.id.localeCompare(b.id)).filter(item=>{if(item.cost>remaining)return false;remaining-=Math.max(0,item.cost);return true;}).map(item=>item.id);};
