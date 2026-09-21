/**
 * Deterministic settlement interaction rail.
 *
 * This is an orchestration adapter over existing settlement/gameplay owners.
 * It owns no inventory, copper, quest storage, scene objects, terrain, NPCs,
 * dialogue UI or persistence backend. Callers inject the authoritative handlers.
 *
 * Runtime path:
 * settlement -> interior/door -> npc/vendor/crafting/quest -> travel/save
 *
 * Input normalization and gate evaluation live in the sibling
 * settlementVerticalSliceNormalize.js (GOVERNANCE.md Altın Kural 7, 600-line cap).
 * Every symbol below is re-exported from this file so the public import path
 * (`./settlementVerticalSlice.js`) is unchanged for existing callers.
 */

import {
  SETTLEMENT_LIMITS,
  ACTIONS,
  CAPABILITY_FOR_ACTION,
  HANDLER_FOR_ACTION,
  id,
  text,
  integer,
  normalizeContext,
  normalizeDefinition,
  stableStringify,
  hash,
  evaluateSettlementGate,
  evaluateSettlementGates,
} from './settlementVerticalSliceNormalize.js';

export {
  SETTLEMENT_LIMITS,
  evaluateSettlementGate,
  evaluateSettlementGates,
};

export const SETTLEMENT_SLICE_VERSION = 1;

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
