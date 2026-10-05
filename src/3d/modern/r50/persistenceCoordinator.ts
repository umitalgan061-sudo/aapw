import {RuntimeError,stableHash} from './contracts.ts';

export interface StorageAdapter{
  readonly get:(key:string)=>Promise<string|null>|string|null;
  readonly set:(key:string,value:string)=>Promise<void>|void;
  readonly remove:(key:string)=>Promise<void>|void;
}
export interface PersistenceEnvelope<T>{
  readonly schema:string;readonly version:number;readonly revision:number;readonly createdAtTick:number;
  readonly checksum:string;readonly payload:T;readonly metadata:Readonly<Record<string,string|number|boolean>>;
}
export interface PersistenceRecord<T>{readonly key:string;readonly envelope:PersistenceEnvelope<T>;readonly bytes:number;}
export interface PersistenceMigration<T>{readonly fromVersion:number;readonly toVersion:number;readonly migrate:(payload:unknown)=>T;}
export interface PersistenceOptions{readonly namespace:string;readonly schema:string;readonly version:number;readonly maxBytes:number;readonly backupCount:number;}
export interface PersistenceStats{readonly writes:number;readonly reads:number;readonly failures:number;readonly bytes:number;readonly revisions:number;readonly backups:number;}
interface Backup{readonly revision:number;readonly encoded:string;}

