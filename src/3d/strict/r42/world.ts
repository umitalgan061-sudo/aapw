/**
 * Deterministic entity world and spatial indexing for R42.
 * Production TypeScript owner. State mutation stays inside typed authorities.
 */

import type {
  CombatState,
  EntityKind,
  Transform,
  Vec3,
  Velocity,
  WorldEntity,
  WorldPatch,
} from './types.ts';
import {
  clamp,
  cloneCombat,
  cloneEntity,
  cloneTransform,
  cloneVelocity,
  finite,
  hashValue,
  safeInteger,
  vec3,
} from './types.ts';

export interface SpawnInput {
  readonly id: string;
  readonly kind: EntityKind;
  readonly position?: Vec3;
  readonly rotation?: Transform['rotation'];
  readonly scale?: Vec3;
  readonly velocity?: Velocity;
  readonly combat?: Partial<CombatState>;
  readonly lod?: WorldEntity['lod'];
  readonly tags?: readonly string[];
  readonly data?: Readonly<Record<string, unknown>>;
}

const DEFAULT_COMBAT: CombatState = Object.freeze({
  health: 100,
  maxHealth: 100,
  stamina: 100,
  maxStamina: 100,
  poise: 0,
  maxPoise: 100,
  guarding: false,
  attacking: false,
  dodging: false,
  invulnerable: false,
  cooldownUntilTick: 0,
  comboIndex: 0,
  revision: 0,
});

const DEFAULT_COMPONENTS: Readonly<Record<WorldEntity['components'] extends never ? never : keyof WorldEntity['components'], boolean>> = Object.freeze({
  transform: true,
  velocity: true,
  health: true,
  stamina: true,
  combat: true,
  inventory: false,
  navigation: false,
  render: true,
  network: true,
  metadata: true,
});

export class EntityWorldR42 {
  readonly maxEntities: number;
  readonly spatial: SpatialHashR42;

  #entities = new Map<string, WorldEntity>();
  #revision = 0;

  constructor(maxEntities = 8192, cellSize = 32) {
    this.maxEntities = Math.max(1, Math.trunc(maxEntities));
    this.spatial = new SpatialHashR42(cellSize);
  }

  get size(): number {
    return this.#entities.size;
  }

  get revision(): number {
    return this.#revision;
  }

  has(id: string): boolean {
    return this.#entities.has(id);
  }

  get(id: string): WorldEntity | null {
    const entity = this.#entities.get(id);
    return entity ? cloneEntity(entity) : null;
  }

