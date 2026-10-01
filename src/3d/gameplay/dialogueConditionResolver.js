/**
 * Read-only dialogue condition adapter for existing NPC choice content.
 *
 * Callers own dialogue state, quest progress and inventory. This module only
 * evaluates a small condition vocabulary and returns visible choices in a
 * deterministic order, so existing interaction.js callers can opt in without
 * introducing a second dialogue framework.
 *
 * @module gameplay/dialogueConditionResolver
 */

const finiteNonNegative = (value, fallback = 0) => {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : fallback;
};

const normalizeId = (value) => typeof value === 'string' ? value.trim() : '';

const hasCompletedQuest = (completedQuestIds, questId) => {
	const normalizedQuestId = normalizeId(questId);
	if (!normalizedQuestId) return false;
	if (completedQuestIds instanceof Set) return completedQuestIds.has(normalizedQuestId);
	if (Array.isArray(completedQuestIds)) return completedQuestIds.map(normalizeId).includes(normalizedQuestId);
	return false;
};

const hasItem = (inventory, itemId, quantity) => {
	const normalizedItemId = normalizeId(itemId);
	if (!normalizedItemId || !inventory) return false;
	const required = Math.max(1, Math.floor(finiteNonNegative(quantity, 1)));
	if (inventory instanceof Map) return finiteNonNegative(inventory.get(normalizedItemId)) >= required;
	if (Array.isArray(inventory)) {
		return inventory.reduce((total, item) => {
			if (!item || normalizeId(item.id ?? item.itemId) !== normalizedItemId) return total;
			return total + finiteNonNegative(item.quantity ?? item.count, 1);
		}, 0) >= required;
	}
	if (typeof inventory === 'object') return finiteNonNegative(inventory[normalizedItemId]) >= required;
	return false;
};

const conditionPasses = (condition, context) => {
	if (!condition || typeof condition !== 'object') return true;
	const { completedQuestIds, inventory, reputation = {}, flags = {} } = context;
	if (condition.questId && !hasCompletedQuest(completedQuestIds, condition.questId)) return false;
	if (condition.itemId && !hasItem(inventory, condition.itemId, condition.quantity)) return false;
	if (condition.flag && flags[condition.flag] !== true) return false;
	if (condition.reputation) {
		const factionId = normalizeId(condition.reputation.factionId);
		const minimum = Number(condition.reputation.minimum);
		if (!factionId || !Number.isFinite(minimum) || finiteNonNegative(reputation[factionId], 0) < minimum) return false;
	}
	return true;
};

const normalizeChoice = (choice, index) => {
	if (!choice || typeof choice !== 'object') return null;
	const label = typeof choice.label === 'string' ? choice.label.trim() : '';
	const response = typeof choice.response === 'string' ? choice.response.trim() : '';
	if (!label || !response) return null;
	return Object.freeze({
		id: normalizeId(choice.id) || `choice-${index + 1}`,
		label,
		response,
		condition: choice.condition && typeof choice.condition === 'object' ? choice.condition : null,
	});
};

export function resolveDialogueChoices(choices, context = {}, options = {}) {
	const maxChoices = Math.max(0, Math.min(9, Math.floor(finiteNonNegative(options.maxChoices, 3))));
	const normalized = Array.isArray(choices) ? choices.map(normalizeChoice).filter(Boolean) : [];
	const visible = normalized.filter((choice) => conditionPasses(choice.condition, context)).slice(0, maxChoices);
	return Object.freeze({
		choices: Object.freeze(visible.map(({ id, label, response }) => Object.freeze({ id, label, response }))),
		filteredCount: Math.max(0, normalized.length - visible.length),
		maxChoices,
	});
}

export const dialogueConditionInternals = Object.freeze({ conditionPasses, hasCompletedQuest, hasItem });
