import { auditFactionResponsePlan, FACTION_RESPONSE_POLICY } from './livingWorldFactionResponseBridge.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function summarizeFactionResponseProof(plan, { frameBudgetMs = 2.5, expectedTick = null } = {}) {
  const audit = auditFactionResponsePlan(plan);
  const decisions = Array.isArray(plan?.decisions) ? plan.decisions : [];
  const events = Array.isArray(plan?.events) ? plan.events : [];
  const actionCounts = decisions.reduce((counts, decision) => {
    counts[decision.action] = (counts[decision.action] || 0) + 1;
    return counts;
  }, {});
  const maxDecisionConfidence = decisions.reduce((max, decision) => Math.max(max, finite(decision.confidence, 0)), 0);
  const throttled = decisions.filter((decision) => decision.cooldownRemaining > 0).length;
  const tickConsistent = expectedTick === null || decisions.every((decision) => decision.tick === finite(expectedTick, decision.tick));
  return freeze({
    accepted: audit.ok === true,
    deterministic: plan?.deterministic === true,
    policy: plan?.policy || null,
    decisionCount: decisions.length,
    eventCount: events.length,
    actionCounts: freeze({ ...actionCounts }),
    maxDecisionConfidence,
    cooldownThrottled: throttled,
    tickConsistent,
    frameBudgetMs: Math.max(0, finite(frameBudgetMs, 0)),
    frameBudgetWithinTarget: finite(frameBudgetMs, 0) <= 2.5,
    eventBudgetWithinPolicy: events.length <= FACTION_RESPONSE_POLICY.maxEvents,
    fingerprint: plan?.fingerprint || null,
  });
}

export const FACTION_RESPONSE_PROOF_VERSION = '2026-09-14-v1';
