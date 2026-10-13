export interface SettlementMarketStockEntry {
  readonly itemId: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly affordableQuantity: number;
  readonly purchasable: boolean;
}

export interface SettlementMarketSnapshotRequest {
  readonly serviceId: string;
  readonly serviceOpen?: boolean;
  readonly copper?: number;
  readonly stock?: Readonly<Record<string, number>>;
  readonly prices?: Readonly<Record<string, number>>;
}

export interface SettlementMarketSnapshot {
  readonly ok: boolean;
  readonly reason: 'ok' | 'unsupported-service' | 'service-closed' | 'missing-stock';
  readonly serviceId: 'market';
  readonly copper: number;
  readonly entries: readonly SettlementMarketStockEntry[];
  readonly totalStock: number;
  readonly signature: string;
}

const MARKET = 'market' as const;
const MAX_PRICE = 1_000_000;

function clampInteger(value: unknown, minimum = 0, maximum = MAX_PRICE): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function stableSignature(parts: readonly unknown[]): string {
  let hash = 2166136261;
  const input = JSON.stringify(parts);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `settlement-market-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function freezeSnapshot(snapshot: SettlementMarketSnapshot): SettlementMarketSnapshot {
  snapshot.entries.forEach((entry) => Object.freeze(entry));
  Object.freeze(snapshot.entries);
  return Object.freeze(snapshot);
}

export function buildSettlementMarketSnapshot(request: SettlementMarketSnapshotRequest): SettlementMarketSnapshot {
  const copper = clampInteger(request.copper, 0);
  const stock = request.stock && typeof request.stock === 'object' ? request.stock : undefined;
  const prices = request.prices && typeof request.prices === 'object' ? request.prices : {};
  const itemIds = stock ? Object.keys(stock).filter((itemId) => itemId.length > 0).sort() : [];

  const base = {
    serviceId: MARKET,
    copper,
  } as const;

  if (request.serviceId !== MARKET) {
    return freezeSnapshot({ ...base, ok: false, reason: 'unsupported-service', entries: [], totalStock: 0, signature: stableSignature(['blocked', 'service', request.serviceId]) });
  }
  if (request.serviceOpen === false) {
    return freezeSnapshot({ ...base, ok: false, reason: 'service-closed', entries: [], totalStock: 0, signature: stableSignature(['blocked', 'closed']) });
  }
  if (!stock || itemIds.length === 0) {
    return freezeSnapshot({ ...base, ok: false, reason: 'missing-stock', entries: [], totalStock: 0, signature: stableSignature(['blocked', 'stock']) });
  }

  const entries = itemIds.map((itemId) => {
    const quantity = clampInteger(stock[itemId], 0, MAX_PRICE);
    const unitPrice = clampInteger(prices[itemId], 0, MAX_PRICE);
    const affordableQuantity = unitPrice > 0 ? Math.min(quantity, Math.floor(copper / unitPrice)) : quantity;
    return {
      itemId,
      quantity,
      unitPrice,
      affordableQuantity,
      purchasable: quantity > 0 && (unitPrice === 0 || affordableQuantity > 0),
    };
  });

  const totalStock = entries.reduce((total, entry) => total + entry.quantity, 0);
  return freezeSnapshot({
    ...base,
    ok: true,
    reason: 'ok',
    entries,
    totalStock,
    signature: stableSignature(['ok', copper, entries.map((entry) => [entry.itemId, entry.quantity, entry.unitPrice, entry.affordableQuantity])]),
  });
}

export function isSettlementMarketSnapshot(value: unknown): value is SettlementMarketSnapshot {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SettlementMarketSnapshot>;
  return candidate.serviceId === MARKET
    && typeof candidate.ok === 'boolean'
    && typeof candidate.reason === 'string'
    && Number.isInteger(candidate.copper)
    && Array.isArray(candidate.entries)
    && Number.isInteger(candidate.totalStock)
    && typeof candidate.signature === 'string'
    && Object.isFrozen(value)
    && Object.isFrozen(candidate.entries);
}
