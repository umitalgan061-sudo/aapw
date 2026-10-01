
import { AccessibilityRuntimeR35 } from './accessibilityRuntimeR35';
import { ContentRegistryR35 } from './contentRegistryR35';
import { DialogueRuntimeR35 } from './dialogueRuntimeR35';
import { InventoryRuntimeR35 } from './inventoryRuntimeR35';
import { QuestRuntimeR35 } from './questRuntimeR35';
import { ReplayRuntimeR35 } from './replayRuntimeR35';
import { SaveRuntimeR35 } from './saveRuntimeR35';
import { TelemetryRuntimeR35 } from './telemetryRuntimeR35';
import { clamp, stableHash, type R35AccessibilityProfile, type R35Clock, type R35HealthReport, type R35Id, type R35ItemDefinition, type R35QuestDefinition, type R35Vec3 } from './contracts';
import { WorldSimulationR35 } from './worldSimulationR35';

export class RuntimeOrchestratorR35 {
  readonly world:WorldSimulationR35; readonly quests:QuestRuntimeR35; readonly inventory:InventoryRuntimeR35; readonly dialogue:DialogueRuntimeR35;
  readonly save:SaveRuntimeR35; readonly replay:ReplayRuntimeR35; readonly accessibility:AccessibilityRuntimeR35; readonly content:ContentRegistryR35; readonly telemetry:TelemetryRuntimeR35;
  #phase:'boot'|'active'|'paused'|'recovering'|'complete'='boot'; #clock:R35Clock={tick:0,step:1/60,elapsed:0}; #warnings:string[]=[];
  constructor(config?:{world?:Partial<ConstructorParameters<typeof WorldSimulationR35>[0]>;inventoryCapacity?:number;saveSchema?:number}){
    this.world=new WorldSimulationR35(config?.world);this.quests=new QuestRuntimeR35();this.inventory=new InventoryRuntimeR35(config?.inventoryCapacity??24);this.dialogue=new DialogueRuntimeR35();
    this.save=new SaveRuntimeR35(config?.saveSchema??1);this.replay=new ReplayRuntimeR35('r35',1);this.accessibility=new AccessibilityRuntimeR35();this.content=new ContentRegistryR35();this.telemetry=new TelemetryRuntimeR35();this.#phase='active';
  }
  start():void{if(this.#phase==='boot'||this.#phase==='paused')this.#phase='active';}
  pause():void{if(this.#phase==='active')this.#phase='paused';}
  step(ticks=1):void{if(this.#phase!=='active')return;const n=clamp(Math.trunc(ticks),1,120);for(let i=0;i<n;i++){const events=this.world.step(1);this.#clock={tick:this.world.tick,step:this.#clock.step,elapsed:this.world.tick*this.#clock.step};this.telemetry.record('world.entities',this.world.snapshotAll().length,this.world.tick);this.telemetry.record('world.events',events.length,this.world.tick);}}
  setPlayerPosition(position:R35Vec3):void{this.world.setPlayerPosition(position);}
  addAgent(input:Parameters<WorldSimulationR35['addAgent']>[0]):boolean{return this.world.addAgent(input);}
  registerQuest(def:R35QuestDefinition):void{const r=this.quests.register(def);if(!r.ok)this.#warnings.push(r.error.code);}
  registerItem(def:R35ItemDefinition):void{const r=this.inventory.registerItem(def);if(!r.ok)this.#warnings.push(r.error.code);}
  accessibilityProfile(next:Partial<R35AccessibilityProfile>):R35AccessibilityProfile{return this.accessibility.setProfile(next);}
  health():R35HealthReport{const metrics=this.telemetry.metrics(64);const report=Object.freeze({phase:this.#phase,tick:this.#clock.tick,entities:this.world.snapshotAll().length,activeQuests:this.quests.active().length,inventoryWeight:this.inventory.weight(),metrics,warnings:Object.freeze([...new Set(this.#warnings)]),digest:''});return Object.freeze({...report,digest:stableHash({...report,digest:undefined})});}
  snapshot():unknown{return Object.freeze({phase:this.#phase,clock:this.#clock,world:this.world.snapshotAll(),quests:this.quests.snapshot(),inventory:this.inventory.snapshot(),accessibility:this.accessibility.profile(),content:this.content.manifest(),health:this.health()});}
  reset():void{this.world.reset();this.telemetry.clear();this.#warnings=[];this.#clock={tick:0,step:1/60,elapsed:0};this.#phase='active';}
}
