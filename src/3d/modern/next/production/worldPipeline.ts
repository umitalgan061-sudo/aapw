import { checksumP, distance2dSquaredP, integerP, normalizedIdP, type ActorStateP, type EventSinkP, type InterestLevel, type TransformStateP, type Vec3P, type WorldCommandP, type WorldEventP } from './contracts.ts';

export interface WorldPipelineConfigP { readonly maxActors: number; readonly cellSizeMeters: number; readonly maxEvents: number; readonly maxCommands: number; readonly despawnDistanceMeters: number; }
export interface WorldPipelineStatsP { readonly actors: number; readonly alive: number; readonly cells: number; readonly commands: number; readonly events: number; readonly droppedCommands: number; readonly droppedEvents: number; readonly checksum: number; }
export interface InterestSourceP { readonly id: string; readonly position: Vec3P; readonly radiusMeters: number; }
const DEFAULTS: WorldPipelineConfigP = Object.freeze({ maxActors: 4096, cellSizeMeters: 64, maxEvents: 4096, maxCommands: 2048, despawnDistanceMeters: 2500 });
const order: readonly InterestLevel[] = ['critical', 'near', 'normal', 'far', 'background'];
const levelForDistance = (distanceSq: number, radius: number): InterestLevel => distanceSq <= radius * radius * 0.08 ? 'critical' : distanceSq <= radius * radius * 0.3 ? 'near' : distanceSq <= radius * radius ? 'normal' : distanceSq <= radius * radius * 2.5 ? 'far' : 'background';

interface StoredActor { id: number; kind: ActorStateP['kind']; transform: TransformStateP; health: number; maxHealth: number; stamina: number; maxStamina: number; interest: InterestLevel; alive: boolean; interestScore: number; lastTick: number; }
interface Cell { ids: Set<number>; }

export class ProductionWorldPipeline {
  readonly config: WorldPipelineConfigP;
  readonly #actors = new Map<number, StoredActor>();
  readonly #cells = new Map<string, Cell>();
  readonly #commands: WorldCommandP[] = [];
  readonly #events: WorldEventP[] = [];
  readonly #eventSink?: EventSinkP;
  #droppedCommands = 0;
  #droppedEvents = 0;
  #revision = 0;
  #eventSequence = 0;

  constructor(config: Partial<WorldPipelineConfigP> = {}, eventSink?: EventSinkP) {
    this.config = Object.freeze({ maxActors: Math.max(32, integerP(config.maxActors ?? DEFAULTS.maxActors)), cellSizeMeters: Math.max(4, config.cellSizeMeters ?? DEFAULTS.cellSizeMeters), maxEvents: Math.max(64, integerP(config.maxEvents ?? DEFAULTS.maxEvents)), maxCommands: Math.max(32, integerP(config.maxCommands ?? DEFAULTS.maxCommands)), despawnDistanceMeters: Math.max(100, config.despawnDistanceMeters ?? DEFAULTS.despawnDistanceMeters) });
    this.#eventSink = eventSink;
  }

