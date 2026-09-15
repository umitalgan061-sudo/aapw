/**
 * Read-only bridge from the living-world director runtime snapshot to the
 * deterministic scenario policy. The bridge never calls controller update,
 * never creates entities, and never mutates canonical world state.
 */
import {
  buildScenarioRequest,
  buildScenarioPlan,
  auditScenarioBatch,
  scenarioDigest,
} from './livingWorldDirectorScenarioPolicy.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value) => Math.max(0, Math.min(1, finite(value)));
const key = (value) => String(value ?? '').trim().toLowerCase();

const STATE_TO_CONTEXT = freeze({
  idle: 'quiet', patrol: 'day', watch: 'night', alert: 'combat', chase: 'combat',
  flee: 'storm', rest: 'recovery', forage: 'harvest', trade: 'market', social: 'festival',
});

const KIND_TO_ROLE = freeze({ npc: 'guard', animal: 'hunter', creature: 'scout', dragon: 'watchcaptain' });

function readState(controller) {
  return key(controller?.state ?? controller?.currentState ?? controller?.object3D?.userData?.npcPerception?.intent ?? controller?.object3D?.userData?.wildlifeFlee?.phase);
}

function readPosition(controller) {
  const position = controller?.position ?? controller?.object3D?.position;
  if (!position) return null;
  const x = Number(position.x);
  const z = Number(position.z);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function distanceToPlayer(controller, playerPosition) {
  const actor = readPosition(controller);
  const player = playerPosition && Number.isFinite(Number(playerPosition.x)) && Number.isFinite(Number(playerPosition.z))
    ? { x: Number(playerPosition.x), z: Number(playerPosition.z) }
    : null;
  return actor && player ? Math.hypot(actor.x - player.x, actor.z - player.z) : 0;
}

function deriveRequest(entry, index, context = {}) {
  const controller = entry?.controller ?? entry;
  const kind = key(entry?.kind) || 'npc';
  const state = readState(controller);
  const role = key(entry?.role) || KIND_TO_ROLE[kind] || 'guard';
  const scenarioContext = key(entry?.context) || STATE_TO_CONTEXT[state] || key(context?.context) || 'quiet';
  const danger = clamp(context?.threatLevel ?? context?.danger ?? entry?.threat ?? 0);
  const urgency = clamp(entry?.urgency ?? context?.urgency ?? (danger * 0.65));
  const scarcity = clamp(entry?.scarcity ?? context?.scarcity);
  const socialNeed = clamp(entry?.socialNeed ?? context?.socialNeed ?? 0.25);
  const fatigue = clamp(entry?.fatigue ?? controller?.fatigue ?? controller?.staminaDebt);
  const travelRisk = clamp(entry?.travelRisk ?? context?.travelRisk ?? 0.25);
  const waitingSeconds = Math.max(0, finite(entry?.waitingSeconds ?? controller?.waitingSeconds));
  const distanceMeters = Math.max(0, finite(entry?.distanceMeters, distanceToPlayer(controller, context?.playerPosition)));
  const id = controller?.object3D?.uuid ?? controller?.object3D?.name ?? controller?.id ?? `${kind}-${index}`;
  return buildScenarioRequest({ role, context: scenarioContext, urgency, threat: danger, socialNeed, scarcity, fatigue, travelRisk, distanceMeters, waitingSeconds, requestId: String(id) });
}

export function buildDirectorScenarioRequests(snapshot, context = {}) {
  const entries = [];
  const sources = [
    ['npc', snapshot?.npcs ?? snapshot?.collections?.npcs],
    ['animal', snapshot?.animals ?? snapshot?.collections?.animals],
    ['creature', snapshot?.creatures ?? snapshot?.collections?.creatures],
    ['dragon', snapshot?.dragons ?? snapshot?.collections?.dragons],
  ];
  for (const [kind, values] of sources) {
    const list = Array.isArray(values) ? values : [];
    for (const controller of list) entries.push({ kind, controller });
  }
  return freeze(entries.map((entry, index) => deriveRequest(entry, index, context)));
}

export function buildDirectorScenarioPlan(snapshot, context = {}, options = {}) {
  const requests = buildDirectorScenarioRequests(snapshot, context);
  const plan = buildScenarioPlan(requests, options);
  return freeze({
    ...plan,
    requestCount: requests.length,
    sourceDigest: scenarioDigest(requests),
    audit: auditScenarioBatch(plan),
  });
}

export function summarizeDirectorPlan(plan) {
  const selected = Array.isArray(plan?.selected) ? plan.selected : [];
  const deferred = Array.isArray(plan?.deferred) ? plan.deferred : [];
  const tierCounts = { critical: 0, priority: 0, normal: 0, deferred: 0 };
  for (const item of selected) if (tierCounts[item.tier] != null) tierCounts[item.tier] += 1;
  return freeze({
    policyId: plan?.policyId ?? null,
    requestCount: Number(plan?.requestCount ?? selected.length + deferred.length),
    selectedCount: selected.length,
    deferredCount: deferred.length,
    tierCounts: freeze(tierCounts),
    skippedCount: Array.isArray(plan?.skipped) ? plan.skipped.length : 0,
    auditOk: plan?.audit?.ok === true,
    digest: String(plan?.digest ?? scenarioDigest(plan)),
  });
}

export function directorScenarioEvidence(snapshot, context = {}, options = {}) {
  const plan = buildDirectorScenarioPlan(snapshot, context, options);
  return freeze({
    schema: 'living-world-director-scenario-evidence-v1',
    summary: summarizeDirectorPlan(plan),
    plan,
    fingerprint: scenarioDigest({ plan, summary: summarizeDirectorPlan(plan) }),
  });
}

export function auditDirectorScenarioEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object') errors.push('missing-evidence');
  if (evidence?.schema !== 'living-world-director-scenario-evidence-v1') errors.push('schema');
  if (evidence?.summary?.selectedCount > 48) errors.push('selection-overflow');
  if (evidence?.plan?.audit?.ok !== true) errors.push('plan-audit');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), fingerprint: scenarioDigest(evidence) });
}
