const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const key = (value) => String(value ?? '').trim().toLowerCase();

export const LIVING_WORLD_DIRECTOR_PRIORITY_POLICY = freeze({
  id: 'living-world-director-priority-policy-2026-09-15-v1',
  deterministic: true,
  maxRequests: 192,
  maxBudget: 128,
  defaultBudget: 24,
  protectedThreatScore: 0.82,
  protectedUrgencyScore: 0.86,
  maxCooldownSeconds: 180,
});

const ROLE_PROFILES = freeze({
  guard: freeze({ domain: 'security', basePriority: 0.76, dangerWeight: 0.72, socialWeight: 0.20, travelCost: 0.18 }),
  watcher: freeze({ domain: 'security', basePriority: 0.71, dangerWeight: 0.77, socialWeight: 0.24, travelCost: 0.15 }),
  merchant: freeze({ domain: 'commerce', basePriority: 0.63, dangerWeight: 0.42, socialWeight: 0.74, travelCost: 0.26 }),
  caravan: freeze({ domain: 'travel', basePriority: 0.68, dangerWeight: 0.58, socialWeight: 0.52, travelCost: 0.68 }),
  farmer: freeze({ domain: 'agriculture', basePriority: 0.66, dangerWeight: 0.39, socialWeight: 0.62, travelCost: 0.32 }),
  hunter: freeze({ domain: 'provisioning', basePriority: 0.69, dangerWeight: 0.55, socialWeight: 0.47, travelCost: 0.51 }),
  herbalist: freeze({ domain: 'medicine', basePriority: 0.61, dangerWeight: 0.46, socialWeight: 0.44, travelCost: 0.38 }),
  healer: freeze({ domain: 'medicine', basePriority: 0.67, dangerWeight: 0.72, socialWeight: 0.38, travelCost: 0.22 }),
  blacksmith: freeze({ domain: 'craft', basePriority: 0.64, dangerWeight: 0.41, socialWeight: 0.55, travelCost: 0.34 }),
  miner: freeze({ domain: 'extraction', basePriority: 0.59, dangerWeight: 0.52, socialWeight: 0.58, travelCost: 0.63 }),
  scout: freeze({ domain: 'recon', basePriority: 0.73, dangerWeight: 0.81, socialWeight: 0.22, travelCost: 0.55 }),
  courier: freeze({ domain: 'messaging', basePriority: 0.70, dangerWeight: 0.62, socialWeight: 0.36, travelCost: 0.61 }),
  fisher: freeze({ domain: 'provisioning', basePriority: 0.58, dangerWeight: 0.47, socialWeight: 0.49, travelCost: 0.44 }),
  shepherd: freeze({ domain: 'livestock', basePriority: 0.60, dangerWeight: 0.43, socialWeight: 0.59, travelCost: 0.29 }),
  forester: freeze({ domain: 'ecology', basePriority: 0.57, dangerWeight: 0.49, socialWeight: 0.42, travelCost: 0.31 }),
  innkeeper: freeze({ domain: 'hospitality', basePriority: 0.54, dangerWeight: 0.28, socialWeight: 0.81, travelCost: 0.19 }),
  watchcaptain: freeze({ domain: 'security', basePriority: 0.82, dangerWeight: 0.86, socialWeight: 0.31, travelCost: 0.14 }),
  quartermaster: freeze({ domain: 'logistics', basePriority: 0.78, dangerWeight: 0.64, socialWeight: 0.61, travelCost: 0.36 }),
  ferryman: freeze({ domain: 'transport', basePriority: 0.56, dangerWeight: 0.37, socialWeight: 0.52, travelCost: 0.64 }),
  guide: freeze({ domain: 'travel', basePriority: 0.65, dangerWeight: 0.61, socialWeight: 0.46, travelCost: 0.59 }),
});

const CONTEXT_PROFILES = freeze({
  quiet: freeze({ danger: 0.18, social: 0.62, economy: 0.28, threat: 0.12, weather: 0.08 }),
  day: freeze({ danger: 0.24, social: 0.58, economy: 0.52, threat: 0.18, weather: 0.20 }),
  night: freeze({ danger: 0.49, social: 0.31, economy: 0.34, threat: 0.45, weather: 0.22 }),
  rain: freeze({ danger: 0.42, social: 0.44, economy: 0.38, threat: 0.34, weather: 0.72 }),
  storm: freeze({ danger: 0.82, social: 0.22, economy: 0.16, threat: 0.76, weather: 0.95 }),
  snow: freeze({ danger: 0.56, social: 0.28, economy: 0.21, threat: 0.52, weather: 0.88 }),
  festival: freeze({ danger: 0.22, social: 0.94, economy: 0.86, threat: 0.08, weather: 0.31 }),
  market: freeze({ danger: 0.27, social: 0.85, economy: 0.91, threat: 0.13, weather: 0.24 }),
  harvest: freeze({ danger: 0.38, social: 0.71, economy: 0.72, threat: 0.15, weather: 0.48 }),
  scarcity: freeze({ danger: 0.63, social: 0.36, economy: 0.29, threat: 0.44, weather: 0.33 }),
  fire: freeze({ danger: 0.91, social: 0.18, economy: 0.14, threat: 0.88, weather: 0.82 }),
  combat: freeze({ danger: 0.96, social: 0.12, economy: 0.11, threat: 0.93, weather: 0.19 }),
});

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619) >>> 0; }
  hash ^= hash >>> 16; hash = Math.imul(hash, 2246822507) >>> 0; hash ^= hash >>> 13;
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function decisionDigest(decisions) {
  const canonical = (Array.isArray(decisions) ? decisions : []).map((decision) => ({
    id: decision.request?.requestId,
    role: decision.request?.role,
    context: decision.request?.context,
    score: decision.score,
    reasons: decision.reasons,
  }));
  return hashString(JSON.stringify(canonical)).toString(16).padStart(8, '0');
}

