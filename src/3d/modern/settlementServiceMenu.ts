import {
  type SettlementServiceAction,
  type SettlementServiceContext,
  type SettlementServiceInteraction,
  resolveSettlementServiceInteraction,
} from './settlementServiceInteraction';

export interface SettlementServiceMenuEntry {
  action: SettlementServiceAction;
  label: string;
  enabled: boolean;
  reason: SettlementServiceInteraction['reason'];
  missingQuestIds: readonly string[];
  hint: string;
}

const ACTION_LABELS: Readonly<Record<SettlementServiceAction, string>> = {
  craft: 'Craft',
  repair: 'Repair',
  rest: 'Rest',
  trade: 'Trade',
  gather: 'Gather',
  train: 'Train',
  travel: 'Travel',
};

const ACTION_ORDER: readonly SettlementServiceAction[] = [
  'craft',
  'repair',
  'rest',
  'trade',
  'gather',
  'train',
  'travel',
];

function isAction(value: unknown): value is SettlementServiceAction {
  return ACTION_ORDER.includes(value as SettlementServiceAction);
}

export function buildSettlementServiceMenu(
  context: SettlementServiceContext,
): readonly SettlementServiceMenuEntry[] {
  const hasExplicitActions = Array.isArray(context?.availableActions);
  const actions = hasExplicitActions
    ? [...new Set(context.availableActions.filter(isAction))]
        .sort((left, right) => ACTION_ORDER.indexOf(left) - ACTION_ORDER.indexOf(right))
    : inferDefaultActions(context?.serviceKind);

  const entries = actions.map((action) => {
    const receipt = resolveSettlementServiceInteraction(context, action);
    return Object.freeze({
      action,
      label: ACTION_LABELS[action],
      enabled: receipt.allowed,
      reason: receipt.reason,
      missingQuestIds: receipt.missingQuestIds,
      hint: buildSettlementServiceHint(receipt),
    });
  });

  return Object.freeze(entries);
}

function buildSettlementServiceHint(receipt: SettlementServiceInteraction): string {
  switch (receipt.reason) {
    case 'allowed': return 'Available';
    case 'service-closed': return 'Service is closed';
    case 'access-denied': return 'Access denied';
    case 'quest-locked':
      return receipt.missingQuestIds.length > 0
        ? `Requires quest: ${receipt.missingQuestIds.join(', ')}`
        : 'Requires an unfinished quest';
    case 'action-unavailable': return 'Action unavailable here';
    case 'invalid-context': return 'Service unavailable';
  }
}

function inferDefaultActions(serviceKind: SettlementServiceContext['serviceKind']): readonly SettlementServiceAction[] {
  switch (serviceKind) {
    case 'blacksmith': return ['craft', 'repair'];
    case 'tavern': return ['rest'];
    case 'market': return ['trade'];
    case 'farm': return ['gather'];
    case 'barracks': return ['train'];
    case 'stable': return ['travel'];
    default: return [];
  }
}
