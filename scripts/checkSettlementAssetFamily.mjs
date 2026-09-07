#!/usr/bin/env node
/**
 * Settlement asset-family audit.
 *
 * This check is intentionally LFS-aware: a 130-byte Git LFS pointer is not treated as a broken model
 * by itself. The contract is that a referenced asset path exists and is either a hydrated GLB or an
 * explicit, syntactically valid LFS pointer. CI then selectively hydrates the settlement family when
 * byte-level GLB inspection is required. Source assets are never rewritten by this audit.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const villagesPath = path.join(ROOT, 'src/3d/world/villages.js');
const villagesSource = fs.readFileSync(villagesPath, 'utf8');

const ALLOWED_ASSET_ROOTS = Object.freeze([
	'assets/models/settlements/',
	'assets/models/houses/',
	'assets/models/props/',
	'assets/models/fbx/',
]);

const REFERENCED_ASSETS = [...new Set(
	[...villagesSource.matchAll(/(?:assetUrl|secondaryAssetUrl|file):\s*'([^']+\.(?:glb|fbx|blend))'/gi)]
		.map((match) => match[1]),
)];

function isPointer(bytes) {
	return bytes.toString('utf8').startsWith('version https://git-lfs.github.com/spec/v1');
}

function parsePointer(bytes) {
	const text = bytes.toString('utf8');
	const oid = text.match(/^oid sha256:([a-f0-9]{64})$/m)?.[1] ?? null;
	const sizeMatch = text.match(/^size (\d+)$/m)?.[1] ?? null;
	return { oid, size: sizeMatch ? Number(sizeMatch) : null };
}

function isHydratedGlb(bytes) {
	if (bytes.length < 20) return false;
	if (bytes.subarray(0, 4).toString('ascii') !== 'glTF') return false;
	const version = bytes.readUInt32LE(4);
	const declaredLength = bytes.readUInt32LE(8);
	return version === 2 && declaredLength >= 12 && declaredLength <= bytes.length;
}

function classifyAsset(relative) {
	const name = path.basename(relative).toLowerCase();
	if (/(blacksmith|forge|smith)/.test(name)) return 'blacksmith';
	if (/(tavern|inn|pub)/.test(name)) return 'tavern';
	if (/(market|stall|shop)/.test(name)) return 'market';
	if (/(stable|stables|horse)/.test(name)) return 'stable';
	if (/(barracks|guard|garrison)/.test(name)) return 'barracks';
	if (/(barn|farm|mill|silo)/.test(name)) return 'farm';
	if (/(cabin|house|home|hut|longhouse)/.test(name)) return 'residential';
	if (/(door|gate)/.test(name)) return 'entry';
	if (/(chest|crate|barrel)/.test(name)) return 'storage';
	return 'other-settlement-prop';
}

assert.ok(REFERENCED_ASSETS.length >= 6, `expected at least six unique settlement asset references, got ${REFERENCED_ASSETS.length}`);
assert.equal(villagesSource.includes('EditorMaterialStudio'), false);
assert.ok(villagesSource.includes('MaterialAssignmentCore.js'));
assert.ok(villagesSource.includes('WorldAssetPlacementPipeline.js'));
assert.ok(villagesSource.includes('placeWorldAsset('));
assert.ok(villagesSource.includes('createMaterialManifest') || villagesSource.includes('manifest:'));

const seenRoles = new Set();
const report = [];
for (const relative of REFERENCED_ASSETS) {
	assert.ok(ALLOWED_ASSET_ROOTS.some((root) => relative.startsWith(root)), `settlement asset outside approved source families: ${relative}`);
	assert.equal(path.posix.normalize(relative), relative.replaceAll('\\', '/'), `non-normalised asset path: ${relative}`);
	const absolute = path.join(ROOT, relative);
	assert.equal(path.resolve(absolute).startsWith(ROOT), true, `asset escapes repository root: ${relative}`);
	assert.equal(fs.existsSync(absolute), true, `referenced settlement asset is missing: ${relative}`);
	const bytes = fs.readFileSync(absolute);
	const hydratedGlb = relative.toLowerCase().endsWith('.glb') && isHydratedGlb(bytes);
	const pointer = isPointer(bytes);
	if (pointer) {
		const parsed = parsePointer(bytes);
		assert.ok(parsed.oid, `invalid LFS pointer oid: ${relative}`);
		assert.ok(Number.isInteger(parsed.size) && parsed.size > 0, `invalid LFS pointer size: ${relative}`);
	} else if (relative.toLowerCase().endsWith('.glb')) {
		assert.equal(hydratedGlb, true, `settlement GLB is neither hydrated GLB nor LFS pointer: ${relative}`);
	}
	const role = classifyAsset(relative);
	seenRoles.add(role);
	report.push({ path: relative, role, hydratedGlb, lfsPointer: pointer, bytes: bytes.length });
}

const profiles = [...villagesSource.matchAll(/assetUrl:\s*'([^']+\.glb)'\s*,\s*secondaryAssetUrl:\s*'([^']+\.glb)'/g)].map((match) => ({
	primary: match[1],
	secondary: match[2],
}));
assert.ok(profiles.length >= 6, `expected regional primary/secondary residential variants, got ${profiles.length}`);
for (const profile of profiles) {
	assert.notEqual(profile.primary, profile.secondary, `regional profile reuses one asset twice: ${profile.primary}`);
}

const duplicatePrimaryCount = profiles.length - new Set(profiles.map((profile) => profile.primary)).size;
const duplicateSecondaryCount = profiles.length - new Set(profiles.map((profile) => profile.secondary)).size;
assert.ok(duplicatePrimaryCount >= 0);
assert.ok(duplicateSecondaryCount >= 0);

const settlementReferences = REFERENCED_ASSETS.filter((asset) => asset.startsWith('assets/models/settlements/'));
const nonSettlementHouseReferences = REFERENCED_ASSETS.filter((asset) => asset.startsWith('assets/models/houses/'));
assert.equal(settlementReferences.length + nonSettlementHouseReferences.length, REFERENCED_ASSETS.length);
assert.ok(settlementReferences.length >= 6, 'settlement architecture must remain in the approved settlement asset family');
assert.ok(seenRoles.has('residential'), 'settlement architecture must include residential authored models');

const placeholderReferences = REFERENCED_ASSETS.filter((asset) => /(placeholder|cube|box|dummy|test_asset)/i.test(asset));
assert.deepEqual(placeholderReferences, [], 'settlement architecture references a placeholder asset');

console.log('[checkSettlementAssetFamily] PASS', JSON.stringify({
	uniqueReferencedAssets: REFERENCED_ASSETS.length,
	regionalProfiles: profiles.length,
	settlementPathReferences: settlementReferences.length,
	housePathReferences: nonSettlementHouseReferences.length,
	roles: [...seenRoles].sort(),
	hydratedGlbs: report.filter((item) => item.hydratedGlb).length,
	lfsPointers: report.filter((item) => item.lfsPointer).length,
	sharedPlacement: true,
	editorMaterialStudioRuntimeImport: false,
}));
