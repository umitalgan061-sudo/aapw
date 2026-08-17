/**
 * Compact settlement-service economy for the existing interaction-owned RPG state.
 * This deliberately stays beside interaction.js instead of creating a second economy/inventory framework.
 * @module gameplay/interactionEconomy
 */

export const QUARTERMASTER_NPC_ID = 'stannis-guard-1';
export const STARTING_COPPER = 40;

export const QUARTERMASTER_OFFERS = Object.freeze([
	Object.freeze({
		id: 'dragonstone-field-ration',
		itemId: 'dragonstone-field-ration',
		label: 'Dragonstone saha azığı',
		priceCopper: 6,
		quantity: 1,
	}),
	Object.freeze({
		id: 'dragonstone-whetstone',
		itemId: 'dragonstone-whetstone',
		label: 'Nöbetçi bileği taşı',
		priceCopper: 12,
		quantity: 1,
	}),
]);

export function createInteractionEconomyState(initialCopper = STARTING_COPPER) {
	let copper = normalizeCopper(initialCopper, STARTING_COPPER);

	function normalizeCopper(value, fallback = 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
	}

	function snapshot() {
		return { copper };
	}

	function restore(saved) {
		copper = normalizeCopper(saved?.copper, STARTING_COPPER);
	}

	function purchase(offer, grantItem) {
		if (!offer || typeof grantItem !== 'function') return { ok: false, reason: 'invalid-offer' };
		const price = normalizeCopper(offer.priceCopper, -1);
		if (price < 0) return { ok: false, reason: 'invalid-price' };
		if (copper < price) return { ok: false, reason: 'insufficient-funds' };
		const granted = grantItem(offer.itemId, offer.quantity ?? 1, {
			sourceType: 'vendor',
			sourceId: QUARTERMASTER_NPC_ID,
		});
		if (!granted) return { ok: false, reason: 'inventory-full' };
		copper -= price;
		return { ok: true, spentCopper: price, balanceCopper: copper, offerId: offer.id };
	}

	return { purchase, restore, snapshot };
}

export function buildQuartermasterText(economySnapshot = {}, offers = QUARTERMASTER_OFFERS, feedback = '') {
	const balance = Math.max(0, Math.floor(Number(economySnapshot.copper) || 0));
	const lines = ['Dragonstone Levazımcısı', `Kese: ${balance} bakır`];
	if (feedback) lines.push(feedback);
	lines.push('Satın almak için numarayı seç:');
	for (const offer of offers) lines.push(`${offer.label} — ${offer.priceCopper} bakır`);
	return lines.join('\n');
}
