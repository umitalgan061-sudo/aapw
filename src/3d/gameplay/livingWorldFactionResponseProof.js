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

const phaseFor = (entry) => entry?.phase ?? ({
  engage: 'attack',
  pursue: 'chase',
  investigate: 'investigate',
  return: 'return',
  flee: 'flee',
  observe: 'patrol',
}[actionFor(entry)] ?? 'unknown');

const chainTransitions = (entries) => {
  const byActor = new Map();
  for (const entry of entries) {
    const actorId = String(entry?.actorId ?? entry?.id ?? 'unknown');
    const current = phaseFor(entry);
    const previous = byActor.get(actorId);
    if (previous) previous.push(current);
    else byActor.set(actorId, [current]);
  }
  return [...byActor.values()].map((phases) => phases.join('>'));
};

const runtimeTickFor = (plan) => plan?.tick ?? plan?.tickCount ?? plan?.telemetry?.tick ?? null;

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
  const observedTick = runtimeTickFor(plan);
  const expected = expectedTick === null ? observedTick : expectedTick;
  const tickValue = expected === null ? null : finite(expected, NaN);
  const observedTicks = decisions.map((entry) => finite(entry?.tick, finite(observedTick, NaN)));
  const tickConsistent = tickValue === null || Number.isFinite(tickValue) && observedTicks.every((tick) => tick === tickValue);
  const frameValue = Math.max(0, finite(frameBudgetMs, 0));
  const policy = plan?.policy ?? null;
  const maxDecisions = finite(policy?.maxDecisions, finite(policy?.maxActors, 128));
  const maxEvents = finite(policy?.maxEvents, finite(policy?.maxEventsPerTick, 6));
  const chains = chainTransitions(decisions);
  const hasRuntimeChain = chains.some((chain) => /patrol>.*(investigate|chase|attack|flee)/.test(chain) || /detect>.*(investigate|chase|attack|flee)/.test(chain));
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
    tick: observedTick,
    tickConsistent,
    frameBudgetMs: frameValue,
    frameBudgetWithinTarget: frameValue <= 2.5,
    eventBudgetWithinPolicy: events.length <= maxEvents,
    decisionBudgetWithinPolicy: decisions.length <= maxDecisions,
    runtimeChains: freeze(chains),
    hasRuntimeChain,
    fingerprint: typeof plan?.fingerprint === 'string' ? plan.fingerprint : null,
  });
}

export const FACTION_RESPONSE_PROOF_VERSION = '2026-09-15-v5';
