import type { ActorSnapshot, PerceivedStimulus, Stimulus, MemoryRecord, TickNumber } from './types.js';
import { clamp01, distanceSq } from './types.js';
import { deterministicHash } from '../types/determinism.js';

export interface OcclusionProbe { isOccluded(source:ActorSnapshot, stimulus:Stimulus):boolean; }
export interface PerceptionPolicy { readonly visualRange:number; readonly audioRange:number; readonly damageRange:number; readonly confidenceFloor:number; readonly maxStimuli:number; readonly memoryDecay:number; }
export interface PerceptionResult { readonly actorId:ActorSnapshot['id']; readonly tick:TickNumber; readonly observations:readonly PerceivedStimulus[]; readonly memories:readonly MemoryRecord[]; readonly dropped:number; }

const intensityByKind=(kind:Stimulus['kind']):number=>({visual:1,audio:0.75,damage:1,death:0.95,movement:0.65,interaction:0.5,resource:0.4,weather:0.25,faction:0.55}[kind]);
const rangeByKind=(kind:Stimulus['kind'],p:PerceptionPolicy):number=>({visual:p.visualRange,audio:p.audioRange,damage:p.damageRange,death:p.audioRange,movement:p.visualRange,interaction:p.visualRange*0.75,resource:p.visualRange*0.6,weather:p.visualRange,faction:p.visualRange}[kind]);

export function createPerceptionPolicy(partial:Partial<PerceptionPolicy>={}):PerceptionPolicy{return Object.freeze({visualRange:partial.visualRange??80,audioRange:partial.audioRange??48,damageRange:partial.damageRange??36,confidenceFloor:partial.confidenceFloor??0.08,maxStimuli:partial.maxStimuli??32,memoryDecay:partial.memoryDecay??0.018});}

export function stimulusConfidence(actor:ActorSnapshot,stimulus:Stimulus,policy:PerceptionPolicy,probe?:OcclusionProbe):number{
  const r=rangeByKind(stimulus.kind,policy);if(r<=0)return 0;const d=Math.sqrt(distanceSq(actor.position,stimulus.position));if(d>r+stimulus.radius)return 0;
  const distanceFactor=1-clamp01(Math.max(0,d-stimulus.radius)/r);const kindFactor=intensityByKind(stimulus.kind);const occluded=probe?.isOccluded(actor,stimulus)??false;
  const occlusionFactor=occluded&&stimulus.kind==='visual'?0.18:occluded?0.65:1;return clamp01(distanceFactor*kindFactor*clamp01(stimulus.intensity)*occlusionFactor);
}

export function salience(stimulus:Stimulus,confidence:number,nowTick:TickNumber):number{const age=Math.max(0,Number(nowTick)-Number(stimulus.tick));return clamp01(confidence*stimulus.intensity*Math.pow(0.82,Math.min(age,64)));}

export function perceive(actor:ActorSnapshot,stimuli:readonly Stimulus[],tick:TickNumber,policy:PerceptionPolicy,probe?:OcclusionProbe):PerceptionResult{
  const ranked=stimuli.map(s=>{const confidence=stimulusConfidence(actor,s,policy,probe);return {s,confidence,salience:salience(s,confidence,tick)}}).filter(x=>x.confidence>=policy.confidenceFloor).sort((a,b)=>b.salience-a.salience||b.confidence-a.confidence||String(a.s.id).localeCompare(String(b.s.id)));
  const observations=ranked.slice(0,policy.maxStimuli).map(x=>Object.freeze({...x.s,confidence:x.confidence,occluded:probe?.isOccluded(actor,x.s)??false,salience:x.salience}));
  const memories=observations.map(o=>Object.freeze({id:`memory:${actor.id}:${o.id}`,subjectId:o.sourceId,kind:o.kind,position:o.position,intensity:o.intensity,confidence:o.confidence,createdTick:tick,lastObservedTick:tick,decayPerTick:policy.memoryDecay,tags:Object.freeze([...o.tags])}));
  return Object.freeze({actorId:actor.id,tick,observations:Object.freeze(observations),memories:Object.freeze(memories),dropped:Math.max(0,ranked.length-observations.length)});
}

export function mergePerceptions(results:readonly PerceptionResult[],max=64):PerceivedStimulus[]{const map=new Map<string,PerceivedStimulus>();for(const r of results)for(const s of r.observations){const prior=map.get(s.id);if(!prior||s.confidence>prior.confidence)map.set(s.id,s);}return [...map.values()].sort((a,b)=>b.salience-a.salience||String(a.id).localeCompare(String(b.id))).slice(0,Math.max(0,max));}

export interface SensorHistoryEntry { readonly tick:TickNumber; readonly stimulusId:string; readonly confidence:number; readonly kind:string; }
export class PerceptionHistory {
  readonly #entries:SensorHistoryEntry[]=[];readonly #max:number;#disposed=false;
  constructor(max=128){this.#max=Math.max(1,Math.floor(max));}
  push(entry:SensorHistoryEntry):void{if(this.#disposed)return;this.#entries.push(Object.freeze({...entry}));while(this.#entries.length>this.#max)this.#entries.shift();}
  recent(since:number):readonly SensorHistoryEntry[]{return this.#entries.filter(e=>Number(e.tick)>=since);}
  digest():number{return deterministicHash(this.#entries.map(e=>Number(e.tick)+e.confidence+e.stimulusId.length));}
  snapshot():readonly SensorHistoryEntry[]{return Object.freeze([...this.#entries]);}
  clear():void{this.#entries.length=0;}
  dispose():void{this.#disposed=true;this.clear();}
}

export function buildHearingStimulus(id:string,position:{x:number;y:number;z:number},tick:TickNumber,intensity:number,radius:number,tags:readonly string[]=[]):Stimulus{return Object.freeze({id,kind:'audio',position,radius:intensity>0?radius:0,intensity:clamp01(intensity),tick,tags:Object.freeze([...tags]),expiresAt:(Number(tick)+32) as TickNumber});}
export function buildDamageStimulus(id:string,sourceId:ActorSnapshot['id'],position:{x:number;y:number;z:number},tick:TickNumber,intensity:number):Stimulus{return Object.freeze({id,kind:'damage',sourceId,position,radius:12,intensity:clamp01(intensity),tick,tags:Object.freeze(['combat']),expiresAt:(Number(tick)+48) as TickNumber});}
