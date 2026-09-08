/**
 * EventBus request/response bridge for the settlement vertical slice.
 *
 * Request events keep their stable public names; response events are deliberately distinct so a
 * listener can never recursively re-enter the same request handler. The bridge delegates all
 * authoritative gameplay work to the injected settlement slice and shared project EventBus.
 */

export const SETTLEMENT_SLICE_EVENT_VERSION = 1;

export const SETTLEMENT_SLICE_EVENTS = Object.freeze({
  OPEN: 'settlement:slice:open',
  OPENED: 'settlement:slice:opened',
  STATE: 'settlement:slice:state',
  ACTION: 'settlement:slice:action',
  RESULT: 'settlement:slice:result',
  NODE: 'settlement:slice:node',
  NODE_RESULT: 'settlement:slice:node-result',
  SAVE: 'settlement:slice:save',
  SAVE_RESULT: 'settlement:slice:save-result',
  RESTORE: 'settlement:slice:restore',
  RESTORE_RESULT: 'settlement:slice:restore-result',
  RESET: 'settlement:slice:reset',
  RESET_RESULT: 'settlement:slice:reset-result',
  CLOSE: 'settlement:slice:close',
  CLOSED: 'settlement:slice:closed',
});

const REQUEST_ACTIONS = new Set([
  'enter', 'exit', 'interact', 'talk', 'trade', 'craft',
  'acceptQuest', 'advanceQuest', 'travel', 'save', 'back',
]);

function id(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, 96) : fallback;
}

function scalarRecord(value, limit = 24) {
  if (!value || typeof value !== 'object') return {};
  if (Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value).slice(0, limit)) {
    const normalized = id(key);
    if (!normalized) continue;
    if (raw === null || typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') result[normalized] = raw;
  }
  return result;
}

function normalizeContext(value) {
  return scalarRecord(value, 24);
}

function normalizeActionRequest(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return Object.freeze({
    action: id(source.action),
    payload: scalarRecord(source.payload),
    context: normalizeContext(source.context),
    requestId: id(source.requestId),
    expectedNodeId: id(source.expectedNodeId),
  });
}

function normalizeNodeRequest(payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return Object.freeze({
    nodeId: id(source.nodeId),
    context: normalizeContext(source.context),
    requestId: id(source.requestId),
  });
}

function envelope(type, values = {}) {
  return Object.freeze({ version: SETTLEMENT_SLICE_EVENT_VERSION, type, ...scalarRecord(values, 32) });
}

function emit(bus, eventName, payload) {
  if (!bus || typeof bus.emit !== 'function') return false;
  try { bus.emit(eventName, payload); return true; } catch { return false; }
}

function on(bus, eventName, handler) {
  if (!bus || typeof bus.on !== 'function') return null;
  try { return bus.on(eventName, handler); } catch { return null; }
}

function safeContextProvider(getContext, payload) {
  if (payload?.context && typeof payload.context === 'object') return payload.context;
  if (typeof getContext !== 'function') return {};
  try { return getContext() || {}; } catch { return {}; }
}

