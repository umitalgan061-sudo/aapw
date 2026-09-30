import { describe, expect, it } from 'vitest';
import { collectMigrationReport } from '../../scripts/checkSourceLanguageMigrationR12.mjs';

describe('R12 TypeScript production language boundary', () => {
  it('contains only compatibility JavaScript shims in migrated scopes', async () => {
    const report = await collectMigrationReport();
    expect(report.version).toBe(12);
    expect(report.clean).toBe(true);
    expect(report.implementationJavaScriptCount).toBe(0);
    expect(report.compatibilityShimCount).toBeGreaterThan(0);
    expect(report.typeScriptOwnerCount).toBe(report.compatibilityShimCount);
  });
});
