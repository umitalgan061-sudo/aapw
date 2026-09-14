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
});

const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const clamp = (v, min = -100, max = 100) => Math.max(min, Math.min(max, finite(v, 0)));
const asId = (v, fallback = '') => String(v ?? fallback).trim() || fallback;
const freeze = (v) => Object.freeze(v);
const stable = (v) => JSON.stringify(v, Object.keys(v).sort());
const digest = (v) => { let h = 2166136261; for (const c of stable(v)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(16).padStart(8, '0'); };

function relationFor(actor, target, services) {
  const actorFaction = asId(services?.factions?.getFactionIdForActor?.(actor), actor?.factionId);
  const targetFaction = asId(services?.factions?.getFactionIdForActor?.(target), target?.factionId);
  const relation = asId(services?.diplomacy?.getRelation?.(actorFaction, targetFaction), 'neutral').toLowerCase();
  const reputation = clamp(services?.reputation?.getReputation?.(actor, target), 0);
  const wanted = Math.max(0, finite(services?.law?.getWantedLevel?.(target), 0));
  return { actorFaction, targetFaction, relation, reputation, wanted };
}

function classify(relation) {
  if (relation.relation === 'war' || relation.relation === 'hostile' || relation.reputation <= POLICY.hostileReputation || relation.wanted >= POLICY.wantedThreshold) return 'hostile';
  if (relation.relation === 'ally' || relation.relation === 'friendly' || relation.reputation >= 50) return 'ally';
  if (relation.relation === 'ceasefire' || relation.relation === 'neutral') return 'cautious';
  return 'unknown';
}

function actionFor(classification, actor, target) {
  if (classification === 'hostile') {
    if (target?.surrendered) return 'arrest';
    if (target?.fleeing) return 'pursue';
    return actor?.canAttack === false ? 'alert' : 'engage';
  }
  if (classification === 'ally') return 'assist';
  if (classification === 'cautious') return target?.trespassing ? 'warn' : 'observe';
  return 'observe';
}

export function planFactionResponseTick({ tick = 0, actors = [], observations = [], services = {}, eventBudget = POLICY.maxEvents } = {}) {
  const actorRows = actors.slice(0, POLICY.maxActors).map((actor, index) => ({ ...actor, id: asId(actor?.id, `actor-${index}`) }));
  const sorted = [...observations].slice(0, POLICY.maxEvents).sort((a, b) => asId(a?.actorId).localeCompare(asId(b?.actorId)) || asId(a?.targetId).localeCompare(asId(b?.targetId)));
  const decisions = [];
  const events = [];
  for (const observation of sorted) {
    const actor = actorRows.find((row) => row.id === asId(observation?.actorId));
    const target = actorRows.find((row) => row.id === asId(observation?.targetId)) || observation?.target || {};
    if (!actor || !target) continue;
    const relation = relationFor(actor, target, services);
    const classification = classify(relation);
    const action = actionFor(classification, actor, target);
    const decision = freeze({ actorId: actor.id, targetId: asId(target?.id, observation?.targetId), classification, action, faction: relation.actorFaction, targetFaction: relation.targetFaction, relation: relation.relation, reputation: relation.reputation, wanted: relation.wanted, confidence: Math.max(0, Math.min(1, finite(observation?.confidence, 1))), tick: Math.max(0, finite(tick, 0)) });
    decisions.push(decision);
    if (action === 'engage' || action === 'arrest' || action === 'pursue') events.push(freeze({ type: 'living-world:faction-response', actorId: actor.id, targetId: decision.targetId, action, severity: classification === 'hostile' ? 'high' : 'medium', tick: decision.tick }));
    if (events.length >= eventBudget) break;
  }
  const result = { policy: POLICY.id, deterministic: true, decisions: freeze(decisions), events: freeze(events), counts: freeze({ observations: sorted.length, decisions: decisions.length, events: events.length }), fingerprint: '' };
  result.fingerprint = digest(result);
  return freeze(result);
}

export function applyFactionResponseTick(plan, { onDecision, emitWorldEvent } = {}) {
  if (!plan || plan.policy !== POLICY.id) return freeze({ accepted: false, delegated: 0, emitted: 0 });
  let delegated = 0;
  for (const decision of plan.decisions) { onDecision?.(decision); delegated += 1; }
  let emitted = 0;
  for (const event of plan.events) { emitWorldEvent?.(event); emitted += 1; }
  return freeze({ accepted: true, delegated, emitted, fingerprint: plan.fingerprint });
}

export function auditFactionResponsePlan(plan) {
  const valid = Boolean(plan?.deterministic && plan?.policy === POLICY.id && plan?.fingerprint && plan?.decisions?.every((d) => d.actorId && d.targetId && d.action));
  return freeze({ ok: valid, policy: plan?.policy || null, decisionCount: plan?.decisions?.length || 0, eventCount: plan?.events?.length || 0, fingerprint: plan?.fingerprint || null });
}

export const FACTION_RESPONSE_POLICY = POLICY;
