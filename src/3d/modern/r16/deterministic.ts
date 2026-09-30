import type { R16ClockSample, R16RuntimeDigest } from './types.js';

export function clampInt(value:number,min:number,max:number):number {
  const n=Number.isFinite(value)?Math.trunc(value):min; return Math.min(max,Math.max(min,n));
}
export function clamp01(value:number):number { const n=Number.isFinite(value)?value:0; return Math.min(1,Math.max(0,n)); }
export function mixSeed(seed:number,value:number):number {
  let x=(Math.trunc(seed)^Math.trunc(value))>>>0; x^=x>>>16; x=Math.imul(x,0x7feb352d)>>>0;
  x^=x>>>15; x=Math.imul(x,0x846ca68b)>>>0; x^=x>>>16; return x>>>0;
}
export function hashString(input:string,seed=2166136261):string {
  let hash=seed>>>0; for(let i=0;i<input.length;i+=1){ hash^=input.charCodeAt(i); hash=Math.imul(hash,16777619)>>>0; }
  return hash.toString(16).padStart(8,'0');
}
export function stableValue(value:unknown):string {
  if(value===null)return 'null'; if(value===undefined)return 'undefined';
  if(typeof value==='number'){if(!Number.isFinite(value))return 'number:nonfinite';if(Object.is(value,-0))return 'number:0';return 'number:'+value;}
  if(typeof value==='boolean')return 'boolean:'+(value?'1':'0');
  if(typeof value==='string')return 'string:'+value.length+':'+value;
  if(typeof value==='bigint')return 'bigint:'+value.toString();
  if(Array.isArray(value))return 'array:['+value.map(stableValue).join(',')+']';
  if(typeof value==='object'){return 'object:{'+Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>stableValue(k)+'='+stableValue(v)).join(',')+'}';}
  return 'other:'+String(value);
}
export function digestValue(value:unknown):string{return hashString(stableValue(value));}
export function sequenceId(prefix:string,tick:number,sequence:number,seed:number):string{
  return prefix+'-'+tick.toString(36)+'-'+sequence.toString(36)+'-'+mixSeed(seed,tick+sequence).toString(16);
}
export function createClockSample(previousTick:number,nextTick:number,monotonicMs:number,fixedStepMs:number):R16ClockSample{
  const tick=Math.max(previousTick+1,Math.trunc(nextTick)); const deltaMs=Number.isFinite(fixedStepMs)&&fixedStepMs>0?fixedStepMs:16.6666666667;
  return Object.freeze({tick,monotonicMs:Math.max(0,monotonicMs),deltaMs});
}
export function combineDigests(values:readonly string[]):string{return hashString(values.join('|'));}
export function digestRuntime(parts:Omit<R16RuntimeDigest,'tick'>&{tick:number}):string{
  return combineDigests([String(parts.tick),String(parts.stateRevision),parts.eventDigest,parts.snapshotDigest,parts.persistenceDigest,parts.telemetryDigest,parts.healthDigest,parts.replicationDigest]);
}
export function boundedRatio(numerator:number,denominator:number):number{
  if(!Number.isFinite(numerator)||!Number.isFinite(denominator)||denominator<=0)return 0; return clamp01(numerator/denominator);
}
export function nextRevision(previous:number):number{return Math.max(0,Math.trunc(previous))+1;}
export function normalizeTick(value:number):number{return Math.max(0,Math.trunc(Number.isFinite(value)?value:0));}
export function safeJsonSize(value:unknown):number{try{return stableValue(value).length;}catch{return Number.MAX_SAFE_INTEGER;}}
export function stableSort<T>(values:readonly T[],compare:(a:T,b:T)=>number):readonly T[]{return Object.freeze([...values].sort(compare));}
export function immutableRecord<T extends Record<string,unknown>>(value:T):Readonly<T>{return Object.freeze({...value});}
export const R16_DETERMINISM_POLICY=Object.freeze({maxDigestParts:64,maxStableStringLength:2000000,requiredFixedStepMs:16.6666666667});
