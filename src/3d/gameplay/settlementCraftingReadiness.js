/**
 * Read-only crafting readiness projection for the existing settlement smithing/crafting runtime.
 * It never executes recipes or mutates inventory, economy, quest, travel, save, NPC or scene state.
 */

export const SETTLEMENT_CRAFTING_READINESS_VERSION = 1;

const MAX_RECIPES = 12;
const MAX_MATERIALS = 8;

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 96) : fallback;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function hash(value) {
  const source = typeof value === 'string' ? value : stable(value);
  let result = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function normalizeMaterials(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_MATERIALS).map((material) => ({
    itemId: clean(material?.itemId),
    required: Math.max(0, Math.floor(finite(material?.required))),
    owned: Math.max(0, Math.floor(finite(material?.owned))),
  })).filter((material) => material.itemId && material.required > 0);
}

function normalizeRecipe(recipe, index) {
  const recipeId = clean(recipe?.recipeId, `recipe-${index + 1}`);
  const station = clean(recipe?.station, 'blacksmith');
  const materials = normalizeMaterials(recipe?.materials);
  const requiredSkill = Math.max(0, Math.floor(finite(recipe?.requiredSkill)));
  const skill = Math.max(0, Math.floor(finite(recipe?.skill)));
  const copperCost = Math.max(0, Math.floor(finite(recipe?.copperCost)));
  const copper = Math.max(0, Math.floor(finite(recipe?.copper)));
  const missingMaterials = materials.filter((material) => material.owned < material.required);
  const skillShortfall = Math.max(0, requiredSkill - skill);
  const copperShortfall = Math.max(0, copperCost - copper);
  const ready = missingMaterials.length === 0 && skillShortfall === 0 && copperShortfall === 0;
  return Object.freeze({
    recipeId,
    name: clean(recipe?.name, recipeId),
    station,
    outputItemId: clean(recipe?.outputItemId),
    outputCount: Math.max(0, Math.floor(finite(recipe?.outputCount, 1))),
    materials: Object.freeze(materials.map((material) => Object.freeze({ ...material, missing: Math.max(0, material.required - material.owned) }))),
    missingMaterialCount: missingMaterials.length,
    skill,
    requiredSkill,
    skillShortfall,
    copper,
    copperCost,
    copperShortfall,
    ready,
    blockedReasons: Object.freeze([
      ...(missingMaterials.length ? ['missing-materials'] : []),
      ...(skillShortfall ? ['insufficient-skill'] : []),
      ...(copperShortfall ? ['insufficient-copper'] : []),
    ]),
  });
}

export function buildSettlementCraftingReadiness(snapshot = {}) {
  const recipes = Array.isArray(snapshot.recipes) ? snapshot.recipes.slice(0, MAX_RECIPES).map(normalizeRecipe) : [];
  const station = clean(snapshot.station, 'blacksmith');
  const available = recipes.filter((recipe) => recipe.ready).length;
  const blocked = recipes.length - available;
  const result = {
    version: SETTLEMENT_CRAFTING_READINESS_VERSION,
    station,
    insideSettlement: snapshot.insideSettlement !== false,
    defeated: snapshot.defeated === true,
    recipes: Object.freeze(recipes),
    recipeCount: recipes.length,
    availableCount: available,
    blockedCount: blocked,
    primaryRecipeId: recipes.find((recipe) => recipe.ready)?.recipeId || recipes[0]?.recipeId || '',
    nextAction: snapshot.defeated === true || snapshot.insideSettlement === false ? 'return-to-blacksmith' : (available ? 'craft' : 'gather-materials'),
  };
  result.fingerprint = hash(result);
  return Object.freeze(result);
}

export function validateSettlementCraftingReadiness(readiness = {}) {
  const errors = [];
  if (readiness.version !== SETTLEMENT_CRAFTING_READINESS_VERSION) errors.push('unsupported-version');
  if (!clean(readiness.station)) errors.push('missing-station');
  if (!Array.isArray(readiness.recipes)) errors.push('missing-recipes');
  if (readiness.availableCount + readiness.blockedCount !== readiness.recipeCount) errors.push('count-mismatch');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function serializeSettlementCraftingReadiness(readiness) {
  return stable(readiness);
}
