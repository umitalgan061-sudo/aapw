/**
 * Bounded group-AI policy for existing NPC/fauna/creature controllers.
 *
 * This module computes shared intent, cohesion and threat summaries but never mutates
 * controllers, spawns members, performs navigation, owns combat or stores faction state.
 * Existing pack/herd callers can consume the result without creating another AI framework.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const MAX_MEMBERS = 32;
const DEFAULT_COHESION_RADIUS = 28;

export const LIVING_WORLD_GROUP_AI_POLICY = freeze({
	id: 'living-world-group-ai-policy-2026-09-08-v1',
	maxMembers: MAX_MEMBERS,
	defaultCohesionRadiusMeters: DEFAULT_COHESION_RADIUS,
	maxLeaderDistanceMeters: 80,
	defaultSeparationMeters: 2,
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

function readMember(member, index) {
	const object3D = member?.object3D ?? member?.model ?? member;
	const x = Number(object3D?.position?.x ?? member?.x);
	const z = Number(object3D?.position?.z ?? member?.z);
	const id = String(member?.id ?? object3D?.uuid ?? object3D?.name ?? `member-${index}`);
	return {
		index,
		id,
		x,
		z,
		valid: Number.isFinite(x) && Number.isFinite(z),
		fleeing: Boolean(member?.isFleeing ?? object3D?.userData?.wildlifeFlee?.direct),
		state: String(member?.state ?? member?.currentState ?? object3D?.userData?.npcPerception?.intent ?? object3D?.userData?.wildlifeFlee?.phase ?? 'unknown'),
		priority: finite(member?.priority ?? object3D?.userData?.factionPriority, 0),
	};
}

export function selectGroupLeader(members = [], seed = 0) {
	const normalized = Array.isArray(members) ? members.slice(0, MAX_MEMBERS).map(readMember).filter((member) => member.valid) : [];
	if (!normalized.length) return null;
	normalized.sort((a, b) => b.priority - a.priority || stableHash(`${seed}:${a.id}`) - stableHash(`${seed}:${b.id}`) || a.id.localeCompare(b.id));
	return freeze({ id: normalized[0].id, index: normalized[0].index, x: normalized[0].x, z: normalized[0].z });
}

export function computeGroupCenter(members = []) {
	const normalized = Array.isArray(members) ? members.slice(0, MAX_MEMBERS).map(readMember).filter((member) => member.valid) : [];
	if (!normalized.length) return null;
	let x = 0;
	let z = 0;
	for (const member of normalized) {
		x += member.x;
		z += member.z;
	}
	return freeze({ x: x / normalized.length, z: z / normalized.length, count: normalized.length });
}

export function evaluateGroupCohesion(members = [], { cohesionRadiusMeters = DEFAULT_COHESION_RADIUS, leaderId = null } = {}) {
	const normalized = Array.isArray(members) ? members.slice(0, MAX_MEMBERS).map(readMember).filter((member) => member.valid) : [];
	if (!normalized.length) return freeze({ accepted: false, reason: 'empty-group', spreadMeters: Infinity, cohesionRatio: 0, outliers: freeze([]) });
	const center = computeGroupCenter(normalized);
	const radius = Math.max(1, finite(cohesionRadiusMeters, DEFAULT_COHESION_RADIUS));
	const outliers = normalized.filter((member) => Math.hypot(member.x - center.x, member.z - center.z) > radius).map((member) => member.id).sort();
	const cohesionRatio = clamp(1 - outliers.length / normalized.length);
	const leader = leaderId ? normalized.find((member) => member.id === String(leaderId)) : normalized[0];
	const leaderDistance = leader ? Math.hypot(leader.x - center.x, leader.z - center.z) : Infinity;
	return freeze({
		accepted: normalized.length >= 1 && cohesionRatio >= 0.5,
		reason: outliers.length ? 'outliers' : 'cohesive',
		spreadMeters: Number(Math.max(...normalized.map((member) => Math.hypot(member.x - center.x, member.z - center.z))).toFixed(4)),
		cohesionRatio: Number(cohesionRatio.toFixed(4)),
		outliers: freeze(outliers),
		leaderDistanceMeters: Number.isFinite(leaderDistance) ? Number(leaderDistance.toFixed(4)) : Infinity,
	});
}

export function summarizeGroupThreat(members = [], threatPositions = [], { threatRadiusMeters = 35 } = {}) {
	const normalized = Array.isArray(members) ? members.slice(0, MAX_MEMBERS).map(readMember).filter((member) => member.valid) : [];
	const normalizedThreats = Array.isArray(threatPositions) ? threatPositions.slice(0, MAX_MEMBERS).map((position, index) => ({
		index,
		x: finite(position?.x),
		z: finite(position?.z),
	})).filter((position) => Number.isFinite(position.x) && Number.isFinite(position.z)) : [];
	const radius = Math.max(1, finite(threatRadiusMeters, 35));
	let threatenedMembers = 0;
	let fleeingMembers = 0;
	let nearestDistance = Infinity;
	for (const member of normalized) {
		if (member.fleeing) fleeingMembers += 1;
		let nearest = Infinity;
		for (const threat of normalizedThreats) nearest = Math.min(nearest, Math.hypot(member.x - threat.x, member.z - threat.z));
		if (nearest <= radius) threatenedMembers += 1;
		nearestDistance = Math.min(nearestDistance, nearest);
	}
	const threatRatio = normalized.length ? threatenedMembers / normalized.length : 0;
	const groupIntent = fleeingMembers > 0 || threatRatio >= 0.67 ? 'flee' : threatRatio > 0 ? 'investigate' : 'roam';
	return freeze({
		groupIntent,
		threatRatio: Number(threatRatio.toFixed(4)),
		threatenedMembers,
		fleeingMembers,
		nearestThreatDistanceMeters: Number.isFinite(nearestDistance) ? Number(nearestDistance.toFixed(4)) : Infinity,
	});
}

export function buildGroupFormationTargets(members = [], { leaderId = null, separationMeters = DEFAULT_SEPARATION_METERS, seed = 0 } = {}) {
	const normalized = Array.isArray(members) ? members.slice(0, MAX_MEMBERS).map(readMember).filter((member) => member.valid) : [];
	if (!normalized.length) return freeze([]);
	const leader = normalized.find((member) => member.id === String(leaderId)) ?? selectGroupLeader(normalized, seed);
	if (!leader) return freeze([]);
	const followers = normalized.filter((member) => member.id !== leader.id).sort((a, b) => a.id.localeCompare(b.id));
	const radius = Math.max(0.75, finite(separationMeters, DEFAULT_SEPARATION_METERS));
	return freeze(followers.map((member, index) => {
		const slot = index + 1;
		const ring = Math.ceil(Math.sqrt(slot));
		const angle = (stableHash(`${seed}:${leader.id}:${member.id}`) / 0x100000000) * Math.PI * 2;
		const radial = Math.max(radius, ring * radius);
		return freeze({
			id: member.id,
			targetX: Number((leader.x + Math.cos(angle) * radial).toFixed(4)),
			targetZ: Number((leader.z + Math.sin(angle) * radial).toFixed(4)),
			index,
		});
	}));
}

export function auditGroupAiPolicy({ members = [], cohesion = null, threat = null, formation = null } = {}) {
	const errors = [];
	if (Array.isArray(members) && members.length > MAX_MEMBERS) errors.push('member-overflow');
	if (cohesion && !Number.isFinite(cohesion.cohesionRatio)) errors.push('invalid-cohesion');
	if (threat && !['roam', 'investigate', 'flee'].includes(threat.groupIntent)) errors.push('invalid-threat-intent');
	if (Array.isArray(formation) && formation.length > Math.max(0, (members?.length ?? 0) - 1)) errors.push('formation-overflow');
	return freeze({ ok: errors.length === 0, errors: freeze(errors), memberCount: Array.isArray(members) ? Math.min(members.length, MAX_MEMBERS) : 0 });
}
