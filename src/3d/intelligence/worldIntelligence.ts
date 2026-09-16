import type { Vec3 } from '../types/platform.js';
import { DeterministicRng, asSeed } from '../types/determinism.js';

export type ActorId = string & { readonly __actorId: unique symbol };
export type FactionId = string & { readonly __factionId: unique symbol };
export type Tick = number & { readonly __tick: unique symbol };
export type GoalKind = 'survive'|'investigate'|'patrol'|'hunt'|'gather'|'protect'|'flee'|'assist'|'rest'|'travel'|'idle';
export type StimulusKind = 'visual'|'audio'|'damage'|'death'|'movement'|'interaction'|'resource'|'weather'|'faction';
export type IntentKind = 'move'|'look'|'attack'|'defend'|'interact'|'communicate'|'wait'|'flee'|'follow';
export type Relation = 'ally'|'friendly'|'neutral'|'suspicious'|'hostile'|'fearful';

export interface ActorSnapshot {readonly id:ActorId;readonly position:Vec3;readonly health:number;readonly maxHealth:number;readonly stamina:number;readonly maxStamina:number;readonly faction:FactionId;readonly stance:'calm'|'curious'|'alert'|'afraid'|'hostile'|'fleeing'|'disabled';readonly alive:boolean;readonly level:number;readonly tags:readonly string[];}
export interface FactionProfile {readonly id:FactionId;readonly name:string;readonly power:number;readonly relations:Readonly<Record<string,Relation>>;readonly preferredGoals:readonly GoalKind[];readonly territoryTags:readonly string[];}
export interface Stimulus {readonly id:string;readonly kind:StimulusKind;readonly sourceId?:ActorId;readonly position:Vec3;readonly radius:number;readonly intensity:number;readonly tick:Tick;readonly tags:readonly string[];readonly expiresAt:Tick;}
export interface Memory {readonly id:string;readonly subjectId?:ActorId;readonly kind:StimulusKind;readonly position:Vec3;readonly confidence:number;readonly intensity:number;readonly createdTick:Tick;readonly lastObservedTick:Tick;readonly decay:number;readonly tags:readonly string[];}
export interface Goal {readonly id:string;readonly kind:GoalKind;readonly priority:number;readonly durationTicks:number;readonly prerequisites:readonly string[];readonly cooldownTicks:number;readonly interruptible:boolean;}
export interface Intent {readonly actorId:ActorId;readonly kind:IntentKind;readonly score:number;readonly targetId?:ActorId;readonly position?:Vec3;readonly goalId:string;readonly reason:string;readonly expiresTick:Tick;}
export interface EventRecord {readonly id:string;readonly kind:'combat'|'discovery'|'resource'|'weather'|'faction'|'quest'|'travel'|'ecology';readonly tick:Tick;readonly origin:Vec3;readonly radius:number;readonly intensity:number;readonly tags:readonly string[];readonly payload:Readonly<Record<string,string|number|boolean>>;}
export interface InterestPoint {readonly id:string;readonly position:Vec3;readonly importance:number;readonly tags:readonly string[];readonly available:boolean;}
export interface IntelligenceConfig {readonly actorCap:number;readonly stimulusCap:number;readonly memoryCap:number;readonly goalCap:number;readonly eventCap:number;readonly interestCap:number;readonly perceptionRadius:number;readonly decisionInterval:number;readonly memoryHalfLife:number;readonly eventRetention:number;readonly seed:number;}
export interface IntelligenceMetrics {readonly tick:Tick;readonly actors:number;readonly stimuli:number;readonly memories:number;readonly decisions:number;readonly events:number;readonly interests:number;readonly budgetDrops:number;readonly digest:number;}
export interface IntelligenceResult {readonly tick:Tick;readonly intents:readonly Intent[];readonly memories:readonly Memory[];readonly interests:readonly {readonly id:string;readonly score:number;readonly tier:'critical'|'high'|'normal'|'low'|'sleeping';readonly reason:string}[];readonly metrics:IntelligenceMetrics;}

