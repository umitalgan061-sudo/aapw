const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const boundedCount = (value) => Number.isInteger(value) && value >= 0 ? value : 0;

const toEntries = (value) => Array.isArray(value) ? value : [];
const actionFor = (entry) => {
  if (typeof entry?.action === 'string') return entry.action;
  if (entry?.phase === 'attack') return 'engage';
  if (entry?.phase === 'chase') return 'pursue';
  if (entry?.phase === 'investigate') return 'investigate';
  if (entry?.phase === 'return') return 'return';
  if (entry?.phase === 'flee') return 'flee';
  if (entry?.phase === 'patrol') return 'observe';
  return 'unknown';
};

export function summarizeFactionResponseProof(plan, { frameBudgetMs = 2.5, expectedTick = null } = {}) {
  const decisions = toEntries(plan?.decisions ?? plan?.results);
  const events = toEntries(plan?.events);
  const actionCounts = decisions.reduce((counts, entry) => {
    const action = actionFor(entry);
    counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, {});
  const maxDecisionConfidence = decisions.reduce((max, entry) => Math.max(max, finite(entry?.confidence, finite(entry?.signal?.confidence, 0))), 0);
  const throttled = decisions.filter((entry) => boundedCount(entry?.cooldownRemaining) > 0 || entry?.throttled === true).length;
  const tickValue = expectedTick === null ? null : finite(expectedTick, NaN);
  const observedTicks = decisions.map((entry) => finite(entry?.tick, finite(plan?.tick, NaN)));
  const tickConsistent = tickValue === null || Number.isFinite(tickValue) && observedTicks.every((tick) => tick === tickValue);
  const frameValue = Math.max(0, finite(frameBudgetMs, 0));
  const policy = plan?.policy ?? null;
  const maxDecisions = finite(policy?.maxDecisions, 128);
  const maxEvents = finite(policy?.maxEvents, finite(policy?.maxEventsPerTick, 6));
  const accepted = decisions.length <= maxDecisions && events.length <= maxEvents && tickConsistent;
  return freeze({
    accepted,
    deterministic: plan?.deterministic === true || plan?.telemetry?.deterministic === true,
    policy,
    decisionCount: decisions.length,
    eventCount: events.length,
    actionCounts: freeze({ ...actionCounts }),
    maxDecisionConfidence,
    cooldownThrottled: throttled,
    tickConsistent,
    frameBudgetMs: frameValue,
    frameBudgetWithinTarget: frameValue <= 2.5,
    eventBudgetWithinPolicy: events.length <= maxEvents,
    decisionBudgetWithinPolicy: decisions.length <= maxDecisions,
    fingerprint: typeof plan?.fingerprint === 'string' ? plan.fingerprint : null,
  });
}

export const FACTION_RESPONSE_PROOF_VERSION = '2026-09-15-v3';
