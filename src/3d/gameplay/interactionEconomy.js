/**
 * Compact settlement-service economy for the existing interaction-owned RPG state.
 * This deliberately stays beside interaction.js instead of creating a second economy/inventory framework.
 * @module gameplay/interactionEconomy
 */

export const QUARTERMASTER_NPC_ID = 'stannis-guard-1';
export const STARTING_COPPER = 40;
export const RECENT_TRANSACTION_LIMIT = 5;
export const RECENT_CREDIT_LIMIT = 5;
const CREDIT_SOURCE_LIMIT = 64;

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
		fulfillment: Object.freeze({
			kind: 'settlement-service',
			serviceId: 'dragonstone-watch-armorer-honing',
			label: 'Zırhçı bileme hazırlığı',
			stationId: 'dragonstone-armorer-bench',
			discipline: 'smithing',
			craftUpgrade: Object.freeze({
				recipeId: 'dragonstone-expedition-maintenance-kit',
				inputs: Object.freeze([
					Object.freeze({ itemId: 'dragonstone-travel-ration-pack', quantity: 1 }),
					Object.freeze({ itemId: 'dragonstone-whetstone', quantity: 1 }),
				]),
				outputItemId: 'dragonstone-expedition-maintenance-kit',
				outputQuantity: 1,
				label: '1 yol azığı paketi + 1 bileği taşını 1 sefer bakım kitine hazırla',
			}),
		}),
	}),
	Object.freeze({
		id: 'dragonstone-watch-ration-allotment',
		itemId: 'dragonstone-travel-ration-pack',
		label: 'Nöbetçi yol azığı hazırlama hizmeti',
		priceCopper: 5,
		quantity: 1,
		stockLimit: 1,
		fulfillment: Object.freeze({
			kind: 'settlement-service',
			serviceId: 'dragonstone-watch-ration-prep',
			label: 'Erzak hazırlama',
			stationId: 'dragonstone-ration-prep-table',
			discipline: 'provisioning',
			craftUpgrade: Object.freeze({
				recipeId: 'dragonstone-watch-travel-ration-pack',
				inputItemId: 'dragonstone-field-ration',
				inputQuantity: 2,
				outputItemId: 'dragonstone-travel-ration-pack',
				outputQuantity: 1,
				label: '2 saha azığını 1 yol azığı paketine hazırla',
			}),
		}),
	}),
]);

