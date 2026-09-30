import type { EntityId } from './contracts.ts';

export interface LegacyOwnerRecord {
  readonly legacyPath: string;
  readonly typedOwnerPath: string;
  readonly ownerKind: 'gameplay' | 'world' | 'editor' | 'runtime' | 'service';
  readonly activeOwner: 'typed' | 'legacy';
  readonly shimAllowed: boolean;
  readonly rollbackOnly: boolean;
}

export interface MigrationBoundaryReport {
  readonly total: number;
  readonly typedOwners: number;
  readonly legacyOwners: number;
  readonly invalid: readonly string[];
  readonly ready: boolean;
}

export class TypedOwnershipRegistry {
  #records = new Map<string, LegacyOwnerRecord>();

  register(record: LegacyOwnerRecord): void {
    const legacy = record.legacyPath.trim();
    const owner = record.typedOwnerPath.trim();
    if (!legacy || !owner) throw new RangeError('Migration paths cannot be empty');
    if (!owner.endsWith('.ts') && !owner.endsWith('.tsx')) throw new Error(`Typed owner must be TypeScript: ${owner}`);
    if (record.activeOwner === 'legacy' && record.rollbackOnly) throw new Error('Rollback-only records cannot remain active legacy owners');
    this.#records.set(legacy, { ...record, legacyPath: legacy, typedOwnerPath: owner });
  }

  registerMany(records: readonly LegacyOwnerRecord[]): void {
    for (const record of records) this.register(record);
  }

  get(legacyPath: string): LegacyOwnerRecord | undefined {
    return this.#records.get(legacyPath);
  }

  activeTypedOwners(): readonly LegacyOwnerRecord[] {
    return [...this.#records.values()]
      .filter((record) => record.activeOwner === 'typed')
      .sort((a, b) => a.typedOwnerPath.localeCompare(b.typedOwnerPath));
  }

  audit(): MigrationBoundaryReport {
    const invalid: string[] = [];
    let typedOwners = 0;
    let legacyOwners = 0;

    for (const record of this.#records.values()) {
      if (!record.typedOwnerPath.endsWith('.ts') && !record.typedOwnerPath.endsWith('.tsx')) {
        invalid.push(`non-typescript-owner:${record.typedOwnerPath}`);
      }
      if (record.activeOwner === 'legacy') {
        legacyOwners++;
        invalid.push(`legacy-active-owner:${record.legacyPath}`);
      } else {
        typedOwners++;
      }
      if (record.rollbackOnly && record.activeOwner !== 'typed') {
        invalid.push(`rollback-owner-not-typed:${record.legacyPath}`);
      }
      if (!record.shimAllowed && record.activeOwner === 'legacy') {
        invalid.push(`legacy-shim-not-allowed:${record.legacyPath}`);
      }
    }

    invalid.sort();
    return {
      total: this.#records.size,
      typedOwners,
      legacyOwners,
      invalid,
      ready: invalid.length === 0,
    };
  }

  exportManifest(): readonly LegacyOwnerRecord[] {
    return [...this.#records.values()]
      .sort((a, b) => a.legacyPath.localeCompare(b.legacyPath))
      .map((record) => structuredClone(record));
  }
}

export interface TypedFacade<TState, TCommand extends object, TEvent extends object> {
  readonly state: () => Readonly<TState>;
  dispatch(command: TCommand): readonly TEvent[];
}

export class LegacyCompatibilityFacade<TState, TCommand extends object, TEvent extends object> {
  readonly typed: TypedFacade<TState, TCommand, TEvent>;
  readonly allowedCommands: ReadonlySet<string>;

  constructor(typed: TypedFacade<TState, TCommand, TEvent>, allowedCommands: readonly string[]) {
    this.typed = typed;
    this.allowedCommands = new Set(allowedCommands);
  }

  dispatch(command: TCommand & { readonly type?: string }): readonly TEvent[] {
    const type = command.type;
    if (type && !this.allowedCommands.has(type)) {
      throw new Error(`Legacy compatibility command is outside migration allowlist: ${type}`);
    }
    return this.typed.dispatch(command);
  }

  snapshot(): Readonly<TState> {
    return this.typed.state();
  }
}

export interface OwnershipCutoverCandidate {
  readonly entity: EntityId;
  readonly legacySubsystem: string;
  readonly typedSubsystem: string;
  readonly blockers: readonly string[];
  readonly usageCount: number;
}

export function rankCutoverCandidates(
  candidates: readonly OwnershipCutoverCandidate[],
): readonly OwnershipCutoverCandidate[] {
  return [...candidates].sort((a, b) =>
    a.blockers.length - b.blockers.length ||
    b.usageCount - a.usageCount ||
    String(a.entity).localeCompare(String(b.entity)),
  );
}
