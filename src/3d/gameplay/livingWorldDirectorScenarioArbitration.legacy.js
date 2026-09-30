/**
 * Deterministic arbitration for living-world scenario requests.
 *
 * This layer consumes the pure scenario policy and produces a bounded plan.
 * Controller ownership, actor spawning, persistence, navigation and combat
 * truth remain outside this module. The caller owns execution.
 */

import {
  DIRECTOR_SCENARIO_POLICY,
  scoreScenarioRequest,
  scenarioDigest,
} from './livingWorldDirectorScenarioPolicy.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));

export const DIRECTOR_ARBITRATION_POLICY = freeze({
  id: 'living-world-director-scenario-arbitration-2026-09-15-v1',
  deterministic: true,
  renderOnly: false,
  maxRequests: DIRECTOR_SCENARIO_POLICY.maxRequests,
  maxSelected: DIRECTOR_SCENARIO_POLICY.maxSelected,
  criticalBudget: 12,
  priorityBudget: 24,
  normalBudget: 24,
  starvationThresholdSeconds: DIRECTOR_SCENARIO_POLICY.starvationSeconds,
  cooldownFloorSeconds: 4,
  cooldownCeilingSeconds: 90,
});

const TIER_ORDER = freeze({ critical: 0, priority: 1, normal: 2, deferred: 3, off: 4 });

const safeArray = (value) => Array.isArray(value) ? value : [];

function normalizeCooldown(item = {}) {
  return Math.max(
    DIRECTOR_ARBITRATION_POLICY.cooldownFloorSeconds,
    Math.min(
      DIRECTOR_ARBITRATION_POLICY.cooldownCeilingSeconds,
      finite(item.cooldownSeconds),
    ),
  );
}

function cooldownRatio(item = {}, nowSeconds = 0) {
  const last = finite(item.lastSelectedAt, -Infinity);
  const cooldown = normalizeCooldown(item);
  if (!Number.isFinite(last)) return 1;
  return clamp01((finite(nowSeconds) - last) / cooldown);
}

function starvationRatio(item = {}) {
  return clamp01(finite(item.waitingSeconds) / DIRECTOR_ARBITRATION_POLICY.starvationThresholdSeconds);
}

function effectiveScore(scored, request, nowSeconds) {
  const waitRelief = starvationRatio(request) * 0.08;
  const cooldownRelief = cooldownRatio(request, nowSeconds) * 0.07;
  const protectedRelief = scored.protected ? 0.10 : 0;
  return Number(Math.min(1, scored.score + waitRelief + cooldownRelief + protectedRelief).toFixed(6));
}

function sortCandidates(a, b) {
  if (a.effectiveScore !== b.effectiveScore) return b.effectiveScore - a.effectiveScore;
  if (a.protected !== b.protected) return Number(b.protected) - Number(a.protected);
  if (TIER_ORDER[a.tier] !== TIER_ORDER[b.tier]) return TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
  if (a.starvation !== b.starvation) return b.starvation - a.starvation;
  return a.request.requestId.localeCompare(b.request.requestId);
}

function countsByTier(items) {
  const result = { critical: 0, priority: 0, normal: 0, deferred: 0, off: 0 };
  for (const item of items) result[item.tier] = (result[item.tier] ?? 0) + 1;
  return freeze(result);
}

function budgetForTier(tier) {
  if (tier === 'critical') return DIRECTOR_ARBITRATION_POLICY.criticalBudget;
  if (tier === 'priority') return DIRECTOR_ARBITRATION_POLICY.priorityBudget;
  if (tier === 'normal') return DIRECTOR_ARBITRATION_POLICY.normalBudget;
  return 0;
}

function buildReason(scored, request, selected) {
  const reasons = [...(scored.reasons ?? [])];
  if (selected) reasons.push('selected-within-budget');
  else if (scored.tier === 'deferred') reasons.push('deferred-by-policy');
  else reasons.push('budget-deferred');
  if (cooldownRatio(request) < 0.5) reasons.push('cooldown-active');
  if (starvationRatio(request) >= 1) reasons.push('starvation-threshold');
  return freeze([...new Set(reasons)]);
}

