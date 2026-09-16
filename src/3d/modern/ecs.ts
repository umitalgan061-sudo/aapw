import type { EntityId, EntitySnapshot, EntityStore, QuaternionLike, TransformState, Vector3Like, WorldRevision, WorldSnapshot } from './types';
import { asEntityId, asTimestampMs, asWorldRevision } from './types';

const DEFAULT_TRANSFORM: TransformState = { position:{x:0,y:0,z:0}, rotation:{x:0,y:0,z:0,w:1}, scale:{x:1,y:1,z:1} };
interface InternalEntity { id:EntityId; active:boolean; transform:TransformState; tags:Set<string>; components:Map<string,unknown>; }
export interface ComponentDefinition<T>{readonly name:string;readonly defaultValue:()=>T;readonly clone?:(value:T)=>T;readonly validate?:(value:unknown)=>value is T;}
export interface QueryFilter{readonly with?:readonly string[];readonly without?:readonly string[];readonly activeOnly?:boolean;readonly tag?:string;}
export interface EntityQueryResult{readonly ids:readonly EntityId[];readonly count:number;}
export interface EntityStoreOptions{readonly seed?:number;readonly idPrefix?:string;readonly now?:()=>number;}

const cloneTransform=(value:TransformState):TransformState=>({position:{...value.position},rotation:{...value.rotation},scale:{...value.scale}});
const cloneValue=<T>(definition:ComponentDefinition<T>|undefined,value:T):T=>definition?.clone?definition.clone(value):typeof structuredClone==='function'?structuredClone(value):value&&typeof value==='object'?JSON.parse(JSON.stringify(value)) as T:value;
const validVector=(value:unknown):value is Vector3Like=>!!value&&typeof value==='object'&&[((value as Vector3Like).x),((value as Vector3Like).y),((value as Vector3Like).z)].every(Number.isFinite);
const validQuaternion=(value:unknown):value is QuaternionLike=>!!value&&typeof value==='object'&&[((value as QuaternionLike).x),((value as QuaternionLike).y),((value as QuaternionLike).z),((value as QuaternionLike).w)].every(Number.isFinite);

