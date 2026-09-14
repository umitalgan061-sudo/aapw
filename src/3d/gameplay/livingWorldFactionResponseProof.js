import { auditFactionResponsePlan, FACTION_RESPONSE_POLICY } from './livingWorldFactionResponseBridge.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const boundedCount = (value) => Number.isInteger(value) && value >= 0 ? value : 0;

export function summarizeFactionResponseProof(plan, { frameBudgetMs = 2.5, expectedTick = null } = {}) {
  const audit = auditFactionResponsePlan(plan);
  const decisions = Array.isArray(plan?.decisions) ? plan.decisions : [];
  const events = Array.isArray(plan?.events) ? plan.events : [];
  const actionCounts = decisions.reduce((counts, decision) => {
    const action = typeof decision?.action === 'string' ? decision.action : 'unknown';
    counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, {});
  const maxDecisionConfidence = decisions.reduce((max, decision) => Math.max(max, finite(decision?.confidence, 0)), 0);
  const throttled = decisions.filter((decision) => boundedCount(decision?.cooldownRemaining) > 0).length;
  const tickValue = expectedTick === null ? null : finite(expectedTick, NaN);
  const tickConsistent = tickValue === null || Number.isFinite(tickValue) && decisions.every((decision) => finite(decision?.tick, NaN) === tickValue);
  const frameValue = Math.max(0, finite(frameBudgetMs, 0));
  const accepted = audit.ok === true && decisions.length <= FACTION_RESPONSE_POLICY.maxDecisions && events.length <= FACTION_RESPONSE_POLICY.maxEvents;
  return freeze({
    accepted,
    deterministic: plan?.deterministic === true,
    policy: plan?.policy || null,
    decisionCount: decisions.length,
    eventCount: events.length,
    actionCounts: freeze({ ...actionCounts }),
    maxDecisionConfidence,
    cooldownThrottled: throttled,
    tickConsistent,
    frameBudgetMs: frameValue,
    frameBudgetWithinTarget: frameValue <= 2.5,
    eventBudgetWithinPolicy: events.length <= FACTION_RESPONSE_POLICY.maxEvents,
    decisionBudgetWithinPolicy: decisions.length <= FACTION_RESPONSE_POLICY.maxDecisions,
    fingerprint: typeof plan?.fingerprint === 'string' ? plan.fingerprint : null,
  });
}

export const FACTION_RESPONSE_PROOF_VERSION = '2026-09-14-v2';