export function buildScenarioCandidates(requests, { nowSeconds = 0 } = {}) {
  const list = safeArray(requests).slice(0, DIRECTOR_ARBITRATION_POLICY.maxRequests);
  return freeze(list.map((request, index) => {
    const scored = scoreScenarioRequest(request, index);
    const starvation = starvationRatio(scored.request);
    const cooldown = cooldownRatio(scored.request, nowSeconds);
    return freeze({
      scored,
      request: scored.request,
      tier: scored.tier,
      protected: Boolean(scored.protected),
      starvation,
      cooldown,
      effectiveScore: effectiveScore(scored, scored.request, nowSeconds),
      selected: false,
      reason: 'unresolved',
    });
  }));
}

function selectProtected(candidates, selected, used) {
  for (const candidate of candidates) {
    if (!candidate.protected || candidate.tier === 'off') continue;
    const budget = budgetForTier('critical');
    if (used.critical >= budget || selected.size >= DIRECTOR_ARBITRATION_POLICY.maxSelected) break;
    selected.add(candidate.request.requestId);
    used.critical += 1;
  }
}

function selectByTier(candidates, tier, selected, used) {
  const budget = budgetForTier(tier);
  for (const candidate of candidates) {
    if (candidate.tier !== tier || selected.has(candidate.request.requestId)) continue;
    if (used[tier] >= budget || selected.size >= DIRECTOR_ARBITRATION_POLICY.maxSelected) break;
    selected.add(candidate.request.requestId);
    used[tier] += 1;
  }
}

function starvationRelief(candidates, selected, used) {
  const ordered = [...candidates].sort((a, b) => {
    if (a.starvation !== b.starvation) return b.starvation - a.starvation;
    return b.effectiveScore - a.effectiveScore;
  });
  for (const candidate of ordered) {
    if (candidate.starvation < 1 || candidate.tier === 'off') continue;
    if (selected.has(candidate.request.requestId)) continue;
    const tier = candidate.tier === 'critical' ? 'critical' : candidate.tier === 'priority' ? 'priority' : 'normal';
    if (used[tier] >= budgetForTier(tier)) continue;
    if (selected.size >= DIRECTOR_SCENARIO_POLICY.maxSelected) break;
    selected.add(candidate.request.requestId);
    used[tier] += 1;
  }
}

function materializeDecision(candidate, selected) {
  return freeze({
    requestId: candidate.request.requestId,
    role: candidate.request.role,
    context: candidate.request.context,
    tier: candidate.tier,
    score: candidate.scored.score,
    effectiveScore: candidate.effectiveScore,
    protected: candidate.protected,
    starvation: Number(candidate.starvation.toFixed(6)),
    cooldown: Number(candidate.cooldown.toFixed(6)),
    selected,
    reason: buildReason(candidate.scored, candidate.request, selected),
  });
}

export function arbitrateScenarioRequests(requests, options = {}) {
  const nowSeconds = finite(options.nowSeconds);
  const candidates = buildScenarioCandidates(requests, { nowSeconds });
  const sorted = [...candidates].sort(sortCandidates);
  const selectedIds = new Set();
  const used = { critical: 0, priority: 0, normal: 0 };

  selectProtected(sorted, selectedIds, used);
  selectByTier(sorted, 'critical', selectedIds, used);
  selectByTier(sorted, 'priority', selectedIds, used);
  selectByTier(sorted, 'normal', selectedIds, used);
  starvationRelief(sorted, selectedIds, used);

  const decisions = sorted.map((candidate) => materializeDecision(candidate, selectedIds.has(candidate.request.requestId)));
  const selected = decisions.filter((decision) => decision.selected);
  const deferred = decisions.filter((decision) => !decision.selected && decision.tier !== 'off');
  const digest = scenarioDigest({
    policy: DIRECTOR_ARBITRATION_POLICY.id,
    nowSeconds,
    decisions,
  });

  return freeze({
    policy: DIRECTOR_ARBITRATION_POLICY,
    nowSeconds,
    requestCount: candidates.length,
    selectedCount: selected.length,
    deferredCount: deferred.length,
    counts: countsByTier(decisions),
    selected: freeze(selected),
    deferred: freeze(deferred),
    decisions: freeze(decisions),
    digest,
  });
}

