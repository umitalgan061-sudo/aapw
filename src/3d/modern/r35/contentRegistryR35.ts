
import { fail, ok, stableHash, type R35ContentEntry, type R35ContentManifest, type R35Id, type R35Result } from './contracts';

export class ContentRegistryR35 {
  #entries=new Map<R35Id,R35ContentEntry>(); #frozen=false; #maxEntries=8192;
  register(entry:R35ContentEntry):R35Result<R35ContentEntry>{if(this.#frozen)return fail('CONTENT_FROZEN','Content registry is frozen');if(this.#entries.has(entry.id))return fail('CONTENT_DUPLICATE','Content id already exists');if(this.#entries.size>=this.#maxEntries)return fail('CONTENT_LIMIT','Content registry limit reached');if(!entry.id||entry.version<1||!entry.digest)return fail('CONTENT_INVALID','Content entry is invalid');if(entry.dependencies.includes(entry.id))return fail('CONTENT_SELF_DEP','Content entry cannot depend on itself');this.#entries.set(entry.id,Object.freeze({...entry,dependencies:Object.freeze([...entry.dependencies])}));return ok(entry);}
  registerBatch(entries:readonly R35ContentEntry[]):R35Result<number>{const before=this.#entries.size;const staged:string[]=[];for(const e of entries){const r=this.register(e);if(!r.ok){for(const id of staged)this.#entries.delete(id);return r;}staged.push(e.id);}return ok(this.#entries.size-before);}
  has(id:R35Id):boolean{return this.#entries.has(id);}
  get(id:R35Id):R35ContentEntry|null{return this.#entries.get(id)??null;}
  dependencies(id:R35Id):ReadonlyArray<R35Id>{return Object.freeze([...(this.#entries.get(id)?.dependencies??[])]);}
  resolveOrder(ids:readonly R35Id[]):R35Result<readonly R35Id[]>{const visiting=new Set<R35Id>();const visited=new Set<R35Id>();const order:R35Id[]=[];const visit=(id:R35Id):boolean=>{if(visited.has(id))return true;if(visiting.has(id))return false;const e=this.#entries.get(id);if(!e)return false;visiting.add(id);for(const dep of e.dependencies)if(!visit(dep))return false;visiting.delete(id);visited.add(id);order.push(id);return true;};for(const id of [...ids].sort())if(!visit(id))return fail('CONTENT_GRAPH_INVALID','Content dependency graph is missing data or cyclic');return ok(Object.freeze(order));}
  freeze():R35ContentManifest{this.#frozen=true;const entries=Object.freeze([...this.#entries.values()].sort((a,b)=>a.id.localeCompare(b.id)));return Object.freeze({version:1,entries,digest:stableHash(entries)});}
  manifest():R35ContentManifest{const entries=Object.freeze([...this.#entries.values()].sort((a,b)=>a.id.localeCompare(b.id)));return Object.freeze({version:1,entries,digest:stableHash(entries)});}
  reset():void{this.#entries.clear();this.#frozen=false;}
}
