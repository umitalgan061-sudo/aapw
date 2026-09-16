import type { Disposable, EntityId, TransformSnapshot } from './coreTypes.js';

export type MigrationState = 'legacy' | 'shadow' | 'verified' | 'promoted' | 'blocked';
export interface MigrationSurface<TLegacy = unknown, TModern = unknown> { readonly id: string; readonly state: MigrationState; readonly legacy: TLegacy | null; readonly modern: TModern | null; readonly parityChecks: number; readonly mismatches: number; readonly lastReason: string | null; }
export interface MigrationAdapter<TLegacy, TModern> { readonly id: string; readLegacy(): TLegacy; readModern(): TModern; project(legacy: TLegacy): TModern; compare(legacy: TLegacy, modern: TModern): boolean; apply(modern: TModern): void; }
export interface ParityReport { readonly id: string; readonly passed: boolean; readonly checked: number; readonly mismatches: number; readonly detail: string; }

function clone(value: any): any { if (value === null || typeof value !== 'object') return value; if (Array.isArray(value)) return value.map(clone); return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])); }

export class MigrationRuntime<TLegacy, TModern> implements Disposable {
  readonly adapter: MigrationAdapter<TLegacy, TModern>;
  #state: MigrationState = 'legacy';
  #checks = 0;
  #mismatches = 0;
  #reason: string | null = null;
  #disposed = false;
  #shadow: TModern | null = null;

  constructor(adapter: MigrationAdapter<TLegacy, TModern>) { this.adapter = adapter; }
  get state(): MigrationState { return this.#state; }

  initialize(): void {
    if (this.#disposed) return;
    this.#shadow = this.adapter.project(this.adapter.readLegacy());
    this.#state = 'shadow';
    this.#reason = 'shadow-projection-created';
  }

  check(): ParityReport {
    if (this.#disposed) return Object.freeze({ id: this.adapter.id, passed: false, checked: this.#checks, mismatches: this.#mismatches, detail: 'disposed' });
    const legacy = this.adapter.readLegacy();
    const modern = this.#state === 'shadow' ? this.#shadow : this.adapter.readModern();
    const projected = this.adapter.project(legacy);
    const passed = modern !== null && this.adapter.compare(projected, modern);
    this.#checks += 1;
    if (!passed) { this.#mismatches += 1; this.#state = 'blocked'; this.#reason = 'parity-mismatch'; }
    else if (this.#state === 'shadow') { this.#state = 'verified'; this.#reason = 'parity-verified'; }
    return Object.freeze({ id: this.adapter.id, passed, checked: this.#checks, mismatches: this.#mismatches, detail: passed ? 'legacy and modern representations are equivalent' : 'legacy and modern representations diverged' });
  }

  promote(): boolean {
    if (this.#disposed || this.#state !== 'verified') return false;
    const modern = this.#shadow ?? this.adapter.readModern();
    this.adapter.apply(modern);
    this.#state = 'promoted';
    this.#reason = 'promoted-after-parity';
    return true;
  }

  block(reason = 'blocked'): void { if (!this.#disposed) { this.#state = 'blocked'; this.#reason = reason; } }
  surface(): MigrationSurface<TLegacy, TModern> { return Object.freeze({ id: this.adapter.id, state: this.#state, legacy: this.#safeLegacy(), modern: this.#safeModern(), parityChecks: this.#checks, mismatches: this.#mismatches, lastReason: this.#reason }); }
  reset(): void { if (this.#disposed) return; this.#state = 'legacy'; this.#checks = 0; this.#mismatches = 0; this.#reason = null; this.#shadow = null; }
  dispose(): void { this.#disposed = true; this.#shadow = null; }
  #safeLegacy(): TLegacy | null { try { return clone(this.adapter.readLegacy()) as TLegacy; } catch { return null; } }
  #safeModern(): TModern | null { try { return clone(this.adapter.readModern()) as TModern; } catch { return null; } }
}

export interface TransformLegacy { readonly x: number; readonly y: number; readonly z: number; readonly yaw?: number; readonly pitch?: number; readonly scale?: number; }
export interface TransformModern { readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly rotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }; readonly scale: { readonly x: number; readonly y: number; readonly z: number }; }
export const projectTransform = (legacy: TransformLegacy): TransformModern => Object.freeze({ position: Object.freeze({ x: legacy.x, y: legacy.y, z: legacy.z }), rotation: Object.freeze({ x: 0, y: Math.sin((legacy.yaw ?? 0) * 0.5), z: 0, w: Math.cos((legacy.yaw ?? 0) * 0.5) }), scale: Object.freeze({ x: legacy.scale ?? 1, y: legacy.scale ?? 1, z: legacy.scale ?? 1 }) });
export const compareTransform = (legacy: TransformLegacy, modern: TransformModern): boolean => { const projected = projectTransform(legacy); return Math.abs(projected.position.x - modern.position.x) < 1e-4 && Math.abs(projected.position.y - modern.position.y) < 1e-4 && Math.abs(projected.position.z - modern.position.z) < 1e-4 && Math.abs(projected.scale.x - modern.scale.x) < 1e-4; };
export const transformEntity = (id: string, transform: TransformModern): Readonly<{ id: EntityId; transform: TransformSnapshot }> => ({ id: id as EntityId, transform: transform as TransformSnapshot });
