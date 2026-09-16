import { describe, expect, it } from 'vitest';
import { assertContractMatrix, defaultContractCases, runContractMatrix, summarizeContractMatrix } from '../../src/3d/modern/runtimeContractMatrixV2.ts';

describe('runtime contract matrix v2', () => {
  it('passes the canonical invariant set for a healthy runtime', () => {
    const results = runContractMatrix(defaultContractCases, (test) => {
      switch (test.domain) {
        case 'player': return 75;
        case 'combat': return 'active';
        case 'ai': return 32;
        case 'world': return 1000;
        case 'render': return ['player', 'terrain'];
        case 'network': return 2048;
        case 'persistence': return 2;
        case 'streaming': return { used: 100, budget: 1000 };
        case 'security': return 16;
      }
    });
    expect(summarizeContractMatrix(results).failed).toBe(0);
    expect(() => assertContractMatrix(results)).not.toThrow();
  });

  it('identifies a critical invariant violation without masking it', () => {
    const results = runContractMatrix(defaultContractCases, (test) => {
      if (test.domain === 'network') return 1024 * 1024;
      if (test.domain === 'security') return 512;
      if (test.domain === 'streaming') return { used: 2, budget: 1 };
      if (test.domain === 'player') return -1;
      return test.domain === 'combat' ? 'idle' : 0;
    });
    const summary = summarizeContractMatrix(results);
    expect(summary.criticalFailures).toBeGreaterThan(0);
    expect(() => assertContractMatrix(results)).toThrow(/Critical runtime contract failures/);
  });
});
