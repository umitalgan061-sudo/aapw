import type { EntityRecord, RuntimeMode, WorldStateSnapshot } from './types.ts';
import { clamp, finite, stableJson } from './math.ts';
import { EntityRegistryR37 } from './entityRegistry.ts';

export interface WorldStateConfig {
  readonly seed: number;
  readonly maxFlags: number;
  readonly maxValues: number;
  readonly entityCapacity: number;
}

const DEFAULT_CONFIG: WorldStateConfig = Object.freeze({
  seed: 37,
  maxFlags: 256,
  maxValues: 256,
  entityCapacity: 4096,
});

export class WorldStateR37 {
  readonly config: WorldStateConfig;
  readonly entities: EntityRegistryR37;
  #tick = 0;
  #mode: RuntimeMode = 'booting';
  #flags = new Map<string, boolean>();
  #values = new Map<string, number>();
  #revision = 0;

  constructor(config: Partial<WorldStateConfig> = {}) {
    this.config = Object.freeze({
      ...DEFAULT_CONFIG,
      ...config,
      seed: Math.trunc(finite(config.seed, DEFAULT_CONFIG.seed)),
      maxFlags: Math.max(1, Math.trunc(finite(config.maxFlags, DEFAULT_CONFIG.maxFlags))),
      maxValues: Math.max(1, Math.trunc(finite(config.maxValues, DEFAULT_CONFIG.maxValues))),
      entityCapacity: Math.max(1, Math.trunc(finite(config.entityCapacity, DEFAULT_CONFIG.entityCapacity))),
    });
    this.entities = new EntityRegistryR37({ maxEntities: this.config.entityCapacity });
  }

  get tick(): number {
    return this.#tick;
  }

  get mode(): RuntimeMode {
    return this.#mode;
  }

  get revision(): number {
    return this.#revision;
  }

  setMode(mode: RuntimeMode): void {
    if (this.#mode === 'disposed') return;
    this.#mode = mode;
    this.#revision += 1;
  }

  advance(tick: number): void {
    this.#tick = Math.max(this.#tick, Math.trunc(finite(tick)));
  }

  setFlag(key: string, value: boolean): void {
    const safeKey = sanitizeKey(key);
    if (!safeKey) return;
    if (!this.#flags.has(safeKey) && this.#flags.size >= this.config.maxFlags) return;
    this.#flags.set(safeKey, Boolean(value));
    this.#revision += 1;
  }

  getFlag(key: string): boolean {
    return this.#flags.get(sanitizeKey(key)) ?? false;
  }

  setValue(key: string, value: number): void {
    const safeKey = sanitizeKey(key);
    if (!safeKey) return;
    if (!this.#values.has(safeKey) && this.#values.size >= this.config.maxValues) return;
    this.#values.set(safeKey, clamp(finite(value), -1e12, 1e12));
    this.#revision += 1;
  }

  getValue(key: string): number {
    return this.#values.get(sanitizeKey(key)) ?? 0;
  }

  tickEntity(entityId: string, patch: Parameters<EntityRegistryR37['patch']>[1]): EntityRecord | undefined {
    const record = this.entities.patch(entityId, patch);
    if (record) this.#revision += 1;
    return record;
  }

  snapshot(): WorldStateSnapshot {
    return Object.freeze({
      version: 37,
      seed: this.config.seed,
      tick: this.#tick,
      mode: this.#mode,
      entities: this.entities.snapshot(),
      flags: Object.freeze(Object.fromEntries([...this.#flags.entries()].sort())),
      values: Object.freeze(Object.fromEntries([...this.#values.entries()].sort())),
    });
  }

  checksum(): string {
    return stableJson(this.snapshot());
  }

  restore(snapshot: WorldStateSnapshot): void {
    if (snapshot.version !== 37) throw new RangeError('unsupported world snapshot version');
    this.#tick = Math.max(0, Math.trunc(snapshot.tick));
    this.#mode = snapshot.mode;
    this.#flags = new Map(Object.entries(snapshot.flags).slice(0, this.config.maxFlags));
    this.#values = new Map(Object.entries(snapshot.values).slice(0, this.config.maxValues));
    this.entities.restore(snapshot.entities);
    this.#revision += 1;
  }

  reset(): void {
    this.#tick = 0;
    this.#mode = 'booting';
    this.#flags.clear();
    this.#values.clear();
    this.entities.clear();
    this.#revision += 1;
  }
}

function sanitizeKey(value: unknown): string {
  return String(value ?? '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 96);
}
