import type { EntityId, TimestampMs, Vector3Like, WorldSnapshot } from './types';
import { stableHashObject } from './eventBus';

export interface ReplicatedComponent { readonly name:string; readonly value:unknown; readonly version:number; }
export interface ReplicatedEntity { readonly id:EntityId; readonly revision:number; readonly position:Vector3Like; readonly components:readonly ReplicatedComponent[]; readonly removed?:boolean; }
export interface ReplicationFrame { readonly tick:number; readonly timestamp:TimestampMs; readonly worldRevision:number; readonly entities:readonly ReplicatedEntity[]; readonly checksum:string; }
export interface ReplicationCursor { readonly tick:number; readonly worldRevision:number; readonly entityVersions:Readonly<Record<string,number>>; }
export interface ReplicationBudget { readonly maxEntities:number; readonly maxComponents:number; readonly maxBytes:number; }

/** Deterministic delta replication model for future multiplayer/native transport adapters. */
export class ReplicationEncoder {
  private readonly budget:ReplicationBudget;
  public constructor(budget:Partial<ReplicationBudget>={}){this.budget={maxEntities:budget.maxEntities??2000,maxComponents:budget.maxComponents??8000,maxBytes:budget.maxBytes??256*1024};}
  public encode(snapshot:WorldSnapshot,previous:ReplicationCursor|null,tick:number,timestamp:TimestampMs):ReplicationFrame{
    const candidates=[...snapshot.entities].sort((a,b)=>a.id.localeCompare(b.id));
    const entities:ReplicatedEntity[]=[];let components=0;let estimated=0;
    for(const entity of candidates){
      const revision=Number(snapshot.revision);
      const known=previous?.entityVersions[entity.id]??-1;
      const hash=stableHashObject(entity.components);
      if(previous&&known===hash)continue;
      const componentList=Object.keys(entity.components).sort().map(name=>({name,value:entity.components[name],version:stableHashObject(entity.components[name])}));
      if(components+componentList.length>this.budget.maxComponents)break;
      const encoded=JSON.stringify(componentList);
      estimated+=encoded.length;
      if(estimated>this.budget.maxBytes)break;
      components+=componentList.length;
      entities.push({id:entity.id,revision,position:{...entity.transform.position},components:componentList});
      if(entities.length>=this.budget.maxEntities)break;
    }
    const checksum=stableHashObject({tick,worldRevision:Number(snapshot.revision),entities});
    return{tick,timestamp,worldRevision:Number(snapshot.revision),entities,checksum:checksum.toString(16)};
  }
  public cursor(frame:ReplicationFrame):ReplicationCursor{const versions:Record<string,number>={};for(const entity of frame.entities)versions[entity.id]=stableHashObject(entity.components);return{tick:frame.tick,worldRevision:frame.worldRevision,entityVersions:versions};}
  public verify(frame:ReplicationFrame):boolean{return stableHashObject({tick:frame.tick,worldRevision:frame.worldRevision,entities:frame.entities}).toString(16)===frame.checksum;}
}

export interface ReplicationPacket { readonly sequence:number; readonly createdAt:number; readonly frame:ReplicationFrame; readonly reliable:boolean; }
export class ReplicationHistory {
 private readonly capacity:number;private readonly frames:ReplicationPacket[]=[];private nextSequence=1;
 constructor(capacity=120){this.capacity=Math.max(8,Math.floor(capacity));}
 push(frame:ReplicationFrame,reliable=true):ReplicationPacket{const packet={sequence:this.nextSequence++,createdAt:Date.now(),frame,reliable};this.frames.push(packet);while(this.frames.length>this.capacity)this.frames.shift();return packet;}
 latest():ReplicationPacket|undefined{return this.frames.at(-1);}
 since(sequence:number):readonly ReplicationPacket[]{return this.frames.filter(packet=>packet.sequence>sequence);}
 between(start:number,end:number):readonly ReplicationPacket[]{return this.frames.filter(packet=>packet.sequence>=start&&packet.sequence<=end);}
 size():number{return this.frames.length;}
 clear():void{this.frames.length=0;}
}

export interface InterestSource { readonly position:Vector3Like;readonly radius:number; }
export const filterByInterest=(frame:ReplicationFrame,source:InterestSource):ReplicationFrame=>{const radius=Math.max(0,source.radius);const entities=frame.entities.filter(entity=>{const dx=entity.position.x-source.position.x,dy=entity.position.y-source.position.y,dz=entity.position.z-source.position.z;return dx*dx+dy*dy+dz*dz<=radius*radius;});return{...frame,entities,checksum:stableHashObject({tick:frame.tick,worldRevision:frame.worldRevision,entities}).toString(16)};};

export interface MergeResult { readonly accepted:readonly EntityId[];readonly rejected:readonly EntityId[];readonly conflicts:readonly EntityId[]; }
export const mergeReplication=(local:Map<EntityId,ReplicatedEntity>,remote:ReplicationFrame):MergeResult=>{const accepted:EntityId[]=[];const rejected:EntityId[]=[];const conflicts:EntityId[]=[];for(const incoming of remote.entities){const current=local.get(incoming.id);if(!current){local.set(incoming.id,incoming);accepted.push(incoming.id);continue;}if(incoming.revision>current.revision){local.set(incoming.id,incoming);accepted.push(incoming.id);}else if(incoming.revision===current.revision&&stableHashObject(incoming.components)!==stableHashObject(current.components)){conflicts.push(incoming.id);}else rejected.push(incoming.id);}return{accepted,rejected,conflicts};};
