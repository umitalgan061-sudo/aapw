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
    | 'action-unavailable'
    | 'invalid-context';
  requiredQuestIds: readonly string[];
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

export function resolveSettlementServiceInteraction(
  context: SettlementServiceContext,
  action: SettlementServiceAction,
): SettlementServiceInteraction {
  const requiredQuestIds = freezeIds(context?.requiredQuestIds);
  const base = {
    settlementId: typeof context?.settlementId === 'string' ? context.settlementId : '',
    serviceKind: context?.serviceKind,
    action,
    requiredQuestIds,
  };

  if (!context || !isServiceKind(context.serviceKind) || !isAction(action) || !base.settlementId) {
    return Object.freeze({
      ...base,
      serviceKind: isServiceKind(context?.serviceKind) ? context.serviceKind : 'market',
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

  const available = Array.isArray(context.availableActions)
    ? context.availableActions.filter(isAction)
    : DEFAULT_ACTIONS[context.serviceKind];

  if (!available.includes(action)) {
    return Object.freeze({ ...base, allowed: false, reason: 'action-unavailable' });
  }

  return Object.freeze({ ...base, allowed: true, reason: 'allowed' });
}
