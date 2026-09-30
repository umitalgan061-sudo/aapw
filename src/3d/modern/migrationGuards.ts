import type { Result } from './types';

export type MigrationStatus = 'legacy' | 'shadow' | 'active' | 'retired' | 'blocked';

export interface MigrationSurface {
  readonly id: string;
  readonly legacyPath: string;
  readonly modernPath: string;
  readonly status: MigrationStatus;
  readonly parityChecks: number;
  readonly lastParityFailure: string | null;
}

export interface MigrationGuardReport {
  readonly status: MigrationStatus;
  readonly surfaceCount: number;
  readonly activeCount: number;
  readonly blockedCount: number;
  readonly parityFailures: number;
  readonly digest: string;
}

function safePath(value: string): boolean { return value.length > 0 && value.length <= 512 && !value.includes('..\\') && !value.includes('/../'); }

/** Registry that prevents an incomplete legacy-to-modern cutover from becoming silent technical debt. */
export class MigrationGuardRegistry {
  #surfaces = new Map<string, MigrationSurface>();
  #failures = new Map<string, string>();

  register(surface: Omit<MigrationSurface, 'parityChecks' | 'lastParityFailure'>): Result<MigrationSurface> {
    if (!surface.id || !safePath(surface.legacyPath) || !safePath(surface.modernPath)) return { ok: false, error: { code: 'MIGRATION_SURFACE_INVALID', message: 'Migration surface path is invalid', retryable: false } };
    if (this.#surfaces.has(surface.id)) return { ok: false, error: { code: 'MIGRATION_SURFACE_DUPLICATE', message: `Migration surface already exists: ${surface.id}`, retryable: false } };
    const item: MigrationSurface = Object.freeze({ ...surface, parityChecks: 0, lastParityFailure: null });
    this.#surfaces.set(surface.id, item);
    return { ok: true, value: item };
  }

  reportParity(id: string, passed: boolean, reason?: string): void {
    const current = this.#surfaces.get(id);
    if (!current) return;
    if (passed) {
      this.#surfaces.set(id, Object.freeze({ ...current, parityChecks: current.parityChecks + 1, lastParityFailure: current.lastParityFailure }));
      this.#failures.delete(id);
      return;
    }
    const message = String(reason ?? 'parity check failed').slice(0, 512);
    this.#surfaces.set(id, Object.freeze({ ...current, parityChecks: current.parityChecks + 1, lastParityFailure: message, status: 'blocked' }));
    this.#failures.set(id, message);
  }

  promote(id: string): Result<MigrationSurface> {
    const current = this.#surfaces.get(id);
    if (!current) return { ok: false, error: { code: 'MIGRATION_SURFACE_NOT_FOUND', message: 'Migration surface not found', retryable: false } };
    if (current.status === 'blocked') return { ok: false, error: { code: 'MIGRATION_SURFACE_BLOCKED', message: 'Migration surface has a parity failure', retryable: false } };
    if (current.parityChecks === 0) return { ok: false, error: { code: 'MIGRATION_PARITY_REQUIRED', message: 'At least one parity check is required', retryable: false } };
    const next = Object.freeze({ ...current, status: 'active' as const });
    this.#surfaces.set(id, next);
    return { ok: true, value: next };
  }

  retire(id: string): boolean {
    const current = this.#surfaces.get(id);
    if (!current) return false;
    this.#surfaces.set(id, Object.freeze({ ...current, status: 'retired' }));
    return true;
  }

  surface(id: string): MigrationSurface | null { return this.#surfaces.get(id) ?? null; }
  surfaces(): readonly MigrationSurface[] { return Object.freeze([...this.#surfaces.values()]); }

  report(): MigrationGuardReport {
    const surfaces = [...this.#surfaces.values()];
    const activeCount = surfaces.filter((item) => item.status === 'active').length;
    const blockedCount = surfaces.filter((item) => item.status === 'blocked').length;
    const parityFailures = this.#failures.size;
    let digest = '';
    for (const surface of surfaces.sort((a, b) => a.id.localeCompare(b.id))) digest += `${surface.id}:${surface.status}:${surface.parityChecks}:${surface.lastParityFailure ?? ''}|`;
    return Object.freeze({ status: blockedCount ? 'blocked' : activeCount === surfaces.length && surfaces.length > 0 ? 'active' : surfaces.some((item) => item.status === 'shadow') ? 'shadow' : 'legacy', surfaceCount: surfaces.length, activeCount, blockedCount, parityFailures, digest });
  }
}
