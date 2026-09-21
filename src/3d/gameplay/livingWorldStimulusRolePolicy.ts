// @ts-nocheck
/**
 * Role/capability profile for stimulus orchestration.
 *
 * Provides archetype tuning without introducing a second AI state machine. Existing faction/fauna/
 * NPC systems supply role metadata and remain responsible for actual behavior execution.
 */

const freeze = Object.freeze;
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

export const LIVING_WORLD_ROLE_PROFILES = freeze({
  civilian: freeze({ weights: freeze({ flee: 1.25, seekShelter: 1.2, socialize: 1.15, attack: 0.35, investigate: 0.75 }), confidenceBias: -0.02, caution: 0.85 }),
  guard: freeze({ weights: freeze({ defend: 1.35, alert: 1.25, pursue: 1.1, attack: 1.05, flee: 0.55 }), confidenceBias: 0.08, caution: 0.35 }),
  hunter: freeze({ weights: freeze({ pursue: 1.3, attack: 1.2, investigate: 1.1, gather: 1.1, flee: 0.65 }), confidenceBias: 0.05, caution: 0.42 }),
  predator: freeze({ weights: freeze({ pursue: 1.35, attack: 1.3, flee: 0.45, regroup: 0.9, recover: 0.85 }), confidenceBias: 0.09, caution: 0.28 }),
  prey: freeze({ weights: freeze({ flee: 1.45, seekShelter: 1.35, alert: 1.15, regroup: 1.1, attack: 0.2 }), confidenceBias: -0.01, caution: 0.92 }),
  merchant: freeze({ weights: freeze({ socialize: 1.35, gather: 1.05, retreat: 0.8, seekShelter: 0.9, attack: 0.25 }), confidenceBias: 0, caution: 0.72 }),
  traveler: freeze({ weights: freeze({ investigate: 1.15, patrol: 1.05, search: 1.1, flee: 0.8, socialize: 0.95 }), confidenceBias: 0.01, caution: 0.58 }),
  healer: freeze({ weights: freeze({ assist: 1.45, recover: 1.25, retreat: 0.9, defend: 0.95, attack: 0.3 }), confidenceBias: 0.02, caution: 0.65 }),
  beast: freeze({ weights: freeze({ observe: 1.05, pursue: 1.05, attack: 0.9, flee: 0.8, gather: 1.15 }), confidenceBias: 0.01, caution: 0.5 }),
  unknown: freeze({ weights: freeze({ observe: 1.1, alert: 1.0, flee: 0.9, investigate: 0.85 }), confidenceBias: -0.04, caution: 0.7 }),
});

export const LIVING_WORLD_STIMULUS_ROLE_POLICY = freeze({
  id: 'living-world-stimulus-role-policy-2026-09-v1',
  maxRoleLength: 32,
  minWeight: 0.1,
  maxWeight: 2.5,
});

export function getLivingWorldRoleProfile(role) {
  const key = String(role || 'unknown').toLowerCase().slice(0, LIVING_WORLD_STIMULUS_ROLE_POLICY.maxRoleLength);
  return LIVING_WORLD_ROLE_PROFILES[key] || LIVING_WORLD_ROLE_PROFILES.unknown;
}

export function applyRoleTuningToIntentScores(scored = [], role = 'unknown') {
  const profile = getLivingWorldRoleProfile(role);
  if (!Array.isArray(scored)) return freeze([]);
  const result = scored.map((entry) => {
    const weight = clamp(profile.weights[entry.intent], LIVING_WORLD_STIMULUS_ROLE_POLICY.minWeight, LIVING_WORLD_STIMULUS_ROLE_POLICY.maxWeight);
    const tuned = entry.score * weight + profile.confidenceBias;
    return freeze({ ...entry, roleWeight: weight, score: tuned });
  });
  result.sort((a, b) => (b.score - a.score) || String(a.intent).localeCompare(String(b.intent)));
  return freeze(result);
}

export function roleCaution(role = 'unknown') {
  return getLivingWorldRoleProfile(role).caution;
}
