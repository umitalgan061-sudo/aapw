from pathlib import Path

terrain_path = Path('src/3d/world/terrainBiomeShading.js')
vegetation_path = Path('src/3d/world/vegetation.js')
test_path = Path('scripts/checkVegetationEcologicalGroves.mjs')
workflow_path = Path('.github/workflows/_apply-vegetation-habitat-once.yml')
self_path = Path('scripts/_applyVegetationHabitatOnce.py')

terrain = terrain_path.read_text()
vegetation = vegetation_path.read_text()
test = test_path.read_text()

terrain_anchor = "const scratchRock = new THREE.Color();\nconst scratchGround = new THREE.Color();"
assert terrain_anchor in terrain
terrain_helper = '''function computeTerrainForestSuitability(out, {
\theightAboveSeaMeters,
\tslopeDegrees,
\tworldX = 0,
\tworldZ = 0,
\tnorthClimate = null,
}) {
\tconst P = TERRAIN_BIOME_SHADING_POLICY;
\tconst climate = northClimate ?? northReferenceCryosphereAtWorldXZ(worldX, worldZ);
\tconst forestNoise01 = signedFbmNoise(
\t\tworldX * P.forestPatchFrequency - 13.1,
\t\tworldZ * P.forestPatchFrequency + 7.4,
\t\tP.forestPatchOctaves,
\t) * 0.5 + 0.5;
\tconst forestPatch = smoothstep(P.forestPatchStart, P.forestPatchFull, forestNoise01);
\tconst notCliff = 1 - smoothstep(P.forestSlopeFalloffStartDegrees, P.forestSlopeFalloffFullDegrees, slopeDegrees);
\tconst belowTreeLine = 1 - smoothstep(P.forestTreeLineStartMeters, P.forestTreeLineFullMeters, heightAboveSeaMeters);
\tconst forestAmount = forestPatch * notCliff * belowTreeLine * P.forestMaxStrength
\t\t* (1 - climate.permanentIce) * (1 - climate.tundra * 0.62);
\tout.forestNoise01 = forestNoise01;
\tout.forestPatch = forestPatch;
\tout.notCliff = notCliff;
\tout.belowTreeLine = belowTreeLine;
\tout.permanentIce = climate.permanentIce;
\tout.tundra = climate.tundra;
\tout.forestAmount = forestAmount;
\tout.suitability = clamp01(forestAmount / Math.max(1e-6, P.forestMaxStrength));
\treturn out;
}

/**
 * Shared deterministic habitat answer for systems that must agree with the terrain's visible forest
 * mosaic. It is read-only: canonical height, hydrology, coastline and colliders remain untouched.
 */
export function resolveTerrainForestSuitability({
\theightAboveSeaMeters,
\tslopeDegrees,
\tworldX = 0,
\tworldZ = 0,
}) {
\treturn Object.freeze({ ...computeTerrainForestSuitability({}, {
\t\theightAboveSeaMeters,
\t\tslopeDegrees,
\t\tworldX,
\t\tworldZ,
\t}) });
}

const scratchForestSuitability = {};
'''
terrain = terrain.replace(terrain_anchor, terrain_helper + terrain_anchor, 1)

old_forest = '''\tconst forestNoise01 = signedFbmNoise(worldX * P.forestPatchFrequency - 13.1, worldZ * P.forestPatchFrequency + 7.4, P.forestPatchOctaves) * 0.5 + 0.5;
\tconst forestPatch = smoothstep(P.forestPatchStart, P.forestPatchFull, forestNoise01);
\tconst notCliff = 1 - smoothstep(P.forestSlopeFalloffStartDegrees, P.forestSlopeFalloffFullDegrees, slope);
\tconst belowTreeLine = 1 - smoothstep(P.forestTreeLineStartMeters, P.forestTreeLineFullMeters, height);
\tconst forestAmount = forestPatch * notCliff * belowTreeLine * P.forestMaxStrength * (1 - permanentNorth) * (1 - tundraNorth * 0.62);
\tif (forestAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.FOREST, forestAmount);'''
new_forest = '''\tconst forest = computeTerrainForestSuitability(scratchForestSuitability, {
\t\theightAboveSeaMeters: height,
\t\tslopeDegrees: slope,
\t\tworldX,
\t\tworldZ,
\t\tnorthClimate,
\t});
\tif (forest.forestAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.FOREST, forest.forestAmount);'''
assert old_forest in terrain
terrain = terrain.replace(old_forest, new_forest, 1)

old_import = "import { northClimateWeightsAtWorldZ } from './terrainBiomeShading.js';"
new_import = "import { northClimateWeightsAtWorldZ, resolveTerrainForestSuitability } from './terrainBiomeShading.js';"
assert old_import in vegetation
vegetation = vegetation.replace(old_import, new_import, 1)

