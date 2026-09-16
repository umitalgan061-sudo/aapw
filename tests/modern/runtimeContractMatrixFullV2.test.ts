import { describe, expect, it } from 'vitest';
import { defaultContractCases, runContractMatrix, summarizeContractMatrix } from '../../src/3d/modern/runtimeContractMatrixV2.ts';

describe('full runtime contract matrix v2', () => {
  it('covers every declared runtime domain', () => {
    const results = runContractMatrix(defaultContractCases, (test) => {
      const values: Record<string, unknown> = {
        player: 100,
        combat: 'recovery',
        ai: 64,
        world: 20_000,
        render: Array.from({ length: 32 }, (_, index) => `entity-${index}`),
        network: 32 * 1024,
        persistence: 2,
        streaming: { used: 64 * 1024, budget: 512 * 1024 },
        security: 64,
      };
      return values[test.domain];
    });
    const summary = summarizeContractMatrix(results);
    expect(summary.domains).toHaveLength(9);
    expect(summary.passed).toBe(summary.total);
  });

  it('reports mixed healthy and unhealthy contracts deterministically', () => {
    const run = () => runContractMatrix(defaultContractCases, (test) => {
      if (test.domain === 'player') return 101;
      if (test.domain === 'network') return 300 * 1024;
      if (test.domain === 'streaming') return { used: 900, budget: 800 };
      return test.domain === 'combat' ? 'active' : 1;
    });
    expect(run()).toEqual(run());
    expect(summarizeContractMatrix(run()).failed).toBeGreaterThan(0);
  });
});
