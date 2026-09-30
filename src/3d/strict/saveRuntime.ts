import type { Result } from './liveCoreTypes.ts';
import { err, ok, stableHash, stableSerialize } from './liveCoreTypes.ts';

export interface SaveHeader {
  readonly schema:string;
  readonly version:number;
  readonly createdAtTick:number;
  readonly updatedAtTick:number;
  readonly build:string;
}
export interface SaveEnvelope<T> {
  readonly header:SaveHeader;
  readonly payload:T;
  readonly checksum:string;
}
export interface SaveStorage { read(key:string):Promise<string|null>; write(key:string,value:string):Promise<void>; remove(key:string):Promise<void>; }
export interface SaveMigration<T=unknown>{readonly from:number;readonly to:number;readonly migrate:(payload:unknown)=>T;}
export interface SavePolicy{readonly keyPrefix:string;readonly maxBytes:number;readonly maxSchemaLength:number;readonly build:string;readonly currentVersion:number;}
export interface SaveResult<T>{readonly ok:boolean;readonly value?:T;readonly error?:string;readonly migratedFrom?:number;}
export const DEFAULT_SAVE_POLICY:SavePolicy=Object.freeze({keyPrefix:'aapw.save.',maxBytes:2_000_000,maxSchemaLength:64,build:'r23',currentVersion:1});

const utf8Bytes=(value:string)=>new TextEncoder().encode(value).byteLength;
const normalizeKey=(prefix:string,key:string)=>prefix+key.trim().slice(0,96);
const checksumFor=<T>(header:SaveHeader,payload:T)=>stableHash({header,payload});
const cloneHeader=(header:SaveHeader):SaveHeader=>Object.freeze({...header});

export class MemorySaveStorage implements SaveStorage{
  #map=new Map<string,string>();
  async read(key:string){return this.#map.get(key)??null;}
  async write(key:string,value:string){this.#map.set(key,value);}
  async remove(key:string){this.#map.delete(key);}
  keys(){return Object.freeze([...this.#map.keys()].sort());}
}

export class StrictSaveRuntime{
  #policy:SavePolicy;#storage:SaveStorage;#migrations=new Map<number,SaveMigration>();#disposed=false;
  constructor(storage:SaveStorage=new MemorySaveStorage(),policy:SavePolicy=DEFAULT_SAVE_POLICY){this.#storage=storage;this.#policy=Object.freeze({...policy});}
  registerMigration(migration:SaveMigration){if(this.#disposed||migration.to!==migration.from+1)return false;this.#migrations.set(migration.from,migration);return true;}
  createEnvelope<T>(payload:T,tick:number,version=this.#policy.currentVersion):Result<SaveEnvelope<T>>{if(this.#disposed)return err('RUNTIME_DISPOSED','Save runtime is disposed.');const schema='aapw-save-v'+version;if(schema.length>this.#policy.maxSchemaLength)return err('INVALID_FRAME','Save schema identifier is too long.');const header=cloneHeader({schema,version:Math.max(1,Math.floor(version)),createdAtTick:Math.max(0,Math.floor(tick)),updatedAtTick:Math.max(0,Math.floor(tick)),build:this.#policy.build});return ok(Object.freeze({header,payload,checksum:checksumFor(header,payload)}));}
  validateEnvelope<T>(envelope:SaveEnvelope<T>):Result<SaveEnvelope<T>>{if(this.#disposed)return err('RUNTIME_DISPOSED','Save runtime is disposed.');if(!envelope?.header||!envelope.checksum)return err('INVALID_FRAME','Save envelope is incomplete.',true);if(utf8Bytes(stableSerialize(envelope))>this.#policy.maxBytes)return err('ASSET_BUDGET','Save payload exceeds size budget.',true);const expected=checksumFor(envelope.header,envelope.payload);if(expected!==envelope.checksum)return err('INVALID_FRAME','Save checksum mismatch.',true);if(envelope.header.version<1)return err('INVALID_FRAME','Save version must be positive.');return ok(envelope);}
  async save<T>(slot:string,payload:T,tick:number):Promise<Result<SaveEnvelope<T>>>{if(this.#disposed)return err('RUNTIME_DISPOSED','Save runtime is disposed.');const existing=await this.#storage.read(normalizeKey(this.#policy.keyPrefix,slot));let version=this.#policy.currentVersion;if(existing){const previous=this.parseRaw<unknown>(existing);if(previous.ok)version=Math.max(this.#policy.currentVersion,previous.value.header.version);}const envelopeResult=this.createEnvelope(payload,tick,version);if(!envelopeResult.ok)return envelopeResult;const envelope=Object.freeze({...envelopeResult.value,header:Object.freeze({...envelopeResult.value.header,updatedAtTick:Math.max(0,Math.floor(tick))})});const final=Object.freeze({...envelope,checksum:checksumFor(envelope.header,envelope.payload)});const raw=JSON.stringify(final);if(utf8Bytes(raw)>this.#policy.maxBytes)return err('ASSET_BUDGET','Save exceeds maximum encoded size.',true);await this.#storage.write(normalizeKey(this.#policy.keyPrefix,slot),raw);return ok(final);}
  async load<T>(slot:string):Promise<Result<SaveResult<T>>>{if(this.#disposed)return err('RUNTIME_DISPOSED','Save runtime is disposed.');const raw=await this.#storage.read(normalizeKey(this.#policy.keyPrefix,slot));if(!raw)return ok(Object.freeze({ok:false,error:'missing'}));const parsed=this.parseRaw<T>(raw);if(!parsed.ok)return ok(Object.freeze({ok:false,error:parsed.error.message}));if(parsed.value.header.version>this.#policy.currentVersion)return ok(Object.freeze({ok:false,error:'future-version'}));let payload:unknown=parsed.value.payload;let version=parsed.value.header.version;const migratedFrom=version;while(version<this.#policy.currentVersion){const migration=this.#migrations.get(version);if(!migration)return ok(Object.freeze({ok:false,error:'missing-migration'}));payload=migration.migrate(payload);version=migration.to;}return ok(Object.freeze({ok:true,value:payload as T,...(migratedFrom!==version?{migratedFrom}: {})}));}
  parseRaw<T>(raw:string):Result<SaveEnvelope<T>>{try{const parsed=JSON.parse(raw) as SaveEnvelope<T>;return this.validateEnvelope(parsed);}catch{return err('INVALID_FRAME','Save JSON could not be parsed.',true);}}
  async remove(slot:string):Promise<Result<void>>{if(this.#disposed)return err('RUNTIME_DISPOSED','Save runtime is disposed.');await this.#storage.remove(normalizeKey(this.#policy.keyPrefix,slot));return ok(undefined);}
  async list():Promise<readonly string[]>{if(this.#disposed)return [];const storage=this.#storage as MemorySaveStorage;return storage.keys?Object.freeze(storage.keys().filter(k=>k.startsWith(this.#policy.keyPrefix)).map(k=>k.slice(this.#policy.keyPrefix.length))):[];}
  digest<T>(envelope:SaveEnvelope<T>):string{return stableHash({header:envelope.header,payload:envelope.payload,checksum:envelope.checksum});}
  dispose(){this.#disposed=true;this.#migrations.clear();}
}