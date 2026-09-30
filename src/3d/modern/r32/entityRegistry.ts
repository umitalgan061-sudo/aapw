import {asEntityId,stableHash} from './contracts.ts';
import type {EntityId,Vec3} from './contracts.ts';

  EntityId,
  Vec3,
  asEntityId,
  stableHash,
} from './contracts.ts';

export type EntityKind =
  | 'player'
  | 'npc'
  | 'creature'
  | 'vehicle'
  | 'prop'
  | 'projectile'
  | 'trigger'
  | 'effect';

export interface EntityRecord {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly active: boolean;
  readonly position: Vec3;
  readonly tags: readonly string[];
  readonly components: Readonly<Record<string,unknown>>;
  readonly generation: number;
}

export interface EntityQuery {
  readonly kind?: EntityKind;
  readonly active?: boolean;
  readonly tags?: readonly string[];
  readonly within?: {
    readonly center: Vec3;
    readonly radius: number;
  };
}

export interface EntityRegistryOptions {
  readonly maxEntities: number;
  readonly maxTagsPerEntity: number;
}

export interface EntityRegistryStats {
  readonly total: number;
  readonly active: number;
  readonly byKind: Readonly<Record<EntityKind,number>>;
}

export class EntityRegistry {
  readonly #options: EntityRegistryOptions;
  readonly #entities = new Map<EntityId,EntityRecord>();
  #generation = 0;

  constructor(options:EntityRegistryOptions){
    this.#options=options;
  }

  create(
    kind:EntityKind,
    position:Vec3,
    components:Readonly<Record<string,unknown>>={},
    tags:readonly string[]=[],
  ):EntityId{
    if(this.#entities.size>=this.#options.maxEntities){
      throw new Error('Entity limit exceeded.');
    }
    const id=asEntityId(
      'e:'+
      stableHash({
        kind,
        position,
        generation:this.#generation+1,
        size:this.#entities.size,
      })+
      ':'+
      String(this.#generation+1),
    );
    this.#generation+=1;
    const record:EntityRecord={
      id,
      kind,
      active:true,
      position,
      tags:[...tags].slice(0,this.#options.maxTagsPerEntity),
      components:{...components},
      generation:this.#generation,
    };
    this.#entities.set(id,record);
    return id;
  }

  get(id:EntityId):EntityRecord|null{
    return this.#entities.get(id)??null;
  }

  update(
    id:EntityId,
    patch:Partial<Omit<EntityRecord,'id'|'generation'>>,
  ):EntityRecord{
    const current=this.#entities.get(id);
    if(!current)throw new Error('Unknown entity: '+String(id));
    const next:EntityRecord={
      ...current,
      ...patch,
      tags:patch.tags===undefined?current.tags:[...patch.tags].slice(0,this.#options.maxTagsPerEntity),
      components:patch.components===undefined?current.components:{...patch.components},
    };
    this.#entities.set(id,next);
    return next;
  }

  remove(id:EntityId):boolean{
    return this.#entities.delete(id);
  }

  setActive(id:EntityId,active:boolean):EntityRecord{
    return this.update(id,{active});
  }

  query(query:EntityQuery={}):readonly EntityRecord[]{
    const result:EntityRecord[]=[];
    const radius=query.within?.radius;
    const radiusSquared=radius===undefined?undefined:Math.max(0,radius*radius);

    for(const entity of this.#entities.values()){
      if(query.kind!==undefined&&entity.kind!==query.kind)continue;
      if(query.active!==undefined&&entity.active!==query.active)continue;

      if(query.tags?.length){
        const tags=new Set(entity.tags);
        if(query.tags.some(tag=>!tags.has(tag)))continue;
      }

      if(query.within&&radiusSquared!==undefined){
        const dx=entity.position.x-query.within.center.x;
        const dy=entity.position.y-query.within.center.y;
        const dz=entity.position.z-query.within.center.z;
        if(dx*dx+dy*dy+dz*dz>radiusSquared)continue;
      }

      result.push(entity);
    }

    return result.sort((a,b)=>
      String(a.id).localeCompare(String(b.id)));
  }

  stats():EntityRegistryStats{
    const byKind={
      player:0,npc:0,creature:0,vehicle:0,
      prop:0,projectile:0,trigger:0,effect:0,
    } satisfies Record<EntityKind,number>;

    let active=0;

    for(const entity of this.#entities.values()){
      byKind[entity.kind]+=1;
      active+=Number(entity.active);
    }

    return{
      total:this.#entities.size,
      active,
      byKind,
    };
  }

  snapshot():readonly EntityRecord[]{
    return [...this.#entities.values()].map(entity=>({
      ...entity,
      position:{...entity.position},
      tags:[...entity.tags],
      components:{...entity.components},
    }));
  }

  restore(entities:readonly EntityRecord[]):void{
    if(entities.length>this.#options.maxEntities){
      throw new Error('Snapshot exceeds entity limit.');
    }
    this.#entities.clear();
    let maxGeneration=this.#generation;

    for(const entity of entities){
      const safeGeneration=Math.max(0,Math.floor(entity.generation));
      maxGeneration=Math.max(maxGeneration,safeGeneration);
      this.#entities.set(entity.id,{
        ...entity,
        position:{...entity.position},
        tags:[...entity.tags].slice(0,this.#options.maxTagsPerEntity),
        components:{...entity.components},
      });
    }

    this.#generation=maxGeneration;
  }

  digest():string{
    return stableHash(
      [...this.#entities.values()]
        .sort((a,b)=>String(a.id).localeCompare(String(b.id))),
    );
  }

  clear():void{
    this.#entities.clear();
  }
}
