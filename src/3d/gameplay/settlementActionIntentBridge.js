/**
 * Settlement action intent bridge.
 *
 * Converts player-facing settlement actions into the existing runtime's
 * caller-owned handler contract without owning or mutating gameplay state.
 */

export const SETTLEMENT_ACTION_INTENT_VERSION = 1;

const ACTIONS = Object.freeze({
  enter: Object.freeze({ handler: 'enterSettlement', nodeKind: 'settlement', capability: 'door' }),
  exit: Object.freeze({ handler: 'exitSettlement', nodeKind: 'settlement', capability: 'door' }),
  rest: Object.freeze({ handler: 'rest', nodeKind: 'tavern', capability: 'rest' }),
  trade: Object.freeze({ handler: 'trade', nodeKind: 'market', capability: 'trade' }),
  smith: Object.freeze({ handler: 'craft', nodeKind: 'blacksmith', capability: 'craft' }),
  travel: Object.freeze({ handler: 'travel', nodeKind: 'gate', capability: 'travel' }),
  quest: Object.freeze({ handler: 'inspectQuest', nodeKind: 'quest', capability: 'quest' }),
  save: Object.freeze({ handler: 'save', nodeKind: 'settlement', capability: 'save' }),
});

const freeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};

const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

function normalizeCapabilityMap(capabilities) {
  if (!capabilities || typeof capabilities !== 'object') return Object.freeze({});
  return Object.freeze(Object.fromEntries(Object.entries(capabilities).map(([key, value]) => [String(key), value === true])));
}

function normalizeIntent(raw, index) {
  const actionId = text(raw?.actionId ?? raw?.action ?? raw?.type).toLowerCase();
  const action = ACTIONS[actionId];
  if (!action) return { index, actionId, status: 'rejected', reason: 'unknown-action' };
  const nodeKind = text(raw?.nodeKind, action.nodeKind).toLowerCase();
  const nodeId = text(raw?.nodeId, nodeKind || 'settlement');
  const capabilities = normalizeCapabilityMap(raw?.capabilities);
  const capabilityGranted = capabilities[action.capability] !== false;
  const enabled = raw?.enabled !== false;
  let status = 'ready';
  let reason = '';
  if (!enabled) { status = 'blocked'; reason = 'disabled'; }
  else if (nodeKind !== action.nodeKind) { status = 'blocked'; reason = 'node-kind-mismatch'; }
  else if (!capabilityGranted) { status = 'blocked'; reason = `missing-${action.capability}`; }
  return {
    index,
    actionId,
    handler: action.handler,
    nodeId,
    nodeKind,
    capability: action.capability,
    status,
    reason,
    label: text(raw?.label, actionId || 'action'),
    priority: Math.max(-100, Math.min(100, Math.round(finite(raw?.priority, 0)))),
    requestId: text(raw?.requestId, `${nodeId}:${actionId}:${index}`),
  };
}

export function createSettlementActionIntentBridge(rawIntents = [], options = {}) {
  const intents = Array.isArray(rawIntents) ? rawIntents : [];
  const maxIntents = Math.max(1, Math.min(24, Math.floor(finite(options.maxIntents, 12))));
  const normalized = intents.slice(0, maxIntents).map(normalizeIntent);
  const ready = normalized.filter((item) => item.status === 'ready').sort((a, b) => b.priority - a.priority || a.index - b.index);
  const blocked = normalized.filter((item) => item.status !== 'ready');
  const accepted = ready.map((item, sequence) => ({ ...item, sequence }));
  const digest = accepted.map((item) => `${item.sequence}|${item.handler}|${item.nodeId}|${item.requestId}`).join(';');
  return freeze({
    version: SETTLEMENT_ACTION_INTENT_VERSION,
    accepted,
    blocked,
    summary: {
      received: intents.length,
      inspected: normalized.length,
      accepted: accepted.length,
      blocked: blocked.length,
      hasActionable: accepted.length > 0,
      next: accepted[0]?.actionId ?? null,
    },
    digest,
  });
}

export function serializeSettlementActionIntentBridge(bridge) {
  return JSON.stringify(bridge ?? createSettlementActionIntentBridge());
}