export function createSettlementVerticalSliceEventBridge({ bus, slice, getContext } = {}) {
  const subscriptions = [];
  let closed = false;
  let sequence = 0;

  const emitState = (reason, payload = {}) => {
    if (closed || !slice || typeof slice.snapshot !== 'function') return null;
    try {
      const snapshot = slice.snapshot(safeContextProvider(getContext, payload));
      const result = envelope(SETTLEMENT_SLICE_EVENTS.STATE, {
        sequence: ++sequence,
        reason: id(reason, 'state'),
        sliceId: snapshot.sliceId,
        settlementId: snapshot.settlementId,
        nodeId: snapshot.nodeId,
        nodeKind: snapshot.nodeKind,
        actions: Array.isArray(snapshot.actions) ? snapshot.actions.join('|') : '',
        fingerprint: snapshot.fingerprint,
      });
      emit(bus, SETTLEMENT_SLICE_EVENTS.STATE, result);
      return result;
    } catch {
      return null;
    }
  };

  const emitActionResult = (request, result) => {
    const response = envelope(SETTLEMENT_SLICE_EVENTS.RESULT, {
      sequence: ++sequence,
      requestId: request.requestId,
      action: request.action,
      ok: result?.ok === true,
      reason: id(result?.reason),
      message: String(result?.message ?? '').slice(0, 160),
      nodeId: id(result?.nodeId),
      fingerprint: id(result?.snapshot?.fingerprint),
    });
    emit(bus, SETTLEMENT_SLICE_EVENTS.RESULT, response);
    return response;
  };

  const handleOpen = (payload) => {
    if (closed || !slice || typeof slice.snapshot !== 'function') return;
    const snapshot = slice.snapshot(safeContextProvider(getContext, payload));
    emit(bus, SETTLEMENT_SLICE_EVENTS.OPENED, envelope(SETTLEMENT_SLICE_EVENTS.OPENED, {
      sequence: ++sequence,
      requestId: id(payload?.requestId),
      settlementId: snapshot.settlementId,
      nodeId: snapshot.nodeId,
      fingerprint: snapshot.fingerprint,
    }));
    emitState('open', payload);
  };

  const handleAction = (payload) => {
    if (closed || !slice || typeof slice.execute !== 'function') return;
    const request = normalizeActionRequest(payload);
    if (!REQUEST_ACTIONS.has(request.action)) {
      emitActionResult(request, { ok: false, reason: 'unsupported-action' });
      return;
    }
    if (request.expectedNodeId && typeof slice.currentNode === 'function' && slice.currentNode()?.id !== request.expectedNodeId) {
      emitActionResult(request, { ok: false, reason: 'stale-node' });
      return;
    }
    const result = slice.execute(request.action, request.payload, request.context);
    emitActionResult(request, result);
    emitState(result?.ok === true ? 'action-success' : 'action-rejected', request);
  };

  const handleNode = (payload) => {
    if (closed || !slice || typeof slice.setNode !== 'function') return;
    const request = normalizeNodeRequest(payload);
    if (!request.nodeId) {
      emit(bus, SETTLEMENT_SLICE_EVENTS.NODE_RESULT, envelope(SETTLEMENT_SLICE_EVENTS.NODE_RESULT, {
        sequence: ++sequence,
        requestId: request.requestId,
        ok: false,
        reason: 'missing-node-id',
      }));
      return;
    }
    const result = slice.setNode(request.nodeId, request.context);
    emit(bus, SETTLEMENT_SLICE_EVENTS.NODE_RESULT, envelope(SETTLEMENT_SLICE_EVENTS.NODE_RESULT, {
      sequence: ++sequence,
      requestId: request.requestId,
      ok: result?.ok === true,
      reason: id(result?.reason),
      nodeId: id(result?.nodeId),
      fingerprint: id(result?.snapshot?.fingerprint),
    }));
    emitState(result?.ok === true ? 'node-transition' : 'node-rejected', request);
  };

  const handleSave = (payload) => {
    if (closed || !slice || typeof slice.exportSnapshot !== 'function') return;
    try {
      const snapshot = slice.exportSnapshot(safeContextProvider(getContext, payload));
      emit(bus, SETTLEMENT_SLICE_EVENTS.SAVE_RESULT, envelope(SETTLEMENT_SLICE_EVENTS.SAVE_RESULT, {
        sequence: ++sequence,
        requestId: id(payload?.requestId),
        ok: true,
        snapshotVersion: snapshot.version,
        settlementId: snapshot.settlementId,
        nodeId: snapshot.currentNodeId,
        historyLength: Array.isArray(snapshot.history) ? snapshot.history.length : 0,
        fingerprint: id(snapshot.fingerprint),
      }));
    } catch {
      emit(bus, SETTLEMENT_SLICE_EVENTS.SAVE_RESULT, envelope(SETTLEMENT_SLICE_EVENTS.SAVE_RESULT, {
        sequence: ++sequence,
        requestId: id(payload?.requestId),
        ok: false,
        reason: 'snapshot-export-failed',
      }));
    }
  };

  const handleRestore = (payload) => {
    if (closed || !slice || typeof slice.importSnapshot !== 'function') return;
    const result = slice.importSnapshot(payload?.snapshot, safeContextProvider(getContext, payload));
    emit(bus, SETTLEMENT_SLICE_EVENTS.RESTORE_RESULT, envelope(SETTLEMENT_SLICE_EVENTS.RESTORE_RESULT, {
      sequence: ++sequence,
      requestId: id(payload?.requestId),
      ok: result?.ok === true,
      recovered: result?.recovered === true,
      reason: id(result?.reason),
      nodeId: id(result?.snapshot?.nodeId),
      fingerprint: id(result?.snapshot?.fingerprint),
    }));
    emitState(result?.ok === true ? 'restore-success' : result?.recovered ? 'restore-recovered' : 'restore-rejected', payload);
  };

  const handleReset = (payload) => {
    if (closed || !slice || typeof slice.reset !== 'function') return;
    const result = slice.reset(safeContextProvider(getContext, payload));
    emit(bus, SETTLEMENT_SLICE_EVENTS.RESET_RESULT, envelope(SETTLEMENT_SLICE_EVENTS.RESET_RESULT, {
      sequence: ++sequence,
      requestId: id(payload?.requestId),
      ok: result?.ok === true,
      nodeId: id(result?.snapshot?.nodeId),
      fingerprint: id(result?.snapshot?.fingerprint),
    }));
    emitState('reset', payload);
  };

  const handleClose = (payload) => {
    if (closed) return;
    emit(bus, SETTLEMENT_SLICE_EVENTS.CLOSED, envelope(SETTLEMENT_SLICE_EVENTS.CLOSED, {
      sequence: ++sequence,
      requestId: id(payload?.requestId),
      reason: id(payload?.reason, 'closed'),
    }));
    close();
  };

  const requestHandlers = [
    [SETTLEMENT_SLICE_EVENTS.OPEN, handleOpen],
    [SETTLEMENT_SLICE_EVENTS.ACTION, handleAction],
    [SETTLEMENT_SLICE_EVENTS.NODE, handleNode],
    [SETTLEMENT_SLICE_EVENTS.SAVE, handleSave],
    [SETTLEMENT_SLICE_EVENTS.RESTORE, handleRestore],
    [SETTLEMENT_SLICE_EVENTS.RESET, handleReset],
    [SETTLEMENT_SLICE_EVENTS.CLOSE, handleClose],
  ];
  for (const [eventName, handler] of requestHandlers) {
    const unsubscribe = on(bus, eventName, handler);
    if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe);
  }

  function close() {
    if (closed) return { ok: true, alreadyClosed: true };
    closed = true;
    for (const unsubscribe of subscriptions.splice(0)) {
      try { unsubscribe(); } catch { /* shared bus owns cleanup */ }
    }
    return { ok: true, alreadyClosed: false };
  }

  return Object.freeze({ version: SETTLEMENT_SLICE_EVENT_VERSION, events: SETTLEMENT_SLICE_EVENTS, emitState, close, isClosed: () => closed });
}