export function getRoleProfile(role) { return ROLE_PROFILES[key(role)] ?? null; }
export function getContextProfile(context) { return CONTEXT_PROFILES[key(context)] ?? CONTEXT_PROFILES.quiet; }

function normalizeRequest(request, index) {
  const role = key(request?.role);
  const profile = ROLE_PROFILES[role];
  const contextKey = key(request?.context);
  return freeze({
    index,
    role,
    context: CONTEXT_PROFILES[contextKey] ? contextKey : 'quiet',
    knownRole: Boolean(profile),
    enabled: request?.enabled !== false,
    urgency: clamp(request?.urgency),
    threat: clamp(request?.threat),
    socialNeed: clamp(request?.socialNeed),
    fatigue: clamp(request?.fatigue),
    scarcity: clamp(request?.scarcity),
    travelRisk: clamp(request?.travelRisk),
    distanceMeters: Math.max(0, finite(request?.distanceMeters)),
    requestId: String(request?.requestId ?? `${role || 'unknown'}-${index}`),
  });
}

function signalFor(profile, request, context) {
  if (profile.domain === 'security') return clamp(context.threat);
  if (profile.domain === 'commerce') return clamp(context.economy);
  if (profile.domain === 'agriculture') return clamp(context.weather * 0.75 + request.scarcity * 0.25);
  if (profile.domain === 'medicine') return clamp(request.urgency * 0.65 + request.threat * 0.35);
  if (['travel', 'transport', 'messaging'].includes(profile.domain)) return clamp(request.urgency * 0.55 + (1 - request.travelRisk) * 0.45);
  if (profile.domain === 'hospitality') return clamp(context.social);
  if (['craft', 'extraction', 'logistics'].includes(profile.domain)) return clamp(context.economy);
  if (profile.domain === 'ecology') return clamp(1 - context.weather * 0.35 + request.scarcity * 0.65);
  return clamp(context.danger * 0.5 + request.urgency * 0.5);
}

export function scoreDirectorRequest(request, index = 0) {
  const item = normalizeRequest(request, index);
  if (!item.knownRole || !item.enabled) return freeze({ accepted: false, score: 0, reasons: freeze(['unknown-or-disabled']), request: item });
  const profile = ROLE_PROFILES[item.role];
  const context = CONTEXT_PROFILES[item.context];
  const signal = signalFor(profile, item, context);
  const dangerBoost = item.threat * profile.dangerWeight * 0.28;
  const urgencyBoost = item.urgency * 0.30;
  const scarcityBoost = item.scarcity * 0.16;
  const socialBoost = item.socialNeed * profile.socialWeight * 0.12;
  const fatiguePenalty = item.fatigue * (0.08 + profile.dangerWeight * 0.10);
  const travelPenalty = item.travelRisk * profile.travelCost * 0.10;
  const distancePenalty = clamp(item.distanceMeters / 5000) * 0.05;
  const protectedBoost = (item.threat >= LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.protectedThreatScore || item.urgency >= LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.protectedUrgencyScore) ? 0.18 : 0;
  const score = Number(clamp(profile.basePriority + signal * 0.34 + dangerBoost + urgencyBoost + scarcityBoost + socialBoost + protectedBoost - fatiguePenalty - travelPenalty - distancePenalty).toFixed(6));
  const reasons = [];
  if (protectedBoost) reasons.push('protected');
  if (dangerBoost >= 0.18) reasons.push('danger');
  if (item.urgency >= 0.75) reasons.push('urgent');
  if (item.scarcity >= 0.70) reasons.push('scarcity');
  if (item.fatigue >= 0.80) reasons.push('fatigue-penalty');
  if (item.travelRisk >= 0.75) reasons.push('travel-risk');
  if (!reasons.length) reasons.push('baseline');
  return freeze({ accepted: true, score, reasons: freeze(reasons), signal: Number(signal.toFixed(6)), request: item, profile, context });
}

function compareDecision(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.request.requestId !== b.request.requestId) return a.request.requestId.localeCompare(b.request.requestId);
  return a.request.index - b.request.index;
}

