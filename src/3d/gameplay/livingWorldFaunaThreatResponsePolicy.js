/**
 * Şafak Kartalı — deterministic fauna threat-response policy.
 *
 * Pure adapter over caller-owned fauna observations. It proves the runtime
 * wildlife chain roam -> threat -> flee without owning transforms, steering,
 * navigation, combat, spawning, THREE, DOM, timers or assets.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const idOf = (value, fallback = '') => String(value ?? fallback).trim() || fallback;
const text = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY = freeze({
  id: 'safak-kartali-fauna-threat-response-2026-09-17-v1',
  deterministic: true,
  maxActors: 128,
  maxTransitions: 32,
  fleeThreatThreshold: 0.55,
  fleeDistanceMeters: 48,
});

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(finite(a.x) - finite(b.x), finite(a.z) - finite(b.z));
}

function threatScore(actor, input) {
  const direct = clamp(actor?.threatLevel);
  const sensed = clamp(actor?.perception?.threat);
  const proximity = clamp(1 - distance(actor?.position, input?.threatPosition) / LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY.fleeDistanceMeters);
  return Math.round(Math.max(direct, sensed, proximity) * 1000) / 1000;
}

function nextState(actor, input) {
  const current = text(actor?.state, 'roam').toLowerCase();
  const score = threatScore(actor, input);
  if (score >= LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY.fleeThreatThreshold) return 'flee';
  if (current === 'flee' && score < 0.2) return 'roam';
  if (current === 'threat' || score >= 0.2) return 'threat';
  return 'roam';
}

export function planFaunaThreatResponse(input = {}) {
  const actors = Array.isArray(input.actors) ? input.actors.slice(0, LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY.maxActors) : [];
  const transitions = [];
  const seen = new Set();
  for (const actor of actors) {
    const actorId = idOf(actor?.id);
    if (!actorId || seen.has(actorId)) continue;
    seen.add(actorId);
    if (actor?.groundValid === false || actor?.navReachable === false) continue;
    const score = threatScore(actor, input);
    const state = nextState(actor, input);
    transitions.push(freeze({
      kind: 'fauna-threat-response-transition',
      actorId,
      species: text(actor?.species, 'unknown'),
      from: text(actor?.state, 'roam').toLowerCase(),
      to: state,
      threatScore: score,
      action: state === 'flee' ? 'evade-threat' : state === 'threat' ? 'orient-threat' : 'roam',
      execution: 'caller-owned-steering',
      assetFirst: true,
      placement: {
        materialContract: 'src/3d/materials/MaterialAssignmentCore.js',
        placementContract: 'src/3d/world/WorldAssetPlacementPipeline.js',
        missingAssetPolicy: 'skip-and-report',
      },
    }));
  }
  transitions.sort((a, b) => a.actorId.localeCompare(b.actorId));
  return freeze({
    policyId: LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY.id,
    accepted: true,
    transitions: freeze(transitions.slice(0, LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY.maxTransitions)),
    audit: freeze({
      ok: transitions.length <= LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY.maxTransitions,
      inputActors: actors.length,
      transitionCount: Math.min(transitions.length, LIVING_WORLD_FAUNA_THREAT_RESPONSE_POLICY.maxTransitions),
      assetFirst: true,
      sharedMaterialPlacement: true,
    }),
  });
}

export function auditFaunaThreatResponsePlan(plan) {
  if (!plan || plan.accepted !== true) return freeze({ ok: false, reason: 'not-accepted' });
  const transitions = Array.isArray(plan.transitions) ? plan.transitions : [];
  const ids = transitions.map((item) => item.actorId);
  const sorted = [...ids].sort();
  const valid = transitions.every((item) => ['roam', 'threat', 'flee'].includes(item.to) && item.assetFirst === true && item.placement?.missingAssetPolicy === 'skip-and-report');
  return freeze({
    ok: valid && JSON.stringify(ids) === JSON.stringify(sorted) && new Set(ids).size === ids.length,
    validStates: valid,
    sorted: JSON.stringify(ids) === JSON.stringify(sorted),
    uniqueActorIds: new Set(ids).size,
  });
}
