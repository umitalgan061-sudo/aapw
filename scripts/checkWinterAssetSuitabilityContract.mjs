#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WINTER_VEGETATION_ASSET_POLICY } from '../src/3d/world/winterVegetationAsset.js';
import { inspectGlbBuffer } from './inspectWinterGlbMetadata.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preferredPath = WINTER_VEGETATION_ASSET_POLICY.preferredSnowPineAsset;
const barePath = WINTER_VEGETATION_ASSET_POLICY.bareWinterTreeAsset;
const grovePath = WINTER_VEGETATION_ASSET_POLICY.groveAsset;
assert.deepEqual(WINTER_VEGETATION_ASSET_POLICY.candidates, [preferredPath, barePath, grovePath],
	'winter candidate order must remain pine → bare winter tree → measured grove rejection/fallback');

const preferred = inspectGlbBuffer(await readFile(path.join(ROOT, preferredPath)));
const bare = inspectGlbBuffer(await readFile(path.join(ROOT, barePath)));
const grove = inspectGlbBuffer(await readFile(path.join(ROOT, grovePath)));
const threshold = WINTER_VEGETATION_ASSET_POLICY.maxHorizontalToHeightRatio;
const targetHeight = WINTER_VEGETATION_ASSET_POLICY.targetHeightMeters;

assert.equal(preferred.meshNodes, 1, 'preferred pine must remain one mesh-bearing tree node');
assert(preferred.materials >= 2 && preferred.textures >= 1 && preferred.images >= 1,
	'preferred pine must retain distinct textured trunk/foliage material data for winter treatment');
assert(preferred.horizontalToHeightRatio < threshold,
	`preferred pine ratio ${preferred.horizontalToHeightRatio} must remain below runtime threshold ${threshold}`);
assert.equal(bare.meshes, 1, 'bare winter fallback must remain a single-mesh tree');
assert.equal(bare.textures, 0, 'bare winter fallback is intentionally untextured and must not masquerade as the snowy pine');
assert(Math.abs(bare.baseOffsetY) < 1e-9, 'bare winter tree must remain grounded at source Y=0');
assert(bare.horizontalToHeightRatio < threshold,
	`bare winter fallback ratio ${bare.horizontalToHeightRatio} must remain below runtime threshold ${threshold}`);
assert(grove.meshes > 1 && grove.meshNodes > 1,
	'snow dead-tree fixture must remain a multi-mesh grove rather than silently becoming one tree');
assert(grove.horizontalToHeightRatio > threshold,
	`grove ratio ${grove.horizontalToHeightRatio} must remain above single-tree threshold ${threshold}`);
assert(threshold < 1.15,
	'single-tree threshold must not drift high enough to accept broad grove-shaped replacements');

function normalizedWidth(report) {
	return Math.max(report.size[0], report.size[2]) / report.size[1] * targetHeight;
}
const preferredNormalizedWidth = normalizedWidth(preferred);
const bareNormalizedWidth = normalizedWidth(bare);
const groveNormalizedWidth = normalizedWidth(grove);
assert(preferredNormalizedWidth < targetHeight, 'normalized preferred pine crown must remain narrower than tree height');
assert(bareNormalizedWidth < targetHeight, 'normalized bare fallback crown must remain narrower than tree height');
assert(groveNormalizedWidth > targetHeight, 'normalized grove must demonstrate why it cannot replace one snow-pine instance');

console.log('[checkWinterAssetSuitabilityContract] PASS', JSON.stringify({
	policy: WINTER_VEGETATION_ASSET_POLICY.id,
	threshold,
	preferred: {
		path: preferredPath,
		ratio: preferred.horizontalToHeightRatio,
		normalizedWidthMeters: preferredNormalizedWidth,
		materials: preferred.materials,
		textures: preferred.textures,
	},
	bareFallback: {
		path: barePath,
		ratio: bare.horizontalToHeightRatio,
		normalizedWidthMeters: bareNormalizedWidth,
	},
	grove: {
		path: grovePath,
		ratio: grove.horizontalToHeightRatio,
		normalizedWidthMeters: groveNormalizedWidth,
		meshes: grove.meshes,
	},
}));