old_policy = '''export const VEGETATION_SPATIAL_PATTERN_POLICY = Object.freeze({
\tid: 'vegetation-ecological-grove-scatter-2026-08-31-v2-settlement-pockets',
\tclimateAuthority: VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority,'''
new_policy = '''export const VEGETATION_SPATIAL_PATTERN_POLICY = Object.freeze({
\tid: 'vegetation-ecological-grove-scatter-2026-09-01-v3-terrain-habitat',
\tclimateAuthority: VEGETATION_NORTH_CLIMATE_POLICY.climateAuthority,
\ttemperateHabitatAuthority: 'terrainBiomeShading.resolveTerrainForestSuitability',
\ttemperateHabitatAcceptanceFloor: 0.12,
\ttemperateHabitatAcceptanceGain: 0.88,
\tcoldClimateHabitatPreserved: true,'''
assert old_policy in vegetation
vegetation = vegetation.replace(old_policy, new_policy, 1)

old_placeable_sig = "export function isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges }) {"
new_placeable_sig = "export function isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges, outSite = null }) {"
assert old_placeable_sig in vegetation
vegetation = vegetation.replace(old_placeable_sig, new_placeable_sig, 1)

old_slope_return = '''\tconst gradeXDegrees = (Math.atan2(Math.abs(dxHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
\tconst gradeZDegrees = (Math.atan2(Math.abs(dzHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
\treturn Math.max(gradeXDegrees, gradeZDegrees) <= MAX_GROUND_SLOPE_DEGREES;'''
new_slope_return = '''\tconst gradeXDegrees = (Math.atan2(Math.abs(dxHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
\tconst gradeZDegrees = (Math.atan2(Math.abs(dzHeight), SLOPE_SAMPLE_OFFSET_METERS) * 180) / Math.PI;
\tconst slopeDegrees = Math.max(gradeXDegrees, gradeZDegrees);
\tif (outSite && typeof outSite === 'object') {
\t\toutSite.groundY = groundY;
\t\toutSite.heightAboveSeaMeters = groundY - seaLevelMeters;
\t\toutSite.slopeDegrees = slopeDegrees;
\t}
\treturn slopeDegrees <= MAX_GROUND_SLOPE_DEGREES;'''
assert old_slope_return in vegetation
vegetation = vegetation.replace(old_slope_return, new_slope_return, 1)

loop_anchor = "\tlet groveBackgroundChance = spatialPolicy.temperateBackgroundChance;\n\n\tfor (let treeIndex = 0; treeIndex < baseTargetCount; treeIndex++) {"
assert loop_anchor in vegetation
vegetation = vegetation.replace(loop_anchor,
    "\tlet groveBackgroundChance = spatialPolicy.temperateBackgroundChance;\n\tlet baseHabitatRejected = 0;\n\n\tfor (let treeIndex = 0; treeIndex < baseTargetCount; treeIndex++) {", 1)

old_candidate = '''\t\t\tconst { x, z } = candidate;
\t\t\tif (Math.hypot(x, z) > radiusMeters) continue;
\t\t\tif (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges })) continue;
\t\t\tif (!groveHasCenter) {'''
new_candidate = '''\t\t\tconst { x, z } = candidate;
\t\t\tif (Math.hypot(x, z) > radiusMeters) continue;
\t\t\tconst site = {};
\t\t\tif (!isPlaceablePosition(x, z, { sampleHeightMeters, seaLevelMeters, seats, roadEdges, outSite: site })) continue;
\t\t\tconst climate = northReferenceCryosphereAtWorldXZ(x, z);
\t\t\tif (Math.max(climate.permanentIce, climate.tundra) < VEGETATION_NORTH_CLIMATE_POLICY.tundraClimateThreshold) {
\t\t\t\tconst habitat = resolveTerrainForestSuitability({
\t\t\t\t\theightAboveSeaMeters: site.heightAboveSeaMeters,
\t\t\t\t\tslopeDegrees: site.slopeDegrees,
\t\t\t\t\tworldX: x,
\t\t\t\t\tworldZ: z,
\t\t\t\t});
\t\t\t\tconst habitatChance = Math.min(1, spatialPolicy.temperateHabitatAcceptanceFloor
\t\t\t\t\t+ habitat.suitability * spatialPolicy.temperateHabitatAcceptanceGain);
\t\t\t\tif (rng() > habitatChance) {
\t\t\t\t\tbaseHabitatRejected++;
\t\t\t\t\tcontinue;
\t\t\t\t}
\t\t\t}
\t\t\tif (!groveHasCenter) {'''
assert old_candidate in vegetation
vegetation = vegetation.replace(old_candidate, new_candidate, 1)

