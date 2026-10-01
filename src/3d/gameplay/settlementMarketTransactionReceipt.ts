export type MarketTransactionDirection = 'buy' | 'sell';

export interface MarketTransactionInput {
  serviceId?: string;
  action?: string;
  itemId?: string;
  quantity?: number;
  direction?: MarketTransactionDirection | string;
  unitPrice?: number;
  copperBefore?: number;
  copperAfter?: number;
  stockBefore?: number;
  stockAfter?: number;
  inventoryBefore?: number;
  inventoryAfter?: number;
  requestId?: string;
  sequence?: number;
}

export interface SettlementMarketTransactionReceipt {
  kind: 'settlement-market-transaction';
  ok: boolean;
  reason: 'ok' | 'unsupported-service' | 'unsupported-action' | 'unknown-item' | 'invalid-quantity' | 'invalid-price' | 'invalid-ledger' | 'invalid-direction';
  serviceId: 'market' | null;
  action: 'buy' | 'sell' | null;
  itemId: string | null;
  direction: MarketTransactionDirection | null;
  quantity: number;
  unitPrice: number;
  total: number;
  copperDelta: number;
  stockDelta: number;
  inventoryDelta: number;
  requestId: string | null;
  sequence: number;
  signature: string;
}

const ACTIONS = new Set(['buy', 'sell', 'trade']);

function clampInt(value: unknown, fallback = 0, max = 999999): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(n)));
}

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function createSettlementMarketTransactionReceipt(input: MarketTransactionInput = {}): SettlementMarketTransactionReceipt {
  const serviceId = input.serviceId === 'market' ? 'market' : null;
  const action = typeof input.action === 'string' && ACTIONS.has(input.action) ? (input.action === 'sell' ? 'sell' : input.action === 'buy' ? 'buy' : null) : null;
  const itemId = typeof input.itemId === 'string' && input.itemId.trim() ? input.itemId.trim() : null;
  const direction = input.direction === 'buy' || input.direction === 'sell' ? input.direction : null;
  const quantity = clampInt(input.quantity, 0, 999);
  const unitPrice = clampInt(input.unitPrice, 0, 999999);
  const copperBefore = clampInt(input.copperBefore);
  const copperAfter = clampInt(input.copperAfter);
  const stockBefore = clampInt(input.stockBefore, 0, 999);
  const stockAfter = clampInt(input.stockAfter, 0, 999);
  const inventoryBefore = clampInt(input.inventoryBefore, 0, 999);
  const inventoryAfter = clampInt(input.inventoryAfter, 0, 999);
  const total = quantity * unitPrice;
  const copperDelta = copperAfter - copperBefore;
  const stockDelta = stockAfter - stockBefore;
  const inventoryDelta = inventoryAfter - inventoryBefore;

  let reason: SettlementMarketTransactionReceipt['reason'] = 'ok';
  if (!serviceId) reason = 'unsupported-service';
  else if (!action) reason = typeof input.action === 'string' && ACTIONS.has(input.action) ? 'unsupported-action' : 'unsupported-action';
  else if (!itemId) reason = 'unknown-item';
  else if (!direction) reason = 'invalid-direction';
  else if (quantity < 1) reason = 'invalid-quantity';
  else if (!Number.isFinite(Number(input.unitPrice)) || Number(input.unitPrice) < 0) reason = 'invalid-price';
  else if (direction === 'buy' && (copperDelta !== -total || stockDelta !== -quantity || inventoryDelta !== quantity)) reason = 'invalid-ledger';
  else if (direction === 'sell' && (copperDelta !== total || stockDelta !== quantity || inventoryDelta !== -quantity)) reason = 'invalid-ledger';

  const receipt = {
    kind: 'settlement-market-transaction' as const,
    ok: reason === 'ok',
    reason,
    serviceId,
    action,
    itemId,
    direction,
    quantity,
    unitPrice,
    total,
    copperDelta,
    stockDelta,
    inventoryDelta,
    requestId: typeof input.requestId === 'string' && input.requestId.trim() ? input.requestId.trim() : null,
    sequence: clampInt(input.sequence),
    signature: ''
  };
  receipt.signature = hash(JSON.stringify({ ...receipt, signature: undefined }));
  return Object.freeze(receipt);
}

export function isSettlementMarketTransactionReceipt(value: unknown): value is SettlementMarketTransactionReceipt {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as SettlementMarketTransactionReceipt;
  return candidate.kind === 'settlement-market-transaction'
    && typeof candidate.ok === 'boolean'
    && typeof candidate.signature === 'string'
    && Number.isInteger(candidate.quantity)
    && Number.isInteger(candidate.total)
    && (candidate.direction === 'buy' || candidate.direction === 'sell' || candidate.direction === null);
}