const c01=(v:number)=>Number.isFinite(v)?Math.min(1,Math.max(0,v)):0;
const tick=(v:number):Tick=>{if(!Number.isSafeInteger(v)||v<0)throw new RangeError('Invalid tick');return v as Tick;};
const dist2=(a:Vec3,b:Vec3)=>{const x=a.x-b.x,y=a.y-b.y,z=a.z-b.z;return x*x+y*y+z*z;};
const stable<T>(values:readonly T[],key:(v:T)=>string):T[]=>[...values].sort((a,b)=>key(a).localeCompare(key(b)));
const digest=(s:string):number=>{let h=2166136261;for(let i=0;i<s.length;i+=1){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;};

export const DEFAULT_INTELLIGENCE_CONFIG:IntelligenceConfig=Object.freeze({actorCap:128,stimulusCap:32,memoryCap:256,goalCap:16,eventCap:1024,interestCap:24,perceptionRadius:96,decisionInterval:6,memoryHalfLife:32,eventRetention:720,seed:1337});
export function normalizeConfig(input:Partial<IntelligenceConfig>={}):IntelligenceConfig{return Object.freeze({...DEFAULT_INTELLIGENCE_CONFIG,...input,actorCap:Math.max(1,Math.floor(input.actorCap??DEFAULT_INTELLIGENCE_CONFIG.actorCap)),stimulusCap:Math.max(1,Math.floor(input.stimulusCap??DEFAULT_INTELLIGENCE_CONFIG.stimulusCap)),memoryCap:Math.max(1,Math.floor(input.memoryCap??DEFAULT_INTELLIGENCE_CONFIG.memoryCap)),goalCap:Math.max(1,Math.floor(input.goalCap??DEFAULT_INTELLIGENCE_CONFIG.goalCap)),eventCap:Math.max(1,Math.floor(input.eventCap??DEFAULT_INTELLIGENCE_CONFIG.eventCap)),interestCap:Math.max(1,Math.floor(input.interestCap??DEFAULT_INTELLIGENCE_CONFIG.interestCap)),perceptionRadius:Number.isFinite(input.perceptionRadius)?Math.max(1,input.perceptionRadius!):DEFAULT_INTELLIGENCE_CONFIG.perceptionRadius,decisionInterval:Math.max(1,Math.floor(input.decisionInterval??DEFAULT_INTELLIGENCE_CONFIG.decisionInterval)),memoryHalfLife:Math.max(1,Math.floor(input.memoryHalfLife??DEFAULT_INTELLIGENCE_CONFIG.memoryHalfLife)),eventRetention:Math.max(1,Math.floor(input.eventRetention??DEFAULT_INTELLIGENCE_CONFIG.eventRetention)),seed:Number.isSafeInteger(input.seed)?input.seed!:DEFAULT_INTELLIGENCE_CONFIG.seed});}

export class Blackboard{
 readonly #values=new Map<string,{value:unknown;updated:Tick;expires?:Tick;confidence:number}>();#disposed=false;#revision=0;
 set(key:string,value:unknown,updated:Tick,confidence=1,expires?:Tick):boolean{if(this.#disposed||!key.trim())return false;const old=this.#values.get(key);if(old&&old.updated>updated)return false;this.#values.set(key,Object.freeze({value,updated,confidence:c01(confidence),...(expires===undefined?{}:{expires})}));this.#revision+=1;return true;}
 get<T=unknown>(key:string,now?:Tick):T|undefined{if(this.#disposed)return undefined;const entry=this.#values.get(key);if(!entry)return undefined;if(now!==undefined&&entry.expires!==undefined&&now>entry.expires){this.#values.delete(key);this.#revision+=1;return undefined;}return entry.value as T;}
 has(key:string,now?:Tick):boolean{return this.get(key,now)!==undefined;}
 delete(key:string):boolean{if(this.#disposed)return false;const removed=this.#values.delete(key);if(removed)this.#revision+=1;return removed;}
 snapshot():Readonly<Record<string,unknown>>{return Object.freeze(Object.fromEntries([...this.#values.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,v.value])));}
 get revision(){return this.#revision;}
 dispose(){this.#disposed=true;this.#values.clear();this.#revision+=1;}
}

export class MemoryLedger{
 readonly #items=new Map<string,Memory>();readonly #cap:number;#disposed=false;
 constructor(cap:number){this.#cap=Math.max(1,Math.floor(cap));}
 upsert(memory:Memory):boolean{if(this.#disposed)return false;const old=this.#items.get(memory.id);if(old&&old.lastObservedTick>memory.lastObservedTick)return false;this.#items.set(memory.id,Object.freeze({...memory,confidence:c01(memory.confidence),intensity:c01(memory.intensity),tags:Object.freeze([...memory.tags])}));this.#trim();return !old||old.confidence!==memory.confidence||old.lastObservedTick!==memory.lastObservedTick;}
 rememberMany(values:readonly Memory[]):number{let n=0;for(const value of values)n+=this.upsert(value)?1:0;return n;}
 decay(now:Tick):number{if(this.#disposed)return 0;let n=0;for(const [id,m] of this.#items){const age=Math.max(0,Number(now)-Number(m.lastObservedTick));const confidence=m.confidence*Math.pow(.5,age/Math.max(1,m.decay));if(confidence<.01){this.#items.delete(id);n+=1;}else if(Math.abs(confidence-m.confidence)>.0001){this.#items.set(id,Object.freeze({...m,confidence}));n+=1;}}return n;}
 values():readonly Memory[]{return Object.freeze(stable([...this.#items.values()],m=>m.id));}
 clear(){this.#items.clear();}
 dispose(){this.#disposed=true;this.clear();}
 get size(){return this.#items.size;}
 #trim(){while(this.#items.size>this.#cap){const old=[...this.#items.values()].sort((a,b)=>Number(a.lastObservedTick)-Number(b.lastObservedTick)||a.confidence-b.confidence||a.id.localeCompare(b.id))[0];if(!old)break;this.#items.delete(old.id);}}
}

export class EventJournal{
 readonly #events=new Map<string,EventRecord>();readonly #cap:number;readonly #retention:number;#disposed=false;
 constructor(cap:number,retention:number){this.#cap=Math.max(1,Math.floor(cap));this.#retention=Math.max(1,Math.floor(retention));}
 append(event:EventRecord):boolean{if(this.#disposed||this.#events.has(event.id)||event.intensity<.01||event.radius<0||!Number.isFinite(event.radius))return false;this.#events.set(event.id,Object.freeze({...event,intensity:c01(event.intensity),tags:Object.freeze([...event.tags].sort())}));while(this.#events.size>this.#cap)this.#events.delete([...this.#events.values()].sort((a,b)=>Number(a.tick)-Number(b.tick)||a.id.localeCompare(b.id))[0]!.id);return true;}
 prune(now:Tick):number{let n=0;for(const [id,e] of this.#events)if(Number(now)-Number(e.tick)>this.#retention){this.#events.delete(id);n+=1;}return n;}
 query(kind?:EventRecord['kind']):readonly EventRecord[]{return Object.freeze(stable([...this.#events.values()].filter(e=>!kind||e.kind===kind),e=>`${Number(e.tick).toString().padStart(12,'0')}:${e.id}`));}
 clear(){this.#events.clear();}
 dispose(){this.#disposed=true;this.clear();}
 get size(){return this.#events.size;}
}

export class DeterministicInterestMap{
 readonly #points=new Map<string,InterestPoint>();#disposed=false;
 upsert(point:InterestPoint){if(this.#disposed||!point.id.trim())return;this.#points.set(point.id,Object.freeze({...point,importance:c01(point.importance),tags:Object.freeze([...point.tags])}));}
 remove(id:string){return this.#points.delete(id);}
 rank(position:Vec3,radius:number,limit:number):readonly {readonly point:InterestPoint;readonly score:number;readonly tier:'critical'|'high'|'normal'|'low'|'sleeping';readonly reason:string}[]{if(this.#disposed)return [];const candidates=[...this.#points.values()].filter(p=>p.available&&dist2(p.position,position)<=radius*radius).map(p=>{const d=Math.sqrt(dist2(p.position,position));const score=c01(.62*(1-c01(d/Math.max(1,radius)))+.38*p.importance);const tier=score>=.86||d<18?'critical':score>=.62?'high':score>=.32?'normal':score>=.12?'low':'sleeping';return Object.freeze({point:p,score,tier,reason:`${p.tags.join(',')||'point'}@${d.toFixed(1)}`});}).sort((a,b)=>b.score-a.score||a.point.id.localeCompare(b.point.id));return Object.freeze(candidates.slice(0,Math.max(0,Math.floor(limit))));}
 clear(){this.#points.clear();}
 dispose(){this.#disposed=true;this.clear();}
 get size(){return this.#points.size;}
}

export class WorldIntelligence{
 readonly #config:IntelligenceConfig;readonly #actors=new Map<string,{actor:ActorSnapshot;faction:FactionProfile;blackboard:Blackboard;memories:MemoryLedger;goals:readonly Goal[];lastIntent?:Intent}>();readonly #factions=new Map<string,FactionProfile>();readonly #events:EventJournal;readonly #interests:DeterministicInterestMap;readonly #rng:DeterministicRng;#disposed=false;#lastMetrics:IntelligenceMetrics={tick:tick(0),actors:0,stimuli:0,memories:0,decisions:0,events:0,interests:0,budgetDrops:0,digest:0};
 constructor(config:Partial<IntelligenceConfig>={}){this.#config=normalizeConfig(config);this.#events=new EventJournal(this.#config.eventCap,this.#config.eventRetention);this.#interests=new DeterministicInterestMap();this.#rng=new DeterministicRng(asSeed(this.#config.seed));}
 registerFaction(faction:FactionProfile){if(this.#disposed)return;this.#factions.set(String(faction.id),Object.freeze({...faction,relations:Object.freeze({...faction.relations}),preferredGoals:Object.freeze([...faction.preferredGoals]),territoryTags:Object.freeze([...faction.territoryTags])}));}
 registerActor(actor:ActorSnapshot,goals:readonly Goal[]=[]){if(this.#disposed||this.#actors.has(String(actor.id)))return;const faction=this.#factions.get(String(actor.faction));if(!faction)throw new Error(`Faction not registered: ${actor.faction}`);this.#actors.set(String(actor.id),{actor,faction,blackboard:new Blackboard(),memories:new MemoryLedger(this.#config.memoryCap),goals:Object.freeze(goals.slice(0,this.#config.goalCap))});}
 updateActor(actor:ActorSnapshot){const state=this.#actors.get(String(actor.id));if(state)this.#actors.set(String(actor.id),Object.freeze({...state,actor}));}
 addInterest(point:InterestPoint){this.#interests.upsert(point);}
 addEvent(event:EventRecord){return this.#events.append(event);}
 getEvents(){return this.#events;}
 tick(input:{readonly tick:number;readonly actors:readonly ActorSnapshot[];readonly stimuli:readonly Stimulus[];readonly events?:readonly EventRecord[];readonly weather?:string;readonly timeOfDay?:number}):IntelligenceResult{
  if(this.#disposed)return Object.freeze({tick:tick(input.tick),intents:[],memories:[],interests:[],metrics:this.#lastMetrics});
  const now=tick(input.tick);for(const f of this.#factions.values())this.registerFaction(f);let drops=Math.max(0,input.actors.length-this.#config.actorCap);const actors=input.actors.slice(0,this.#config.actorCap);for(const e of input.events??[])this.addEvent(e);
  const allIntents:Intent[]=[];const allMemories:Memory[]=[];const allInterests:ReturnType<DeterministicInterestMap['rank']>[number][]=[];let stimulusCount=0,decisions=0;
  for(const actor of actors){let state=this.#actors.get(String(actor.id));if(!state){this.registerActor(actor);state=this.#actors.get(String(actor.id));}if(!state){drops+=1;continue;}this.updateActor(actor);const relevant=input.stimuli.filter(s=>s.expiresAt>=now).map(s=>{const distance=Math.sqrt(dist2(actor.position,s.position));const range=Math.max(1,s.radius+this.#config.perceptionRadius);const confidence=c01((1-c01(distance/range))*c01(s.intensity));return {s,confidence};}).filter(x=>x.confidence>.05).sort((a,b)=>b.confidence-a.confidence||a.s.id.localeCompare(b.s.id)).slice(0,this.#config.stimulusCap);stimulusCount+=relevant.length;
    const memories=relevant.map(({s,confidence})=>Object.freeze({id:`${actor.id}:${s.id}`,subjectId:s.sourceId,kind:s.kind,position:s.position,confidence,intensity:s.intensity,createdTick:now,lastObservedTick:now,decay:this.#config.memoryHalfLife,tags:s.tags}));state.memories.rememberMany(memories);state.memories.decay(now);allMemories.push(...state.memories.values().slice(0,32));
    if(Number(now)%this.#config.decisionInterval===0){const danger=c01([...actors].filter(a=>a.id!==actor.id&&a.alive&&a.faction!==actor.faction).reduce((n,a)=>n+c01(1-Math.sqrt(dist2(actor.position,a.position))/32)*.4,0));const scored=state.goals.map(goal=>({goal,score:this.#scoreGoal(goal,actor,state.faction,relevant.map(x=>x.s),danger),})).filter(x=>x.goal.prerequisites.every(tag=>actor.tags.includes(tag))).sort((a,b)=>b.score-a.score||a.goal.id.localeCompare(b.goal.id));const winner=scored[0];if(winner&&winner.score>.08){const intent=this.#intent(actor,winner.goal,winner.score,relevant.map(x=>x.s),now);if(intent){state.lastIntent=intent;allIntents.push(intent);decisions+=1;}}}
    allInterests.push(...this.#interests.rank(actor.position,this.#config.perceptionRadius,this.#config.interestCap));state.blackboard.set('danger',Number.isFinite(actor.health)&&actor.maxHealth>0?c01(1-actor.health/actor.maxHealth):1,now,.95,((Number(now)+this.#config.decisionInterval*2) as Tick));
  }
  let events=0;for(const e of input.events??[])events+=this.#events.append(e)?1:0;this.#events.prune(now);
  const uniqueIntentMap=new Map(allIntents.map(i=>[`${i.actorId}:${i.kind}:${i.goalId}`,i]));const intents=Object.freeze([...uniqueIntentMap.values()].sort((a,b)=>b.score-a.score||String(a.actorId).localeCompare(String(b.actorId))));const interests=Object.freeze([...new Map(allInterests.map(i=>[i.point.id,i])).values()].sort((a,b)=>b.score-a.score||a.point.id.localeCompare(b.point.id)).map(i=>Object.freeze({id:i.point.id,score:i.score,tier:i.tier,reason:i.reason})).slice(0,this.#config.interestCap));
  const signature=`${Number(now)}|${intents.map(i=>`${i.actorId}:${i.kind}:${i.score.toFixed(5)}`).join(',')}|${interests.map(i=>`${i.id}:${i.score.toFixed(5)}`).join(',')}|${events}`;this.#lastMetrics=Object.freeze({tick:now,actors:actors.length,stimuli:stimulusCount,memories:allMemories.length,decisions,events,interests:interests.length,budgetDrops:drops,digest:digest(signature)});return Object.freeze({tick:now,intents,memories:Object.freeze(stable(allMemories,m=>m.id)),interests,metrics:this.#lastMetrics});
 }
 snapshot(){return Object.freeze({version:'1.0.0',metrics:this.#lastMetrics,actors:Object.freeze(stable([...this.#actors.values()].map(v=>v.actor),a=>String(a.id))),events:Object.freeze(this.#events.query()),seed:this.#config.seed});}
 dispose(){if(this.#disposed)return;this.#disposed=true;for(const state of this.#actors.values()){state.blackboard.dispose();state.memories.dispose();}this.#actors.clear();this.#events.dispose();this.#interests.dispose();}
 #scoreGoal(goal:Goal,actor:ActorSnapshot,faction:FactionProfile,stimuli:readonly Stimulus[],danger:number):number{const health=actor.maxHealth>0?c01(1-actor.health/actor.maxHealth):1;const stamina=actor.maxStamina>0?c01(1-actor.stamina/actor.maxStamina):1;const stimulus=Math.max(0,...stimuli.map(s=>c01(s.intensity)));let value=.15+c01(goal.priority/100)*.2;switch(goal.kind){case'flee':value+=danger*.65+health*.35;break;case'survive':value+=health*.55+danger*.35;break;case'hunt':value+=danger*.4+stimulus*.25+(faction.preferredGoals.includes('hunt')?.2:0);break;case'investigate':value+=stimulus*.55+(faction.preferredGoals.includes('investigate')?.2:0);break;case'gather':value+=.25+(faction.preferredGoals.includes('gather')?.2:0);break;case'protect':case'assist':value+=danger*.25+(faction.preferredGoals.includes(goal.kind)?.25:0);break;case'rest':value+=stamina*.55;break;case'patrol':case'travel':value+=.25+(1-danger)*.2;break;default:value+=.1;}return c01(value);}
 #intent(actor:ActorSnapshot,goal:Goal,score:number,stimuli:readonly Stimulus[],now:Tick):Intent|undefined{let kind:IntentKind='wait';let target:ActorSnapshot|undefined; if(goal.kind==='flee')kind='flee';else if(goal.kind==='hunt'){kind='attack';}else if(goal.kind==='protect'||goal.kind==='assist')kind='follow';else if(goal.kind==='gather')kind='interact';else if(goal.kind==='survive')kind='defend';else if(goal.kind==='investigate'||goal.kind==='patrol'||goal.kind==='travel')kind='move';else if(goal.kind==='rest')kind='wait';if(kind==='attack'||kind==='follow'){const candidates=[...this.#actors.values()].map(v=>v.actor).filter(a=>a.alive&&a.id!==actor.id&&(kind==='attack'?a.faction!==actor.faction:a.faction===actor.faction)).sort((a,b)=>dist2(actor.position,a.position)-dist2(actor.position,b.position)||String(a.id).localeCompare(String(b.id)));target=candidates[0];if((kind==='attack'||kind==='follow')&&!target)return undefined;}const point=stimuli[0]?.position;return Object.freeze({actorId:actor.id,kind,score:c01(score),...(target?{targetId:target.id}:{point?{position:point}:{}}),goalId:goal.id,reason:`goal:${goal.kind}`,expiresTick:(Number(now)+Math.max(1,goal.durationTicks)) as Tick});}
 get rng(){return this.#rng;}
}

export function createEvent(id:string,kind:EventRecord['kind'],tickNumber:number,origin:Vec3,radius:number,intensity:number,payload:Readonly<Record<string,string|number|boolean>>={},tags:readonly string[]=[]):EventRecord{return Object.freeze({id,kind,tick:tick(tickNumber),origin,radius:Math.max(0,radius),intensity:c01(intensity),tags:Object.freeze([...tags].sort()),payload:Object.freeze({...payload})});}
export function createStimulus(id:string,kind:StimulusKind,tickNumber:number,position:Vec3,intensity:number,radius:number,tags:readonly string[]=[]):Stimulus{return Object.freeze({id,kind,tick:tick(tickNumber),position,intensity:c01(intensity),radius:Math.max(0,radius),tags:Object.freeze([...tags]),expiresAt:(tickNumber+64) as Tick});}
