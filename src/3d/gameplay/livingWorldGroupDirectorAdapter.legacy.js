/**
 * Thin group-AI runtime adapter for existing NPC/fauna/creature groups.
 *
 * It observes the current member controllers and returns a deterministic group directive.
 * It does not mutate controller state, run navigation, spawn members, own combat, persist
 * events or replace the existing animals/creature/NPC systems.
 */

import {
	auditGroupAiPolicy,
	buildGroupFormationTargets,
	computeGroupCenter,
	evaluateGroupCohesion,
	selectGroupLeader,
	summarizeGroupThreat,
} from './livingWorldGroupAiPolicy.js';

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const MAX_GROUPS = 24;
const MAX_MEMBERS = 32;

export const LIVING_WORLD_GROUP_DIRECTOR_POLICY = freeze({
	id: 'living-world-group-director-adapter-2026-09-08-v1',
	maxGroups: MAX_GROUPS,
	maxMembers: MAX_MEMBERS,
	maxThreatPositions: MAX_MEMBERS,
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

function normalizeGroupRequest(request, index) {
	return {
		id: request?.id == null ? `group-${index}` : String(request.id),
		members: Array.isArray(request?.members) ? request.members.slice(0, MAX_MEMBERS) : [],
		threatPositions: Array.isArray(request?.threatPositions) ? request.threatPositions.slice(0, MAX_MEMBERS) : [],
		seed: request?.seed == null ? `${index}` : request.seed,
		leaderId: request?.leaderId == null ? null : String(request.leaderId),
		cohesionRadiusMeters: Math.max(1, Math.min(120, finite(request?.cohesionRadiusMeters, 28))),
		threatRadiusMeters: Math.max(1, Math.min(120, finite(request?.threatRadiusMeters, 35))),
		separationMeters: Math.max(0.75, Math.min(20, finite(request?.separationMeters, 2))),
	};
}

export function buildGroupDirective(request = {}, index = 0) {
	const normalized = normalizeGroupRequest(request, index);
	const leader = selectGroupLeader(normalized.members, normalized.seed);
	const effectiveLeaderId = normalized.leaderId ?? leader?.id ?? null;
	const center = computeGroupCenter(normalized.members);
	const cohesion = evaluateGroupCohesion(normalized.members, {
		cohesionRadiusMeters: normalized.cohesionRadiusMeters,
		leaderId: effectiveLeaderId,
	});
	const threat = summarizeGroupThreat(normalized.members, normalized.threatPositions, {
		threatRadiusMeters: normalized.threatRadiusMeters,
	});
	const formation = buildGroupFormationTargets(normalized.members, {
		leaderId: effectiveLeaderId,
		separationMeters: normalized.separationMeters,
		seed: normalized.seed,
	});
	const audit = auditGroupAiPolicy({ members: normalized.members, cohesion, threat, formation });
	const intent = threat.groupIntent;
	const directive = intent === 'flee'
		? 'disperse-from-threat'
		: !cohesion.accepted
			? 'regroup'
			: intent === 'investigate'
				? 'converge-on-contact'
				: 'maintain-formation';
	return freeze({
		accepted: audit.ok && Boolean(center),
		id: normalized.id,
		intent,
		directive,
		leader,
		center,
		cohesion,
		threat,
		formation,
		audit,
		seedDigest: stableHash(`${normalized.seed}:${normalized.id}`).toString(16).padStart(8, '0'),
	});
}

export function createGroupDirectorSnapshot(requests = []) {
	const safeRequests = Array.isArray(requests) ? requests.slice(0, MAX_GROUPS) : [];
	const groups = safeRequests.map((request, index) => buildGroupDirective(request, index));
	return freeze({
		policyId: LIVING_WORLD_GROUP_DIRECTOR_POLICY.id,
		groups: freeze(groups),
		groupCount: groups.length,
		acceptedGroups: groups.filter((group) => group.accepted).length,
	});
}

export function groupDirectorDigest(snapshot) {
	return stableHash(JSON.stringify(snapshot ?? null)).toString(16).padStart(8, '0');
}

export function auditGroupDirectorSnapshot(snapshot) {
	const errors = [];
	if (!snapshot || snapshot.policyId !== LIVING_WORLD_GROUP_DIRECTOR_POLICY.id) errors.push('policy-mismatch');
	if (!Array.isArray(snapshot?.groups) || snapshot.groups.length > MAX_GROUPS) errors.push('group-overflow');
	for (const group of snapshot?.groups ?? []) {
		if (!group.audit?.ok) errors.push(`group-audit:${group.id}`);
		if (!['flee', 'investigate', 'roam'].includes(group.intent)) errors.push(`invalid-intent:${group.id}`);
		if (!['disperse-from-threat', 'regroup', 'converge-on-contact', 'maintain-formation'].includes(group.directive)) errors.push(`invalid-directive:${group.id}`);
	}
	return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: groupDirectorDigest(snapshot) });
}
