import type { Aabb3, EntityId, Vec3 } from './types.js';
import { ENTITY_ID } from './types.js';

export type WorldLayer = 'terrain' | 'water' | 'settlement' | 'vegetation' | 'fauna' | 'npc' | 'player' | 'fx';
export type Residency = 'unloaded' | 'queued' | 'loading' | 'resident' | 'stale' | 'evicting';

export interface WorldTransform {
  readonly position: Vec3;
  readonly rotation: readonly [number, number, number, number];
  readonly scale: Vec3;
}

export interface WorldEntity {
  readonly id: EntityId;
  readonly layer: WorldLayer;
  readonly archetype: string;
  readonly chunk: string;
  readonly active: boolean;
  readonly transform: WorldTransform;
  readonly bounds: Aabb3;
  readonly residency: Residency;
  readonly priority: number;
  readonly revision: number;
}

export interface WorldChunk {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly state: 'unloaded' | 'queued' | 'loading' | 'active' | 'hibernating' | 'failed';
  readonly entityIds: readonly EntityId[];
  readonly memoryBytes: number;
  readonly lastTouchedFrame: number;
}

export interface WorldDelta {
  readonly upserted: readonly WorldEntity[];
  readonly removed: readonly EntityId[];
  readonly chunks: readonly WorldChunk[];
  readonly revision: number;
}

const vec = (x: number, y: number, z: number): Vec3 => Object.freeze({ x, y, z });
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const chunkKey = (x: number, z: number): string => `${Math.floor(x)}:${Math.floor(z)}`;
const distanceSq = (a: Vec3, b: Vec3): number => { const dx = a.x-b.x, dy=a.y-b.y, dz=a.z-b.z; return dx*dx+dy*dy+dz*dz; };
const hash = (value: string): number => { let h = 2166136261; for (let i=0;i<value.length;i+=1) { h ^= value.charCodeAt(i); h = Math.imul(h,16777619); } return h >>> 0; };

export class TypedWorldModel {
  private readonly entities = new Map<EntityId, WorldEntity>();
  private readonly chunks = new Map<string, WorldChunk>();
  private revision = 0;
  private disposed = false;

  public get size(): number { return this.entities.size; }
  public get chunkCount(): number { return this.chunks.size; }
  public get currentRevision(): number { return this.revision; }

  public upsert(input: Omit<WorldEntity, 'id' | 'revision'> & { readonly id?: string }): WorldEntity {
    this.assertLive();
    const id = ENTITY_ID(input.id ?? `${input.layer}:${input.archetype}:${this.revision+this.entities.size+1}`);
    const next: WorldEntity = Object.freeze({ ...input, id, revision: this.revision + 1 });
    this.entities.set(id, next);
    this.revision += 1;
    this.touchChunk(next.chunk, next.revision);
    return next;
  }

  public remove(id: EntityId): boolean {
    this.assertLive();
    const removed = this.entities.delete(id);
    if (removed) this.revision += 1;
    return removed;
  }

  public get(id: EntityId): WorldEntity | undefined { return this.entities.get(id); }

  public query(layer?: WorldLayer, center?: Vec3, maxDistance = Number.POSITIVE_INFINITY, limit = Number.POSITIVE_INFINITY): readonly WorldEntity[] {
    const maxSq = Number.isFinite(maxDistance) ? maxDistance * maxDistance : Number.POSITIVE_INFINITY;
    const result: WorldEntity[] = [];
    const sorted = [...this.entities.values()].sort((a,b) => a.id.localeCompare(b.id));
    for (const entity of sorted) {
      if (layer && entity.layer !== layer) continue;
      if (center && distanceSq(entity.transform.position, center) > maxSq) continue;
      result.push(entity);
      if (result.length >= limit) break;
    }
    return Object.freeze(result);
  }

  public ensureChunk(x: number, z: number, state: WorldChunk['state'] = 'active'): WorldChunk {
    this.assertLive();
    const key = chunkKey(x,z);
    const current = this.chunks.get(key);
    if (current) return current;
    const next: WorldChunk = Object.freeze({ id:key, x:Math.floor(x), z:Math.floor(z), state, entityIds:Object.freeze([]), memoryBytes:0, lastTouchedFrame:0 });
    this.chunks.set(key,next);
    return next;
  }

