import assert from 'node:assert/strict';
import {
	LIVING_WORLD_ASSET_EVIDENCE_POLICY,
	requiredMaterialRoles,
	classifyAssetReference,
	validateLivingWorldAssetEvidence,
	auditLivingWorldAssetEvidence,
	assetEvidenceDigest,
	isCanonicalLivingWorldAssetPath,
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

const evidence = validateLivingWorldAssetEvidence({
	kind: 'wolf',
	sourceAsset: { path: 'assets/models/animals/wolf.glb', byteLength: 132 },
	material: { validated: true, roles: ['fur', 'eye', 'claw', 'tooth'], textures: [{ name: 'albedo', width: 1024, height: 1024, path: 'assets/textures/wolf_albedo.png' }] },
	placement: { accepted: true, groundAligned: true, habitatAccepted: true, placementDigest: 'p1', materialDigest: 'm1' },
});
assert.equal(evidence.accepted, true);
assert.equal(evidence.source.lfsPointerReference, true);
assert.equal(auditLivingWorldAssetEvidence(evidence).ok, true);
assert.equal(assetEvidenceDigest(evidence), assetEvidenceDigest(JSON.parse(JSON.stringify(evidence))));

const missingRole = validateLivingWorldAssetEvidence({
	kind: 'horse',
	sourceAsset: { path: 'assets/models/animals/horse.glb', byteLength: 132 },
	material: { validated: true, roles: ['coat'], textures: [{ width: 1024, height: 1024 }] },
	placement: { accepted: true, groundAligned: true, habitatAccepted: true },
});
assert.equal(missingRole.accepted, false);
assert(missingRole.errors.includes('missing-material-role'));

const loaderRejected = validateLivingWorldAssetEvidence({
	kind: 'dragon',
	sourceAsset: { path: 'assets/models/dragons/dragon.glb', loaderError: 'not found' },
	material: { validated: true, roles: ['scale', 'wing', 'eye', 'horn', 'claw'], textures: [] },
	placement: { accepted: true, groundAligned: true, habitatAccepted: true },
});
assert.equal(loaderRejected.accepted, false);
assert(loaderRejected.errors.includes('loader-error'));
assert.equal(LIVING_WORLD_ASSET_EVIDENCE_POLICY.missingAssetOnLoaderErrorOnly, true);

console.log(JSON.stringify({ pass: true, pointerStatus: pointer.status, wolfAccepted: evidence.accepted, missingRoleErrors: missingRole.errors, digest: assetEvidenceDigest(evidence) }, null, 2));
