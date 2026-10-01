/**
 * Bounded, deterministic presentation history for settlement trade receipts.
 * The authoritative economy/inventory/save owners remain external; this adapter
 * only keeps UI-facing receipts and can export/import a safe presentation snapshot.
 */

const DEFAULT_LIMIT = 12;

function normalizeLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(50, Math.floor(numeric)));
}

function normalizeReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  const fingerprint = typeof receipt.snapshotFingerprint === 'string' ? receipt.snapshotFingerprint : null;
  const kind = receipt.kind === 'buy' || receipt.kind === 'sell' ? receipt.kind : null;
  const subject = typeof receipt.subject === 'string' && receipt.subject.trim() ? receipt.subject.trim() : null;
  const quantity = Number(receipt.quantity);
  const copper = Number(receipt.copper);
  if (!fingerprint || !kind || !subject || !Number.isInteger(quantity) || quantity <= 0) return null;
  return Object.freeze({
    ok: receipt.ok === true,
    kind,
    subject,
    quantity,
    copper: Number.isFinite(copper) ? copper : 0,
    snapshotFingerprint: fingerprint,
    reason: typeof receipt.reason === 'string' ? receipt.reason : null,
    message: typeof receipt.message === 'string' ? receipt.message : null,
  });
}

export function createSettlementTradeHistory({ limit = DEFAULT_LIMIT, initial = [] } = {}) {
  const maxEntries = normalizeLimit(limit);
  const entries = [];
  const seen = new Set();

  const keyFor = (entry) => [entry.kind, entry.subject, entry.quantity, entry.copper, entry.snapshotFingerprint, entry.ok, entry.reason || ''].join('|');

  const add = (receipt) => {
    const normalized = normalizeReceipt(receipt);
    if (!normalized) return Object.freeze({ added: false, reason: 'invalid-trade-receipt' });
    const key = keyFor(normalized);
    if (seen.has(key)) return Object.freeze({ added: false, reason: 'duplicate-trade-receipt', key });
    seen.add(key);
    entries.unshift(normalized);
    while (entries.length > maxEntries) {
      const removed = entries.pop();
      if (removed) seen.delete(keyFor(removed));
    }
    return Object.freeze({ added: true, entry: normalized, size: entries.length });
  };

  const list = () => Object.freeze(entries.slice());
  const summarize = () => {
    const summary = entries.reduce((acc, entry) => {
      acc.total += 1;
      acc[entry.kind] += 1;
      if (entry.ok) acc.successful += 1;
      else acc.failed += 1;
      acc.copper += entry.ok ? entry.copper : 0;
      acc.quantity += entry.ok ? entry.quantity : 0;
      return acc;
    }, { total: 0, buy: 0, sell: 0, successful: 0, failed: 0, copper: 0, quantity: 0 });
    return Object.freeze(summary);
  };
  const exportSnapshot = () => Object.freeze({ version: 1, limit: maxEntries, entries: list() });

  const importSnapshot = (snapshot) => {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.entries)) {
      return Object.freeze({ imported: false, reason: 'invalid-trade-history-snapshot' });
    }
    entries.length = 0;
    seen.clear();
    for (const receipt of snapshot.entries.slice(0, maxEntries).reverse()) add(receipt);
    return Object.freeze({ imported: true, size: entries.length });
  };

  for (const receipt of Array.isArray(initial) ? initial.slice(0, maxEntries).reverse() : []) add(receipt);

  return Object.freeze({ add, list, summarize, exportSnapshot, importSnapshot });
}
