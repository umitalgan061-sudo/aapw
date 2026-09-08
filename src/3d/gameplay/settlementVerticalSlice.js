/**
 * Deterministic settlement interaction rail.
 *
 * This is an orchestration adapter over existing settlement/gameplay owners.
 * It owns no inventory, copper, quest storage, scene objects, terrain, NPCs,
 * dialogue UI or persistence backend. Callers inject the authoritative handlers.
 *
 * Runtime path:
 * settlement -> interior/door -> npc/vendor/crafting/quest -> travel/save
 */

export const SETTLEMENT_SLICE_VERSION = 1;

export const SETTLEMENT_LIMITS = Object.freeze({
  nodes: 24,
  actionsPerNode: 12,
  visibleActions: 8,
  history: 32,
  text: 160,
  id: 96,
});

const ACTIONS = Object.freeze([
  'enter',
  'exit',
  'interact',
  'talk',
  'trade',
  'craft',
  'acceptQuest',
  'advanceQuest',
  'travel',
  'save',
  'back',
]);

const NODE_KINDS = Object.freeze([
  'settlement',
  'interior',
  'door',
  'npc',
  'vendor',
  'crafting',
  'quest',
  'travel',
  'save',
]);

const ACTION_LABELS = Object.freeze({
  enter: 'İçeri gir',
  exit: 'Dışarı çık',
  interact: 'Etkileş',
  talk: 'Konuş',
  trade: 'Takas',
  craft: 'Üret',
  acceptQuest: 'Görevi kabul et',
  advanceQuest: 'Görevi ilerlet',
  travel: 'Yola çık',
  save: 'Oyunu kaydet',
  back: 'Geri dön',
});

const NODE_LABELS = Object.freeze({
  settlement: 'Yerleşim',
  interior: 'İç mekân',
  door: 'Kapı',
  npc: 'Karakter',
  vendor: 'Satıcı',
  crafting: 'Üretim',
  quest: 'Görev',
  travel: 'Seyahat',
  save: 'Kayıt',
});

const CAPABILITY_FOR_ACTION = Object.freeze({
  enter: ['settlement', 'door'],
  exit: ['settlement', 'door'],
  interact: ['dialogue'],
  talk: ['dialogue'],
  trade: ['trade'],
  craft: ['crafting'],
  acceptQuest: ['quest'],
  advanceQuest: ['quest'],
  travel: ['travel'],
  save: ['persistence'],
});

const HANDLER_FOR_ACTION = Object.freeze({
  enter: 'enterSettlement',
  exit: 'exitSettlement',
  interact: 'interact',
  talk: 'talk',
  trade: 'trade',
  craft: 'craft',
  acceptQuest: 'acceptQuest',
  advanceQuest: 'advanceQuest',
  travel: 'travel',
  save: 'save',
});

function id(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, SETTLEMENT_LIMITS.id) : fallback;
}

function text(value, fallback = '') {
  const valueText = String(value ?? '').trim();
  return valueText ? valueText.slice(0, SETTLEMENT_LIMITS.text) : fallback;
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function integer(value, min, max, fallback) {
  const numeric = finite(value, fallback);
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function boolMap(value) {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, raw] of Object.entries(value)) {
    const normalized = id(key);
    if (normalized) result[normalized] = Boolean(raw);
  }
  return result;
}

function amountMap(value) {
  const result = {};
  const entries = value instanceof Map
    ? [...value.entries()]
    : value && typeof value === 'object' ? Object.entries(value) : [];
  for (const [key, raw] of entries) {
    const normalized = id(key);
    if (!normalized) continue;
    const amount = integer(raw, 0, 9999, 0);
    if (amount > 0) result[normalized] = amount;
  }
  return result;
}

function reputationMap(value) {
  const result = {};
  const entries = value instanceof Map
    ? [...value.entries()]
    : value && typeof value === 'object' ? Object.entries(value) : [];
  for (const [key, raw] of entries) {
    const normalized = id(key);
    if (normalized) result[normalized] = Math.min(9999, Math.max(-9999, finite(raw, 0)));
  }
  return result;
}

function questMap(value) {
  const result = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, raw] of Object.entries(value)) {
    const questId = id(key);
    if (!questId) continue;
    const record = raw && typeof raw === 'object' ? raw : {};
    result[questId] = {
      state: id(record.state, 'unknown'),
      step: integer(record.step, 0, 999, 0),
      completed: Boolean(record.completed),
      rewardClaimed: Boolean(record.rewardClaimed),
    };
  }
  return result;
}

