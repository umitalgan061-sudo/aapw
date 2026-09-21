// @ts-nocheck
/**
 * Deterministic scenario policy for the living-world director.
 *
 * This module turns actor context into an explainable scheduling tier without
 * owning controllers, spawning entities, writing world persistence, or changing
 * canonical simulation truth. It is intentionally pure so the same policy can
 * drive runtime planning, QA matrices, replay checks, and performance budgets.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const key = (value) => String(value ?? '').trim().toLowerCase();

export const DIRECTOR_SCENARIO_POLICY = freeze({
  id: 'living-world-director-scenario-policy-2026-09-15-v1',
  deterministic: true,
  version: 1,
  maxRequests: 192,
  maxSelected: 48,
  protectedThreat: 0.82,
  protectedUrgency: 0.86,
  starvationSeconds: 45,
  maxDistanceMeters: 5000,
  digestModulus: 0x100000000,
});

export const DIRECTOR_SCENARIO_ROLES = freeze([
  'guard',
  'watcher',
  'watchcaptain',
  'scout',
  'hunter',
  'farmer',
  'shepherd',
  'forester',
  'herbalist',
  'healer',
  'merchant',
  'quartermaster',
  'blacksmith',
  'miner',
  'courier',
  'guide',
]);

export const DIRECTOR_SCENARIO_CONTEXTS = freeze([
  'quiet',
  'day',
  'night',
  'rain',
  'storm',
  'snow',
  'festival',
  'market',
  'harvest',
  'scarcity',
  'fire',
  'combat',
  'drought',
  'fog',
  'siege',
  'recovery',
]);

const ROLE_PROFILES = freeze({
  guard: freeze({ domain: 'security', base: 0.76, danger: 0.82, social: 0.24, travel: 0.16, fatigue: 0.10 }),
  watcher: freeze({ domain: 'security', base: 0.70, danger: 0.76, social: 0.28, travel: 0.14, fatigue: 0.09 }),
  watchcaptain: freeze({ domain: 'security', base: 0.83, danger: 0.88, social: 0.31, travel: 0.12, fatigue: 0.12 }),
  scout: freeze({ domain: 'recon', base: 0.73, danger: 0.84, social: 0.18, travel: 0.48, fatigue: 0.14 }),
  hunter: freeze({ domain: 'provisioning', base: 0.68, danger: 0.58, social: 0.34, travel: 0.55, fatigue: 0.12 }),
  farmer: freeze({ domain: 'agriculture', base: 0.64, danger: 0.37, social: 0.60, travel: 0.29, fatigue: 0.11 }),
  shepherd: freeze({ domain: 'livestock', base: 0.60, danger: 0.42, social: 0.57, travel: 0.31, fatigue: 0.10 }),
  forester: freeze({ domain: 'ecology', base: 0.58, danger: 0.48, social: 0.40, travel: 0.36, fatigue: 0.09 }),
  herbalist: freeze({ domain: 'medicine', base: 0.61, danger: 0.43, social: 0.47, travel: 0.35, fatigue: 0.08 }),
  healer: freeze({ domain: 'medicine', base: 0.67, danger: 0.70, social: 0.39, travel: 0.21, fatigue: 0.07 }),
  merchant: freeze({ domain: 'commerce', base: 0.63, danger: 0.40, social: 0.84, travel: 0.27, fatigue: 0.10 }),
  quartermaster: freeze({ domain: 'logistics', base: 0.77, danger: 0.61, social: 0.59, travel: 0.35, fatigue: 0.11 }),
  blacksmith: freeze({ domain: 'craft', base: 0.65, danger: 0.38, social: 0.54, travel: 0.30, fatigue: 0.11 }),
  miner: freeze({ domain: 'extraction', base: 0.59, danger: 0.53, social: 0.46, travel: 0.61, fatigue: 0.16 }),
  courier: freeze({ domain: 'messaging', base: 0.71, danger: 0.60, social: 0.41, travel: 0.65, fatigue: 0.13 }),
  guide: freeze({ domain: 'travel', base: 0.66, danger: 0.63, social: 0.45, travel: 0.58, fatigue: 0.12 }),
});

const CONTEXT_PROFILES = freeze({
  quiet: freeze({ danger: 0.18, social: 0.62, economy: 0.28, weather: 0.08, threat: 0.12, travel: 0.12 }),
  day: freeze({ danger: 0.24, social: 0.58, economy: 0.52, weather: 0.20, threat: 0.18, travel: 0.34 }),
  night: freeze({ danger: 0.49, social: 0.31, economy: 0.34, weather: 0.22, threat: 0.45, travel: 0.44 }),
  rain: freeze({ danger: 0.42, social: 0.44, economy: 0.38, weather: 0.72, threat: 0.34, travel: 0.61 }),
  storm: freeze({ danger: 0.82, social: 0.22, economy: 0.16, weather: 0.95, threat: 0.76, travel: 0.88 }),
  snow: freeze({ danger: 0.56, social: 0.28, economy: 0.21, weather: 0.88, threat: 0.52, travel: 0.81 }),
  festival: freeze({ danger: 0.22, social: 0.94, economy: 0.86, weather: 0.31, threat: 0.08, travel: 0.27 }),
  market: freeze({ danger: 0.27, social: 0.85, economy: 0.91, weather: 0.24, threat: 0.13, travel: 0.32 }),
  harvest: freeze({ danger: 0.38, social: 0.71, economy: 0.72, weather: 0.48, threat: 0.15, travel: 0.36 }),
  scarcity: freeze({ danger: 0.63, social: 0.36, economy: 0.29, weather: 0.33, threat: 0.44, travel: 0.57 }),
  fire: freeze({ danger: 0.91, social: 0.18, economy: 0.14, weather: 0.82, threat: 0.88, travel: 0.68 }),
  combat: freeze({ danger: 0.96, social: 0.12, economy: 0.11, weather: 0.19, threat: 0.93, travel: 0.74 }),
  drought: freeze({ danger: 0.67, social: 0.34, economy: 0.24, weather: 0.91, threat: 0.58, travel: 0.49 }),
  fog: freeze({ danger: 0.55, social: 0.29, economy: 0.23, weather: 0.79, threat: 0.46, travel: 0.82 }),
  siege: freeze({ danger: 0.98, social: 0.17, economy: 0.08, weather: 0.17, threat: 0.97, travel: 0.92 }),
  recovery: freeze({ danger: 0.29, social: 0.54, economy: 0.41, weather: 0.26, threat: 0.22, travel: 0.31 }),
});

const DOMAINS = freeze({
  security: 'threat',
  recon: 'threat',
  provisioning: 'economy',
  agriculture: 'weather',
  livestock: 'weather',
  ecology: 'weather',
  medicine: 'urgency',
  commerce: 'economy',
  logistics: 'economy',
  craft: 'economy',
  extraction: 'economy',
  messaging: 'urgency',
  travel: 'travel',
});

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function scenarioDigest(value) {
  return stableHash(JSON.stringify(value ?? null)).toString(16).padStart(8, '0');
}

export function getScenarioRoleProfile(role) {
  return ROLE_PROFILES[key(role)] ?? null;
}

export function getScenarioContextProfile(context) {
  return CONTEXT_PROFILES[key(context)] ?? CONTEXT_PROFILES.quiet;
}

function normalizeRequest(request, index = 0) {
  const role = key(request?.role);
  const context = key(request?.context);
  return freeze({
    index,
    requestId: String(request?.requestId ?? `${role || 'unknown'}-${index}`),
    role,
    context: CONTEXT_PROFILES[context] ? context : 'quiet',
    urgency: clamp(request?.urgency),
    threat: clamp(request?.threat),
    socialNeed: clamp(request?.socialNeed),
    scarcity: clamp(request?.scarcity),
    fatigue: clamp(request?.fatigue),
    travelRisk: clamp(request?.travelRisk),
    distanceMeters: Math.max(0, finite(request?.distanceMeters)),
    enabled: request?.enabled !== false,
    waitingSeconds: Math.max(0, finite(request?.waitingSeconds)),
  });
}

function domainSignal(profile, request, context) {
  const domain = profile.domain;
  if (domain === 'security' || domain === 'recon') return clamp(context.threat * 0.68 + request.threat * 0.32);
  if (domain === 'medicine' || domain === 'messaging') return clamp(request.urgency * 0.76 + request.threat * 0.24);
  if (domain === 'agriculture' || domain === 'livestock' || domain === 'ecology') return clamp(context.weather * 0.44 + request.scarcity * 0.56);
  if (domain === 'commerce' || domain === 'logistics' || domain === 'craft' || domain === 'extraction') return clamp(context.economy * 0.56 + request.scarcity * 0.44);
  if (domain === 'travel') return clamp((1 - Math.max(context.travel, request.travelRisk)) * 0.60 + request.urgency * 0.40);
  if (domain === 'provisioning') return clamp(request.scarcity * 0.58 + context.economy * 0.22 + request.threat * 0.20);
  return clamp(context.danger * 0.5 + request.urgency * 0.5);
}

export function scoreScenarioRequest(request, index = 0) {
  const item = normalizeRequest(request, index);
  const profile = ROLE_PROFILES[item.role];
  if (!profile || !item.enabled) {
    return freeze({ accepted: false, score: 0, tier: 'off', reasons: freeze(['unknown-or-disabled']), request: item });
  }
  const context = CONTEXT_PROFILES[item.context];
  const signal = domainSignal(profile, item, context);
  const urgencyBoost = item.urgency * 0.28;
  const threatBoost = item.threat * profile.danger * 0.26;
  const contextThreatBoost = context.threat * profile.danger * 0.16;
  const socialBoost = item.socialNeed * profile.social * 0.10;
  const scarcityBoost = item.scarcity * 0.13;
  const starvationBoost = clamp(item.waitingSeconds / DIRECTOR_SCENARIO_POLICY.starvationSeconds) * 0.11;
  const fatiguePenalty = item.fatigue * (0.06 + profile.fatigue);
  const travelPenalty = Math.max(context.travel, item.travelRisk) * profile.travel * 0.08;
  const distancePenalty = clamp(item.distanceMeters / DIRECTOR_SCENARIO_POLICY.maxDistanceMeters) * 0.05;
  const protected = item.threat >= DIRECTOR_SCENARIO_POLICY.protectedThreat || item.urgency >= DIRECTOR_SCENARIO_POLICY.protectedUrgency;
  const protectedBoost = protected ? 0.15 : 0;
  const raw = profile.base + signal * 0.30 + urgencyBoost + threatBoost + contextThreatBoost + socialBoost + scarcityBoost + starvationBoost + protectedBoost - fatiguePenalty - travelPenalty - distancePenalty;
  const score = Number(clamp(raw).toFixed(6));
  const tier = protected || score >= 0.86 ? 'critical' : score >= 0.68 ? 'priority' : score >= 0.46 ? 'normal' : 'deferred';
  const reasons = [];
  if (protected) reasons.push('protected');
  if (signal >= 0.72) reasons.push('strong-domain-signal');
  if (item.waitingSeconds >= DIRECTOR_SCENARIO_POLICY.starvationSeconds) reasons.push('starvation-relief');
  if (item.fatigue >= 0.80) reasons.push('fatigue-penalty');
  if (item.travelRisk >= 0.75) reasons.push('travel-risk');
  if (item.scarcity >= 0.70) reasons.push('scarcity');
  if (context.danger >= 0.80) reasons.push('dangerous-context');
  if (!reasons.length) reasons.push('baseline');
  return freeze({
    accepted: true,
    score,
    tier,
    protected,
    reasons: freeze(reasons),
    request: item,
    profile,
    context,
    signal: Number(signal.toFixed(6)),
    components: freeze({
      urgencyBoost: Number(urgencyBoost.toFixed(6)),
      threatBoost: Number(threatBoost.toFixed(6)),
      contextThreatBoost: Number(contextThreatBoost.toFixed(6)),
      socialBoost: Number(socialBoost.toFixed(6)),
      scarcityBoost: Number(scarcityBoost.toFixed(6)),
      starvationBoost: Number(starvationBoost.toFixed(6)),
      protectedBoost: Number(protectedBoost.toFixed(6)),
      fatiguePenalty: Number(fatiguePenalty.toFixed(6)),
      travelPenalty: Number(travelPenalty.toFixed(6)),
      distancePenalty: Number(distancePenalty.toFixed(6)),
    }),
  });
}

function compareScenarioResults(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.protected !== b.protected) return Number(b.protected) - Number(a.protected);
  if (a.request.requestId !== b.request.requestId) return a.request.requestId.localeCompare(b.request.requestId);
  return a.request.index - b.request.index;
}

export function rankScenarioRequests(requests, { limit = DIRECTOR_SCENARIO_POLICY.maxSelected } = {}) {
  const safeLimit = Math.max(0, Math.min(DIRECTOR_SCENARIO_POLICY.maxSelected, Math.floor(finite(limit, DIRECTOR_SCENARIO_POLICY.maxSelected))));
  const scored = (Array.isArray(requests) ? requests : [])
    .slice(0, DIRECTOR_SCENARIO_POLICY.maxRequests)
    .map(scoreScenarioRequest)
    .filter((result) => result.accepted)
    .sort(compareScenarioResults);
  return freeze({
    considered: scored.length,
    selected: freeze(scored.slice(0, safeLimit)),
    deferred: freeze(scored.slice(safeLimit)),
    digest: scenarioDigest(scored),
  });
}

export function reserveProtectedScenarioBudget(results, { limit = DIRECTOR_SCENARIO_POLICY.maxSelected, protectedSlots = 4 } = {}) {
  const ranked = Array.isArray(results) ? results.slice().sort(compareScenarioResults) : [];
  const safeLimit = Math.max(0, Math.min(DIRECTOR_SCENARIO_POLICY.maxSelected, Math.floor(finite(limit, DIRECTOR_SCENARIO_POLICY.maxSelected))));
  const safeProtectedSlots = Math.max(0, Math.min(safeLimit, Math.floor(finite(protectedSlots, 4))));
  const protectedResults = ranked.filter((result) => result.protected).slice(0, safeProtectedSlots);
  const protectedIds = new Set(protectedResults.map((result) => result.request.requestId));
  const remainder = ranked.filter((result) => !protectedIds.has(result.request.requestId));
  const selected = [...protectedResults, ...remainder.slice(0, Math.max(0, safeLimit - protectedResults.length))].sort(compareScenarioResults);
  const selectedIds = new Set(selected.map((result) => result.request.requestId));
  return freeze({
    limit: safeLimit,
    reservedProtected: protectedResults.length,
    selected: freeze(selected),
    deferred: freeze(ranked.filter((result) => !selectedIds.has(result.request.requestId))),
    digest: scenarioDigest(selected),
  });
}

export function applyScenarioCooldown(results, ledger = new Map(), nowSeconds = 0, minimumIntervalSeconds = 2) {
  const now = Math.max(0, finite(nowSeconds));
  const minimum = Math.max(0.25, finite(minimumIntervalSeconds, 2));
  const accepted = [];
  const skipped = [];
  for (const result of Array.isArray(results) ? results : []) {
    const id = result.request.requestId;
    const last = finite(ledger.get(id), NaN);
    const elapsed = Number.isFinite(last) ? Math.max(0, now - last) : Infinity;
    const protected = result.protected;
    if (!protected && elapsed < minimum) {
      skipped.push(freeze({ result, remainingSeconds: Number((minimum - elapsed).toFixed(6)) }));
      continue;
    }
    accepted.push(result);
    ledger.set(id, now);
  }
  return freeze({ accepted: freeze(accepted), skipped: freeze(skipped), nowSeconds: now, digest: scenarioDigest(accepted) });
}

export function buildScenarioPlan(requests, options = {}) {
  const ranked = rankScenarioRequests(requests, options);
  const reserved = reserveProtectedScenarioBudget(ranked.selected, options);
  const cooled = applyScenarioCooldown(reserved.selected, options.cooldownLedger ?? new Map(), options.nowSeconds ?? 0, options.minimumIntervalSeconds ?? 2);
  return freeze({
    policyId: DIRECTOR_SCENARIO_POLICY.id,
    version: DIRECTOR_SCENARIO_POLICY.version,
    considered: ranked.considered,
    selected: cooled.accepted,
    deferred: freeze([...reserved.deferred, ...cooled.skipped.map((item) => item.result)]),
    skipped: cooled.skipped,
    digest: cooled.digest,
  });
}

export function explainScenarioRequest(request, index = 0) {
  const result = scoreScenarioRequest(request, index);
  if (!result.accepted) return result;
  return freeze({
    ...result,
    explanation: freeze({
      tier: result.tier,
      protected: result.protected,
      signal: result.signal,
      score: result.score,
      reasonCount: result.reasons.length,
      distanceMeters: result.request.distanceMeters,
      waitingSeconds: result.request.waitingSeconds,
    }),
  });
}

export function auditScenarioResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object') errors.push('missing-result');
  if (result?.accepted && (!Number.isFinite(result.score) || result.score < 0 || result.score > 1)) errors.push('score-range');
  if (result?.accepted && !['critical', 'priority', 'normal', 'deferred'].includes(result.tier)) errors.push('tier-range');
  if (result?.request?.requestId == null) errors.push('request-id');
  if (result?.accepted && !ROLE_PROFILES[result.request.role]) errors.push('role');
  if (result?.accepted && !CONTEXT_PROFILES[result.request.context]) errors.push('context');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: scenarioDigest(result) });
}

export function auditScenarioBatch(batch) {
  const errors = [];
  const selected = Array.isArray(batch?.selected) ? batch.selected : [];
  if (selected.length > DIRECTOR_SCENARIO_POLICY.maxSelected) errors.push('selection-overflow');
  const ids = new Set();
  for (const result of selected) {
    const audit = auditScenarioResult(result);
    if (!audit.ok) errors.push(...audit.errors);
    const id = result?.request?.requestId;
    if (ids.has(id)) errors.push(`duplicate:${id}`);
    ids.add(id);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), count: selected.length, digest: scenarioDigest(selected) });
}

export function expectedScenarioTier(score) {
  const value = clamp(score);
  if (value >= 0.86) return 'critical';
  if (value >= 0.68) return 'priority';
  if (value >= 0.46) return 'normal';
  return 'deferred';
}

export function buildScenarioRequest({ role, context, urgency = 0, threat = 0, socialNeed = 0, scarcity = 0, fatigue = 0, travelRisk = 0, distanceMeters = 0, waitingSeconds = 0, requestId } = {}) {
  return freeze({ role, context, urgency, threat, socialNeed, scarcity, fatigue, travelRisk, distanceMeters, waitingSeconds, requestId });
}

export function scenarioCartesianDimensions() {
  return freeze({
    roles: DIRECTOR_SCENARIO_ROLES.length,
    contexts: DIRECTOR_SCENARIO_CONTEXTS.length,
    urgencyBands: 4,
    threatBands: 4,
    socialBands: 4,
    scarcityBands: 4,
    total: DIRECTOR_SCENARIO_ROLES.length * DIRECTOR_SCENARIO_CONTEXTS.length * 4 * 4 * 4 * 4,
  });
}

export function policyFingerprint() {
  return scenarioDigest({
    policy: DIRECTOR_SCENARIO_POLICY,
    roles: DIRECTOR_SCENARIO_ROLES,
    contexts: DIRECTOR_SCENARIO_CONTEXTS,
  });
}

export function listScenarioDomains() {
  return freeze([...new Set(DIRECTOR_SCENARIO_ROLES.map((role) => ROLE_PROFILES[role].domain))]);
}
