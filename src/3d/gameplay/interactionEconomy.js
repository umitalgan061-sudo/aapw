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
	Object.freeze({
		id: 'dragonstone-watch-ration-allotment',
		itemId: 'dragonstone-field-ration',
		label: 'Nöbetçi erzak payı',
		priceCopper: 5,
		quantity: 1,
		stockLimit: 1,
	}),
]);

export function createInteractionEconomyState(initialCopper = STARTING_COPPER, offers = QUARTERMASTER_OFFERS) {
	let copper = normalizeCopper(initialCopper, STARTING_COPPER);
	let transactionCount = 0;
	let lifetimeSpentCopper = 0;
	const stockByOffer = new Map();
	const purchasesByOffer = new Map();
	resetStock();
	resetLedger();

	function normalizeCopper(value, fallback = 0) {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
	}

	function normalizeCount(value, fallback = 0) {
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

	function configuredOfferFor(offer) {
		if (!offer) return null;
		const configured = offers.find((candidate) => candidate.id === offer.id);
		return configured && configured.itemId === offer.itemId ? configured : null;
	}

	function resetStock() {
		stockByOffer.clear();
		for (const offer of offers) stockByOffer.set(offer.id, stockLimitFor(offer));
	}

	function resetLedger() {
		transactionCount = 0;
		lifetimeSpentCopper = 0;
		purchasesByOffer.clear();
		for (const offer of offers) purchasesByOffer.set(offer.id, 0);
	}

	function ledgerSnapshot() {
		const purchases = {};
		for (const offer of offers) purchases[offer.id] = purchasesByOffer.get(offer.id) ?? 0;
		return { transactionCount, lifetimeSpentCopper, purchasesByOffer: purchases };
	}

	function snapshot() {
		const stock = {};
		for (const offer of offers) stock[offer.id] = stockByOffer.get(offer.id) ?? stockLimitFor(offer);
		return { copper, stockByOffer: stock, ledger: ledgerSnapshot() };
	}

	function restore(saved) {
		copper = normalizeCopper(saved?.copper, STARTING_COPPER);
		resetStock();
		resetLedger();
		if (saved?.stockByOffer && typeof saved.stockByOffer === 'object' && !Array.isArray(saved.stockByOffer)) {
			for (const offer of offers) {
				if (!Object.hasOwn(saved.stockByOffer, offer.id)) continue;
				stockByOffer.set(offer.id, normalizeStock(saved.stockByOffer[offer.id], stockLimitFor(offer)));
			}
		}
		const savedLedger = saved?.ledger;
		if (!savedLedger || typeof savedLedger !== 'object' || Array.isArray(savedLedger)) return;
		transactionCount = normalizeCount(savedLedger.transactionCount);
		lifetimeSpentCopper = normalizeCopper(savedLedger.lifetimeSpentCopper, 0);
		const savedPurchases = savedLedger.purchasesByOffer;
		if (!savedPurchases || typeof savedPurchases !== 'object' || Array.isArray(savedPurchases)) return;
		for (const offer of offers) {
			if (!Object.hasOwn(savedPurchases, offer.id)) continue;
			purchasesByOffer.set(offer.id, normalizeCount(savedPurchases[offer.id]));
		}
	}

	function quote(offer) {
		const configuredOffer = configuredOfferFor(offer);
		if (!configuredOffer) return { ok: false, reason: 'invalid-offer' };
		const remainingStock = stockByOffer.get(configuredOffer.id) ?? stockLimitFor(configuredOffer);
		const price = normalizeCopper(configuredOffer.priceCopper, -1);
		if (remainingStock <= 0) return { ok: false, reason: 'out-of-stock', offerId: configuredOffer.id, remainingStock: 0, priceCopper: price, balanceCopper: copper };
		if (price < 0) return { ok: false, reason: 'invalid-price', offerId: configuredOffer.id, remainingStock, priceCopper: price, balanceCopper: copper };
		if (copper < price) return { ok: false, reason: 'insufficient-funds', offerId: configuredOffer.id, remainingStock, priceCopper: price, balanceCopper: copper, shortfallCopper: price - copper };
		return { ok: true, reason: 'available', offerId: configuredOffer.id, remainingStock, priceCopper: price, balanceCopper: copper, balanceAfterPurchase: copper - price };
	}

	function purchase(offer, grantItem) {
		if (typeof grantItem !== 'function') return { ok: false, reason: 'invalid-offer' };
		const purchaseQuote = quote(offer);
		if (!purchaseQuote.ok) return purchaseQuote;
		const configuredOffer = configuredOfferFor(offer);
		const granted = grantItem(configuredOffer.itemId, configuredOffer.quantity ?? 1, {
			sourceType: 'vendor',
			sourceId: QUARTERMASTER_NPC_ID,
		});
		if (!granted) return { ...purchaseQuote, ok: false, reason: 'inventory-full' };
		copper -= purchaseQuote.priceCopper;
		stockByOffer.set(configuredOffer.id, purchaseQuote.remainingStock - 1);
		transactionCount += 1;
		lifetimeSpentCopper += purchaseQuote.priceCopper;
		purchasesByOffer.set(configuredOffer.id, (purchasesByOffer.get(configuredOffer.id) ?? 0) + 1);
		return {
			ok: true,
			spentCopper: purchaseQuote.priceCopper,
			balanceCopper: copper,
			offerId: configuredOffer.id,
			remainingStock: purchaseQuote.remainingStock - 1,
			ledger: ledgerSnapshot(),
		};
	}

	return { purchase, quote, restore, snapshot };
}

export function buildQuartermasterText(economySnapshot = {}, offers = QUARTERMASTER_OFFERS, feedback = '') {
	const balance = Math.max(0, Math.floor(Number(economySnapshot.copper) || 0));
	const stock = economySnapshot.stockByOffer && typeof economySnapshot.stockByOffer === 'object'
		? economySnapshot.stockByOffer
		: null;
	const ledger = economySnapshot.ledger && typeof economySnapshot.ledger === 'object' && !Array.isArray(economySnapshot.ledger)
		? economySnapshot.ledger
		: null;
	const transactionCount = Math.max(0, Math.floor(Number(ledger?.transactionCount) || 0));
	const lifetimeSpentCopper = Math.max(0, Math.floor(Number(ledger?.lifetimeSpentCopper) || 0));
	const lines = ['Dragonstone Levazımcısı', `Kese: ${balance} bakır`, `Alışveriş defteri: ${transactionCount} işlem · ${lifetimeSpentCopper} bakır harcandı`];
	if (feedback) lines.push(feedback);
	lines.push('Satın almak için numarayı seç:');
	for (const offer of offers) {
		const limit = stockLimitForText(offer);
		const savedRemaining = stock && Object.hasOwn(stock, offer.id) ? Number(stock[offer.id]) : limit;
		const remaining = Number.isFinite(savedRemaining)
			? Math.max(0, Math.min(limit, Math.floor(savedRemaining)))
			: limit;
		const boughtRaw = ledger?.purchasesByOffer && Object.hasOwn(ledger.purchasesByOffer, offer.id)
			? Number(ledger.purchasesByOffer[offer.id])
			: 0;
		const bought = Number.isFinite(boughtRaw) && boughtRaw >= 0 ? Math.floor(boughtRaw) : 0;
		const price = Math.max(0, Math.floor(Number(offer.priceCopper) || 0));
		const availability = remaining <= 0 ? 'TÜKENDİ' : balance < price ? `YETERSİZ BAKIR · ${price - balance} eksik` : `ALINABİLİR · sonra ${balance - price} bakır`;
		lines.push(`${offer.label} — ${price} bakır · stok ${remaining}/${limit} · aldın ${bought} · ${availability}`);
	}
	return lines.join('\n');
}

function stockLimitForText(offer) {
	return Math.max(0, Math.floor(Number(offer?.stockLimit) || 0));
}
