const DEFAULT_LIMIT = 24;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const normalizeId = (value) => String(value ?? '').trim();

const normalizeIngredient = (ingredient) => {
  const id = normalizeId(ingredient?.id ?? ingredient?.itemId);
  const quantity = Math.max(0, Math.floor(finite(ingredient?.quantity, 0)));
  return id && quantity > 0 ? { id, quantity } : null;
};

const normalizeRecipe = (recipe, index) => {
  const id = normalizeId(recipe?.id ?? recipe?.recipeId) || `recipe-${index + 1}`;
  const station = normalizeId(recipe?.station ?? recipe?.workstation ?? 'general') || 'general';
  const output = normalizeId(recipe?.output?.id ?? recipe?.outputId ?? recipe?.itemId);
  const outputQuantity = Math.max(0, Math.floor(finite(recipe?.output?.quantity ?? recipe?.outputQuantity, 1)));
  const ingredients = Array.isArray(recipe?.ingredients)
    ? recipe.ingredients.map(normalizeIngredient).filter(Boolean).sort((a, b) => a.id.localeCompare(b.id))
    : [];
  return output && outputQuantity > 0 && ingredients.length > 0
    ? { id, station, output, outputQuantity, ingredients }
    : null;
};

const countItem = (inventory, id) => {
  if (inventory instanceof Map) return Math.max(0, finite(inventory.get(id), 0));
  if (Array.isArray(inventory)) {
    return inventory.reduce((sum, entry) => sum + (normalizeId(entry?.id ?? entry?.itemId) === id ? Math.max(0, finite(entry?.quantity ?? entry?.count, 0)) : 0), 0);
  }
  if (inventory && typeof inventory === 'object') return Math.max(0, finite(inventory[id], 0));
  return 0;
};

export function buildSettlementCraftingPlan({ recipes = [], inventory = {}, station = null, limit = DEFAULT_LIMIT } = {}) {
  const normalizedStation = normalizeId(station);
  const boundedLimit = Math.max(1, Math.min(DEFAULT_LIMIT, Math.floor(finite(limit, DEFAULT_LIMIT))));
  const plan = recipes.map(normalizeRecipe).filter(Boolean)
    .filter((recipe) => !normalizedStation || recipe.station === normalizedStation)
    .map((recipe) => {
      const missing = recipe.ingredients
        .map((ingredient) => ({ ...ingredient, owned: countItem(inventory, ingredient.id) }))
        .filter((ingredient) => ingredient.owned < ingredient.quantity);
      return {
        ...recipe,
        craftable: missing.length === 0,
        missing,
      };
    })
    .sort((a, b) => Number(b.craftable) - Number(a.craftable) || a.station.localeCompare(b.station) || a.id.localeCompare(b.id))
    .slice(0, boundedLimit);

  return Object.freeze({
    station: normalizedStation || null,
    recipes: Object.freeze(plan.map((recipe) => Object.freeze({ ...recipe, ingredients: Object.freeze(recipe.ingredients), missing: Object.freeze(recipe.missing) }))),
    craftableCount: plan.filter((recipe) => recipe.craftable).length,
    blockedCount: plan.filter((recipe) => !recipe.craftable).length,
  });
}

export function createSettlementCraftingSnapshot(plan) {
  return {
    version: 1,
    station: plan?.station ?? null,
    craftableCount: Math.max(0, Math.floor(finite(plan?.craftableCount, 0))),
    blockedCount: Math.max(0, Math.floor(finite(plan?.blockedCount, 0))),
    recipes: Array.isArray(plan?.recipes) ? plan.recipes.map((recipe) => ({
      id: normalizeId(recipe?.id),
      station: normalizeId(recipe?.station ?? 'general') || 'general',
      output: normalizeId(recipe?.output),
      outputQuantity: Math.max(0, Math.floor(finite(recipe?.outputQuantity, 0))),
      craftable: recipe?.craftable === true,
      missing: Array.isArray(recipe?.missing) ? recipe.missing.map((item) => ({ id: normalizeId(item?.id), quantity: Math.max(0, Math.floor(finite(item?.quantity, 0))), owned: Math.max(0, Math.floor(finite(item?.owned, 0))) })) : [],
    })) : [],
  };
}