export class ModernEntityStore implements EntityStore{
  private readonly entities=new Map<EntityId,InternalEntity>(); private readonly definitions=new Map<string,ComponentDefinition<any>>();
  private readonly prefix:string; private readonly seed:number; private readonly now:()=>number; private counter=0; private revision=0; private disposed=false;
  public constructor(options:EntityStoreOptions={}){this.seed=options.seed??0x41415057;this.prefix=options.idPrefix??'e';this.now=options.now??Date.now;}
  public registerComponent<T>(definition:ComponentDefinition<T>):void{if(this.definitions.has(definition.name))throw new Error(`COMPONENT_REDEFINED:${definition.name}`);this.definitions.set(definition.name,definition);}
  public create(initial:Partial<EntitySnapshot>={}):EntityId{this.ensureActive();const id=initial.id??this.makeId();if(this.entities.has(id))throw new Error(`ENTITY_EXISTS:${id}`);this.entities.set(id,{id,active:initial.active??true,transform:cloneTransform(initial.transform??DEFAULT_TRANSFORM),tags:new Set(initial.tags??[]),components:new Map(Object.entries(initial.components??{}))});this.bump();return id;}
  public remove(id:EntityId):boolean{this.ensureActive();const result=this.entities.delete(id);if(result)this.bump();return result;}
  public get(id:EntityId):EntitySnapshot|undefined{const entity=this.entities.get(id);return entity?this.snapshotEntity(entity):undefined;}
  public update(id:EntityId,patch:Partial<EntitySnapshot>):boolean{this.ensureActive();const entity=this.entities.get(id);if(!entity)return false;if(patch.active!==undefined)entity.active=patch.active;if(patch.transform)entity.transform=cloneTransform(patch.transform);if(patch.tags)entity.tags=new Set(patch.tags);if(patch.components)entity.components=new Map(Object.entries(patch.components));this.bump();return true;}
  public setComponent<T>(id:EntityId,name:string,value:T):boolean{this.ensureActive();const entity=this.entities.get(id);if(!entity)return false;const definition=this.definitions.get(name) as ComponentDefinition<T>|undefined;if(definition?.validate&&!definition.validate(value))throw new TypeError(`INVALID_COMPONENT:${name}`);entity.components.set(name,cloneValue(definition,value));this.bump();return true;}
  public getComponent<T>(id:EntityId,name:string):T|undefined{const entity=this.entities.get(id);if(!entity)return undefined;const value=entity.components.get(name) as T|undefined;return value===undefined?undefined:cloneValue(this.definitions.get(name),value);}
  public removeComponent(id:EntityId,name:string):boolean{const entity=this.entities.get(id);if(!entity)return false;const result=entity.components.delete(name);if(result)this.bump();return result;}
  public addTag(id:EntityId,tag:string):boolean{const entity=this.entities.get(id);if(!entity)return false;const before=entity.tags.size;entity.tags.add(tag);if(entity.tags.size!==before)this.bump();return true;}
  public removeTag(id:EntityId,tag:string):boolean{const entity=this.entities.get(id);if(!entity)return false;const result=entity.tags.delete(tag);if(result)this.bump();return result;}
  public query(filter:QueryFilter={}):EntityQueryResult{const withSet=new Set(filter.with??[]),withoutSet=new Set(filter.without??[]),ids:EntityId[]=[];for(const entity of this.entities.values()){if(filter.activeOnly&&!entity.active)continue;if(filter.tag&&!entity.tags.has(filter.tag))continue;if([...withSet].some(name=>!entity.components.has(name)))continue;if([...withoutSet].some(name=>entity.components.has(name)))continue;ids.push(entity.id);}ids.sort();return{ids,count:ids.length};}
  public forEach(filter:QueryFilter,visitor:(entity:EntitySnapshot)=>void):void{for(const id of this.query(filter).ids){const value=this.get(id);if(value)visitor(value);}}
  public snapshot():WorldSnapshot{this.ensureActive();const entities=[...this.entities.values()].sort((a,b)=>a.id.localeCompare(b.id)).map(entity=>this.snapshotEntity(entity));return{schemaVersion:1,revision:asWorldRevision(this.revision),capturedAt:asTimestampMs(this.now()),seed:this.seed,entities,globals:{entityCount:entities.length}};}
  public restore(snapshot:WorldSnapshot):void{this.ensureActive();if(snapshot.schemaVersion!==1)throw new Error(`WORLD_SCHEMA_UNSUPPORTED:${snapshot.schemaVersion}`);this.entities.clear();for(const entry of snapshot.entities)this.entities.set(entry.id,{id:entry.id,active:entry.active,transform:cloneTransform(entry.transform),tags:new Set(entry.tags),components:new Map(Object.entries(entry.components))});this.revision=Number(snapshot.revision);this.counter=snapshot.entities.length;}
  public clear():void{this.ensureActive();if(this.entities.size)this.bump();this.entities.clear();this.counter=0;}
  public entityCount():number{return this.entities.size;}
  public revisionNumber():WorldRevision{return asWorldRevision(this.revision);}
  public cloneEntity(id:EntityId):EntityId|undefined{const source=this.get(id);if(!source)return undefined;const{ id:_ignored,...rest}=source;return this.create(rest);}
  public serializeEntity(id:EntityId):string|null{const entity=this.get(id);return entity?JSON.stringify(entity):null;}
  public restoreEntity(serialized:string):EntityId{const parsed=JSON.parse(serialized) as EntitySnapshot;const{ id:_ignored,...rest}=parsed;return this.create(rest);}
  private snapshotEntity(entity:InternalEntity):EntitySnapshot{const components:Record<string,unknown>={};for(const[name,value]of entity.components)components[name]=cloneValue(this.definitions.get(name),value);return Object.freeze({id:entity.id,active:entity.active,transform:cloneTransform(entity.transform),tags:[...entity.tags].sort(),components});}
  private makeId():EntityId{this.counter+=1;const mixed=Math.imul(this.seed^this.counter,0x45d9f3b)>>>0;return asEntityId(`${this.prefix}-${mixed.toString(16).padStart(8,'0')}-${this.counter.toString(36)}`);}
  private bump():void{this.revision=(this.revision+1)>>>0;} private ensureActive():void{if(this.disposed)throw new Error('ENTITY_STORE_DISPOSED');}
  public dispose():void{if(this.disposed)return;this.entities.clear();this.disposed=true;}
}
export const TransformComponent:ComponentDefinition<TransformState>={name:'transform',defaultValue:()=>cloneTransform(DEFAULT_TRANSFORM),clone:cloneTransform,validate:(value:unknown):value is TransformState=>!!value&&typeof value==='object'&&validVector((value as TransformState).position)&&validVector((value as TransformState).scale)&&validQuaternion((value as TransformState).rotation)};
