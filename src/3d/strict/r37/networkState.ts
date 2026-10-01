import type { NetworkEntityState, NetworkRole, NetworkSnapshot, Vec3 } from './types.ts';
import { clamp, distance3, finite, lerp, vec3 } from './math.ts';

export interface NetworkStateConfig {
  readonly role: NetworkRole;
  readonly interpolationDelayMs: number;
  readonly snapshotCapacity: number;
  readonly maxEntitiesPerSnapshot: number;
  readonly maxExtrapolationMs: number;
}

const DEFAULT_CONFIG: NetworkStateConfig = Object.freeze({
  role: 'offline',
  interpolationDelayMs: 100,
  snapshotCapacity: 64,
  maxEntitiesPerSnapshot: 1024,
  maxExtrapolationMs: 120,
});

export class NetworkStateR37 {
  readonly config: NetworkStateConfig;
  #snapshots: NetworkSnapshot[] = [];
  #lastAck = 0;
  #clockOffsetMs = 0;

  constructor(config: Partial<NetworkStateConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      interpolationDelayMs: Math.max(0, finite(config.interpolationDelayMs, DEFAULT_CONFIG.interpolationDelayMs)),
      snapshotCapacity: Math.max(2, Math.trunc(finite(config.snapshotCapacity, DEFAULT_CONFIG.snapshotCapacity))),
      maxEntitiesPerSnapshot: Math.max(1, Math.trunc(finite(config.maxEntitiesPerSnapshot, DEFAULT_CONFIG.maxEntitiesPerSnapshot))),
      maxExtrapolationMs: Math.max(0, finite(config.maxExtrapolationMs, DEFAULT_CONFIG.maxExtrapolationMs)),
    });
  }

  setClockOffset(offsetMs: number): void {
    this.#clockOffsetMs = clamp(finite(offsetMs), -10_000, 10_000);
  }

  pushSnapshot(snapshot: NetworkSnapshot): boolean {
    if (this.config.role === 'offline') return false;
    if (!Number.isFinite(snapshot.sentAtMs) || snapshot.entities.length > this.config.maxEntitiesPerSnapshot) return false;
    if (this.#snapshots.at(-1)?.tick !== undefined && snapshot.tick < this.#snapshots.at(-1)!.tick) return false;
    const normalized: NetworkSnapshot = Object.freeze({
      tick: Math.max(0, Math.trunc(snapshot.tick)),
      sentAtMs: finite(snapshot.sentAtMs),
      acknowledgedInputSequence: Math.max(0, Math.trunc(snapshot.acknowledgedInputSequence)),
      entities: Object.freeze(snapshot.entities.slice(0, this.config.maxEntitiesPerSnapshot).map(normalizeEntity)),
    });
    this.#snapshots.push(normalized);
    if (this.#snapshots.length > this.config.snapshotCapacity) this.#snapshots.shift();
    this.#lastAck = Math.max(this.#lastAck, normalized.acknowledgedInputSequence);
    return true;
  }

  get lastAcknowledgedInputSequence(): number {
    return this.#lastAck;
  }

  sample(renderTimeMs: number): readonly NetworkEntityState[] {
    if (this.#snapshots.length === 0) return Object.freeze([]);
    const targetTime = finite(renderTimeMs) - this.config.interpolationDelayMs - this.#clockOffsetMs;
    const rightIndex = this.#snapshots.findIndex((snapshot) => snapshot.sentAtMs >= targetTime);
    if (rightIndex <= 0) return this.#snapshots[0]!.entities;
    if (rightIndex < 0) {
      const latest = this.#snapshots.at(-1)!;
      const dt = Math.min(this.config.maxExtrapolationMs, Math.max(0, targetTime - latest.sentAtMs));
      return Object.freeze(latest.entities.map((entity) => extrapolate(entity, dt / 1000)));
    }
    const left = this.#snapshots[rightIndex - 1]!;
    const right = this.#snapshots[rightIndex]!;
    const alpha = clamp((targetTime - left.sentAtMs) / Math.max(1, right.sentAtMs - left.sentAtMs), 0, 1);
    const rightById = new Map(right.entities.map((entity) => [entity.id, entity]));
    return Object.freeze(left.entities.map((entity) => {
      const next = rightById.get(entity.id);
      return next ? interpolateNetworkEntity(entity, next, alpha) : entity;
    }));
  }

  snapshots(): readonly NetworkSnapshot[] {
    return Object.freeze([...this.#snapshots]);
  }

  clear(): void {
    this.#snapshots = [];
    this.#lastAck = 0;
    this.#clockOffsetMs = 0;
  }
}

function normalizeEntity(entity: NetworkEntityState): NetworkEntityState {
  return Object.freeze({
    id: String(entity.id).slice(0, 96),
    tick: Math.max(0, Math.trunc(entity.tick)),
    position: vec3(entity.position.x, entity.position.y, entity.position.z),
    velocity: vec3(entity.velocity.x, entity.velocity.y, entity.velocity.z),
    rotationY: finite(entity.rotationY),
    flags: Math.max(0, Math.trunc(entity.flags)),
  });
}

function interpolateNetworkEntity(a: NetworkEntityState, b: NetworkEntityState, alpha: number): NetworkEntityState {
  return Object.freeze({
    id: a.id,
    tick: Math.max(a.tick, b.tick),
    position: vec3(lerp(a.position.x, b.position.x, alpha), lerp(a.position.y, b.position.y, alpha), lerp(a.position.z, b.position.z, alpha)),
    velocity: vec3(lerp(a.velocity.x, b.velocity.x, alpha), lerp(a.velocity.y, b.velocity.y, alpha), lerp(a.velocity.z, b.velocity.z, alpha)),
    rotationY: lerp(a.rotationY, b.rotationY, alpha),
    flags: alpha >= 0.5 ? b.flags : a.flags,
  });
}

function extrapolate(entity: NetworkEntityState, deltaSeconds: number): NetworkEntityState {
  return Object.freeze({
    ...entity,
    position: vec3(
      entity.position.x + entity.velocity.x * deltaSeconds,
      entity.position.y + entity.velocity.y * deltaSeconds,
      entity.position.z + entity.velocity.z * deltaSeconds,
    ),
  });
}

export function shouldSnapDistance(current: Vec3, target: Vec3, thresholdMeters: number): boolean {
  return distance3(current, target) > Math.max(0, finite(thresholdMeters));
}
