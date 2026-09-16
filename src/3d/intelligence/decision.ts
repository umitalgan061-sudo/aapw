import type { DecisionContext, GoalDefinition, GoalKind, Intent, ActorSnapshot, FactionProfile, RelationKind, TickNumber } from './types.js';
import { clamp01, distanceSq } from './types.js';
import { adjustFactionScores, intentFromGoal, rankGoals } from './utility.js';

export interface DecisionPolicy { readonly maxGoals:number; readonly maxNearbyActors:number; readonly maxIntents:number; readonly minimumIntentScore:number; readonly emergencyDanger:number; readonly interruptThreshold:number; }
export interface DecisionResult { readonly actorId:ActorSnapshot['id']; readonly tick:TickNumber; readonly selectedGoal?:GoalDefinition; readonly intents:readonly Intent[]; readonly rationale:readonly string[]; }

export const createDecisionPolicy=(p:Partial<DecisionPolicy>={}):DecisionPolicy=>Object.freeze({maxGoals:p.maxGoals??8,maxNearbyActors:p.maxNearbyActors??24,maxIntents:p.maxIntents??4,minimumIntentScore:p.minimumIntentScore??0.12,emergencyDanger:p.emergencyDanger??0.78,interruptThreshold:p.interruptThreshold??0.2});

function relation(actor:ActorSnapshot,faction:FactionProfile):RelationKind{return faction.relations[String(actor.faction)]??(actor.faction===faction.id?'ally':'neutral');}
function orderActors(self:ActorSnapshot,actors:readonly ActorSnapshot[],max:number):readonly ActorSnapshot[]{return [...actors].filter(a=>a.id!==self.id).sort((a,b)=>{const da=distanceSq(self.position,a.position),db=distanceSq(self.position,b.position);return da-db||String(a.id).localeCompare(String(b.id));}).slice(0,max);}
function buildContext(actor:ActorSnapshot,faction:FactionProfile,goals:readonly GoalDefinition[],tick:TickNumber,memories:DecisionContext['memories'],stimuli:DecisionContext['stimuli'],actors:readonly ActorSnapshot[],weather:string,time:number,danger:number,policy:DecisionPolicy):DecisionContext{return Object.freeze({tick,actor,memories,stimuli,relationships:Object.freeze(Object.fromEntries(actors.map(a=>[String(a.faction),relation(a,faction)]))),nearbyActors:orderActors(actor,actors,policy.maxNearbyActors),faction,weather,timeOfDay:clamp01(time),danger:clamp01(danger)});}

export function decide(actor:ActorSnapshot,faction:FactionProfile,goals:readonly GoalDefinition[],tick:TickNumber,memories:DecisionContext['memories'],stimuli:DecisionContext['stimuli'],actors:readonly ActorSnapshot[],weather='clear',timeOfDay=0.5,danger=0,policy=createDecisionPolicy()):DecisionResult{
  const context=buildContext(actor,faction,goals,tick,memories,stimuli,actors,weather,timeOfDay,danger,policy);
  const scored=adjustFactionScores(context,rankGoals(context,goals,policy.maxGoals),goals);
  const definitions=new Map(goals.map(g=>[g.id,g]));const intents:Intent[]=[];
  for(const score of scored){if(score.normalized<policy.minimumIntentScore)continue;const goal=definitions.get(score.goalId);if(!goal)continue;const intent=intentFromGoal(context,goal,score.normalized,Number(tick)+Math.max(1,goal.durationTicks));if(intent)intents.push(intent);if(intents.length>=policy.maxIntents)break;}
  if(danger>=policy.emergencyDanger){const flee=goals.find(g=>g.kind==='flee');if(flee){const emergency=intentFromGoal(context,flee,1,Number(tick)+8);if(emergency)intents.unshift(emergency);}}
  intents.sort((a,b)=>b.score-a.score||a.kind.localeCompare(b.kind)||String(a.goalId).localeCompare(String(b.goalId)));
  const top=intents[0];const selectedGoal=top?.goalId?definitions.get(String(top.goalId)):undefined;
  const rationale:string[]=[];if(danger>=policy.emergencyDanger)rationale.push('emergency-danger');if(selectedGoal)rationale.push(`selected:${selectedGoal.kind}`);if(!intents.length)rationale.push('no-eligible-intent');
  return Object.freeze({actorId:actor.id,tick, ...(selectedGoal?{selectedGoal}:{}),intents:Object.freeze(intents),rationale:Object.freeze(rationale)});
}

