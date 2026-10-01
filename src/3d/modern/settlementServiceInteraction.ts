export type SettlementServiceKind =
  | 'blacksmith'
  | 'tavern'
  | 'market'
  | 'farm'
  | 'barracks'
  | 'stable';

export type SettlementServiceAction =
  | 'craft'
  | 'repair'
  | 'rest'
  | 'trade'
  | 'gather'
  | 'train'
  | 'travel';

export interface SettlementServiceContext {
  settlementId: string;
  serviceKind: SettlementServiceKind;
  isOpen: boolean;
  hasAccess: boolean;
  availableActions?: readonly SettlementServiceAction[];
  requiredQuestIds?: readonly string[];
  completedQuestIds?: readonly string[];
}

export interface SettlementServiceInteraction {
  settlementId: string;
  serviceKind: SettlementServiceKind;
  action: SettlementServiceAction;
  allowed: boolean;
  reason:
    | 'allowed'
    | 'service-closed'
    | 'access-denied'
    | 'quest-locked'
    | 'action-unavailable'
    | 'invalid-context';
  requiredQuestIds: readonly string[];
  missingQuestIds: readonly string[];
  availableActions: readonly SettlementServiceAction[];
}

const DEFAULT_ACTIONS: Readonly<Record<SettlementServiceKind, readonly SettlementServiceAction[]>> = {
  blacksmith: ['craft', 'repair'],
  tavern: ['rest'],
  market: ['trade'],
  farm: ['gather'],
  barracks: ['train'],
  stable: ['travel'],
};

function isServiceKind(value: unknown): value is SettlementServiceKind {
  return (
    value === 'blacksmith' ||
    value === 'tavern' ||
    value === 'market' ||
    value === 'farm' ||
    value === 'barracks' ||
    value === 'stable'
  );
}

function isAction(value: unknown): value is SettlementServiceAction {
  return (
    value === 'craft' ||
    value === 'repair' ||
    value === 'rest' ||
    value === 'trade' ||
    value === 'gather' ||
    value === 'train' ||
    value === 'travel'
  );
}

function freezeIds(values: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(values)) return Object.freeze([]);
  const unique = [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))];
  return Object.freeze(unique);
}

function freezeActions(
  serviceKind: SettlementServiceKind,
  values: readonly SettlementServiceAction[] | undefined,
): readonly SettlementServiceAction[] {
  const source = Array.isArray(values) ? values.filter(isAction) : DEFAULT_ACTIONS[serviceKind];
  return Object.freeze([...new Set(source)]);
}

export function resolveSettlementServiceInteraction(
  context: SettlementServiceContext,
  action: SettlementServiceAction,
): SettlementServiceInteraction {
  const requiredQuestIds = freezeIds(context?.requiredQuestIds);
  const completedQuestIds = new Set(freezeIds(context?.completedQuestIds));
  const missingQuestIds = Object.freeze(requiredQuestIds.filter((questId) => !completedQuestIds.has(questId)));
  const serviceKind = isServiceKind(context?.serviceKind) ? context.serviceKind : 'market';
  const availableActions = freezeActions(serviceKind, context?.availableActions);
  const base = {
    settlementId: typeof context?.settlementId === 'string' ? context.settlementId : '',
    serviceKind,
    action,
    requiredQuestIds,
    missingQuestIds,
    availableActions,
  };

  if (!context || !isServiceKind(context.serviceKind) || !isAction(action) || !base.settlementId) {
    return Object.freeze({
      ...base,
      action: isAction(action) ? action : 'trade',
      allowed: false,
      reason: 'invalid-context',
    });
  }

  if (!context.isOpen) {
    return Object.freeze({ ...base, allowed: false, reason: 'service-closed' });
  }

  if (!context.hasAccess) {
    return Object.freeze({ ...base, allowed: false, reason: 'access-denied' });
  }

  if (missingQuestIds.length > 0) {
    return Object.freeze({ ...base, allowed: false, reason: 'quest-locked' });
  }

  if (!availableActions.includes(action)) {
    return Object.freeze({ ...base, allowed: false, reason: 'action-unavailable' });
  }

  return Object.freeze({ ...base, allowed: true, reason: 'allowed' });
}
