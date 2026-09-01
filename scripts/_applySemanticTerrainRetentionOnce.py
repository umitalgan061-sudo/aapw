from pathlib import Path

terrain_path = Path('src/3d/world/terrainMicroSurface.js')
terrain_test_path = Path('scripts/checkTerrainMicroSurface.mjs')
vegetation_test_path = Path('scripts/checkVegetationVisualContract.js')
water_test_path = Path('scripts/checkWaterVisualContract.js')
workflow_path = Path('.github/workflows/_apply-semantic-terrain-retention-once.yml')
self_path = Path('scripts/_applySemanticTerrainRetentionOnce.py')

terrain = terrain_path.read_text()
terrain_test = terrain_test_path.read_text()
vegetation_test = vegetation_test_path.read_text()
water_test = water_test_path.read_text()

old_policy = """\t// Public id advances because the coastal response is now a bounded, multi-scale weathering pass\n\t// rather than a broad uniform dampness halo. Geography, height and hydrology remain untouched.\n\tid: 'terrain-micro-surface-world-uv-pbr-v7-coastal-weathering',"""
new_policy = """\t// Public id advances because the final render now preserves a bounded amount of the semantic\n\t// terrain palette after ecological/weathering remaps. Geography, height and hydrology stay untouched.\n\tid: 'terrain-micro-surface-world-uv-pbr-v8-semantic-palette-retention',"""
assert old_policy in terrain
terrain = terrain.replace(old_policy, new_policy, 1)

policy_anchor = "\tnaturalAlbedoRemap: true,\n\tregionalMoistureVariation: true,"
assert policy_anchor in terrain
terrain = terrain.replace(policy_anchor, "\tnaturalAlbedoRemap: true,\n\tsemanticPaletteRetention: true,\n\tregionalMoistureVariation: true,", 1)

old_key = "const TERRAIN_PHOTOREAL_SHADER_KEY = 'terrain-photoreal-world-surface-v7-coastal-weathering';"
new_key = "const TERRAIN_PHOTOREAL_SHADER_KEY = 'terrain-photoreal-world-surface-v8-semantic-palette-retention';"
assert old_key in terrain
terrain = terrain.replace(old_key, new_key, 1)

retention_anchor = """diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoEarth, terrainPhotoEarthRemap);\nfloat terrainPhotoStonyPatch = (1.0 - terrainPhotoSnow) * smoothstep(0.61, 0.85, terrainPhotoMeso)\n\t* (0.18 + terrainPhotoElevation * 0.58) * (1.0 - terrainPhotoVegetation * 0.52);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.267, 0.260, 0.244), terrainPhotoStonyPatch * 0.29);\n\nfloat terrainPhotoScreeBand ="""
retention_new = """diffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoEarth, terrainPhotoEarthRemap);\nfloat terrainPhotoStonyPatch = (1.0 - terrainPhotoSnow) * smoothstep(0.61, 0.85, terrainPhotoMeso)\n\t* (0.18 + terrainPhotoElevation * 0.58) * (1.0 - terrainPhotoVegetation * 0.52);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.267, 0.260, 0.244), terrainPhotoStonyPatch * 0.29);\n\n// Keep weathering dominant, but retain enough of the upstream semantic palette for meadow/heath/\n// exposed-earth distinctions to survive at aerial scale. Snow, rock and wet coastal bands remain\n// authoritative and are explicitly protected from this restrained colour-memory pass.\nfloat terrainPhotoPaletteRetention = clamp(\n\tterrainPhotoVegetation * (0.115 + terrainPhotoChroma * 0.22) + terrainPhotoWarmGround * 0.085,\n\t0.0, 0.17\n) * (1.0 - terrainPhotoSnow)\n\t* (1.0 - terrainPhotoRock * 0.62)\n\t* (1.0 - terrainPhotoCoastalWet * 0.72)\n\t* (1.0 - terrainPhotoTideStain * 0.55);\ndiffuseColor.rgb = mix(diffuseColor.rgb, terrainPhotoBase, terrainPhotoPaletteRetention);\n\nfloat terrainPhotoScreeBand ="""
assert retention_anchor in terrain
terrain = terrain.replace(retention_anchor, retention_new, 1)

userdata_anchor = "\t\tnaturalAlbedoRemap: true,\n\t\tregionalMoistureVariation: true,"
assert userdata_anchor in terrain
terrain = terrain.replace(userdata_anchor, "\t\tnaturalAlbedoRemap: true,\n\t\tsemanticPaletteRetention: true,\n\t\tregionalMoistureVariation: true,", 1)