function capabilities(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries([
    'settlement',
    'door',
    'dialogue',
    'trade',
    'crafting',
    'quest',
    'travel',
    'persistence',
  ].map((key) => [key, source[key] !== false]));
}

function normalizeContext(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    flags: boolMap(source.flags),
    items: amountMap(source.items),
    reputation: reputationMap(source.reputation),
    questProgress: questMap(source.questProgress),
    capabilities: capabilities(source.capabilities),
    distance: Math.max(0, finite(source.distance, 0)),
    locationId: id(source.locationId),
    settlementId: id(source.settlementId),
  };
}

function normalizeGate(value) {
  if (!value || typeof value !== 'object') return null;
  const type = id(value.type);
  if (type === 'flag') {
    const key = id(value.key);
    return key ? Object.freeze({ type, key, expected: value.expected !== false, reason: text(value.reason, 'flag-required') }) : null;
  }
  if (type === 'item') {
    const itemId = id(value.itemId);
    return itemId ? Object.freeze({ type, itemId, quantity: integer(value.quantity, 1, 9999, 1), reason: text(value.reason, 'item-required') }) : null;
  }
  if (type === 'reputation') {
    const factionId = id(value.factionId);
    return factionId ? Object.freeze({ type, factionId, minimum: integer(value.minimum, -9999, 9999, 0), reason: text(value.reason, 'reputation-too-low') }) : null;
  }
  if (type === 'quest') {
    const questId = id(value.questId);
    if (!questId) return null;
    const states = Array.isArray(value.states) ? value.states.map((state) => id(state)).filter(Boolean).slice(0, 8) : ['completed'];
    return Object.freeze({ type, questId, states: Object.freeze(states.length ? states : ['completed']), reason: text(value.reason, 'quest-required') });
  }
  if (type === 'capability') {
    const capability = id(value.capability);
    return capability ? Object.freeze({ type, capability, reason: text(value.reason, 'capability-unavailable') }) : null;
  }
  if (type === 'proximity') {
    return Object.freeze({ type, distance: Math.max(0, finite(value.distance, 4)), reason: text(value.reason, 'too-far') });
  }
  return null;
}

export function evaluateSettlementGate(rawGate, rawContext = {}) {
  const gate = normalizeGate(rawGate);
  const context = normalizeContext(rawContext);
  if (!gate) return { ok: false, reason: 'invalid-gate' };
  switch (gate.type) {
    case 'flag':
      return Boolean(context.flags[gate.key]) === gate.expected ? { ok: true, reason: '' } : { ok: false, reason: gate.reason };
    case 'item':
      return (context.items[gate.itemId] || 0) >= gate.quantity ? { ok: true, reason: '' } : { ok: false, reason: gate.reason };
    case 'reputation':
      return (context.reputation[gate.factionId] ?? -9999) >= gate.minimum ? { ok: true, reason: '' } : { ok: false, reason: gate.reason };
    case 'quest': {
      const progress = context.questProgress[gate.questId];
      const stateMatches = progress && gate.states.includes(progress.state);
      const completedMatches = gate.states.includes('completed') && progress?.completed === true;
      return stateMatches || completedMatches ? { ok: true, reason: '' } : { ok: false, reason: gate.reason };
    }
    case 'capability':
      return context.capabilities[gate.capability] ? { ok: true, reason: '' } : { ok: false, reason: gate.reason };
    case 'proximity':
      return context.distance <= gate.distance ? { ok: true, reason: '' } : { ok: false, reason: gate.reason };
    default:
      return { ok: false, reason: 'unsupported-gate' };
  }
}

export function evaluateSettlementGates(rawGates, rawContext = {}) {
  const failures = [];
  const gates = Array.isArray(rawGates) ? rawGates.slice(0, 8) : [];
  for (const gate of gates) {
    const result = evaluateSettlementGate(gate, rawContext);
    if (!result.ok) failures.push(result.reason);
  }
  return Object.freeze({ ok: failures.length === 0, reasons: Object.freeze(failures) });
}

function normalizeNode(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const nodeId = id(source.id, `node-${index + 1}`);
  const kind = NODE_KINDS.includes(source.kind) ? source.kind : 'interior';
  const actions = Array.isArray(source.actions)
    ? [...new Set(source.actions.filter((action) => ACTIONS.includes(action)))].slice(0, SETTLEMENT_LIMITS.actionsPerNode)
    : [];
  const gates = Array.isArray(source.gates) ? source.gates.map(normalizeGate).filter(Boolean).slice(0, 8) : [];
  const metadata = {};
  if (source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)) {
    for (const [key, value] of Object.entries(source.metadata).slice(0, 16)) {
      const normalizedKey = id(key);
      if (!normalizedKey) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') metadata[normalizedKey] = value;
    }
  }
  return Object.freeze({
    id: nodeId,
    kind,
    label: text(source.label, nodeId),
    actions: Object.freeze(actions),
    gates: Object.freeze(gates),
    metadata: Object.freeze(metadata),
  });
}

