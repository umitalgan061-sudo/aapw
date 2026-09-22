import { describe, expect, it } from 'vitest';
import {
  summarizeDialogueConditionEvaluation,
  summarizeDialogueConditionFailures,
} from '../../src/3d/modern/dialogueConditionFailurePolicy.ts';

describe('dialogue condition failure summary', () => {
  it('selects the primary UX hint and preserves stable ordering', () => {
    const summary = summarizeDialogueConditionFailures([
      'service-unavailable',
      'objective-incomplete',
      'missing-quest',
      'objective-incomplete',
    ]);

    expect(summary.failures).toEqual([
      'missing-quest',
      'objective-incomplete',
      'service-unavailable',
    ]);
    expect(summary.primary).toEqual({
      failure: 'missing-quest',
      action: 'hide-branch',
      priority: 0,
    });
    expect(summary.hideBranch).toBe(true);
    expect(summary.hints.map((hint) => hint.action)).toEqual([
      'hide-branch',
      'show-quest',
      'show-service',
    ]);
  });

  it('projects a detailed gate evaluation without requiring consumers to reshape failures', () => {
    const summary = summarizeDialogueConditionEvaluation({
      failures: ['service-unavailable', 'reputation-too-low'],
    });

    expect(summary.failures).toEqual(['reputation-too-low', 'service-unavailable']);
    expect(summary.primary.action).toBe('show-reputation');
    expect(summary.hideBranch).toBe(false);
  });

  it('returns a safe hidden-branch summary for an empty failure set', () => {
    const summary = summarizeDialogueConditionFailures([]);
    expect(summary.failures).toEqual([]);
    expect(summary.hints).toEqual([]);
    expect(summary.primary.action).toBe('hide-branch');
    expect(summary.hideBranch).toBe(false);
  });
});
