import type { EntityId } from './liveCoreTypes.ts';
import { err, ok, stableHash } from './liveCoreTypes.ts';

export type CommandKind='move'|'combat'|'interact'|'camera'|'system';
export interface RuntimeCommandRecord{readonly sequence:number;readonly tick:number;readonly actor:EntityId;readonly kind:CommandKind;readonly payload:Readonly<Record<string,string|number|boolean>>;readonly checksum:string;}
export interface CommandPolicy{readonly maxPerTick:number;readonly maxHistory:number;readonly maxPayloadKeys:number;readonly maxPayloadStringLength:number;}
export interface CommandAdmission{readonly accepted:boolean;readonly reason:'accepted'|'duplicate'|'rate-limit'|'sequence'|'payload';readonly command?:RuntimeCommandRecord;}
export interface CommandDiagnostics{readonly accepted:number;readonly rejected:number;readonly duplicate:number;readonly rateLimited:number;readonly lastSequence:number;readonly digest:string;}
export const DEFAULT_COMMAND_POLICY:CommandPolicy=Object.freeze({maxPerTick:64,maxHistory:4096,maxPayloadKeys:24,maxPayloadStringLength:256});

const safePayload=(payload:Readonly<Record<string,string|number|boolean>>,policy:CommandPolicy)=>{const entries=Object.entries(payload).slice(0,policy.maxPayloadKeys).map(([key,value])=>[key.slice(0,96),typeof value==='string'?value.slice(0,policy.maxPayloadStringLength):value] as const);if(entries.length!==Object.keys(payload).length)return null;return Object.freeze(Object.fromEntries(entries));};

export class StrictCommandRuntime{
  #policy:CommandPolicy;#history:RuntimeCommandRecord[]=[];#seen=new Set<string>();#lastSequence=0;#perTick=new Map<number,number>();#accepted=0;#rejected=0;#duplicate=0;#rateLimited=0;#disposed=false;
  constructor(policy:CommandPolicy=DEFAULT_COMMAND_POLICY){this.#policy=Object.freeze({...policy});}
  submit(input:{readonly sequence:number;readonly tick:number;readonly actor:EntityId;readonly kind:CommandKind;readonly payload:Readonly<Record<string,string|number|boolean>>}):CommandAdmission|ReturnType<typeof err>{if(this.#disposed)return err('RUNTIME_DISPOSED','Command runtime is disposed.');const sequence=Math.floor(input.sequence),tick=Math.floor(input.tick);const payload=safePayload(input.payload,this.#policy);if(!payload){this.#rejected++;return Object.freeze({accepted:false,reason:'payload'});}if(sequence<=this.#lastSequence){this.#rejected++;return Object.freeze({accepted:false,reason:'sequence'});}const count=this.#perTick.get(tick)??0;if(count>=this.#policy.maxPerTick){this.#rejected++;this.#rateLimited++;return Object.freeze({accepted:false,reason:'rate-limit'});}const checksum=stableHash({sequence,tick,actor:input.actor,kind:input.kind,payload});if(this.#seen.has(checksum)){this.#rejected++;this.#duplicate++;return Object.freeze({accepted:false,reason:'duplicate'});}const command=Object.freeze({sequence,tick,actor:input.actor,kind:input.kind,payload,checksum});this.#history.push(command);this.#seen.add(checksum);this.#lastSequence=sequence;this.#perTick.set(tick,count+1);this.#accepted++;while(this.#history.length>this.#policy.maxHistory){const removed=this.#history.shift()!;this.#seen.delete(removed.checksum);}for(const oldTick of this.#perTick.keys())if(oldTick<tick-2)this.#perTick.delete(oldTick);return Object.freeze({accepted:true,reason:'accepted',command});}
  replay():readonly RuntimeCommandRecord[]{return Object.freeze([...this.#history]);}
  verify(command:RuntimeCommandRecord):boolean{return stableHash({sequence:command.sequence,tick:command.tick,actor:command.actor,kind:command.kind,payload:command.payload})===command.checksum;}
  verifyAll():boolean{return this.#history.every(command=>this.verify(command));}
  byActor(actor:EntityId):readonly RuntimeCommandRecord[]{return Object.freeze(this.#history.filter(c=>c.actor===actor));}
  byTick(tick:number):readonly RuntimeCommandRecord[]{return Object.freeze(this.#history.filter(c=>c.tick===tick));}
  diagnostics():CommandDiagnostics{return Object.freeze({accepted:this.#accepted,rejected:this.#rejected,duplicate:this.#duplicate,rateLimited:this.#rateLimited,lastSequence:this.#lastSequence,digest:stableHash(this.#history)});}
  reset(){this.#history=[];this.#seen.clear();this.#perTick.clear();this.#lastSequence=0;this.#accepted=0;this.#rejected=0;this.#duplicate=0;this.#rateLimited=0;}
  dispose(){this.#disposed=true;this.reset();}
}