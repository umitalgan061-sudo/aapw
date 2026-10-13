export type SettlementCraftIngredientMap = Readonly<Record<string, number>>;

export interface SettlementCraftRecipe {
  readonly id: string;
  readonly label?: string;
  readonly station: string;
  readonly ingredients: SettlementCraftIngredientMap;
  readonly xp: number;
  readonly minutes: number;
  readonly qualityBase?: number;
}

export interface SettlementCraftItem {
  readonly id: string;
  readonly label?: string;
  readonly buy?: number;
}

export interface SettlementCraftPreviewInput {
  readonly recipe: SettlementCraftRecipe | null | undefined;
  readonly resolveItem: (itemId: string) => SettlementCraftItem | null | undefined;
  readonly inventory?: Readonly<Record<string, number>> | null;
  readonly copper?: number | null;
  readonly skillLevel?: number | null;
  readonly stationAvailable?: boolean;
}

export interface SettlementCraftIngredientRow {
  readonly itemId: string;
  readonly label: string;
  readonly required: number;
  readonly owned: number;
  readonly missing: number;
  readonly unitPrice: number;
  readonly totalPrice: number;
}

export interface SettlementCraftPreview {
  readonly ok: boolean;
  readonly reason: 'ready' | 'unknown-recipe' | 'station-unavailable' | 'missing-ingredients' | 'insufficient-copper' | 'missing-item-definition';
  readonly recipeId: string | null;
  readonly station: string | null;
  readonly label: string | null;
  readonly rows: readonly SettlementCraftIngredientRow[];
  readonly missingItemIds: readonly string[];
  readonly totalIngredientValue: number;
  readonly craftMinutes: number;
  readonly xp: number;
  readonly qualityBase: number;
  readonly signature: string;
}

const clampNonNegative = (value: unknown, fallback = 0): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
};

const cleanId = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const freezeDeep = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
};

const stableNumber = (value: number): string => Number(value.toFixed(4)).toString();

export function buildSettlementCraftPreview(input: SettlementCraftPreviewInput): SettlementCraftPreview {
  const recipe = input?.recipe;
  if (!recipe || !cleanId(recipe.id)) {
    return freezeDeep({
      ok: false, reason: 'unknown-recipe', recipeId: null, station: null, label: null,
      rows: [], missingItemIds: [], totalIngredientValue: 0, craftMinutes: 0,
      xp: 0, qualityBase: 0, signature: 'craft:unknown-recipe',
    });
  }

  const ingredientIds = Object.keys(recipe.ingredients ?? {}).filter(Boolean).sort();
  const inventory = input.inventory ?? {};
  const rows: SettlementCraftIngredientRow[] = [];
  const missingItemIds: string[] = [];
  let totalIngredientValue = 0;

  for (const itemId of ingredientIds) {
    const item = input.resolveItem(itemId);
    if (!item) {
      missingItemIds.push(itemId);
      continue;
    }
    const required = Math.ceil(clampNonNegative(recipe.ingredients[itemId]));
    const owned = Math.floor(clampNonNegative(inventory[itemId]));
    const missing = Math.max(0, required - owned);
    const unitPrice = Math.floor(clampNonNegative(item.buy));
    const totalPrice = required * unitPrice;
    totalIngredientValue += totalPrice;
    rows.push({
      itemId,
      label: cleanId(item.label) || itemId,
      required,
      owned,
      missing,
      unitPrice,
      totalPrice,
    });
  }

  const stationAvailable = input.stationAvailable !== false;
  const copper = Math.floor(clampNonNegative(input.copper));
  const skillLevel = Math.floor(clampNonNegative(input.skillLevel));
  const craftMinutes = Math.max(1, Math.round(clampNonNegative(recipe.minutes, 1)));
  const xp = Math.max(0, Math.round(clampNonNegative(recipe.xp)));
  const qualityBase = Math.min(1, Math.max(0, Number(recipe.qualityBase ?? 0)) + Math.min(0.2, skillLevel * 0.01));
  const missingIngredients = rows.some((row) => row.missing > 0);
  const reason = missingItemIds.length > 0
    ? 'missing-item-definition'
    : !stationAvailable
      ? 'station-unavailable'
      : missingIngredients
        ? 'missing-ingredients'
        : copper < totalIngredientValue
          ? 'insufficient-copper'
          : 'ready';

  const signature = [
    'craft', recipe.id, recipe.station, reason, stableNumber(totalIngredientValue), craftMinutes,
    xp, stableNumber(qualityBase), rows.map((row) => `${row.itemId}:${row.required}:${row.owned}`).join(','),
  ].join('|');

  return freezeDeep({
    ok: reason === 'ready',
    reason,
    recipeId: recipe.id,
    station: recipe.station,
    label: cleanId(recipe.label) || recipe.id,
    rows,
    missingItemIds,
    totalIngredientValue,
    craftMinutes,
    xp,
    qualityBase,
    signature,
  });
}

export function isSettlementCraftPreview(value: unknown): value is SettlementCraftPreview {
  return Boolean(value && typeof value === 'object' && typeof (value as SettlementCraftPreview).signature === 'string');
}
