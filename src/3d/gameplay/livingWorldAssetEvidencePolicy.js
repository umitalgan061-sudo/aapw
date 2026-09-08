/**
 * Asset-first evidence policy for living-world models.
 *
 * This is validation metadata only. It deliberately does not load, overwrite, convert or hydrate
 * source assets. Git LFS pointer-sized files are treated as source references when the asset path is
 * canonical; they are not classified as missing until a real runtime loader failure is observed.
 * Material/placement authority remains the shared MaterialAssignmentCore / WorldAssetPlacementPipeline.
 */

const freeze = (value) => Object.freeze(value);
const MAX_TEXTURES = 32;
const MAX_ROLES = 16;

export const LIVING_WORLD_ASSET_EVIDENCE_POLICY = freeze({
	id: 'living-world-asset-evidence-2026-09-08-v1',
	canonicalRoots: freeze(['assets/models/characters/', 'assets/models/animals/', 'assets/models/creatures/', 'assets/models/dragons/', 'assets/models/fbx/', 'assets/animations/', 'assets/textures/', 'assets/audio/', 'assets/particles/']),
	maxTextures: MAX_TEXTURES,
	maxRoles: MAX_ROLES,
	lfsPointerBytesUpperBound: 1024,
	allowLfsPointerReference: true,
	missingAssetOnLoaderErrorOnly: true,
});

const REQUIRED_ROLES = freeze({
	npc: freeze(['skin', 'hair', 'eyes', 'clothing', 'boots', 'gear']),
	horse: freeze(['coat', 'mane', 'tail', 'hoof', 'saddle', 'harness']),
	wolf: freeze(['fur', 'eye', 'claw', 'tooth']),
	creature: freeze(['fur', 'eye', 'claw', 'tooth']),
	dragon: freeze(['scale', 'wing', 'eye', 'horn', 'claw']),
});

function normalizeKind(kind) {
	const key = String(kind ?? '').trim().toLowerCase();
	return ['npc', 'horse', 'wolf', 'creature', 'dragon'].includes(key) ? key : null;
}

function normalizeAssetPath(path) {
	return String(path ?? '').trim().replaceAll('\\', '/');
}

function isCanonicalPath(path) {
	const normalized = normalizeAssetPath(path);
	return LIVING_WORLD_ASSET_EVIDENCE_POLICY.canonicalRoots.some((root) => normalized.startsWith(root));
}

function normalizeRoles(roles) {
	return [...new Set((Array.isArray(roles) ? roles : []).slice(0, MAX_ROLES).map((role) => String(role ?? '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeTextures(textures) {
	return (Array.isArray(textures) ? textures : []).slice(0, MAX_TEXTURES).map((texture, index) => freeze({
		name: String(texture?.name ?? `texture-${index}`),
		width: Number.isFinite(Number(texture?.width)) ? Number(texture.width) : 0,
		height: Number.isFinite(Number(texture?.height)) ? Number(texture.height) : 0,
		bytes: Number.isFinite(Number(texture?.bytes)) ? Number(texture.bytes) : null,
		path: normalizeAssetPath(texture?.path),
	})).filter((texture) => texture.width >= 0 && texture.height >= 0);
}

export function requiredMaterialRoles(kind) {
	const normalized = normalizeKind(kind);
	return normalized ? REQUIRED_ROLES[normalized] : freeze([]);
}

export function isCanonicalLivingWorldAssetPath(path) {
	return isCanonicalPath(path);
}

export function classifyAssetReference({ path = '', byteLength = null, lfsPointer = false, loaderError = null } = {}) {
	const normalizedPath = normalizeAssetPath(path);
	const pointerSized = Number.isFinite(Number(byteLength)) && Number(byteLength) > 0 && Number(byteLength) <= LIVING_WORLD_ASSET_EVIDENCE_POLICY.lfsPointerBytesUpperBound;
	const loaderFailed = Boolean(loaderError);
	return freeze({
		path: normalizedPath,
		canonical: isCanonicalPath(normalizedPath),
		lfsPointerReference: Boolean(lfsPointer) || pointerSized,
		loaderFailed,
		missing: loaderFailed,
		status: loaderFailed ? 'missing' : pointerSized || lfsPointer ? 'source-reference' : 'hydrated-or-unknown',
	});
}

export function validateLivingWorldAssetEvidence({ kind, sourceAsset, material = {}, placement = {} } = {}) {
	const normalizedKind = normalizeKind(kind);
	const errors = [];
	if (!normalizedKind) errors.push('unknown-kind');
	const source = classifyAssetReference(sourceAsset ?? {});
	if (!source.path) errors.push('missing-source-path');
	if (!source.canonical) errors.push('non-canonical-source-path');
	if (source.missing) errors.push('loader-error');
	const roles = normalizeRoles(material.roles);
	const required = normalizedKind ? REQUIRED_ROLES[normalizedKind] : [];
	if (!material.validated) errors.push('material-not-validated');
	if (required.some((role) => !roles.includes(role))) errors.push('missing-material-role');
	const textures = normalizeTextures(material.textures);
	if (textures.some((texture) => texture.width === 0 || texture.height === 0)) errors.push('invalid-texture-size');
	if (!placement.accepted) errors.push('placement-not-accepted');
	if (!placement.groundAligned) errors.push('ground-not-aligned');
	if (!placement.habitatAccepted) errors.push('habitat-not-accepted');
	const loaderSafe = !source.missing;
	return freeze({
		accepted: errors.length === 0 && loaderSafe,
		errors: freeze(errors),
		kind: normalizedKind,
		source,
		material: freeze({ validated: Boolean(material.validated), roles: freeze(roles), textureCount: textures.length, textures: freeze(textures) }),
		placement: freeze({ accepted: Boolean(placement.accepted), groundAligned: Boolean(placement.groundAligned), habitatAccepted: Boolean(placement.habitatAccepted), placementDigest: placement.placementDigest == null ? null : String(placement.placementDigest), materialDigest: placement.materialDigest == null ? null : String(placement.materialDigest) }),
		provenance: '#590',
	});
}

export function assetEvidenceDigest(evidence) {
	let hash = 2166136261;
	for (const character of JSON.stringify(evidence ?? null)) {
		hash ^= character.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return (hash ^ (hash >>> 16)).toString(16).padStart(8, '0');
}

export function auditLivingWorldAssetEvidence(evidence) {
	const errors = [];
	if (!evidence || evidence.accepted !== true) errors.push('evidence-not-accepted');
	if (evidence?.source?.missing) errors.push('asset-loader-missing');
	if (!evidence?.source?.canonical) errors.push('asset-source-not-canonical');
	if (!evidence?.material?.validated) errors.push('material-validation');
	if (!evidence?.placement?.groundAligned || !evidence?.placement?.habitatAccepted) errors.push('placement-alignment');
	return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: assetEvidenceDigest(evidence) });
}
