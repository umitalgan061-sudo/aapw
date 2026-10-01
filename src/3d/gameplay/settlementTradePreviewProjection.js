const VERSION = 1;
const MAX_ROWS = 32;

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positiveInt = (value, fallback = 0) => Math.max(0, Math.floor(finite(value, fallback)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;

function normalizeItem(item = {}) {
  return {
    id: text(item.id, 'unknown-item'),
    label: text(item.label, text(item.id, 'Unknown item')),
    quantity: positiveInt(item.quantity),
    unitPrice: Math.max(0, finite(item.unitPrice)),
    stock: positiveInt(item.stock),
    maxStock: Math.max(positiveInt(item.maxStock), positiveInt(item.stock)),
    buyMultiplier: clamp(finite(item.buyMultiplier, 1), 0.1, 10),
    sellMultiplier: clamp(finite(item.sellMultiplier, 0.5), 0.05, 5),
    category: text(item.category, 'misc'),
    requiredService: text(item.requiredService, 'market')
  };
}

function stableSort(items) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id) || a.category.localeCompare(b.category));
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function createSettlementTradePreview(input = {}) {
  const inSettlement = Boolean(input.inSettlement);
  const defeated = Boolean(input.defeated);
  const serviceReady = input.serviceReady !== false;
  const gold = positiveInt(input.gold);
  const rows = stableSort(Array.isArray(input.items) ? input.items.slice(0, MAX_ROWS).map(normalizeItem) : []);
  const available = [];
  const blocked = [];
  const totals = { buy: 0, sell: 0, buyCount: 0, sellCount: 0 };

  rows.forEach((item) => {
    const buyPrice = Math.max(0, Math.round(item.unitPrice * item.buyMultiplier));
    const sellPrice = Math.max(0, Math.round(item.unitPrice * item.sellMultiplier));
    const canBuy = inSettlement && !defeated && serviceReady && item.stock > 0 && gold >= buyPrice;
    const canSell = inSettlement && !defeated && serviceReady && item.quantity > 0;
    const row = {
      id: item.id,
      label: item.label,
      category: item.category,
      stock: item.stock,
      quantity: item.quantity,
      buyPrice,
      sellPrice,
      canBuy,
      canSell,
      reason: canBuy || canSell ? 'ready' : (!inSettlement ? 'outside-settlement' : (defeated ? 'settlement-defeated' : (!serviceReady ? 'market-unavailable' : (item.stock <= 0 ? 'out-of-stock' : (gold < buyPrice ? 'insufficient-gold' : 'no-sellable-quantity')))))
    };
    (canBuy || canSell ? available : blocked).push(row);
    if (canBuy) { totals.buy += buyPrice; totals.buyCount += 1; }
    if (canSell) { totals.sell += sellPrice; totals.sellCount += 1; }
  });

  const result = {
    version: VERSION,
    scope: 'settlement-trade-preview',
    inSettlement,
    defeated,
    serviceReady,
    gold,
    available,
    blocked,
    totals,
    nextAction: available.length ? (available.some((row) => row.canBuy) ? 'buy' : 'sell') : 'inspect-quest-or-service',
    ownership: { execution: 'caller-owned economy/inventory/vendor runtime', mutation: 'none', materialPlacement: 'merged-#590' }
  };
  result.fingerprint = stableStringify(result);
  return freeze(result);
}

export function validateSettlementTradePreview(preview) {
  return Boolean(preview && preview.scope === 'settlement-trade-preview' && preview.version === VERSION && Array.isArray(preview.available) && Array.isArray(preview.blocked) && preview.totals && typeof preview.fingerprint === 'string');
}
