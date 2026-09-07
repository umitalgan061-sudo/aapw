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

  const add = (receipt) => {
    const normalized = normalizeReceipt(receipt);
    if (!normalized) return Object.freeze({ added: false, reason: 'invalid-trade-receipt' });
    const key = [normalized.kind, normalized.subject, normalized.quantity, normalized.copper, normalized.snapshotFingerprint, normalized.ok, normalized.reason || ''].join('|');
    if (seen.has(key)) return Object.freeze({ added: false, reason: 'duplicate-trade-receipt', key });
    seen.add(key);
    entries.unshift(normalized);
    while (entries.length > maxEntries) {
      const removed = entries.pop();
      if (removed) {
        const removedKey = [removed.kind, removed.subject, removed.quantity, removed.copper, removed.snapshotFingerprint, removed.ok, removed.reason || ''].join('|');
        seen.delete(removedKey);
      }
    }
    return Object.freeze({ added: true, entry: normalized, size: entries.length });
  };

  const list = () => Object.freeze(entries.slice());
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

  return Object.freeze({ add, list, exportSnapshot, importSnapshot });
}
