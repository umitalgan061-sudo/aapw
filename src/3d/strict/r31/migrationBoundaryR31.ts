export type OwnershipStateR31 = 'legacy' | 'shadow' | 'typed' | 'retired';

export interface OwnershipRecordR31 {
  readonly id: string;
  readonly legacyPath: string;
  readonly typedPath: string;
  readonly state: OwnershipStateR31;
  readonly parityVerified: boolean;
  readonly blockers: readonly string[];
}

export interface OwnershipDecisionR31 {
  readonly ok: boolean;
  readonly state: OwnershipStateR31;
  readonly reason: string;
}

export class TypeScriptOwnershipBoundaryR31 {
  readonly #records = new Map<string, OwnershipRecordR31>();

  register(input: Omit<OwnershipRecordR31, 'parityVerified' | 'blockers'>): void {
    if (this.#records.has(input.id)) throw new Error(`Duplicate ownership id: ${input.id}`);
    this.#records.set(input.id, Object.freeze({
      ...input,
      parityVerified: false,
      blockers: Object.freeze([]),
    }));
  }

  parity(id: string, verified: boolean): OwnershipDecisionR31 {
    const current = this.#records.get(id);
    if (!current) return Object.freeze({ ok: false, state: 'legacy', reason: 'unknown-owner' });
    const state: OwnershipStateR31 = verified ? 'typed' : 'shadow';
    this.#records.set(id, Object.freeze({ ...current, parityVerified: verified, state }));
    return Object.freeze({
      ok: verified,
      state,
      reason: verified ? 'parity-verified' : 'parity-pending',
    });
  }

  block(id: string, reason: string): OwnershipDecisionR31 {
    const current = this.#records.get(id);
    if (!current) return Object.freeze({ ok: false, state: 'legacy', reason: 'unknown-owner' });
    const blockers = [...current.blockers, reason.trim()].filter(Boolean);
    const next: OwnershipRecordR31 = Object.freeze({
      ...current,
      state: 'shadow',
      blockers: Object.freeze([...new Set(blockers)]),
    });
    this.#records.set(id, next);
    return Object.freeze({ ok: false, state: next.state, reason: 'blocked' });
  }

  promote(id: string): OwnershipDecisionR31 {
    const current = this.#records.get(id);
    if (!current) return Object.freeze({ ok: false, state: 'legacy', reason: 'unknown-owner' });
    if (!current.parityVerified) return Object.freeze({ ok: false, state: current.state, reason: 'parity-required' });
    if (current.blockers.length > 0) return Object.freeze({ ok: false, state: current.state, reason: 'blockers-present' });
    const promoted = Object.freeze({ ...current, state: 'typed' as const });
    this.#records.set(id, promoted);
    return Object.freeze({ ok: true, state: 'typed', reason: 'typed-owner-active' });
  }

  retire(id: string): OwnershipDecisionR31 {
    const current = this.#records.get(id);
    if (!current) return Object.freeze({ ok: false, state: 'legacy', reason: 'unknown-owner' });
    if (!current.parityVerified || current.blockers.length > 0) {
      return Object.freeze({ ok: false, state: current.state, reason: 'retirement-guard-failed' });
    }
    this.#records.set(id, Object.freeze({ ...current, state: 'retired' as const }));
    return Object.freeze({ ok: true, state: 'retired', reason: 'legacy-surface-can-be-archived' });
  }

  list(): readonly OwnershipRecordR31[] {
    return Object.freeze([...this.#records.values()].sort((a, b) => a.id.localeCompare(b.id)));
  }

  blockers(): readonly OwnershipRecordR31[] {
    return Object.freeze(this.list().filter((record) => record.blockers.length > 0));
  }
}
