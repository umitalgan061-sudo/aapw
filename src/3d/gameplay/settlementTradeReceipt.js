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
  const quantity = Math.max(0, finiteInt(safeIntent.quantity));
  const expectedCopper = Math.max(0, finiteInt(safeIntent.expectedCopper));
  const action = safeIntent.action === 'buy' || safeIntent.action === 'sell' ? safeIntent.action : null;
  const subject = action === 'buy' ? safeIntent.offerId : action === 'sell' ? safeIntent.itemId : null;
  const validIntent = Boolean(action && subject && quantity > 0);
  const ok = safeResult.ok === true && validIntent;
  const reason = ok ? 'completed' : !validIntent ? 'invalid-trade-intent' : String(safeResult.reason || 'trade-failed');
  return Object.freeze({
    ok,
    action,
    subject,
    quantity,
    expectedCopper,
    currency,
    reason,
    message: ok
      ? `${action === 'buy' ? 'Purchased' : 'Sold'} ${quantity} × ${subject} for ${expectedCopper} ${currency}.`
      : `Trade failed: ${reason}.`,
    snapshotFingerprint: safeIntent.snapshotFingerprint || null,
  });
}