export class MemoryStorage implements StorageAdapter{
  readonly #store=new Map<string,string>();
  get(key:string):string|null{return this.#store.get(key)??null;}
  set(key:string,value:string):void{this.#store.set(key,value);}
  remove(key:string):void{this.#store.delete(key);}
}

export class JsonPersistenceCoordinator<T>{
  readonly #storage:StorageAdapter;
  readonly #options:PersistenceOptions;
  readonly #migrations=new Map<number,PersistenceMigration<T>>();
  readonly #backups:Backup[]=[];
  #revision=0;#writes=0;#reads=0;#failures=0;#bytes=0;

  constructor(storage:StorageAdapter,options:PersistenceOptions){
    if(options.maxBytes<=0||options.backupCount<0)throw new RuntimeError({code:'R50_PERSISTENCE_OPTIONS',message:'Persistence limits are invalid',recoverable:false});
    this.#storage=storage;this.#options=options;
  }
  get keyPrefix():string{return this.#options.namespace+':'+this.#options.schema+':';}
  registerMigration(migration:PersistenceMigration<T>):()=>void{
    if(migration.toVersion!==migration.fromVersion+1)throw new RuntimeError({code:'R50_MIGRATION_STEP',message:'Migration must advance exactly one version'});
    if(this.#migrations.has(migration.fromVersion))throw new RuntimeError({code:'R50_MIGRATION_DUPLICATE',message:'Migration already registered'});
    this.#migrations.set(migration.fromVersion,migration);return()=>this.#migrations.delete(migration.fromVersion);
  }
  async save(payload:T,tick:number,metadata:Readonly<Record<string,string|number|boolean>>={}):Promise<PersistenceRecord<T>>{
    const revision=this.#revision+1;
    const envelope:PersistenceEnvelope<T>={schema:this.#options.schema,version:this.#options.version,revision,createdAtTick:tick,checksum:stableHash(payload),payload,metadata};
    const encoded=JSON.stringify(envelope);const bytes=new TextEncoder().encode(encoded).byteLength;
    if(bytes>this.#options.maxBytes){this.#failures+=1;throw new RuntimeError({code:'R50_PERSISTENCE_SIZE',message:'Persistence envelope exceeds size limit',metadata:{bytes,limit:this.#options.maxBytes}});}
    const current=await this.#storage.get(this.keyPrefix+'current');
    if(current&&this.#options.backupCount>0){this.#backups.unshift({revision:this.#revision,encoded:current});while(this.#backups.length>this.#options.backupCount)this.#backups.pop();await this.#writeBackups();}
    await this.#storage.set(this.keyPrefix+'current',encoded);this.#revision=revision;this.#writes+=1;this.#bytes=bytes;
    return{key:this.keyPrefix+'current',envelope,bytes};
  }
  async load():Promise<PersistenceRecord<T>|null>{
    this.#reads+=1;const encoded=await this.#storage.get(this.keyPrefix+'current');if(encoded===null)return null;
    try{const envelope=await this.#decode(encoded);return{key:this.keyPrefix+'current',envelope,bytes:new TextEncoder().encode(encoded).byteLength};}
    catch(error){this.#failures+=1;for(const backup of this.#backups){try{const envelope=await this.#decode(backup.encoded);await this.#storage.set(this.keyPrefix+'current',backup.encoded);return{key:this.keyPrefix+'current',envelope,bytes:new TextEncoder().encode(backup.encoded).byteLength};}catch{}}if(error instanceof RuntimeError)throw error;throw new RuntimeError({code:'R50_PERSISTENCE_LOAD',message:'Persistence load failed',cause:error,recoverable:false});}
  }
  async import(encoded:string):Promise<PersistenceRecord<T>>{const envelope=await this.#decode(encoded);await this.#storage.set(this.keyPrefix+'current',encoded);this.#revision=Math.max(this.#revision,envelope.revision);this.#bytes=new TextEncoder().encode(encoded).byteLength;return{key:this.keyPrefix+'current',envelope,bytes:this.#bytes};}
  async export():Promise<string>{return await this.#storage.get(this.keyPrefix+'current')??'';}
  async clear():Promise<void>{await this.#storage.remove(this.keyPrefix+'current');this.#revision=0;this.#bytes=0;}
  async compact():Promise<void>{const current=await this.load();if(!current)return;const envelope:PersistenceEnvelope<T>={...current.envelope,metadata:{...current.envelope.metadata,compacted:true}};await this.#storage.set(this.keyPrefix+'current',JSON.stringify(envelope));}
  stats():PersistenceStats{return{writes:this.#writes,reads:this.#reads,failures:this.#failures,bytes:this.#bytes,revisions:this.#revision,backups:this.#backups.length};}
  async #decode(encoded:string):Promise<PersistenceEnvelope<T>>{
    const decoded:unknown=JSON.parse(encoded);if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw new RuntimeError({code:'R50_PERSISTENCE_FORMAT',message:'Persistence envelope is invalid'});
    const r=decoded as Record<string,unknown>;
    if(typeof r.schema!=='string'||typeof r.version!=='number'||typeof r.revision!=='number'||typeof r.createdAtTick!=='number'||typeof r.checksum!=='string'||!('payload' in r))throw new RuntimeError({code:'R50_PERSISTENCE_FIELDS',message:'Persistence envelope fields are invalid'});
    if(r.schema!==this.#options.schema)throw new RuntimeError({code:'R50_PERSISTENCE_SCHEMA',message:'Persistence schema mismatch'});
    let version=r.version;let payload:unknown=r.payload;
    while(version<this.#options.version){const migration=this.#migrations.get(version);if(!migration)throw new RuntimeError({code:'R50_MIGRATION_MISSING',message:'Missing migration from version '+String(version),recoverable:false});payload=migration.migrate(payload);version=migration.toVersion;}
    if(version>this.#options.version)throw new RuntimeError({code:'R50_PERSISTENCE_FUTURE',message:'Persistence version is newer than runtime',recoverable:false});
    const checksum=stableHash(payload);if(r.checksum!==checksum)throw new RuntimeError({code:'R50_PERSISTENCE_CHECKSUM',message:'Persistence checksum mismatch',recoverable:false});
    this.#revision=Math.max(this.#revision,r.revision);this.#bytes=new TextEncoder().encode(encoded).byteLength;
    return{schema:r.schema,version,revision:r.revision,createdAtTick:r.createdAtTick,checksum,payload:payload as T,metadata:typeof r.metadata==='object'&&r.metadata!==null?r.metadata as Readonly<Record<string,string|number|boolean>>:{}};
  }
  async #writeBackups():Promise<void>{for(let i=0;i<this.#backups.length;i+=1){const backup=this.#backups[i]!;await this.#storage.set(this.keyPrefix+'backup:'+String(i),JSON.stringify(backup));}}
}
