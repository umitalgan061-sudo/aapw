/**
 * Next-generation deterministic runtime kernel.
 *
 * This module is intentionally renderer-agnostic. It owns fixed-step simulation,
 * entity lifecycle, command application, deterministic queries and snapshotting.
 * The existing JavaScript world can consume it incrementally through adapters.
 */

export type EntityId = number & { readonly __entityId: unique symbol };
export type ComponentType = string & { readonly __componentType: unique symbol };

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface TransformComponent {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface VelocityComponent {
  linear: Vec3;
  angular: Vec3;
}

export interface RuntimeEntity {
  id: EntityId;
  generation: number;
  active: boolean;
}

export interface KernelClock {
  tick: number;
  simulationTime: number;
  fixedDeltaSeconds: number;
}

export interface RuntimeCommand {
  tick: number;
  entityId: EntityId;
  type: string;
  sequence: number;
  payload: unknown;
}

export interface RuntimeSystemContext {
  readonly clock: KernelClock;
  readonly world: RuntimeWorld;
  readonly commands: readonly RuntimeCommand[];
}

export interface RuntimeSystem {
  readonly id: string;
  readonly priority: number;
  update(context: RuntimeSystemContext): void;
}

export interface RuntimeSnapshot {
  schemaVersion: 1;
  tick: number;
  simulationTime: number;
  nextEntityId: number;
  entities: Array<{ id: number; generation: number; active: boolean }>;
  transforms: Array<{ id: number; value: TransformComponent }>;
  velocities: Array<{ id: number; value: VelocityComponent }>;
}

const EPSILON = 1e-9;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function cloneTransform(value: TransformComponent): TransformComponent {
  return {
    position: cloneVec3(value.position),
    rotation: cloneVec3(value.rotation),
    scale: cloneVec3(value.scale),
  };
}

function cloneVelocity(value: VelocityComponent): VelocityComponent {
  return { linear: cloneVec3(value.linear), angular: cloneVec3(value.angular) };
}

function stableNumber(value: number): number {
  if (Object.is(value, -0)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

function stableVec3(value: Vec3): Vec3 {
  return {
    x: stableNumber(value.x),
    y: stableNumber(value.y),
    z: stableNumber(value.z),
  };
}

export class RuntimeWorld {
  #nextEntityId = 1;
  #entities = new Map<number, RuntimeEntity>();
  #transforms = new Map<number, TransformComponent>();
  #velocities = new Map<number, VelocityComponent>();

  createEntity(): EntityId {
    const id = this.#nextEntityId++ as EntityId;
    this.#entities.set(id, { id, generation: 1, active: true });
    return id;
  }

  createEntityWithId(id: number, generation = 1): EntityId {
    if (!Number.isInteger(id) || id <= 0) throw new RangeError('entity id must be a positive integer');
    if (this.#entities.has(id)) throw new Error(`entity ${id} already exists`);
    this.#nextEntityId = Math.max(this.#nextEntityId, id + 1);
    const entityId = id as EntityId;
    this.#entities.set(id, { id: entityId, generation, active: true });
    return entityId;
  }

  destroyEntity(id: EntityId): boolean {
    const entity = this.#entities.get(id);
    if (!entity || !entity.active) return false;
    entity.active = false;
    entity.generation += 1;
    this.#transforms.delete(id);
    this.#velocities.delete(id);
    return true;
  }

  reviveEntity(id: EntityId): boolean {
    const entity = this.#entities.get(id);
    if (!entity || entity.active) return false;
    entity.active = true;
    entity.generation += 1;
    return true;
  }

  hasEntity(id: EntityId): boolean {
    return this.#entities.get(id)?.active === true;
  }

  generationOf(id: EntityId): number | undefined {
    return this.#entities.get(id)?.generation;
  }

  entityCount(): number {
    let total = 0;
    for (const entity of this.#entities.values()) if (entity.active) total += 1;
    return total;
  }

  allEntities(): readonly RuntimeEntity[] {
    return [...this.#entities.values()]
      .filter((entity) => entity.active)
      .sort((a, b) => a.id - b.id)
      .map((entity) => ({ ...entity }));
  }

  setTransform(id: EntityId, value: TransformComponent): void {
    this.requireActive(id);
    assertFinite(value.position.x, 'position.x');
    assertFinite(value.position.y, 'position.y');
    assertFinite(value.position.z, 'position.z');
    this.#transforms.set(id, cloneTransform(value));
  }

  getTransform(id: EntityId): TransformComponent | undefined {
    const value = this.#transforms.get(id);
    return value ? cloneTransform(value) : undefined;
  }

  setVelocity(id: EntityId, value: VelocityComponent): void {
    this.requireActive(id);
    this.#velocities.set(id, cloneVelocity(value));
  }

  getVelocity(id: EntityId): VelocityComponent | undefined {
    const value = this.#velocities.get(id);
    return value ? cloneVelocity(value) : undefined;
  }

  queryMovingEntities(): EntityId[] {
    const ids: EntityId[] = [];
    for (const [id, velocity] of this.#velocities.entries()) {
      if (!this.hasEntity(id as EntityId)) continue;
      const moving = Math.abs(velocity.linear.x) > EPSILON || Math.abs(velocity.linear.y) > EPSILON || Math.abs(velocity.linear.z) > EPSILON;
      if (moving) ids.push(id as EntityId);
    }
    return ids.sort((a, b) => a - b);
  }

  integrate(deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) throw new RangeError('deltaSeconds must be >= 0');
    for (const [id, velocity] of this.#velocities.entries()) {
      const transform = this.#transforms.get(id);
      if (!transform || !this.hasEntity(id as EntityId)) continue;
      transform.position.x += velocity.linear.x * deltaSeconds;
      transform.position.y += velocity.linear.y * deltaSeconds;
      transform.position.z += velocity.linear.z * deltaSeconds;
      transform.rotation.x += velocity.angular.x * deltaSeconds;
      transform.rotation.y += velocity.angular.y * deltaSeconds;
      transform.rotation.z += velocity.angular.z * deltaSeconds;
    }
  }

  snapshot(tick: number, simulationTime: number): RuntimeSnapshot {
    assertFinite(simulationTime, 'simulationTime');
    return {
      schemaVersion: 1,
      tick,
      simulationTime: stableNumber(simulationTime),
      nextEntityId: this.#nextEntityId,
      entities: [...this.#entities.values()]
        .sort((a, b) => a.id - b.id)
        .map((entity) => ({ id: entity.id, generation: entity.generation, active: entity.active })),
      transforms: [...this.#transforms.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, value]) => ({ id, value: { position: stableVec3(value.position), rotation: stableVec3(value.rotation), scale: stableVec3(value.scale) } })),
      velocities: [...this.#velocities.entries()]
        .sort(([a], [b]) => a - b)
        .map(([id, value]) => ({ id, value: { linear: stableVec3(value.linear), angular: stableVec3(value.angular) } })),
    };
  }

  restore(snapshot: RuntimeSnapshot): void {
    if (snapshot.schemaVersion !== 1) throw new Error(`unsupported snapshot schema ${snapshot.schemaVersion}`);
    this.#nextEntityId = snapshot.nextEntityId;
    this.#entities.clear();
    this.#transforms.clear();
    this.#velocities.clear();
    for (const entity of snapshot.entities) {
      this.#entities.set(entity.id, { id: entity.id as EntityId, generation: entity.generation, active: entity.active });
    }
    for (const entry of snapshot.transforms) this.#transforms.set(entry.id, cloneTransform(entry.value));
    for (const entry of snapshot.velocities) this.#velocities.set(entry.id, cloneVelocity(entry.value));
  }

  requireActive(id: EntityId): void {
    if (!this.hasEntity(id)) throw new Error(`entity ${id} is not active`);
  }
}

export class RuntimeKernel {
  readonly world: RuntimeWorld;
  readonly clock: KernelClock;
  #systems: RuntimeSystem[] = [];
  #commands: RuntimeCommand[] = [];
  #lastSequence = 0;

  constructor(fixedDeltaSeconds = 1 / 60) {
    assertFinite(fixedDeltaSeconds, 'fixedDeltaSeconds');
    if (fixedDeltaSeconds <= 0) throw new RangeError('fixedDeltaSeconds must be > 0');
    this.world = new RuntimeWorld();
    this.clock = { tick: 0, simulationTime: 0, fixedDeltaSeconds };
  }

  addSystem(system: RuntimeSystem): void {
    if (this.#systems.some((candidate) => candidate.id === system.id)) {
      throw new Error(`duplicate runtime system: ${system.id}`);
    }
    this.#systems.push(system);
    this.#systems.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  removeSystem(id: string): boolean {
    const before = this.#systems.length;
    this.#systems = this.#systems.filter((system) => system.id !== id);
    return this.#systems.length !== before;
  }

  queueCommand(command: Omit<RuntimeCommand, 'sequence'> & { sequence?: number }): number {
    const sequence = command.sequence ?? ++this.#lastSequence;
    if (sequence <= this.#lastSequence) throw new Error('command sequence must be strictly increasing');
    this.#lastSequence = sequence;
    this.#commands.push({ ...command, sequence });
    this.#commands.sort((a, b) => a.tick - b.tick || a.sequence - b.sequence);
    return sequence;
  }

  step(): RuntimeSnapshot {
    const currentTick = this.clock.tick;
    const commands = this.#commands.filter((command) => command.tick === currentTick);
    this.#commands = this.#commands.filter((command) => command.tick > currentTick);
    this.applyBuiltinCommands(commands);
    const context: RuntimeSystemContext = { clock: this.clock, world: this.world, commands };
    for (const system of this.#systems) system.update(context);
    this.world.integrate(this.clock.fixedDeltaSeconds);
    this.clock.tick += 1;
    this.clock.simulationTime = this.clock.tick * this.clock.fixedDeltaSeconds;
    return this.world.snapshot(this.clock.tick, this.clock.simulationTime);
  }

  runSteps(count: number): RuntimeSnapshot[] {
    if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer');
    const snapshots: RuntimeSnapshot[] = [];
    for (let index = 0; index < count; index += 1) snapshots.push(this.step());
    return snapshots;
  }

  saveSnapshot(): RuntimeSnapshot {
    return this.world.snapshot(this.clock.tick, this.clock.simulationTime);
  }

  restoreSnapshot(snapshot: RuntimeSnapshot): void {
    this.world.restore(snapshot);
    this.clock.tick = snapshot.tick;
    this.clock.simulationTime = snapshot.simulationTime;
  }

  queuedCommandCount(): number {
    return this.#commands.length;
  }

  private applyBuiltinCommands(commands: readonly RuntimeCommand[]): void {
    for (const command of commands) {
      if (!this.world.hasEntity(command.entityId)) continue;
      if (command.type === 'set-transform') {
        const payload = command.payload as Partial<TransformComponent>;
        const current = this.world.getTransform(command.entityId);
        if (!current) continue;
        this.world.setTransform(command.entityId, {
          position: payload.position ? cloneVec3(payload.position) : current.position,
          rotation: payload.rotation ? cloneVec3(payload.rotation) : current.rotation,
          scale: payload.scale ? cloneVec3(payload.scale) : current.scale,
        });
      }
    }
  }
}

export function createDefaultTransform(): TransformComponent {
  return {
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  };
}

export function createDefaultVelocity(): VelocityComponent {
  return {
    linear: { x: 0, y: 0, z: 0 },
    angular: { x: 0, y: 0, z: 0 },
  };
}
