export interface MemoryAllocation{readonly id:string;readonly bytes:number;readonly category:'geometry'|'texture'|'audio'|'script'|'cache'|'other';readonly priority:number;readonly pinned:boolean;}
export class MemoryBudgetController{
 readonly budgetBytes:number;#items=new Map<string,MemoryAllocation>();#used=0;
 constructor(budgetBytes=1024*1024*1024){this.budgetBytes=Math.max(16*1024*1024,Math.trunc(budgetBytes));}
 reserve(item:MemoryAllocation){if(!item.id||item.bytes<0)return false;const old=this.#items.get(item.id);if(old)this.#used-=old.bytes;const next=Object.freeze({...item,bytes:Math.trunc(item.bytes),priority:Math.max(0,Math.min(100,item.priority))});this.#items.set(item.id,next);this.#used+=next.bytes;return true;}
 release(id:string){const item=this.#items.get(id);if(!item)return false;this.#used-=item.bytes;this.#items.delete(id);return true;}
 enforce(){const removed:string[]=[];while(this.#used>this.budgetBytes){const victim=[...this.#items.values()].filter(i=>!i.pinned).sort((a,b)=>a.priority-b.priority||b.bytes-a.bytes||a.id.localeCompare(b.id))[0];if(!victim)break;this.release(victim.id);removed.push(victim.id);}return Object.freeze(removed);}
 report(){return Object.freeze({budgetBytes:this.budgetBytes,usedBytes:this.#used,pressure:Math.min(1,this.#used/this.budgetBytes),allocations:Object.freeze([...this.#items.values()].sort((a,b)=>a.id.localeCompare(b.id)))});}
 usedBytes(){return this.#used;}size(){return this.#items.size;}clear(){this.#items.clear();this.#used=0;}
}
