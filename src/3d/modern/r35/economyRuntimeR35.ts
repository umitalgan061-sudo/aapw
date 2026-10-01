
import { clamp, fail, ok, stableHash, type R35Id, type R35Result } from './contracts';

export interface MarketItem {
  readonly id: R35Id;
  readonly basePrice: number;
  readonly volatility: number;
  readonly minPrice: number;
  readonly maxPrice: number;
  readonly tags: readonly string[];
}

export interface MarketQuote {
  readonly itemId: R35Id;
  readonly buy: number;
  readonly sell: number;
  readonly spread: number;
  readonly supply: number;
  readonly demand: number;
  readonly trend: number;
  readonly tick: number;
}

export interface MarketTransaction {
  readonly id: R35Id;
  readonly itemId: R35Id;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly side: 'buy' | 'sell';
  readonly tick: number;
  readonly accepted: boolean;
}

interface MarketState {
  supply: number;
  demand: number;
  lastPrice: number;
  momentum: number;
}

function priceFor(
  item: MarketItem,
  state: MarketState,
): number {
  const pressure = state.demand / Math.max(1, state.supply);
  const raw =
    item.basePrice
    * (1 + (pressure - 1) * item.volatility)
    * (1 + state.momentum * item.volatility * 0.25);
  return clamp(raw, item.minPrice, item.maxPrice);
}

export class EconomyRuntimeR35 {
  #items = new Map<R35Id, MarketItem>();
  #markets = new Map<R35Id, MarketState>();
  #transactions: MarketTransaction[] = [];
  #balances = new Map<R35Id, number>();
  #tick = 0;
  #revision = 0;

