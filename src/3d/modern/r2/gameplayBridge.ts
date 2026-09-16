import type { EntityId } from './simulationKernel.ts';
import { DeterministicTimeline, type SimulationContext } from './simulationKernel.ts';
import { EcsWorld, TransformSchema, VelocitySchema, type ComponentSchema } from './ecsRuntime.ts';
import { ObservabilityHub } from './observabilityHub.ts';
import { WorldQueryRuntime, projectToGround, type HeightSampler, type Vec3Like } from './worldQueryRuntime.ts';

export interface GameplayTagComponent { readonly tags: readonly string[]; }
export interface HealthComponent { current: number; maximum: number; }
export interface TeamComponent { readonly team: string; }
export interface ActorStateComponent { state: 'idle' | 'moving' | 'combat' | 'dead'; stateTick: number; }

export const GameplayTagSchema: ComponentSchema<GameplayTagComponent> = {
  type: 'gameplay.tags',
  version: 1,
  create: () => ({ tags: [] }),
  clone: (value) => ({ tags: [...value.tags] }),
  validate: (value) => Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string' && tag.length <= 48),
};

export const HealthSchema: ComponentSchema<HealthComponent> = {
  type: 'gameplay.health',
  version: 1,
  create: () => ({ current: 100, maximum: 100 }),
  clone: (value) => ({ current: value.current, maximum: value.maximum }),
  validate: (value) => Number.isFinite(value.current) && Number.isFinite(value.maximum) && value.maximum > 0 && value.current >= 0 && value.current <= value.maximum,
};

export const TeamSchema: ComponentSchema<TeamComponent> = {
  type: 'gameplay.team',
  version: 1,
  create: () => ({ team: 'neutral' }),
  clone: (value) => ({ team: value.team }),
  validate: (value) => /^[A-Za-z0-9_.:-]{1,48}$/.test(value.team),
};

export const ActorStateSchema: ComponentSchema<ActorStateComponent> = {
  type: 'gameplay.actor-state',
  version: 1,
  create: () => ({ state: 'idle', stateTick: 0 }),
  clone: (value) => ({ state: value.state, stateTick: value.stateTick }),
  validate: (value) => ['idle', 'moving', 'combat', 'dead'].includes(value.state) && Number.isInteger(value.stateTick) && value.stateTick >= 0,
};

export interface GameplayActorDefinition {
  readonly team?: string;
  readonly tags?: readonly string[];
  readonly health?: number;
  readonly position?: Vec3Like;
  readonly velocity?: Vec3Like;
}

export interface GameplayEvent {
  readonly type: 'damage' | 'heal' | 'state' | 'teleport' | 'despawn';
  readonly entity: EntityId;
  readonly tick: number;
  readonly amount?: number;
  readonly state?: ActorStateComponent['state'];
  readonly position?: Vec3Like;
}

export interface GameplayFrameReport {
  readonly tick: number;
  readonly entities: number;
  readonly events: readonly GameplayEvent[];
  readonly groundedActors: number;
  readonly deadActors: number;
  readonly digest: string;
}

export class GameplayBridge {
  readonly #world: EcsWorld;
  readonly #observability: ObservabilityHub;
  readonly #queries = new WorldQueryRuntime<EntityId>(32);
  readonly #heightSampler?: HeightSampler;
  readonly #timeline = new DeterministicTimeline<GameplayEvent>();
  readonly #events: GameplayEvent[] = [];
  readonly #grounded = new Set<EntityId>();
  readonly #queryIndex = new Map<EntityId, number>();

  public constructor(world: EcsWorld, observability: ObservabilityHub, heightSampler?: HeightSampler) {
    this.#world = world;
    this.#observability = observability;
    this.#heightSampler = heightSampler;
    this.#ensureSchemas();
  }

