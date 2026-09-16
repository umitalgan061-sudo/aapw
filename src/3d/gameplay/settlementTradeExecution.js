/**
 * Fail-closed execution bridge for settlement trade UX intents.
 * Existing interaction economy/inventory owners remain authoritative: callers inject
 * purchase/sell callbacks and this adapter only validates snapshot freshness and
 * forwards the already-derived intent.
 */

function asFunction(value) {
  return typeof value === 'function' ? value : null;
}

function normalizeResult(value, fallbackReason) {
  if (value && typeof value === 'object') return Object.freeze({ ...value });
  return Object.freeze({ ok: false, reason: fallbackReason });
}

export function executeSettlementTradeIntent(
  intent,
  {
    currentFingerprint = null,
    purchase = null,
    sell = null,
  } = {},
) {
  if (!intent || typeof intent !== 'object' || intent.ok !== true) {
    return Object.freeze({ ok: false, reason: intent?.reason || 'invalid-trade-intent' });
  }
  if (intent.snapshotFingerprint && currentFingerprint && intent.snapshotFingerprint !== currentFingerprint) {
    return Object.freeze({
      ok: false,
      reason: 'stale-trade-snapshot',
      expectedFingerprint: intent.snapshotFingerprint,
      actualFingerprint: currentFingerprint,
    });
  }

  if (intent.action === 'buy') {
    const callback = asFunction(purchase);
    if (!callback) return Object.freeze({ ok: false, reason: 'purchase-handler-unavailable', offerId: intent.offerId });
    return normalizeResult(
      callback(intent.offerId, intent.quantity, { expectedCopper: intent.expectedCopper, snapshotFingerprint: intent.snapshotFingerprint }),
      'purchase-rejected',
    );
  }
  if (intent.action === 'sell') {
    const callback = asFunction(sell);
    if (!callback) return Object.freeze({ ok: false, reason: 'sell-handler-unavailable', itemId: intent.itemId });
    return normalizeResult(
      callback(intent.itemId, intent.quantity, { expectedCopper: intent.expectedCopper, snapshotFingerprint: intent.snapshotFingerprint }),
      'sell-rejected',
    );
  }
  return Object.freeze({ ok: false, reason: 'unsupported-action', action: intent.action || null });
}
