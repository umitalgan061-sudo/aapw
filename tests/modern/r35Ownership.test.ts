import { describe, expect, it } from 'vitest';
import {
  createCompatibilityEntry,
  createLegacyEntry,
  createTypedEntry,
  createVendorEntry,
  evaluateTypeScriptOwnership,
  mergeOwnershipReports,
  summarizeOwnership,
} from '../../src/3d/nextgen/r35/typescriptOwnership';

describe('R35 TypeScript ownership governance', () => {
  it('accepts typed sources and compatibility shims with complete evidence', () => {
    const report = evaluateTypeScriptOwnership([
      createTypedEntry('src/app/runtime.ts'),
      createCompatibilityEntry('src/app/runtime.js'),
      createVendorEntry('src/vendor/library.js'),
    ]);
    expect(report.ok).toBe(true);
    expect(report.typed).toBe(1);
    expect(report.compatibility).toBe(1);
    expect(report.vendor).toBe(1);
    expect(summarizeOwnership(report)).toContain('PASS');
  });

  it('rejects active JavaScript without a typed ownership boundary', () => {
    const report = evaluateTypeScriptOwnership([{
      path: 'src/game/active.js',
      kind: 'untyped',
      hasTypeScriptOwner: false,
      hasCompatibilityMarker: false,
      importsTypedOwner: false,
      exportsNamedSurface: false,
    }]);
    expect(report.ok).toBe(false);
    expect(report.findings[0]?.code).toBe('active-javascript');
  });

  it('can combine multiple ownership reports', () => {
    const first = evaluateTypeScriptOwnership([createTypedEntry('src/a.ts')]);
    const second = evaluateTypeScriptOwnership([createLegacyEntry('src/b.legacy.js')]);
    const merged = mergeOwnershipReports([first, second]);
    expect(merged.scanned).toBe(2);
    expect(merged.legacy).toBe(1);
    expect(merged.ok).toBe(true);
  });
});
