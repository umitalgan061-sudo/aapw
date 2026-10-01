import { hashJson } from './deterministic';

export type MigrationStatus = 'legacy' | 'shadow' | 'parity' | 'typed' | 'blocked';
export interface MigrationSurface {
  readonly id: string;
  readonly legacyPath: string;
  readonly typedPath: string;
  readonly status: MigrationStatus;
  readonly parityRuns: number;
  readonly mismatches: number;
  readonly owner: string;
  readonly notes: readonly string[];
  readonly digest: string;
}
export interface ParityResult {
  readonly surfaceId: string;
  readonly match: boolean;
  readonly expectedDigest: string;
  readonly actualDigest: string;
  readonly tick: number;
}

export class MigrationLedger {
  #surfaces = new Map<string, MigrationSurface>();
  register(surface: Omit<MigrationSurface, 'digest'>): MigrationSurface | null {
    if (!/^[A-Za-z0-9_.:-]{1,96}$/.test(surface.id) || !surface.owner) return null;
    const value = this.freeze({ ...surface, digest: hashJson(surface) });
    this.#surfaces.set(surface.id, value);
    return value;
  }
  parity(result: ParityResult): MigrationSurface | null {
    const current = this.#surfaces.get(result.surfaceId);
    if (!current) return null;
    const updated = {
      ...current,
      parityRuns: current.parityRuns + 1,
      mismatches: current.mismatches + (result.match ? 0 : 1),
      status: result.match ? (current.parityRuns + 1 >= 1 ? 'parity' : current.status) : 'blocked',
    } as const;
    const value = this.freeze({ ...updated, digest: hashJson({ ...updated, expected: result.expectedDigest, actual: result.actualDigest, tick: result.tick }) });
    this.#surfaces.set(result.surfaceId, value);
    return value;
  }
  promote(id: string): MigrationSurface | null {
    const current = this.#surfaces.get(id);
    if (!current || current.parityRuns < 1 || current.mismatches > 0 || current.status === 'blocked') return null;
    const updated = this.freeze({ ...current, status: 'typed' as const, digest: hashJson({ ...current, status: 'typed' }) });
    this.#surfaces.set(id, updated);
    return updated;
  }
  block(id: string, note: string): MigrationSurface | null {
    const current = this.#surfaces.get(id); if (!current) return null;
    const updated = this.freeze({ ...current, status: 'blocked' as const, notes: Object.freeze([...current.notes, note].slice(-32)), digest: hashJson({ ...current, status: 'blocked', note }) });
    this.#surfaces.set(id, updated); return updated;
  }
  get(id: string): MigrationSurface | null { return this.#surfaces.get(id) ?? null; }
  all(): readonly MigrationSurface[] { return Object.freeze([...this.#surfaces.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  stats(): { readonly total: number; readonly typed: number; readonly parity: number; readonly blocked: number; readonly legacy: number; } {
    const all = this.all();
    return Object.freeze({ total: all.length, typed: all.filter((x) => x.status === 'typed').length, parity: all.filter((x) => x.status === 'parity').length, blocked: all.filter((x) => x.status === 'blocked').length, legacy: all.filter((x) => x.status === 'legacy' || x.status === 'shadow').length });
  }
  clear(): void { this.#surfaces.clear(); }
  private freeze(value: MigrationSurface): MigrationSurface {
    return Object.freeze({ ...value, notes: Object.freeze([...value.notes]) });
  }
}
