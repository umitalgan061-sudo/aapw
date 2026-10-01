
import { clamp, stableHash, type R35Id, type R35Result } from './contracts';

export type StreamingPriority =
  | 'critical'
  | 'high'
  | 'normal'
  | 'background';

export interface StreamAsset {
  readonly id: R35Id;
  readonly bytes: number;
  readonly priority: StreamingPriority;
  readonly dependencies: readonly R35Id[];
  readonly distance: number;
  readonly optional: boolean;
}

export interface StreamDecision {
  readonly load: readonly R35Id[];
  readonly evict: readonly R35Id[];
  readonly keep: readonly R35Id[];
  readonly bytesRequested: number;
  readonly bytesEvicted: number;
  readonly digest: string;
}

const PRIORITY: Record<StreamingPriority, number> = {
  critical: 4,
  high: 3,
  normal: 2,
  background: 1,
};

export class StreamingRuntimeR35 {
  #assets = new Map<R35Id, StreamAsset>();
  #resident = new Set<R35Id>();
  #maxResidentBytes: number;
  #lastAccess = new Map<R35Id, number>();
  #tick = 0;

  constructor(maxResidentBytes = 512 * 1024 * 1024) {
    this.#maxResidentBytes = clamp(
      Math.trunc(maxResidentBytes),
      8 * 1024 * 1024,
      4 * 1024 * 1024 * 1024,
    );
  }

  register(asset: StreamAsset): R35Result<StreamAsset> {
    if (!asset.id || asset.bytes < 0) {
      return {
        ok: false,
        error: {
          code: 'STREAM_ASSET_INVALID',
          message: 'Invalid stream asset',
          retryable: false,
        },
      };
    }

    if (this.#assets.has(asset.id)) {
      return {
        ok: false,
        error: {
          code: 'STREAM_DUPLICATE',
          message: 'Stream asset already registered',
          retryable: false,
        },
      };
    }

    if (
      asset.bytes > this.#maxResidentBytes
      && !asset.optional
    ) {
      return {
        ok: false,
        error: {
          code: 'STREAM_ASSET_TOO_LARGE',
          message: 'Asset is larger than the residency budget',
          retryable: false,
        },
      };
    }

    if (asset.dependencies.length > 64) {
      return {
        ok: false,
        error: {
          code: 'STREAM_DEPENDENCY_LIMIT',
          message: 'Asset dependency count is too large',
          retryable: false,
        },
      };
    }

    this.#assets.set(
      asset.id,
      Object.freeze({
        ...asset,
        bytes: Math.max(0, Math.trunc(asset.bytes)),
        distance: Math.max(0, asset.distance),
        dependencies: Object.freeze([
          ...asset.dependencies,
        ]),
      }),
    );

    return {
      ok: true,
      value: asset,
    };
  }

  unregister(id: R35Id): boolean {
    if (this.#resident.has(id)) return false;
    return this.#assets.delete(id);
  }

  touch(id: R35Id): boolean {
    if (!this.#assets.has(id)) return false;
    this.#lastAccess.set(id, this.#tick);
    return true;
  }

  plan(required: readonly R35Id[]): R35Result<StreamDecision> {
    const wanted = new Set<R35Id>();

    const visit = (
      id: R35Id,
      depth: number,
      visiting: Set<R35Id>,
    ): boolean => {
      if (depth > 32) return false;
      if (visiting.has(id)) return false;
      if (wanted.has(id)) return true;

      const asset = this.#assets.get(id);
      if (!asset) return false;

      wanted.add(id);
      visiting.add(id);

      const dependencies = [...asset.dependencies]
        .sort();

      for (const dependency of dependencies) {
        if (
          !visit(
            dependency,
            depth + 1,
            visiting,
          )
        ) {
          return false;
        }
      }

      visiting.delete(id);
      return true;
    };

    for (const id of required) {
      if (!visit(id, 0, new Set())) {
        return {
          ok: false,
          error: {
            code: 'STREAM_DEPENDENCY',
            message: 'Streaming dependency graph is invalid',
            retryable: true,
          },
        };
      }
    }

    const candidates = [...wanted]
      .map((id) => this.#assets.get(id)!)
      .sort(
        (a, b) =>
          PRIORITY[b.priority] - PRIORITY[a.priority]
          || a.distance - b.distance
          || a.id.localeCompare(b.id),
      );

    const load: R35Id[] = [];
    let bytesRequested = 0;

    for (const asset of candidates) {
      if (this.#resident.has(asset.id)) {
        continue;
      }

      load.push(asset.id);
      bytesRequested += asset.bytes;
    }

    const projected =
      this.#residentBytes() + bytesRequested;

    const evictionRequired = Math.max(
      0,
      projected - this.#maxResidentBytes,
    );

    const evict = this.#evictionPlan(
      evictionRequired,
      wanted,
    );

    const bytesEvicted = evict.reduce(
      (sum, id) =>
        sum + (this.#assets.get(id)?.bytes ?? 0),
      0,
    );

    const remaining =
      this.#residentBytes()
      + bytesRequested
      - bytesEvicted;

    if (remaining > this.#maxResidentBytes) {
      return {
        ok: false,
        error: {
          code: 'STREAM_BUDGET',
          message: 'Required assets cannot fit in residency budget',
          retryable: true,
        },
      };
    }

    const keep = Object.freeze(
      [...this.#resident]
        .filter((id) => !evict.includes(id))
        .sort(),
    );

    return {
      ok: true,
      value: Object.freeze({
        load: Object.freeze(load),
        evict: Object.freeze(evict),
        keep,
        bytesRequested,
        bytesEvicted,
        digest: stableHash({
          load,
          evict,
          keep,
          bytesRequested,
          bytesEvicted,
        }),
      }),
    };
  }

  commit(decision: StreamDecision): void {
    for (const id of decision.evict) {
      this.#resident.delete(id);
    }

    for (const id of decision.load) {
      if (!this.#assets.has(id)) continue;

      this.#resident.add(id);
      this.#lastAccess.set(id, this.#tick);
    }
  }

  advance(ticks = 1): void {
    this.#tick += clamp(
      Math.trunc(ticks),
      1,
      120,
    );
  }

  resident(): readonly R35Id[] {
    return Object.freeze(
      [...this.#resident].sort(),
    );
  }

  residentBytes(): number {
    return this.#residentBytes();
  }

  capacity(): number {
    return this.#maxResidentBytes;
  }

  usageRatio(): number {
    return this.#maxResidentBytes === 0
      ? 0
      : this.#residentBytes()
        / this.#maxResidentBytes;
  }

  reset(): void {
    this.#resident.clear();
    this.#lastAccess.clear();
    this.#tick = 0;
  }

  #residentBytes(): number {
    let bytes = 0;

    for (const id of this.#resident) {
      bytes += this.#assets.get(id)?.bytes ?? 0;
    }

    return bytes;
  }

  #evictionPlan(
    requiredBytes: number,
    wanted: Set<R35Id>,
  ): R35Id[] {
    if (requiredBytes <= 0) return [];

    let reclaimed = 0;
    const out: R35Id[] = [];

    const candidates = [...this.#resident]
      .filter((id) => !wanted.has(id))
      .map((id) => this.#assets.get(id)!)
      .sort(
        (a, b) =>
          PRIORITY[a.priority] - PRIORITY[b.priority]
          || (this.#lastAccess.get(a.id) ?? 0)
            - (this.#lastAccess.get(b.id) ?? 0)
          || b.distance - a.distance
          || a.id.localeCompare(b.id),
      );

    for (const asset of candidates) {
      if (reclaimed >= requiredBytes) break;

      out.push(asset.id);
      reclaimed += asset.bytes;
    }

    return out;
  }
}
