/**
 * Thin market UX adapter over the existing interaction-owned economy/inventory state.
 * It does not own copper, stock, inventory, or persistence; it only derives deterministic
 * buy/sell presentation and fail-closed action intents for the settlement UI.
 */

export const SETTLEMENT_TRADE_UX_POLICY = Object.freeze({
  id: 'settlement-trade-ux-2026-09-07-v1',
  sellRate: 0.5,
  minimumSellCopper: 1,
});

function finiteInt(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function normalizeInventoryItems(snapshot) {
  return Array.isArray(snapshot?.items) ? snapshot.items : [];
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of String(value ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sellValue(item, priceCopper) {
  const unitPrice = Math.max(0, finiteInt(priceCopper));
  const quantity = Math.max(0, finiteInt(item?.quantity));
  return Math.max(SETTLEMENT_TRADE_UX_POLICY.minimumSellCopper, Math.floor(unitPrice * SETTLEMENT_TRADE_UX_POLICY.sellRate)) * quantity;
}

export function buildSettlementSellQuotes(inventorySnapshot = {}, offers = []) {
  const offerByItem = new Map((Array.isArray(offers) ? offers : []).map((offer) => [offer?.itemId, offer]));
  return Object.freeze(normalizeInventoryItems(inventorySnapshot)
    .map((item) => {
      const offer = offerByItem.get(item.itemId);
      const referencePriceCopper = finiteInt(offer?.priceCopper, 0);
      const quantity = Math.max(0, finiteInt(item.quantity));
      return Object.freeze({
        itemId: item.itemId,
        label: item.name || item.itemId,
        quantity,
        referencePriceCopper,
        unitSellCopper: Math.max(SETTLEMENT_TRADE_UX_POLICY.minimumSellCopper, Math.floor(referencePriceCopper * SETTLEMENT_TRADE_UX_POLICY.sellRate)),
        totalSellCopper: sellValue(item, referencePriceCopper),
        available: quantity > 0 && referencePriceCopper > 0,
        reason: quantity <= 0 ? 'empty-inventory' : referencePriceCopper <= 0 ? 'no-market-reference' : 'available',
      });
    })
    .sort((left, right) => left.itemId.localeCompare(right.itemId)));
}

export function buildSettlementTradePanel({ economySnapshot = {}, inventorySnapshot = {}, offers = [], service = null } = {}) {
  const buyQuotes = Object.freeze((Array.isArray(offers) ? offers : []).map((offer) => {
    const stock = finiteInt(economySnapshot?.stockByOffer?.[offer?.id], finiteInt(offer?.stockLimit));
    const priceCopper = finiteInt(offer?.priceCopper, 0);
    const balanceCopper = Math.max(0, finiteInt(economySnapshot?.copper));
    const available = stock > 0 && priceCopper >= 0 && balanceCopper >= priceCopper;
    return Object.freeze({
      offerId: offer?.id,
      itemId: offer?.itemId,
      label: offer?.label || offer?.itemId,
      stock,
      priceCopper,
      available,
      reason: stock <= 0 ? 'out-of-stock' : priceCopper < 0 ? 'invalid-price' : balanceCopper < priceCopper ? 'insufficient-funds' : 'available',
    });
  }));
  const sellQuotes = buildSettlementSellQuotes(inventorySnapshot, offers);
  const fingerprint = stableHash(JSON.stringify({
    serviceId: service?.serviceId || 'settlement-market',
    balanceCopper: Math.max(0, finiteInt(economySnapshot?.copper)),
    buyQuotes,
    sellQuotes,
  }));
  return Object.freeze({
    policyId: SETTLEMENT_TRADE_UX_POLICY.id,
    serviceId: service?.serviceId || 'settlement-market',
    balanceCopper: Math.max(0, finiteInt(economySnapshot?.copper)),
    buyQuotes,
    sellQuotes,
    primaryAction: buyQuotes.some((quote) => quote.available) ? 'buy' : sellQuotes.some((quote) => quote.available) ? 'sell' : null,
    snapshotFingerprint: fingerprint,
  });
}

export function buildSettlementTradeActionIntent(panel, { action = '', offerId = null, itemId = null, quantity = 1, expectedFingerprint = null } = {}) {
  const requestedQuantity = Math.max(1, finiteInt(quantity, 1));
  if (expectedFingerprint && expectedFingerprint !== panel?.snapshotFingerprint) {
    return Object.freeze({ ok: false, action: null, quantity: requestedQuantity, reason: 'stale-trade-snapshot', expectedFingerprint, actualFingerprint: panel?.snapshotFingerprint || null });
  }
  if (action === 'buy') {
    const quote = panel?.buyQuotes?.find((entry) => entry.offerId === offerId) || null;
    return Object.freeze({
      ok: Boolean(quote?.available),
      action,
      offerId,
      quantity: requestedQuantity,
      expectedCopper: quote?.available ? quote.priceCopper * requestedQuantity : 0,
      reason: quote?.available ? 'ready-for-existing-economy-purchase' : quote?.reason || 'unknown-offer',
      snapshotFingerprint: panel?.snapshotFingerprint || null,
    });
  }
  if (action === 'sell') {
    const quote = panel?.sellQuotes?.find((entry) => entry.itemId === itemId) || null;
    const ok = Boolean(quote?.available && quote.quantity >= requestedQuantity);
    return Object.freeze({
      ok,
      action,
      itemId,
      quantity: requestedQuantity,
      expectedCopper: ok ? quote.unitSellCopper * requestedQuantity : 0,
      reason: ok ? 'ready-for-existing-economy-sell' : quote?.reason || 'unknown-item',
      snapshotFingerprint: panel?.snapshotFingerprint || null,
    });
  }
  return Object.freeze({ ok: false, action: null, quantity: requestedQuantity, reason: 'unsupported-action', snapshotFingerprint: panel?.snapshotFingerprint || null });
}
