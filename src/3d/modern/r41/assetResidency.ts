export interface Residency{readonly id:string;readonly bytes:number;readonly pinned:boolean;readonly lastUsedTick:number;readonly hotness:number;}
export class AssetResidencyController{
 readonly budgetBytes:number;readonly maxEntries:number;#items=new Map<string,Residency>();#used=0;
 constructor(budgetBytes=512*1024*1024,maxEntries=16384){this.budgetBytes=Math.max(16*1024*1024,Math.trunc(budgetBytes));this.maxEntries=Math.max(64,Math.trunc(maxEntries));}
 admit(id:string,bytes:number,tick:number,pinned=false,hotness=1){if(!id||bytes<=0||bytes>this.budgetBytes)return false;const old=this.#items.get(id);if(old)this.#used-=old.bytes;this.#items.set(id,Object.freeze({id,bytes,pinned,lastUsedTick:tick,hotness:clamp(hotness,0,1)}));this.#used+=bytes;this.enforce(tick);return this.#items.has(id);}
 touch(id:string,tick:number,hotness=1){const item=this.#items.get(id);if(item)this.#items.set(id,Object.freeze({...item,lastUsedTick:tick,hotness:clamp(hotness,0,1)}));}
 evict(count:number){const victims=[...this.#items.values()].filter(v=>!v.pinned).sort((a,b)=>a.hotness-b.hotness||a.lastUsedTick-b.lastUsedTick||a.id.localeCompare(b.id)).slice(0,Math.max(0,count));for(const v of victims){this.#items.delete(v.id);this.#used-=v.bytes;}return victims.map(v=>v.id);}
 enforce(tick:number){void tick;const ids:string[]=[];while(this.#used>this.budgetBytes){const removed=this.evict(1);if(!removed.length)break;ids.push(...removed);}return Object.freeze(ids);}
 usedBytes(){return this.#used;}size(){return this.#items.size;}clear(){this.#items.clear();this.#used=0;}
}
function clamp(v:number,min:number,max:number){return Number.isFinite(v)?Math.max(min,Math.min(max,v)):min;}
