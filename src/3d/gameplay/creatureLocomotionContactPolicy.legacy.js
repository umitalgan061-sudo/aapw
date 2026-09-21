/**
 * Contact/traversal policy adapter for creature locomotion synthesis.
 * Converts caller-owned collision/surface probes into bounded semantic cues.
 * No raycasts or physics calls are made here; this file only normalizes supplied probe results.
 */

function n(value, fallback = 0) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, n(value, min))); }
function clamp01(value) { return clamp(value, 0, 1); }
function bool(value, fallback = false) { return typeof value === 'boolean' ? value : fallback; }
function round(value, digits = 4) { const factor = 10 ** digits; const result = Math.round(n(value) * factor) / factor; return Object.is(result, -0) ? 0 : result; }
function freeze(value) { return Object.freeze(value); }

export const CREATURE_CONTACT_POLICY_VERSION = '2026-09-15-v1';

export const CREATURE_CONTACT_FLAGS = Object.freeze([
  'grounded',
  'stable',
  'slippery',
  'steep',
  'blocked',
  'landing',
  'hardLanding',
  'airborne',
]);

export function normalizeCreatureContactProbe(probe = {}) {
  const normal = probe.normal && typeof probe.normal === 'object' ? probe.normal : {};
  const forward = probe.forward && typeof probe.forward === 'object' ? probe.forward : {};
  return freeze({
    grounded: bool(probe.grounded, true),
    normalConfidence: clamp01(probe.normalConfidence ?? probe.confidence ?? 1),
    surfaceConfidence: clamp01(probe.surfaceConfidence ?? probe.confidence ?? 1),
    slip: clamp01(probe.slip),
    slopeDegrees: clamp(n(probe.slopeDegrees, n(probe.slope)), -75, 75),
    forwardDistance: clamp(Math.abs(n(probe.forwardDistance, n(forward.distance))), 0, 20),
    forwardHeight: clamp(n(probe.forwardHeight, n(forward.height)), -5, 5),
    forwardBlocked: bool(probe.forwardBlocked, false),
    impactMps: clamp(Math.abs(n(probe.impactMps)), 0, 20),
    airTimeSeconds: clamp(Math.abs(n(probe.airTimeSeconds)), 0, 30),
    normalY: clamp(n(probe.normalY, normal.y), -1, 1),
  });
}

export function resolveCreatureContactFlags(probe = {}) {
  const value = normalizeCreatureContactProbe(probe);
  const steep = Math.abs(value.slopeDegrees) >= 35;
  const stable = value.normalConfidence >= 0.55 && value.surfaceConfidence >= 0.55 && value.slip < 0.65;
  return freeze({
    grounded: value.grounded,
    stable,
    slippery: value.slip >= 0.65,
    steep,
    blocked: value.forwardBlocked || (value.forwardDistance < 0.75 && value.forwardHeight > -0.25),
    landing: value.grounded && value.airTimeSeconds > 0.05 && value.impactMps >= 1,
    hardLanding: value.grounded && value.airTimeSeconds > 0.05 && value.impactMps >= 5,
    airborne: !value.grounded,
  });
}

export function resolveCreatureSurfaceResponse(probe = {}) {
  const value = normalizeCreatureContactProbe(probe);
  const flags = resolveCreatureContactFlags(value);
  const traction = clamp01(value.surfaceConfidence * (1 - value.slip * 0.75));
  const support = clamp01(value.normalConfidence * (value.grounded ? 1 : 0.82));
  const instability = clamp01(1 - traction * 0.7 - support * 0.3);
  return freeze({
    traction: round(traction),
    support: round(support),
    instability: round(instability),
    speedScale: round(clamp01(0.55 + traction * 0.45)),
    turnScale: round(clamp01(0.4 + traction * 0.6)),
    flags,
  });
}

export function resolveCreatureTraversalCue(probe = {}) {
  const value = normalizeCreatureContactProbe(probe);
  const blocked = value.forwardBlocked || value.forwardDistance < 0.75;
  const climbable = !blocked && value.forwardDistance <= 3 && value.forwardHeight >= 0 && value.forwardHeight <= 1.8;
  const drop = !blocked && value.forwardHeight < -0.8;
  const weight = clamp01((3 - value.forwardDistance) / 3);
  return freeze({
    blocked,
    climbable,
    drop,
    weight: round(weight),
    forwardDistance: round(value.forwardDistance),
    forwardHeight: round(value.forwardHeight),
  });
}

export function buildCreatureContactLocomotionInput(baseInput = {}, probe = {}) {
  const value = normalizeCreatureContactProbe(probe);
  const flags = resolveCreatureContactFlags(value);
  const surface = resolveCreatureSurfaceResponse(value);
  const traversal = resolveCreatureTraversalCue(value);
  return freeze({
    ...baseInput,
    grounded: flags.grounded,
    groundNormalConfidence: value.normalConfidence,
    surfaceConfidence: value.surfaceConfidence,
    surfaceSlip: value.slip,
    impactMps: value.impactMps,
    airTimeSeconds: value.airTimeSeconds,
    traversalBlocked: traversal.blocked,
    traversalWeight: traversal.weight,
    traversalForwardDistance: traversal.forwardDistance,
    traversalHeight: traversal.forwardHeight,
    contactFlags: flags,
    contactResponse: surface,
  });
}

export function evaluateCreatureContactRisk(probe = {}) {
  const value = normalizeCreatureContactProbe(probe);
  const flags = resolveCreatureContactFlags(value);
  let score = 0;
  score += (1 - value.normalConfidence) * 0.2;
  score += (1 - value.surfaceConfidence) * 0.2;
  score += value.slip * 0.25;
  score += Math.min(1, Math.abs(value.slopeDegrees) / 60) * 0.15;
  score += flags.blocked ? 0.1 : 0;
  score += flags.hardLanding ? 0.1 : 0;
  return freeze({ score: round(clamp01(score)), severity: score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low' });
}

export function projectCreatureContactPolicy(probe = {}) {
  const value = normalizeCreatureContactProbe(probe);
  const surface = resolveCreatureSurfaceResponse(value);
  const traversal = resolveCreatureTraversalCue(value);
  const risk = evaluateCreatureContactRisk(value);
  return freeze({
    version: CREATURE_CONTACT_POLICY_VERSION,
    grounded: value.grounded,
    surface,
    traversal,
    risk,
    animation: freeze({
      strideScale: surface.speedScale,
      turnScale: surface.turnScale,
      contactConfidence: round(surface.support),
      impactWeight: round(clamp01(value.impactMps / 8)),
    }),
  });
}

export function compareCreatureContactProbes(left, right) {
  const a = projectCreatureContactPolicy(left);
  const b = projectCreatureContactPolicy(right);
  return freeze({
    tractionDelta: round(b.surface.traction - a.surface.traction),
    supportDelta: round(b.surface.support - a.surface.support),
    instabilityDelta: round(b.surface.instability - a.surface.instability),
    riskDelta: round(b.risk.score - a.risk.score),
    traversalChanged: JSON.stringify(a.traversal) !== JSON.stringify(b.traversal),
  });
}

export function serializeCreatureContactPolicy(probe = {}) {
  return JSON.stringify(projectCreatureContactPolicy(probe));
}

export function deserializeCreatureContactPolicy(serialized) {
  return typeof serialized === 'string' ? JSON.parse(serialized) : serialized || projectCreatureContactPolicy();
}
