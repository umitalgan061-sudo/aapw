import { BoundedQueue } from './bounded.js';
import { combineDigests,digestValue,nextRevision,normalizeTick } from './deterministic.js';
import type { R16RuntimeConfig,R16SnapshotRecord,R16StateSnapshot } from './types.js';

export class R16SnapshotStore{
  readonly #snapshots:BoundedQueue<R16SnapshotRecord>; #revision=0;
  constructor(config:Pick<R16RuntimeConfig,'maxSnapshots'>){this.#snapshots=new BoundedQueue({capacity:Math.max(1,Math.trunc(config.maxSnapshots)),dropOldest:true});}
  capture(state:Readonly<Record<string,unknown>>,tick:number,kind:R16SnapshotRecord['kind']='checkpoint'):R16SnapshotRecord{
    this.#revision=nextRevision(this.#revision);const t=normalizeTick(tick);const frozen=cloneRecord(state);
    const snapshot:R16StateSnapshot=Object.freeze({version:16,revision:this.#revision,tick:t,state:frozen,digest:digestValue({revision:this.#revision,tick:t,state:frozen}),createdAtTick:t});
    const record:R16SnapshotRecord=Object.freeze({kind,revision:this.#revision,tick:t,digest:snapshot.digest,snapshot});this.#snapshots.push(record);return record;
  }
  latest(){return this.#snapshots.values().at(-1)??null;}
  atOrBefore(tick:number){return this.#snapshots.values().filter(s=>s.tick<=normalizeTick(tick)).at(-1)??null;}
  all(){return this.#snapshots.values();}
  digest(){return combineDigests(this.#snapshots.values().map(s=>s.digest));}
  clear(){this.#snapshots.clear();this.#revision=0;}
}
function cloneRecord(value:Readonly<Record<string,unknown>>):Readonly<Record<string,unknown>>{
  const clone=(v:unknown,d:number):unknown=>{
    if(d>32)return null;
    if(Array.isArray(v))return Object.freeze(v.slice(0,512).map(x=>clone(x,d+1)));
    if(typeof v==='object'&&v!==null){const out:Record<string,unknown>={};for(const[k,c]of Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)))out[k]=clone(c,d+1);return Object.freeze(out);}
    if(typeof v==='number'&&!Number.isFinite(v))return 0;if(typeof v==='bigint')return v.toString();return v;
  };
  return Object.freeze(clone(value,0) as Record<string,unknown>);
}