  public createActor(definition: GameplayActorDefinition = {}): EntityId {
    const entity = this.#world.createEntity();
    const position = definition.position ?? { x: 0, y: 0, z: 0 };
    const velocity = definition.velocity ?? { x: 0, y: 0, z: 0 };
    this.#world.add(entity, TransformSchema, { x: position.x, y: position.y, z: position.z, yaw: 0 });
    this.#world.add(entity, VelocitySchema, { x: velocity.x, y: velocity.y, z: velocity.z });
    this.#world.add(entity, GameplayTagSchema, { tags: [...(definition.tags ?? [])] });
    this.#world.add(entity, HealthSchema, { current: definition.health ?? 100, maximum: definition.health ?? 100 });
    this.#world.add(entity, TeamSchema, { team: definition.team ?? 'neutral' });
    this.#world.add(entity, ActorStateSchema, { state: 'idle', stateTick: 0 });
    const queryId = this.#queries.insert(entity, position, 'actor', 0.5);
    this.#queryIndex.set(entity, queryId);
    this.#observability.increment('gameplay.actor.created');
    return entity;
  }

  public damage(entity: EntityId, amount: number, tick: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('damage amount must be non-negative');
    const health = this.#world.get(entity, HealthSchema.type);
    if (!health) return;
    health.current = Math.max(0, health.current - amount);
    this.#timeline.schedule(tick, 'damage', { type: 'damage', entity, tick, amount });
    if (health.current <= 0) this.setState(entity, 'dead', tick);
    else this.setState(entity, 'combat', tick);
  }

  public heal(entity: EntityId, amount: number, tick: number): void {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('heal amount must be non-negative');
    const health = this.#world.get(entity, HealthSchema.type);
    if (!health || health.current <= 0) return;
    const applied = Math.min(amount, health.maximum - health.current);
    health.current += applied;
    if (applied > 0) this.#timeline.schedule(tick, 'heal', { type: 'heal', entity, tick, amount: applied });
  }

  public setState(entity: EntityId, state: ActorStateComponent['state'], tick: number): void {
    const actor = this.#world.get(entity, ActorStateSchema.type);
    if (!actor) return;
    if (actor.state === state && actor.stateTick === tick) return;
    actor.state = state;
    actor.stateTick = tick;
    this.#timeline.schedule(tick, 'state', { type: 'state', entity, tick, state });
  }

  public teleport(entity: EntityId, position: Vec3Like, tick: number): void {
    const transform = this.#world.get(entity, TransformSchema.type);
    if (!transform) return;
    const resolved = this.#heightSampler ? projectToGround(position, this.#heightSampler, 0.02).output : position;
    transform.x = resolved.x;
    transform.y = resolved.y;
    transform.z = resolved.z;
    const queryId = this.#queryIndex.get(entity);
    if (queryId) this.#queries.update(queryId, resolved);
    this.#timeline.schedule(tick, 'teleport', { type: 'teleport', entity, tick, position: { ...resolved } });
  }

