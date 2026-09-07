#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const villagesPath = path.join(ROOT, 'src/3d/world/villages.js');
const villagesSource = fs.readFileSync(villagesPath, 'utf8');

for (const token of [
	"import { placeWorldAsset, WORLD_SURFACE_POLICY_PRESETS } from './WorldAssetPlacementPipeline.js';",
	"requireSurfaceContext: true",
	"footprintGrounding: 'always'",
	'villageArchitectureGeographyPolicy',
	'preferredMaterialRoles',
	'geographyVariant',
]) {
	assert.ok(villagesSource.includes(token), `settlement runtime missing required proof token: ${token}`);
}
assert.equal(villagesSource.includes('EditorMaterialStudio'), false);

const assetPaths = [...new Set([...villagesSource.matchAll(/(?:assetUrl|secondaryAssetUrl):\s*'([^']+\.glb)'/g)].map((m) => m[1]))];
assert.ok(assetPaths.length >= 6, `expected regional asset diversity, got ${assetPaths.length}`);
for (const assetPath of assetPaths) {
	const bytes = fs.readFileSync(path.join(ROOT, assetPath));
	assert.ok(bytes.length > 160, `asset too small to be a real GLB: ${assetPath}`);
	assert.equal(bytes.subarray(0, 4).toString('ascii'), 'glTF', `invalid GLB header: ${assetPath}`);
}

console.log('[checkSettlementGeographyBrowser] STATIC_SHIPPED_RUNTIME_PROOF', JSON.stringify({
	assetCount: assetPaths.length,
	sharedPlacement: true,
	runtimeEditorStudioImport: false,
	materialRoleEvidence: true,
}));