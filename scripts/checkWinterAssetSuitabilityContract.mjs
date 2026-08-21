#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WINTER_VEGETATION_ASSET_POLICY } from '../src/3d/world/winterVegetationAsset.js';
import { inspectGlbBuffer } from './inspectWinterGlbMetadata.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [primaryPath, grovePath] = WINTER_VEGETATION_ASSET_POLICY.candidates;
assert(primaryPath && grovePath, 'winter policy must retain the measured primary and grove candidates');

const primary = inspectGlbBuffer(await readFile(path.join(ROOT, primaryPath)));
const grove = inspectGlbBuffer(await readFile(path.join(ROOT, grovePath)));
const threshold = WINTER_VEGETATION_ASSET_POLICY.maxHorizontalToHeightRatio;
const targetHeight = WINTER_VEGETATION_ASSET_POLICY.targetHeightMeters;

assert.equal(primary.meshes, 1, 'primary winter asset must remain a single mesh tree');
assert.equal(primary.meshNodes, 1, 'primary winter asset must remain one mesh-bearing tree node');
assert(Math.abs(primary.baseOffsetY) < 1e-9, 'primary winter tree must remain grounded at source Y=0');
assert(primary.horizontalToHeightRatio < threshold,
	`primary winter tree ratio ${primary.horizontalToHeightRatio} must remain below runtime threshold ${threshold}`);
assert(grove.meshes > 1 && grove.meshNodes > 1,
	'second winter asset fixture must remain a multi-mesh grove rather than silently becoming one tree');
assert(grove.horizontalToHeightRatio > threshold,
	`grove ratio ${grove.horizontalToHeightRatio} must remain above single-tree threshold ${threshold}`);
assert(threshold < 1.15,
	'single-tree threshold must not drift high enough to accept broad grove-shaped replacements');

const primaryNormalizedWidth = Math.max(primary.size[0], primary.size[2]) / primary.size[1] * targetHeight;
const groveNormalizedWidth = Math.max(grove.size[0], grove.size[2]) / grove.size[1] * targetHeight;
assert(primaryNormalizedWidth < targetHeight,
	'normalized primary tree crown must stay narrower than the target tree height');
assert(groveNormalizedWidth > targetHeight,
	'normalized grove must demonstrate why it cannot replace one snow-pine instance');

console.log('[checkWinterAssetSuitabilityContract] PASS', JSON.stringify({
	policy: WINTER_VEGETATION_ASSET_POLICY.id,
	threshold,
	primary: {
		path: primaryPath,
		ratio: primary.horizontalToHeightRatio,
		normalizedWidthMeters: primaryNormalizedWidth,
	},
	grove: {
		path: grovePath,
		ratio: grove.horizontalToHeightRatio,
		normalizedWidthMeters: groveNormalizedWidth,
		meshes: grove.meshes,
	},
}));