function normalizeDefinition(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const nodes = (Array.isArray(source.nodes) ? source.nodes : [])
    .slice(0, SETTLEMENT_LIMITS.nodes)
    .map(normalizeNode);
  const unique = [];
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    unique.push(node);
  }
  unique.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const defaultEntry = unique[0]?.id || '';
  return Object.freeze({
    id: id(source.id, 'settlement-vertical-slice'),
    settlementId: id(source.settlementId, 'settlement'),
    label: text(source.label, 'Settlement'),
    entryNodeId: id(source.entryNodeId, defaultEntry),
    nodes: Object.freeze(unique),
    limits: Object.freeze({
      visibleActions: integer(source.limits?.maxVisibleActions, 1, SETTLEMENT_LIMITS.visibleActions, SETTLEMENT_LIMITS.visibleActions),
      history: integer(source.limits?.maxHistory, 1, SETTLEMENT_LIMITS.history, SETTLEMENT_LIMITS.history),
    }),
  });
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hash(value) {
  let result = 2166136261;
  const stringValue = String(value);
  for (let index = 0; index < stringValue.length; index += 1) {
    result ^= stringValue.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, '0');
}

function handlerResult(handler, payload) {
  if (typeof handler !== 'function') return { ok: false, reason: 'handler-unavailable' };
  try {
    const result = handler(payload);
    if (!result || typeof result !== 'object') return { ok: false, reason: 'action-rejected' };
    return {
      ok: result.ok === true,
      reason: id(result.reason, result.ok === true ? '' : 'action-rejected'),
      message: text(result.message),
      nodeId: id(result.nodeId),
    };
  } catch {
    return { ok: false, reason: 'handler-threw' };
  }
}

function actionAvailable(action, context, handlers) {
  const requirements = CAPABILITY_FOR_ACTION[action] || [];
  if (requirements.some((capability) => !context.capabilities[capability])) return false;
  const handlerName = HANDLER_FOR_ACTION[action];
  return action === 'back' || typeof handlers[handlerName] === 'function';
}

function event(sequence, action, nodeId, result, message) {
  return Object.freeze({
    sequence,
    action: id(action, 'unknown'),
    nodeId: id(nodeId),
    result: id(result, 'unknown'),
    message: text(message),
  });
}

