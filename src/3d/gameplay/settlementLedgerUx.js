/**
 * Read-only presentation adapter for the existing interaction economy ledger.
 * It intentionally owns no copper, stock, inventory or persistence state.
 * @module gameplay/settlementLedgerUx
 */

const MAX_ROWS = 24;

function finiteNonNegative(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTransaction(transaction, index) {
	if (!transaction || typeof transaction !== 'object') return null;
	const sequence = Math.max(1, Math.floor(finiteNonNegative(transaction.sequence) || index + 1));
	const offerId = String(transaction.offerId ?? '').trim();
	const itemId = String(transaction.itemId ?? '').trim();
	if (!offerId || !itemId) return null;
	return Object.freeze({
		sequence,
		offerId,
		itemId,
		quantity: Math.max(0, Math.floor(finiteNonNegative(transaction.quantity))),
		spentCopper: finiteNonNegative(transaction.spentCopper),
		balanceCopper: finiteNonNegative(transaction.balanceCopper),
	});
}

function formatRow(transaction) {
	const direction = transaction.spentCopper > 0 ? 'Alış' : 'İşlem';
	return `${transaction.sequence}. ${direction} · ${transaction.itemId} ×${transaction.quantity} · ${transaction.spentCopper} bakır · Bakiye ${transaction.balanceCopper}`;
}

export function createSettlementLedgerUx(options = {}) {
	const rowLimit = Math.max(1, Math.min(MAX_ROWS, Math.floor(finiteNonNegative(options.rowLimit) || MAX_ROWS)));

	function present(snapshot = {}) {
		const ledger = snapshot && typeof snapshot === 'object' ? snapshot : {};
		const transactions = (Array.isArray(ledger.recentTransactions) ? ledger.recentTransactions : [])
			.map(normalizeTransaction)
			.filter(Boolean)
			.sort((a, b) => a.sequence - b.sequence || a.offerId.localeCompare(b.offerId))
			.slice(-rowLimit);
		const lifetimeSpentCopper = finiteNonNegative(ledger.lifetimeSpentCopper);
		const transactionCount = Math.max(0, Math.floor(finiteNonNegative(ledger.transactionCount)));
		return Object.freeze({
			transactionCount,
			lifetimeSpentCopper,
			rows: Object.freeze(transactions.map((transaction) => Object.freeze({ ...transaction, label: formatRow(transaction) }))),
			empty: transactions.length === 0,
			statusText: transactions.length === 0 ? 'Henüz işlem yok' : `${transactions.length} son işlem · ${lifetimeSpentCopper} bakır harcandı`,
		});
	}

	return Object.freeze({ present });
}