export function rankDirectorRequests(requests, { budget = LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.defaultBudget } = {}) {
  const safeBudget = Math.max(0, Math.min(LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.maxBudget, Math.floor(finite(budget))));
  const scored = (Array.isArray(requests) ? requests : []).slice(0, LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.maxRequests).map((request, index) => scoreDirectorRequest(request, index)).filter((decision) => decision.accepted);
  const ranked = scored.slice().sort(compareDecision);
  return freeze({ budget: safeBudget, considered: scored.length, selected: freeze(ranked.slice(0, safeBudget)), deferred: freeze(ranked.slice(safeBudget)), digest: decisionDigest(ranked) });
}

export function resolveBudgetConflicts(decisions, { budget = LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.defaultBudget, reservedProtected = 4 } = {}) {
  const ranked = (Array.isArray(decisions) ? decisions : []).slice().sort(compareDecision);
  const safeBudget = Math.max(0, Math.min(LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.maxBudget, Math.floor(finite(budget))));
  const protectedSet = ranked.filter((decision) => decision.reasons?.includes('protected')).slice(0, Math.min(safeBudget, Math.max(0, Math.floor(finite(reservedProtected)))));
  const protectedIds = new Set(protectedSet.map((decision) => decision.request.requestId));
  const remainder = ranked.filter((decision) => !protectedIds.has(decision.request.requestId));
  const selected = [...protectedSet, ...remainder.slice(0, Math.max(0, safeBudget - protectedSet.length))].sort(compareDecision);
  const selectedIds = new Set(selected.map((decision) => decision.request.requestId));
  return freeze({ budget: safeBudget, reservedProtected: protectedSet.length, selected: freeze(selected), deferred: freeze(ranked.filter((decision) => !selectedIds.has(decision.request.requestId))), digest: decisionDigest(selected) });
}

function cooldownSeconds(request) {
  return Math.max(1, Math.min(LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.maxCooldownSeconds, 15 - request.urgency * 9 - request.threat * 5));
}

export function nextEligibleSeconds(request, elapsedSinceLastSeconds = Infinity) {
  const elapsed = Math.max(0, finite(elapsedSinceLastSeconds, Infinity));
  return Math.max(0, Number((cooldownSeconds(normalizeRequest(request, 0)) - elapsed).toFixed(6)));
}

export function applyCooldown(decisions, cooldownLedger = new Map(), nowSeconds = 0) {
  const now = Math.max(0, finite(nowSeconds));
  const accepted = [];
  const skipped = [];
  for (const decision of Array.isArray(decisions) ? decisions : []) {
    const id = decision.request.requestId;
    const last = Number(cooldownLedger.get(id));
    const elapsed = Number.isFinite(last) ? Math.max(0, now - last) : Infinity;
    const remaining = nextEligibleSeconds(decision.request, elapsed);
    if (remaining > 0 && !decision.reasons.includes('protected')) skipped.push(freeze({ decision, remainingSeconds: remaining }));
    else { accepted.push(decision); cooldownLedger.set(id, now); }
  }
  return freeze({ accepted: freeze(accepted), skipped: freeze(skipped), nowSeconds: now, digest: decisionDigest(accepted) });
}

export function buildDirectorPlan(requests, options = {}) {
  const ranked = rankDirectorRequests(requests, options);
  const resolved = resolveBudgetConflicts(ranked.selected, options);
  const cooled = applyCooldown(resolved.selected, options.cooldownLedger ?? new Map(), options.nowSeconds ?? 0);
  return freeze({
    policyId: LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.id,
    budget: resolved.budget,
    considered: ranked.considered,
    selected: cooled.accepted,
    deferred: freeze([...resolved.deferred, ...cooled.skipped.map((entry) => entry.decision)]),
    skipped: cooled.skipped,
    digest: cooled.digest,
  });
}

export function auditPriorityDecision(decision) {
  const errors = [];
  if (!decision || typeof decision !== 'object') errors.push('missing-decision');
  if (decision?.accepted && !(decision.score >= 0 && decision.score <= 1)) errors.push('score-range');
  if (decision?.request?.requestId == null) errors.push('missing-request-id');
  if (decision?.accepted && !ROLE_PROFILES[decision.request.role]) errors.push('unknown-role');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: decisionDigest(decision ? [decision] : []) });
}

export function auditPriorityBatch(batch) {
  const errors = [];
  const selected = Array.isArray(batch?.selected) ? batch.selected : [];
  if (selected.length > LIVING_WORLD_DIRECTOR_PRIORITY_POLICY.maxBudget) errors.push('budget-overflow');
  const ids = new Set();
  for (const decision of selected) {
    const audit = auditPriorityDecision(decision);
    if (!audit.ok) errors.push(...audit.errors);
    const id = decision?.request?.requestId;
    if (ids.has(id)) errors.push(`duplicate:${id}`);
    ids.add(id);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: decisionDigest(selected) });
}
