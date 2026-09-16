import type { ActorSnapshot, FactionProfile, GoalDefinition, IntelligenceConfig, IntelligenceMetrics, IntelligenceSnapshot, Stimulus, TickNumber, WorldEvent, QuestNode, EncounterDefinition } from './types.js';
import type { EncounterContext } from './encounters.js';
import { ActorBlackboard, GoalLedger, MemoryStore } from './blackboard.js';
import { createPerceptionPolicy, perceive } from './perception.js';
import { decide, createDecisionPolicy, estimateDanger, DecisionCommitGate, type DecisionResult } from './decision.js';
import { DeterministicInterestMap, InterestBroker, buildRegionInterest, defaultInterestPolicy, type InterestPoint } from './interest.js';
import { WorldEventJournal } from './events.js';
import { InMemoryQuestRegistry, QuestManager, type QuestGateContext } from './quests.js';
import { EncounterDirector, defaultEncounterPolicy } from './encounters.js';
import type { IntelligenceTickInput, IntelligenceTickResult } from './types.js';

export interface ActorRuntimeRecord { readonly actor:ActorSnapshot; readonly faction:FactionProfile; readonly blackboard:ActorBlackboard; readonly memories:MemoryStore; readonly goals:GoalLedger; readonly decisionGate:DecisionCommitGate; readonly lastDecision?:DecisionResult; }
export interface RuntimeInput { readonly tick:TickNumber; readonly actors:readonly ActorSnapshot[]; readonly factions:readonly FactionProfile[]; readonly stimuli:readonly Stimulus[]; readonly weather:string; readonly timeOfDay:number; readonly interestPoints?:readonly InterestPoint[]; readonly events?:readonly WorldEvent[]; readonly questContext?:QuestGateContext; readonly biomeTags?:readonly string[]; readonly factionTags?:readonly string[]; readonly levelByActor?:Readonly<Record<string,number>>; }

const defaults:Required<IntelligenceConfig>={maxActorsPerTick:128,maxStimuliPerActor:32,maxMemoriesPerActor:256,maxGoalsPerActor:16,maxEvents:1024,maxQuestInstances:128,maxInterestCandidates:24,memoryHalfLifeTicks:32,perceptionRadius:96,decisionIntervalTicks:6,eventRetentionTicks:720};
export const normalizeConfig=(c:Partial<IntelligenceConfig>={}):IntelligenceConfig=>Object.freeze({...defaults,...c});

