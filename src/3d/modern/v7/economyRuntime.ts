import { clamp, digest, stableSort, type Disposable, type EntityId, type V7Result } from './primitives.js';

export interface CurrencyBalance { readonly actor: EntityId; readonly currencies: Readonly<Record<string, number>>; readonly revision: number; }
export interface EconomyItem { readonly id: string; readonly price: number; readonly stock: number; readonly maxStock: number; readonly restockPerTick: number; readonly category: string; }
export interface Transaction { readonly id: string; readonly actor: EntityId; readonly item: string; readonly quantity: number; readonly unitPrice: number; readonly currency: string; readonly tick: number; readonly accepted: boolean; readonly reason: string; readonly digest: string; }
export interface EconomyStats { readonly actors: number; readonly items: number; readonly transactions: number; readonly rejected: number; readonly totalVolume: number; }

export class DeterministicEconomyRuntime implements Disposable {
  #balances = new Map<EntityId, CurrencyBalance>();
  #items = new Map<string, EconomyItem>();
  #transactions: Transaction[] = [];
  #serial = 0;
  #rejected = 0;
  #volume = 0;
  #disposed = false;

  registerItem(item: EconomyItem): boolean {
    if (this.#disposed || !item.id || this.#items.has(item.id)) return false;
    if (item.price < 0 || item.stock < 0 || item.maxStock < item.stock) return false;
    this.#items.set(item.id, Object.freeze({ ...item, price: Number(item.price), stock: Math.trunc(item.stock), maxStock: Math.trunc(item.maxStock), restockPerTick: Math.max(0, Number(item.restockPerTick)) }));
    return true;
  }

  createWallet(actor: EntityId, currencies: Readonly<Record<string, number>> = {}): boolean {
    if (this.#disposed || this.#balances.has(actor)) return false;
    const normalized = Object.fromEntries(Object.entries(currencies).map(([key, value]) => [key, Math.max(0, Number(value))]));
    this.#balances.set(actor, Object.freeze({ actor, currencies: Object.freeze(normalized), revision: 1 }));
    return true;
  }

  grant(actor: EntityId, currency: string, amount: number): V7Result<CurrencyBalance> {
    const wallet = this.#balances.get(actor);
    if (!wallet || !currency || amount < 0) return this.fail('GRANT_INVALID');
    const currencies = { ...wallet.currencies, [currency]: (wallet.currencies[currency] ?? 0) + amount };
    const next = Object.freeze({ ...wallet, currencies: Object.freeze(currencies), revision: wallet.revision + 1 });
    this.#balances.set(actor, next);
    return { ok: true, value: next };
  }

  buy(actor: EntityId, itemId: string, quantity = 1, currency = 'gold', tick = 0): V7Result<Transaction> {
    if (this.#disposed) return this.fail('ECONOMY_DISPOSED');
    const wallet = this.#balances.get(actor);
    const item = this.#items.get(itemId);
    const count = Math.max(1, Math.min(999, Math.trunc(quantity)));
    let accepted = true;
    let reason = 'accepted';
    if (!wallet || !item) { accepted = false; reason = 'missing-wallet-or-item'; }
    else if (item.stock < count) { accepted = false; reason = 'stock-low'; }
    else if ((wallet.currencies[currency] ?? 0) < item.price * count) { accepted = false; reason = 'funds-low'; }
    if (accepted && wallet && item) {
      const currencies = { ...wallet.currencies, [currency]: wallet.currencies[currency]! - item.price * count };
      this.#balances.set(actor, Object.freeze({ ...wallet, currencies: Object.freeze(currencies), revision: wallet.revision + 1 }));
      this.#items.set(itemId, Object.freeze({ ...item, stock: item.stock - count }));
      this.#volume += item.price * count;
    } else {
      this.#rejected += 1;
    }
    const transaction = Object.freeze({ id: `tx:${++this.#serial}`, actor, item: itemId, quantity: count, unitPrice: item?.price ?? 0, currency, tick: Math.trunc(tick), accepted, reason, digest: digest(actor, itemId, count, currency, accepted, reason, tick) });
    this.#transactions.push(transaction);
    if (this.#transactions.length > 4096) this.#transactions.shift();
    return accepted ? { ok: true, value: transaction } : { ok: false, code: 'PURCHASE_REJECTED', message: reason, retryable: reason === 'stock-low' ? true : false };
  }

  tick(): void {
    if (this.#disposed) return;
    for (const item of this.items()) {
      if (item.stock >= item.maxStock || item.restockPerTick <= 0) continue;
      const restocked = Math.min(item.maxStock, item.stock + Math.max(1, Math.floor(item.restockPerTick)));
      this.#items.set(item.id, Object.freeze({ ...item, stock: restocked }));
    }
  }

  wallet(actor: EntityId): CurrencyBalance | undefined { return this.#balances.get(actor); }
  item(id: string): EconomyItem | undefined { return this.#items.get(id); }
  items(): readonly EconomyItem[] { return Object.freeze(stableSort([...this.#items.values()], (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id))); }
  transactions(): readonly Transaction[] { return Object.freeze([...this.#transactions]); }
  stats(): EconomyStats { return Object.freeze({ actors: this.#balances.size, items: this.#items.size, transactions: this.#transactions.length, rejected: this.#rejected, totalVolume: this.#volume }); }
  dispose(): void { this.#disposed = true; this.#balances.clear(); this.#items.clear(); this.#transactions.length = 0; }
  #fail<T>(code: string): V7Result<T> { return { ok: false, code, message: code, retryable: false }; }
}
