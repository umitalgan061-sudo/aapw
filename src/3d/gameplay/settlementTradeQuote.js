const MAX_LINES = 12;
const clamp = (v, min, max, fallback = min) => Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const text = (v, fallback = '') => typeof v === 'string' ? v : fallback;
const bool = v => v === true;
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
};
const sortedEntries = value => Object.entries(value && typeof value === 'object' ? value : {})
  .filter(([id, qty]) => typeof id === 'string' && id && Number.isFinite(qty) && qty > 0)
  .sort(([a], [b]) => a.localeCompare(b));

export const SETTLEMENT_TRADE_QUOTE_VERSION = 1;

export function createSettlementTradeQuote(content, snapshot = {}, options = {}) {
  const items = content?.items && typeof content.items === 'object' ? content.items : {};
  const inventory = snapshot?.inventory && typeof snapshot.inventory === 'object' ? snapshot.inventory : {};
  const copper = Math.max(0, Math.floor(finite(snapshot?.copper, 0)));
  const mode = options.mode === 'sell' ? 'sell' : 'buy';
  const requested = Array.isArray(options.itemIds) ? options.itemIds : Object.keys(items);
  const seen = new Set();
  const lines = [];
  let total = 0;
  for (const rawId of requested) {
    const id = text(rawId);
    if (!id || seen.has(id) || lines.length >= MAX_LINES) continue;
    seen.add(id);
    const item = items[id];
    if (!item || typeof item !== 'object') continue;
    const unit = Math.max(0, Math.floor(finite(mode === 'sell' ? item.sell : item.buy, 0)));
    const owned = Math.max(0, Math.floor(finite(inventory[id], 0)));
    const quantity = mode === 'sell' ? Math.min(owned, Math.max(1, Math.floor(finite(options.quantities?.[id], 1)))) : Math.max(1, Math.floor(finite(options.quantities?.[id], 1)));
    const lineTotal = unit * quantity;
    const affordable = mode === 'sell' ? owned >= quantity : copper >= total + lineTotal;
    lines.push({ id, label: text(item.label, id), mode, unitPrice: unit, quantity, lineTotal, owned, affordable, tags: Array.isArray(item.tags) ? item.tags.slice(0, 6).map(text).filter(Boolean) : [] });
    if (affordable) total += lineTotal;
  }
  const accepted = lines.filter(line => line.affordable);
  const rejected = lines.filter(line => !line.affordable);
  const payable = mode === 'buy' ? Math.min(copper, total) : total;
  return freeze({ version: SETTLEMENT_TRADE_QUOTE_VERSION, mode, copper, lineCount: lines.length, acceptedCount: accepted.length, rejectedCount: rejected.length, total: payable, remainingCopper: mode === 'buy' ? Math.max(0, copper - payable) : copper + payable, lines, summary: `${accepted.length}/${lines.length} kalem uygun`, stableKey: `${mode}:${lines.map(line => `${line.id}:${line.quantity}:${line.unitPrice}:${line.affordable ? 1 : 0}`).join('|')}` });
}

export function serializeSettlementTradeQuote(quote) {
  return JSON.stringify(quote && typeof quote === 'object' ? quote : {});
}
