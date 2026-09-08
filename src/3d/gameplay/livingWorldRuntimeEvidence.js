/**
 * Compact runtime evidence helpers for the existing living-world actors.
 *
 * Evidence is observational and fail-closed: no geometry is instantiated, no source asset is
 * rewritten, and no material/placement authority is duplicated. Model-bearing callers may attach
 * their existing MaterialAssignmentCore/WorldAssetPlacementPipeline evidence to userData and this
 * module only validates/serializes it.
 */

const freeze = (value) => Object.freeze(value);
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, finite(value, min)));
const MAX_ACTORS = 128;
const MAX_ERRORS = 64;
const MAX_ASSET_ROLES = 24;
const MAX_TEXTURES = 24;

export const LIVING_WORLD_RUNTIME_EVIDENCE_POLICY = freeze({
	id: 'living-world-runtime-evidence-2026-09-08-v1',
	maxActors: MAX_ACTORS,
	maxErrors: MAX_ERRORS,
	maxAssetRoles: MAX_ASSET_ROLES,
	maxTextures: MAX_TEXTURES,
	minimumFrameBudgetMs: 0,
	maximumFrameBudgetMs: 33.34,
	maximumMissingAssets: 0,
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

function finitePosition(value) {
	if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.z))) return null;
	return freeze({ x: Number(value.x), z: Number(value.z) });
}

function normalizeSurfaceEvidence(evidence = {}) {
	const roles = Array.isArray(evidence.roles)
		? evidence.roles.slice(0, MAX_ASSET_ROLES).map((role) => String(role ?? '').trim().toLowerCase()).filter(Boolean)
		: [];
	const textures = Array.isArray(evidence.textures)
		? evidence.textures.slice(0, MAX_TEXTURES).map((texture, index) => freeze({
			name: String(texture?.name ?? `texture-${index}`),
			width: Math.max(0, Math.floor(finite(texture?.width, 0))),
			height: Math.max(0, Math.floor(finite(texture?.height, 0))),
			map: String(texture?.map ?? 'unknown'),
		})).filter((texture) => texture.width > 0 && texture.height > 0)
		: [];
	const paletteIds = Array.isArray(evidence.paletteIds)
		? evidence.paletteIds.slice(0, MAX_ASSET_ROLES).map((id) => String(id ?? '').trim()).filter(Boolean)
		: [];
	return freeze({
		surfaceCount: Math.max(0, Math.floor(finite(evidence.surfaceCount, roles.length))),
		roles: freeze([...new Set(roles)]),
		textures: freeze(textures),
		paletteIds: freeze([...new Set(paletteIds)]),
		uvPresent: Boolean(evidence.uvPresent),
		materialSlotCount: Math.max(0, Math.floor(finite(evidence.materialSlotCount, 0))),
		validated: Boolean(evidence.validated),
	});
}

function normalizePlacementEvidence(evidence = {}) {
	return freeze({
		accepted: Boolean(evidence.accepted),
		groundAligned: Boolean(evidence.groundAligned),
		navAligned: Boolean(evidence.navAligned),
		habitatAccepted: Boolean(evidence.habitatAccepted),
		waterSafe: Boolean(evidence.waterSafe),
		slopeSafe: Boolean(evidence.slopeSafe),
		placementDigest: evidence.placementDigest == null ? null : String(evidence.placementDigest),
		materialDigest: evidence.materialDigest == null ? null : String(evidence.materialDigest),
		provenance: evidence.provenance == null ? null : String(evidence.provenance),
	});
}

function normalizeActorEvidence(actor, index) {
	const object3D = actor?.object3D ?? actor?.model ?? actor;
	const userData = object3D?.userData ?? {};
	const runtime = userData.livingWorldDirector ?? {};
	const npcPerception = userData.npcPerception ?? {};
	const wildlifeFlee = userData.wildlifeFlee ?? {};
	const position = finitePosition(object3D?.position ?? actor?.position);
	const kind = String(actor?.kind ?? userData.kind ?? 'actor');
	const id = String(actor?.id ?? object3D?.uuid ?? object3D?.name ?? `${kind}-${index}`);
	const surface = normalizeSurfaceEvidence(userData.materialEvidence ?? userData.surfaceEvidence ?? {});
	const placement = normalizePlacementEvidence(userData.placementEvidence ?? userData.livingWorldHabitat ?? {});
	return freeze({
		index,
		id,
		kind,
		position,
		health: finite(userData.health ?? actor?.health, 0),
		state: String(actor?.state ?? actor?.currentState ?? runtime.phase ?? npcPerception.intent ?? wildlifeFlee.phase ?? 'unknown'),
		perception: freeze({
			intent: npcPerception.intent == null ? null : String(npcPerception.intent),
			suspicion: clamp(npcPerception.suspicion, 0, 1),
			heard: Boolean(npcPerception.heard),
			lineOfSight: npcPerception.lineOfSight == null ? null : Boolean(npcPerception.lineOfSight),
			assistSourceId: npcPerception.assistSourceId == null ? null : String(npcPerception.assistSourceId),
		}),
		wildlife: freeze({
			phase: wildlifeFlee.phase == null ? null : String(wildlifeFlee.phase),
			direct: Boolean(wildlifeFlee.direct),
			pack: Boolean(wildlifeFlee.pack),
			recovering: Boolean(wildlifeFlee.recovering),
		}),
		director: freeze({
			phase: runtime.phase == null ? null : String(runtime.phase),
			activityId: runtime.activityId == null ? null : String(runtime.activityId),
			locationId: runtime.locationId == null ? null : String(runtime.locationId),
			travel: Boolean(runtime.travel),
			nextChangeSeconds: Math.max(0, finite(runtime.nextChangeSeconds, 0)),
		}),
		material: surface,
		placement,
	});
}