export function createSettlementVerticalSlice(input = {}) {
  const definition = normalizeDefinition(input.definition || input);
  const handlers = input.handlers && typeof input.handlers === 'object' ? input.handlers : {};
  const state = {
    nodeId: definition.entryNodeId,
    visited: new Set(definition.entryNodeId ? [definition.entryNodeId] : []),
    history: [],
  };

  const findNode = (nodeId) => definition.nodes.find((node) => node.id === id(nodeId)) || null;
  const currentNode = () => findNode(state.nodeId);
  const normalizedContext = (context) => {
    const value = normalizeContext(context);
    if (!value.settlementId) value.settlementId = definition.settlementId;
    return value;
  };

  const availableActions = (context = {}) => {
    const normalized = normalizedContext(context);
    const node = currentNode();
    if (!node) return [];
    if (!evaluateSettlementGates(node.gates, normalized).ok) return [];
    return node.actions
      .filter((action) => actionAvailable(action, normalized, handlers))
      .slice(0, definition.limits.visibleActions);
  };

  const snapshot = (context = {}) => {
    const normalized = normalizedContext(context);
    const node = currentNode();
    const body = {
      version: SETTLEMENT_SLICE_VERSION,
      sliceId: definition.id,
      settlementId: definition.settlementId,
      nodeId: node?.id || '',
      nodeKind: node?.kind || '',
      nodeLabel: node?.label || '',
      actions: availableActions(normalized),
      visited: [...state.visited].sort(),
      historyLength: state.history.length,
      contextFingerprint: hash(stableStringify(normalized)),
    };
    return Object.freeze({ ...body, fingerprint: hash(stableStringify(body)) });
  };

  const record = (action, result, message) => {
    const sequence = state.history.length ? state.history[state.history.length - 1].sequence + 1 : 1;
    state.history.push(event(sequence, action, state.nodeId, result, message));
    if (state.history.length > definition.limits.history) state.history.splice(0, state.history.length - definition.limits.history);
  };

  const setNode = (nodeId, context = {}) => {
    const node = findNode(nodeId);
    if (!node) return { ok: false, reason: 'node-not-found' };
    const gate = evaluateSettlementGates(node.gates, normalizedContext(context));
    if (!gate.ok) return { ok: false, reason: gate.reasons[0] || 'node-gated' };
    state.nodeId = node.id;
    state.visited.add(node.id);
    return { ok: true, nodeId: node.id, snapshot: snapshot(context) };
  };

  const transitionTo = (kind, nodeId, context = {}) => {
    const target = definition.nodes.find((node) => node.kind === kind && node.id === id(nodeId));
    return target ? setNode(target.id, context) : { ok: false, reason: 'transition-target-not-found' };
  };

  const execute = (action, payload = {}, context = {}) => {
    const normalized = normalizedContext(context);
    const current = currentNode();
    if (!ACTIONS.includes(action)) {
      record(action, 'unsupported-action', 'Desteklenmeyen işlem.');
      return { ok: false, reason: 'unsupported-action' };
    }
    if (action === 'back') {
      const previous = state.history.length > 1 ? state.history[state.history.length - 2]?.nodeId : definition.entryNodeId;
      const target = findNode(previous) || findNode(definition.entryNodeId);
      if (target) {
        state.nodeId = target.id;
        state.visited.add(target.id);
      }
      record(action, 'ok', 'Önceki adıma dönüldü.');
      return { ok: true, reason: '', nodeId: state.nodeId, action, snapshot: snapshot(normalized) };
    }
    if (!current) {
      record(action, 'action-unavailable', 'Aktif settlement adımı bulunamadı.');
      return { ok: false, reason: 'action-unavailable' };
    }
    const gate = evaluateSettlementGates(current.gates, normalized);
    if (!gate.ok) {
      record(action, gate.reasons[0] || 'node-gated', 'Aktif adım kilitli.');
      return { ok: false, reason: gate.reasons[0] || 'node-gated', nodeId: current.id, action };
    }
    if (!availableActions(normalized).includes(action)) {
      record(action, 'action-unavailable', 'İşlem şu anda kullanılamıyor.');
      return { ok: false, reason: 'action-unavailable', nodeId: current.id, action };
    }
    const handlerName = HANDLER_FOR_ACTION[action];
    const handlerPayload = {
      ...(payload && typeof payload === 'object' ? payload : {}),
      settlementId: definition.settlementId,
      nodeId: current.id,
      context: normalized,
    };
    const result = handlerResult(handlers[handlerName], handlerPayload);
    record(action, result.ok ? 'ok' : result.reason, result.message);
    return Object.freeze({
      ...result,
      nodeId: result.nodeId || current.id,
      action,
      snapshot: snapshot(normalized),
    });
  };

  const exportSnapshot = (context = {}) => Object.freeze({
    version: SETTLEMENT_SLICE_VERSION,
    sliceId: definition.id,
    settlementId: definition.settlementId,
    currentNodeId: state.nodeId,
    visited: [...state.visited].sort(),
    history: state.history.slice(-definition.limits.history),
    fingerprint: snapshot(context).fingerprint,
  });

  const importSnapshot = (saved, context = {}) => {
    const normalized = saved && typeof saved === 'object' ? saved : {};
    if (normalized.version !== SETTLEMENT_SLICE_VERSION) return { ok: false, reason: 'unsupported-snapshot-version' };
    if (id(normalized.sliceId) !== definition.id) return { ok: false, reason: 'snapshot-slice-mismatch' };
    const target = findNode(normalized.currentNodeId);
    if (!target) {
      state.nodeId = definition.entryNodeId;
      state.visited = new Set(definition.entryNodeId ? [definition.entryNodeId] : []);
      state.history = [];
      return { ok: false, reason: 'snapshot-node-mismatch', recovered: true, snapshot: snapshot(context) };
    }
    const gate = evaluateSettlementGates(target.gates, normalizedContext(context));
    if (!gate.ok) {
      state.nodeId = definition.entryNodeId;
      state.visited = new Set(definition.entryNodeId ? [definition.entryNodeId] : []);
      state.history = [];
      return { ok: false, reason: 'snapshot-node-gated', recovered: true, snapshot: snapshot(context) };
    }
    state.nodeId = target.id;
    state.visited = new Set(Array.isArray(normalized.visited) ? normalized.visited.map(id).filter(Boolean) : []);
    state.visited.add(target.id);
    state.history = Array.isArray(normalized.history) ? normalized.history.slice(-definition.limits.history).map((entry, index) => event(
      integer(entry?.sequence, 0, 999999999, index + 1),
      entry?.action,
      entry?.nodeId,
      entry?.result,
      entry?.message,
    )) : [];
    return { ok: true, snapshot: snapshot(context) };
  };

  const reset = (context = {}) => {
    state.nodeId = definition.entryNodeId;
    state.visited = new Set(definition.entryNodeId ? [definition.entryNodeId] : []);
    state.history = [];
    return { ok: true, snapshot: snapshot(context) };
  };

  return Object.freeze({
    version: SETTLEMENT_SLICE_VERSION,
    definition,
    findNode,
    currentNode,
    availableActions,
    setNode,
    transitionTo,
    execute,
    snapshot,
    exportSnapshot,
    importSnapshot,
    reset,
  });
}

