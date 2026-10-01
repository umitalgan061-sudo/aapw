import { describe, expect, it } from 'vitest';
import { resolveDialogueConditionBranchDecision } from '../../src/3d/modern/dialogueConditionBranchDecision.ts';
import type { DialogueConditionFailureSummary } from '../../src/3d/modern/dialogueConditionFailurePolicy.ts';

const summary = (hideBranch: boolean): DialogueConditionFailureSummary => ({
  failures: ['missing-quest', 'service-unavailable'],
  hints: [
    { failure: 'missing-quest', action: 'hide-branch', priority: 0 },
    { failure: 'service-unavailable', action: 'show-service', priority: 50 },
  ],
  primary: { failure: 'missing-quest', action: 'hide-branch', priority: 0 },
  hideBranch,
});

describe('resolveDialogueConditionBranchDecision', () => {
  it('keeps an any-mode branch visible when one alternative passed', () => {
    const decision = resolveDialogueConditionBranchDecision({ passed: true }, summary(true));
    expect(decision.visible).toBe(true);
    expect(decision.action).toBe('none');
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.failures)).toBe(true);
  });

  it('hides a failed branch when the policy marks it hidden', () => {
    const decision = resolveDialogueConditionBranchDecision({ passed: false }, summary(true));
    expect(decision.visible).toBe(false);
    expect(decision.action).toBe('hide-branch');
  });

  it('keeps a recoverable failed branch visible for actionable UX', () => {
    const decision = resolveDialogueConditionBranchDecision({ passed: false }, summary(false));
    expect(decision.visible).toBe(true);
    expect(decision.action).toBe('hide-branch');
  });
});