  public despawn(entity: EntityId, tick: number): void {
    if (!this.#world.isAlive(entity)) return;
    const queryId = this.#queryIndex.get(entity);
    if (queryId) this.#queries.remove(queryId);
    this.#queryIndex.delete(entity);
    this.#grounded.delete(entity);
    this.#world.destroyEntity(entity);
    this.#timeline.schedule(tick, 'despawn', { type: 'despawn', entity, tick });
  }

  public update(context: SimulationContext): GameplayFrameReport {
    this.#events.length = 0;
    const actors = this.#world.query({ all: [TransformSchema.type, VelocitySchema.type, HealthSchema.type, ActorStateSchema.type] });
    for (const entity of actors) this.#updateActor(entity, context);
    for (const event of this.#timeline.drainThrough(context.tick)) {
      this.#events.push(event.payload);
      this.#observability.increment(`gameplay.event.${event.payload.type}`);
    }
    const deadActors = actors.filter((entity) => (this.#world.get(entity, HealthSchema.type)?.current ?? 1) <= 0).length;
    return {
      tick: context.tick,
      entities: actors.length,
      events: [...this.#events],
      groundedActors: this.#grounded.size,
      deadActors,
      digest: this.digest(),
    };
  }

  public nearby(position: Vec3Like, radius: number, options: { team?: string; maxResults?: number } = {}): readonly EntityId[] {
    const hits = this.#queries.sphere({ center: position, radius }, { maxResults: options.maxResults });
    if (!options.team) return hits.map((hit) => hit.value);
    return hits.filter((hit) => this.#world.get(hit.value, TeamSchema.type)?.team === options.team).map((hit) => hit.value);
  }

  public allies(entity: EntityId, radius: number): readonly EntityId[] {
    const transform = this.#world.get(entity, TransformSchema.type);
    const team = this.#world.get(entity, TeamSchema.type);
    if (!transform || !team) return [];
    return this.nearby(transform, radius, { team: team.team }).filter((candidate) => candidate !== entity);
  }

  public enemies(entity: EntityId, radius: number): readonly EntityId[] {
    const transform = this.#world.get(entity, TransformSchema.type);
    const team = this.#world.get(entity, TeamSchema.type);
    if (!transform || !team) return [];
    const candidates = this.#queries.sphere({ center: transform, radius }, { maxResults: 256 });
    return candidates
      .map((hit) => hit.value)
      .filter((candidate) => candidate !== entity && this.#world.get(candidate, TeamSchema.type)?.team !== team.team);
  }

  public isGrounded(entity: EntityId): boolean {
    return this.#grounded.has(entity);
  }

  public digest(): string {
    let hash = 2166136261 >>> 0;
    const actors = this.#world.query({ all: [TransformSchema.type, HealthSchema.type, ActorStateSchema.type] });
    for (const entity of actors) {
      const transform = this.#world.require(entity, TransformSchema.type);
      const health = this.#world.require(entity, HealthSchema.type);
      const state = this.#world.require(entity, ActorStateSchema.type);
      const text = `${entity}:${transform.x.toFixed(3)}:${transform.y.toFixed(3)}:${transform.z.toFixed(3)}:${health.current.toFixed(2)}:${state.state}:${state.stateTick}`;
      for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
  }

  #updateActor(entity: EntityId, context: SimulationContext): void {
    const transform = this.#world.require(entity, TransformSchema.type);
    const velocity = this.#world.require(entity, VelocitySchema.type);
    const health = this.#world.require(entity, HealthSchema.type);
    const actor = this.#world.require(entity, ActorStateSchema.type);
    if (health.current <= 0) {
      actor.state = 'dead';
      actor.stateTick = context.tick;
      velocity.x = 0;
      velocity.z = 0;
    } else {
      transform.x += velocity.x * context.deltaSeconds;
      transform.y += velocity.y * context.deltaSeconds;
      transform.z += velocity.z * context.deltaSeconds;
      if (Math.hypot(velocity.x, velocity.z) > 0.05 && actor.state === 'idle') this.setState(entity, 'moving', context.tick);
      if (Math.hypot(velocity.x, velocity.z) <= 0.05 && actor.state === 'moving') this.setState(entity, 'idle', context.tick);
    }
    if (this.#heightSampler) {
      const grounded = transform.y <= this.#heightSampler(transform.x, transform.z).height + 0.05 && velocity.y <= 0;
      if (grounded) {
        transform.y = this.#heightSampler(transform.x, transform.z).height;
        velocity.y = 0;
        this.#grounded.add(entity);
      } else {
        this.#grounded.delete(entity);
        velocity.y -= 9.81 * context.deltaSeconds;
      }
    }
    const queryId = this.#queryIndex.get(entity);
    if (queryId) this.#queries.update(queryId, transform);
  }

  #ensureSchemas(): void {
    const schemas = [GameplayTagSchema, HealthSchema, TeamSchema, ActorStateSchema] as const;
    for (const schema of schemas) if (!this.#world.hasComponentType(schema.type)) this.#world.registerComponent(schema);
  }
}
