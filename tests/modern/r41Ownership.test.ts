
import { describe, expect, it } from 'vitest';
import { scanTypeScriptOwnership } from '../../src/3d/strict/r41/ownership.ts';

describe('R41 TypeScript ownership', () => {
  it('keeps active application JavaScript behind typed compatibility boundaries', async () => {
    const report = await scanTypeScriptOwnership();
    expect(report.ok).toBe(true);
    expect(report.scannedJavaScript).toBeGreaterThan(100);
    expect(report.compatibilityShims).toBeGreaterThan(100);
    expect(report.missingOwners).toEqual([]);
    expect(report.invalidShims).toEqual([]);
    expect(report.unownedMjs).toEqual([]);
  });

  it('counts vendor code without treating it as application debt', async () => {
    const report = await scanTypeScriptOwnership();
    expect(report.vendoredJavaScript).toBeGreaterThan(0);
  });

  it('counts the editor extension as generated/non-runtime surface', async () => {
    const report = await scanTypeScriptOwnership();
    expect(report.generatedArtifacts).toBeGreaterThan(0);
  });
});
