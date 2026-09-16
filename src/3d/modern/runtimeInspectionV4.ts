/** Production inspection utilities for the v4 runtime.
 *
 * Provides bounded, serializable snapshots for debug panels, support bundles and
 * automated release diagnostics without exposing mutable runtime internals.
 */
import type { RuntimeHealthV4, RuntimeSnapshotV4, RuntimeStatsV4, BudgetUsageV4, QualityTierV4 } from './runtimeContractsV4';

export interface InspectionBudgetV4 {
  readonly maxEntities: number;
  readonly maxEvents: number;
  readonly maxBytes: number;
}

export interface InspectionEventV4 {
  readonly tick: number;
  readonly category: string;
  readonly code: string;
  readonly severity: 'info' | 'warn' | 'error';
  readonly message: string;
}

export interface RuntimeInspectionV4 {
  readonly generatedAt: number;
  readonly phase: string;
  readonly health: RuntimeHealthV4;
  readonly stats: RuntimeStatsV4;
  readonly budget: BudgetUsageV4;
  readonly quality: QualityTierV4;
  readonly events: readonly InspectionEventV4[];
  readonly entityCount: number;
  readonly checksum: string;
}

export interface InspectorSourceV4 {
  readonly now: () => number;
  readonly health: () => RuntimeHealthV4;
  readonly stats: () => RuntimeStatsV4;
  readonly budget: () => BudgetUsageV4;
  readonly quality: () => QualityTierV4;
  readonly snapshot: () => RuntimeSnapshotV4;
}

const DEFAULTS: InspectionBudgetV4 = Object.freeze({ maxEntities: 2048, maxEvents: 128, maxBytes: 256 * 1024 });

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
}

function digest(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function clampBudget(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(1_000_000, Math.floor(value)));
}

function sanitizeMessage(value: unknown): string {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 512);
}

export class RuntimeInspectorV4 {
  readonly budget: InspectionBudgetV4;
  #events: InspectionEventV4[] = [];
  #lastSnapshot = '';

  constructor(budget: Partial<InspectionBudgetV4> = {}) {
    this.budget = Object.freeze({
      maxEntities: clampBudget(budget.maxEntities ?? DEFAULTS.maxEntities, DEFAULTS.maxEntities),
      maxEvents: clampBudget(budget.maxEvents ?? DEFAULTS.maxEvents, DEFAULTS.maxEvents),
      maxBytes: clampBudget(budget.maxBytes ?? DEFAULTS.maxBytes, DEFAULTS.maxBytes),
    });
  }

  record(event: InspectionEventV4): void {
    this.#events.push(Object.freeze({
      tick: Number.isFinite(event.tick) ? Math.max(0, Math.floor(event.tick)) : 0,
      category: sanitizeMessage(event.category).slice(0, 64),
      code: sanitizeMessage(event.code).slice(0, 64),
      severity: event.severity,
      message: sanitizeMessage(event.message),
    }));
    while (this.#events.length > this.budget.maxEvents) this.#events.shift();
  }

  clear(): void {
    this.#events.length = 0;
    this.#lastSnapshot = '';
  }

  capture(source: InspectorSourceV4): RuntimeInspectionV4 {
    const runtime = source.snapshot();
    const entities = this.#extractEntities(runtime);
    const payload = {
      phase: String(runtime.phase),
      health: source.health(),
      stats: source.stats(),
      budget: source.budget(),
      quality: source.quality(),
      entities,
      events: this.#events,
    };
    const serialized = stable(payload);
    const bounded = serialized.slice(0, this.budget.maxBytes);
    this.#lastSnapshot = bounded;
    const result: RuntimeInspectionV4 = Object.freeze({
      generatedAt: source.now(),
      phase: String(runtime.phase),
      health: source.health(),
      stats: source.stats(),
      budget: source.budget(),
      quality: source.quality(),
      events: Object.freeze(this.#events.slice()),
      entityCount: entities.length,
      checksum: digest(bounded),
    });
    return result;
  }

  serializedSnapshot(): string {
    return this.#lastSnapshot;
  }

  toSupportBundle(source: InspectorSourceV4): string {
    const report = this.capture(source);
    return stable({ version: 4, report });
  }

  #extractEntities(snapshot: RuntimeSnapshotV4): readonly Record<string, unknown>[] {
    const candidate = snapshot as unknown as Record<string, unknown>;
    const raw = Array.isArray(candidate.entities) ? candidate.entities : [];
    return raw.slice(0, this.budget.maxEntities).map((entity, index) => {
      const value = entity && typeof entity === 'object' ? entity as Record<string, unknown> : {};
      return {
        id: Number.isFinite(Number(value.id)) ? Number(value.id) : index,
        x: this.#finite(value.x),
        y: this.#finite(value.y),
        z: this.#finite(value.z),
        state: typeof value.state === 'string' ? value.state.slice(0, 64) : undefined,
      };
    });
  }

  #finite(value: unknown): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(-1_000_000, Math.min(1_000_000, numeric)) : 0;
  }
}

export function summarizeHealthV4(health: RuntimeHealthV4): 'healthy' | 'degraded' | 'critical' {
  const value = String(health).toLowerCase();
  if (value.includes('critical') || value.includes('fatal')) return 'critical';
  if (value.includes('warn') || value.includes('degraded')) return 'degraded';
  return 'healthy';
}

export function compareInspectionV4(left: RuntimeInspectionV4, right: RuntimeInspectionV4): readonly string[] {
  const changes: string[] = [];
  if (left.phase !== right.phase) changes.push(`phase:${left.phase}->${right.phase}`);
  if (left.entityCount !== right.entityCount) changes.push(`entities:${left.entityCount}->${right.entityCount}`);
  if (left.quality !== right.quality) changes.push(`quality:${left.quality}->${right.quality}`);
  if (left.events.length !== right.events.length) changes.push(`events:${left.events.length}->${right.events.length}`);
  return Object.freeze(changes);
}

export function createDefaultInspectionBudgetV4(): InspectionBudgetV4 {
  return DEFAULTS;
}
