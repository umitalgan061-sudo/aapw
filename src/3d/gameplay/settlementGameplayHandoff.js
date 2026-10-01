/**
 * Runtime handoff for the existing settlement vertical slice.
 *
 * This module composes the authoritative settlement interaction rail and
 * injected handlers into one bounded, deterministic playable journey. It owns
 * session lifecycle and receipts only; inventory, copper, quest storage,
 * dialogue, scene objects, terrain and persistence remain external owners.
 */

import {
  createSettlementVerticalSlice,
  evaluateSettlementGates,
} from './settlementVerticalSlice.js';

export const SETTLEMENT_HANDOFF_VERSION = 1;
export const SETTLEMENT_HANDOFF_LIMITS = Object.freeze({
  steps: 24,
  receipts: 24,
  id: 96,
  text: 160,
});

function id(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_HANDOFF_LIMITS.id) : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, SETTLEMENT_HANDOFF_LIMITS.text) : fallback;
}

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function boundedSteps(value) {
  return Array.isArray(value)
    ? value.slice(0, SETTLEMENT_HANDOFF_LIMITS.steps)
    : [];
}

function normalizeStep(raw, index) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const action = id(source.action, 'interact');
  const nodeId = id(source.nodeId, `step-${index + 1}`);
  const gates = Array.isArray(source.gates) ? source.gates.slice(0, 8) : [];
  return Object.freeze({
    action,
    nodeId,
    gates: Object.freeze(gates),
    label: text(source.label, action),
  });
}

function normalizePlan(rawPlan = {}) {
  const source = rawPlan && typeof rawPlan === 'object' ? rawPlan : {};
  return Object.freeze({
    settlementId: id(source.settlementId, 'settlement'),
    steps: Object.freeze(boundedSteps(source.steps).map(normalizeStep)),
  });
}

function safeInvoke(handler, payload) {
  if (typeof handler !== 'function') return { ok: false, reason: 'handler-unavailable' };
  try {
    const result = handler(payload);
    if (result && typeof result.then === 'function') {
      return { ok: false, reason: 'async-handler-not-supported' };
    }
    if (result === false) return { ok: false, reason: 'handler-rejected' };
    if (result && typeof result === 'object' && result.ok === false) {
      return { ok: false, reason: text(result.reason, 'handler-rejected'), data: result };
    }
    return { ok: true, reason: '', data: result ?? null };
  } catch {
    return { ok: false, reason: 'handler-threw' };
  }
}

export function createSettlementGameplayHandoff(input = {}) {
  const plan = normalizePlan(input.plan || input);
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const handlers = input.handlers && typeof input.handlers === 'object' ? input.handlers : {};
  const slice = input.slice || createSettlementVerticalSlice({
    definition: input.definition || {},
    handlers,
  });

  let closed = false;
  let sequence = 0;
  const receipts = [];

  function record(event) {
    const receipt = Object.freeze({
      sequence: ++sequence,
      type: id(event?.type, 'step'),
      nodeId: id(event?.nodeId),
      action: id(event?.action),
      ok: event?.ok === true,
      reason: text(event?.reason),
      settlementId: plan.settlementId,
    });
    receipts.push(receipt);
    while (receipts.length > SETTLEMENT_HANDOFF_LIMITS.receipts) receipts.shift();
    return receipt;
  }

  function status() {
    return Object.freeze({
      version: SETTLEMENT_HANDOFF_VERSION,
      settlementId: plan.settlementId,
      closed,
      stepCount: plan.steps.length,
      receiptCount: receipts.length,
      lastSequence: sequence,
    });
  }

  function runStep(step, index) {
    if (closed) return record({ type: 'rejected', nodeId: step.nodeId, action: step.action, reason: 'session-closed' });
    const gateResult = evaluateSettlementGates(step.gates, context);
    if (!gateResult.ok) return record({ type: 'rejected', nodeId: step.nodeId, action: step.action, reason: gateResult.reason });

    const sliceResult = typeof slice.execute === 'function'
      ? safeInvoke((payload) => slice.execute(payload), {
          action: step.action,
          nodeId: step.nodeId,
          index,
          context,
        })
      : { ok: false, reason: 'slice-unavailable' };
    if (!sliceResult.ok) return record({ type: 'rejected', nodeId: step.nodeId, action: step.action, reason: sliceResult.reason });

    return record({ type: 'completed', nodeId: step.nodeId, action: step.action, ok: true });
  }

  return Object.freeze({
    version: SETTLEMENT_HANDOFF_VERSION,
    plan,
    status,
    runStep,
    runAll() {
      return Object.freeze(plan.steps.map(runStep));
    },
    receipts() {
      return Object.freeze(receipts.slice());
    },
    close() {
      closed = true;
      return status();
    },
    reset() {
      closed = false;
      sequence = 0;
      receipts.length = 0;
      return status();
    },
  });
}

export function summarizeSettlementGameplayHandoff(handoff) {
  if (!handoff || typeof handoff.receipts !== 'function') {
    return Object.freeze({ completed: 0, rejected: 0, total: 0, lastSequence: 0 });
  }
  const receipts = handoff.receipts();
  const completed = receipts.filter((entry) => entry.ok).length;
  return Object.freeze({
    completed,
    rejected: receipts.length - completed,
    total: receipts.length,
    lastSequence: finite(receipts.at(-1)?.sequence, 0),
  });
}
