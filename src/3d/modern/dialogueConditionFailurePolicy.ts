import type { DialogueConditionFailure } from './questDialogueConditions.ts';

export type DialogueConditionFailureAction = 'show-quest' | 'show-reputation' | 'show-service' | 'hide-branch';

export interface DialogueConditionFailureHint {
  readonly failure: DialogueConditionFailure;
  readonly action: DialogueConditionFailureAction;
  readonly priority: number;
}

const HINTS: Readonly<Record<DialogueConditionFailure, DialogueConditionFailureHint>> = Object.freeze({
  'missing-quest': Object.freeze({ failure: 'missing-quest', action: 'hide-branch', priority: 0 }),
  'invalid-condition': Object.freeze({ failure: 'invalid-condition', action: 'hide-branch', priority: 0 }),
  'quest-status-mismatch': Object.freeze({ failure: 'quest-status-mismatch', action: 'show-quest', priority: 10 }),
  'objective-missing': Object.freeze({ failure: 'objective-missing', action: 'show-quest', priority: 20 }),
  'objective-incomplete': Object.freeze({ failure: 'objective-incomplete', action: 'show-quest', priority: 30 }),
  'reputation-too-low': Object.freeze({ failure: 'reputation-too-low', action: 'show-reputation', priority: 40 }),
  'service-unavailable': Object.freeze({ failure: 'service-unavailable', action: 'show-service', priority: 50 }),
});

export const getDialogueConditionFailureHint = (failure: DialogueConditionFailure): DialogueConditionFailureHint => HINTS[failure];

export const orderDialogueConditionFailures = (
  failures: readonly DialogueConditionFailure[],
): readonly DialogueConditionFailure[] => Object.freeze([...new Set(failures)].sort((left, right) => {
  const priorityDelta = HINTS[left].priority - HINTS[right].priority;
  return priorityDelta || left.localeCompare(right);
}));