export function collectLivingWorldRuntimeEvidence({ actors = [], frameMs = 0, tickMs = frameMs, playerPosition = null } = {}) {
	const list = [];
	if (actors && typeof actors[Symbol.iterator] === 'function') {
		try {
			let index = 0;
			for (const actor of actors) {
				list.push(normalizeActorEvidence(actor, index));
				index += 1;
				if (index >= MAX_ACTORS) break;
			}
		} catch {
			// Fail closed below; partial evidence remains useful but never becomes acceptance by itself.
		}
	}
	const boundedFrameMs = Math.max(0, finite(frameMs, 0));
	const boundedTickMs = Math.max(0, finite(tickMs, boundedFrameMs));
	const missingAssets = list.reduce((sum, actor) => sum + (actor.material.validated && actor.placement.accepted ? 0 : 1), 0);
	const alignedActors = list.filter((actor) => actor.placement.groundAligned && actor.placement.habitatAccepted).length;
	const actorStates = list.reduce((counts, actor) => {
		counts[actor.state] = (counts[actor.state] ?? 0) + 1;
		return counts;
	}, {});
	return freeze({
		policyId: LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.id,
		actorCount: list.length,
		actors: freeze(list),
		playerPosition: finitePosition(playerPosition),
		frame: freeze({ frameMs: Number(boundedFrameMs.toFixed(3)), tickMs: Number(boundedTickMs.toFixed(3)) }),
		performance: freeze({ withinFrameBudget: boundedFrameMs <= LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs, budgetMs: LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs }),
		placement: freeze({ alignedActors, missingAssets }),
		stateCounts: freeze(actorStates),
	});
}

export function validateLivingWorldRuntimeEvidence(evidence) {
	const errors = [];
	if (!evidence || evidence.policyId !== LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.id) errors.push('policy-mismatch');
	if (Number(evidence?.actorCount ?? 0) > MAX_ACTORS) errors.push('actor-overflow');
	if (Number(evidence?.placement?.missingAssets ?? 0) > LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumMissingAssets) errors.push('missing-material-or-placement-evidence');
	if (Number(evidence?.frame?.frameMs ?? 0) > LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs) errors.push('frame-budget');
	for (const actor of evidence?.actors ?? []) {
		if (!actor.position) errors.push(`non-finite-position:${actor.id}`);
		if (!actor.material.validated) errors.push(`unvalidated-material:${actor.id}`);
		if (!actor.placement.accepted) errors.push(`placement-rejected:${actor.id}`);
	}
	return freeze({
		ok: errors.length === 0,
		errors: freeze(errors.slice(0, MAX_ERRORS)),
		actorCount: Number(evidence?.actorCount ?? 0),
		withinFrameBudget: Boolean(evidence?.performance?.withinFrameBudget),
		missingAssets: Number(evidence?.placement?.missingAssets ?? 0),
	});
}

export function runtimeEvidenceDigest(evidence) {
	return stableHash(JSON.stringify(evidence ?? null)).toString(16).padStart(8, '0');
}

export function buildLivingWorldAcceptanceSummary(evidence, directorSnapshot = null) {
	const validation = validateLivingWorldRuntimeEvidence(evidence);
	const director = directorSnapshot ? {
		policyId: directorSnapshot.policyId ?? null,
		actorsUpdated: finite(directorSnapshot.actorsUpdated, 0),
		eventsEmitted: finite(directorSnapshot.events?.emitted, 0),
		faunaGroups: Array.isArray(directorSnapshot.fauna) ? directorSnapshot.fauna.length : 0,
	} : null;
	return freeze({
		accepted: validation.ok,
		validation,
		digest: runtimeEvidenceDigest(evidence),
		director,
		proof: freeze({
			assetMaterialValidated: validation.ok && validation.missingAssets === 0,
			groundHabitatAligned: validation.ok,
			finitePositions: validation.ok,
			frameBudgetMs: Number(evidence?.performance?.budgetMs ?? LIVING_WORLD_RUNTIME_EVIDENCE_POLICY.maximumFrameBudgetMs),
		}),
	});
}
