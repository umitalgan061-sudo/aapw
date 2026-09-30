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
const MAX_BIOME_LABEL = 64;
const MAX_TEXTURE_EDGE = 16384;
const MIN_TEXTURE_EDGE = 16;
const MAX_SURFACE_RATIO = 4;

export const LIVING_WORLD_ASSET_EVIDENCE_POLICY = freeze({
	id: 'living-world-asset-evidence-2026-09-08-v2',
	canonicalRoots: freeze(['assets/models/characters/', 'assets/models/animals/', 'assets/models/creatures/', 'assets/models/dragons/', 'assets/models/fbx/', 'assets/animations/', 'assets/textures/', 'assets/audio/', 'assets/particles/']),
	maxTextures: MAX_TEXTURES,
	maxRoles: MAX_ROLES,
	lfsPointerBytesUpperBound: 1024,
	allowLfsPointerReference: true,
	missingAssetOnLoaderErrorOnly: true,
	minTextureEdge: MIN_TEXTURE_EDGE,
	maxTextureEdge: MAX_TEXTURE_EDGE,
	maxTextureSurfaceRatio: MAX_SURFACE_RATIO,
	geographicEvidenceRequired: true,
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

function normalizeGeographicEvidence(context = {}) {
	const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
	return freeze({
		biome: String(context.biome ?? '').trim().slice(0, MAX_BIOME_LABEL).toLowerCase(),
		temperature: numberOrNull(context.temperature),
		moisture: numberOrNull(context.moisture),
		slope: numberOrNull(context.slope),
		waterDepth: numberOrNull(context.waterDepth),
		settlementDistance: numberOrNull(context.settlementDistance),
		roadDistance: numberOrNull(context.roadDistance),
		habitatScore: numberOrNull(context.habitatScore),
		placementDigest: context.placementDigest == null ? null : String(context.placementDigest),
	});
}

function validateTextureGeometry(textures) {
	const errors = [];
	for (const texture of textures) {
		if (texture.width < MIN_TEXTURE_EDGE || texture.height < MIN_TEXTURE_EDGE) errors.push(`texture-too-small:${texture.name}`);
		if (texture.width > MAX_TEXTURE_EDGE || texture.height > MAX_TEXTURE_EDGE) errors.push(`texture-too-large:${texture.name}`);
		const high = Math.max(texture.width, texture.height);
		const low = Math.max(1, Math.min(texture.width, texture.height));
		if (high / low > MAX_SURFACE_RATIO) errors.push(`texture-extreme-aspect:${texture.name}`);
		if (texture.path && !isCanonicalPath(texture.path)) errors.push(`non-canonical-texture-path:${texture.name}`);
	}
	return freeze(errors);
}

function validateGeographicEvidence(context, placement = {}) {
	const geography = normalizeGeographicEvidence(context);
	const errors = [];
	if (!geography.biome) errors.push('missing-biome');
	for (const key of ['temperature', 'moisture', 'slope', 'waterDepth', 'settlementDistance', 'roadDistance', 'habitatScore']) {
		if (geography[key] == null) errors.push(`missing-geography:${key}`);
	}
	if (geography.moisture != null && (geography.moisture < 0 || geography.moisture > 1)) errors.push('moisture-out-of-range');
	if (geography.slope != null && (geography.slope < 0 || geography.slope > 90)) errors.push('slope-out-of-range');
	if (geography.habitatScore != null && (geography.habitatScore < 0 || geography.habitatScore > 1)) errors.push('habitat-score-out-of-range');
	if (geography.settlementDistance != null && geography.settlementDistance < 0) errors.push('settlement-distance-negative');
	if (geography.roadDistance != null && geography.roadDistance < 0) errors.push('road-distance-negative');
	if (geography.placementDigest && placement.placementDigest && geography.placementDigest !== String(placement.placementDigest)) errors.push('geography-placement-digest-mismatch');
	return freeze({ geography, errors: freeze(errors) });
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

export function validateLivingWorldAssetEvidence({ kind, sourceAsset, material = {}, placement = {}, geographicContext = {} } = {}) {
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
	errors.push(...validateTextureGeometry(textures));
	if (!placement.accepted) errors.push('placement-not-accepted');
	if (!placement.groundAligned) errors.push('ground-not-aligned');
	if (!placement.habitatAccepted) errors.push('habitat-not-accepted');
	const geographic = validateGeographicEvidence(geographicContext, placement);
	errors.push(...geographic.errors);
	const loaderSafe = !source.missing;
	return freeze({
		accepted: errors.length === 0 && loaderSafe,
		errors: freeze([...new Set(errors)]),
		kind: normalizedKind,
		source,
		material: freeze({ validated: Boolean(material.validated), roles: freeze(roles), textureCount: textures.length, textures: freeze(textures) }),
		geographic,
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
	if (evidence?.geographic?.errors?.length) errors.push('geographic-evidence');
	if (evidence?.material?.textures?.some((texture) => texture.width === 0 || texture.height === 0)) errors.push('texture-geometry');
	return freeze({ ok: errors.length === 0, errors: freeze(errors), digest: assetEvidenceDigest(evidence) });
}

export function validateLivingWorldAssetSurfaceContext({ material = {}, geographicContext = {}, placement = {} } = {}) {
	const textures = normalizeTextures(material.textures);
	const textureErrors = validateTextureGeometry(textures);
	const geographic = validateGeographicEvidence(geographicContext, placement);
	const roleCoverage = normalizeRoles(material.roles).filter(Boolean).length;
	const warnings = [];
	if (textures.length === 0) warnings.push('no-textures-observed');
	if (roleCoverage === 0) warnings.push('no-material-roles-observed');
	return freeze({
		ok: textureErrors.length === 0 && geographic.errors.length === 0,
		textureErrors,
		geographic,
		roleCoverage,
		warnings: freeze(warnings),
		digest: assetEvidenceDigest({ textures, geographic, roleCoverage }),
	});
}
