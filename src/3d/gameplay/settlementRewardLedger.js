/**
 * Deterministic reward ledger projection for settlement quest/service UX.
 * Existing quest/economy owners remain authoritative; this module only reads
 * caller-provided reward receipts and returns a bounded, frozen summary.
 */

export const SETTLEMENT_REWARD_LEDGER_LIMITS = Object.freeze({
  entries: 48,
  id: 96,
  text: 160,
  tags: 8,
});

const REWARD_TYPES = Object.freeze(['copper', 'xp', 'item', 'reputation', 'flag']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_REWARD_LEDGER_LIMITS.text) : fallback;
}

function id(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_REWARD_LEDGER_LIMITS.id) : fallback;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, min, max, fallback) {
  return Math.min(max, Math.max(min, Math.trunc(finite(value, fallback))));
}

function tags(value) {
  return Object.freeze(Array.isArray(value)
    ? [...new Set(value.map((entry) => id(entry)).filter(Boolean))].slice(0, SETTLEMENT_REWARD_LEDGER_LIMITS.tags)
    : []);
}

function normalizeEntry(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const type = REWARD_TYPES.includes(source.type) ? source.type : 'xp';
  const amount = type === 'flag' ? 1 : integer(source.amount, type === 'reputation' ? -9999 : 0, 999999, 0);
  return Object.freeze({
    id: id(source.id, `reward-${index + 1}`),
    type,
    amount,
    itemId: type === 'item' ? id(source.itemId) : '',
    factionId: type === 'reputation' ? id(source.factionId) : '',
    flag: type === 'flag' ? id(source.flag) : '',
    sourceId: id(source.sourceId, 'settlement'),
    label: text(source.label, type),
    tags: tags(source.tags),
  });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function digest(value) {
  let hash = 2166136261;
  for (const character of stableStringify(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function createSettlementRewardLedger(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const entries = (Array.isArray(source.entries) ? source.entries : [])
    .slice(0, SETTLEMENT_REWARD_LEDGER_LIMITS.entries)
    .map(normalizeEntry)
    .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
  const totals = { copper: 0, xp: 0, reputation: {}, items: {}, flags: [] };
  for (const entry of entries) {
    if (entry.type === 'copper' || entry.type === 'xp') totals[entry.type] += entry.amount;
    if (entry.type === 'reputation' && entry.factionId) totals.reputation[entry.factionId] = (totals.reputation[entry.factionId] || 0) + entry.amount;
    if (entry.type === 'item' && entry.itemId) totals.items[entry.itemId] = (totals.items[entry.itemId] || 0) + Math.max(0, entry.amount);
    if (entry.type === 'flag' && entry.flag && !totals.flags.includes(entry.flag)) totals.flags.push(entry.flag);
  }
  const result = {
    version: 1,
    settlementId: id(source.settlementId, 'settlement'),
    claimable: source.claimable !== false,
    entries: Object.freeze(entries),
    totals: Object.freeze({
      copper: totals.copper,
      xp: totals.xp,
      reputation: Object.freeze(totals.reputation),
      items: Object.freeze(totals.items),
      flags: Object.freeze(totals.flags.sort()),
    }),
    summary: Object.freeze({
      entryCount: entries.length,
      itemCount: Object.keys(totals.items).length,
      flagCount: totals.flags.length,
      hasProgression: totals.xp > 0 || Object.keys(totals.reputation).length > 0,
    }),
  };
  return Object.freeze({ ...result, digest: digest(result) });
}

export function serializeSettlementRewardLedger(ledger) {
  return stableStringify(ledger && typeof ledger === 'object' ? ledger : createSettlementRewardLedger());
}
