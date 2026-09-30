import { digestValue } from './deterministic.js';
import type { R16Result } from './types.js';

export interface R16SaveEnvelope{
  readonly schema:string;
  readonly version:number;
  readonly createdTick:number;
  readonly state:Readonly<Record<string,unknown>>;
  readonly digest:string;
}
export interface R16MigrationStep{
  readonly from:number;
  readonly to:number;
  readonly id:string;
  readonly apply:(state:Readonly<Record<string,unknown>>)=>Readonly<Record<string,unknown>>;
}
export interface R16SaveValidation{
  readonly accepted:boolean;
  readonly version:number;
  readonly digest:string;
  readonly reason:string|null;
}

export class R16SaveMigrationPipeline{
  readonly #schema:string;readonly #latest:number;readonly #steps=new Map<number,R16MigrationStep>();
  constructor(schema='aapw-save',latest=16){this.#schema=schema;this.#latest=Math.max(1,Math.trunc(latest));}
  register(step:R16MigrationStep):R16Result<void>{
    if(step.from<1||step.to!==step.from+1||!step.id||this.#steps.has(step.from))return{ok:false,error:{code:'SAVE_MIGRATION_STEP',message:'Migration step is invalid or duplicated',retryable:false}};
    this.#steps.set(step.from,Object.freeze(step));return{ok:true,value:undefined};
  }
  validate(envelope:unknown):R16SaveValidation{
    if(!isRecord(envelope)||envelope.schema!==this.#schema||typeof envelope.version!=='number'||envelope.version<1||envelope.version>this.#latest)return Object.freeze({accepted:false,version:0,digest:'',reason:'schema-or-version'});
    const state=isRecord(envelope.state)?envelope.state:{};const expected=digestValue({schema:envelope.schema,version:Math.trunc(envelope.version),createdTick:toInt(envelope.createdTick),state});
    return Object.freeze({accepted:expected===envelope.digest,version:Math.trunc(envelope.version),digest:expected,reason:expected===envelope.digest?null:'digest'});
  }
  migrate(envelope:R16SaveEnvelope,target=this.#latest):R16Result<R16SaveEnvelope>{
    const validation=this.validate(envelope);if(!validation.accepted)return{ok:false,error:{code:'SAVE_INVALID',message:validation.reason??'Invalid save envelope',retryable:false}};
    const boundedTarget=Math.min(this.#latest,Math.max(validation.version,Math.trunc(target)));let state=envelope.state;let version=validation.version;
    while(version<boundedTarget){const step=this.#steps.get(version);if(!step)return{ok:false,error:{code:'SAVE_MIGRATION_MISSING',message:'Missing migration from v'+version,retryable:false}};state=freezeState(step.apply(state));version=step.to;}
    const createdTick=toInt(envelope.createdTick);const digest=digestValue({schema:this.#schema,version,createdTick,state});
    return{ok:true,value:Object.freeze({schema:this.#schema,version,createdTick,state,digest})};
  }
  latest(versioned:Readonly<Record<string,unknown>>,createdTick=0):R16SaveEnvelope{
    const version=this.#latest;const state=freezeState(versioned);return Object.freeze({schema:this.#schema,version,createdTick:Math.max(0,Math.trunc(createdTick)),state,digest:digestValue({schema:this.#schema,version,createdTick:Math.max(0,Math.trunc(createdTick)),state})});
  }
  digest(){return digestValue({schema:this.#schema,latest:this.#latest,steps:[...this.#steps.values()].sort((a,b)=>a.from-b.from).map(x=>x.id)});}
}
function isRecord(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function toInt(v:unknown){const n=typeof v==='number'?v:Number(v);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):0;}
function freezeState(value:Readonly<Record<string,unknown>>):Readonly<Record<string,unknown>>{return Object.freeze({...value});}
