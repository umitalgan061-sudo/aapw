import type { GpuLimits, RenderBackend, RenderCapabilities, Result } from './types';
import { checksum } from './deterministic';
import { Diagnostics } from './diagnostics';
import { negotiateRenderCapabilities } from './capabilities';

export interface CapabilityCacheKey {
  readonly backend: RenderBackend;
  readonly renderer: string;
  readonly vendor?: string;
  readonly architecture?: string;
}

export interface CapabilityCacheEntry {
  readonly key: string;
  readonly capabilities: RenderCapabilities;
  readonly createdAt: number;
  readonly hits: number;
  readonly digest: string;
}

export interface CapabilityCacheOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
  readonly now?: () => number;
  readonly diagnostics?: Diagnostics;
}

function makeKey(input: CapabilityCacheKey): string {
  return `${input.backend}|${input.renderer}|${input.vendor ?? 'unknown'}|${input.architecture ?? 'unknown'}`;
}

function cloneCapabilities(capabilities: RenderCapabilities): RenderCapabilities {
  const limits: GpuLimits = { ...capabilities.limits };
  return Object.freeze({ ...capabilities, limits });
}

/**
 * Caches expensive adapter capability discovery while keeping the key explicit and the cache
 * bounded. Capability detection is environment-specific, so entries never participate in world
 * determinism or gameplay decisions directly.
 */
export class CapabilityCache {
  #entries = new Map<string, CapabilityCacheEntry>();
  #maxEntries: number;
  #ttlMs: number;
  #now: () => number;
  #diagnostics: Diagnostics;

  constructor(options: CapabilityCacheOptions = {}) {
    this.#maxEntries = Math.max(1, Math.min(64, Math.floor(options.maxEntries ?? 8)));
    this.#ttlMs = Math.max(1_000, Math.min(86_400_000, Math.floor(options.ttlMs ?? 3_600_000)));
    this.#now = options.now ?? (() => Date.now());
    this.#diagnostics = options.diagnostics ?? new Diagnostics();
  }

  get(key: CapabilityCacheKey): RenderCapabilities | null {
    const id = makeKey(key);
    const current = this.#entries.get(id);
    if (!current) return null;
    if (this.#now() - current.createdAt > this.#ttlMs) {
      this.#entries.delete(id);
      return null;
    }
    this.#entries.set(id, { ...current, hits: current.hits + 1, digest: checksum({ key: current.key, capabilities: current.capabilities, hits: current.hits + 1 }) });
    return cloneCapabilities(current.capabilities);
  }

  set(key: CapabilityCacheKey, capabilities: RenderCapabilities): void {
    const id = makeKey(key);
    const entry: CapabilityCacheEntry = Object.freeze({ key: id, capabilities: cloneCapabilities(capabilities), createdAt: this.#now(), hits: 0, digest: checksum({ key: id, capabilities }) });
    this.#entries.set(id, entry);
    this.#trim();
  }

  async discover(key: CapabilityCacheKey, canvas?: HTMLCanvasElement): Promise<Result<RenderCapabilities>> {
    const cached = this.get(key);
    if (cached) return { ok: true, value: cached };
    try {
      const capabilities = await negotiateRenderCapabilities({ canvas });
      this.set(key, capabilities);
      this.#diagnostics.info('CAPABILITY_DISCOVERED', `Detected ${capabilities.backend}`, 'capabilities', { key: makeKey(key) });
      return { ok: true, value: cloneCapabilities(capabilities) };
    } catch (cause) {
      const error = { code: 'CAPABILITY_DISCOVERY_FAILED', message: String(cause), retryable: true, cause } as const;
      this.#diagnostics.error(error.code, error.message, 'capabilities');
      return { ok: false, error };
    }
  }

  entries(): readonly CapabilityCacheEntry[] {
    return [...this.#entries.values()].sort((a, b) => a.key.localeCompare(b.key)).map((entry) => ({ ...entry, capabilities: cloneCapabilities(entry.capabilities) }));
  }

  stats(): Readonly<{ entries: number; maxEntries: number; ttlMs: number; digest: string }> {
    return Object.freeze({ entries: this.#entries.size, maxEntries: this.#maxEntries, ttlMs: this.#ttlMs, digest: checksum(this.entries()) });
  }

  clear(): void { this.#entries.clear(); }

  #trim(): void {
    while (this.#entries.size > this.#maxEntries) {
      const oldest = [...this.#entries.values()].sort((a, b) => a.createdAt - b.createdAt || a.key.localeCompare(b.key))[0];
      if (!oldest) break;
      this.#entries.delete(oldest.key);
    }
  }
}

export function createCapabilityCache(options?: CapabilityCacheOptions): CapabilityCache {
  return new CapabilityCache(options);
}
