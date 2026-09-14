/**
 * Deterministic faction/reputation/law response projection over existing living-world owners.
 * This module never mutates ActorRegistry, faction, diplomacy, reputation or law state.
 */

const POLICY = Object.freeze({
  id: 'safak-kartali-faction-response-bridge-2026-09-14-v1',
  maxActors: 256,
  maxEvents: 64,
  wantedThreshold: 25,
  hostileReputation: -50,
  minActionConfidence: 0.55,
});

const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, min = -100, max = 100) => Math.max(min, Math.min(max, finite(v, 0)));
const asId = (v, fallback = '') => String(v ?? fallback).trim() || fallback;
const freeze = (v) => Object.freeze(v);
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
const digest = (value) => { let h = 2166136261; for (const c of stable(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };
const fingerprintFor = (result) => digest({ ...result, fingerprint: '' });

function relationFor(actor, target, services) {
  const actorFaction = asId(services?.factions?.getFactionIdForActor?.(actor), actor?.factionId);
  const targetFaction = asId(services?.factions?.getFactionIdForActor?.(target), target?.factionId);
  const relation = asId(services?.diplomacy?.getRelation?.(actorFaction, targetFaction), 'neutral').toLowerCase();
  const reputation = clamp(services?.reputation?.getReputation?.(actor, target), 0);
  const wanted = Math.max(0, finite(services?.law?.getWantedLevel?.(target), 0));
  const canArrest = services?.law?.canArrest?.(actor, target) !== false;
  return { actorFaction, targetFaction, relation, reputation, wanted, canArrest };
}

function classify(relation) {
  if (relation.relation === 'war' || relation.relation === 'hostile' || relation.reputation <= POLICY.hostileReputation || relation.wanted >= POLICY.wantedThreshold) return 'hostile';
  if (relation.relation === 'ally' || relation.relation === 'friendly' || relation.reputation >= 50) return 'ally';
  if (relation.relation === 'ceasefire' || relation.relation === 'neutral') return 'cautious';
  return 'unknown';
}

function actionFor(classification, actor, target, relation, confidence) {
  if (confidence < POLICY.minActionConfidence) return 'observe';
  if (classification === 'hostile') {
    if (target?.surrendered && relation.canArrest) return 'arrest';
    if (target?.fleeing) return 'pursue';
    return actor?.canAttack === false ? 'alert' : 'engage';
  }
  if (classification === 'ally') return 'assist';
  if (classification === 'cautious') return target?.trespassing ? 'warn' : 'observe';
  return 'observe';
}

function strongestObservations(observations) {
  const strongest = new Map();
  for (const observation of observations) {
    const actorId = asId(observation?.actorId);
    const targetId = asId(observation?.targetId);
    if (!actorId || !targetId) continue;
    const candidate = { ...observation, actorId, targetId, confidence: Math.max(0, Math.min(1, finite(observation?.confidence, 1))) };
    const key = `${actorId}|${targetId}`;
    const previous = strongest.get(key);
    if (!previous || candidate.confidence > previous.confidence || (candidate.confidence === previous.confidence && stable(candidate) < stable(previous))) strongest.set(key, candidate);
  }
  return [...strongest.values()].sort((a, b) => a.actorId.localeCompare(b.actorId) || a.targetId.localeCompare(b.targetId) || a.confidence - b.confidence);
}

export function planFactionResponseTick({ tick = 0, actors = [], observations = [], services = {}, eventBudget = POLICY.maxEvents } = {}) {
  const actorRows = actors.slice(0, POLICY.maxActors).map((actor, index) => ({ ...actor, id: asId(actor?.id, `actor-${index}`) }));
  const actorById = new Map(actorRows.map((actor) => [actor.id, actor]));
  const normalizedObservations = strongestObservations(observations).slice(0, POLICY.maxEvents);
  const decisions = [];
  const events = [];
  const eventKeys = new Set();
  const boundedEventBudget = Math.max(0, Math.min(POLICY.maxEvents, Math.floor(finite(eventBudget, POLICY.maxEvents))));
  for (const observation of normalizedObservations) {
    const actor = actorById.get(observation.actorId);
    const target = actorById.get(observation.targetId) || observation?.target;
    if (!actor || !target) continue;
    const relation = relationFor(actor, target, services);
    const confidence = observation.confidence;
    const classification = classify(relation);
    const action = actionFor(classification, actor, target, relation, confidence);
    const decision = freeze({ actorId: actor.id, targetId: asId(target?.id, observation.targetId), classification, action, faction: relation.actorFaction, targetFaction: relation.targetFaction, relation: relation.relation, reputation: relation.reputation, wanted: relation.wanted, confidence, tick: Math.max(0, finite(tick, 0)) });
    decisions.push(decision);
    const eventKey = `${actor.id}|${decision.targetId}|${action}`;
    if (events.length < boundedEventBudget && !eventKeys.has(eventKey) && confidence >= POLICY.minActionConfidence && (action === 'engage' || action === 'arrest' || action === 'pursue')) {
      eventKeys.add(eventKey);
      events.push(freeze({ type: 'living-world:faction-response', actorId: actor.id, targetId: decision.targetId, action, severity: classification === 'hostile' ? 'high' : 'medium', confidence, tick: decision.tick }));
    }
  }
  const result = { policy: POLICY.id, deterministic: true, decisions: freeze(decisions), events: freeze(events), counts: freeze({ observations: normalizedObservations.length, decisions: decisions.length, events: events.length }), fingerprint: '' };
  result.fingerprint = fingerprintFor(result);
  return freeze(result);
}

export function applyFactionResponseTick(plan, { onDecision, emitWorldEvent } = {}) {
  if (!plan || plan.policy !== POLICY.id || auditFactionResponsePlan(plan).ok !== true) return freeze({ accepted: false, delegated: 0, emitted: 0 });
  let delegated = 0;
  for (const decision of plan.decisions) { if (typeof onDecision === 'function') { onDecision(decision); delegated += 1; } }
  let emitted = 0;
  for (const event of plan.events) { if (typeof emitWorldEvent === 'function') { emitWorldEvent(event); emitted += 1; } }
  return freeze({ accepted: true, delegated, emitted, fingerprint: plan.fingerprint });
}

export function auditFactionResponsePlan(plan) {
  const structural = Boolean(plan?.deterministic && plan?.policy === POLICY.id && Array.isArray(plan?.decisions) && Array.isArray(plan?.events) && plan?.decisions?.length <= POLICY.maxEvents && plan?.events?.length <= POLICY.maxEvents && plan?.decisions?.every((d) => d.actorId && d.targetId && d.action));
  const expected = structural ? fingerprintFor(plan) : null;
  return freeze({ ok: structural && plan.fingerprint === expected, policy: plan?.policy || null, decisionCount: plan?.decisions?.length || 0, eventCount: plan?.events?.length || 0, fingerprint: plan?.fingerprint || null });
}

export const FACTION_RESPONSE_POLICY = POLICY;
