
import { add, clamp, distance, mul, quantize, type R35AgentState, type R35Event, type R35Id, type R35NeedState, type R35Vec3, type R35WorldConfig, type R35WorldEvent, stableHash, vec } from './contracts';

interface MutableAgent {
  id:R35Id; position:R35Vec3; velocity:R35Vec3; disposition:R35AgentState['disposition']; needs:R35NeedState;
  memories:Map<string,{strength:number;lastTick:number;tags:readonly string[]}>; revision:number; utility:number;
}
const DEFAULTS:R35WorldConfig=Object.freeze({cellSize:32,maxEntities:4096,maxEventsPerTick:128,simulationRange:160,sleepRange:320,decisionInterval:8});

function keyFor(p:R35Vec3,size:number):string { return Math.floor(p.x/size)+':'+Math.floor(p.y/size)+':'+Math.floor(p.z/size); }
function normalizeNeeds(n:R35NeedState):R35NeedState {
  return Object.freeze({hunger:clamp(n.hunger,0,1),thirst:clamp(n.thirst,0,1),energy:clamp(n.energy,0,1),safety:clamp(n.safety,0,1),social:clamp(n.social,0,1)});
}
function utility(a:MutableAgent):number {
  const need=(a.needs.hunger+a.needs.thirst+(1-a.needs.energy)+(1-a.needs.safety)+(1-a.needs.social))/5;
  const dispositionBoost=a.disposition==='hostile'?0.15:a.disposition==='friendly'?-0.08:0;
  return clamp(need+dispositionBoost,0,1);
}
function lodFor(distanceToPlayer:number,c:R35WorldConfig):R35AgentState['lod'] {
  if(distanceToPlayer<=c.simulationRange*0.25) return 'near';
  if(distanceToPlayer<=c.simulationRange) return 'mid';
  if(distanceToPlayer<=c.sleepRange) return 'far';
  return 'sleep';
}
export class WorldSimulationR35 {
  readonly config:R35WorldConfig; #agents=new Map<R35Id,MutableAgent>(); #grid=new Map<string,Set<R35Id>>(); #events:R35Event[]=[]; #tick=0; #player: R35Vec3=vec(0,0,0);
  constructor(config:Partial<R35WorldConfig>={}) { this.config=Object.freeze({...DEFAULTS,...config}); }
  get tick():number{return this.#tick;}
  setPlayerPosition(position:R35Vec3):void{this.#player=vec(quantize(position.x),quantize(position.y),quantize(position.z));}
  addAgent(input:{id:R35Id;position:R35Vec3;disposition?:R35AgentState['disposition'];needs?:Partial<R35NeedState>}):boolean {
    if(this.#agents.has(input.id)||this.#agents.size>=this.config.maxEntities) return false;
    const agent:MutableAgent={id:input.id,position:vec(input.position.x,input.position.y,input.position.z),velocity:vec(0,0,0),disposition:input.disposition??'neutral',
      needs:normalizeNeeds({hunger:input.needs?.hunger??0.2,thirst:input.needs?.thirst??0.2,energy:input.needs?.energy??0.8,safety:input.needs?.safety??0.8,social:input.needs?.social??0.5}),
      memories:new Map(),revision:0,utility:0}; this.#agents.set(input.id,agent); this.#index(agent); return true;
  }
  removeAgent(id:R35Id):boolean{const a=this.#agents.get(id);if(!a)return false;this.#deindex(a);this.#agents.delete(id);return true;}
  emit(event:R35WorldEvent):void {
    if(this.#events.length>=this.config.maxEventsPerTick) return;
    const e:R35Event<'world',R35WorldEvent>={id:stableHash({t:this.#tick,e:event}),type:'world',tick:this.#tick,source:event.source,payload:Object.freeze({...event})};
    this.#events.push(e);
  }
  step(step=1):ReadonlyArray<R35Event>{
    const safeStep=clamp(step,0,4); if(safeStep<=0) return Object.freeze([]);
    for(let s=0;s<safeStep;s++){this.#tick++;this.#events=[];this.#simulateTick();}
    return Object.freeze([...this.#events]);
  }
  #simulateTick():void {
    const ids=[...this.#agents.keys()].sort();
    for(const id of ids){const a=this.#agents.get(id)!;const d=distance(a.position,this.#player);const lod=lodFor(d,this.config);
      if(lod!=='sleep'){a.needs=normalizeNeeds({hunger:a.needs.hunger+0.004,thirst:a.needs.thirst+0.006,energy:a.needs.energy-(lod==='near'?0.003:0.001),safety:a.needs.safety,social:a.needs.social-0.001});
        a.utility=utility(a);
        if(this.#tick%this.config.decisionInterval===0){const decision=this.#decide(a,ids);a.velocity=decision.velocity;if(decision.memory)a.memories.set(decision.memory.key,decision.memory);}
        a.position=add(a.position,mul(a.velocity,1/60)); a.position=vec(quantize(a.position.x),quantize(a.position.y),quantize(a.position.z)); a.revision++;
        this.#reindex(a);
      }
    }
  }
  #decide(a:MutableAgent,ids:readonly R35Id[]):{velocity:R35Vec3;memory?:{key:string;strength:number;lastTick:number;tags:readonly string[]}} {
    const danger=a.needs.safety<0.3; const lowEnergy=a.needs.energy<0.2; const social=a.needs.social<0.25;
    if(danger) return {velocity:vec(a.velocity.x*0.2,a.velocity.y*0.2,a.velocity.z*0.2),memory:{key:'danger',strength:1,lastTick:this.#tick,tags:['safety']}};
    if(lowEnergy) return {velocity:mul(a.velocity,0.1),memory:{key:'fatigue',strength:0.9,lastTick:this.#tick,tags:['rest']}};
    if(social && ids.length>1) return {velocity:vec(0,0,0),memory:{key:'social-seeking',strength:0.5,lastTick:this.#tick,tags:['social']}};
    const drift=(this.#tick+a.id.length)%3-1; return {velocity:vec(quantize(drift*0.02),0,quantize(((this.#tick>>1)%3-1)*0.02))};
  }
  #index(a:MutableAgent):void{const k=keyFor(a.position,this.config.cellSize);let set=this.#grid.get(k);if(!set){set=new Set();this.#grid.set(k,set);}set.add(a.id);}
  #deindex(a:MutableAgent):void{const k=keyFor(a.position,this.config.cellSize);const set=this.#grid.get(k);if(set){set.delete(a.id);if(set.size===0)this.#grid.delete(k);}}
  #reindex(a:MutableAgent):void{this.#deindex(a);this.#index(a);}
  queryRadius(origin:R35Vec3,radius:number):ReadonlyArray<R35AgentState>{
    const r=clamp(radius,0,this.config.sleepRange);const cells=Math.ceil(r/this.config.cellSize);const [cx=0,cy=0,cz=0]=keyFor(origin,this.config.cellSize).split(':').map(Number);const found=new Set<R35Id>();
    for(let x=cx-cells;x<=cx+cells;x++)for(let y=cy-cells;y<=cy+cells;y++)for(let z=cz-cells;z<=cz+cells;z++){for(const id of this.#grid.get(x+':'+y+':'+z)??[])found.add(id);}
    return Object.freeze([...found].map(id=>this.#agents.get(id)!).filter(a=>distance(a.position,origin)<=r).sort((a,b)=>a.id.localeCompare(b.id)).map(a=>this.snapshot(a)));
  }
  snapshotById(id:R35Id):R35AgentState|null{const a=this.#agents.get(id);return a?this.snapshot(a):null;}
  snapshotAll():ReadonlyArray<R35AgentState>{return Object.freeze([...this.#agents.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(a=>this.snapshot(a)));}
  #snapshotMemory(a:MutableAgent){return Object.freeze([...a.memories.entries()].sort(([x],[y])=>x.localeCompare(y)).map(([key,m])=>Object.freeze({key,...m})));}
  snapshot(a:MutableAgent):R35AgentState{return Object.freeze({id:a.id,position:a.position,velocity:a.velocity,disposition:a.disposition,needs:a.needs,memories:this.#snapshotMemory(a),utility:quantize(a.utility),lod:lodFor(distance(a.position,this.#player),this.config),revision:a.revision});}
  digest():string{return stableHash({tick:this.#tick,player:this.#player,agents:this.snapshotAll()});}
  reset():void{this.#agents.clear();this.#grid.clear();this.#events=[];this.#tick=0;this.#player=vec(0,0,0);}
}
