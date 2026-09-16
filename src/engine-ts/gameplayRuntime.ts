import type { Disposable, EntityId, Result, RuntimeErrorInfo, Vec3 } from './coreTypes.js';
import { clamp, err, ok, stableSort } from './coreTypes.js';

export type ActorState = 'idle' | 'moving' | 'sprinting' | 'jumping' | 'falling' | 'stunned' | 'dead';
export type Stance = 'standing' | 'crouched' | 'prone';
export type InteractionType = 'talk' | 'trade' | 'inspect' | 'loot' | 'enter' | 'use';

export interface ActorRuntime {
  readonly id: EntityId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly state: ActorState;
  readonly stance: Stance;
  readonly health: number;
  readonly stamina: number;
  readonly maxHealth: number;
  readonly maxStamina: number;
  readonly inventory: readonly string[];
  readonly faction: string;
  readonly target: EntityId | null;
  readonly interaction: InteractionState | null;
}

export interface InteractionState {
  readonly type: InteractionType;
  readonly target: EntityId;
  readonly progress: number;
  readonly startedTick: number;
  readonly durationTicks: number;
}

export interface GameplayCommand {
  readonly type: 'move' | 'look' | 'sprint' | 'jump' | 'attack' | 'interact' | 'equip' | 'use';
  readonly actor: EntityId;
  readonly vector?: Vec3;
  readonly value?: number;
  readonly target?: EntityId;
  readonly item?: string;
}

export interface GameplayEvent {
  readonly type: 'damage' | 'death' | 'state' | 'inventory' | 'interaction' | 'stamina';
  readonly actor: EntityId;
  readonly target?: EntityId;
  readonly amount?: number;
  readonly detail: string;
  readonly tick: number;
}

export interface GameplayTuning {
  readonly walkSpeed: number;
  readonly sprintSpeed: number;
  readonly acceleration: number;
  readonly damping: number;
  readonly jumpVelocity: number;
  readonly gravity: number;
  readonly staminaRegen: number;
  readonly sprintCost: number;
  readonly interactionRange: number;
}

export interface GameplayStats {
  readonly actors: number;
  readonly alive: number;
  readonly sprinting: number;
  readonly interactions: number;
  readonly commands: number;
  readonly events: number;
}

const DEFAULT_TUNING: GameplayTuning = Object.freeze({
  walkSpeed: 4.5,
  sprintSpeed: 8,
  acceleration: 24,
  damping: 12,
  jumpVelocity: 7,
  gravity: 20,
  staminaRegen: 18,
  sprintCost: 22,
  interactionRange: 3.25,
});

function finite(value: number, fallback = 0): number { return Number.isFinite(value) ? value : fallback; }
function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  if (current > target) return Math.max(target, current - maxDelta);
  return current;
}
function normalize(v: Vec3): Vec3 {
  const magnitude = Math.hypot(v.x, v.y, v.z);
  if (magnitude < Number.EPSILON) return Object.freeze({ x: 0, y: 0, z: 0 });
  return Object.freeze({ x: v.x / magnitude, y: v.y / magnitude, z: v.z / magnitude });
}
function gameplayError(code: string, message: string): RuntimeErrorInfo { return { code, message, recoverable: true }; }

export class GameplayRuntime implements Disposable {
  readonly tuning: GameplayTuning;
  #actors = new Map<EntityId, ActorRuntime>();
  #events: GameplayEvent[] = [];
  #tick = 0;
  #commands = 0;
  #disposed = false;

  constructor(tuning: Partial<GameplayTuning> = {}) {
    this.tuning = Object.freeze({ ...DEFAULT_TUNING, ...tuning });
  }