  public setChunkState(x: number, z: number, state: WorldChunk['state'], frame = 0): WorldChunk {
    const current = this.ensureChunk(x,z,state);
    const next: WorldChunk = Object.freeze({ ...current, state, lastTouchedFrame:Math.max(0,Math.floor(frame)) });
    this.chunks.set(current.id,next);
    return next;
  }

  public rebase(origin: Vec3, maxDistance: number, frame: number): readonly EntityId[] {
    this.assertLive();
    const maxSq = maxDistance * maxDistance;
    const evicted: EntityId[] = [];
    for (const [id, entity] of this.entities) {
      if (entity.layer === 'player') continue;
      if (distanceSq(entity.transform.position, origin) <= maxSq) continue;
      evicted.push(id);
    }
    evicted.sort();
    for (const id of evicted) this.remove(id);
    for (const chunk of this.chunks.values()) {
      if ((chunk.x*64-origin.x)**2+(chunk.z*64-origin.z)**2 > maxSq) this.setChunkState(chunk.x,chunk.z,'hibernating',frame);
    }
    return Object.freeze(evicted);
  }

  public deterministicSpawn(seed: number, archetype: string, count: number, region: { readonly minX:number; readonly maxX:number; readonly minZ:number; readonly maxZ:number }): readonly WorldEntity[] {
    this.assertLive();
    let state = (seed ^ hash(archetype)) >>> 0;
    const nextRandom = (): number => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
    const created: WorldEntity[] = [];
    for (let i=0;i<count;i+=1) {
      const x = region.minX + (region.maxX-region.minX)*nextRandom();
      const z = region.minZ + (region.maxZ-region.minZ)*nextRandom();
      const y = 0;
      const half = 0.5;
      created.push(this.upsert({ layer:'fauna', archetype, chunk:chunkKey(x/64,z/64), active:true, priority:1, residency:'resident', transform:{position:vec(x,y,z),rotation:[0,0,0,1],scale:vec(1,1,1)}, bounds:{min:vec(x-half,y,z-half),max:vec(x+half,y+1,z+half)} }));
    }
    return Object.freeze(created);
  }

  public diff(previousRevision: number): WorldDelta {
    const upserted = [...this.entities.values()].filter(entity => entity.revision > previousRevision).sort((a,b)=>a.id.localeCompare(b.id));
    const chunks = [...this.chunks.values()].sort((a,b)=>a.id.localeCompare(b.id));
    return Object.freeze({ upserted:Object.freeze(upserted), removed:Object.freeze([]), chunks:Object.freeze(chunks), revision:this.revision });
  }

  public snapshot(): Readonly<{ readonly revision:number; readonly entities:readonly WorldEntity[]; readonly chunks:readonly WorldChunk[] }> {
    return Object.freeze({ revision:this.revision, entities:Object.freeze([...this.entities.values()].sort((a,b)=>a.id.localeCompare(b.id))), chunks:Object.freeze([...this.chunks.values()].sort((a,b)=>a.id.localeCompare(b.id))) });
  }

  public memoryEstimate(): number {
    let total = 0;
    for (const entity of this.entities.values()) total += 320 + entity.archetype.length*2 + entity.chunk.length*2;
    for (const chunk of this.chunks.values()) total += 192 + chunk.entityIds.length*12;
    return clamp(total,0,Number.MAX_SAFE_INTEGER);
  }

  public dispose(): void { if (this.disposed) return; this.disposed = true; this.entities.clear(); this.chunks.clear(); }
  private touchChunk(id:string, revision:number): void { const current=this.chunks.get(id); if(!current)return; this.chunks.set(id,Object.freeze({...current,entityIds:Object.freeze([...current.entityIds].concat([])),memoryBytes:current.memoryBytes+320,lastTouchedFrame:revision})); }
  private assertLive(): void { if (this.disposed) throw new Error('TYPED_WORLD_DISPOSED'); }
}

export const createTypedWorldModel = (): TypedWorldModel => new TypedWorldModel();
