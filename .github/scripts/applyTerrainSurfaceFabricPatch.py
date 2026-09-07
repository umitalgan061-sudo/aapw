from pathlib import Path

path = Path('src/3d/world/terrain.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "import {\n\tTERRAIN_MICRO_SURFACE_POLICY,\n\tterrainMicroUvAt,\n\tgetSharedTerrainMicroSurfaceTextures,\n\tapplyTerrainMicroSurface,\n} from './terrainMicroSurface.js';",
        "import {\n\tTERRAIN_MICRO_SURFACE_POLICY,\n\tterrainMicroUvAt,\n\tgetSharedTerrainMicroSurfaceTextures,\n\tapplyTerrainMicroSurface,\n} from './terrainMicroSurface.js';\nimport {\n\tTERRAIN_SURFACE_FABRIC_POLICY,\n\tapplyTerrainSurfaceFabric,\n\tbuildTerrainSurfaceManifest,\n} from './terrainSurfaceFabric.js';\nimport {\n\tTERRAIN_ENVIRONMENT_PROFILE_POLICY,\n\tlistEnvironmentAssetFamilyRequirements,\n\tresolveTerrainEnvironmentProfile,\n} from './terrainEnvironmentProfiles.js';",
    ),
    (
        "export { TERRAIN_MICRO_SURFACE_POLICY, terrainMicroUvAt, getSharedTerrainMicroSurfaceTextures, applyTerrainMicroSurface };",
        "export { TERRAIN_MICRO_SURFACE_POLICY, terrainMicroUvAt, getSharedTerrainMicroSurfaceTextures, applyTerrainMicroSurface };\nexport { TERRAIN_SURFACE_FABRIC_POLICY, applyTerrainSurfaceFabric, buildTerrainSurfaceManifest };\nexport { TERRAIN_ENVIRONMENT_PROFILE_POLICY, listEnvironmentAssetFamilyRequirements, resolveTerrainEnvironmentProfile };",
    ),
    (
        "\tapplyTerrainMicroSurface(material);",
        "\tapplyTerrainMicroSurface(material);\n\tapplyTerrainSurfaceFabric(material);",
    ),
    (
        "\tmesh.userData.currentTerrainMicroSurface = material.userData.terrainMicroSurface;",
        "\tmesh.userData.currentTerrainMicroSurface = material.userData.terrainMicroSurface;\n\tmesh.userData.currentTerrainSurfaceFabric = Object.freeze({\n\t\tpolicyId: TERRAIN_SURFACE_FABRIC_POLICY.id,\n\t\tworldSpace: true,\n\t\tperiodicTextureSupplemental: true,\n\t\tcanonicalHeightUnchanged: true,\n\t\tcanonicalHydrologyUnchanged: true,\n\t\tcanonicalColliderUnchanged: true,\n\t});\n\tmesh.userData.currentTerrainEnvironmentProfiles = Object.freeze({\n\t\tpolicyId: TERRAIN_ENVIRONMENT_PROFILE_POLICY.id,\n\t\tmaterialAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.materialAuthority,\n\t\tplacementAuthority: TERRAIN_ENVIRONMENT_PROFILE_POLICY.placementAuthority,\n\t\tplaceholderAllowed: false,\n\t\tdeterministicTransformRequired: true,\n\t\tmanifestRequired: true,\n\t});",
    ),
]

for needle, replacement in replacements:
    count = text.count(needle)
    if count != 1:
        raise SystemExit(f'expected exactly one integration anchor, found {count}: {needle[:80]}')
    text = text.replace(needle, replacement)

path.write_text(text, encoding='utf-8')
print('terrain.js exact integration patch applied')
