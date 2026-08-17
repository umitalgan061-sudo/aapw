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
		stockLimit: 4,
	}),
	Object.freeze({
		id: 'dragonstone-whetstone',
		itemId: 'dragonstone-whetstone',
		label: 'Nöbetçi bileği taşı',
		priceCopper: 12,
		quantity: 1,
		stockLimit: 2,
	}),
]);

export function createInteractionEconomyState(initialCopper = STARTING_COPPER, offers = QUARTERMASTER_OFFERS) {
	let copper = normalizeCopper(initialCopper, STARTING_COPPER);
	const stockByOffer = new Map();
	resetStock();

	function normalizeCopper(value, fallback = 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
	}

	function normalizeStock(value, limit) {
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed < 0) return limit;
		return Math.min(limit, Math.floor(parsed));
	}

	function stockLimitFor(offer) {
		return Math.max(0, Math.floor(Number(offer?.stockLimit) || 0));
	}

	function resetStock() {
		stockByOffer.clear();
		for (const offer of offers) stockByOffer.set(offer.id, stockLimitFor(offer));
	}

	function snapshot() {
		const stock = {};
		for (const offer of offers) stock[offer.id] = stockByOffer.get(offer.id) ?? stockLimitFor(offer);
		return { copper, stockByOffer: stock };
	}

	function restore(saved) {
		copper = normalizeCopper(saved?.copper, STARTING_COPPER);
		resetStock();
		if (!saved?.stockByOffer || typeof saved.stockByOffer !== 'object' || Array.isArray(saved.stockByOffer)) return;
		for (const offer of offers) {
			if (!Object.hasOwn(saved.stockByOffer, offer.id)) continue;
			stockByOffer.set(offer.id, normalizeStock(saved.stockByOffer[offer.id], stockLimitFor(offer)));
		}
	}

	function purchase(offer, grantItem) {
		if (!offer || typeof grantItem !== 'function') return { ok: false, reason: 'invalid-offer' };
		const configuredOffer = offers.find((candidate) => candidate.id === offer.id);
		if (!configuredOffer || configuredOffer.itemId !== offer.itemId) return { ok: false, reason: 'invalid-offer' };
		const remainingStock = stockByOffer.get(configuredOffer.id) ?? stockLimitFor(configuredOffer);
		if (remainingStock <= 0) return { ok: false, reason: 'out-of-stock' };
		const price = normalizeCopper(configuredOffer.priceCopper, -1);
		if (price < 0) return { ok: false, reason: 'invalid-price' };
		if (copper < price) return { ok: false, reason: 'insufficient-funds' };
		const granted = grantItem(configuredOffer.itemId, configuredOffer.quantity ?? 1, {
			sourceType: 'vendor',
			sourceId: QUARTERMASTER_NPC_ID,
		});
		if (!granted) return { ok: false, reason: 'inventory-full' };
		copper -= price;
		stockByOffer.set(configuredOffer.id, remainingStock - 1);
		return {
			ok: true,
			spentCopper: price,
			balanceCopper: copper,
			offerId: configuredOffer.id,
			remainingStock: remainingStock - 1,
		};
	}

	return { purchase, restore, snapshot };
}

export function buildQuartermasterText(economySnapshot = {}, offers = QUARTERMASTER_OFFERS, feedback = '') {
	const balance = Math.max(0, Math.floor(Number(economySnapshot.copper) || 0));
	const stock = economySnapshot.stockByOffer && typeof economySnapshot.stockByOffer === 'object'
		? economySnapshot.stockByOffer
		: null;
	const lines = ['Dragonstone Levazımcısı', `Kese: ${balance} bakır`];
	if (feedback) lines.push(feedback);
	lines.push('Satın almak için numarayı seç:');
	for (const offer of offers) {
		const limit = stockLimitForText(offer);
		const savedRemaining = stock && Object.hasOwn(stock, offer.id) ? Number(stock[offer.id]) : limit;
		const remaining = Number.isFinite(savedRemaining)
			? Math.max(0, Math.min(limit, Math.floor(savedRemaining)))
			: limit;
		lines.push(`${offer.label} — ${offer.priceCopper} bakır · stok ${remaining}/${limit}`);
	}
	return lines.join('\n');
}

function stockLimitForText(offer) {
	return Math.max(0, Math.floor(Number(offer?.stockLimit) || 0));
}
