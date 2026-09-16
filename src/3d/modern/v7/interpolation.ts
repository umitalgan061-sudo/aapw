import { clamp, stableSort, type Disposable, type EntityId, type Vec3 } from './primitives.js';

export interface NetworkStateSample {
  readonly tick: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly rotation: Vec3;
}

export interface InterpolatedState {
  readonly tick: number;
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly rotation: Vec3;
  readonly extrapolated: boolean;
  readonly alpha: number;
}

export interface NetworkInterpolationStats {
  readonly entities: number;
  readonly samples: number;
  readonly interpolations: number;
  readonly extrapolations: number;
  readonly dropped: number;
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * clamp(alpha, 0, 1);
}

function lerpVec(a: Vec3, b: Vec3, alpha: number): Vec3 {
  return Object.freeze({
    x: lerp(a.x, b.x, alpha),
    y: lerp(a.y, b.y, alpha),
    z: lerp(a.z, b.z, alpha),
  });
}

export class NetworkInterpolationRuntime implements Disposable {
  readonly perEntitySamples: number;
  readonly maxEntities: number;
  #buffers = new Map<EntityId, NetworkStateSample[]>();
  #interpolations = 0;
  #extrapolations = 0;
  #dropped = 0;
  #disposed = false;

  constructor(perEntitySamples = 8, maxEntities = 8192) {
    this.perEntitySamples = Math.max(2, Math.min(32, Math.trunc(perEntitySamples)));
    this.maxEntities = Math.max(16, Math.min(100_000, Math.trunc(maxEntities)));
  }

  push(id: EntityId, sample: NetworkStateSample): boolean {
    if (this.#disposed) return false;
    if (!this.#buffers.has(id) && this.#buffers.size >= this.maxEntities) {
      this.#dropped += 1;
      return false;
    }
    const buffer = this.#buffers.get(id) ?? [];
    const previous = buffer.at(-1);
    if (previous && sample.tick <= previous.tick) {
      this.#dropped += 1;
      return false;
    }
    buffer.push(Object.freeze({
      ...sample,
      tick: Math.trunc(sample.tick),
      position: Object.freeze({ ...sample.position }),
      velocity: Object.freeze({ ...sample.velocity }),
      rotation: Object.freeze({ ...sample.rotation }),
    }));
    if (buffer.length > this.perEntitySamples) buffer.shift();
    this.#buffers.set(id, buffer);
    return true;
  }

  sample(id: EntityId, renderTick: number, extrapolationTicks = 2): InterpolatedState | null {
    if (this.#disposed) return null;
    const buffer = this.#buffers.get(id);
    if (!buffer?.length) return null;
    const target = Number(renderTick);
    const previous = [...buffer].reverse().find((entry) => entry.tick <= target);
    const next = buffer.find((entry) => entry.tick >= target);
    if (previous && next && previous.tick !== next.tick) {
      const alpha = clamp((target - previous.tick) / (next.tick - previous.tick), 0, 1);
      this.#interpolations += 1;
      return Object.freeze({ tick: renderTick, position: lerpVec(previous.position, next.position, alpha), velocity: lerpVec(previous.velocity, next.velocity, alpha), rotation: lerpVec(previous.rotation, next.rotation, alpha), extrapolated: false, alpha });
    }
    const latest = buffer.at(-1)!;
    if (target >= latest.tick && target <= latest.tick + Math.max(0, extrapolationTicks)) {
      const dt = target - latest.tick;
      this.#extrapolations += 1;
      return Object.freeze({ tick: renderTick, position: Object.freeze({ x: latest.position.x + latest.velocity.x * dt, y: latest.position.y + latest.velocity.y * dt, z: latest.position.z + latest.velocity.z * dt }), velocity: latest.velocity, rotation: latest.rotation, extrapolated: true, alpha: 1 });
    }
    return Object.freeze({ tick: renderTick, position: latest.position, velocity: latest.velocity, rotation: latest.rotation, extrapolated: true, alpha: 1 });
  }

  prune(minTick: number): number {
    let removed = 0;
    for (const [id, buffer] of this.#buffers) {
      const kept = buffer.filter((sample) => sample.tick >= minTick);
      if (kept.length !== buffer.length) removed += buffer.length - kept.length;
      if (kept.length) this.#buffers.set(id, kept);
      else this.#buffers.delete(id);
    }
    return removed;
  }

  samples(id: EntityId): readonly NetworkStateSample[] {
    return Object.freeze([...(this.#buffers.get(id) ?? [])]);
  }

  entities(): readonly EntityId[] {
    return Object.freeze(stableSort([...this.#buffers.keys()], (a, b) => String(a).localeCompare(String(b))));
  }

  stats(): NetworkInterpolationStats {
    return Object.freeze({ entities: this.#buffers.size, samples: [...this.#buffers.values()].reduce((sum, buffer) => sum + buffer.length, 0), interpolations: this.#interpolations, extrapolations: this.#extrapolations, dropped: this.#dropped });
  }

  clear(): void {
    this.#buffers.clear();
  }

  dispose(): void {
    this.#disposed = true;
    this.clear();
  }
}
