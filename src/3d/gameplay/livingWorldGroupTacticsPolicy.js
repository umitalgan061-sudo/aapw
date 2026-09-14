/**
 * Şafak Kartalı — group tactics projection for the repository's existing group director.
 *
 * Pure planning only: the existing group director owns group lifecycle and controller updates.
 * This policy supplies deterministic leader/focus/formation/retreat/protection decisions.
 */

const freeze = Object.freeze;
const numberValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, numberValue(value, min)));
const stringId = (value, fallback = '') => value == null || value === '' ? fallback : String(value);

export const GROUP_TACTICS_POLICY = freeze({
  id: 'safak-kartali-group-tactics-2026-09-14-v2',
  deterministic: true,
  maxGroups: 24,
  maxMembers: 32,
  maxThreats: 16,
  maxFormationColumns: 3,
  retreatHealth: 0.28,
  protectRadiusMeters: 18,
  cohesionMeters: 16,
  flankDistanceMeters: 8,
});

export const GROUP_INTENTS = freeze([
  'patrol',
  'investigate',
  'engage',
  'focus-fire',
  'pursue',
  'protect-civilians',
  'regroup',
  'retreat',
]);

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function positionOf(value) {
  const position = value?.object3D?.position ?? value?.position ?? value?.transform?.position;
  if (!position) return null;
  const x = numberValue(position.x, NaN);
  const z = numberValue(position.z, NaN);
  return Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

function distance2d(left, right) {
  if (!left || !right) return Infinity;
  return Math.hypot(left.x - right.x, left.z - right.z);
}

function memberId(member, index = 0) {
  return stringId(member?.id ?? member?.actorId ?? member?.object3D?.uuid, `member-${index}`);
}

export function normalizeGroup(group = {}, index = 0) {
  const sourceMembers = Array.isArray(group.members) ? group.members : [];
  const members = sourceMembers.slice(0, GROUP_TACTICS_POLICY.maxMembers).map((member, memberIndex) => ({
    ...member,
    id: memberId(member, memberIndex),
    health: numberValue(member?.health, 100),
    role: stringId(member?.role, 'fighter'),
    leadership: clamp(member?.leadership, 0, 1),
    veteran: Boolean(member?.veteran),
  }));
  const civilianIds = Array.isArray(group.civilianIds)
    ? group.civilianIds.slice(0, 16).map(String)
    : [];
  const threatPositions = Array.isArray(group.threatPositions)
    ? group.threatPositions.slice(0, GROUP_TACTICS_POLICY.maxThreats)
    : [];
  return freeze({
    id: stringId(group.id, `group-${index}`),
    members: freeze(members),
    leaderId: stringId(group.leaderId),
    threatPositions: freeze(threatPositions),
    formation: stringId(group.formation, 'wedge'),
    cohesionMeters: Math.max(4, numberValue(group.cohesionMeters, GROUP_TACTICS_POLICY.cohesionMeters)),
    civilianIds: freeze(civilianIds),
    seed: group.seed ?? index,
  });
}

export function chooseLeader(group) {
  const normalized = normalizeGroup(group);
  const ranked = normalized.members
    .map((member, index) => ({
      member,
      index,
      score: clamp(member.leadership)
        + (member.id === normalized.leaderId ? 0.2 : 0)
        + clamp(numberValue(member.health, 100) / 100) * 0.2
        + (member.veteran ? 0.1 : 0),
    }))
    .sort((left, right) => right.score - left.score || left.member.id.localeCompare(right.member.id));
  return ranked[0]?.member ?? null;
}

export function threatWeight(threat = {}, member = {}) {
  const severity = clamp(threat.severity);
  const distancePenalty = Number.isFinite(Number(threat.distanceMeters))
    ? Math.min(0.18, Math.max(0, Number(threat.distanceMeters)) / 100 * 0.18)
    : 0;
  const groupTargetBoost = threat.targetingGroup ? 0.2 : 0;
  const heroBoost = threat.hero ? 0.12 : 0;
  const roleBoost = member?.role === 'archer' ? 0.05 : member?.role === 'scout' ? 0.03 : 0;
  return clamp(severity * 0.5 + groupTargetBoost + heroBoost + roleBoost - distancePenalty);
}

export function selectFocusThreat(group, threats = []) {
  const normalized = normalizeGroup(group);
  const primaryMember = normalized.members[0] ?? {};
  const rows = (Array.isArray(threats) ? threats : [])
    .slice(0, GROUP_TACTICS_POLICY.maxThreats)
    .map((threat, index) => {
      const nearGroupAnchor = normalized.threatPositions.some(
        (position) => distance2d(position, positionOf(threat)) <= 30,
      );
      return {
        threat,
        index,
        score: clamp(threatWeight(threat, primaryMember) + (nearGroupAnchor ? 0.1 : 0)),
      };
    })
    .sort((left, right) => right.score - left.score || stringId(left.threat?.id, String(left.index)).localeCompare(stringId(right.threat?.id, String(right.index))));
  return rows[0] ? freeze(rows[0]) : null;
}

export function buildFormationSlots(group, origin = { x: 0, z: 0 }, headingRadians = 0) {
  const normalized = normalizeGroup(group);
  const slots = [];
  const spacing = normalized.cohesionMeters;
  const cos = Math.cos(numberValue(headingRadians));
  const sin = Math.sin(numberValue(headingRadians));
  for (let index = 0; index < normalized.members.length; index += 1) {
    const row = Math.floor(index / GROUP_TACTICS_POLICY.maxFormationColumns);
    const column = (index % GROUP_TACTICS_POLICY.maxFormationColumns) - 1;
    const longitudinal = row * spacing;
    const lateral = column * spacing * 0.75;
    slots.push(freeze({
      memberId: normalized.members[index].id,
      x: origin.x + cos * longitudinal - sin * lateral,
      z: origin.z + sin * longitudinal + cos * lateral,
      row,
      column,
      formation: normalized.formation,
    }));
  }
  return freeze(slots);
}

export function cohesionScore(group) {
  const normalized = normalizeGroup(group);
  const positions = normalized.members.map(positionOf).filter(Boolean);
  if (positions.length < 2) return 1;
  let totalDistance = 0;
  let pairCount = 0;
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      totalDistance += distance2d(positions[left], positions[right]);
      pairCount += 1;
    }
  }
  return clamp(1 - totalDistance / Math.max(1, pairCount) / (normalized.cohesionMeters * 2));
}

