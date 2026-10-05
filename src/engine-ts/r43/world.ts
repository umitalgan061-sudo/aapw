import { clamp, type EntityId, type Vec2 } from './contracts.ts';
import { EcsWorld } from './ecs.ts';
import { SpatialGrid } from './spatial.ts';

export interface Transform2D extends Vec2 {
  readonly rotation: number;
}

export interface Velocity2D {
  readonly x: number;
  readonly y: number;
  readonly maxSpeed: number;
}

export interface WorldEntity {
  readonly id: EntityId;
  readonly transform: Transform2D;
  readonly velocity: Velocity2D;
  readonly radius: number;
}

export interface WorldStepReport {
  readonly moved: number;
  readonly clamped: number;
  readonly removed: number;
  readonly spatialEntries: number;
}

export class WorldRuntime {
  readonly world: EcsWorld;
  readonly spatial: SpatialGrid;
  readonly bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number };

  #transform: ReturnType<EcsWorld['defineComponent']>;
  #velocity: ReturnType<EcsWorld['defineComponent']>;
  #radius: ReturnType<EcsWorld['defineComponent']>;
  #destroyQueue = new Set<EntityId>();

  constructor(bounds: { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }, cellSize = 32) {
    this.world = new EcsWorld();
    this.spatial = new SpatialGrid(cellSize);
    this.bounds = Object.freeze({
      minX: Math.min(bounds.minX, bounds.maxX),
      minY: Math.min(bounds.minY, bounds.maxY),
      maxX: Math.max(bounds.minX, bounds.maxX),
      maxY: Math.max(bounds.minY, bounds.maxY),
    });
    this.#transform = this.world.defineComponent<Transform2D>('transform');
    this.#velocity = this.world.defineComponent<Velocity2D>('velocity');
    this.#radius = this.world.defineComponent<number>('radius');
  }

  spawn(position: Vec2, velocity: Partial<Velocity2D> = {}, radius = 0.5): EntityId {
    if (this.world.count() >= 100_000) throw new Error('World entity limit reached');
    const id = this.world.create();
    this.#transform.set(id, {
      x: clamp(position.x, this.bounds.minX, this.bounds.maxX),
      y: clamp(position.y, this.bounds.minY, this.bounds.maxY),
      rotation: 0,
    });
    this.#velocity.set(id, {
      x: Number.isFinite(velocity.x) ? velocity.x : 0,
      y: Number.isFinite(velocity.y) ? velocity.y : 0,
      maxSpeed: Math.max(0, Number.isFinite(velocity.maxSpeed) ? velocity.maxSpeed! : 10),
    });
    this.#radius.set(id, Math.max(0, Number.isFinite(radius) ? radius : 0));
    this.#reindex(id);
    return id;
  }

  setTransform(entity: EntityId, transform: Partial<Transform2D>): void {
    const current = this.#requireTransform(entity);
    this.#transform.set(entity, {
      x: Number.isFinite(transform.x) ? transform.x! : current.x,
      y: Number.isFinite(transform.y) ? transform.y! : current.y,
      rotation: Number.isFinite(transform.rotation) ? transform.rotation! : current.rotation,
    });
    this.#reindex(entity);
  }

  setVelocity(entity: EntityId, velocity: Partial<Velocity2D>): void {
    const current = this.#velocity.get(entity);
    if (!current) throw new Error('Entity has no velocity: ' + entity);
    this.#velocity.set(entity, {
      x: Number.isFinite(velocity.x) ? velocity.x! : current.x,
      y: Number.isFinite(velocity.y) ? velocity.y! : current.y,
      maxSpeed: Number.isFinite(velocity.maxSpeed) ? Math.max(0, velocity.maxSpeed!) : current.maxSpeed,
    });
  }

  queueDestroy(entity: EntityId): void {
    if (this.world.alive(entity)) this.#destroyQueue.add(entity);
  }

  step(deltaSeconds: number): WorldStepReport {
    const dt = clamp(deltaSeconds, 0, 0.25);
    let moved = 0;
    let clamped = 0;
    for (const entity of this.world.query('transform', 'velocity').entities) {
      const transform = this.#transform.get(entity);
      const velocity = this.#velocity.get(entity);
      if (!transform || !velocity) continue;
      const speed = Math.hypot(velocity.x, velocity.y);
      const scale = speed > velocity.maxSpeed && velocity.maxSpeed > 0 ? velocity.maxSpeed / speed : 1;
      const nextX = transform.x + velocity.x * scale * dt;
      const nextY = transform.y + velocity.y * scale * dt;
      const boundedX = clamp(nextX, this.bounds.minX, this.bounds.maxX);
      const boundedY = clamp(nextY, this.bounds.minY, this.bounds.maxY);
      if (boundedX !== nextX || boundedY !== nextY) clamped += 1;
      if (boundedX !== transform.x || boundedY !== transform.y) moved += 1;
      this.#transform.set(entity, { ...transform, x: boundedX, y: boundedY });
      this.#reindex(entity);
    }
    let removed = 0;
    for (const entity of [...this.#destroyQueue].sort((a, b) => a - b)) {
      if (this.world.destroy(entity)) {
        this.spatial.remove(entity);
        removed += 1;
      }
    }
    this.#destroyQueue.clear();
    return Object.freeze({ moved, clamped, removed, spatialEntries: this.spatial.size() });
  }

  entity(entity: EntityId): WorldEntity | undefined {
    const transform = this.#transform.get(entity);
    const velocity = this.#velocity.get(entity);
    const radius = this.#radius.get(entity);
    if (!transform || !velocity || radius === undefined) return undefined;
    return Object.freeze({ id: entity, transform, velocity, radius });
  }

  nearby(position: Vec2, radius: number): readonly WorldEntity[] {
    return Object.freeze(
      this.spatial
        .queryRadius(position, radius)
        .result
        .map((item) => this.entity(item.id))
        .filter((item): item is WorldEntity => item !== undefined),
    );
  }

  alive(): readonly EntityId[] {
    return this.world.aliveEntities();
  }

  clear(): void {
    this.world.clear();
    this.spatial.clear();
    this.#destroyQueue.clear();
    this.#transform = this.world.defineComponent<Transform2D>('transform');
    this.#velocity = this.world.defineComponent<Velocity2D>('velocity');
    this.#radius = this.world.defineComponent<number>('radius');
  }

  #requireTransform(entity: EntityId): Transform2D {
    const current = this.#transform.get(entity);
    if (!current || !this.world.alive(entity)) throw new Error('Unknown world entity: ' + entity);
    return current;
  }

  #reindex(entity: EntityId): void {
    const transform = this.#transform.get(entity);
    const radius = this.#radius.get(entity);
    if (!transform || radius === undefined) return;
    this.spatial.upsert({
      id: entity,
      position: { x: transform.x, y: transform.y },
      radius,
    });
  }
}