export class WorldIntelligenceRuntime{
 readonly #config:IntelligenceConfig;readonly #actors=new Map<string,ActorRuntimeRecord>();readonly #factions=new Map<string,FactionProfile>();readonly #events:WorldEventJournal;readonly #interests=new DeterministicInterestMap();readonly #broker=new InterestBroker(this.#interests);readonly #questsRegistry=new InMemoryQuestRegistry();readonly #quests:QuestManager;readonly #encounters:EncounterDirector;#disposed=false;#lastMetrics:IntelligenceMetrics={tick:0 as TickNumber,actorsProcessed:0,stimuliProcessed:0,memoriesActive:0,decisionsGenerated:0,eventsAccepted:0,questsUpdated:0,encountersScored:0,interestQueries:0,budgetDrops:0};
 constructor(config:Partial<IntelligenceConfig>={},encounters:readonly EncounterDefinition[]=[]){this.#config=normalizeConfig(config);this.#events=new WorldEventJournal({maxEvents:this.#config.maxEvents,maxPerTick:64,minIntensity:.01,retentionTicks:this.#config.eventRetentionTicks,maxPayloadKeys:24});this.#quests=new QuestManager(this.#questsRegistry,this.#config.maxQuestInstances);this.#encounters=new EncounterDirector(encounters,defaultEncounterPolicy());}
 registerFaction(faction:FactionProfile):void{if(this.#disposed)return;this.#factions.set(String(faction.id),Object.freeze({...faction,relations:Object.freeze({...faction.relations}),preferredGoals:Object.freeze([...faction.preferredGoals]),territoryTags:Object.freeze([...faction.territoryTags]),hostileTags:Object.freeze([...faction.hostileTags])}));}
 registerQuest(quest:QuestNode):void{if(this.#disposed)return;this.#questsRegistry.register(quest);}
 registerActor(actor:ActorSnapshot):void{if(this.#disposed)return;if(this.#actors.has(String(actor.id)))return;const faction=this.#factions.get(String(actor.faction));if(!faction)throw new Error(`Faction not registered: ${actor.faction}`);this.#actors.set(String(actor.id),{actor,faction,blackboard:new ActorBlackboard(actor.id),memories:new MemoryStore(this.#config.maxMemoriesPerActor),goals:new GoalLedger(actor.id,this.#config.maxGoalsPerActor),decisionGate:new DecisionCommitGate()});}
 updateActor(actor:ActorSnapshot):void{const runtime=this.#actors.get(String(actor.id));if(runtime)this.#actors.set(String(actor.id),Object.freeze({...runtime,actor}));}
 setInterestPoints(points:readonly InterestPoint[]):void{if(this.#disposed)return;this.#interests.clear();for(const point of points)this.#interests.upsert(point);}
 addWorldEvent(event:WorldEvent):boolean{return this.#events.append(event);}
 tick(input:RuntimeInput):IntelligenceTickResult{
  if(this.#disposed)return Object.freeze({tick:input.tick,decisions:[],interests:[],emittedEvents:[],metrics:this.#lastMetrics});
  const actors=input.actors.slice(0,this.#config.maxActorsPerTick);const decisions:DecisionResult[]=[];const interests:ReturnType<typeof buildRegionInterest>[]=[];let stimuliProcessed=0,decisionsGenerated=0,eventsAccepted=0,questsUpdated=0,interestQueries=0,budgetDrops=Math.max(0,input.actors.length-actors.length);
  for(const faction of input.factions)this.registerFaction(faction);for(const event of input.events??[])eventsAccepted+=this.#events.append(event)?1:0;
  const perceptionPolicy=createPerceptionPolicy({visualRange:this.#config.perceptionRadius,maxStimuli:this.#config.maxStimuliPerActor,memoryDecay:1/this.#config.memoryHalfLifeTicks});
  const decisionPolicy=createDecisionPolicy({});
  for(const actor of actors){if(!this.#actors.has(String(actor.id)))this.registerActor(actor);const runtime=this.#actors.get(String(actor.id));if(!runtime){budgetDrops+=1;continue;}if(runtime.actor!==actor)this.updateActor(actor);const perception=perceive(actor,input.stimuli,input.tick,perceptionPolicy);stimuliProcessed+=perception.observations.length;runtime.memories.rememberMany(perception.memories);runtime.memories.decay(input.tick);
    const danger=estimateDanger(actor,actors,runtime.faction.relations);const shouldDecide=Number(input.tick)%Math.max(1,this.#config.decisionIntervalTicks)===0;const result=shouldDecide?decide(actor,runtime.faction,runtime.goals.values().map(g=>g.definition),input.tick,runtime.memories.values(),perception.observations,actors,input.weather,input.timeOfDay,danger,decisionPolicy):runtime.lastDecision;
    if(result){const top=result.intents[0];if(top&&runtime.decisionGate.commit(top,input.tick))decisionsGenerated+=1;decisions.push(result);this.#actors.set(String(actor.id),Object.freeze({...runtime,lastDecision:result}));}
    if(input.interestPoints){interests.push(buildRegionInterest(actor,input.tick,this.#interests,{...defaultInterestPolicy(),maxCandidates:this.#config.maxInterestCandidates},Number(input.tick)));interestQueries+=1;}
    runtime.blackboard.set('danger',danger,input.tick,'world-intelligence',{confidence:1,expiresTick:(Number(input.tick)+this.#config.decisionIntervalTicks*2) as TickNumber});runtime.blackboard.set('weather',input.weather,input.tick,'world-intelligence',{confidence:.9});
  }
  for(const event of input.events??[])questsUpdated+=this.#quests.handleEvent(event);const pruned=this.#events.prune(input.tick);budgetDrops+=Math.min(pruned,8);
  const metrics=Object.freeze({tick:input.tick,actorsProcessed:actors.length,stimuliProcessed,memoriesActive:[...this.#actors.values()].reduce((n,r)=>n+r.memories.size,0),decisionsGenerated,eventsAccepted,questsUpdated,encountersScored:0,interestQueries,budgetDrops});this.#lastMetrics=metrics;return Object.freeze({tick:input.tick,decisions:Object.freeze(decisions),interests:Object.freeze(interests),emittedEvents:Object.freeze(input.events??[]),metrics});
 }
 snapshot():IntelligenceSnapshot{const actors=[...this.#actors.values()].map(r=>r.actor).sort((a,b)=>String(a.id).localeCompare(String(b.id)));const memories=[...this.#actors.values()].flatMap(r=>r.memories.values()).sort((a,b)=>String(a.id).localeCompare(String(b.id)));const goals=[...this.#actors.values()].flatMap(r=>r.goals.values()).sort((a,b)=>a.id.localeCompare(b.id));return Object.freeze({version:'1.0.0',tick:this.#lastMetrics.tick,actors:Object.freeze(actors),memories:Object.freeze(memories),activeGoals:Object.freeze(goals),quests:Object.freeze(this.#quests.all()),events:Object.freeze(this.#events.values()),metrics:this.#lastMetrics});}
 restore(snapshot:IntelligenceSnapshot):void{if(this.#disposed)return;for(const actor of snapshot.actors){if(!this.#actors.has(String(actor.id)))this.registerActor(actor);else this.updateActor(actor);}this.#lastMetrics=snapshot.metrics;}
 scoreEncounters(actorId:string,context:EncounterContext,level:number){if(!this.#actors.has(actorId))return [];return this.#encounters.evaluate(context,level);}
 questManager():QuestManager{return this.#quests;}
 encounterDirector():EncounterDirector{return this.#encounters;}
 interestBroker():InterestBroker{return this.#broker;}
 dispose():void{if(this.#disposed)return;this.#disposed=true;for(const runtime of this.#actors.values()){runtime.blackboard.dispose();runtime.memories.dispose();runtime.decisionGate.dispose();}this.#actors.clear();this.#events.dispose();this.#interests.dispose();this.#broker.dispose();this.#quests.dispose();this.#encounters.dispose();}
}

export function buildDefaultIntelligenceConfig():IntelligenceConfig{return normalizeConfig();}
export function intelligenceLoadScore(metrics:IntelligenceMetrics):number{return Math.max(0,metrics.actorsProcessed*2+metrics.stimuliProcessed+metrics.decisionsGenerated*4+metrics.interestQueries*2+metrics.eventsAccepted);}
