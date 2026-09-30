import { BoundedQueue } from './bounded.js';
import { combineDigests,digestValue,nextRevision,normalizeTick } from './deterministic.js';
import type { R16PersistenceDigest,R16PersistenceEntry,R16PersistenceKind,R16RuntimeConfig,R16Result,R16StateSnapshot } from './types.js';

export class R16PersistenceJournal{
  readonly #journal:BoundedQueue<R16PersistenceEntry>;#sequence=0;#revision=0;
  constructor(config:Pick<R16RuntimeConfig,'maxJournalEntries'>){this.#journal=new BoundedQueue({capacity:Math.max(1,Math.trunc(config.maxJournalEntries)),dropOldest:true});}
  append(kind:R16PersistenceKind,tick:number,payload:Readonly<Record<string,unknown>>,revision=this.#revision):R16Result<R16PersistenceEntry>{
    if(!payload||typeof payload!=='object')return{ok:false,error:{code:'PERSIST_PAYLOAD',message:'Payload must be a record',retryable:false}};
    const t=normalizeTick(tick);this.#sequence++;this.#revision=Math.max(this.#revision,Math.trunc(revision));const frozen=freezeRecord(payload);
    const entry:R16PersistenceEntry=Object.freeze({sequence:this.#sequence,kind,tick:t,revision:this.#revision,digest:digestValue({sequence:this.#sequence,kind,tick:t,revision:this.#revision,payload:frozen}),payload:frozen});
    this.#journal.push(entry);return{ok:true,value:entry};
  }
  checkpoint(snapshot:R16StateSnapshot){this.#revision=nextRevision(this.#revision);return this.append('checkpoint',snapshot.tick,{revision:snapshot.revision,state:snapshot.state,snapshotDigest:snapshot.digest},this.#revision);}
  replayMarker(tick:number,label:string){return this.append('replay',tick,{label:label.slice(0,128)});}
  entries(kind?:R16PersistenceKind){return Object.freeze(this.#journal.values().filter(e=>!kind||e.kind===kind));}
  digest():R16PersistenceDigest{const e=this.#journal.values();return Object.freeze({firstSequence:e[0]?.sequence??0,lastSequence:e.at(-1)?.sequence??0,entryCount:e.length,digest:combineDigests(e.map(x=>x.digest))});}
  restoreLatestCheckpoint(){const entry=this.entries('checkpoint').at(-1);if(!entry||typeof entry.payload.state!=='object'||entry.payload.state===null)return null;return freezeRecord(entry.payload.state as Record<string,unknown>);}
  clear(){this.#journal.clear();this.#sequence=0;this.#revision=0;}
}
function freezeRecord(value:Readonly<Record<string,unknown>>):Readonly<Record<string,unknown>>{
  const out:Record<string,unknown>={};for(const[k,v]of Object.entries(value).sort(([a],[b])=>a.localeCompare(b)))out[k.slice(0,128)]=sanitize(v,0);return Object.freeze(out);
}
function sanitize(v:unknown,d:number):unknown{
  if(d>24)return null;if(Array.isArray(v))return Object.freeze(v.slice(0,512).map(x=>sanitize(x,d+1)));
  if(typeof v==='object'&&v!==null)return freezeRecord(v as Record<string,unknown>);if(typeof v==='number')return Number.isFinite(v)?v:0;if(typeof v==='bigint')return v.toString();return v;
}
