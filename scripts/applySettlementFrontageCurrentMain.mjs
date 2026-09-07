#!/usr/bin/env node
/**
 * Current-main requalification helper for the settlement geography lane.
 *
 * The earlier geography migration is deliberately reused instead of duplicated here. This helper
 * then makes one additional production change: settlement architecture receives a deterministic
 * road-frontage orientation derived from the real canonical `roadEdges` passed to villages.js.
 *
 * Safe-to-rerun contract:
 * - no asset bytes are modified;
 * - no terrain/road generation is changed;
 * - no Material Studio/editor code is imported;
 * - existing Shared Material Placement stays the only model dressing/placement authority;
 * - the script fails closed when the expected production shape has drifted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VILLAGES = path.join(ROOT, 'src/3d/world/villages.js');
const MIGRATION = path.join(ROOT, 'scripts/migrateSettlementGeographyCurrentMain.mjs');
const HOUSE_MIX = path.join(ROOT, 'scripts/integrateSettlementHouseTypeMix.mjs');

function runNode(script) {
	if (!fs.existsSync(script)) throw new Error(`[applySettlementFrontageCurrentMain] missing prerequisite: ${script}`);
	execFileSync(process.execPath, [script], { cwd: ROOT, stdio: 'inherit' });
}

let source = fs.readFileSync(VILLAGES, 'utf8');
runNode(MIGRATION);
runNode(HOUSE_MIX);
source = fs.readFileSync(VILLAGES, 'utf8');

const requiredGeographyToken = 'from \'./settlementGeographyPolicy.js\';';
if (!source.includes(requiredGeographyToken)) {
	throw new Error('[applySettlementFrontageCurrentMain] geography policy was not materialized into villages.js');
}

const replaceOnce = (before, after, label) => {
	const count = source.split(before).length - 1;
	if (count !== 1) {
		throw new Error(`[applySettlementFrontageCurrentMain] ${label}: expected exactly 1 match, found ${count}`);
	}
	source = source.replace(before, after);
};

if (!source.includes("'./settlementFrontagePolicy.js'")) {
	replaceOnce(
		"import {\n\tresolveSettlementArchitectureEvidence,\n\tresolveSettlementPreferredMaterialRole,\n\tscoreSettlementArchitectureSite,\n\tselectSettlementArchitectureVariant,\n} from './settlementGeographyPolicy.js';\n",
		"import {\n\tresolveSettlementArchitectureEvidence,\n\tresolveSettlementPreferredMaterialRole,\n\tscoreSettlementArchitectureSite,\n\tselectSettlementArchitectureVariant,\n} from './settlementGeographyPolicy.js';\nimport { resolveSettlementFrontageContext } from './settlementFrontagePolicy.js';\n",
		'frontage import',
	);
}

if (!source.includes('const frontageContext = resolveSettlementFrontageContext({')) {
	replaceOnce(
		"\t\t\tconst candidateSurfaceContext = { ...architectureSurfaceQuery(x, z), footprintReliefMeters: Math.max(0, support.max - support.min) };\n",
		"\t\t\tconst candidateSurfaceContext = { ...architectureSurfaceQuery(x, z), footprintReliefMeters: Math.max(0, support.max - support.min) };\n\t\t\tconst frontageContext = resolveSettlementFrontageContext({\n\t\t\t\tx,\n\t\t\t\tz,\n\t\t\t\tbaseYaw: yaw,\n\t\t\t\tseed: ((houseIndex + 1) * 0.7548776662466927) % 1,\n\t\t\t\troadEdges,\n\t\t\t\tslopeDegrees: candidateSurfaceContext.slopeDegrees,\n\t\t\t\twaterDepth: candidateSurfaceContext.waterDepth,\n\t\t\t\tfootprintReliefMeters: candidateSurfaceContext.footprintReliefMeters,\n\t\t\t});\n\t\t\tconst frontageSurfaceContext = { ...candidateSurfaceContext, frontageContext };\n",
		'candidate frontage context',
	);

	replaceOnce(
		"\t\t\t\t\tconst geographyScore = scoreSettlementArchitectureSite(architectureProfile.id, candidateSurfaceContext);\n",
		"\t\t\t\t\tconst geographyScore = scoreSettlementArchitectureSite(architectureProfile.id, frontageSurfaceContext);\n",
		'geography frontage context',
	);

	replaceOnce(
		"\t\t\t\t\t\tarchitectureProfile.id,\n\t\t\t\t\t\tcandidateSurfaceContext,\n",
		"\t\t\t\t\t\tarchitectureProfile.id,\n\t\t\t\t\t\tfrontageSurfaceContext,\n",
		'variant frontage context',
	);

	replaceOnce(
		"\t\t\t\t\t\tseatId: seat.id, x, z, yaw, houseIndex, stepStartIndex,\n",
		"\t\t\t\t\t\tseatId: seat.id, x, z, yaw: frontageContext.buildingYawRadians, houseIndex, stepStartIndex,\n",
		'road-oriented candidate yaw',
	);

	replaceOnce(
		"\t\t\t\t\t\tsurfaceContext: candidateSurfaceContext,\n",
		"\t\t\t\t\t\tsurfaceContext: frontageSurfaceContext,\n",
		'frontage surface provenance',
	);
}

replaceOnce(
	"\t\tconst geographyEvidence = resolveSettlementArchitectureEvidence(profile.id, { ...site.surfaceContext, roll: ((site.houseIndex + 1) * 0.61803398875) % 1 });\n",
	"\t\tconst geographyEvidence = resolveSettlementArchitectureEvidence(profile.id, { ...site.surfaceContext, roll: ((site.houseIndex + 1) * 0.61803398875) % 1 });\n\t\tconst frontageEvidence = site.surfaceContext?.frontageContext || null;\n",
	'frontage manifest evidence',
);

replaceOnce(
	"\t\t\tgeographyScore: geographyEvidence.score,\n\t\t\tgeographyVariant: site.assetVariant || geographyEvidence.variant,\n",
	"\t\t\tgeographyScore: geographyEvidence.score,\n\t\t\tgeographyVariant: site.assetVariant || geographyEvidence.variant,\n\t\t\tfrontageScore: Number.isFinite(frontageEvidence?.frontageScore) ? frontageEvidence.frontageScore : null,\n\t\t\tfrontageRoadDistanceMeters: Number.isFinite(frontageEvidence?.roadDistanceMeters) ? frontageEvidence.roadDistanceMeters : null,\n\t\t\talignedToCanonicalRoad: frontageEvidence?.alignedToCanonicalRoad === true,\n\t\t\tfrontageSetbackMeters: Number.isFinite(frontageEvidence?.frontageSetbackMeters) ? frontageEvidence.frontageSetbackMeters : null,\n",
	'frontage provenance',
);

replaceOnce(
	"\t\tgroup.userData.villageArchitectureGeographyPolicy = 'settlement-geography-asset-material-v1-2026-09-07';\n",
	"\t\tgroup.userData.villageArchitectureGeographyPolicy = 'settlement-geography-asset-material-v1-2026-09-07';\n\t\tgroup.userData.villageArchitectureFrontagePolicy = 'settlement-road-frontage-v1-2026-09-07';\n",
	'group frontage policy evidence',
);

fs.writeFileSync(VILLAGES, source);
console.log('[applySettlementFrontageCurrentMain] PATCH_APPLIED', JSON.stringify({
	file: 'src/3d/world/villages.js',
	frontagePolicy: 'settlement-road-frontage-v1-2026-09-07',
	usesCanonicalRoadEdges: true,
	usesSharedMaterialPlacement: true,
	editorMaterialStudioRuntimeImport: false,
}));
