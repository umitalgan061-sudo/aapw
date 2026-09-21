import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';

describe('R11 TypeScript source-of-truth policy', () => {
  it('rejects active JavaScript owners and accepts compatibility bridges', () => {
    const output = execFileSync('node', ['scripts/checkProductionTypeScriptSourceR11.mjs'], {
      encoding: 'utf8',
    });
    const report = JSON.parse(output);
    expect(report.policy).toBe('r11-typescript-source-of-truth');
    expect(report.activeSourceCoveragePercent).toBe(100);
    expect(report.verified).toBe(true);
    expect(report.compatibilityBridges).toBeGreaterThan(0);
  });
});
