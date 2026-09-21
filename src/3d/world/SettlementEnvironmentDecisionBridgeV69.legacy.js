import {
  resolveSettlementDecisionV69,
  rankSettlementDecisionsV69,
} from './SettlementDecisionRuntimeV69.js';
import {
  V68_GENERATED_CATALOG,
  V68_GENERATED_DOMAINS,
} from './environmentRuntimeSettlementV68Generated.js';

const DOMAIN_SET = new Set(V68_GENERATED_DOMAINS);
const evidenceByDomain = new Map();
for (const domain of V68_GENERATED_DOMAINS) {
  evidenceByDomain.set(
    domain,
    V68_GENERATED_CATALOG.filter((entry) => entry.domain === domain),
  );
}

function clamp01(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeDomain(domain) {
  return typeof domain === 'string' && DOMAIN_SET.has(domain) ? domain : null;
}

function normalizeSlot(slot) {
  const number = Number(slot);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function selectEvidence(domain, slot = null) {
  const entries = evidenceByDomain.get(domain) || [];
  if (slot === null) return entries;
  const exact = entries.filter((entry) => entry.slot === slot);
  return exact.length ? exact : entries;
}

function summarizeEvidence(entries) {
  return {
    count: entries.length,
    value: average(entries.map((entry) => clamp01(entry.value))),
    pressure: average(entries.map((entry) => clamp01(entry.pressure))),
    risk: average(entries.map((entry) => clamp01(entry.risk))),
  };
}

export const SETTLEMENT_BRIDGE_POLICY_V69 = Object.freeze({
  version: 69,
  evidenceVersion: 68,
  deterministic: true,
  readOnly: true,
  maxRecommendations: 8,
  scoreWeights: Object.freeze({
    decision: 0.55,
    evidence: 0.3,
    context: 0.15,
  }),
});

export function validateSettlementBridgeDomain(domain) {
  const normalized = normalizeDomain(domain);
  return normalized
    ? { ok: true, domain: normalized }
    : { ok: false, error: 'unknown-settlement-domain', domain: domain ?? null };
}

export function buildSettlementDecisionContextV69(domain, context = {}, slot = null) {
  const domainValidation = validateSettlementBridgeDomain(domain);
  if (!domainValidation.ok) return domainValidation;

  const normalizedSlot = normalizeSlot(slot);
  const evidence = summarizeEvidence(selectEvidence(domainValidation.domain, normalizedSlot));
  const signal = clamp01(context.signal, evidence.value);
  const pressure = clamp01(context.pressure, evidence.pressure);
  const risk = clamp01(context.risk, evidence.risk);
  const stability = clamp01(context.stability, 1 - risk);
  const urgency = clamp01(context.urgency, Math.max(signal, pressure, risk));

  return {
    ok: true,
    domain: domainValidation.domain,
    slot: normalizedSlot,
    context: {
      signal,
      pressure,
      risk,
      stability,
      urgency,
    },
    evidence,
    policyVersion: SETTLEMENT_BRIDGE_POLICY_V69.version,
  };
}

export function resolveSettlementEnvironmentDecisionV69(domain, slot, context = {}) {
  const contextResult = buildSettlementDecisionContextV69(domain, context, slot);
  if (!contextResult.ok) return contextResult;

  const decision = resolveSettlementDecisionV69(domain, slot, contextResult.context);
  if (!decision.ok) return decision;

  const evidence = contextResult.evidence;
  const evidenceSignal = Math.max(evidence.value, evidence.pressure, evidence.risk);
  const evidenceScore = clamp01(evidenceSignal);
  const contextScore = clamp01(
    contextResult.context.urgency * 0.7 + (1 - contextResult.context.stability) * 0.3,
  );
  const weights = SETTLEMENT_BRIDGE_POLICY_V69.scoreWeights;
  const combinedScore = Number((
    clamp01(decision.score / 5)
    * weights.decision
    + evidenceScore * weights.evidence
    + contextScore * weights.context
  ).toFixed(4));

  return {
    ok: true,
    domain,
    slot,
    decision: decision.decision,
    active: decision.active,
    decisionScore: decision.score,
    evidenceScore,
    contextScore,
    combinedScore,
    evidence,
    context: contextResult.context,
    policyVersion: SETTLEMENT_BRIDGE_POLICY_V69.version,
  };
}

export function rankSettlementEnvironmentDecisionsV69(domain, context = {}, options = {}) {
  const contextResult = buildSettlementDecisionContextV69(domain, context);
  if (!contextResult.ok) return contextResult;

  const limit = Number.isInteger(options.limit)
    ? Math.max(1, Math.min(SETTLEMENT_BRIDGE_POLICY_V69.maxRecommendations, options.limit))
    : SETTLEMENT_BRIDGE_POLICY_V69.maxRecommendations;

  const ranked = rankSettlementDecisionsV69(domain, contextResult.context)
    .map((result) => resolveSettlementEnvironmentDecisionV69(domain, result.decision.slot, contextResult.context))
    .filter((result) => result.ok)
    .sort((a, b) => {
      if (b.combinedScore !== a.combinedScore) return b.combinedScore - a.combinedScore;
      if (b.decisionScore !== a.decisionScore) return b.decisionScore - a.decisionScore;
      return a.slot - b.slot;
    });

  return {
    ok: true,
    domain,
    limit,
    context: contextResult.context,
    evidence: contextResult.evidence,
    recommendations: ranked.slice(0, limit),
    policyVersion: SETTLEMENT_BRIDGE_POLICY_V69.version,
  };
}

export function summarizeSettlementEnvironmentV69(contextByDomain = {}) {
  const summaries = {};
  for (const domain of V68_GENERATED_DOMAINS) {
    const result = rankSettlementEnvironmentDecisionsV69(domain, contextByDomain[domain] || {}, { limit: 3 });
    summaries[domain] = result.ok
      ? {
          evidence: result.evidence,
          recommendations: result.recommendations.map((entry) => ({
            slot: entry.slot,
            active: entry.active,
            score: entry.combinedScore,
          })),
        }
      : { error: result.error };
  }
  return {
    ok: Object.values(summaries).every((summary) => !summary.error),
    policy: SETTLEMENT_BRIDGE_POLICY_V69,
    domains: summaries,
  };
}

export function validateSettlementEnvironmentBridgeV69() {
  const errors = [];
  if (V68_GENERATED_DOMAINS.length !== 20) errors.push(`domain-count:${V68_GENERATED_DOMAINS.length}`);
  if (V68_GENERATED_CATALOG.length !== 4100) errors.push(`evidence-count:${V68_GENERATED_CATALOG.length}`);
  for (const domain of V68_GENERATED_DOMAINS) {
    const entries = evidenceByDomain.get(domain) || [];
    if (!entries.length) errors.push(`empty-domain:${domain}`);
    if (entries.some((entry) => entry.domain !== domain)) errors.push(`foreign-entry:${domain}`);
  }
  const probe = resolveSettlementEnvironmentDecisionV69('signals', 1, { signal: 0.6, pressure: 0.4, risk: 0.2 });
  if (!probe.ok) errors.push(`probe:${probe.error}`);
  if (probe.ok && (!Number.isFinite(probe.combinedScore) || probe.combinedScore < 0 || probe.combinedScore > 1)) {
    errors.push('probe:combined-score-range');
  }
  return { ok: errors.length === 0, errors };
}
