import fs from 'node:fs';

function patchFile(path, marker, replacements) {
	let source = fs.readFileSync(path, 'utf8');
	if (source.includes(marker)) return false;
	for (const [before, after] of replacements) {
		if (!source.includes(before)) throw new Error(`${path}: expected patch anchor missing: ${before.slice(0, 80)}`);
		source = source.replace(before, after);
	}
	fs.writeFileSync(path, source);
	return true;
}

let changed = false;

changed = patchFile(
	'src/3d/world/vegetation.js',
	"sampleReferenceForestInfluenceWorld",
	[
		[
			"import { mulberry32 } from './terrain.js';",
			"import { mulberry32 } from './terrain.js';\nimport { OWNER_MAP_FEATURE_GUIDE_POLICY, sampleReferenceForestInfluenceWorld } from './worldReferenceFeatureGuides.js';",
		],
		[
			"\t\t\tif (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;\n\n\t\t\t// Species is drawn only for an accepted position",
			"\t\t\tif (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;\n\n\t\t\t// The exact owner map now shapes the forest itself, not just terrain tint. Keep a small\n\t\t\t// background chance for hedgerows/sparse woodland, while concentrating the same bounded\n\t\t\t// target count into the dark-green forest belts traced from map.png/map.png.\n\t\t\tconst forestInfluence = sampleReferenceForestInfluenceWorld(x, z);\n\t\t\tconst forestAcceptance = OWNER_MAP_FEATURE_GUIDE_POLICY.forestBackgroundAcceptance\n\t\t\t\t+ (1 - OWNER_MAP_FEATURE_GUIDE_POLICY.forestBackgroundAcceptance) * forestInfluence;\n\t\t\tif (rng() > forestAcceptance) continue;\n\n\t\t\t// Species is drawn only for an accepted position",
		],
	],
) || changed;

changed = patchFile(
	'src/3d/world/roadPathfinder.js',
	'referenceRoadOffGuidePenalty',
	[
		[
			"\tcorridorPaddingMeters = CORRIDOR_PADDING_METERS,\n}) {",
			"\tcorridorPaddingMeters = CORRIDOR_PADDING_METERS,\n\treferenceRoadPreference = null,\n\treferenceRoadOffGuidePenalty = 0,\n}) {",
		],
		[
			"\t\t\tconst stepCost = horizontalDistance * gradeCostMultiplier(angleDegrees);",
			"\t\t\tconst roadPreference = referenceRoadPreference\n\t\t\t\t? Math.max(0, Math.min(1, referenceRoadPreference(toWorldX(ni), toWorldZ(nj))))\n\t\t\t\t: 1;\n\t\t\t// Preference can only add cost away from the painted corridor; it never discounts below\n\t\t\t// raw horizontal distance, so the Euclidean A* heuristic remains admissible. Grade safety\n\t\t\t// still dominates because the existing over-cap multiplier is orders of magnitude larger.\n\t\t\tconst guideMultiplier = 1 + (1 - roadPreference) * Math.max(0, referenceRoadOffGuidePenalty);\n\t\t\tconst stepCost = horizontalDistance * gradeCostMultiplier(angleDegrees) * guideMultiplier;",
		],
	],
) || changed;

changed = patchFile(
	'src/3d/world/roads.js',
	'sampleReferenceRoadPreferenceWorld',
	[
		[
			"import { findSlopeAwarePath } from './roadPathfinder.js';",
			"import { findSlopeAwarePath } from './roadPathfinder.js';\nimport { OWNER_MAP_FEATURE_GUIDE_POLICY, sampleReferenceRoadPreferenceWorld } from './worldReferenceFeatureGuides.js';",
		],
		[
			"\t\t\t\tend: { x: to.x, z: to.z },\n\t\t\t});",
			"\t\t\t\tend: { x: to.x, z: to.z },\n\t\t\t\treferenceRoadPreference: sampleReferenceRoadPreferenceWorld,\n\t\t\t\treferenceRoadOffGuidePenalty: OWNER_MAP_FEATURE_GUIDE_POLICY.roadOffGuideCostPenalty,\n\t\t\t});",
		],
	],
) || changed;

changed = patchFile(
	'src/3d/world/worldReferenceMountainRelief.js',
	"'frostfangs': Object.freeze",
	[
		[
			"id: 'owner-map-live-mountain-relief-2026-08-17-v3'",
			"id: 'owner-map-live-mountain-relief-2026-08-20-v4'",
		],
		[
			"\t\t'eastern-chain': Object.freeze({ peakMeters: 1100, coreWidthNormalized: 0.007, outerWidthNormalized: 0.055, seed: 53 }),",
			"\t\t'eastern-chain': Object.freeze({ peakMeters: 1100, coreWidthNormalized: 0.007, outerWidthNormalized: 0.055, seed: 53 }),\n\t\t'frostfangs': Object.freeze({ peakMeters: 760, coreWidthNormalized: 0.007, outerWidthNormalized: 0.044, summitFloor: 0.46, seed: 67 }),\n\t\t'painted-mountains': Object.freeze({ peakMeters: 320, coreWidthNormalized: 0.006, outerWidthNormalized: 0.034, summitFloor: 0.42, seed: 71 }),\n\t\t'jogos-spine': Object.freeze({ peakMeters: 540, coreWidthNormalized: 0.006, outerWidthNormalized: 0.030, summitFloor: 0.44, seed: 79 }),",
		],
	],
) || changed;

console.log(changed ? 'OWNER_MAP_LIVE_GEOGRAPHY_PATCH_APPLIED' : 'OWNER_MAP_LIVE_GEOGRAPHY_PATCH_ALREADY_APPLIED');
