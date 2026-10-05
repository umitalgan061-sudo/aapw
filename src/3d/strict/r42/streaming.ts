/**
 * Interest-based world streaming planner for R42.
 * Production TypeScript owner. Planning is deterministic; loading is delegated to adapters.
 */
import type { Priority, Vec3 } from './types.ts';
import { clamp, finite, deepFreeze } from './types.ts';

export interface StreamCell {
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly priority: Priority;
  readonly score: number;
  readonly required: boolean;
}

export interface StreamingPolicy {
  readonly cellSizeMeters: number;
  readonly criticalRadiusCells: number;
  readonly activeRadiusCells: number;
  readonly prefetchRadiusCells: number;
  readonly unloadRadiusCells: number;
  readonly maxLoadsPerTick: number;
  readonly maxUnloadsPerTick: number;
}

export const DEFAULT_STREAMING_POLICY: StreamingPolicy = Object.freeze({
  cellSizeMeters: 128,
  criticalRadiusCells: 1,
  activeRadiusCells: 3,
  prefetchRadiusCells: 5,
  unloadRadiusCells: 7,
  maxLoadsPerTick: 12,
  maxUnloadsPerTick: 16,
});

export interface StreamingPlan {
  readonly center: readonly [number, number];
  readonly loads: readonly StreamCell[];
  readonly unloads: readonly StreamCell[];
  readonly retained: readonly StreamCell[];
  readonly checksum: number;
}

export interface StreamingAdapter {
  readonly isLoaded: (x: number, z: number) => boolean;
  readonly load: (cell: StreamCell) => void | Promise<void>;
  readonly unload: (cell: StreamCell) => void | Promise<void>;
}

export class StreamingPlannerR42 {
  readonly policy: StreamingPolicy;
  #known = new Map<string, StreamCell>();

  constructor(policy: Partial<StreamingPolicy> = {}) {
    this.policy = deepFreeze({ ...DEFAULT_STREAMING_POLICY, ...policy });
  }

  plan(position: Vec3, visibleImportant: readonly Vec3[] = []): StreamingPlan {
    const center = this.cell(position);
    const desired = new Map<string, StreamCell>();

    for (let x = center[0] - this.policy.prefetchRadiusCells; x <= center[0] + this.policy.prefetchRadiusCells; x += 1) {
      for (let z = center[1] - this.policy.prefetchRadiusCells; z <= center[1] + this.policy.prefetchRadiusCells; z += 1) {
        const distance = Math.hypot(x - center[0], z - center[1]);
        if (distance > this.policy.prefetchRadiusCells) continue;
        const required = distance <= this.policy.criticalRadiusCells;
        const priority: Priority = required ? 'critical'
          : distance <= this.policy.activeRadiusCells ? 'high'
          : 'normal';
        const importantBoost = visibleImportant.some(world => this.cell(world)[0] === x && this.cell(world)[1] === z) ? 500 : 0;
        const score = (required ? 10_000 : 5_000) - distance * 100 + importantBoost;
        const cell = Object.freeze({ x, z, distance, priority, score, required });
        desired.set(key(x, z), cell);
      }
    }

    const loads = [...desired.values()]
      .filter(cell => !this.#known.has(key(cell.x, cell.z)))
      .sort(compareCells)
      .slice(0, this.policy.maxLoadsPerTick);

    const unloads = [...this.#known.values()]
      .filter(cell => !desired.has(key(cell.x, cell.z)) && cell.distance > this.policy.unloadRadiusCells)
      .sort((a, b) => b.distance - a.distance || key(a.x, a.z).localeCompare(key(b.x, b.z)))
      .slice(0, this.policy.maxUnloadsPerTick);

    for (const cell of loads) this.#known.set(key(cell.x, cell.z), cell);
    for (const cell of unloads) this.#known.delete(key(cell.x, cell.z));

    const retained = [...desired.values()]
      .filter(cell => !loads.some(load => load.x === cell.x && load.z === cell.z))
      .sort(compareCells);

    return deepFreeze({
      center,
      loads,
      unloads,
      retained,
      checksum: hashPlan(loads, unloads, retained),
    });
  }

  async apply(plan: StreamingPlan, adapter: StreamingAdapter): Promise<void> {
    for (const cell of plan.unloads) {
      if (adapter.isLoaded(cell.x, cell.z)) await adapter.unload(cell);
    }
    for (const cell of plan.loads) {
      if (!adapter.isLoaded(cell.x, cell.z)) await adapter.load(cell);
    }
  }

  loadedCells(): readonly StreamCell[] {
    return Object.freeze([...this.#known.values()].sort(compareCells));
  }

  clear(): void {
    this.#known.clear();
  }

  private cell(position: Vec3): readonly [number, number] {
    return Object.freeze([
      Math.floor(finite(position.x) / this.policy.cellSizeMeters),
      Math.floor(finite(position.z) / this.policy.cellSizeMeters),
    ] as [number, number]);
  }
}

function compareCells(a: StreamCell, b: StreamCell): number {
  return b.score - a.score || a.distance - b.distance || key(a.x, a.z).localeCompare(key(b.x, b.z));
}

function key(x: number, z: number): string {
  return x + ':' + z;
}

function hashPlan(
  loads: readonly StreamCell[],
  unloads: readonly StreamCell[],
  retained: readonly StreamCell[],
): number {
  let hash = 2166136261;
  for (const cell of [...loads, ...unloads, ...retained]) {
    const text = key(cell.x, cell.z) + ':' + cell.priority + ':' + cell.score.toFixed(3);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return hash >>> 0;
}