  register(item: MarketItem): R35Result<MarketItem> {
    if (!item.id) return fail('MARKET_ITEM_INVALID', 'Market item id is required');
    if (this.#items.has(item.id)) return fail('MARKET_ITEM_DUPLICATE', 'Market item exists');
    if (item.basePrice <= 0 || item.minPrice <= 0 || item.maxPrice < item.minPrice) {
      return fail('MARKET_PRICE_INVALID', 'Market item price bounds are invalid');
    }
    if (item.volatility < 0 || item.volatility > 2) {
      return fail('MARKET_VOLATILITY_INVALID', 'Market volatility must be in range');
    }
    this.#items.set(
      item.id,
      Object.freeze({
        ...item,
        tags: Object.freeze([...item.tags]),
      }),
    );
    this.#markets.set(
      item.id,
      {
        supply: 100,
        demand: 100,
        lastPrice: item.basePrice,
        momentum: 0,
      },
    );
    return ok(item);
  }

  seed(itemId: R35Id, supply: number, demand: number): R35Result<void> {
    const market = this.#markets.get(itemId);
    if (!market) return fail('MARKET_ITEM_MISSING', 'Cannot seed an unknown market item');
    market.supply = clamp(Math.trunc(supply), 0, 1000000);
    market.demand = clamp(Math.trunc(demand), 0, 1000000);
    market.lastPrice = priceFor(this.#items.get(itemId)!, market);
    market.momentum = 0;
    return ok(undefined);
  }

  quote(itemId: R35Id): R35Result<MarketQuote> {
    const item = this.#items.get(itemId);
    const market = this.#markets.get(itemId);
    if (!item || !market) return fail('MARKET_ITEM_MISSING', 'Unknown market item');
    const mid = priceFor(item, market);
    const spread = clamp(mid * 0.04, 0.01, mid * 0.2);
    return ok(
      Object.freeze({
        itemId,
        buy: mid + spread,
        sell: Math.max(item.minPrice, mid - spread),
        spread,
        supply: market.supply,
        demand: market.demand,
        trend: market.momentum,
        tick: this.#tick,
      }),
    );
  }

  setBalance(actorId: R35Id, amount: number): void {
    this.#balances.set(actorId, Math.max(0, amount));
  }

  balance(actorId: R35Id): number {
    return this.#balances.get(actorId) ?? 0;
  }

  transact(
    actorId: R35Id,
    itemId: R35Id,
    quantity: number,
    side: 'buy' | 'sell',
  ): R35Result<MarketTransaction> {
    const actor = actorId.trim();
    const q = Math.trunc(quantity);
    const item = this.#items.get(itemId);
    const market = this.#markets.get(itemId);
    if (!actor || !item || !market) {
      return fail('TRANSACTION_INVALID', 'Transaction references unknown data');
    }
    if (q <= 0 || q > 10000) {
      return fail('TRANSACTION_QUANTITY', 'Transaction quantity is outside the safe range');
    }
    const quote = this.quote(itemId);
    if (!quote.ok) return quote;
    const unitPrice = side === 'buy' ? quote.value.buy : quote.value.sell;
    const total = unitPrice * q;
    if (side === 'buy') {
      if (market.supply < q) return fail('MARKET_SUPPLY', 'Not enough supply');
      if (this.balance(actor) < total) return fail('BALANCE_LOW', 'Insufficient balance');
      this.#balances.set(actor, this.balance(actor) - total);
      market.supply -= q;
      market.demand += q * 0.55;
      market.momentum = clamp(market.momentum + 0.05, -1, 1);
    } else {
      this.#balances.set(actor, this.balance(actor) + total);
      market.supply += q;
      market.demand = Math.max(0, market.demand - q * 0.35);
      market.momentum = clamp(market.momentum - 0.05, -1, 1);
    }
    this.#tick += 1;
    this.#revision += 1;
    market.lastPrice = unitPrice;
    const transaction: MarketTransaction = Object.freeze({
      id: stableHash({
        actor,
        itemId,
        quantity: q,
        side,
        tick: this.#tick,
      }),
      itemId,
      quantity: q,
      unitPrice,
      side,
      tick: this.#tick,
      accepted: true,
    });
    this.#transactions.push(transaction);
    if (this.#transactions.length > 4096) {
      this.#transactions.splice(0, this.#transactions.length - 4096);
    }
    return ok(transaction);
  }

  tick(cadence = 1): void {
    const steps = clamp(Math.trunc(cadence), 1, 60);
    for (let index = 0; index < steps; index += 1) {
      this.#tick += 1;
      for (const [id, market] of this.#markets) {
        const item = this.#items.get(id)!;
        const wave = Math.sin((this.#tick + id.length) * 0.031);
        market.momentum = clamp(market.momentum * 0.96 + wave * 0.02, -1, 1);
        market.demand = Math.max(0, market.demand + wave * item.volatility * 0.2);
        market.supply = Math.max(0, market.supply - wave * item.volatility * 0.15);
        market.lastPrice = priceFor(item, market);
      }
    }
    this.#revision += 1;
  }

  snapshot(): readonly MarketQuote[] {
    const quotes: MarketQuote[] = [];
    for (const id of [...this.#items.keys()].sort()) {
      const result = this.quote(id);
      if (result.ok) quotes.push(result.value);
    }
    return Object.freeze(quotes);
  }

  transactions(limit = 256): readonly MarketTransaction[] {
    return Object.freeze(
      this.#transactions.slice(-clamp(Math.trunc(limit), 1, 1000)),
    );
  }

  digest(): string {
    return stableHash({
      tick: this.#tick,
      revision: this.#revision,
      quotes: this.snapshot(),
      transactions: this.transactions(),
      balances: [...this.#balances.entries()].sort(),
    });
  }

  reset(): void {
    this.#transactions = [];
    this.#balances.clear();
    this.#tick = 0;
    this.#revision = 0;
    for (const market of this.#markets.values()) {
      market.supply = 100;
      market.demand = 100;
      market.lastPrice = 0;
      market.momentum = 0;
    }
    for (const [id, market] of this.#markets) {
      market.lastPrice = priceFor(this.#items.get(id)!, market);
    }
  }
}
