import type {
  DialogueConditionsEvaluation,
} from './questDialogueConditions.ts';
import type {
  DialogueConditionFailureAction,
  DialogueConditionFailureHint,
  DialogueConditionFailureSummary,
} from './dialogueConditionFailurePolicy.ts';

export type DialogueConditionBranchAction = DialogueConditionFailureAction | 'none';

export interface DialogueConditionBranchDecision {
  readonly visible: boolean;
  readonly action: DialogueConditionBranchAction;
  readonly primary: DialogueConditionFailureHint;
  readonly failures: readonly DialogueConditionFailureHint[];
}

/**
 * Resolves the runtime-facing dialogue branch decision without changing the
 * existing condition gate or failure policy. A passing `any` evaluation keeps
 * the branch visible even when non-winning alternatives also failed.
 */
export const resolveDialogueConditionBranchDecision = (
  evaluation: Pick<DialogueConditionsEvaluation, 'passed'>,
  summary: DialogueConditionFailureSummary,
): DialogueConditionBranchDecision => {
  const visible = evaluation.passed || !summary.hideBranch;
  const action: DialogueConditionBranchAction = evaluation.passed ? 'none' : summary.primary.action;
  return Object.freeze({
    visible,
    action,
    primary: summary.primary,
    failures: Object.freeze([...summary.hints]),
  });
};
