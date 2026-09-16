import type { TaskPriority, Vec2, WorldSeed } from './types';
import { hash32, sample01 } from './deterministic';

export interface StreamCell {
  readonly key: string;
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly score: number;
  readonly priority: TaskPriority;
}

export interface StreamPlan {
  readonly load: readonly StreamCell[];
  readonly retain: readonly StreamCell[];
  readonly unload: readonly StreamCell[];
}

export interface StreamingOptions {
  readonly loadRadius: number;
  readonly unloadRadius: number;
  readonly maxLoadsPerFrame: number;
  readonly maxUnloadsPerFrame: number;
  readonly seed?: WorldSeed | number;
}

function key(x: number, z: number): string { return `${x}:${z}`; }

/** Deterministic world-cell streamer with hysteresis, priority and per-frame churn limits. */
export class StreamingPlanner {
  readonly options: Required<StreamingOptions>;
  #loaded = new Set<string>();

  constructor(options: StreamingOptions) {
    if (options.unloadRadius <= options.loadRadius) throw new RangeError('unloadRadius must exceed loadRadius');
    this.options = { seed: 0x574f524c44, ...options };
    this.#validate();
  }

  plan(center: Vec2): StreamPlan {
    const desired = new Map<string, StreamCell>();
    const radius = Math.ceil(this.options.loadRadius);
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const distance = Math.hypot(dx, dz);
        if (distance > this.options.loadRadius) continue;
        const x = Math.floor(center.x) + dx;
        const z = Math.floor(center.y) + dz;
        const cellKey = key(x, z);
        const score = 1 / (1 + distance) + sample01(this.options.seed, hash32(cellKey)) * 0.0001;
        desired.set(cellKey, {
          key: cellKey,
          x,
          z,
          distance,
          score,
          priority: distance < 2 ? 4 : distance < 5 ? 3 : distance < 9 ? 2 : 1,
        });
      }
    }

    const load = [...desired.values()]
      .filter((cell) => !this.#loaded.has(cell.key))
      .sort((a, b) => b.priority - a.priority || b.score - a.score || a.key.localeCompare(b.key))
      .slice(0, this.options.maxLoadsPerFrame);

    const retain = [...this.#loaded]
      .map((cellKey) => desired.get(cellKey))
      .filter((cell): cell is StreamCell => Boolean(cell));

    const keepKeys = new Set(desired.keys());
    const unload = [...this.#loaded]
      .filter((cellKey) => {
        if (keepKeys.has(cellKey)) return false;
        const [xText, zText] = cellKey.split(':');
        const distance = Math.hypot(Number(xText) - Math.floor(center.x), Number(zText) - Math.floor(center.y));
        return distance > this.options.unloadRadius;
      })
      .sort()
      .slice(0, this.options.maxUnloadsPerFrame)
      .map((cellKey) => {
        const [xText, zText] = cellKey.split(':');
        return { key: cellKey, x: Number(xText), z: Number(zText), distance: Math.hypot(Number(xText) - center.x, Number(zText) - center.y), score: 0, priority: 1 as TaskPriority };
      });

    for (const cell of load) this.#loaded.add(cell.key);
    for (const cell of unload) this.#loaded.delete(cell.key);
    return { load, retain, unload };
  }

  loadedKeys(): readonly string[] { return [...this.#loaded].sort(); }
  reset(): void { this.#loaded.clear(); }

  #validate(): void {
    if (!Number.isFinite(this.options.loadRadius) || this.options.loadRadius <= 0) throw new RangeError('Invalid loadRadius');
    if (!Number.isFinite(this.options.unloadRadius)) throw new RangeError('Invalid unloadRadius');
    if (this.options.maxLoadsPerFrame < 1 || this.options.maxUnloadsPerFrame < 1) throw new RangeError('Streaming budgets must be positive');
  }
}
