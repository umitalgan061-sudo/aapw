import {
  V69_CATALOG,
  V69_DOMAINS,
  V69_POLICY,
} from './settlementDecisionRuntimeV69Generated.js';

const byId = new Map(V69_CATALOG.map((entry) => [entry.id, entry]));
const byDomain = new Map(V69_DOMAINS.map((domain) => [
  domain,
  V69_CATALOG.filter((entry) => entry.domain === domain),
]));

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function resolveSettlementDecisionV69(domain, slot, context = {}) {
  const entry = byId.get(`${domain}-${slot}`);
  if (!entry) return { ok: false, error: 'decision-not-found' };
  const signal = Math.max(0, Math.min(1, finite(context.signal, 0)));
  const pressure = Math.max(0, Math.min(1, finite(context.pressure, signal)));
  const risk = Math.max(0, Math.min(1, finite(context.risk, pressure)));
  const trigger = Math.max(signal, pressure, risk);
  const active = trigger >= entry.threshold;
  const score = Number((entry.priority * trigger * (1 + entry.response / 4)).toFixed(4));
  return { ok: true, decision: entry, active, score, policyVersion: V69_POLICY.version };
}

export function listSettlementDecisionsV69(domain) {
  const entries = byDomain.get(domain);
  return entries ? [...entries] : [];
}

export function rankSettlementDecisionsV69(domain, context = {}) {
  return listSettlementDecisionsV69(domain)
    .map((entry) => resolveSettlementDecisionV69(domain, entry.slot, context))
    .filter((result) => result.ok)
    .sort((a, b) => b.score - a.score || a.decision.slot - b.decision.slot);
}

export function explainSettlementDecisionV69(domain, slot, context = {}) {
  const result = resolveSettlementDecisionV69(domain, slot, context);
  if (!result.ok) return result;
  const { decision } = result;
  const trigger = Math.max(
    Math.max(0, Math.min(1, finite(context.signal, 0))),
    Math.max(0, Math.min(1, finite(context.pressure, 0))),
    Math.max(0, Math.min(1, finite(context.risk, 0))),
  );
  return {
    ...result,
    explanation: {
      trigger,
      threshold: decision.threshold,
      margin: Number((trigger - decision.threshold).toFixed(4)),
      priorityContribution: Number((decision.priority * trigger).toFixed(4)),
      responseContribution: Number((1 + decision.response / 4).toFixed(4)),
      capacity: decision.capacity,
      persistence: decision.persistence,
      status: result.active ? 'eligible' : 'below-threshold',
    },
  };
}

export function summarizeSettlementDecisionV69() {
  const counts = Object.fromEntries(V69_DOMAINS.map((domain) => [domain, byDomain.get(domain).length]));
  return { ...V69_POLICY, domains: [...V69_DOMAINS], count: V69_CATALOG.length, counts };
}

export function validateSettlementDecisionV69() {
  const errors = [];
  const seen = new Set();
  for (const entry of V69_CATALOG) {
    if (seen.has(entry.id)) errors.push(`duplicate:${entry.id}`);
    seen.add(entry.id);
    if (!V69_DOMAINS.includes(entry.domain)) errors.push(`domain:${entry.id}`);
    if (!Number.isInteger(entry.slot) || entry.slot < 1 || entry.slot > 210) errors.push(`slot:${entry.id}`);
    if (!Number.isInteger(entry.priority) || entry.priority < 1 || entry.priority > 5) errors.push(`priority:${entry.id}`);
    if (!Number.isInteger(entry.capacity) || entry.capacity < 1 || entry.capacity > 7) errors.push(`capacity:${entry.id}`);
    if (!Number.isFinite(entry.threshold) || entry.threshold < 0.1 || entry.threshold > 0.99) errors.push(`threshold:${entry.id}`);
    if (!Number.isInteger(entry.persistence) || entry.persistence < 1 || entry.persistence > 9) errors.push(`persistence:${entry.id}`);
    if (!Number.isInteger(entry.response) || entry.response < 0 || entry.response > 3) errors.push(`response:${entry.id}`);
  }
  if (V69_CATALOG.length !== 4200) errors.push(`count:${V69_CATALOG.length}`);
  return { ok: errors.length === 0, errors, count: V69_CATALOG.length };
}
