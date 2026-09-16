import type { Disposable, V7Result } from './primitives.js';

export type MigrationState = 'legacy' | 'shadow' | 'verified' | 'promoted' | 'blocked';
export interface MigrationSurface { readonly id: string; readonly owner: string; readonly legacyPath: string; readonly modernPath: string; readonly state: MigrationState; readonly parityPasses: number; readonly parityFailures: number; readonly lastDigest: string | null; }
export interface ParityResult { readonly surface: string; readonly equal: boolean; readonly legacyDigest: string; readonly modernDigest: string; readonly state: MigrationState; }

export class LegacyModernBridge implements Disposable {
  #surfaces = new Map<string, MigrationSurface>(); #disposed = false;
  register(input: Omit<MigrationSurface, 'state' | 'parityPasses' | 'parityFailures' | 'lastDigest'>): V7Result<MigrationSurface> {
    if (this.#disposed) return { ok: false, code: 'BRIDGE_DISPOSED', message: 'Migration bridge is disposed', retryable: false };
    if (!input.id || !input.owner || this.#surfaces.has(input.id)) return { ok: false, code: 'SURFACE_INVALID', message: 'Migration surface is invalid or duplicated', retryable: false };
    const surface = Object.freeze({ ...input, state: 'legacy' as const, parityPasses: 0, parityFailures: 0, lastDigest: null }); this.#surfaces.set(input.id, surface); return { ok: true, value: surface };
  }
  markShadow(id: string): boolean { const item = this.#surfaces.get(id); if (!item || item.state !== 'legacy') return false; this.#surfaces.set(id, Object.freeze({ ...item, state: 'shadow' })); return true; }
  recordParity(id: string, legacyDigest: string, modernDigest: string): ParityResult | null {
    const item = this.#surfaces.get(id); if (!item || !['shadow', 'verified'].includes(item.state)) return null; const equal = legacyDigest === modernDigest;
    const nextState: MigrationState = equal ? 'verified' : 'blocked'; const next = Object.freeze({ ...item, state: nextState, parityPasses: item.parityPasses + Number(equal), parityFailures: item.parityFailures + Number(!equal), lastDigest: modernDigest }); this.#surfaces.set(id, next); return Object.freeze({ surface: id, equal, legacyDigest, modernDigest, state: nextState });
  }
  promote(id: string): boolean { const item = this.#surfaces.get(id); if (!item || item.state !== 'verified' || item.parityPasses < 1 || item.parityFailures > 0) return false; this.#surfaces.set(id, Object.freeze({ ...item, state: 'promoted' })); return true; }
  block(id: string): boolean { const item = this.#surfaces.get(id); if (!item) return false; this.#surfaces.set(id, Object.freeze({ ...item, state: 'blocked' })); return true; }
  get(id: string): MigrationSurface | undefined { return this.#surfaces.get(id); }
  surfaces(): readonly MigrationSurface[] { return Object.freeze([...this.#surfaces.values()].sort((a, b) => a.id.localeCompare(b.id))); }
  stats(): Readonly<Record<MigrationState, number>> { const result: Record<MigrationState, number> = { legacy: 0, shadow: 0, verified: 0, promoted: 0, blocked: 0 }; for (const item of this.#surfaces.values()) result[item.state] += 1; return Object.freeze(result); }
  dispose(): void { this.#disposed = true; this.#surfaces.clear(); }
}