  values(): readonly WorldEntity[] {
    return Object.freeze(
      [...this.#entities.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(cloneEntity),
    );
  }

  spawn(input: SpawnInput): WorldEntity {
    const id = normalizeId(input.id);
    if (!id) throw new Error('R42 entity id is empty after sanitization.');
    if (this.#entities.size >= this.maxEntities) throw new Error('R42 entity capacity exhausted.');
    if (this.#entities.has(id)) throw new Error('R42 entity already exists: ' + id);

    const transform: Transform = Object.freeze({
      position: cloneVec3(input.position ?? vec3()),
      rotation: Object.freeze({
        x: finite(input.rotation?.x),
        y: finite(input.rotation?.y),
        z: finite(input.rotation?.z),
        w: finite(input.rotation?.w, 1),
      }),
      scale: cloneVec3(input.scale ?? vec3(1, 1, 1)),
    });

    const velocity: Velocity = Object.freeze({
      linear: cloneVec3(input.velocity?.linear ?? vec3()),
      angular: cloneVec3(input.velocity?.angular ?? vec3()),
    });

    const combat: CombatState = Object.freeze({
      ...DEFAULT_COMBAT,
      ...(input.combat ?? {}),
      health: clamp(finite(input.combat?.health, DEFAULT_COMBAT.health), 0, 1_000_000),
      maxHealth: Math.max(1, finite(input.combat?.maxHealth, DEFAULT_COMBAT.maxHealth)),
      stamina: clamp(finite(input.combat?.stamina, DEFAULT_COMBAT.stamina), 0, 1_000_000),
      maxStamina: Math.max(1, finite(input.combat?.maxStamina, DEFAULT_COMBAT.maxStamina)),
      poise: clamp(finite(input.combat?.poise, DEFAULT_COMBAT.poise), 0, 1_000_000),
      maxPoise: Math.max(1, finite(input.combat?.maxPoise, DEFAULT_COMBAT.maxPoise)),
      cooldownUntilTick: Math.max(0, safeInteger(input.combat?.cooldownUntilTick)),
      comboIndex: Math.max(0, safeInteger(input.combat?.comboIndex)),
      revision: Math.max(0, safeInteger(input.combat?.revision)),
    });

    const entity: WorldEntity = Object.freeze({
      id,
      kind: input.kind,
      transform,
      velocity,
      combat,
      lod: input.lod ?? 0,
      active: true,
      revision: 1,
      tags: Object.freeze([...new Set((input.tags ?? []).map(value => value.slice(0, 48)))].sort()),
      components: Object.freeze({ ...DEFAULT_COMPONENTS }),
      data: Object.freeze({ ...(input.data ?? {}) }),
    });

    this.#entities.set(id, entity);
    this.spatial.insert(entity.id, entity.transform.position);
    this.#revision += 1;
    return cloneEntity(entity);
  }

  patch(patch: WorldPatch): WorldEntity | null {
    const current = this.#entities.get(patch.entityId);
    if (!current) return null;
    if (safeInteger(patch.revision) < current.revision) return cloneEntity(current);

    const next: WorldEntity = Object.freeze({
      ...current,
      revision: current.revision + 1,
    });
    const changes = patch.changes as Record<string, unknown>;
    const merged = applyKnownChanges(next, changes);
    this.#entities.set(current.id, merged);
    this.spatial.update(current.id, merged.transform.position);
    this.#revision += 1;
    return cloneEntity(merged);
  }

  remove(id: string): boolean {
    const entity = this.#entities.get(id);
    if (!entity) return false;
    this.#entities.delete(id);
    this.spatial.remove(id);
    this.#revision += 1;
    return true;
  }

  queryRadius(center: Vec3, radius: number): readonly WorldEntity[] {
    const ids = this.spatial.queryRadius(center, Math.max(0, finite(radius)));
    const result = ids
      .map(id => this.#entities.get(id))
      .filter((entity): entity is WorldEntity => Boolean(entity))
      .sort((a, b) => distanceSquared(a.transform.position, center) - distanceSquared(b.transform.position, center) || a.id.localeCompare(b.id))
      .map(cloneEntity);
    return Object.freeze(result);
  }

  digest(): number {
    return hashValue(this.values());
  }
}

export class SpatialHashR42 {
  readonly cellSize: number;
  #cells = new Map<string, Set<string>>();
  #positions = new Map<string, Vec3>();

  constructor(cellSize = 32) {
    this.cellSize = Math.max(1, finite(cellSize, 32));
  }

  insert(id: string, position: Vec3): void {
    this.remove(id);
    this.#positions.set(id, cloneVec3(position));
    const key = this.keyFor(position);
    const bucket = this.#cells.get(key) ?? new Set<string>();
    bucket.add(id);
    this.#cells.set(key, bucket);
  }

  update(id: string, position: Vec3): void {
    const previous = this.#positions.get(id);
    if (previous && this.keyFor(previous) === this.keyFor(position)) {
      this.#positions.set(id, cloneVec3(position));
      return;
    }
    this.insert(id, position);
  }

  remove(id: string): void {
    const previous = this.#positions.get(id);
    if (!previous) return;
    const key = this.keyFor(previous);
    const bucket = this.#cells.get(key);
    bucket?.delete(id);
    if (bucket && bucket.size === 0) this.#cells.delete(key);
    this.#positions.delete(id);
  }

  queryRadius(center: Vec3, radius: number): readonly string[] {
    const span = Math.ceil(radius / this.cellSize);
    const origin = this.cell(center);
    const result = new Set<string>();
    for (let x = origin.x - span; x <= origin.x + span; x += 1) {
      for (let z = origin.z - span; z <= origin.z + span; z += 1) {
        const bucket = this.#cells.get(x + ':' + z);
        bucket?.forEach(id => {
          const position = this.#positions.get(id);
          if (position && distanceSquared(position, center) <= radius * radius) result.add(id);
        });
      }
    }
    return Object.freeze([...result].sort());
  }

  snapshot(): ReadonlyArray<readonly [string, Vec3]> {
    return Object.freeze(
      [...this.#positions.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, position]) => [id, cloneVec3(position)] as const),
    );
  }

  keyFor(position: Vec3): string {
    const cell = this.cell(position);
    return cell.x + ':' + cell.z;
  }

  private cell(position: Vec3): { readonly x: number; readonly z: number } {
    return Object.freeze({
      x: Math.floor(finite(position.x) / this.cellSize),
      z: Math.floor(finite(position.z) / this.cellSize),
    });
  }
}

function applyKnownChanges(entity: WorldEntity, changes: Record<string, unknown>): WorldEntity {
  let transform = entity.transform;
  let velocity = entity.velocity;
  let combat = entity.combat;

  const position = changes['position'];
  if (isVec3(position)) {
    transform = Object.freeze({ ...transform, position: cloneVec3(position) });
  }

  const linear = changes['linearVelocity'];
  if (isVec3(linear)) {
    velocity = cloneVelocity({ ...velocity, linear });
  }

  const health = changes['health'];
  if (typeof health === 'number') {
    combat = cloneCombat({ ...combat, health: clamp(health, 0, combat.maxHealth), revision: combat.revision + 1 });
  }

  const stamina = changes['stamina'];
  if (typeof stamina === 'number') {
    combat = cloneCombat({ ...combat, stamina: clamp(stamina, 0, combat.maxStamina), revision: combat.revision + 1 });
  }

  const guarding = changes['guarding'];
  if (typeof guarding === 'boolean') {
    combat = cloneCombat({ ...combat, guarding, revision: combat.revision + 1 });
  }

  return Object.freeze({ ...entity, transform: cloneTransform(transform), velocity: cloneVelocity(velocity), combat });
}

function isVec3(value: unknown): value is Vec3 {
  if (!value || typeof value !== 'object') return false;
  const objectValue = value as Record<string, unknown>;
  return typeof objectValue.x === 'number' && typeof objectValue.y === 'number' && typeof objectValue.z === 'number';
}

function cloneVec3(value: Vec3): Vec3 {
  return vec3(value.x, value.y, value.z);
}

function normalizeId(value: string): string {
  return String(value).replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 128);
}

function distanceSquared(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
