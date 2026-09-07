#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const villagesPath = path.join(ROOT, 'src/3d/world/villages.js');
const villages = fs.readFileSync(villagesPath, 'utf8');

let updated = villages;
const replaceOnce = (before, after, label) => {
	const count = updated.split(before).length - 1;
	if (count !== 1) throw new Error(`[migrateSettlementGeographyCurrentMain] ${label}: expected 1 match, found ${count}`);
	updated = updated.replace(before, after);
};

replaceOnce(
	"import { createStoneMaterial, createRoofMaterial } from './materials.js';\n",
	"import { createStoneMaterial, createRoofMaterial } from './materials.js';\nimport {\n\tresolveSettlementArchitectureEvidence,\n\tresolveSettlementPreferredMaterialRole,\n\tscoreSettlementArchitectureSite,\n\tselectSettlementArchitectureVariant,\n} from './settlementGeographyPolicy.js';\n",
	'import block',
);

replaceOnce(
	"function resolveVillageArchitectureAssetUrl(profile, site) {\n\treturn (site?.assetIndex ?? 0) > 0 ? (profile.secondaryAssetUrl || profile.assetUrl) : profile.assetUrl;\n}\n",
	"function resolveVillageArchitectureAssetUrl(profile, site) {\n\tif (site?.assetVariant === 'secondary') return profile.secondaryAssetUrl || profile.assetUrl;\n\tif (site?.assetVariant === 'primary') return profile.assetUrl;\n\treturn (site?.assetIndex ?? 0) > 0 ? (profile.secondaryAssetUrl || profile.assetUrl) : profile.assetUrl;\n}\n",
	'asset variant selection',
);

replaceOnce(
	"\t\tfor (let j = i + 1; j < valid.length; j++) {\n\t\t\tconst distance = Math.hypot(valid[j].x - valid[i].x, valid[j].z - valid[i].z);\n\t\t\tif (distance + 1e-9 < MIN_ARCHITECTURE_ASSET_SPACING_METERS) continue;\n\t\t\tconst betterDistance = !best || distance > best.distance + 1e-9;\n\t\t\tconst tiedDistance = best && Math.abs(distance - best.distance) <= 1e-9;\n\t\t\tconst stableTie = tiedDistance && (valid[i].houseIndex < best.first.houseIndex ||\n\t\t\t\t(valid[i].houseIndex === best.first.houseIndex && valid[j].houseIndex < best.second.houseIndex));\n\t\t\tif (betterDistance || stableTie) best = { first: valid[i], second: valid[j], distance };\n\t\t}\n",
	"\t\tfor (let j = i + 1; j < valid.length; j++) {\n\t\t\tconst distance = Math.hypot(valid[j].x - valid[i].x, valid[j].z - valid[i].z);\n\t\t\tif (distance + 1e-9 < MIN_ARCHITECTURE_ASSET_SPACING_METERS) continue;\n\t\t\tconst regionId = resolveVillageArchitectureProfile(valid[i].seatId)?.id;\n\t\t\tconst geographyScore = regionId\n\t\t\t\t? (scoreSettlementArchitectureSite(regionId, valid[i].surfaceContext) + scoreSettlementArchitectureSite(regionId, valid[j].surfaceContext)) / 2\n\t\t\t\t: 0;\n\t\t\tconst pairScore = distance * (0.55 + geographyScore * 0.45);\n\t\t\tconst betterPair = !best || pairScore > best.pairScore + 1e-9;\n\t\t\tconst tiedPair = best && Math.abs(pairScore - best.pairScore) <= 1e-9;\n\t\t\tconst stableTie = tiedPair && (valid[i].houseIndex < best.first.houseIndex ||\n\t\t\t\t(valid[i].houseIndex === best.first.houseIndex && valid[j].houseIndex < best.second.houseIndex));\n\t\t\tif (betterPair || stableTie) best = { first: valid[i], second: valid[j], distance, pairScore };\n\t\t}\n",
	'geography-aware landmark distribution',
);

replaceOnce(
	"\treturn [best.first, best.second]\n\t\t.slice(0, MAX_ARCHITECTURE_ASSETS_PER_HAMLET)\n\t\t.map((candidate, assetIndex) => ({ ...candidate, assetIndex, distributionDistanceMeters: best.distance }));\n",
	"\treturn [best.first, best.second]\n\t\t.slice(0, MAX_ARCHITECTURE_ASSETS_PER_HAMLET)\n\t\t.map((candidate, assetIndex) => ({\n\t\t\t...candidate,\n\t\t\tassetIndex,\n\t\t\tdistributionDistanceMeters: best.distance,\n\t\t\tgeographyPairScore: best.pairScore,\n\t\t}));\n",
	'landmark evidence',
);

