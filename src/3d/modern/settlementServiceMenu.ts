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

export function buildSettlementServiceMenu(
  context: SettlementServiceContext,
): readonly SettlementServiceMenuEntry[] {
  const actions = Array.isArray(context?.availableActions) && context.availableActions.length > 0
    ? [...new Set(context.availableActions)]
    : [];

  const sourceActions = actions.length > 0 ? actions : inferDefaultActions(context?.serviceKind);
  const entries = sourceActions.map((action) => {
    const receipt = resolveSettlementServiceInteraction(context, action);
    return Object.freeze({
      action,
      label: ACTION_LABELS[action],
      enabled: receipt.allowed,
      reason: receipt.reason,
      missingQuestIds: receipt.missingQuestIds,
    });
  });

  return Object.freeze(entries);
}

function inferDefaultActions(serviceKind: SettlementServiceContext['serviceKind']): readonly SettlementServiceAction[] {
  switch (serviceKind) {
    case 'blacksmith':
      return ['craft', 'repair'];
    case 'tavern':
      return ['rest'];
    case 'market':
      return ['trade'];
    case 'farm':
      return ['gather'];
    case 'barracks':
      return ['train'];
    case 'stable':
      return ['travel'];
    default:
      return [];
  }
}
