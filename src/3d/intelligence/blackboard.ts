import type { ActorId, FactionId, MemoryId, MemoryRecord, GoalInstance, TickNumber } from './types.js';
import { safeId } from './types.js';

type BlackboardValue = string | number | boolean | null | readonly string[] | readonly number[] | readonly boolean[];
export interface BlackboardEntry<T extends BlackboardValue = BlackboardValue> {
  readonly key: string;
  readonly value: T;
  readonly updatedTick: TickNumber;
  readonly source: string;
  readonly confidence: number;
  readonly expiresTick?: TickNumber;
}
export interface BlackboardSnapshot {
  readonly actorId: ActorId;
  readonly revision: number;
  readonly entries: readonly BlackboardEntry[];
}
export interface MemoryFilter {
  readonly kind?: MemoryRecord['kind'];
  readonly subjectId?: ActorId;
  readonly minConfidence?: number;
  readonly maxAgeTicks?: number;
  readonly tags?: readonly string[];
  readonly center?: { readonly x:number; readonly y:number; readonly z:number };
  readonly radius?: number;
  readonly limit?: number;
}

const cloneEntry = <T extends BlackboardValue>(entry: BlackboardEntry<T>): BlackboardEntry<T> => Object.freeze({ ...entry, value: Array.isArray(entry.value) ? Object.freeze([...entry.value]) : entry.value });
const confidence = (value: number): number => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export class ActorBlackboard {
  readonly #actorId: ActorId;
  readonly #entries = new Map<string, BlackboardEntry>();
  #revision = 0;
  #disposed = false;

  constructor(actorId: ActorId | string) { this.#actorId = safeId<ActorId>(String(actorId), 'ActorId'); }
  get actorId(): ActorId { return this.#actorId; }
  get revision(): number { return this.#revision; }
  get disposed(): boolean { return this.#disposed; }

  set<T extends BlackboardValue>(key: string, value: T, tick: TickNumber, source: string, options: { confidence?: number; expiresTick?: TickNumber } = {}): boolean {
    if (this.#disposed || !key.trim() || !source.trim()) return false;
    const next: BlackboardEntry<T> = Object.freeze({ key, value: Array.isArray(value) ? Object.freeze([...value]) as T : value, updatedTick: tick, source, confidence: confidence(options.confidence ?? 1), ...(options.expiresTick === undefined ? {} : { expiresTick: options.expiresTick }) });
    const prior = this.#entries.get(key);
    if (prior && prior.updatedTick > tick) return false;
    if (prior && Object.is(prior.value, next.value) && prior.updatedTick === next.updatedTick && prior.source === next.source) return false;
    this.#entries.set(key, next);
    this.#revision += 1;
    return true;
  }

  get<T extends BlackboardValue = BlackboardValue>(key: string, tick?: TickNumber): T | undefined {
    if (this.#disposed) return undefined;
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (tick !== undefined && entry.expiresTick !== undefined && tick > entry.expiresTick) { this.#entries.delete(key); this.#revision += 1; return undefined; }
    return entry.value as T;
  }

  getEntry(key: string, tick?: TickNumber): BlackboardEntry | undefined {
    this.get(key, tick);
    return this.#entries.get(key);
  }

  has(key: string, tick?: TickNumber): boolean { return this.getEntry(key, tick) !== undefined; }
  delete(key: string): boolean { if (this.#disposed) return false; const removed = this.#entries.delete(key); if (removed) this.#revision += 1; return removed; }
  clear(): void { if (this.#disposed) return; if (this.#entries.size) this.#revision += 1; this.#entries.clear(); }

  prune(tick: TickNumber): number {
    if (this.#disposed) return 0;
    let removed = 0;
    for (const [key, entry] of this.#entries) if (entry.expiresTick !== undefined && tick > entry.expiresTick) { this.#entries.delete(key); removed += 1; }
    if (removed) this.#revision += 1;
    return removed;
  }

  snapshot(): BlackboardSnapshot {
    return Object.freeze({ actorId: this.#actorId, revision: this.#revision, entries: Object.freeze([...this.#entries.values()].map(cloneEntry).sort((a,b)=>a.key.localeCompare(b.key))) });
  }

  restore(snapshot: BlackboardSnapshot): void {
    if (this.#disposed) return;
    this.#entries.clear();
    for (const entry of snapshot.entries) this.#entries.set(entry.key, cloneEntry(entry));
    this.#revision = Math.max(0, Math.floor(snapshot.revision));
  }

  dispose(): void { this.#disposed = true; this.#entries.clear(); this.#revision += 1; }
}

export class MemoryStore {
  readonly #byId = new Map<MemoryId, MemoryRecord>();
  readonly #byActor = new Map<ActorId, Set<MemoryId>>();
  readonly #maxRecords: number;
  #disposed = false;

  constructor(maxRecords = 256) { this.#maxRecords = Math.max(1, Math.floor(maxRecords)); }

  upsert(memory: MemoryRecord): boolean {
    if (this.#disposed || !memory.id) return false;
    const prior = this.#byId.get(memory.id);
    if (prior && prior.lastObservedTick > memory.lastObservedTick) return false;
    this.#byId.set(memory.id, Object.freeze({ ...memory, confidence: confidence(memory.confidence), tags: Object.freeze([...memory.tags]) }));
    if (memory.subjectId) { let set = this.#byActor.get(memory.subjectId); if (!set) { set = new Set(); this.#byActor.set(memory.subjectId, set); } set.add(memory.id); }
    this.#trim();
    return !prior || prior.lastObservedTick !== memory.lastObservedTick || prior.confidence !== memory.confidence;
  }

  rememberMany(memories: readonly MemoryRecord[]): number { return memories.reduce((n, m) => n + (this.upsert(m) ? 1 : 0), 0); }
  get(id: MemoryId): MemoryRecord | undefined { return this.#byId.get(id); }

  query(filter: MemoryFilter = {}, nowTick?: TickNumber): readonly MemoryRecord[] {
    let values = [...this.#byId.values()];
    if (filter.kind) values = values.filter(m=>m.kind===filter.kind);
    if (filter.subjectId) values = values.filter(m=>m.subjectId===filter.subjectId);
    if (filter.minConfidence !== undefined) values = values.filter(m=>m.confidence>=filter.minConfidence!);
    if (filter.maxAgeTicks !== undefined && nowTick !== undefined) values = values.filter(m=>Number(nowTick)-Number(m.lastObservedTick)<=filter.maxAgeTicks!);
    if (filter.tags?.length) values = values.filter(m=>filter.tags!.every(tag=>m.tags.includes(tag)));
    if (filter.center && filter.radius !== undefined) { const r2=filter.radius*filter.radius; values=values.filter(m=>((m.position.x-filter.center!.x)**2+(m.position.y-filter.center!.y)**2+(m.position.z-filter.center!.z)**2)<=r2); }
    values.sort((a,b)=>Number(b.lastObservedTick)-Number(a.lastObservedTick)||b.confidence-a.confidence||String(a.id).localeCompare(String(b.id)));
    return filter.limit === undefined ? values : values.slice(0, Math.max(0, Math.floor(filter.limit)));
  }

  decay(nowTick: TickNumber): number {
    if (this.#disposed) return 0;
    let changed=0;
    for (const [id,m] of this.#byId) {
      const age=Math.max(0, Number(nowTick)-Number(m.lastObservedTick));
      const halfLife=Math.max(1,memoryHalfLife(m.decayPerTick));
      const nextConfidence=m.confidence*Math.pow(0.5, age/halfLife);
      if (nextConfidence < 0.01) { this.remove(id); changed+=1; continue; }
      if (Math.abs(nextConfidence-m.confidence)>0.0001) { this.#byId.set(id,Object.freeze({ ...m, confidence:nextConfidence })); changed+=1; }
    }
    return changed;
  }

  remove(id: MemoryId): boolean {
    const prior=this.#byId.get(id); if(!prior) return false;
    this.#byId.delete(id); if(prior.subjectId) { const set=this.#byActor.get(prior.subjectId); set?.delete(id); if(set?.size===0)this.#byActor.delete(prior.subjectId); }
    return true;
  }

  clear(): void { this.#byId.clear(); this.#byActor.clear(); }
  get size(): number { return this.#byId.size; }
  values(): readonly MemoryRecord[] { return [...this.#byId.values()]; }
  dispose(): void { this.#disposed=true; this.clear(); }

  #trim(): void {
    while(this.#byId.size>this.#maxRecords){ const oldest=[...this.#byId.values()].sort((a,b)=>Number(a.lastObservedTick)-Number(b.lastObservedTick)||a.confidence-b.confidence||String(a.id).localeCompare(String(b.id)))[0]; if(!oldest)break; this.remove(oldest.id); }
  }
}

function memoryHalfLife(decayPerTick:number): number { if(!Number.isFinite(decayPerTick)||decayPerTick<=0)return 32; return Math.max(1,1/decayPerTick); }

export interface GoalLedgerSnapshot { readonly actorId: ActorId; readonly goals: readonly GoalInstance[]; }
export class GoalLedger {
  readonly #actorId: ActorId;
  readonly #goals = new Map<string, GoalInstance>();
  readonly #maxGoals: number;
  constructor(actorId: ActorId|string,maxGoals=16){this.#actorId=safeId<ActorId>(String(actorId),'ActorId');this.#maxGoals=Math.max(1,Math.floor(maxGoals));}
  add(goal:GoalInstance):boolean{if(goal.actorId!==this.#actorId||this.#goals.has(goal.id))return false;this.#goals.set(goal.id,Object.freeze({...goal}));this.#trim();return true;}
  upsert(goal:GoalInstance):void{if(goal.actorId!==this.#actorId)return;this.#goals.set(goal.id,Object.freeze({...goal}));this.#trim();}
  get(id:string):GoalInstance|undefined{return this.#goals.get(id);}
  remove(id:string):boolean{return this.#goals.delete(id);}
  values():readonly GoalInstance[]{return [...this.#goals.values()].sort((a,b)=>b.definition.priority-a.definition.priority||a.id.localeCompare(b.id));}
  active(tick:TickNumber):readonly GoalInstance[]{return this.values().filter(g=>Number(tick)<=Number(g.deadlineTick)&&!g.blocked);}
  snapshot():GoalLedgerSnapshot{return Object.freeze({actorId:this.#actorId,goals:Object.freeze(this.values())});}
  restore(s:GoalLedgerSnapshot):void{this.#goals.clear();for(const g of s.goals)this.#goals.set(g.id,Object.freeze({...g}));this.#trim();}
  #trim():void{while(this.#goals.size>this.#maxGoals){const drop=this.values().at(-1);if(!drop)break;this.#goals.delete(drop.id);}}
}

export interface RelationshipLedger { readonly actorId: ActorId; readonly values: Readonly<Record<string, 'ally'|'friendly'|'neutral'|'suspicious'|'hostile'|'fearful'>>; }
export function setRelationship(ledger:RelationshipLedger, faction:FactionId, relation:RelationshipLedger['values'][string]):RelationshipLedger{return Object.freeze({actorId:ledger.actorId,values:Object.freeze({...ledger.values,[faction]:relation})});}
export function getRelationship(ledger:RelationshipLedger,faction:FactionId):RelationshipLedger['values'][string]{return ledger.values[faction]??'neutral';}
export function relationshipScore(value:RelationshipLedger['values'][string]):number{return ({ally:1,friendly:0.6,neutral:0,suspicious:-0.25,hostile:-0.8,fearful:-0.4})[value];}

export interface BlackboardMergeConflict { readonly key:string; readonly local:BlackboardEntry; readonly remote:BlackboardEntry; readonly winner:'local'|'remote'; }
export function mergeBlackboards(local:BlackboardSnapshot,remote:BlackboardSnapshot):{snapshot:BlackboardSnapshot;conflicts:readonly BlackboardMergeConflict[]}{
  const map=new Map(local.entries.map(e=>[e.key,e]));const conflicts:BlackboardMergeConflict[]=[];
  for(const entry of remote.entries){const current=map.get(entry.key);if(!current){map.set(entry.key,entry);continue;}const remoteWins=Number(entry.updatedTick)>Number(current.updatedTick)||(Number(entry.updatedTick)===Number(current.updatedTick)&&entry.confidence>current.confidence)||(Number(entry.updatedTick)===Number(current.updatedTick)&&entry.confidence===current.confidence&&entry.source.localeCompare(current.source)<0);if(remoteWins)map.set(entry.key,entry);conflicts.push({key:entry.key,local:current,remote:entry,winner:remoteWins?'remote':'local'});}
  return {snapshot:Object.freeze({actorId:local.actorId,revision:Math.max(local.revision,remote.revision)+1,entries:Object.freeze([...map.values()].sort((a,b)=>a.key.localeCompare(b.key)))}),conflicts:Object.freeze(conflicts)};
}