export interface ActionState { readonly current?:Intent; readonly committedTick:TickNumber; readonly lockedUntilTick:TickNumber; }
export class DecisionCommitGate {
  #state:ActionState={committedTick:0 as TickNumber,lockedUntilTick:0 as TickNumber};#disposed=false;
  constructor(private readonly policy:Pick<DecisionPolicy,'interruptThreshold'>={interruptThreshold:0.2}){}
  get state():ActionState{return this.#state;}
  commit(intent:Intent,tick:TickNumber):boolean{
    if(this.#disposed||Number(intent.expiresTick)<Number(tick)||Number(tick)<Number(this.#state.lockedUntilTick))return false;
    const current=this.#state.current;if(current&&current.kind===intent.kind&&String(current.targetId)===String(intent.targetId)){this.#state=Object.freeze({current,committedTick:tick,lockedUntilTick:current.expiresTick});return false;}
    if(current&&intent.score<current.score-this.policy.interruptThreshold)return false;
    this.#state=Object.freeze({current:intent,committedTick:tick,lockedUntilTick:intent.expiresTick});return true;
  }
  clear():void{this.#state=Object.freeze({committedTick:this.#state.committedTick,lockedUntilTick:this.#state.committedTick});}
  dispose():void{this.#disposed=true;this.clear();}
}

export interface GoalMemory { readonly goalKind:GoalKind; readonly completedTick:TickNumber; readonly cooldownUntil:TickNumber; readonly success:boolean; }
export class GoalCooldownLedger {
  readonly #entries=new Map<GoalKind,GoalMemory>();#disposed=false;
  record(kind:GoalKind,tick:TickNumber,cooldownTicks:number,success=true):void{if(this.#disposed)return;this.#entries.set(kind,Object.freeze({goalKind:kind,completedTick:tick,cooldownUntil:(Number(tick)+Math.max(0,Math.floor(cooldownTicks))) as TickNumber,success}));}
  available(kind:GoalKind,tick:TickNumber):boolean{return !this.#disposed&&(this.#entries.get(kind)?.cooldownUntil===undefined||Number(tick)>=Number(this.#entries.get(kind)?.cooldownUntil));}
  snapshot():readonly GoalMemory[]{return Object.freeze([...this.#entries.values()].sort((a,b)=>a.goalKind.localeCompare(b.goalKind)));}
  dispose():void{this.#disposed=true;this.#entries.clear();}
}

export function estimateDanger(actor:ActorSnapshot,nearby:readonly ActorSnapshot[],relations:Readonly<Record<string,RelationKind>>):number{
  let danger=0;for(const other of nearby){if(!other.alive||other.id===actor.id)continue;const rel=relations[String(other.faction)]??'neutral';if(rel!=='hostile'&&rel!=='fearful'&&rel!=='suspicious')continue;const d=Math.sqrt(distanceSq(actor.position,other.position));danger+=clamp01((32-d)/32)*(rel==='hostile'?0.6:0.3);}return clamp01(danger);
}

export function fallbackIntent(actor:ActorSnapshot,tick:TickNumber):Intent{const kind:Intent['kind']=actor.alive?'wait':'defend';return Object.freeze({actorId:actor.id,kind,score:0.01,reason:'failsafe',expiresTick:(Number(tick)+1) as TickNumber});}