const originalSurfaceQuery = `function createVillageArchitectureSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges) {
\treturn (x, z) => {
\t\tconst height = sampleHeightMeters(x, z);
\t\tconst dx = (sampleHeightMeters(x + SURFACE_SLOPE_SAMPLE_METERS, z) - sampleHeightMeters(x - SURFACE_SLOPE_SAMPLE_METERS, z)) / (SURFACE_SLOPE_SAMPLE_METERS * 2);
\t\tconst dz = (sampleHeightMeters(x, z + SURFACE_SLOPE_SAMPLE_METERS) - sampleHeightMeters(x, z - SURFACE_SLOPE_SAMPLE_METERS)) / (SURFACE_SLOPE_SAMPLE_METERS * 2);
\t\treturn {
\t\t\theight,
\t\t\tslopeDegrees: Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI,
\t\t\twaterDepth: Math.max(0, seaLevelMeters - height),
\t\t\troadDistance: roadDistanceMeters(x, z, roadEdges),
\t\t};
\t};
}`;
const geographySurfaceQuery = `function createVillageArchitectureSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges) {
\treturn (x, z) => {
\t\tconst height = sampleHeightMeters(x, z);
\t\tconst dx = (sampleHeightMeters(x + SURFACE_SLOPE_SAMPLE_METERS, z) - sampleHeightMeters(x - SURFACE_SLOPE_SAMPLE_METERS, z)) / (SURFACE_SLOPE_SAMPLE_METERS * 2);
\t\tconst dz = (sampleHeightMeters(x, z + SURFACE_SLOPE_SAMPLE_METERS) - sampleHeightMeters(x, z - SURFACE_SLOPE_SAMPLE_METERS)) / (SURFACE_SLOPE_SAMPLE_METERS * 2);
\t\tlet shorelineDistanceMeters = Infinity;
\t\tif (height >= seaLevelMeters) {
\t\t\tconst probeDirections = 16;
\t\t\tconst probeSteps = [8, 16, 24, 32, 48, 64];
\t\t\tfor (let directionIndex = 0; directionIndex < probeDirections && !Number.isFinite(shorelineDistanceMeters); directionIndex++) {
\t\t\t\tconst angle = directionIndex * Math.PI * 2 / probeDirections;
\t\t\t\tlet previousDistance = 0;
\t\t\t\tlet previousHeight = height;
\t\t\t\tfor (const distance of probeSteps) {
\t\t\t\t\tconst probeHeight = sampleHeightMeters(x + Math.cos(angle) * distance, z + Math.sin(angle) * distance);
\t\t\t\t\tif (probeHeight <= seaLevelMeters) {
\t\t\t\t\t\tconst denominator = Math.abs(probeHeight - previousHeight);
\t\t\t\t\t\tconst interpolation = denominator > 1e-9 ? Math.max(0, Math.min(1, (previousHeight - seaLevelMeters) / (previousHeight - probeHeight))) : 1;
\t\t\t\t\t\tshorelineDistanceMeters = previousDistance + (distance - previousDistance) * interpolation;
\t\t\t\t\t\tbreak;
\t\t\t\t\t}
\t\t\t\t\tpreviousDistance = distance;
\t\t\t\t\tpreviousHeight = probeHeight;
\t\t\t\t}
\t\t\t}
\t\t}
\t\treturn {
\t\t\theight,
\t\t\tslopeDegrees: Math.atan(Math.hypot(dx, dz)) * 180 / Math.PI,
\t\t\twaterDepth: Math.max(0, seaLevelMeters - height),
\t\t\troadDistance: roadDistanceMeters(x, z, roadEdges),
\t\t\tshorelineDistanceMeters,
\t\t};
\t};
}`;
replaceOnce(originalSurfaceQuery, geographySurfaceQuery, 'shoreline surface query');

replaceOnce(
	"\tconst landmarkSites = [];\n",
	"\tconst landmarkSites = [];\n\tconst architectureSurfaceQuery = createVillageArchitectureSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges);\n",
	'cached architecture surface query',
);

replaceOnce(
	"\t\t\tconst support = sampleFootprintRange(sampleHeightMeters, x, z, type.width, type.depth, yaw);\n",
	"\t\t\tconst support = sampleFootprintRange(sampleHeightMeters, x, z, type.width, type.depth, yaw);\n\t\t\tconst candidateSurfaceContext = { ...architectureSurfaceQuery(x, z), footprintReliefMeters: Math.max(0, support.max - support.min) };\n",
	'footprint geography context',
);

