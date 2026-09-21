/** Versioned save codec with stable encoding, checksum verification and migration hooks. */
export interface SaveEnvelopeV15<T=unknown>{readonly schema:15;readonly gameVersion:string;readonly slot:string;readonly createdAtTick:number;readonly updatedAtTick:number;readonly revision:number;readonly checksum:string;readonly payload:T;readonly metadata:Readonly<Record<string,string|number|boolean>>;}
export interface SaveDecodeResultV15<T>{readonly ok:true;readonly value:T;readonly envelope:SaveEnvelopeV15<T>}|{readonly ok:false;readonly error:string;readonly version?:number;}
export interface SaveMigrationV15{readonly from:number;readonly to:number;readonly migrate:(value:unknown)=>unknown;}

const stable=(value:unknown):string=>{if(value===null)return'null';if(typeof value!=='object')return JSON.stringify(value)??'undefined';if(Array.isArray(value))return'['+value.map(stable).join(',')+']';const object=value as Record<string,unknown>;return'{'+Object.keys(object).sort().map((key)=>JSON.stringify(key)+':'+stable(object[key])).join(',')+'}';};
const hash=(source:string):string=>{let h=2166136261;for(let i=0;i<source.length;i+=1){h^=source.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');};
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;

export class SaveCodecV15<T=unknown>{
  readonly #gameVersion:string;readonly #migrations=new Map<number,SaveMigrationV15>();readonly #maxBytes:number;
  constructor(options:{gameVersion?:string;maxBytes?:number;migrations?:readonly SaveMigrationV15[]}={}){this.#gameVersion=options.gameVersion?.trim()||'dev';this.#maxBytes=Math.max(1024,Math.trunc(options.maxBytes??16*1024*1024));for(const migration of options.migrations??[])this.addMigration(migration);}
  addMigration(migration:SaveMigrationV15):void{if(migration.to<=migration.from)throw new Error('Save migration target must be newer.');this.#migrations.set(migration.from,Object.freeze(migration));}

  encode(payload:T,options:{slot?:string;tick?:number;revision?:number;metadata?:Readonly<Record<string,string|number|boolean>>}={}):string{
    const body={schema:15 as const,gameVersion:this.#gameVersion,slot:(options.slot??'default').trim().slice(0,64),createdAtTick:Math.max(0,Math.trunc(options.tick??0)),updatedAtTick:Math.max(0,Math.trunc(options.tick??0)),revision:Math.max(0,Math.trunc(options.revision??0)),metadata:Object.freeze({...options.metadata}),payload:clone(payload)};
    const checksum=hash(stable(body));const envelope:SaveEnvelopeV15<T>=Object.freeze({...body,checksum});const serialized=JSON.stringify(envelope);if(new TextEncoder().encode(serialized).byteLength>this.#maxBytes)throw new Error('Save exceeds configured maximum size.');return serialized;
  }

  decode(serialized:string):SaveDecodeResultV15<T>{
    if(new TextEncoder().encode(serialized).byteLength>this.#maxBytes)return{ok:false,error:'SAVE_TOO_LARGE'};
    let value:unknown;try{value=JSON.parse(serialized);}catch{return{ok:false,error:'INVALID_JSON'};}
    if(!value||typeof value!=='object')return{ok:false,error:'INVALID_ENVELOPE'};
    const envelope=value as Record<string,unknown>;const schema=typeof envelope.schema==='number'?Math.trunc(envelope.schema):0;
    if(schema===15){const{checksum,...body}=envelope as Omit<SaveEnvelopeV15<T>,'checksum'> & {checksum:string};if(typeof checksum!=='string'||hash(stable(body))!==checksum)return{ok:false,error:'CHECKSUM_MISMATCH',version:schema};return{ok:true,value:clone(body.payload),envelope:Object.freeze({...body,checksum}) as SaveEnvelopeV15<T>};}
    const migrated=this.#migrate(schema,envelope);if(!migrated.ok)return migrated as SaveDecodeResultV15<T>;return this.decode(this.encode(migrated.value as T,{slot:String(envelope.slot??'default')}));
  }

  inspect(serialized:string):Readonly<{schema?:number;bytes:number;checksum?:string;slot?:string}> {try{const value=JSON.parse(serialized) as Record<string,unknown>;return Object.freeze({schema:typeof value.schema==='number'?value.schema:undefined,bytes:new TextEncoder().encode(serialized).byteLength,checksum:typeof value.checksum==='string'?value.checksum:undefined,slot:typeof value.slot==='string'?value.slot:undefined});}catch{return Object.freeze({bytes:new TextEncoder().encode(serialized).byteLength});}}
  checksum(payload:unknown):string{return hash(stable(payload));}
  stableEncode(payload:unknown):string{return stable(payload);}
  maxBytes():number{return this.#maxBytes;}

  #migrate(schema:number,envelope:Record<string,unknown>):{ok:true;value:unknown}|{ok:false;error:string;version:number}{
    let value=envelope.payload;let current=schema;const visited=new Set<number>();
    while(current!==15){if(visited.has(current))return{ok:false,error:'MIGRATION_CYCLE',version:current};visited.add(current);const migration=this.#migrations.get(current);if(!migration)return{ok:false,error:'UNSUPPORTED_SCHEMA',version:current};try{value=migration.migrate(value);}catch(error){return{ok:false,error:error instanceof Error?error.message:String(error),version:current};}current=migration.to;}
    return{ok:true,value};
  }
}

export const createSaveCodecV15= <T=unknown>(options?:ConstructorParameters<typeof SaveCodecV15<T>>[0]):SaveCodecV15<T>=>new SaveCodecV15<T>(options);