  spawnActor(actor: Omit<ActorRuntime, 'state' | 'stance' | 'target' | 'interaction'> & Partial<Pick<ActorRuntime, 'state' | 'stance' | 'target' | 'interaction'>>): Result<ActorRuntime> {
    if (this.#disposed) return err(gameplayError('GAMEPLAY_DISPOSED', 'Gameplay runtime is disposed.'));
    if (this.#actors.has(actor.id)) return err(gameplayError('ACTOR_EXISTS', 'Actor already exists.'));
    const normalized: ActorRuntime = Object.freeze({
      ...actor,
      position: Object.freeze({ ...actor.position }),
      velocity: Object.freeze({ ...actor.velocity }),
      state: actor.state ?? 'idle',
      stance: actor.stance ?? 'standing',
      health: clamp(finite(actor.health), 0, Math.max(0, actor.maxHealth)),
      stamina: clamp(finite(actor.stamina), 0, Math.max(0, actor.maxStamina)),
      inventory: Object.freeze([...actor.inventory]),
      target: actor.target ?? null,
      interaction: actor.interaction ?? null,
    });
    this.#actors.set(actor.id, normalized);
    return ok(normalized);
  }

  removeActor(id: EntityId): boolean { return this.#actors.delete(id); }

  dispatch(command: GameplayCommand): Result<void> {
    if (this.#disposed) return err(gameplayError('GAMEPLAY_DISPOSED', 'Gameplay runtime is disposed.'));
    const actor = this.#actors.get(command.actor);
    if (!actor) return err(gameplayError('ACTOR_UNKNOWN', 'Actor is not registered.'));
    this.#commands += 1;
    switch (command.type) {
      case 'move': this.#move(actor, command.vector ?? { x: 0, y: 0, z: 0 }); break;
      case 'look': break;
      case 'sprint': this.#sprint(actor, (command.value ?? 0) > 0.5); break;
      case 'jump': this.#jump(actor); break;
      case 'attack': this.#attack(actor, command.target); break;
      case 'interact': this.#interact(actor, command.target, command.value ?? 0); break;
      case 'equip': this.#equip(actor, command.item); break;
      case 'use': this.#use(actor, command.item); break;
      default: return err(gameplayError('COMMAND_UNSUPPORTED', 'Unsupported gameplay command.'));
    }
    return ok(undefined);
  }

  update(deltaSeconds: number, tick = this.#tick + 1): readonly GameplayEvent[] {
    if (this.#disposed) return [];
    this.#tick = Math.max(this.#tick, Math.trunc(tick));
    const dt = clamp(finite(deltaSeconds), 0, 0.1);
    const events: GameplayEvent[] = [];
    for (const actor of stableSort([...this.#actors.values()], (a, b) => String(a.id).localeCompare(String(b.id)))) {
      if (actor.state === 'dead') continue;
      let velocity = { ...actor.velocity };
      let position = { ...actor.position };
      if (actor.state === 'falling' || actor.state === 'jumping') velocity = { ...velocity, y: velocity.y - this.tuning.gravity * dt };
      if (Math.abs(velocity.y) < 0.05 && position.y <= 0.01 && actor.state !== 'idle') velocity = { ...velocity, y: 0 };
      position = { x: position.x + velocity.x * dt, y: Math.max(0, position.y + velocity.y * dt), z: position.z + velocity.z * dt };
      const horizontal = Math.hypot(velocity.x, velocity.z);
      const stamina = actor.state === 'sprinting' ? Math.max(0, actor.stamina - this.tuning.sprintCost * dt) : Math.min(actor.maxStamina, actor.stamina + this.tuning.staminaRegen * dt);
      const nextState: ActorState = position.y > 0.02 ? (velocity.y > 0 ? 'jumping' : 'falling') : horizontal > 0.1 ? (actor.state === 'sprinting' ? 'sprinting' : 'moving') : 'idle';
      const next: ActorRuntime = Object.freeze({ ...actor, position: Object.freeze(position), velocity: Object.freeze(velocity), stamina, state: stamina <= 0 && actor.state === 'sprinting' ? 'moving' : nextState });
      this.#actors.set(actor.id, next);
      if (next.state !== actor.state) events.push(this.#emit({ type: 'state', actor: actor.id, detail: `${actor.state}->${next.state}`, tick: this.#tick }));
      if (stamina <= 0 && actor.state === 'sprinting') events.push(this.#emit({ type: 'stamina', actor: actor.id, amount: stamina, detail: 'exhausted', tick: this.#tick }));
    }
    this.#events.push(...events);
    if (this.#events.length > 2048) this.#events.splice(0, this.#events.length - 2048);
    return Object.freeze(events);
  }

  applyDamage(target: EntityId, amount: number, source: EntityId | null = null): Result<void> {
    const actor = this.#actors.get(target);
    if (!actor) return err(gameplayError('ACTOR_UNKNOWN', 'Damage target is not registered.'));
    const damage = Math.max(0, finite(amount));
    const health = Math.max(0, actor.health - damage);
    const dead = health <= 0;
    const next: ActorRuntime = Object.freeze({ ...actor, health, state: dead ? 'dead' : actor.state });
    this.#actors.set(target, next);
    this.#emit({ type: 'damage', actor: target, target: source ?? undefined, amount: damage, detail: dead ? 'fatal' : 'hit', tick: this.#tick });
    if (dead) this.#emit({ type: 'death', actor: target, target: source ?? undefined, detail: 'actor-dead', tick: this.#tick });
    return ok(undefined);
  }

  actor(id: EntityId): ActorRuntime | undefined { return this.#actors.get(id); }
  actors(): readonly ActorRuntime[] { return Object.freeze(stableSort([...this.#actors.values()], (a, b) => String(a.id).localeCompare(String(b.id)))); }
  events(): readonly GameplayEvent[] { return Object.freeze(this.#events.slice()); }
  stats(): GameplayStats {
    let alive = 0; let sprinting = 0; let interactions = 0;
    for (const actor of this.#actors.values()) {
      if (actor.state !== 'dead') alive += 1;
      if (actor.state === 'sprinting') sprinting += 1;
      if (actor.interaction) interactions += 1;
    }
    return Object.freeze({ actors: this.#actors.size, alive, sprinting, interactions, commands: this.#commands, events: this.#events.length });
  }

  clearEvents(): void { this.#events.length = 0; }
  dispose(): void { this.#disposed = true; this.#actors.clear(); this.#events.length = 0; }

  #move(actor: ActorRuntime, vector: Vec3): void {
    if (actor.state === 'dead' || actor.state === 'stunned') return;
    const direction = normalize({ x: vector.x, y: 0, z: vector.z });
    const speed = actor.state === 'sprinting' ? this.tuning.sprintSpeed : this.tuning.walkSpeed;
    const targetX = direction.x * speed;
    const targetZ = direction.z * speed;
    const next: ActorRuntime = Object.freeze({ ...actor, velocity: Object.freeze({ ...actor.velocity, x: approach(actor.velocity.x, targetX, this.tuning.acceleration / 60), z: approach(actor.velocity.z, targetZ, this.tuning.acceleration / 60) }) });
    this.#actors.set(actor.id, next);
  }

  #sprint(actor: ActorRuntime, enabled: boolean): void {
    if (actor.state === 'dead' || actor.stance !== 'standing' || actor.stamina <= 0) return;
    const nextState = enabled ? 'sprinting' : 'moving';
    this.#actors.set(actor.id, Object.freeze({ ...actor, state: nextState }));
  }

  #jump(actor: ActorRuntime): void {
    if (actor.state === 'dead' || actor.position.y > 0.02) return;
    this.#actors.set(actor.id, Object.freeze({ ...actor, state: 'jumping', velocity: Object.freeze({ ...actor.velocity, y: this.tuning.jumpVelocity }) }));
  }

  #attack(actor: ActorRuntime, target: EntityId | undefined): void {
    if (target === undefined || !this.#actors.has(target)) return;
    const victim = this.#actors.get(target)!;
    if (distance(actor.position, victim.position) <= this.tuning.interactionRange * 1.8) void this.applyDamage(target, 10, actor.id);
  }

  #interact(actor: ActorRuntime, target: EntityId | undefined, progress: number): void {
    if (target === undefined) return;
    const other = this.#actors.get(target);
    if (!other || distance(actor.position, other.position) > this.tuning.interactionRange) return;
    const interaction: InteractionState = Object.freeze({ type: 'talk', target, progress: clamp(progress, 0, 1), startedTick: this.#tick, durationTicks: 30 });
    this.#actors.set(actor.id, Object.freeze({ ...actor, target, interaction }));
    this.#emit({ type: 'interaction', actor: actor.id, target, amount: interaction.progress, detail: 'started', tick: this.#tick });
  }

  #equip(actor: ActorRuntime, item: string | undefined): void {
    if (!item || !actor.inventory.includes(item)) return;
    this.#emit({ type: 'inventory', actor: actor.id, detail: `equipped:${item}`, tick: this.#tick });
  }

  #use(actor: ActorRuntime, item: string | undefined): void {
    if (!item || !actor.inventory.includes(item)) return;
    this.#emit({ type: 'inventory', actor: actor.id, detail: `used:${item}`, tick: this.#tick });
  }

  #emit(event: GameplayEvent): GameplayEvent { const normalized = Object.freeze({ ...event }); this.#events.push(normalized); return normalized; }
}
