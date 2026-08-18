/**
 * Compact settlement-service economy for the existing interaction-owned RPG state.
 * This deliberately stays beside interaction.js instead of creating a second economy/inventory framework.
 * @module gameplay/interactionEconomy
 */

export const QUARTERMASTER_NPC_ID = 'stannis-guard-1';
export const STARTING_COPPER = 40;
export const RECENT_TRANSACTION_LIMIT = 5;

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
	let recentTransactions = [];
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

	function configuredOfferById(offerId) {
		return offers.find((candidate) => candidate.id === offerId) ?? null;
	}

	function resetStock() {
		stockByOffer.clear();
		for (const offer of offers) stockByOffer.set(offer.id, stockLimitFor(offer));
	}

	function resetLedger() {
		transactionCount = 0;
		lifetimeSpentCopper = 0;
		recentTransactions = [];
		purchasesByOffer.clear();
		for (const offer of offers) purchasesByOffer.set(offer.id, 0);
	}

	function syncLedgerTotalsFromStock() {
		transactionCount = 0;
		lifetimeSpentCopper = 0;
		purchasesByOffer.clear();
		for (const offer of offers) {
			const limit = stockLimitFor(offer);
			const remaining = stockByOffer.get(offer.id) ?? limit;
			const purchases = Math.max(0, limit - remaining);
			purchasesByOffer.set(offer.id, purchases);
			transactionCount += purchases;
			lifetimeSpentCopper += purchases * normalizeCopper(offer.priceCopper, 0);
		}
	}

	function transactionReceipt(configuredOffer, sequence, balanceCopper = copper) {
		return {
			sequence,
			offerId: configuredOffer.id,
			itemId: configuredOffer.itemId,
			quantity: Math.max(1, Math.floor(Number(configuredOffer.quantity) || 1)),
			spentCopper: normalizeCopper(configuredOffer.priceCopper, 0),
			balanceCopper: normalizeCopper(balanceCopper, copper),
		};
	}

	function ledgerSnapshot() {
		const purchases = {};
		for (const offer of offers) purchases[offer.id] = purchasesByOffer.get(offer.id) ?? 0;
		return {
			transactionCount,
			lifetimeSpentCopper,
			purchasesByOffer: purchases,
			recentTransactions: recentTransactions.map((receipt) => ({ ...receipt })),
		};
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

		// Finite stock is the gameplay-authoritative source. Derive all aggregate ledger totals from it so
		// legacy stock-aware saves gain truthful history totals and forged aggregate fields cannot drift.
		syncLedgerTotalsFromStock();

		const savedLedger = saved?.ledger;
		if (!savedLedger || typeof savedLedger !== 'object' || Array.isArray(savedLedger)) return;
		if (!Array.isArray(savedLedger.recentTransactions) || transactionCount <= 0) return;

		const oldestRecentSequence = Math.max(1, transactionCount - RECENT_TRANSACTION_LIMIT + 1);
		const receiptsBySequence = new Map();
		for (const savedReceipt of savedLedger.recentTransactions) {
			if (!savedReceipt || typeof savedReceipt !== 'object' || Array.isArray(savedReceipt)) continue;
			const sequence = normalizeCount(savedReceipt.sequence);
			if (sequence < oldestRecentSequence || sequence > transactionCount) continue;
			const configuredOffer = configuredOfferById(savedReceipt.offerId);
			if (!configuredOffer || (purchasesByOffer.get(configuredOffer.id) ?? 0) <= 0) continue;
			receiptsBySequence.set(sequence, transactionReceipt(configuredOffer, sequence, savedReceipt.balanceCopper));
		}

		const restoredCountsByOffer = new Map();
		for (const receipt of [...receiptsBySequence.values()].sort((left, right) => left.sequence - right.sequence)) {
			const restoredCount = restoredCountsByOffer.get(receipt.offerId) ?? 0;
			const purchaseCount = purchasesByOffer.get(receipt.offerId) ?? 0;
			if (restoredCount >= purchaseCount) continue;
			restoredCountsByOffer.set(receipt.offerId, restoredCount + 1);
			recentTransactions.push(receipt);
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
		syncLedgerTotalsFromStock();
		recentTransactions.push(transactionReceipt(configuredOffer, transactionCount, copper));
		if (recentTransactions.length > RECENT_TRANSACTION_LIMIT) recentTransactions.splice(0, recentTransactions.length - RECENT_TRANSACTION_LIMIT);
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
	const recentTransactions = Array.isArray(ledger?.recentTransactions) ? ledger.recentTransactions : [];
	for (let index = recentTransactions.length - 1; index >= 0; index -= 1) {
		const receipt = recentTransactions[index];
		const offer = offers.find((candidate) => candidate.id === receipt?.offerId);
		const sequence = Math.max(0, Math.floor(Number(receipt?.sequence) || 0));
		if (!offer || sequence <= 0) continue;
		const spent = Math.max(0, Math.floor(Number(receipt?.spentCopper) || 0));
		const receiptBalance = Math.max(0, Math.floor(Number(receipt?.balanceCopper) || 0));
		lines.push(`Son işlem: #${sequence} ${offer.label} · ${spent} bakır · bakiye ${receiptBalance}`);
		break;
	}
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
