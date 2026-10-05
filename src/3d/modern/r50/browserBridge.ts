import {RuntimeError} from './contracts.ts';
import type {BrowserSignalSnapshot} from './contracts.ts';

export type BrowserEventType='visibility'|'online'|'offline'|'resize'|'pointerlock'|'beforeunload';
interface EventMap{visibility:BrowserSignalSnapshot;online:BrowserSignalSnapshot;offline:BrowserSignalSnapshot;resize:BrowserSignalSnapshot;pointerlock:BrowserSignalSnapshot;beforeunload:BrowserSignalSnapshot;}
type Listener<K extends BrowserEventType>=(snapshot:EventMap[K])=>void;
export class BrowserRuntimeBridge{
  readonly #target?:Window;readonly #document?:Document;readonly #listeners=new Map<BrowserEventType,Set<Listener<BrowserEventType>>>();#attached=false;#snapshot:BrowserSignalSnapshot;
  constructor(options:{readonly target?:Window;readonly document?:Document}={}){this.#target=options.target??(typeof window==='undefined'?undefined:window);this.#document=options.document??(typeof document==='undefined'?undefined:document);this.#snapshot=this.#read();}
  get snapshot():BrowserSignalSnapshot{return this.#snapshot;}
  on<K extends BrowserEventType>(type:K,listener:Listener<K>):()=>void{const set=this.#listeners.get(type)??new Set();set.add(listener as Listener<BrowserEventType>);this.#listeners.set(type,set);return()=>set.delete(listener as Listener<BrowserEventType>);}
  attach():void{if(this.#attached||!this.#target||!this.#document)return;this.#attached=true;this.#target.addEventListener('online',this.#online);this.#target.addEventListener('offline',this.#offline);this.#target.addEventListener('resize',this.#resize);this.#target.addEventListener('beforeunload',this.#unload);this.#document.addEventListener('visibilitychange',this.#visibility);this.#document.addEventListener('pointerlockchange',this.#pointer);}
  detach():void{if(!this.#attached||!this.#target||!this.#document)return;this.#attached=false;this.#target.removeEventListener('online',this.#online);this.#target.removeEventListener('offline',this.#offline);this.#target.removeEventListener('resize',this.#resize);this.#target.removeEventListener('beforeunload',this.#unload);this.#document.removeEventListener('visibilitychange',this.#visibility);this.#document.removeEventListener('pointerlockchange',this.#pointer);}
  persist<T>(key:string,value:T):void{if(!this.#target)return;try{this.#target.localStorage.setItem(key,JSON.stringify(value));}catch(error){throw new RuntimeError({code:'R50_STORAGE_WRITE',message:'Unable to persist browser state',cause:error});}}
  restore<T>(key:string,fallback:T):T{if(!this.#target)return fallback;try{const value=this.#target.localStorage.getItem(key);return value===null?fallback:JSON.parse(value) as T;}catch{return fallback;}}
  requestPointerLock(element:Element):void{const request=(element as Element&{requestPointerLock?:()=>Promise<void>|void}).requestPointerLock;if(!request)throw new RuntimeError({code:'R50_POINTER_LOCK_UNSUPPORTED',message:'Pointer lock is not supported'});void Promise.resolve(request.call(element)).catch(error=>{throw new RuntimeError({code:'R50_POINTER_LOCK_FAILED',message:'Pointer lock request failed',cause:error});});}
  exitPointerLock():void{this.#document?.exitPointerLock?.();}
  #read():BrowserSignalSnapshot{const target=this.#target,doc=this.#document;let coarse=false;try{coarse=Boolean(target?.matchMedia('(pointer: coarse)').matches)||Boolean(target?.navigator.maxTouchPoints>1);}catch{coarse=Boolean(target?.navigator.maxTouchPoints>1);}return{visible:doc?.visibilityState!=='hidden',online:target?.navigator.onLine??true,width:target?.innerWidth??0,height:target?.innerHeight??0,devicePixelRatio:target?.devicePixelRatio??1,pointerLocked:doc?.pointerLockElement!==null,coarsePointer:coarse};}
  #emit(type:BrowserEventType):void{this.#snapshot=this.#read();for(const listener of this.#listeners.get(type)??[])listener(this.#snapshot);}
  readonly #online=()=>this.#emit('online');readonly #offline=()=>this.#emit('offline');readonly #resize=()=>this.#emit('resize');readonly #unload=()=>this.#emit('beforeunload');readonly #visibility=()=>this.#emit('visibility');readonly #pointer=()=>this.#emit('pointerlock');
}
export interface SafeStorage{readonly getItem:(key:string)=>string|null;readonly setItem:(key:string,value:string)=>void;readonly removeItem:(key:string)=>void;}
export function createSafeStorage(target:Window|undefined):SafeStorage{return{getItem:key=>{try{return target?.localStorage.getItem(key)??null;}catch{return null;}},setItem:(key,value)=>{try{target?.localStorage.setItem(key,value);}catch{}},removeItem:key=>{try{target?.localStorage.removeItem(key);}catch{}}};}