export function chooseTacticalIntent(group, context = {}) {
  const normalized = normalizeGroup(group);
  const leader = chooseLeader(normalized);
  const focus = selectFocusThreat(normalized, context.threats);
  const averageHealth = normalized.members.length
    ? normalized.members.reduce((sum, member) => sum + clamp(numberValue(member.health, 100) / 100), 0) / normalized.members.length
    : 1;
  const civilians = normalized.civilianIds.length;
  if (averageHealth <= GROUP_TACTICS_POLICY.retreatHealth) {
    return freeze({ intent: 'retreat', reason: 'low-group-health', leaderId: leader?.id ?? '' });
  }
  if (context.civilianThreat && civilians) {
    return freeze({
      intent: 'protect-civilians',
      reason: 'civilian-threat',
      leaderId: leader?.id ?? '',
      focusTargetId: focus?.threat?.id ?? '',
    });
  }
  if (focus?.threat) {
    if (focus.threat.fleeing) {
      return freeze({ intent: 'pursue', reason: 'fleeing-threat', leaderId: leader?.id ?? '', focusTargetId: focus.threat.id });
    }
    if (focus.score >= 0.62) {
      return freeze({
        intent: context.rangedAdvantage ? 'focus-fire' : 'engage',
        reason: 'high-threat',
        leaderId: leader?.id ?? '',
        focusTargetId: focus.threat.id,
      });
    }
    return freeze({ intent: 'investigate', reason: 'uncertain-threat', leaderId: leader?.id ?? '', focusTargetId: focus.threat.id });
  }
  const cohesion = cohesionScore(normalized);
  return freeze({
    intent: cohesion < 0.45 ? 'regroup' : 'patrol',
    reason: cohesion < 0.45 ? 'poor-cohesion' : 'no-threat',
    leaderId: leader?.id ?? '',
  });
}

export function memberIntent(member, groupIntent, focusTargetId = '') {
  const id = memberId(member);
  const role = stringId(member?.role, 'fighter');
  const lowHealth = numberValue(member?.health, 100) < 30;
  switch (groupIntent) {
    case 'retreat':
      return freeze({ memberId: id, action: 'flee', speedMultiplier: 1.25 });
    case 'protect-civilians':
      return freeze({ memberId: id, action: role === 'guard' ? 'interpose' : 'cover', targetId: focusTargetId });
    case 'focus-fire':
      return freeze({ memberId: id, action: role === 'archer' ? 'ranged-focus' : lowHealth ? 'hold' : 'close-focus', targetId: focusTargetId });
    case 'pursue':
      return freeze({ memberId: id, action: lowHealth ? 'shadow' : 'pursue', targetId: focusTargetId });
    case 'regroup':
      return freeze({ memberId: id, action: 'close-rank' });
    case 'investigate':
      return freeze({ memberId: id, action: role === 'scout' ? 'scout' : 'cover', targetId: focusTargetId });
    case 'engage':
      return freeze({ memberId: id, action: lowHealth ? 'support' : role === 'archer' ? 'ranged-engage' : 'engage', targetId: focusTargetId });
    default:
      return freeze({ memberId: id, action: 'hold-formation' });
  }
}

export function buildGroupTacticalSnapshot(group, context = {}) {
  const normalized = normalizeGroup(group);
  const tactical = chooseTacticalIntent(normalized, context);
  const intents = normalized.members.map((member) => memberIntent(member, tactical.intent, tactical.focusTargetId));
  return freeze({
    groupId: normalized.id,
    leaderId: tactical.leaderId,
    intent: tactical.intent,
    reason: tactical.reason,
    focusTargetId: tactical.focusTargetId ?? '',
    cohesion: cohesionScore(normalized),
    memberIntents: freeze(intents),
    memberCount: normalized.members.length,
  });
}

