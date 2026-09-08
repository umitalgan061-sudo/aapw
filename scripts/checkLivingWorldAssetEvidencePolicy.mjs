import assert from 'node:assert/strict';
import {
	LIVING_WORLD_ASSET_EVIDENCE_POLICY,
	requiredMaterialRoles,
	classifyAssetReference,
	validateLivingWorldAssetEvidence,
	auditLivingWorldAssetEvidence,
	assetEvidenceDigest,
	isCanonicalLivingWorldAssetPath,
	validateLivingWorldAssetSurfaceContext,
} from '../src/3d/gameplay/livingWorldAssetEvidencePolicy.js';

assert.equal(isCanonicalLivingWorldAssetPath('assets/models/characters/guard.glb'), true);
assert.equal(isCanonicalLivingWorldAssetPath('assets/models/animals/wolf.glb'), true);
assert.equal(isCanonicalLivingWorldAssetPath('src/3d/gameplay/wolf.glb'), false);
assert(requiredMaterialRoles('npc').includes('skin'));
assert(requiredMaterialRoles('horse').includes('saddle'));
assert(requiredMaterialRoles('dragon').includes('scale'));

const pointer = classifyAssetReference({ path: 'assets/models/animals/wolf.glb', byteLength: 132 });
assert.equal(pointer.canonical, true);
assert.equal(pointer.lfsPointerReference, true);
assert.equal(pointer.missing, false);
assert.equal(pointer.status, 'source-reference');
const loaderFailure = classifyAssetReference({ path: 'assets/models/animals/wolf.glb', byteLength: 132, loaderError: 'decode failed' });
assert.equal(loaderFailure.missing, true);

const geographicContext = {
	biome: 'temperate forest',
	temperature: 0.45,
	moisture: 0.7,
	slope: 18,
	waterDepth: 0,
	settlementDistance: 800,
	roadDistance: 260,
	habitatScore: 0.91,
	placementDigest: 'p1',
};
const evidence = validateLivingWorldAssetEvidence({
	kind: 'wolf',
	sourceAsset: { path: 'assets/models/animals/wolf.glb', byteLength: 132 },
	material: { validated: true, roles: ['fur', 'eye', 'claw', 'tooth'], textures: [{ name: 'albedo', width: 1024, height: 1024, path: 'assets/textures/wolf_albedo.png' }] },
	placement: { accepted: true, groundAligned: true, habitatAccepted: true, placementDigest: 'p1', materialDigest: 'm1' },
	geographicContext,
});
assert.equal(evidence.accepted, true);
assert.equal(evidence.source.lfsPointerReference, true);
assert.equal(evidence.geographic.geography.biome, 'temperate forest');
assert.equal(auditLivingWorldAssetEvidence(evidence).ok, true);
assert.equal(assetEvidenceDigest(evidence), assetEvidenceDigest(JSON.parse(JSON.stringify(evidence))));

const surfaceContext = validateLivingWorldAssetSurfaceContext({
	material: evidence.material,
	geographicContext,
	placement: evidence.placement,
});
assert.equal(surfaceContext.ok, true);
assert.equal(surfaceContext.textureErrors.length, 0);
assert.equal(surfaceContext.geographic.errors.length, 0);
assert.equal(surfaceContext.roleCoverage, 4);

const missingRole = validateLivingWorldAssetEvidence({
	kind: 'horse',
	sourceAsset: { path: 'assets/models/animals/horse.glb', byteLength: 132 },
	material: { validated: true, roles: ['coat'], textures: [{ width: 1024, height: 1024 }] },
	placement: { accepted: true, groundAligned: true, habitatAccepted: true },
	geographicContext,
});
assert.equal(missingRole.accepted, false);
assert(missingRole.errors.includes('missing-material-role'));

const loaderRejected = validateLivingWorldAssetEvidence({
	kind: 'dragon',
	sourceAsset: { path: 'assets/models/dragons/dragon.glb', loaderError: 'not found' },
	material: { validated: true, roles: ['scale', 'wing', 'eye', 'horn', 'claw'], textures: [] },
	placement: { accepted: true, groundAligned: true, habitatAccepted: true },
	geographicContext,
});
assert.equal(loaderRejected.accepted, false);
assert(loaderRejected.errors.includes('loader-error'));
assert.equal(LIVING_WORLD_ASSET_EVIDENCE_POLICY.missingAssetOnLoaderErrorOnly, true);

const textureFailure = validateLivingWorldAssetSurfaceContext({
	material: { roles: ['fur'], textures: [{ name: 'stretch', width: 16384, height: 16, path: 'assets/textures/stretch.png' }] },
	geographicContext,
	placement: { placementDigest: 'p1' },
});
assert.equal(textureFailure.ok, false);
assert(textureFailure.textureErrors.includes('texture-extreme-aspect:stretch'));

const geographyFailure = validateLivingWorldAssetSurfaceContext({
	material: { roles: ['fur'], textures: [{ name: 'albedo', width: 1024, height: 1024, path: 'assets/textures/wolf_albedo.png' }] },
	geographicContext: { ...geographicContext, placementDigest: 'different-placement' },
	placement: { placementDigest: 'p1' },
});
assert.equal(geographyFailure.ok, false);
assert(geographyFailure.geographic.errors.includes('geography-placement-digest-mismatch'));

const rangeFailure = validateLivingWorldAssetSurfaceContext({
	material: { roles: ['fur'], textures: [{ name: 'albedo', width: 1024, height: 1024, path: 'assets/legacy/wolf.png' }] },
	geographicContext: { ...geographicContext, moisture: 1.2, slope: 91, habitatScore: -0.1, settlementDistance: -4 },
	placement: { placementDigest: 'p1' },
});
assert.equal(rangeFailure.ok, false);
assert(rangeFailure.textureErrors.includes('non-canonical-texture-path:albedo'));
assert(rangeFailure.geographic.errors.includes('moisture-out-of-range'));
assert(rangeFailure.geographic.errors.includes('slope-out-of-range'));
assert(rangeFailure.geographic.errors.includes('habitat-score-out-of-range'));
assert(rangeFailure.geographic.errors.includes('settlement-distance-negative'));

const warningSurface = validateLivingWorldAssetSurfaceContext({ geographicContext: {} });
assert.equal(warningSurface.ok, false);
assert(warningSurface.warnings.includes('no-textures-observed'));
assert(warningSurface.warnings.includes('no-material-roles-observed'));

console.log(JSON.stringify({ pass: true, pointerStatus: pointer.status, wolfAccepted: evidence.accepted, surfaceDigest: surfaceContext.digest, missingRoleErrors: missingRole.errors, digest: assetEvidenceDigest(evidence) }, null, 2));
