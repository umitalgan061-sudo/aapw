import { describe, expect, it } from 'vitest';
import { validatePayload, sanitizeId } from '../../src/3d/modern/runtimeSecurityV2.ts';
import { scoreRuntimeHealth } from '../../src/3d/modern/healthScoringV2.ts';
import { summarizeContractMatrix, runContractMatrix, defaultContractCases } from '../../src/3d/modern/runtimeContractMatrixV2.ts';

describe('runtime boundary smoke v2', () => {
  it('accepts representative bounded payloads', () => {
    const payload = { id: sanitizeId('player:1'), values: Array.from({ length: 4 }, (_, index) => index) };
    expect(validatePayload(payload).accepted).toBe(true);
  });

  it('keeps pathological health inputs finite and actionable', () => {
    const result = scoreRuntimeHealth({ frameTimeMs: 999, gpuTimeMs: 999, droppedFrames: 999, residentBytes: 999, memoryBudgetBytes: 100, networkRttMs: 999, networkLoss01: 1, activeEntities: 999, entityBudget: 100 });
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('runs canonical contracts without exceeding bounded case count', () => {
    const cases = [...defaultContractCases, ...defaultContractCases, ...defaultContractCases];
    const results = runContractMatrix(cases, (test) => test.domain === 'combat' ? 'idle' : 1);
    const summary = summarizeContractMatrix(results);
    expect(summary.total).toBe(cases.length);
    expect(summary.total).toBeLessThanOrEqual(512);
  });
});
