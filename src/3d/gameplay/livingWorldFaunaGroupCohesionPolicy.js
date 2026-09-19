/**
 * Şafak Kartalı — bounded deterministic fauna group-cohesion policy.
 *
 * Pure adapter over caller-owned ambient fauna intents. It derives stable group
 * anchors, spacing bands and social signals without owning transforms, steering,
 * spawning, navigation, combat, factions, world events, THREE, DOM or assets.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const idOf = (value, fallback = '') => String(value ?? fallback).trim() || fallback;
const text = (value, fallback = '') => value == null ? fallback : String(value);

export const LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY = freeze({
  id: 'safak-kartali-fauna-group-cohesion-2026-09-17-v1',
  deterministic: true,
  maxGroups: 16,
  maxMembersPerGroup: 12,
  maxSignals: 16,
  spacing: { tight: 8, normal: 18, loose: 34 },
});

function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(finite(a.x) - finite(b.x), finite(a.z) - finite(b.z));
}

function centroid(members) {
  if (!members.length) return null;
  const totals = members.reduce((acc, member) => {
    acc.x += finite(member.position?.x);
    acc.z += finite(member.position?.z);
    return acc;
  }, { x: 0, z: 0 });
  return { x: totals.x / members.length, z: totals.z / members.length };
}

function spacingFor(members) {
  const distances = [];
  for (let index = 0; index < members.length; index += 1) {
    for (let next = index + 1; next < members.length; next += 1) distances.push(distance(members[index].position, members[next].position));
  }
  if (!distances.length) return 'tight';
  const mean = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  if (mean <= LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.spacing.tight) return 'tight';
  if (mean <= LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.spacing.normal) return 'normal';
  return 'loose';
}

function signalFor(group, anchor) {
  const activity = group.members.map((member) => text(member.activity).toLowerCase());
  const predator = group.members.some((member) => text(member.role).toLowerCase() === 'predator' || text(member.species).toLowerCase().includes('wolf'));
  const dominant = activity.includes('howl') ? 'call-and-response' : activity.includes('drink') ? 'water-check' : activity.includes('rest') ? 'settle' : 'follow-anchor';
  return freeze({
    kind: 'fauna-group-signal',
    groupId: group.groupId,
    signal: dominant,
    predatorGroup: predator,
    anchor,
    memberCount: group.members.length,
  });
}

export function planFaunaGroupCohesion(input = {}) {
  const intents = Array.isArray(input.intents) ? input.intents : [];
  const groups = new Map();
  for (const intent of intents) {
    const actorId = idOf(intent?.actorId);
    if (!actorId) continue;
    const groupId = idOf(intent?.groupId, `solo:${actorId}`);
    if (!groups.has(groupId)) groups.set(groupId, []);
    const members = groups.get(groupId);
    if (members.length < LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.maxMembersPerGroup) members.push(intent);
  }

  const plans = [];
  const signals = [];
  for (const [groupId, members] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const anchor = centroid(members);
    const spacing = spacingFor(members);
    const plan = freeze({
      kind: 'fauna-group-cohesion-plan',
      groupId,
      anchor,
      spacing,
      memberIds: freeze(members.map((member) => member.actorId).sort()),
      habitat: text(members[0]?.habitat, 'unknown'),
      materialPlacement: members.every((member) => member.assetFirst === true && member.placement?.materialContract && member.placement?.placementContract),
      execution: 'caller-owned-steering',
    });
    plans.push(plan);
    if (signals.length < LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.maxSignals) signals.push(signalFor({ groupId, members }, anchor));
  }

  return freeze({
    policyId: LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.id,
    accepted: true,
    groups: freeze(plans.slice(0, LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.maxGroups)),
    signals: freeze(signals),
    audit: freeze({
      ok: plans.every((plan) => plan.materialPlacement === true) && plans.length <= LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.maxGroups,
      inputIntents: intents.length,
      groupCount: Math.min(plans.length, LIVING_WORLD_FAUNA_GROUP_COHESION_POLICY.maxGroups),
      sharedMaterialPlacement: true,
      assetFirst: true,
    }),
  });
}

export function auditFaunaGroupCohesionPlan(plan) {
  if (!plan || plan.accepted !== true) return freeze({ ok: false, reason: 'not-accepted' });
  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  const ids = groups.map((group) => group.groupId);
  const sorted = [...ids].sort();
  const unique = new Set(ids);
  const memberIdsValid = groups.every((group) => JSON.stringify(group.memberIds) === JSON.stringify([...group.memberIds].sort()));
  return freeze({
    ok: unique.size === ids.length && JSON.stringify(ids) === JSON.stringify(sorted) && memberIdsValid && groups.every((group) => group.materialPlacement === true),
    uniqueGroups: unique.size,
    sortedGroups: JSON.stringify(ids) === JSON.stringify(sorted),
    memberIdsValid,
    materialPlacement: groups.every((group) => group.materialPlacement === true),
  });
}
