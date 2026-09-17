/**
 * Deterministic threat-response adapter for the existing fauna population director.
 *
 * This module does not own actor state, navigation, combat, spawning or world events.
 * It translates an existing fauna population plan into bounded response intents that
 * current owners can execute through their existing seams.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value, fallback = '') => value == null ? fallback : String(value);
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));

export const FAUNA_THREAT_RESPONSE_POLICY = freeze({
  id: 'safak-kartali-fauna-threat-response-2026-09-16-v1',
  deterministic: true,
  maxGroups: 10,
  maxMembersPerGroup: 24,
  threatMemorySeconds: 18,
  attackDistanceMeters: 80,
  fleeDistanceMeters: 90,
  returnDistanceMeters: 160,
  responseStates: freeze(['roam', 'investigate', 'stalk', 'attack', 'flee', 'return']),
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

function digest(value) {
  return stableHash(JSON.stringify(value ?? null)).toString(16).padStart(8, '0');
}

function normalizeThreat(threat) {
  if (!threat) return null;
  return {
    id: text(threat.id, 'unknown-threat'),
    kind: text(threat.kind, 'unknown'),
    distanceMeters: Math.max(0, finite(threat.distanceMeters, Infinity)),
    confidence: clamp(threat.confidence, 0, 1),
    visible: threat.visible !== false,
    heard: threat.heard === true,
    hostile: threat.hostile !== false,
    ageSeconds: Math.max(0, finite(threat.ageSeconds, 0)),
  };
}

function chooseState(group, threat) {
  const species = text(group?.species, 'deer').toLowerCase();
  const current = text(group?.state, 'roam').toLowerCase();
  if (!threat || !threat.hostile || threat.ageSeconds > FAUNA_THREAT_RESPONSE_POLICY.threatMemorySeconds) {
    if (current === 'flee' || current === 'attack' || current === 'stalk') return 'return';
    return current === 'spawn' ? 'roam' : current;
  }
  if (species === 'dragon' && threat.distanceMeters <= FAUNA_THREAT_RESPONSE_POLICY.attackDistanceMeters && threat.confidence >= 0.55) return 'attack';
  if (species === 'wolf' && threat.distanceMeters <= FAUNA_THREAT_RESPONSE_POLICY.attackDistanceMeters && threat.confidence >= 0.45) return 'stalk';
  if (threat.distanceMeters <= FAUNA_THREAT_RESPONSE_POLICY.fleeDistanceMeters || threat.heard) return 'flee';
  return 'investigate';
}

function commandFor(state, group, threat) {
  const habitat = group?.habitatId || '';
  const targetId = threat?.id || '';
  if (state === 'attack') return { action: 'attack', targetId, navigation: 'direct', combat: 'delegate-existing-combat' };
  if (state === 'stalk') return { action: 'stalk', targetId, navigation: 'shadow', combat: 'delegate-existing-combat' };
  if (state === 'flee') return { action: 'flee', targetId, navigation: 'away-from-threat', regroup: 'existing-group-anchor' };
  if (state === 'investigate') return { action: 'investigate', targetId, navigation: 'last-known-signal', sensing: 'delegate-existing-perception' };
  if (state === 'return') return { action: 'return', targetId: '', navigation: 'return-to-habitat', habitatId: habitat };
  return { action: 'roam', targetId: '', navigation: 'follow-existing-ecology-directive', habitatId: habitat };
}

export function planFaunaThreatResponses(plan, { maxGroups = FAUNA_THREAT_RESPONSE_POLICY.maxGroups } = {}) {
  const groups = Array.isArray(plan?.groups) ? plan.groups.slice(0, Math.min(FAUNA_THREAT_RESPONSE_POLICY.maxGroups, Math.max(0, Math.floor(finite(maxGroups, FAUNA_THREAT_RESPONSE_POLICY.maxGroups)))) ) : [];
  const responses = groups.map((group) => {
    const threat = normalizeThreat(group?.threat || (group?.threatId ? { id: group.threatId, distanceMeters: Infinity, confidence: 0 } : null));
    const state = chooseState(group, threat);
    const memberCount = Math.min(FAUNA_THREAT_RESPONSE_POLICY.maxMembersPerGroup, Math.max(0, Math.floor(finite(group?.count, Array.isArray(group?.members) ? group.members.length : 0))));
    return freeze({
      groupId: text(group?.groupId, 'unknown-group'),
      species: text(group?.species, 'unknown'),
      habitatId: text(group?.habitatId, ''),
      state,
      threatId: threat?.id || '',
      memberCount,
      command: freeze(commandFor(state, group, threat)),
      bounded: memberCount <= FAUNA_THREAT_RESPONSE_POLICY.maxMembersPerGroup,
    });
  });
  const counts = responses.reduce((acc, row) => { acc[row.state] = (acc[row.state] || 0) + 1; return acc; }, {});
  const result = { policy: FAUNA_THREAT_RESPONSE_POLICY.id, deterministic: true, responses: freeze(responses), counts: freeze(counts) };
  return freeze({ ...result, digest: digest(result) });
}

export function auditFaunaThreatResponses(result) {
  const errors = [];
  if (!result || result.deterministic !== true) errors.push('non-deterministic-result');
  if ((result?.responses || []).length > FAUNA_THREAT_RESPONSE_POLICY.maxGroups) errors.push('group-budget-overflow');
  for (const response of result?.responses || []) {
    if (!FAUNA_THREAT_RESPONSE_POLICY.responseStates.includes(response.state)) errors.push(`invalid-state:${response.groupId}`);
    if (!response.bounded) errors.push(`member-budget:${response.groupId}`);
    if (!response.command?.action) errors.push(`missing-command:${response.groupId}`);
  }
  return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: digest(result) });
}
