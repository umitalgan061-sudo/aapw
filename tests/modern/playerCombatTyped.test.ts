import { describe, expect, it } from 'vitest';
import {
  attackCommitBudget,
  computeAttackCommitStep,
} from '../../src/3d/gameplay/player.ts';

describe('typed player combat math', () => {
  it('increases commit budget deterministically by combo step', () => {
    expect(attackCommitBudget(0.9, 1, 0.08)).toBeCloseTo(0.9);
    expect(attackCommitBudget(0.9, 2, 0.08)).toBeCloseTo(0.972);
    expect(attackCommitBudget(0.9, 3, 0.08)).toBeCloseTo(1.044);
  });

  it('never commits movement outside the active attack window', () => {
    expect(computeAttackCommitStep(0, 0.1, 0.2, 1, 1)).toBeCloseTo(0.5);
    expect(computeAttackCommitStep(0.2, 0.3, 0.2, 1, 1)).toBe(0);
    expect(computeAttackCommitStep(0.15, 0.3, 0.2, 1, 0.2)).toBeCloseTo(0.2);
  });

  it('clamps invalid/negative combat budget inputs to safe deterministic values', () => {
    expect(attackCommitBudget(-2, 0)).toBe(0);
    expect(computeAttackCommitStep(-1, 1, 0.2, -1, 4)).toBe(0);
  });
});