replaceOnce(
	"\t\t\t\tif (architectureProfile) {\n\t\t\t\t\tarchitectureCandidatesHere.push({\n\t\t\t\t\t\tseatId: seat.id, x, z, yaw, houseIndex, stepStartIndex,\n\t\t\t\t\t\tstepCount: STOOP_STEP_COUNT,\n\t\t\t\t\t\ttargetWidthMeters: type.width,\n\t\t\t\t\t\ttargetDepthMeters: type.depth,\n\t\t\t\t\t\ttargetFootprintMeters: Math.max(type.width, type.depth),\n\t\t\t\t\t\tproceduralType: type.id,\n\t\t\t\t\t});\n\t\t\t\t}\n",
	"\t\t\t\tif (architectureProfile) {\n\t\t\t\t\tconst geographyScore = scoreSettlementArchitectureSite(architectureProfile.id, candidateSurfaceContext);\n\t\t\t\t\tconst assetVariant = selectSettlementArchitectureVariant(\n\t\t\t\t\t\tarchitectureProfile.id,\n\t\t\t\t\t\tcandidateSurfaceContext,\n\t\t\t\t\t\t((houseIndex + 1) * 0.61803398875) % 1,\n\t\t\t\t\t);\n\t\t\t\t\tarchitectureCandidatesHere.push({\n\t\t\t\t\t\tseatId: seat.id, x, z, yaw, houseIndex, stepStartIndex,\n\t\t\t\t\t\tstepCount: STOOP_STEP_COUNT,\n\t\t\t\t\t\ttargetWidthMeters: type.width,\n\t\t\t\t\t\ttargetDepthMeters: type.depth,\n\t\t\t\t\t\ttargetFootprintMeters: Math.max(type.width, type.depth),\n\t\t\t\t\t\tproceduralType: type.id,\n\t\t\t\t\t\tassetVariant,\n\t\t\t\t\t\tsurfaceContext: candidateSurfaceContext,\n\t\t\t\t\t\tarchitectureScore: geographyScore,\n\t\t\t\t\t});\n\t\t\t\t}\n",
	'candidate geography routing',
);

replaceOnce(
	"\t\tconst profile = resolveVillageArchitectureProfile(site.seatId);\n\t\tconst assetUrl = resolveVillageArchitectureAssetUrl(profile, site);\n",
	"\t\tconst profile = resolveVillageArchitectureProfile(site.seatId);\n\t\tconst assetUrl = resolveVillageArchitectureAssetUrl(profile, site);\n\t\tconst geographyEvidence = resolveSettlementArchitectureEvidence(profile.id, {\n\t\t\t...(site.surfaceContext || {}),\n\t\t\troll: ((site.houseIndex + 1) * 0.61803398875) % 1,\n\t\t});\n",
	'asset geography evidence',
);

replaceOnce(
	"\t\t\tassetUrl,\n\t\t\ttextureSize: ARCHITECTURE_TEXTURE_SIZE,\n\t\t\tdistributionDistanceMeters: Number.isFinite(site.distributionDistanceMeters) ? site.distributionDistanceMeters : null,\n\t\t\tfootprint: object.userData.architectureFootprint,\n\t\t\tmanifest: prepared.manifest,\n",
	"\t\t\tassetUrl,\n\t\t\ttextureSize: ARCHITECTURE_TEXTURE_SIZE,\n\t\t\tdistributionDistanceMeters: Number.isFinite(site.distributionDistanceMeters) ? site.distributionDistanceMeters : null,\n\t\t\tgeographyScore: geographyEvidence.score,\n\t\t\tgeographyVariant: site.assetVariant || geographyEvidence.variant,\n\t\t\tpreferredMaterialRoles: Object.freeze({\n\t\t\t\twall: resolveSettlementPreferredMaterialRole(profile.id, 'wall'),\n\t\t\t\troof: resolveSettlementPreferredMaterialRole(profile.id, 'roof'),\n\t\t\t\ttimber: resolveSettlementPreferredMaterialRole(profile.id, 'timber'),\n\t\t\t\ttrim: resolveSettlementPreferredMaterialRole(profile.id, 'trim'),\n\t\t\t}),\n\t\t\tsurfaceContext: geographyEvidence.context,\n\t\t\tfootprint: object.userData.architectureFootprint,\n\t\t\tmanifest: prepared.manifest,\n",
	'asset manifest geography/material provenance',
);

replaceOnce(
	"\tgroup.add(bodyMesh, roofMesh, stepMesh, wallMesh);\n\tgroup.userData.villageLandmarkSites = landmarkSites.map((site) => ({ ...site }));\n",
	"\tgroup.add(bodyMesh, roofMesh, stepMesh, wallMesh);\n\tgroup.userData.villageLandmarkSites = landmarkSites.map((site) => ({ ...site }));\n\tgroup.userData.villageArchitectureGeographyPolicy = 'settlement-geography-asset-material-v1-2026-09-07';\n",
	'group geography policy evidence',
);

fs.writeFileSync(villagesPath, updated);
console.log('[migrateSettlementGeographyCurrentMain] PATCH_APPLIED', JSON.stringify({
	policyId: 'settlement-geography-asset-material-v1-2026-09-07',
	changedBytes: updated.length - villages.length,
}));