export function protectCivilianDecision(group, civilianPosition, threats = []) {
  const normalized = normalizeGroup(group);
  const nearestGuard = normalized.members
    .map((member, index) => ({ id: memberId(member, index), role: member.role, distance: distance2d(positionOf(member), civilianPosition) }))
    .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))[0];
  const nearestThreat = (Array.isArray(threats) ? threats : [])
    .map((threat) => ({ id: stringId(threat?.id), distance: distance2d(positionOf(threat), civilianPosition), severity: clamp(threat?.severity) }))
    .sort((left, right) => right.severity - left.severity || left.distance - right.distance)[0];
  return freeze({
    guardId: nearestGuard?.id ?? '',
    intercept: Boolean(nearestThreat && nearestThreat.distance < GROUP_TACTICS_POLICY.protectRadiusMeters),
    threatId: nearestThreat?.id ?? '',
    threatSeverity: nearestThreat?.severity ?? 0,
  });
}

export function retreatDestination(group, safePositions = []) {
  const normalized = normalizeGroup(group);
  const positions = normalized.members.map(positionOf).filter(Boolean);
  const centroid = positions.reduce((sum, position) => ({ x: sum.x + position.x, z: sum.z + position.z }), { x: 0, z: 0 });
  const count = Math.max(1, positions.length);
  const center = { x: centroid.x / count, z: centroid.z / count };
  const candidates = (Array.isArray(safePositions) ? safePositions : [])
    .map((position, index) => ({ position, index, score: distance2d(position, center) }))
    .sort((left, right) => left.score - right.score || left.index - right.index);
  return candidates[0]?.position ?? center;
}

export function tacticalFingerprint(snapshot, seed = 0) {
  return stableHash(`${seed}|${JSON.stringify(snapshot ?? null)}`).toString(16).padStart(8, '0');
}

export function auditTacticalSnapshot(snapshot) {
  const errors = [];
  if (!snapshot?.groupId) errors.push('missing-group');
  if (numberValue(snapshot?.memberCount) > GROUP_TACTICS_POLICY.maxMembers) errors.push('member-overflow');
  if (!GROUP_INTENTS.includes(snapshot?.intent)) errors.push('intent');
  if (numberValue(snapshot?.cohesion) < 0 || numberValue(snapshot?.cohesion) > 1) errors.push('cohesion-range');
  return freeze({ ok: errors.length === 0, errors: freeze(errors), fingerprint: tacticalFingerprint(snapshot) });
}

export function buildFlankPositions(group, focusPosition, headingRadians = 0) {
  const normalized = normalizeGroup(group);
  const cos = Math.cos(numberValue(headingRadians));
  const sin = Math.sin(numberValue(headingRadians));
  return freeze([
    freeze({ memberId: normalized.members[0]?.id ?? '', x: focusPosition.x + cos * GROUP_TACTICS_POLICY.flankDistanceMeters, z: focusPosition.z + sin * GROUP_TACTICS_POLICY.flankDistanceMeters, side: 'left' }),
    freeze({ memberId: normalized.members[1]?.id ?? '', x: focusPosition.x - cos * GROUP_TACTICS_POLICY.flankDistanceMeters, z: focusPosition.z - sin * GROUP_TACTICS_POLICY.flankDistanceMeters, side: 'right' }),
  ]);
}

export function combatReadiness(group) {
  const normalized = normalizeGroup(group);
  if (!normalized.members.length) return 0;
  const health = normalized.members.reduce((sum, member) => sum + clamp(numberValue(member.health, 100) / 100), 0) / normalized.members.length;
  const veteranRatio = normalized.members.filter((member) => member.veteran).length / normalized.members.length;
  const cohesion = cohesionScore(normalized);
  return clamp(health * 0.55 + veteranRatio * 0.15 + cohesion * 0.3);
}

export function shouldBreakPursuit(group, context = {}) {
  const normalized = normalizeGroup(group);
  const readiness = combatReadiness(normalized);
  const distance = numberValue(context.distanceToTarget, Infinity);
  if (readiness < GROUP_TACTICS_POLICY.retreatHealth) return true;
  if (context.targetInsideSafeZone === true && distance > 24) return true;
  if (context.navigationBlocked === true) return true;
  return Boolean(context.pursuitTimeout && numberValue(context.elapsedSeconds) > numberValue(context.maxPursuitSeconds, 18));
}

export function deterministicGroupOrder(groups, seed = 0) {
  return freeze((Array.isArray(groups) ? groups : [])
    .slice(0, GROUP_TACTICS_POLICY.maxGroups)
    .map((group, index) => ({ id: normalizeGroup(group, index).id, key: stableHash(`${seed}|${group?.id ?? index}`) }))
    .sort((left, right) => left.key - right.key || left.id.localeCompare(right.id))
    .map((entry) => entry.id));
}
