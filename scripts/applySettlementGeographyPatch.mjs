#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targetPath = path.join(ROOT, 'src/3d/world/villages.js');
const source = fs.readFileSync(targetPath, 'utf8');
if (source.includes("./settlementGeographyPolicy.js")) {
	console.log('[applySettlementGeographyPatch] already applied');
	process.exit(0);
}
let updated = source;

function replaceOnce(before, after, label) {
	const count = updated.split(before).length - 1;
	if (count !== 1) throw new Error(`[applySettlementGeographyPatch] ${label}: expected 1 match, found ${count}`);
	updated = updated.replace(before, after);
}

replaceOnce(
	"import { createStoneMaterial, createRoofMaterial } from './materials.js';\n",
	"import { createStoneMaterial, createRoofMaterial } from './materials.js';\nimport {\n\tcompareSettlementArchitectureCandidates,\n\tresolveSettlementArchitectureEvidence,\n\tresolveSettlementArchitectureVariant,\n\tresolveSettlementPreferredMaterialRole,\n\tscoreSettlementArchitectureSite,\n\tselectSettlementArchitectureVariant,\n} from './settlementGeographyPolicy.js';\n",
	'import block',
);

replaceOnce(
"function resolveVillageArchitectureAssetUrl(profile, site) {\n\treturn (site?.assetIndex ?? 0) > 0 ? (profile.secondaryAssetUrl || profile.assetUrl) : profile.assetUrl;\n}\n",
"function resolveVillageArchitectureAssetUrl(profile, site) {\n\tif (site?.assetVariant === 'secondary') return profile.secondaryAssetUrl || profile.assetUrl;\n\treturn (site?.assetIndex ?? 0) > 0 ? (profile.secondaryAssetUrl || profile.assetUrl) : profile.assetUrl;\n}\n",
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

replaceOnce(
"\t\tconst profile = resolveVillageArchitectureProfile(site.seatId);\n\t\tconst assetUrl = resolveVillageArchitectureAssetUrl(profile, site);\n",
"\t\tconst profile = resolveVillageArchitectureProfile(site.seatId);\n\t\tconst assetUrl = resolveVillageArchitectureAssetUrl(profile, site);\n\t\tconst geographyEvidence = resolveSettlementArchitectureEvidence(profile.id, {\n\t\t\t...(site.surfaceContext || {}),\n\t\t\troll: ((site.houseIndex ?? 0) * 0.61803398875) % 1,\n\t\t});\n",
	'upgrade geography evidence',
);

replaceOnce(
"\t\t\tassetUrl,\n\t\t\ttextureSize: ARCHITECTURE_TEXTURE_SIZE,\n\t\t\tdistributionDistanceMeters: Number.isFinite(site.distributionDistanceMeters) ? site.distributionDistanceMeters : null,\n\t\t\tfootprint: object.userData.architectureFootprint,\n\t\t\tmanifest: prepared.manifest,\n",
"\t\t\tassetUrl,\n\t\t\ttextureSize: ARCHITECTURE_TEXTURE_SIZE,\n\t\t\tdistributionDistanceMeters: Number.isFinite(site.distributionDistanceMeters) ? site.distributionDistanceMeters : null,\n\t\t\tgeographyScore: geographyEvidence.score,\n\t\t\tgeographyVariant: geographyEvidence.variant,\n\t\t\tsurfaceContext: geographyEvidence.context,\n\t\t\tfootprint: object.userData.architectureFootprint,\n\t\t\tmanifest: prepared.manifest,\n",
	'geography manifest evidence',
);

replaceOnce(
"\t\t\tconst type = HOUSE_TYPES[pickHouseTypeIndex(rng())];\n\t\t\tconst yaw = Math.atan2(hamletX - x, hamletZ - z) + (rng() - 0.5) * 0.5;\n\t\t\tconst support = sampleFootprintRange(sampleHeightMeters, x, z, type.width, type.depth, yaw);\n",
"\t\t\tconst type = HOUSE_TYPES[pickHouseTypeIndex(rng())];\n\t\t\tconst yaw = Math.atan2(hamletX - x, hamletZ - z) + (rng() - 0.5) * 0.5;\n\t\t\tconst support = sampleFootprintRange(sampleHeightMeters, x, z, type.width, type.depth, yaw);\n\t\t\tconst candidateSurfaceContext = createVillageArchitectureSurfaceQuery(sampleHeightMeters, seaLevelMeters, roadEdges)(x, z);\n",
	'candidate surface context',
);

replaceOnce(
"\t\t\t\tif (architectureProfile) {\n\t\t\t\t\tarchitectureCandidatesHere.push({\n\t\t\t\t\t\tseatId: seat.id, x, z, yaw, houseIndex, stepStartIndex,\n\t\t\t\t\t\tstepCount: STOOP_STEP_COUNT,\n\t\t\t\t\t\ttargetWidthMeters: type.width,\n\t\t\t\t\t\ttargetDepthMeters: type.depth,\n\t\t\t\t\t\ttargetFootprintMeters: Math.max(type.width, type.depth),\n\t\t\t\t\t\tproceduralType: type.id,\n\t\t\t\t\t});\n\t\t\t\t}\n",
"\t\t\t\tif (architectureProfile) {\n\t\t\t\t\tconst geographyScore = scoreSettlementArchitectureSite(architectureProfile.id, candidateSurfaceContext);\n\t\t\t\t\tconst assetVariant = selectSettlementArchitectureVariant(\n\t\t\t\t\t\tarchitectureProfile.id,\n\t\t\t\t\t\tcandidateSurfaceContext,\n\t\t\t\t\t\t((houseIndex + 1) * 0.61803398875) % 1,\n\t\t\t\t\t);\n\t\t\t\t\tarchitectureCandidatesHere.push({\n\t\t\t\t\t\tseatId: seat.id, x, z, yaw, houseIndex, stepStartIndex,\n\t\t\t\t\t\tstepCount: STOOP_STEP_COUNT,\n\t\t\t\t\t\ttargetWidthMeters: type.width,\n\t\t\t\t\t\ttargetDepthMeters: type.depth,\n\t\t\t\t\t\ttargetFootprintMeters: Math.max(type.width, type.depth),\n\t\t\t\t\t\tproceduralType: type.id,\n\t\t\t\t\t\tassetVariant,\n\t\t\t\t\t\tsurfaceContext: candidateSurfaceContext,\n\t\t\t\t\t\tarchitectureScore: geographyScore,\n\t\t\t\t\t});\n\t\t\t\t}\n",
	'candidate geography selection',
);

replaceOnce(
"\tgroup.add(bodyMesh, roofMesh, stepMesh, wallMesh);\n\tgroup.userData.villageLandmarkSites = landmarkSites.map((site) => ({ ...site }));\n",
"\tgroup.add(bodyMesh, roofMesh, stepMesh, wallMesh);\n\tgroup.userData.villageLandmarkSites = landmarkSites.map((site) => ({ ...site }));\n\tgroup.userData.villageArchitectureGeographyPolicy = 'settlement-geography-asset-material-v1-2026-09-07';\n",
	'policy evidence metadata',
);

updated = updated.replace(
"\tcompareSettlementArchitectureCandidates,\n\tresolveSettlementArchitectureEvidence,\n\tresolveSettlementArchitectureVariant,\n\tresolveSettlementPreferredMaterialRole,\n",
"\tcompareSettlementArchitectureCandidates,\n\tresolveSettlementArchitectureEvidence,\n",
);

fs.writeFileSync(targetPath, updated);
console.log('[applySettlementGeographyPatch] applied deterministic geography integration');