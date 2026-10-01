/** Browser-safe transport envelope for combat presentation consumers. */
import type { CombatAccessibilitySignal } from './combatPresentationAccessibilityV1';
import type { CombatPresentationDispatch } from './combatPresentationQueueV1';

export interface CombatPresentationBrowserEnvelope {
  readonly version: 1;
  readonly tick: number;
  readonly dispatches: readonly CombatPresentationDispatch[];
  readonly accessibility: readonly CombatAccessibilitySignal[];
  readonly createdAtMonotonicMs: number;
}
export interface CombatPresentationBrowserBridgeOptions { readonly eventName?: string; readonly maxDispatches?: number; readonly maxAccessibilitySignals?: number; readonly now?: () => number; }

const DEFAULT_EVENT='aapw:combat-presentation-v1';
const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;

export function buildCombatPresentationBrowserEnvelope(dispatches:readonly CombatPresentationDispatch[],accessibility:readonly CombatAccessibilitySignal[],options:CombatPresentationBrowserBridgeOptions={}):CombatPresentationBrowserEnvelope{
  const maxD=Math.max(0,Math.floor(options.maxDispatches??16)),maxA=Math.max(0,Math.floor(options.maxAccessibilitySignals??16));
  return Object.freeze({version:1 as const,tick:dispatches.reduce((m,d)=>Math.max(m,d.dispatchedTick),0),dispatches:Object.freeze(dispatches.slice(0,maxD)),accessibility:Object.freeze(accessibility.slice(0,maxA)),createdAtMonotonicMs:finite((options.now??(()=>typeof performance!=='undefined'?performance.now():0))())});
}

export function createCombatPresentationCustomEvent(envelope:CombatPresentationBrowserEnvelope,eventName=DEFAULT_EVENT):Event{
  if(typeof globalThis.CustomEvent==='function') return new globalThis.CustomEvent(eventName,{detail:envelope});
  return new Event(eventName);
}

export class CombatPresentationBrowserBridge{
  readonly eventName:string; readonly maxDispatches:number; readonly maxAccessibilitySignals:number; readonly now:()=>number;
  #dispatchEvent:((event:Event)=>boolean)|null=null;
  constructor(options:CombatPresentationBrowserBridgeOptions={} ){this.eventName=options.eventName??DEFAULT_EVENT;this.maxDispatches=Math.max(0,Math.floor(options.maxDispatches??16));this.maxAccessibilitySignals=Math.max(0,Math.floor(options.maxAccessibilitySignals??16));this.now=options.now??(()=>typeof performance!=='undefined'?performance.now():0);}
  attach(dispatchEvent:(event:Event)=>boolean):void{if(typeof dispatchEvent!=='function')throw new TypeError('dispatchEvent must be callable');this.#dispatchEvent=dispatchEvent;}
  detach():void{this.#dispatchEvent=null;}
  connected():boolean{return this.#dispatchEvent!==null;}
  emit(dispatches:readonly CombatPresentationDispatch[],accessibility:readonly CombatAccessibilitySignal[]=[]):CombatPresentationBrowserEnvelope{
    const envelope=buildCombatPresentationBrowserEnvelope(dispatches,accessibility,{eventName:this.eventName,maxDispatches:this.maxDispatches,maxAccessibilitySignals:this.maxAccessibilitySignals,now:this.now});
    if(this.#dispatchEvent){const event=createCombatPresentationCustomEvent(envelope,this.eventName);this.#dispatchEvent(event);}
    return envelope;
  }
}

export function createCombatPresentationBrowserBridge(options:CombatPresentationBrowserBridgeOptions={}):CombatPresentationBrowserBridge{return new CombatPresentationBrowserBridge(options);}

export function validateCombatPresentationBrowserEnvelope(envelope:CombatPresentationBrowserEnvelope):boolean{
  return envelope.version===1&&Number.isInteger(envelope.tick)&&envelope.tick>=0&&Number.isFinite(envelope.createdAtMonotonicMs)&&envelope.dispatches.every((d)=>d.dispatchedTick>=d.scheduledTick&&d.cue.id.length>0)&&envelope.accessibility.every((s)=>s.cueId.length>0);
}