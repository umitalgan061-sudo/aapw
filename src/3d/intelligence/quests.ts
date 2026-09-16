import type { QuestInstance, QuestNode, QuestObjective, TickNumber, WorldEvent } from './types.js';
import { clamp01 } from './types.js';

export interface QuestRegistry{get(id:string):QuestNode|undefined;list():readonly QuestNode[];}
export class InMemoryQuestRegistry implements QuestRegistry{
 readonly #quests=new Map<string,QuestNode>();
 register(quest:QuestNode):void{if(!quest.id.trim())throw new TypeError('Quest id required');if(this.#quests.has(quest.id))throw new Error(`Quest exists: ${quest.id}`);this.#quests.set(quest.id,Object.freeze({...quest,prerequisites:Object.freeze([...quest.prerequisites]),objectives:Object.freeze(quest.objectives.map(o=>Object.freeze({...o}))),rewards:Object.freeze(quest.rewards.map(r=>Object.freeze({...r})))}));}
 get(id:string):QuestNode|undefined{return this.#quests.get(id);}
 list():readonly QuestNode[]{return Object.freeze([...this.#quests.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
 clear():void{this.#quests.clear();}
}

export interface QuestGateContext{readonly completed:ReadonlySet<string>;readonly active:ReadonlySet<string>;readonly flags:Readonly<Record<string,boolean>>;}
export function canOfferQuest(quest:QuestNode,ctx:QuestGateContext):boolean{return quest.prerequisites.every(p=>ctx.completed.has(p)||ctx.flags[p]===true)&&!ctx.active.has(quest.id);}
export function createQuestInstance(id:string,questId:string,tick:TickNumber,objectives:readonly QuestObjective[]):QuestInstance{return Object.freeze({id,questId,state:'active',acceptedTick:tick,progress:Object.freeze(Object.fromEntries(objectives.map(o=>[o.id,0]))),completedObjectives:Object.freeze([])});}

export interface QuestProgressResult{readonly instance:QuestInstance;readonly changed:boolean;readonly newlyCompleted:readonly string[];readonly questCompleted:boolean;}
const objectiveSatisfied=(o:QuestObjective,value:number)=>value>=Math.max(1,o.required);
export function applyQuestEvent(instance:QuestInstance,quest:QuestNode,event:WorldEvent):QuestProgressResult{
 if(instance.state!=='active')return Object.freeze({instance,changed:false,newlyCompleted:[],questCompleted:instance.state==='completed'});
 const progress={...instance.progress};const completed=new Set(instance.completedObjectives);let changed=false;const newly:string[]=[];
 for(const o of quest.objectives){if(completed.has(o.id))continue;let delta=0;
   if(o.kind==='collect'&&event.kind==='resource'&&String(event.payload.itemId??event.tags[0]??'')===o.target)delta=Number(event.payload.amount??1);
   if(o.kind==='defeat'&&event.kind==='combat'&&String(event.payload.targetId??'')===o.target&&event.payload.outcome==='defeat')delta=1;
   if(o.kind==='discover'&&event.kind==='discovery'&&String(event.payload.locationId??'')===o.target)delta=1;
   if(o.kind==='interact'&&event.kind==='quest'&&String(event.payload.interactionId??'')===o.target)delta=1;
   if(o.kind==='visit'&&event.kind==='travel'&&String(event.payload.locationId??'')===o.target)delta=1;
   if(o.kind==='survive'&&event.kind==='ecology'&&String(event.payload.phase??'')===o.target)delta=1;
   if(o.kind==='escort'&&event.kind==='travel'&&String(event.payload.escortId??'')===o.target&&event.payload.success===true)delta=1;
   if(delta>0){const next=Math.min(Math.max(0,o.required),Number(progress[o.id]??0)+delta);if(next!==progress[o.id]){progress[o.id]=next;changed=true;}if(objectiveSatisfied(o,next)){completed.add(o.id);newly.push(o.id);}}
 }
 const allComplete=quest.objectives.every(o=>completed.has(o.id));const nextState=allComplete?'completed':'active';const next:Object=Object.freeze({id:instance.id,questId:instance.questId,state:nextState,acceptedTick:instance.acceptedTick,progress:Object.freeze(progress),completedObjectives:Object.freeze([...completed].sort())});return Object.freeze({instance:next as QuestInstance,changed, newlyCompleted:Object.freeze(newly),questCompleted:allComplete});
}

export interface QuestManagerSnapshot{readonly instances:readonly QuestInstance[];readonly revision:number;}
export class QuestManager{
 readonly #registry:QuestRegistry;readonly #instances=new Map<string,QuestInstance>();readonly #max:number;#revision=0;#disposed=false;
 constructor(registry:QuestRegistry,maxInstances=128){this.#registry=registry;this.#max=Math.max(1,Math.floor(maxInstances));}
 add(instance:QuestInstance):boolean{if(this.#disposed||this.#instances.has(instance.id)||this.#instances.size>=this.#max)return false;this.#instances.set(instance.id,Object.freeze({...instance,progress:Object.freeze({...instance.progress}),completedObjectives:Object.freeze([...instance.completedObjectives])}));this.#revision+=1;return true;}
 get(id:string):QuestInstance|undefined{return this.#instances.get(id);}
 active():readonly QuestInstance[]{return Object.freeze([...this.#instances.values()].filter(q=>q.state==='active').sort((a,b)=>a.id.localeCompare(b.id)));}
 all():readonly QuestInstance[]{return Object.freeze([...this.#instances.values()].sort((a,b)=>a.id.localeCompare(b.id)));}
 handleEvent(event:WorldEvent):number{if(this.#disposed)return 0;let changed=0;for(const [id,instance] of this.#instances){if(instance.state!=='active')continue;const quest=this.#registry.get(instance.questId);if(!quest)continue;const result=applyQuestEvent(instance,quest,event);if(result.changed){this.#instances.set(id,result.instance);this.#revision+=1;changed+=1;}}return changed;}
 complete(id:string,tick:TickNumber):boolean{const i=this.#instances.get(id);if(!i||i.state!=='active')return false;this.#instances.set(id,Object.freeze({...i,state:'completed',completedObjectives:Object.freeze([...this.#registry.get(i.questId)?.objectives??[]].map(o=>o.id)),progress:Object.freeze(Object.fromEntries((this.#registry.get(i.questId)?.objectives??[]).map(o=>[o.id,o.required]))) }));this.#revision+=1;return true;}
 fail(id:string):boolean{const i=this.#instances.get(id);if(!i||i.state!=='active')return false;this.#instances.set(id,Object.freeze({...i,state:'failed'}));this.#revision+=1;return true;}
 snapshot():QuestManagerSnapshot{return Object.freeze({instances:Object.freeze(this.all()),revision:this.#revision});}
 restore(snapshot:QuestManagerSnapshot):void{this.#instances.clear();for(const i of snapshot.instances)this.#instances.set(i.id,Object.freeze({...i,progress:Object.freeze({...i.progress}),completedObjectives:Object.freeze([...i.completedObjectives])}));this.#revision=snapshot.revision;}
 dispose():void{this.#disposed=true;this.#instances.clear();}
 get revision():number{return this.#revision;}
}

export function questCompletionRatio(instance:QuestInstance,quest:QuestNode):number{if(!quest.objectives.length)return instance.state==='completed'?1:0;let total=0;for(const o of quest.objectives)total+=Math.min(1,Number(instance.progress[o.id]??0)/Math.max(1,o.required));return clamp01(total/quest.objectives.length);}
