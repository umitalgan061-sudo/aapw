import {RuntimeError,stableHash} from './contracts.ts';
import type {StatePatch,StateSelector,StateSnapshot,StateStoreOptions,StateSubscription,StateTransaction,Tick} from './contracts.ts';

type Listener<T>= (patch:StatePatch<T>)=>void;
interface SelectorEntry<S,V>{readonly selector:StateSelector<S,V>;readonly listener:(value:V,patch:StatePatch<S>)=>void;lastValue:V;}
export class StateStore<T extends object>{
  #state:T;#version=0;#tick:Tick=0 as Tick;readonly #options:StateStoreOptions<T>;readonly #history:StatePatch<T>[]=[];readonly #listeners=new Set<Listener<T>>();readonly #selectors=new Set<SelectorEntry<T,unknown>>();
  constructor(options:StateStoreOptions<T>){this.#options=options;this.#state=this.#prepare(options.initialState);}
  get state():Readonly<T>{return this.#state;} get version():number{return this.#version;} setTick(tick:Tick):void{this.#tick=tick;}
  subscribe(listener:Listener<T>):StateSubscription{this.#listeners.add(listener);return{dispose:()=>this.#listeners.delete(listener)};}
  subscribeSelector<V>(selector:StateSelector<T,V>,listener:(value:V,patch:StatePatch<T>)=>void):StateSubscription{
    const entry:SelectorEntry<T,V>={selector,listener,lastValue:selector.select(this.#state)};this.#selectors.add(entry as SelectorEntry<T,unknown>);return{dispose:()=>this.#selectors.delete(entry as SelectorEntry<T,unknown>)};
  }
  update(updater:(state:T)=>T,source='runtime',changedPaths:readonly string[]=[]):StatePatch<T>{return this.#commit(updater(this.#state),source,changedPaths);}
  replace(next:T,source='replace',changedPaths:readonly string[]=[]):StatePatch<T>{return this.#commit(next,source,changedPaths);}
  transaction(source='transaction'):StateTransaction<T>{
    const base=this.#state,version=this.#version;let active=true;let draft=this.#clone(base);
    return{id:'tx-'+String(version+1)+'-'+stableHash(base),baseVersion:version,get draft(){return draft;},
      commit:(commitSource=source)=>{if(!active)throw new RuntimeError({code:'R50_TRANSACTION_CLOSED',message:'State transaction is already closed'});if(version!==this.#version){active=false;throw new RuntimeError({code:'R50_TRANSACTION_CONFLICT',message:'State changed during transaction'});}active=false;return this.#commit(draft,commitSource,[]);},
      rollback:()=>{active=false;draft=this.#clone(base);}};
  }
  snapshot():StateSnapshot<T>{return{version:this.#version,state:this.#clone(this.#state),tick:this.#tick,hash:this.#options.hash(this.#state)};}
  restore(snapshot:StateSnapshot<T>,source='restore'):StatePatch<T>{if(snapshot.version>this.#version+1)throw new RuntimeError({code:'R50_SNAPSHOT_VERSION',message:'Snapshot version is ahead of local state'});this.#tick=snapshot.tick;return this.#commit(this.#clone(snapshot.state),source,['<snapshot>']);}
  history():readonly StatePatch<T>[] {return this.#history.slice();}
  undo(source='undo'):StatePatch<T>|null{const last=this.#history.at(-1);return last?this.#commit(this.#clone(last.previous),source,['<undo>']):null;}
  compareAndSwap(expected:number,updater:(state:T)=>T,source='compare-and-swap'):StatePatch<T>{if(this.#version!==expected)throw new RuntimeError({code:'R50_CAS_CONFLICT',message:'Expected version '+String(expected)+', got '+String(this.#version)});return this.update(updater,source);}
  clearHistory():void{this.#history.length=0;}
  #commit(nextValue:T,source:string,changedPaths:readonly string[]):StatePatch<T>{
    const previous=this.#state,next=this.#prepare(nextValue);const patch:StatePatch<T>={version:this.#version+1,previous,next,changedPaths:[...changedPaths],source,tick:this.#tick};
    this.#state=next;this.#version=patch.version;this.#history.push(patch);while(this.#history.length>this.#options.historyLimit)this.#history.shift();
    for(const listener of this.#listeners)listener(patch);
    for(const entry of this.#selectors){const value=entry.selector.select(next);const equals=entry.selector.equals??Object.is;if(!equals(entry.lastValue,value)){entry.lastValue=value;entry.listener(value,patch);}}
    return patch;
  }
  #prepare(value:T):T{return this.#options.freezeState?Object.freeze(value):value;}
  #clone(value:T):T{return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value)) as T;}
}
export function createSelector<S,V>(select:(state:S)=>V,equals?:(a:V,b:V)=>boolean):StateSelector<S,V>{return{select,...(equals===undefined?{}:{equals})};}
export interface StateCodec<T>{readonly encode:(state:T)=>string;readonly decode:(encoded:string)=>T;}
export const jsonStateCodec:StateCodec<Record<string,unknown>>={encode:JSON.stringify,decode:(encoded)=>{const value:unknown=JSON.parse(encoded);if(!value||typeof value!=='object'||Array.isArray(value))throw new RuntimeError({code:'R50_STATE_DECODE',message:'Decoded state must be an object',recoverable:false});return value as Record<string,unknown>;}}
