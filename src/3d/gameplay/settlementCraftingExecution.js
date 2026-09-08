/**
 * Thin settlement smithing/crafting execution bridge.
 * Delegates mutation to the existing authoritative inventory/economy owner.
 * @module gameplay/settlementCraftingExecution
 */

const MAX_INPUTS = 32;

function normalizeText(value) {
	return String(value ?? '').trim();
}

function normalizeQuantity(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.min(999, Math.floor(parsed)) : 0;
}

function normalizeInputs(inputs) {
	if (!Array.isArray(inputs)) return [];
	return inputs.slice(0, MAX_INPUTS).map((input) => ({
		itemId: normalizeText(input?.itemId),
		quantity: normalizeQuantity(input?.quantity),
	})).filter((input) => input.itemId && input.quantity > 0);
}

function sameFingerprint(left, right) {
	return normalizeText(left) !== '' && normalizeText(left) === normalizeText(right);
}

export function createSettlementCraftingExecution({ executeCraft, now = () => Date.now() } = {}) {
	function execute(plan, context = {}) {
		const recipeId = normalizeText(plan?.recipeId);
		const stationId = normalizeText(plan?.stationId);
		const expectedFingerprint = normalizeText(plan?.inventoryFingerprint);
		const currentFingerprint = normalizeText(context?.inventoryFingerprint);
		const inputs = normalizeInputs(plan?.inputs);
		if (!recipeId || !stationId || !expectedFingerprint || !sameFingerprint(expectedFingerprint, currentFingerprint)) {
			return { ok: false, reason: 'stale-crafting-plan', recipeId: recipeId || null, stationId: stationId || null };
		}
		if (inputs.length === 0 || typeof executeCraft !== 'function') {
			return { ok: false, reason: 'craft-handler-unavailable', recipeId, stationId };
		}
		let result;
		try {
			result = executeCraft({ recipeId, stationId, inputs, requestedAt: Number(now()) || 0 });
		} catch {
			return { ok: false, reason: 'craft-handler-error', recipeId, stationId };
		}
		return {
			ok: result?.ok === true,
			reason: result?.ok === true ? null : normalizeText(result?.reason) || 'craft-rejected',
			recipeId,
			stationId,
			output: result?.ok === true ? result.output ?? null : null,
		};
	}
	return Object.freeze({ execute });
}
