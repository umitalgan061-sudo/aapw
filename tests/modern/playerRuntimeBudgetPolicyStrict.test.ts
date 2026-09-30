import { describe, expect, it } from 'vitest';
import {
  PLAYER_RUNTIME_BUDGET_LIMITS,
  PLAYER_RUNTIME_BUDGET_VERSION,
  buildRuntimeBudgetDecision,
  calculatePollInterval,
  calculateVerificationTimeout,
  classifyRuntimeEnvironment,
  compareRuntimeBudgets,
  normalizeRuntimeFrameSamples,
  summarizeRuntimeFrameSamples,
  validateRuntimeBudgetDecision,
} from '../../src/3d/gameplay/playerRuntimeBudgetPolicy.ts';

describe('Kızıl Ufuk runtime budget strict owner', () => {
  it('normalizes hostile samples to finite bounded frame deltas', () => {
    const samples = normalizeRuntimeFrameSamples([Number.NaN, Number.POSITIVE_INFINITY, -1, 0.016, 31]);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(samples.every(v => v >= PLAYER_RUNTIME_BUDGET_LIMITS.minimumFrameSeconds)).toBe(true);
    expect(samples.every(v => v <= PLAYER_RUNTIME_BUDGET_LIMITS.maximumFrameSeconds)).toBe(true);
  });

  it('classifies environments deterministically from the same summary', () => {
    const summary = summarizeRuntimeFrameSamples([0.016, 0.017, 0.016, 0.018]);
    expect(classifyRuntimeEnvironment(summary)).toBe('normal');
    expect(classifyRuntimeEnvironment(summary)).toBe(classifyRuntimeEnvironment(summary));
  });

  it('keeps verification timeout and poll interval bounded', () => {
    const timeout = calculateVerificationTimeout(Number.POSITIVE_INFINITY, { fps: Number.NaN, meanSeconds: Number.POSITIVE_INFINITY }, { extraMultiplier: Number.POSITIVE_INFINITY });
    const poll = calculatePollInterval({ meanSeconds: Number.NaN }, { targetFramesPerPoll: Number.POSITIVE_INFINITY });
    expect(timeout).toBeGreaterThanOrEqual(PLAYER_RUNTIME_BUDGET_LIMITS.minimumTimeoutMs);
    expect(timeout).toBeLessThanOrEqual(PLAYER_RUNTIME_BUDGET_LIMITS.maximumTimeoutMs);
    expect(poll).toBeGreaterThanOrEqual(25);
    expect(poll).toBeLessThanOrEqual(PLAYER_RUNTIME_BUDGET_LIMITS.maximumPollIntervalMs);
  });

  it('keeps the complete decision receipt immutable and valid', () => {
    const decision = buildRuntimeBudgetDecision(
      [0.016, 0.017, 0.016, 0.018],
      { simulationSeconds: 3 },
    );
    expect(decision.version).toBe(PLAYER_RUNTIME_BUDGET_VERSION);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(validateRuntimeBudgetDecision(decision).valid).toBe(true);
  });

  it('detects a deterministic constraint delta between normal and slow samples', () => {
    const normal = compareRuntimeBudgets(
      [0.016, 0.017, 0.016, 0.018],
      [0.12, 0.13, 0.11, 0.12],
    );
    expect(normal.moreConstrained).toBe(true);
    expect(normal.right.classification).not.toBe(normal.left.classification);
    expect(normal.right.timeoutMs).toBeGreaterThanOrEqual(normal.left.timeoutMs);
  });
});
