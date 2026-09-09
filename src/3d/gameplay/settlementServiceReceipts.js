/**
 * Deterministic, read-only receipt projection for existing settlement service handlers.
 * The caller remains authoritative for execution and persistence; this module only prepares
 * compact UX/audit receipts for gate, market, tavern, blacksmith, farm, barracks, stable and house.
 */

export const SETTLEMENT_SERVICE_RECEIPTS_VERSION = 1;

const SERVICE_ROLES = Object.freeze([
  'gate',
  'market',
  'tavern',
  'blacksmith',
  'farm',
  'barracks',
  'stable',
  'house',
]);

const DEFAULT_ACTIONS = Object.freeze({
  gate: Object.freeze(['enter', 'exit']),
  market: Object.freeze(['trade', 'buy', 'sell']),
  tavern: Object.freeze(['talk', 'rest', 'acceptQuest']),
  blacksmith: Object.freeze(['craft', 'trade']),
  farm: Object.freeze(['interact', 'trade']),
  barracks: Object.freeze(['talk', 'interact']),
  stable: Object.freeze(['travel']),
  house: Object.freeze(['interact', 'save']),
});

function clean(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 96) : fallback;
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function hash(value) {
  const source = stable(value);
  let result = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function normalizeRole(value) {
  const role = clean(value);
  return SERVICE_ROLES.includes(role) ? role : '';
}

function normalizeStatus(value) {
  const status = clean(value, 'blocked');
  return ['completed', 'executed', 'blocked', 'skipped'].includes(status) ? status : 'blocked';
}

function normalizeActions(role, actions) {
  const source = Array.isArray(actions) && actions.length ? actions : DEFAULT_ACTIONS[role] || [];
  return Object.freeze([...new Set(source.map((entry) => clean(entry)).filter(Boolean))].slice(0, 8));
}

export function listSettlementServiceReceiptRoles() {
  return Object.freeze(SERVICE_ROLES.slice());
}

export function buildSettlementServiceReceipt(input = {}) {
  const role = normalizeRole(input.role);
  if (!role) return null;
  const actions = normalizeActions(role, input.actions);
  const status = normalizeStatus(input.status);
  const copperDelta = Math.trunc(finite(input.copperDelta));
  const xpDelta = Math.trunc(finite(input.xpDelta));
  const itemIds = Object.freeze((Array.isArray(input.itemIds) ? input.itemIds : [])
    .map((item) => clean(item)).filter(Boolean).slice(0, 8));
  const questId = clean(input.questId);
  const receipt = {
    version: SETTLEMENT_SERVICE_RECEIPTS_VERSION,
    role,
    nodeId: clean(input.nodeId, `${role}-node`),
    action: clean(input.action, actions[0] || ''),
    status,
    reason: clean(input.reason),
    copperDelta,
    xpDelta,
    itemIds,
    questId,
    atSequence: Math.max(0, Math.trunc(finite(input.atSequence))),
    summary: clean(input.summary, `${role}: ${status}`),
  };
  receipt.fingerprint = hash(receipt);
  return Object.freeze(receipt);
}

export function buildSettlementServiceReceiptLedger(entries = [], options = {}) {
  const source = Array.isArray(entries) ? entries : [];
  const limit = Math.max(1, Math.min(32, Math.trunc(finite(options.limit, 16))));
  const receipts = source.map(buildSettlementServiceReceipt).filter(Boolean).slice(-limit);
  const ordered = receipts.slice().sort((left, right) => {
    if (left.atSequence !== right.atSequence) return left.atSequence - right.atSequence;
    if (left.role !== right.role) return left.role.localeCompare(right.role);
    return left.fingerprint.localeCompare(right.fingerprint);
  });
  const totals = ordered.reduce((result, receipt) => ({
    copperDelta: result.copperDelta + receipt.copperDelta,
    xpDelta: result.xpDelta + receipt.xpDelta,
    completed: result.completed + (receipt.status === 'completed' || receipt.status === 'executed' ? 1 : 0),
    blocked: result.blocked + (receipt.status === 'blocked' ? 1 : 0),
    itemCount: result.itemCount + receipt.itemIds.length,
  }), { copperDelta: 0, xpDelta: 0, completed: 0, blocked: 0, itemCount: 0 });
  const deduped = ordered.filter((receipt, index, list) => index === 0 || receipt.fingerprint !== list[index - 1].fingerprint);
  const ledger = {
    version: SETTLEMENT_SERVICE_RECEIPTS_VERSION,
    settlementId: clean(options.settlementId, 'settlement'),
    receipts: Object.freeze(deduped),
    receiptCount: deduped.length,
    latest: deduped[deduped.length - 1] || null,
    totals: Object.freeze(totals),
  };
  ledger.fingerprint = hash(ledger);
  return Object.freeze(ledger);
}

export function validateSettlementServiceReceiptLedger(ledger = {}) {
  const errors = [];
  if (ledger.version !== SETTLEMENT_SERVICE_RECEIPTS_VERSION) errors.push('unsupported-version');
  if (!clean(ledger.settlementId)) errors.push('missing-settlement-id');
  if (!Array.isArray(ledger.receipts)) errors.push('missing-receipts');
  for (const [index, receipt] of (ledger.receipts || []).entries()) {
    if (!normalizeRole(receipt?.role)) errors.push(`invalid-role:${index}`);
    if (!clean(receipt?.nodeId)) errors.push(`missing-node:${index}`);
    if (!['completed', 'executed', 'blocked', 'skipped'].includes(receipt?.status)) errors.push(`invalid-status:${index}`);
    if (!Number.isFinite(receipt?.copperDelta) || !Number.isFinite(receipt?.xpDelta)) errors.push(`invalid-reward:${index}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), receiptCount: Array.isArray(ledger.receipts) ? ledger.receipts.length : 0 });
}

export function serializeSettlementServiceReceiptLedger(ledger = {}) {
  return stable(ledger);
}