export function explainArbitrationResult(result = {}) {
  const decisions = safeArray(result.decisions);
  const selected = decisions.filter((item) => item.selected);
  const protectedSelected = selected.filter((item) => item.protected);
  const starvationSelected = selected.filter((item) => item.starvation >= 1);
  return freeze({
    requestCount: decisions.length,
    selectedCount: selected.length,
    deferredCount: Math.max(0, decisions.length - selected.length),
    protectedSelectedCount: protectedSelected.length,
    starvationReliefCount: starvationSelected.length,
    tierCounts: countsByTier(decisions),
    selectedIds: freeze(selected.map((item) => item.requestId)),
    deferredIds: freeze(decisions.filter((item) => !item.selected).map((item) => item.requestId)),
    digest: result.digest ?? scenarioDigest(decisions),
  });
}

export function validateArbitrationResult(result = {}) {
  const errors = [];
  const selected = safeArray(result.selected);
  const decisions = safeArray(result.decisions);
  if (selected.length > DIRECTOR_ARBITRATION_POLICY.maxSelected) errors.push('selected-budget-exceeded');
  const ids = new Set();
  for (const decision of decisions) {
    if (!decision?.requestId) errors.push('missing-request-id');
    if (ids.has(decision.requestId)) errors.push(`duplicate-request:${decision.requestId}`);
    ids.add(decision.requestId);
    if (!['critical', 'priority', 'normal', 'deferred', 'off'].includes(decision.tier)) errors.push(`invalid-tier:${decision.requestId}`);
    if (decision.selected && decision.tier === 'off') errors.push(`off-selected:${decision.requestId}`);
  }
  const counts = countsByTier(decisions);
  if (counts.critical < selected.filter((item) => item.tier === 'critical').length) errors.push('critical-count-inconsistent');
  if (counts.priority < selected.filter((item) => item.tier === 'priority').length) errors.push('priority-count-inconsistent');
  return freeze({ valid: errors.length === 0, errors: freeze(errors) });
}

export function diffArbitrationResults(before = {}, after = {}) {
  const beforeById = new Map(safeArray(before.decisions).map((item) => [item.requestId, item]));
  const afterById = new Map(safeArray(after.decisions).map((item) => [item.requestId, item]));
  const changes = [];
  for (const [requestId, next] of afterById) {
    const previous = beforeById.get(requestId);
    if (!previous) {
      changes.push(freeze({ requestId, change: 'added', after: next }));
      continue;
    }
    if (previous.selected !== next.selected || previous.tier !== next.tier || previous.effectiveScore !== next.effectiveScore) {
      changes.push(freeze({
        requestId,
        change: 'updated',
        before: previous,
        after: next,
      }));
    }
  }
  for (const requestId of beforeById.keys()) {
    if (!afterById.has(requestId)) changes.push(freeze({ requestId, change: 'removed' }));
  }
  return freeze(changes);
}

export function summarizeArbitration(result = {}) {
  const explanation = explainArbitrationResult(result);
  return freeze({
    policyId: DIRECTOR_ARBITRATION_POLICY.id,
    requestCount: explanation.requestCount,
    selectedCount: explanation.selectedCount,
    protectedSelectedCount: explanation.protectedSelectedCount,
    starvationReliefCount: explanation.starvationReliefCount,
    tierCounts: explanation.tierCounts,
    digest: explanation.digest,
  });
}
