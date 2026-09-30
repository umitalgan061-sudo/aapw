import { describe, expect, it } from 'vitest';
import { summarizeR29Migration, type R29MigrationAudit, assertR29MigrationReady } from '../../src/3d/modern/r29/migrationAudit.ts';

describe('R29 migration audit contract', () => {
  it('formats migration summary deterministically', () => {
    const audit: R29MigrationAudit = { scanned: 8, typed: 3, shims: 5, legacy: 0, missingOwner: 0, entries: [] };
    expect(summarizeR29Migration(audit)).toBe('scanned=8 typed=3 shims=5 missingOwner=0');
  });

  it('passes when every production JavaScript file has a TypeScript owner', () => {
    expect(() => assertR29MigrationReady({ scanned: 1, typed: 1, shims: 0, legacy: 0, missingOwner: 0, entries: [] })).not.toThrow();
  });

  it('fails closed when an owner is missing', () => {
    expect(() => assertR29MigrationReady({
      scanned: 1,
      typed: 0,
      shims: 0,
      legacy: 0,
      missingOwner: 1,
      entries: [{ javascriptPath: 'src/example.js', typescriptPath: null, status: 'missing-owner', reason: 'missing' }],
    })).toThrow(/R29_MIGRATION_OWNER_GAP/);
  });
});
