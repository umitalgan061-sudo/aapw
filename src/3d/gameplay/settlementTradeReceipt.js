/**
 * Deterministic presentation adapter for settlement trade outcomes.
 * It never mutates economy/inventory state; callers provide the authoritative result.
 */

function finiteInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

export function buildSettlementTradeReceipt({ intent = null, result = null, currency = 'copper' } = {}) {
  const safeIntent = intent && typeof intent === 'object' ? intent : {};
  const safeResult = result && typeof result === 'object' ? result : {};
  const ok = safeResult.ok === true;
  const quantity = Math.max(0, finiteInt(safeIntent.quantity));
  const expectedCopper = Math.max(0, finiteInt(safeIntent.expectedCopper));
  const action = safeIntent.action === 'buy' || safeIntent.action === 'sell' ? safeIntent.action : null;
  const subject = action === 'buy' ? safeIntent.offerId : action === 'sell' ? safeIntent.itemId : null;
  return Object.freeze({
    ok,
    action,
    subject,
    quantity,
    expectedCopper,
    currency,
    reason: ok ? 'completed' : String(safeResult.reason || 'trade-failed'),
    message: ok
      ? `${action === 'buy' ? 'Purchased' : 'Sold'} ${quantity} × ${subject || 'item'} for ${expectedCopper} ${currency}.`
      : `Trade failed: ${String(safeResult.reason || 'trade-failed')}.`,
    snapshotFingerprint: safeIntent.snapshotFingerprint || null,
  });
}
