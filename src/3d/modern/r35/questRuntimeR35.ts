
import { clamp, fail, ok, stableHash, type R35Event, type R35Id, type R35Objective, type R35QuestDefinition, type R35QuestState, type R35Result, type R35Reward } from './contracts';

interface MutableQuest { def:R35QuestDefinition; state:R35QuestState; }
function initialState(def:R35QuestDefinition):R35QuestState {
  const progress:Object=Object.fromEntries(def.objectives.map(o=>[o.id,0]));
  return Object.freeze({id:def.id,status:def.objectives.length===0?'complete':'active',progress:Object.freeze(progress as Record<R35Id,number>),revision:0});
}
function objectiveComplete(o:R35Objective,progress:number):boolean{return progress>=Math.max(1,o.required);}
export class QuestRuntimeR35 {
  #quests=new Map<R35Id,MutableQuest>(); #flags=new Set<R35Id>(); #counters=new Map<R35Id,number>(); #items=new Map<R35Id,number>(); #rewards=new Map<R35Id,R35Reward>();
  register(def:R35QuestDefinition):R35Result<R35QuestState>{
    if(this.#quests.has(def.id)) return fail('QUEST_EXISTS','Quest is already registered');
    if(!def.id||def.objectives.length>128) return fail('QUEST_INVALID','Quest definition is invalid');
    const duplicate=new Set<R35Id>(); for(const o of def.objectives){if(!o.id||duplicate.has(o.id)||o.required<1||o.required>1000000)return fail('OBJECTIVE_INVALID','Objective contract is invalid');duplicate.add(o.id);}
    const state=initialState(def);this.#quests.set(def.id,{def,state});if(def.reward)this.#rewards.set(def.id,def.reward);return ok(state);
  }
  state(id:R35Id):R35QuestState|null{return this.#quests.get(id)?.state??null;}
  recordEvent(event:R35WorldEventLike):ReadonlyArray<R35QuestState>{
    const updated:R35QuestState[]=[]; const ordered=[...this.#quests.values()].sort((a,b)=>a.def.id.localeCompare(b.def.id));
    for(const q of ordered){if(q.state.status!=='active')continue;let next={...q.state,progress:{...q.state.progress}};let changed=false;
      for(const o of q.def.objectives){if(o.kind!=='event'||(o.target&&o.target!==event.target))continue;if(event.kind!==event.type)continue;
        const p=(next.progress[o.id]??0)+Math.max(0,Math.trunc(event.magnitude));next.progress[o.id]=clamp(p,0,o.required);changed=true;
      }
      if(changed) next=this.#finishIfReady(q.def,next); if(changed){q.state=Object.freeze({...next,progress:Object.freeze(next.progress as Record<R35Id,number>),revision:q.state.revision+1});updated.push(q.state);}
    } return Object.freeze(updated);
  }
  setFlag(flag:R35Id,value:boolean):void{if(value)this.#flags.add(flag);else this.#flags.delete(flag);}
  setCounter(id:R35Id,value:number):void{this.#counters.set(id,Math.max(0,Math.trunc(value)));}
  addCounter(id:R35Id,delta:number):number{const n=Math.max(0,(this.#counters.get(id)??0)+Math.trunc(delta));this.#counters.set(id,n);this.#recheckAll();return n;}
  addItem(id:R35Id,delta:number):number{const n=Math.max(0,(this.#items.get(id)??0)+Math.trunc(delta));this.#items.set(id,n);this.#recheckAll();return n;}
  completeObjective(questId:R35Id,objectiveId:R35Id,amount=1):R35Result<R35QuestState>{const q=this.#quests.get(questId);if(!q)return fail('QUEST_MISSING','Quest does not exist');if(!q.state.progress[objectiveId]&&!(q.def.objectives.find(o=>o.id===objectiveId)))return fail('OBJECTIVE_MISSING','Objective does not exist');const p={...q.state.progress,[objectiveId]:Math.max(0,(q.state.progress[objectiveId]??0)+Math.max(0,Math.trunc(amount)))};const next=this.#finishIfReady(q.def,Object.freeze({...q.state,progress:p}));q.state=Object.freeze({...next,progress:Object.freeze({...next.progress}),revision:q.state.revision+1});return ok(q.state);}
  reward(id:R35Id):R35Reward|null{return this.#rewards.get(id)??null;}
  active():ReadonlyArray<R35QuestState>{return Object.freeze([...this.#quests.values()].filter(q=>q.state.status==='active').sort((a,b)=>a.def.id.localeCompare(b.def.id)).map(q=>q.state));}
  snapshot():ReadonlyArray<R35QuestState>{return Object.freeze([...this.#quests.values()].sort((a,b)=>a.def.id.localeCompare(b.def.id)).map(q=>q.state));}
  digest():string{return stableHash({quests:this.snapshot(),flags:[...this.#flags].sort(),counters:[...this.#counters.entries()].sort(),items:[...this.#items.entries()].sort()});}
  #finishIfReady(def:R35QuestDefinition,state:R35QuestState):R35QuestState{
    const ordered=[...def.objectives].sort((a,b)=>a.order-b.order);let gate=0;
    for(const o of ordered){const p=state.progress[o.id]??0;if(p>=o.required)gate++;else break;}
    return gate===ordered.length?Object.freeze({...state,status:'complete'}):state;
  }
  #recheckAll():void{for(const q of this.#quests.values()){if(q.state.status==='complete')continue;const progress={...q.state.progress};for(const o of q.def.objectives){if(o.kind==='counter')progress[o.id]=clamp(this.#counters.get(o.target??o.id)??0,0,o.required);if(o.kind==='collect')progress[o.id]=clamp(this.#items.get(o.target??o.id)??0,0,o.required);if(o.kind==='flag')progress[o.id]=this.#flags.has(o.target??o.id)?1:0;}const next=this.#finishIfReady(q.def,Object.freeze({...q.state,progress}));q.state=Object.freeze({...next,progress:Object.freeze(progress),revision:q.state.revision+1});}}
}
type R35WorldEventLike={readonly kind:'stimulus'|'interaction'|'damage'|'resource'|'time';readonly type:R35WorldEventLike['kind'];readonly target?:R35Id;readonly magnitude:number};
export function eventKey(event:Pick<R35Event,'type'|'tick'|'source'|'payload'>):string{return stableHash(event);}
