#!/usr/bin/env node
import { BIOME_ASSET_PROFILES, listBiomeAssetFamilies, resolveBiomeAssetDistribution } from '../src/3d/world/biomeAssetDistribution.js';
import { REFERENCE_BIOME_ZONES } from '../src/3d/world/worldReferenceMap.js';

const rows = REFERENCE_BIOME_ZONES.map((zone) => {
	const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'report', { sampleCount: 3 });
	return {
		zone: zone.id,
		kind: zone.kind,
		profile: context.profileId,
		confidence: context.confidence,
		density: context.densityMultiplier,
		landCover: context.landCover.primary,
		scatter: context.scatter.map((item) => item.family),
		geology: context.geology?.family || null,
		architecture: context.architecture?.asset || null,
	};
});

const report = {
	policy: 'biome-asset-distribution-2026-09-07-v1',
	canonicalZones: rows.length,
	profiles: Object.keys(BIOME_ASSET_PROFILES).length,
	assetFamilies: listBiomeAssetFamilies().length,
	rows,
};

console.log(JSON.stringify(report, null, 2));
console.log('BIOME_DISTRIBUTION_REPORT_OK');