terrain_test = terrain_test.replace(
    "assert.equal(TERRAIN_MICRO_SURFACE_POLICY.id, 'terrain-micro-surface-world-uv-pbr-v7-coastal-weathering');",
    "assert.equal(TERRAIN_MICRO_SURFACE_POLICY.id, 'terrain-micro-surface-world-uv-pbr-v8-semantic-palette-retention');",
    1,
)
assert "assert.equal(TERRAIN_MICRO_SURFACE_POLICY.naturalAlbedoRemap, true);" in terrain_test
terrain_test = terrain_test.replace(
    "assert.equal(TERRAIN_MICRO_SURFACE_POLICY.naturalAlbedoRemap, true);",
    "assert.equal(TERRAIN_MICRO_SURFACE_POLICY.naturalAlbedoRemap, true);\nassert.equal(TERRAIN_MICRO_SURFACE_POLICY.semanticPaletteRetention, true);",
    1,
)
assert "assert.equal(standalone.userData.terrainMicroSurface.naturalAlbedoRemap, true);" in terrain_test
terrain_test = terrain_test.replace(
    "assert.equal(standalone.userData.terrainMicroSurface.naturalAlbedoRemap, true);",
    "assert.equal(standalone.userData.terrainMicroSurface.naturalAlbedoRemap, true);\nassert.equal(standalone.userData.terrainMicroSurface.semanticPaletteRetention, true);",
    1,
)
terrain_test = terrain_test.replace(
    "assert.equal(standalone.customProgramCacheKey(), 'terrain-photoreal-world-surface-v7-coastal-weathering');",
    "assert.equal(standalone.customProgramCacheKey(), 'terrain-photoreal-world-surface-v8-semantic-palette-retention');",
    1,
)
marker_anchor = "  'terrainPhotoEarth',\n  'terrainPhotoStonyPatch',"
assert marker_anchor in terrain_test
terrain_test = terrain_test.replace(marker_anchor, "  'terrainPhotoEarth',\n  'terrainPhotoPaletteRetention',\n  'terrainPhotoStonyPatch',", 1)

veg_import_anchor = """\t\t\t\tcreateVegetation,\n\t\t\t\tdisposeVegetation,\n\t\t\t\tVEGETATION_SILHOUETTE_POLICY,\n\t\t\t} = await import('/src/3d/world/vegetation.js');"""
veg_import_new = """\t\t\t\tcreateVegetation,\n\t\t\t\tdisposeVegetation,\n\t\t\t\tVEGETATION_SILHOUETTE_POLICY,\n\t\t\t\tVEGETATION_SPATIAL_PATTERN_POLICY,\n\t\t\t} = await import('/src/3d/world/vegetation.js');"""
assert veg_import_anchor in vegetation_test
vegetation_test = vegetation_test.replace(veg_import_anchor, veg_import_new, 1)

old_veg_assert = """\t\t\tfail(first.targetCount > 0 && first.placedCount === first.targetCount,\n\t\t\t\t`unexpected placement ${first.placedCount}/${first.targetCount}`);"""
new_veg_assert = """\t\t\tfail(first.targetCount > 0 && first.placedCount > 0 && first.placedCount <= first.targetCount,\n\t\t\t\t`unexpected bounded placement ${first.placedCount}/${first.targetCount}`);\n\t\t\tfail(first.baseHabitatRejected > 0, 'temperate browser fixture never exercised terrain habitat rejection');\n\t\t\tfail(first.group.userData.vegetationSpatialPattern?.temperateHabitatAuthority\n\t\t\t\t=== VEGETATION_SPATIAL_PATTERN_POLICY.temperateHabitatAuthority,\n\t\t\t\t'vegetation browser fixture lost terrain habitat authority metadata');"""
assert old_veg_assert in vegetation_test
vegetation_test = vegetation_test.replace(old_veg_assert, new_veg_assert, 1)

return_anchor = """\t\t\t\ttargetCount: first.targetCount,\n\t\t\t\tplacedCount: first.placedCount,"""
assert return_anchor in vegetation_test
vegetation_test = vegetation_test.replace(return_anchor, "\t\t\t\ttargetCount: first.targetCount,\n\t\t\t\tplacedCount: first.placedCount,\n\t\t\t\tbaseHabitatRejected: first.baseHabitatRejected,", 1)
old_outer = "\t\tassert(result.targetCount === result.placedCount, 'target/placed mismatch escaped browser contract');"
new_outer = "\t\tassert(result.placedCount > 0 && result.placedCount <= result.targetCount, 'bounded habitat placement escaped browser contract');\n\t\tassert(result.baseHabitatRejected > 0, 'habitat rejection metadata escaped browser contract');"
assert old_outer in vegetation_test
vegetation_test = vegetation_test.replace(old_outer, new_outer, 1)

water_import_anchor = "\t\t\tconst { publishCelestialLightState } = await import('/src/3d/celestialLightState.js');"
assert water_import_anchor in water_test
water_test = water_test.replace(
    water_import_anchor,
    water_import_anchor + "\n\t\t\tconst { GEOGRAPHIC_REFERENCE_PALETTE } = await import('/src/3d/world/geographicReferencePalette.js');",
    1,
)
old_water = """\t\t\tfail(uniforms.uShallowColor.value.getHex() === 0x6aa39c, 'reference clear-shore hue drifted');\n\t\t\tfail(uniforms.uDeepColor.value.getHex() === 0x092941, 'reference deep-sea hue drifted');"""
new_water = """\t\t\tfail(uniforms.uShallowColor.value.getHex() === GEOGRAPHIC_REFERENCE_PALETTE.water.shoreClear,\n\t\t\t\t'reference clear-shore hue diverged from shared geographic palette authority');\n\t\t\tfail(uniforms.uDeepColor.value.getHex() === GEOGRAPHIC_REFERENCE_PALETTE.water.deepSea,\n\t\t\t\t'reference deep-sea hue diverged from shared geographic palette authority');"""
assert old_water in water_test
water_test = water_test.replace(old_water, new_water, 1)

terrain_path.write_text(terrain)
terrain_test_path.write_text(terrain_test)
vegetation_test_path.write_text(vegetation_test)
water_test_path.write_text(water_test)

workflow_path.unlink(missing_ok=True)
self_path.unlink(missing_ok=True)
