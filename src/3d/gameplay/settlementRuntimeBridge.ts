export const SETTLEMENT_RUNTIME_BRIDGE_VERSION = 1;

export function createSettlementRuntimeBridge({ slice, eventTarget = null, context = {} } = {}) {
  if (!slice || typeof slice.execute !== 'function' || typeof slice.snapshot !== 'function') {
    throw new TypeError('Settlement runtime bridge requires a settlement slice.');
  }
  let currentContext = { ...context };
  let sequence = 0;
  const snapshot = () => Object.freeze({
    version: SETTLEMENT_RUNTIME_BRIDGE_VERSION,
    sequence,
    settlementId: String(slice.snapshot(currentContext)?.settlementId || ''),
    nodeId: String(slice.snapshot(currentContext)?.nodeId || ''),
    nodeKind: String(slice.snapshot(currentContext)?.nodeKind || ''),
    actions: [...(slice.snapshot(currentContext)?.actions || [])],
    visited: [...(slice.snapshot(currentContext)?.visited || [])],
  });
  const publish = (type, detail) => {
    if (eventTarget && typeof eventTarget.dispatchEvent === 'function') {
      eventTarget.dispatchEvent({ type, detail });
    }
  };
  const dispatch = (action, payload = {}, nextContext = currentContext) => {
    sequence += 1;
    currentContext = { ...nextContext };
    let result;
    try { result = slice.execute(String(action), { ...payload }, currentContext); }
    catch { result = { ok: false, reason: 'bridge-execution-failed' }; }
    const detail = Object.freeze({
      version: SETTLEMENT_RUNTIME_BRIDGE_VERSION,
      sequence,
      action: String(action),
      ok: result?.ok === true,
      reason: String(result?.reason || ''),
      nodeId: String(result?.nodeId || snapshot().nodeId),
      snapshot: snapshot(),
    });
    publish('aapw:settlement-runtime-action-result', detail);
    return detail;
  };
  return Object.freeze({ snapshot, dispatch, getContext: () => ({ ...currentContext }) });
}

export function isSettlementRuntimeActionResult(value) {
  return Boolean(
    value &&
    value.version === SETTLEMENT_RUNTIME_BRIDGE_VERSION &&
    Number.isInteger(value.sequence) &&
    typeof value.action === 'string' &&
    typeof value.ok === 'boolean' &&
    value.snapshot &&
    Object.isFrozen(value),
  );
}