export function settlementActionLabel(action) {
  const key = id(action);
  return ACTION_LABELS[key] || key;
}

export function settlementNodeKindLabel(kind) {
  const key = id(kind);
  return NODE_LABELS[key] || key;
}

export function describeSettlementAction(action, metadata = {}) {
  const normalized = id(action);
  const kind = normalized === 'trade' ? 'trade'
    : normalized === 'craft' ? 'crafting'
      : normalized === 'talk' || normalized === 'interact' ? 'dialogue'
        : normalized === 'acceptQuest' || normalized === 'advanceQuest' ? 'quest'
          : normalized === 'travel' ? 'travel'
            : normalized === 'save' ? 'persistence'
              : normalized === 'enter' || normalized === 'exit' ? 'movement' : 'navigation';
  return Object.freeze({ action: normalized, label: settlementActionLabel(normalized), kind, targetId: id(metadata.targetId) });
}

export function buildSettlementInteractionRail(slice, context = {}) {
  if (!slice || typeof slice.snapshot !== 'function') {
    return Object.freeze({ ok: false, reason: 'slice-unavailable', node: null, actions: Object.freeze([]) });
  }
  try {
    const snap = slice.snapshot(context);
    const actions = snap.actions.map((action, index) => Object.freeze({
      index,
      action,
      label: settlementActionLabel(action),
      enabled: true,
    }));
    return Object.freeze({
      ok: true,
      reason: '',
      node: Object.freeze({ id: snap.nodeId, kind: snap.nodeKind, kindLabel: settlementNodeKindLabel(snap.nodeKind), label: snap.nodeLabel }),
      actions: Object.freeze(actions),
      visited: Object.freeze(snap.visited.slice()),
      fingerprint: hash(stableStringify({ node: snap.nodeId, actions: actions.map((item) => item.action), context: snap.contextFingerprint })),
    });
  } catch {
    return Object.freeze({ ok: false, reason: 'snapshot-failed', node: null, actions: Object.freeze([]) });
  }
}

export function validateSettlementSliceDefinition(definition = {}) {
  const normalized = normalizeDefinition(definition);
  const errors = [];
  if (!normalized.settlementId) errors.push('missing-settlement-id');
  if (!normalized.nodes.length) errors.push('missing-nodes');
  if (!normalized.nodes.some((node) => node.id === normalized.entryNodeId)) errors.push('missing-entry-node');
  const ids = new Set();
  for (const node of normalized.nodes) {
    if (ids.has(node.id)) errors.push(`duplicate-node:${node.id}`);
    ids.add(node.id);
    for (const action of node.actions) if (!ACTIONS.includes(action)) errors.push(`unsupported-action:${action}`);
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), nodeCount: normalized.nodes.length, actionCount: normalized.nodes.reduce((sum, node) => sum + node.actions.length, 0) });
}

export function summarizeSettlementSlice(definition = {}) {
  const normalized = normalizeDefinition(definition);
  const kinds = {};
  let actionCount = 0;
  let gateCount = 0;
  for (const node of normalized.nodes) {
    kinds[node.kind] = (kinds[node.kind] || 0) + 1;
    actionCount += node.actions.length;
    gateCount += node.gates.length;
  }
  return Object.freeze({
    sliceId: normalized.id,
    settlementId: normalized.settlementId,
    entryNodeId: normalized.entryNodeId,
    nodeCount: normalized.nodes.length,
    actionCount,
    gateCount,
    kinds: Object.freeze(kinds),
    fingerprint: hash(stableStringify(normalized)),
  });
}

export function normalizeSettlementContext(context = {}) {
  return Object.freeze(normalizeContext(context));
}

export function fingerprintSettlementContext(context = {}) {
  return hash(stableStringify(normalizeContext(context)));
}
