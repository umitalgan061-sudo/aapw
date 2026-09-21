/** Deterministic gameplay command router with schema validation and priority lanes. */
export type SimulationCommandKindV15='move'|'jump'|'attack'|'guard'|'interact'|'use-item'|'equip'|'unequip'|'dialogue'|'save'|'load'|'pause'|'resume';
export type SimulationCommandPriorityV15=0|1|2|3|4|5;
export interface SimulationCommandV15<T=unknown>{readonly id:string;readonly actorId:string;readonly kind:SimulationCommandKindV15;readonly tick:number;readonly sequence:number;readonly priority:SimulationCommandPriorityV15;readonly payload:T;readonly deterministic:boolean;}
export interface CommandRuleV15<T=unknown>{readonly kind:SimulationCommandKindV15;readonly validate:(payload:T)=>boolean;readonly execute:(command:SimulationCommandV15<T>)=>void|Promise<void>;}
export interface CommandRouterReportV15{readonly accepted:readonly string[];readonly rejected:readonly string[];readonly executed:readonly string[];readonly failed:readonly string[];readonly dropped:number;readonly queueSize:number;}
export interface CommandRouterOptionsV15{readonly maxQueue?:number;readonly maxPerTick?:number;}

const finite=(v:number,f=0)=>Number.isFinite(v)?v:f;

export class SimulationCommandRouterV15{
  readonly #maxQueue:number;
  readonly #maxPerTick:number;
  readonly #queue:SimulationCommandV15[]=[];
  readonly #rules=new Map<SimulationCommandKindV15,CommandRuleV15>();
  #sequence=0;
  #dropped=0;

  constructor(options:CommandRouterOptionsV15={}){
    this.#maxQueue=Math.max(64,Math.trunc(options.maxQueue??4096));
    this.#maxPerTick=Math.max(1,Math.trunc(options.maxPerTick??256));
  }

  registerRule<T>(rule:CommandRuleV15<T>):()=>void{
    if(this.#rules.has(rule.kind))throw new Error('Command rule already registered: '+rule.kind);
    this.#rules.set(rule.kind,rule as CommandRuleV15);
    return()=>this.#rules.delete(rule.kind);
  }

  submit<T>(input:Omit<SimulationCommandV15<T>,'id'|'sequence'>):SimulationCommandV15<T>{
    const command=Object.freeze({
      ...input,
      actorId:input.actorId.trim().slice(0,96),
      tick:Math.max(0,Math.trunc(input.tick)),
      priority:Math.max(0,Math.min(5,Math.trunc(input.priority))) as SimulationCommandPriorityV15,
      id:'cmd-'+(++this.#sequence),
      sequence:this.#sequence,
      deterministic:Boolean(input.deterministic),
    }) as SimulationCommandV15<T>;
    if(this.#queue.length>=this.#maxQueue){this.#queue.shift();this.#dropped+=1;}
    this.#queue.push(command);
    return command;
  }

  cancel(id:string):boolean{
    const index=this.#queue.findIndex((command)=>command.id===id);
    if(index<0)return false;
    this.#queue.splice(index,1);
    return true;
  }

  peek(tick?:number):readonly SimulationCommandV15[]{
    const commands=tick===undefined?this.#queue:[...this.#queue].filter((command)=>command.tick<=Math.trunc(tick));
    return Object.freeze([...commands].sort(this.#compare));
  }

  async executeTick(tick:number):Promise<CommandRouterReportV15>{
    const current=Math.max(0,Math.trunc(tick));
    const due=[...this.#queue].filter((command)=>command.tick<=current).sort(this.#compare);
    const selected=due.slice(0,this.#maxPerTick);
    const accepted:string[]=[];
    const rejected:string[]=[];
    const executed:string[]=[];
    const failed:string[]=[];
    const selectedIds=new Set(selected.map((command)=>command.id));

    for(const command of due.filter((item)=>!selectedIds.has(item.id)))rejected.push(command.id);

    for(const command of selected){
      const rule=this.#rules.get(command.kind);
      if(!rule){rejected.push(command.id);this.cancel(command.id);continue;}
      let valid=false;
      try{valid=command.deterministic&&rule.validate(command.payload);}catch{valid=false;}
      if(!valid){rejected.push(command.id);this.cancel(command.id);continue;}
      accepted.push(command.id);
      try{await rule.execute(command);executed.push(command.id);}catch{failed.push(command.id);}
      this.cancel(command.id);
    }

    return Object.freeze({accepted:Object.freeze(accepted),rejected:Object.freeze(rejected),executed:Object.freeze(executed),failed:Object.freeze(failed),dropped:this.#dropped,queueSize:this.#queue.length});
  }

  size():number{return this.#queue.length;}
  dropped():number{return this.#dropped;}
  rules():readonly SimulationCommandKindV15[]{return Object.freeze([...this.#rules.keys()].sort());}
  clear():void{this.#queue.length=0;this.#dropped=0;}
  reset():void{this.clear();this.#rules.clear();this.#sequence=0;}

  #compare=(a:SimulationCommandV15,b:SimulationCommandV15):number=>
    a.tick-b.tick||b.priority-a.priority||a.sequence-b.sequence||a.actorId.localeCompare(b.actorId)||a.id.localeCompare(b.id);
}

export const registerBasicCommandRulesV15=(router:SimulationCommandRouterV15,handlers:Partial<Record<SimulationCommandKindV15,(command:SimulationCommandV15)=>void|Promise<void>>>={}):void=>{
  const kinds:readonly SimulationCommandKindV15[]=['move','jump','attack','guard','interact','use-item','equip','unequip','dialogue','save','load','pause','resume'];
  for(const kind of kinds){
    router.registerRule({kind,validate:(payload)=>payload!==undefined,execute:(command)=>handlers[kind]?.(command)});
  }
};

export const commandPriorityV15=(kind:SimulationCommandKindV15):SimulationCommandPriorityV15=>{
  if(kind==='attack'||kind==='jump'||kind==='guard')return 5;
  if(kind==='move')return 4;
  if(kind==='interact'||kind==='use-item'||kind==='equip'||kind==='unequip')return 3;
  if(kind==='dialogue')return 2;
  if(kind==='save'||kind==='load'||kind==='pause'||kind==='resume')return 1;
  return 0;
};
