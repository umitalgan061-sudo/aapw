import { NextGenRuntimeKernel } from './runtimeKernel.ts';
import { EntityId, InputFrame, Tick, Vec3, entityId, tickValue } from './types.ts';

export interface LegacyPlayerLike {
  object3D?: { position?: { x: number; y: number; z: number } };
  health?: number;
}

export interface LegacyWorldLike {
  player?: LegacyPlayerLike;
  scene?: unknown;
}

export interface AdapterPolicy {
  publishIntervalTicks: number;
  maxPositionDeltaMeters: number;
  maxHealth: number;
  source: string;
}

const DEFAULT_POLICY: AdapterPolicy = {
  publishIntervalTicks: 3,
  maxPositionDeltaMeters: 12,
  maxHealth: 100,
  source: 'legacy-bridge',
};

export class LegacyRuntimeAdapter {
  readonly #kernel: NextGenRuntimeKernel;
  readonly #policy: AdapterPolicy;
  readonly #lastPosition = new Map<EntityId, Vec3>();
  #playerEntity?: EntityId;
  #lastPublishTick: Tick = tickValue(0);

  constructor(kernel: NextGenRuntimeKernel, policy: Partial<AdapterPolicy> = {}) {
    this.#kernel = kernel;
    this.#policy = { ...DEFAULT_POLICY, ...policy };
  }

  bindPlayer(entity: EntityId): void {
    this.#playerEntity = entity;
  }

  readPlayer(): { entity?: EntityId; position?: Vec3; health?: number } {
    if (!this.#playerEntity) return {};
    const transform = this.#kernel.world.snapshot().find((item) => item.id === this.#playerEntity);
    const components = transform?.components ?? {};
    const position = isVec3((components.Transform as Record<string, unknown> | undefined)?.position)
      ? { ...((components.Transform as { position: Vec3 }).position) }
      : undefined;
    const health = typeof components.Health === 'number' ? components.Health : undefined;
    return { entity: this.#playerEntity, position, health };
  }

  importLegacyState(legacy: LegacyWorldLike, tick: Tick = this.#kernel.clock.tick): void {
    const player = legacy.player;
    const position = player?.object3D?.position;
    if (!position) return;
    const safePosition = {
      x: Number.isFinite(position.x) ? position.x : 0,
      y: Number.isFinite(position.y) ? position.y : 0,
      z: Number.isFinite(position.z) ? position.z : 0,
    };
    const entity = this.#playerEntity ?? entityId(this.#kernel.world.entityCount + 1);
    if (!this.#playerEntity) {
      this.#playerEntity = this.#kernel.world.spawn();
      this.#kernel.world.add(this.#playerEntity, Symbol.for('aapw.nextgen.component.Transform') as never, { position: safePosition, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } });
    }
    this.#lastPosition.set(entity, safePosition);
    if (typeof player.health === 'number') {
      const health = Math.max(0, Math.min(this.#policy.maxHealth, player.health));
      this.#kernel.commands.enqueue('legacy.health.sync', { entity, health }, tick, this.#policy.source);
    }
  }

  exportToLegacy(legacy: LegacyWorldLike): void {
    const player = legacy.player;
    const entity = this.#playerEntity;
    if (!player || !entity) return;
    const snapshot = this.#kernel.world.snapshot().find((item) => item.id === entity);
    const transform = snapshot?.components.Transform as { position?: Vec3 } | undefined;
    if (transform?.position && player.object3D?.position) {
      player.object3D.position.x = transform.position.x;
      player.object3D.position.y = transform.position.y;
      player.object3D.position.z = transform.position.z;
    }
    const health = snapshot?.components.Health;
    if (typeof health === 'number') player.health = Math.max(0, Math.min(this.#policy.maxHealth, health));
  }

  shouldPublish(tick: Tick): boolean {
    return Number(tick) - Number(this.#lastPublishTick) >= this.#policy.publishIntervalTicks;
  }

  markPublished(tick: Tick): void { this.#lastPublishTick = tick; }

  acceptInput(input: InputFrame): void {
    this.#kernel.commands.enqueue('legacy.input.sync', input, input.tick, this.#policy.source);
  }

  sanitizePosition(previous: Vec3 | undefined, next: Vec3): Vec3 {
    if (!previous) return finiteVec3(next);
    const safe = finiteVec3(next);
    const dx = safe.x - previous.x;
    const dy = safe.y - previous.y;
    const dz = safe.z - previous.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= this.#policy.maxPositionDeltaMeters) return safe;
    const scale = this.#policy.maxPositionDeltaMeters / distance;
    return { x: previous.x + dx * scale, y: previous.y + dy * scale, z: previous.z + dz * scale };
  }

  get inputEntity(): EntityId | undefined { return this.#playerEntity; }
}

function finiteVec3(value: Vec3): Vec3 {
  return {
    x: Number.isFinite(value.x) ? value.x : 0,
    y: Number.isFinite(value.y) ? value.y : 0,
    z: Number.isFinite(value.z) ? value.z : 0,
  };
}

function isVec3(value: unknown): value is Vec3 {
  return typeof value === 'object' && value !== null
    && Number.isFinite((value as Vec3).x)
    && Number.isFinite((value as Vec3).y)
    && Number.isFinite((value as Vec3).z);
}
