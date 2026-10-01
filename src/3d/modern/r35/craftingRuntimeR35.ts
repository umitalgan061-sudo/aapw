
import { clamp, fail, ok, type R35Id, type R35Result } from './contracts';

export interface RecipeInput {
  readonly itemId: R35Id;
  readonly quantity: number;
}

export interface RecipeOutput {
  readonly itemId: R35Id;
  readonly quantity: number;
  readonly chance?: number;
}

export interface Recipe {
  readonly id: R35Id;
  readonly version: number;
  readonly duration: number;
  readonly skill: R35Id;
  readonly requiredSkill: number;
  readonly inputs: readonly RecipeInput[];
  readonly outputs: readonly RecipeOutput[];
  readonly byproducts: readonly RecipeOutput[];
  readonly stations: readonly R35Id[];
}

export interface CraftingStock {
  readonly itemId: R35Id;
  readonly quantity: number;
}

export interface CraftResult {
  readonly recipeId: R35Id;
  readonly quality: number;
  readonly produced: readonly CraftingStock[];
  readonly consumed: readonly CraftingStock[];
}

export class CraftingRuntimeR35 {
  #recipes = new Map<R35Id, Recipe>();
  #stock = new Map<R35Id, number>();
  #skills = new Map<R35Id, number>();
  #stations = new Set<R35Id>();
  #revision = 0;

  registerRecipe(recipe: Recipe): R35Result<Recipe> {
    if (!recipe.id) return fail('RECIPE_ID', 'Recipe id is required');
    if (this.#recipes.has(recipe.id)) return fail('RECIPE_DUPLICATE', 'Recipe exists');
    if (recipe.version < 1 || recipe.duration <= 0) {
      return fail('RECIPE_INVALID', 'Recipe version or duration is invalid');
    }
    if (recipe.inputs.length > 32 || recipe.outputs.length > 32) {
      return fail('RECIPE_COMPLEXITY', 'Recipe exceeds complexity limit');
    }
    for (const input of recipe.inputs) {
      if (!input.itemId || input.quantity <= 0) {
        return fail('RECIPE_INPUT', 'Recipe input is invalid');
      }
    }
    for (const output of recipe.outputs) {
      if (!output.itemId || output.quantity <= 0) {
        return fail('RECIPE_OUTPUT', 'Recipe output is invalid');
      }
    }
    this.#recipes.set(
      recipe.id,
      Object.freeze({
        ...recipe,
        inputs: Object.freeze([...recipe.inputs]),
        outputs: Object.freeze([...recipe.outputs]),
        byproducts: Object.freeze([...recipe.byproducts]),
        stations: Object.freeze([...recipe.stations]),
      }),
    );
    return ok(recipe);
  }

  setSkill(skill: R35Id, value: number): void {
    this.#skills.set(skill, clamp(value, 0, 100));
  }

  setStation(station: R35Id, active: boolean): void {
    if (active) this.#stations.add(station);
    else this.#stations.delete(station);
  }

  addStock(itemId: R35Id, quantity: number): number {
    const q = Math.max(0, Math.trunc(quantity));
    const total = (this.#stock.get(itemId) ?? 0) + q;
    this.#stock.set(itemId, total);
    return total;
  }

  stock(itemId: R35Id): number {
    return this.#stock.get(itemId) ?? 0;
  }

  canCraft(recipeId: R35Id, skillBoost = 0): boolean {
    const recipe = this.#recipes.get(recipeId);
    if (!recipe) return false;
    const skill = (this.#skills.get(recipe.skill) ?? 0) + skillBoost;
    if (skill < recipe.requiredSkill) return false;
    for (const station of recipe.stations) {
      if (!this.#stations.has(station)) return false;
    }
    return recipe.inputs.every(
      (input) => this.stock(input.itemId) >= input.quantity,
    );
  }

  craft(recipeId: R35Id, skillBoost = 0): R35Result<CraftResult> {
    const recipe = this.#recipes.get(recipeId);
    if (!recipe) return fail('RECIPE_MISSING', 'Recipe not found');
    if (!this.canCraft(recipeId, skillBoost)) {
      return fail('CRAFT_BLOCKED', 'Crafting requirements are not met');
    }
    const skill = clamp(
      (this.#skills.get(recipe.skill) ?? 0) + skillBoost,
      0,
      100,
    );
    const quality = clamp(
      0.5 + (skill - recipe.requiredSkill) / 200,
      0.1,
      1,
    );
    const consumed = recipe.inputs.map((input) => {
      this.#stock.set(
        input.itemId,
        this.stock(input.itemId) - input.quantity,
      );
      return Object.freeze({
        itemId: input.itemId,
        quantity: input.quantity,
      });
    });
    const produced: CraftingStock[] = [];
    for (const output of recipe.outputs) {
      const chance = clamp(output.chance ?? 1, 0, 1);
      const threshold =
        ((recipe.id.length * 13 + output.itemId.length * 7 + this.#revision) % 100)
        / 100;
      if (threshold <= chance) {
        const quantity = Math.max(
          1,
          Math.round(output.quantity * (0.75 + quality * 0.5)),
        );
        this.addStock(output.itemId, quantity);
        produced.push(
          Object.freeze({
            itemId: output.itemId,
            quantity,
          }),
        );
      }
    }
    for (const output of recipe.byproducts) {
      const chance = clamp(output.chance ?? 1, 0, 1);
      const threshold =
        ((recipe.id.length * 5 + output.itemId.length * 11 + this.#revision) % 100)
        / 100;
      if (threshold <= chance) {
        this.addStock(output.itemId, output.quantity);
        produced.push(
          Object.freeze({
            itemId: output.itemId,
            quantity: output.quantity,
          }),
        );
      }
    }
    this.#revision += 1;
    return ok(
      Object.freeze({
        recipeId,
        quality,
        produced: Object.freeze(produced),
        consumed: Object.freeze(consumed),
      }),
    );
  }

  reset(): void {
    this.#stock.clear();
    this.#skills.clear();
    this.#stations.clear();
    this.#revision = 0;
  }

  recipesForSkill(skill: R35Id): readonly Recipe[] {
    return Object.freeze(
      [...this.#recipes.values()]
        .filter((recipe) => recipe.skill === skill)
        .sort((a, b) => a.requiredSkill - b.requiredSkill),
    );
  }

  snapshot(): readonly CraftingStock[] {
    return Object.freeze(
      [...this.#stock.entries()]
        .filter(([, quantity]) => quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([itemId, quantity]) =>
          Object.freeze({ itemId, quantity }),
        ),
    );
  }
}
