import { resolveTradeQuote } from './settlementCampaignContent.legacy.js';

export type TradeDirection = 'buy' | 'sell';
export type TradePlanReason =
  | 'ok'
  | 'unsupported-service'
  | 'service-closed'
  | 'unknown-item'
  | 'invalid-quantity'
  | 'insufficient-copper'
  | 'missing-item'
  | 'insufficient-stock';

export interface SettlementTradeRequest {
  readonly serviceId: string;
  readonly direction: TradeDirection;
  readonly itemId: string;
  readonly quantity: number;
  readonly serviceOpen?: boolean;
  readonly copper?: number;
  readonly inventory?: Readonly<Record<string, number>>;
  readonly stock?: Readonly<Record<string, number>>;
  readonly modifiers?: Readonly<Record<string, number>>;
}

export interface SettlementTradePlan {
  readonly ok: boolean;
  readonly reason: TradePlanReason;
  readonly serviceId: 'market';
  readonly direction: TradeDirection;
  readonly itemId: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly total: number;
  readonly copperDelta: number;
  readonly inventoryDelta: Readonly<Record<string, number>>;
  readonly stockDelta: Readonly<Record<string, number>>;
  readonly signature: string;
}

const MARKET = 'market' as const;
const MAX_QUANTITY = 999;

function clampQuantity(value: unknown): number {
  const quantity = Math.trunc(Number(value));
  return Number.isFinite(quantity) ? Math.max(1, Math.min(MAX_QUANTITY, quantity)) : 0;
}

function readCount(source: Readonly<Record<string, number>> | undefined, itemId: string): number {
  const value = source?.[itemId];
  return Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
}

function stableSignature(parts: readonly unknown[]): string {
  let hash = 2166136261;
  const input = JSON.stringify(parts);
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `settlement-trade-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function freezePlan(plan: SettlementTradePlan): SettlementTradePlan {
  Object.freeze(plan.inventoryDelta);
  Object.freeze(plan.stockDelta);
  return Object.freeze(plan);
}

export function buildSettlementTradePlan(request: SettlementTradeRequest): SettlementTradePlan {
  const direction = request.direction === 'sell' ? 'sell' : 'buy';
  const quantity = clampQuantity(request.quantity);
  const base = {
    serviceId: MARKET,
    direction,
    itemId: String(request.itemId ?? ''),
    quantity,
  } as const;

  if (request.serviceId !== MARKET) return freezePlan({ ...base, ok: false, reason: 'unsupported-service', unitPrice: 0, total: 0, copperDelta: 0, inventoryDelta: {}, stockDelta: {}, signature: stableSignature(['blocked', 'service', request.serviceId]) });
  if (request.serviceOpen === false) return freezePlan({ ...base, ok: false, reason: 'service-closed', unitPrice: 0, total: 0, copperDelta: 0, inventoryDelta: {}, stockDelta: {}, signature: stableSignature(['blocked', 'closed', base.itemId, direction, quantity]) });
  if (quantity === 0) return freezePlan({ ...base, ok: false, reason: 'invalid-quantity', unitPrice: 0, total: 0, copperDelta: 0, inventoryDelta: {}, stockDelta: {}, signature: stableSignature(['blocked', 'quantity']) });

  const quote = resolveTradeQuote(base.itemId, quantity, direction, request.modifiers ?? {});
  if (!quote.ok) return freezePlan({ ...base, ok: false, reason: 'unknown-item', unitPrice: 0, total: 0, copperDelta: 0, inventoryDelta: {}, stockDelta: {}, signature: stableSignature(['blocked', 'item', base.itemId]) });

  const inventoryCount = readCount(request.inventory, base.itemId);
  const stockCount = readCount(request.stock, base.itemId);
  if (direction === 'buy' && stockCount < quantity) return freezePlan({ ...base, ok: false, reason: 'insufficient-stock', unitPrice: quote.unitPrice, total: quote.total, copperDelta: 0, inventoryDelta: {}, stockDelta: {}, signature: stableSignature(['blocked', 'stock', base.itemId, quantity, stockCount]) });
  if (direction === 'sell' && inventoryCount < quantity) return freezePlan({ ...base, ok: false, reason: 'missing-item', unitPrice: quote.unitPrice, total: quote.total, copperDelta: 0, inventoryDelta: {}, stockDelta: {}, signature: stableSignature(['blocked', 'inventory', base.itemId, quantity, inventoryCount]) });

  const copper = Math.max(0, Math.trunc(Number(request.copper) || 0));
  if (direction === 'buy' && copper < quote.total) return freezePlan({ ...base, ok: false, reason: 'insufficient-copper', unitPrice: quote.unitPrice, total: quote.total, copperDelta: 0, inventoryDelta: {}, stockDelta: {}, signature: stableSignature(['blocked', 'copper', base.itemId, quote.total, copper]) });

  const inventoryDelta = { [base.itemId]: direction === 'buy' ? quantity : -quantity };
  const stockDelta = { [base.itemId]: direction === 'buy' ? -quantity : quantity };
  const copperDelta = direction === 'buy' ? -quote.total : quote.total;
  return freezePlan({ ...base, ok: true, reason: 'ok', unitPrice: quote.unitPrice, total: quote.total, copperDelta, inventoryDelta, stockDelta, signature: stableSignature(['ok', base.itemId, direction, quantity, quote.unitPrice, copperDelta]) });
}

export function isSettlementTradePlan(value: unknown): value is SettlementTradePlan {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SettlementTradePlan>;
  return candidate.serviceId === MARKET
    && (candidate.direction === 'buy' || candidate.direction === 'sell')
    && typeof candidate.itemId === 'string'
    && Number.isInteger(candidate.quantity)
    && Number.isInteger(candidate.unitPrice)
    && Number.isInteger(candidate.total)
    && Number.isInteger(candidate.copperDelta)
    && typeof candidate.signature === 'string'
    && Object.isFrozen(value);
}