export function settlementSliceEventActionIsSupported(action) {
  return REQUEST_ACTIONS.has(id(action));
}

export function normalizeSettlementSliceActionRequest(payload = {}) {
  return normalizeActionRequest(payload);
}

export function buildSettlementSliceStateEvent(snapshot, reason = 'state') {
  const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return envelope(SETTLEMENT_SLICE_EVENTS.STATE, {
    reason: id(reason, 'state'),
    sliceId: id(value.sliceId),
    settlementId: id(value.settlementId),
    nodeId: id(value.nodeId),
    nodeKind: id(value.nodeKind),
    actions: Array.isArray(value.actions) ? value.actions.join('|') : '',
    fingerprint: id(value.fingerprint),
  });
}

export function buildSettlementSliceActionEvent(action, result = {}, requestId = '') {
  return envelope(SETTLEMENT_SLICE_EVENTS.RESULT, {
    requestId: id(requestId),
    action: id(action),
    ok: result?.ok === true,
    reason: id(result?.reason),
    message: String(result?.message ?? '').slice(0, 160),
    nodeId: id(result?.nodeId),
    fingerprint: id(result?.snapshot?.fingerprint),
  });
}

export function validateSettlementSliceEventPayload(payload, type) {
  const normalizedType = id(type);
  const value = payload && typeof payload === 'object' ? payload : {};
  const errors = [];
  if (!normalizedType) errors.push('missing-type');
  if (normalizedType === SETTLEMENT_SLICE_EVENTS.ACTION) {
    const request = normalizeActionRequest(value);
    if (!request.action) errors.push('missing-action');
    else if (!REQUEST_ACTIONS.has(request.action)) errors.push('unsupported-action');
  }
  if (normalizedType === SETTLEMENT_SLICE_EVENTS.NODE && !id(value.nodeId)) errors.push('missing-node-id');
  if (normalizedType === SETTLEMENT_SLICE_EVENTS.RESTORE && (!value.snapshot || typeof value.snapshot !== 'object')) errors.push('missing-snapshot');
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function settlementSliceEventNames() {
  return Object.freeze(Object.values(SETTLEMENT_SLICE_EVENTS));
}