  spawn(actor: ActorStateP, tick = 0): boolean {
    const id = normalizedIdP(actor.id);
    if (this.#actors.has(id) || this.#actors.size >= this.config.maxActors) return false;
    const stored: StoredActor = { id, kind: actor.kind, transform: cloneTransform(actor.transform), health: actor.health, maxHealth: actor.maxHealth, stamina: actor.stamina, maxStamina: actor.maxStamina, interest: actor.interest, alive: actor.alive, lastTick: integerP(tick), interestScore: 0 };
    this.#actors.set(id, stored); this.#insertCell(stored); this.#revision += 1;
    this.emitEvent(tick, 'spawn', 'world', id, { kind: stored.kind });
    return true;
  }

  despawn(idValue: number, tick = 0, reason = 'requested'): boolean {
    const id = normalizedIdP(idValue); const actor = this.#actors.get(id); if (!actor) return false;
    this.#removeCell(actor); this.#actors.delete(id); this.#revision += 1; this.emitEvent(tick, 'despawn', 'world', id, { reason }); return true;
  }

  get(idValue: number): ActorStateP | undefined { const actor = this.#actors.get(normalizedIdP(idValue)); return actor ? cloneActor(actor) : undefined; }
  has(idValue: number): boolean { return this.#actors.has(normalizedIdP(idValue)); }
  count(): number { return this.#actors.size; }
  revision(): number { return this.#revision; }
  actors(): readonly ActorStateP[] { return Object.freeze([...this.#actors.values()].sort((a, b) => a.id - b.id).map(cloneActor)); }

  updateActor(idValue: number, patch: Partial<Omit<ActorStateP, 'id'>>, tick = 0): boolean {
    const id = normalizedIdP(idValue); const actor = this.#actors.get(id); if (!actor) return false;
    const previousPosition = { ...actor.transform.position };
    if (patch.kind !== undefined) actor.kind = patch.kind;
    if (patch.transform !== undefined) actor.transform = cloneTransform(patch.transform);
    if (patch.health !== undefined) actor.health = patch.health;
    if (patch.maxHealth !== undefined) actor.maxHealth = patch.maxHealth;
    if (patch.stamina !== undefined) actor.stamina = patch.stamina;
    if (patch.maxStamina !== undefined) actor.maxStamina = patch.maxStamina;
    if (patch.interest !== undefined) actor.interest = patch.interest;
    if (patch.alive !== undefined) actor.alive = patch.alive;
    actor.lastTick = integerP(tick);
    if (patch.transform?.position) { this.#removeCellAt(actor.id, previousPosition); this.#insertCell(actor); }
    this.#revision += 1; return true;
  }

  applyCommand(command: WorldCommandP): boolean {
    if (this.#commands.length >= this.config.maxCommands) { this.#commands.shift(); this.#droppedCommands += 1; }
    const normalized = Object.freeze({ ...command, actorId: normalizedIdP(command.actorId), tick: Math.max(0, integerP(command.tick)) });
    this.#commands.push(normalized); this.#eventSink?.emit('world:command', normalized); return true;
  }

  drainCommands(max = 256): readonly WorldCommandP[] { const count = Math.max(0, Math.min(this.#commands.length, integerP(max, 256))); return Object.freeze(this.#commands.splice(0, count)); }
  emitEvent(tick: number, kind: string, source: string, _entity: number | undefined, payload: unknown): void { if (this.#events.length >= this.config.maxEvents) { this.#events.shift(); this.#droppedEvents += 1; } const event: WorldEventP = Object.freeze({ tick: Math.max(0, integerP(tick)), sequence: ++this.#eventSequence, kind: String(kind).slice(0, 80), source: String(source).slice(0, 80), payload: sanitizePayload(payload) }); this.#events.push(event); this.#eventSink?.emit('world:event', event); }
  drainEvents(max = 256): readonly WorldEventP[] { const count = Math.max(0, Math.min(this.#events.length, integerP(max, 256))); return Object.freeze(this.#events.splice(0, count)); }

  queryRadius(origin: Vec3P, radiusMeters: number, level?: InterestLevel): readonly ActorStateP[] {
    const radius = Math.max(0, radiusMeters); const radiusSq = radius * radius; const candidates = this.#queryCells(origin.x, origin.z, radius); const result: ActorStateP[] = [];
    for (const id of candidates) { const actor = this.#actors.get(id); if (!actor) continue; const distanceSq = distance2dSquaredP(origin, actor.transform.position); if (distanceSq > radiusSq) continue; if (level && actor.interest !== level) continue; result.push(cloneActor(actor)); }
    result.sort((a, b) => distance2dSquaredP(a.transform.position, origin) - distance2dSquaredP(b.transform.position, origin) || a.id - b.id); return Object.freeze(result);
  }

  updateInterests(sources: readonly InterestSourceP[], tick = 0): number {
    let changed = 0;
    for (const actor of this.#actors.values()) { let bestScore = 0; let bestLevel: InterestLevel = 'background'; for (const source of sources) { const distanceSq = distance2dSquaredP(actor.transform.position, source.position); const level = levelForDistance(distanceSq, Math.max(1, source.radiusMeters)); const score = 1 - Math.min(1, distanceSq / Math.max(1, source.radiusMeters * source.radiusMeters)); if (score > bestScore || score === bestScore && order.indexOf(level) < order.indexOf(bestLevel)) { bestScore = score; bestLevel = level; } } if (actor.interest !== bestLevel || Math.abs(actor.interestScore - bestScore) > 0.001) { actor.interest = bestLevel; actor.interestScore = Math.max(0, bestScore); changed += 1; } actor.lastTick = integerP(tick); }
    return changed;
  }

  cullBeyond(origin: Vec3P, tick = 0): number { const radiusSq = this.config.despawnDistanceMeters ** 2; const doomed = [...this.#actors.values()].filter(actor => distance2dSquaredP(origin, actor.transform.position) > radiusSq).sort((a, b) => a.id - b.id); let removed = 0; for (const actor of doomed) if (this.despawn(actor.id, tick, 'distance')) removed += 1; return removed; }
  snapshot(): readonly ActorStateP[] { return this.actors(); }
  digest(): number { return checksumP({ revision: this.#revision, actors: this.actors() }); }
  stats(): WorldPipelineStatsP { const actors = this.#actors.size; const alive = [...this.#actors.values()].filter(actor => actor.alive).length; return Object.freeze({ actors, alive, cells: this.#cells.size, commands: this.#commands.length, events: this.#events.length, droppedCommands: this.#droppedCommands, droppedEvents: this.#droppedEvents, checksum: this.digest() }); }
  #cellKey(x: number, z: number): string { return `${Math.floor(x / this.config.cellSizeMeters)}:${Math.floor(z / this.config.cellSizeMeters)}`; }
  #insertCell(actor: StoredActor): void { const key = this.#cellKey(actor.transform.position.x, actor.transform.position.z); const cell = this.#cells.get(key) ?? { ids: new Set<number>() }; cell.ids.add(actor.id); this.#cells.set(key, cell); }
  #removeCell(actor: StoredActor): void { this.#removeCellAt(actor.id, actor.transform.position); }
  #removeCellAt(id: number, position: Vec3P): void { const key = this.#cellKey(position.x, position.z); const cell = this.#cells.get(key); if (!cell) return; cell.ids.delete(id); if (!cell.ids.size) this.#cells.delete(key); }
  #queryCells(x: number, z: number, radius: number): number[] { const minX = Math.floor((x - radius) / this.config.cellSizeMeters); const maxX = Math.floor((x + radius) / this.config.cellSizeMeters); const minZ = Math.floor((z - radius) / this.config.cellSizeMeters); const maxZ = Math.floor((z + radius) / this.config.cellSizeMeters); const ids = new Set<number>(); for (let cx = minX; cx <= maxX; cx += 1) for (let cz = minZ; cz <= maxZ; cz += 1) for (const id of this.#cells.get(`${cx}:${cz}`)?.ids ?? []) ids.add(id); return [...ids].sort((a, b) => a - b); }
}

function cloneTransform(value: TransformStateP): TransformStateP { return { position: { ...value.position }, velocity: { ...value.velocity }, yaw: value.yaw, flags: value.flags }; }
function cloneActor(value: StoredActor): ActorStateP { return { id: value.id, kind: value.kind, transform: cloneTransform(value.transform), health: value.health, maxHealth: value.maxHealth, stamina: value.stamina, maxStamina: value.maxStamina, interest: value.interest, alive: value.alive }; }
function sanitizePayload(value: unknown, depth = 0): unknown { if (depth > 4) return '[depth-limit]'; if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value; if (Array.isArray(value)) return value.slice(0, 64).map(item => sanitizePayload(item, depth + 1)); if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 64).map(([key, child]) => [key.slice(0, 80), sanitizePayload(child, depth + 1)])); return String(value); }
