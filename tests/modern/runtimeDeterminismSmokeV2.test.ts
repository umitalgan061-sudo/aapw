import { describe, expect, it } from 'vitest';
import { runContractMatrix, defaultContractCases } from '../../src/3d/modern/runtimeContractMatrixV2.ts';

describe('runtime determinism smoke v2', () => {
  it('returns identical contract results for identical inputs', () => {
    const factory = (domain: string): unknown => domain === 'combat' ? 'active' : domain === 'streaming' ? { used: 10, budget: 100 } : 10;
    const a = runContractMatrix(defaultContractCases, (test) => factory(test.domain));
    const b = runContractMatrix(defaultContractCases, (test) => factory(test.domain));
    expect(a).toEqual(b);
  });

  it('keeps result ordering stable', () => {
    const results = runContractMatrix(defaultContractCases, () => 1);
    expect(results.map((result) => result.id)).toEqual(defaultContractCases.map((test) => test.id));
  });
});
