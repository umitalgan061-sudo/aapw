/** Versioned world-state journal with bounded patches, checkpoints and deterministic digests. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };
export interface WorldPatchV15 { readonly path: readonly string[]; readonly before: JsonValue | undefined; readonly after: JsonValue | undefined; readonly revision: number; readonly tick: number; readonly source: string; }
export interface WorldCheckpointV15<T extends JsonValue = JsonValue> { readonly revision:number; readonly tick:number; readonly createdAtTick:number; readonly digest:string; readonly state:T; }
export interface JournalEntryV15 { readonly revision:number; readonly tick:number; readonly source:string; readonly patches:readonly WorldPatchV15[]; readonly digest:string; }
export interface JournalDiffV15 { readonly fromRevision:number; readonly toRevision:number; readonly patches:readonly WorldPatchV15[]; readonly entries:readonly JournalEntryV15[]; }

const clone = <T extends JsonValue>(value:T|undefined):T|undefined => value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as T;
const isObject = (value:JsonValue|undefined): value is {readonly [key:string]:JsonValue} => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const stableStringifyV15 = (value: JsonValue | undefined): string => {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringifyV15).join(',') + ']';
  const record = value as Record<string,JsonValue>;
  return '{' + Object.keys(record).sort().map((key)=>JSON.stringify(key)+':'+stableStringifyV15(record[key])).join(',') + '}';
};

export const digestV15 = (value: JsonValue | undefined): string => {
  const encoded=stableStringifyV15(value);
  let hash=2166136261;
  for(let index=0;index<encoded.length;index+=1){hash^=encoded.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16).padStart(8,'0');
};

const getAt=(root:JsonValue,path:readonly string[]):JsonValue|undefined=>{let value:JsonValue|undefined=root;for(const segment of path){if(!isObject(value))return undefined;value=value[segment];}return value;};
const setAt=(root:JsonValue,path:readonly string[],value:JsonValue|undefined):JsonValue=>{
  if(path.length===0)return value===undefined?null:clone(value)!;
  const result=isObject(root)?clone(root)!:{} as Record<string,JsonValue>;
  const [head,...tail]=path;
  const next=tail.length?setAt(result[head],tail,value):value;
  if(next===undefined)delete result[head];else result[head]=next;
  return result;
};

export class WorldStateJournalV15<T extends JsonValue = JsonValue> {
  readonly #maxEntries:number;
  readonly #maxCheckpoints:number;
  readonly #entries:JournalEntryV15[]=[];
  readonly #checkpoints:WorldCheckpointV15<T>[]=[];
  #state:T;
  #revision=0;
  #tick=0;

  constructor(initial:T, options:{maxEntries?:number;maxCheckpoints?:number}={}) { this.#state=clone(initial)!; this.#maxEntries=Math.max(32,Math.trunc(options.maxEntries??2048)); this.#maxCheckpoints=Math.max(2,Math.trunc(options.maxCheckpoints??32)); }
  get revision():number{return this.#revision;}
  get tick():number{return this.#tick;}
  state():T{return clone(this.#state)!;}
  digest():string{return digestV15(this.#state);}
  entryCount():number{return this.#entries.length;}
  checkpointCount():number{return this.#checkpoints.length;}

  patch(path:readonly string[], after:JsonValue|undefined, meta:{tick:number;source:string}):WorldPatchV15 {
    const before=getAt(this.#state,path);
    return Object.freeze({path:Object.freeze([...path.map((part)=>String(part))]),before:clone(before),after:clone(after),revision:this.#revision+1,tick:Math.max(0,Math.trunc(meta.tick)),source:meta.source.trim().slice(0,96)});
  }

  commit(patches:readonly WorldPatchV15[], source:string, tick:number):JournalEntryV15 {
    const normalized=patches.map((patch)=>Object.freeze({...patch,revision:this.#revision+1,tick:Math.max(0,Math.trunc(tick)),source:source.trim().slice(0,96)}));
    let next=this.#state;
    for(const patch of normalized) next=setAt(next,patch.path,patch.after) as T;
    this.#state=clone(next)!;
    this.#revision+=1;
    this.#tick=Math.max(this.#tick,Math.trunc(tick));
    const entry=Object.freeze({revision:this.#revision,tick:this.#tick,source:source.trim().slice(0,96),patches:Object.freeze(normalized),digest:this.digestV15State()});
    this.#entries.push(entry);
    while(this.#entries.length>this.#maxEntries)this.#entries.shift();
    return entry;
  }

  transaction(mutator:(state:Readonly<T>)=>readonly {path:readonly string[];after:JsonValue|undefined}[]|readonly WorldPatchV15[],meta:{tick:number;source:string}):JournalEntryV15 {
    const raw=mutator(this.#state);
    const patches=raw.map((patch)=>this.patch(patch.path,patch.after,{tick:meta.tick,source:meta.source}));
    return this.commit(patches,meta.source,meta.tick);
  }

  checkpoint(tick=this.#tick):WorldCheckpointV15<T> {
    const checkpoint=Object.freeze({revision:this.#revision,tick:Math.max(0,Math.trunc(tick)),createdAtTick:Math.max(0,Math.trunc(tick)),digest:this.digest(),state:this.state()});
    this.#checkpoints.push(checkpoint);
    while(this.#checkpoints.length>this.#maxCheckpoints)this.#checkpoints.shift();
    return checkpoint;
  }

  restoreCheckpoint(revision:number):boolean {
    const checkpoint=[...this.#checkpoints].reverse().find((item)=>item.revision===revision);
    if(!checkpoint)return false;
    this.#state=clone(checkpoint.state)!;
    this.#revision=checkpoint.revision;
    this.#tick=checkpoint.tick;
    while(this.#entries.length&&this.#entries[this.#entries.length-1]!.revision>revision)this.#entries.pop();
    return true;
  }

  diff(fromRevision:number,toRevision=this.#revision):JournalDiffV15 {
    const from=Math.max(0,Math.trunc(fromRevision));
    const to=Math.max(from,Math.trunc(toRevision));
    const entries=this.#entries.filter((entry)=>entry.revision>from&&entry.revision<=to);
    return Object.freeze({fromRevision:from,toRevision:to,patches:Object.freeze(entries.flatMap((entry)=>entry.patches)),entries:Object.freeze(entries)});
  }

  entries(fromRevision=0):readonly JournalEntryV15[]{return Object.freeze(this.#entries.filter((entry)=>entry.revision>=fromRevision));}
  checkpoints():readonly WorldCheckpointV15<T>[]{return Object.freeze(this.#checkpoints.map((item)=>Object.freeze({...item,state:clone(item.state)!})));}
  reset(state:T,tick=0):void{this.#state=clone(state)!;this.#revision=0;this.#tick=Math.max(0,Math.trunc(tick));this.#entries.length=0;this.#checkpoints.length=0;}

  digestV15State():string{return digestV15(this.#state);}
}

export const mergePatchListsV15=(...lists:readonly (readonly WorldPatchV15[])[]):readonly WorldPatchV15[]=>Object.freeze(lists.flat().sort((a,b)=>a.path.join('.').localeCompare(b.path.join('.'))||a.revision-b.revision||a.source.localeCompare(b.source)));

export const validateJournalEntryV15=(entry:JournalEntryV15):boolean=>entry.revision>0&&entry.tick>=0&&entry.patches.every((patch)=>patch.path.every((segment)=>segment.length>0)&&patch.revision===entry.revision)&&entry.digest.length===8;
