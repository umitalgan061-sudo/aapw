import { describe, expect, it } from 'vitest';
import {
  getDialogueConditionFailureHint,
  orderDialogueConditionFailures,
} from '../../src/3d/modern/dialogueConditionFailurePolicy.ts';

describe('dialogue condition failure UX policy', () => {
  it('maps failures to deterministic actions and priorities', () => {
    expect(getDialogueConditionFailureHint('service-unavailable')).toEqual({
      failure: 'service-unavailable',
      action: 'show-service',
      priority: 50,
    });
    expect(getDialogueConditionFailureHint('invalid-condition').action).toBe('hide-branch');
  });

  it('orders and de-duplicates aggregate failures for stable UX', () => {
    expect(orderDialogueConditionFailures([
      'service-unavailable',
      'objective-incomplete',
      'service-unavailable',
      'reputation-too-low',
      'missing-quest',
    ])).toEqual([
      'missing-quest',
      'objective-incomplete',
      'reputation-too-low',
      'service-unavailable',
    ]);
  });
});
