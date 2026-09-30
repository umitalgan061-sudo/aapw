import { describe, expect, it } from 'vitest';
import { evaluateTypeScriptOwnership, summarizeHealth, type HealthGateResult } from '../../src/platform/projectHealth.ts';

const passed = (id: string): HealthGateResult => ({
  id, status: 'passed', exitCode: 0, durationMs: 10, stdout: '', stderr: '',
});

describe('project health aggregation', () => {
  it('returns a deterministic success summary when every gate passes', () => {
    const summary = summarizeHealth([passed('a'), passed('b')], 20);
    expect(summary).toEqual({ ok: true, total: 2, passed: 2, failed: 0, timedOut: 0, durationMs: 20, gates: [passed('a'), passed('b')] });
  });
  it('marks timeout and failure states as unhealthy', () => {
    const summary = summarizeHealth([
      passed('a'),
      { ...passed('b'), status: 'failed', exitCode: 1 },
      { ...passed('c'), status: 'timed-out', exitCode: null },
    ], 90);
    expect(summary.ok).toBe(false);
    expect(summary.failed).toBe(1);
    expect(summary.timedOut).toBe(1);
  });
});


describe('TypeScript ownership audit', () => {
  it('accepts vendor-free source trees with sibling TS owners', () => {
    const report = evaluateTypeScriptOwnership([
      'src/a.ts',
      'src/a.js',
      'src/b.ts',
      'src/b.js',
      'src/vendor/three.js',
      'src/c.legacy.js',
    ]);
    expect(report.scannedJavaScriptFiles).toBe(2);
    expect(report.compliantJavaScriptFiles).toBe(2);
    expect(report.violations).toEqual([]);
  });

  it('detects a source JavaScript file without a TypeScript owner', () => {
    const report = evaluateTypeScriptOwnership(['src/a.ts', 'src/a.js', 'src/orphan.js']);
    expect(report.violations).toEqual(['src/orphan.js']);
    expect(report.compliantJavaScriptFiles).toBe(1);
  });
});
