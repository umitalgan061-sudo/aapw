import {
  resolveSettlementServiceInteraction,
  type SettlementServiceAction,
  type SettlementServiceContext,
  type SettlementServiceInteraction,
} from './settlementServiceInteraction';

export interface SettlementServiceActionPlanContext extends SettlementServiceContext {
  canAfford?: boolean;
  requiredItemIds?: readonly string[];
  ownedItemIds?: readonly string[];
}

export interface SettlementServiceActionPlan extends SettlementServiceInteraction {
  affordability: 'satisfied' | 'insufficient-data' | 'insufficient-funds';
  missingItemIds: readonly string[];
  executable: boolean;
}

function freezeIds(values: readonly string[] | undefined): readonly string[] {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze([...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]);
}

export function resolveSettlementServiceActionPlan(
  context: SettlementServiceActionPlanContext,
  action: SettlementServiceAction,
): SettlementServiceActionPlan {
  const interaction = resolveSettlementServiceInteraction(context, action);
  const requiredItemIds = freezeIds(context?.requiredItemIds);
  const ownedItemIds = new Set(freezeIds(context?.ownedItemIds));
  const missingItemIds = Object.freeze(requiredItemIds.filter((itemId) => !ownedItemIds.has(itemId)));
  const affordability =
    typeof context?.canAfford !== 'boolean'
      ? 'insufficient-data'
      : context.canAfford
        ? 'satisfied'
        : 'insufficient-funds';
  const executable = interaction.allowed && affordability === 'satisfied' && missingItemIds.length === 0;
  return Object.freeze({
    ...interaction,
    affordability,
    missingItemIds,
    executable,
  });
}