metadata_anchor = '''\t\tbaseDensityPerKm2: densityPerKm2,
\t\tgroveTreeCountMin: spatialPolicy.groveTreeCountMin,'''
metadata_new = '''\t\tbaseDensityPerKm2: densityPerKm2,
\t\ttemperateHabitatAuthority: spatialPolicy.temperateHabitatAuthority,
\t\ttemperateHabitatAcceptanceFloor: spatialPolicy.temperateHabitatAcceptanceFloor,
\t\tbaseHabitatRejected,
\t\tcoldClimateHabitatPreserved: spatialPolicy.coldClimateHabitatPreserved,
\t\tgroveTreeCountMin: spatialPolicy.groveTreeCountMin,'''
assert metadata_anchor in vegetation
vegetation = vegetation.replace(metadata_anchor, metadata_new, 1)

return_anchor = '''\t\twinterTreeCount,
\t};
}'''
return_new = '''\t\twinterTreeCount,
\t\tbaseHabitatRejected,
\t};
}'''
assert return_anchor in vegetation
vegetation = vegetation.replace(return_anchor, return_new, 1)

import_anchor = "} from '../src/3d/world/vegetation.js';"
assert import_anchor in test
test = test.replace(import_anchor,
    "} from '../src/3d/world/vegetation.js';\nimport { resolveTerrainForestSuitability } from '../src/3d/world/terrainBiomeShading.js';", 1)
old_test_policy = "\t'vegetation-ecological-grove-scatter-2026-08-31-v2-settlement-pockets');"
assert old_test_policy in test
test = test.replace(old_test_policy,
    "\t'vegetation-ecological-grove-scatter-2026-09-01-v3-terrain-habitat');", 1)

old_budget_assert = "\tassert.equal(first.placedCount, first.targetCount, 'flat-land fixture must retain the requested total tree budget');"
new_budget_assert = '''\tassert(first.placedCount >= Math.floor(first.targetCount * 0.70),
\t\t`terrain habitat gating removed too much of the bounded tree budget: ${first.placedCount}/${first.targetCount}`);
\tassert(first.placedCount <= first.targetCount);
\tassert(first.baseHabitatRejected > 0, 'temperate base scatter never exercised terrain habitat rejection');'''
assert old_budget_assert in test
test = test.replace(old_budget_assert, new_budget_assert, 1)

metadata_test_anchor = "\tassert.equal(first.group.userData.vegetationSpatialPattern.baseDensityPerKm2, DENSITY_PER_KM2);"
metadata_test_new = metadata_test_anchor + '''
\tassert.equal(first.group.userData.vegetationSpatialPattern.temperateHabitatAuthority,
\t\t'terrainBiomeShading.resolveTerrainForestSuitability');
\tassert.equal(first.group.userData.vegetationSpatialPattern.baseHabitatRejected, first.baseHabitatRejected);

\tconst placedHabitatMean = firstPoints.reduce((sum, [x, z]) => sum + resolveTerrainForestSuitability({
\t\theightAboveSeaMeters: 100,
\t\tslopeDegrees: 0,
\t\tworldX: x,
\t\tworldZ: z,
\t}).suitability, 0) / firstPoints.length;
\tlet baselineHabitatSum = 0;
\tlet baselineHabitatCount = 0;
\tfor (let z = -RADIUS_METERS; z <= RADIUS_METERS; z += 150) {
\t\tfor (let x = -RADIUS_METERS; x <= RADIUS_METERS; x += 150) {
\t\t\tif (Math.hypot(x, z) > RADIUS_METERS) continue;
\t\t\tbaselineHabitatSum += resolveTerrainForestSuitability({
\t\t\t\theightAboveSeaMeters: 100,
\t\t\t\tslopeDegrees: 0,
\t\t\t\tworldX: x,
\t\t\t\tworldZ: z,
\t\t\t}).suitability;
\t\t\tbaselineHabitatCount++;
\t\t}
\t}
\tconst baselineHabitatMean = baselineHabitatSum / baselineHabitatCount;
\tassert(placedHabitatMean > baselineHabitatMean + 0.035,
\t\t`tree scatter did not move toward terrain forest habitat: ${placedHabitatMean} <= ${baselineHabitatMean}`);'''
assert metadata_test_anchor in test
test = test.replace(metadata_test_anchor, metadata_test_new, 1)

log_anchor = "\t\tmeanNearestNeighbourMeters: Number(nearest.toFixed(2)),"
log_new = log_anchor + "\n\t\tbaseHabitatRejected: first.baseHabitatRejected,\n\t\tplacedHabitatMean: Number(placedHabitatMean.toFixed(3)),\n\t\tbaselineHabitatMean: Number(baselineHabitatMean.toFixed(3)),"
assert log_anchor in test
test = test.replace(log_anchor, log_new, 1)

terrain_path.write_text(terrain)
vegetation_path.write_text(vegetation)
test_path.write_text(test)
workflow_path.unlink(missing_ok=True)
self_path.unlink(missing_ok=True)