export function createInteractionEconomyState(initialCopper = STARTING_COPPER, offers = QUARTERMASTER_OFFERS) {
	let copper = normalizeCopper(initialCopper, STARTING_COPPER);
	let transactionCount = 0;
	let lifetimeSpentCopper = 0;
	let recentTransactions = [];
	let recentCredits = [];
	let purchaseInFlight = false;
	const creditedSourceIds = new Set();
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

	function normalizeReceiptText(value, fallback) {
		const normalized = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
		return normalized || fallback;
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
		recentCredits = [];
		creditedSourceIds.clear();
		purchasesByOffer.clear();
		for (const offer of offers) purchasesByOffer.set(offer.id, 0);
	}

	function rememberCreditSource(sourceId) {
		if (!sourceId) return;
		creditedSourceIds.add(sourceId);
		while (creditedSourceIds.size > CREDIT_SOURCE_LIMIT) creditedSourceIds.delete(creditedSourceIds.values().next().value);
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

	function creditReceipt(amount, metadata = {}, sequence = recentCredits.length + 1, balanceCopper = copper) {
		return {
			sequence: Math.max(1, normalizeCount(sequence, 1)),
			sourceId: normalizeReceiptText(metadata?.sourceId, 'expedition-contract'),
			label: normalizeReceiptText(metadata?.label, 'Sefer kontratı'),
			creditedCopper: normalizeCopper(amount, 0),
			balanceCopper: normalizeCopper(balanceCopper, copper),
		};
	}

	function ledgerSnapshot() {
		const purchases = {};
		for (const offer of offers) purchases[offer.id] = purchasesByOffer.get(offer.id) ?? 0;
		const ledger = {
			transactionCount,
			lifetimeSpentCopper,
			purchasesByOffer: purchases,
			recentTransactions: recentTransactions.map((receipt) => ({ ...receipt })),
		};
		if (recentCredits.length > 0) ledger.recentCredits = recentCredits.map((receipt) => ({ ...receipt }));
		if (creditedSourceIds.size > 0) ledger.creditedSourceIds = [...creditedSourceIds];
		return ledger;
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

		// Finite stock is the gameplay-authoritative source. Derive all aggregate purchase totals from it so
		// legacy stock-aware saves gain truthful history totals and forged aggregate fields cannot drift.
		syncLedgerTotalsFromStock();

		const savedLedger = saved?.ledger;
		if (!savedLedger || typeof savedLedger !== 'object' || Array.isArray(savedLedger)) return;
		if (Array.isArray(savedLedger.creditedSourceIds)) {
			for (const savedSourceId of savedLedger.creditedSourceIds.slice(-CREDIT_SOURCE_LIMIT)) rememberCreditSource(normalizeReceiptText(savedSourceId, ''));
		}
		if (Array.isArray(savedLedger.recentCredits)) {
			const validCredits = [];
			const seenSequences = new Set();
			for (const savedReceipt of savedLedger.recentCredits.slice(-RECENT_CREDIT_LIMIT * 2)) {
				if (!savedReceipt || typeof savedReceipt !== 'object' || Array.isArray(savedReceipt)) continue;
				const creditedCopper = normalizeCopper(savedReceipt.creditedCopper, 0);
				const sequence = normalizeCount(savedReceipt.sequence, 0);
				if (creditedCopper <= 0 || sequence <= 0 || seenSequences.has(sequence)) continue;
				seenSequences.add(sequence);
				validCredits.push(creditReceipt(creditedCopper, savedReceipt, sequence, savedReceipt.balanceCopper));
			}
			recentCredits = validCredits.sort((left, right) => left.sequence - right.sequence).slice(-RECENT_CREDIT_LIMIT);
			for (const receipt of recentCredits) rememberCreditSource(receipt.sourceId);
		}
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

	function credit(amount, metadata = {}) {
		const creditedCopper = normalizeCopper(amount, 0);
		if (creditedCopper <= 0) return { ok: false, reason: 'invalid-credit', creditedCopper: 0, balanceCopper: copper };
		const sourceId = normalizeReceiptText(metadata?.sourceId, '');
		if (sourceId && creditedSourceIds.has(sourceId)) return { ok: false, reason: 'duplicate-credit-source', creditedCopper: 0, balanceCopper: copper, sourceId };
		copper += creditedCopper;
		const sequence = (recentCredits.at(-1)?.sequence ?? 0) + 1;
		const receipt = creditReceipt(creditedCopper, metadata, sequence, copper);
		rememberCreditSource(sourceId);
		recentCredits.push(receipt);
		if (recentCredits.length > RECENT_CREDIT_LIMIT) recentCredits.splice(0, recentCredits.length - RECENT_CREDIT_LIMIT);
		return { ok: true, creditedCopper, balanceCopper: copper, receipt, ledger: ledgerSnapshot() };
	}

	function canonicalConsumedItems(craftUpgrade) {
		if (!craftUpgrade || typeof craftUpgrade !== 'object') return [];
		const authoredInputs = Array.isArray(craftUpgrade.inputs) && craftUpgrade.inputs.length > 0
			? craftUpgrade.inputs
			: [{ itemId: craftUpgrade.inputItemId, quantity: craftUpgrade.inputQuantity }];
		const requiredByItem = new Map();
		for (const input of authoredInputs) {
			const itemId = String(input?.itemId ?? '').trim();
			if (!itemId) continue;
			const quantity = Math.max(1, normalizeCount(input?.quantity, 1));
			requiredByItem.set(itemId, (requiredByItem.get(itemId) ?? 0) + quantity);
		}
		return [...requiredByItem.entries()].map(([itemId, quantity]) => ({ itemId, quantity }));
	}

	function purchase(offer, grantItem) {
		if (typeof grantItem !== 'function') return { ok: false, reason: 'invalid-offer' };
		if (purchaseInFlight) return { ok: false, reason: 'purchase-in-progress', balanceCopper: copper };
		const purchaseQuote = quote(offer);
		if (!purchaseQuote.ok) return purchaseQuote;
		const configuredOffer = configuredOfferFor(offer);
		const fulfillment = configuredOffer.fulfillment;
		let grantResult;
		purchaseInFlight = true;
		try {
			grantResult = grantItem(configuredOffer.itemId, configuredOffer.quantity ?? 1, {
				sourceType: fulfillment?.kind ?? 'vendor',
				sourceId: fulfillment?.serviceId ?? QUARTERMASTER_NPC_ID,
				craftUpgrade: fulfillment?.craftUpgrade ?? null,
			});
		} finally {
			purchaseInFlight = false;
		}
		const granted = grantResult === true || grantResult?.ok === true;
		if (!granted) return { ...purchaseQuote, ok: false, reason: grantResult?.reason ?? 'inventory-full' };
		const crafted = grantResult?.crafted === true && Boolean(fulfillment?.craftUpgrade);
		const consumedItems = crafted ? canonicalConsumedItems(fulfillment.craftUpgrade) : [];
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
			crafted,
			craftedItemId: crafted ? fulfillment.craftUpgrade.outputItemId ?? null : null,
			consumedItems,
			consumedItemId: consumedItems.length === 1 ? consumedItems[0].itemId : null,
			consumedQuantity: consumedItems.length === 1 ? consumedItems[0].quantity : null,
			ledger: ledgerSnapshot(),
		};
	}

	return { credit, purchase, quote, restore, snapshot };
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
	const recentCredits = Array.isArray(ledger?.recentCredits) ? ledger.recentCredits : [];
	const latestCredit = recentCredits.at(-1);
	if (latestCredit) {
		const credited = Math.max(0, Math.floor(Number(latestCredit.creditedCopper) || 0));
		const receiptBalance = Math.max(0, Math.floor(Number(latestCredit.balanceCopper) || 0));
		lines.push(`Son gelir: ${String(latestCredit.label ?? 'Sefer kontratı')} · +${credited} bakır · bakiye ${receiptBalance}`);
	}
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
	lines.push('Satın almak veya hizmet almak için numarayı seç:');
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
		const service = offer.fulfillment?.kind === 'settlement-service' ? ` · HİZMET: ${offer.fulfillment.label}` : '';
		const craftUpgrade = offer.fulfillment?.craftUpgrade?.label ? ` · DÖNÜŞÜM: ${offer.fulfillment.craftUpgrade.label}` : '';
		lines.push(`${offer.label} — ${price} bakır · stok ${remaining}/${limit} · aldın ${bought} · ${availability}${service}${craftUpgrade}`);
	}
	return lines.join('\n');
}

function stockLimitForText(offer) {
	return Math.max(0, Math.floor(Number(offer?.stockLimit) || 0));
}