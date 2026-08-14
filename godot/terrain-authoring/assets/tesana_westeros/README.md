# Tesana Westeros realism pack

This additive pack leaves the existing Terrain3D/HTerrain authoring scene unchanged. Open and run `res://scenes/tesana_westeros/westeros_realism_showcase.tscn` to inspect the integration.

Included content:

- 23 GLB models: seven characters plus buildings, structures, animals, props, and weapons
- Seven Godot animation libraries, attached at runtime to the matching humanoid skeletons
- 28 MP3 files covering ambience, exploration/combat/result music, animals, dragon, player, UI, and sword effects
- Four physically tuned water-body presets built from the Tesana water shader: ocean, lake, river, and pond
- Deterministic, MultiMesh-instanced northern pine forest with four structural variants and distance LOD
- PBR-oriented ground/path setup and a 2048x1024 photoreal storm panorama

Realism and performance controls are exported on the showcase root. `forest_tree_count` changes forest density, `spawn_full_asset_catalog` disables the secondary asset display, and `play_ambient_audio` mutes automatic ambience/music. The default scene is intended as a safe integration and inspection surface; production placement should follow the final Terrain3D height map.

Known integration considerations:

- Godot must complete its first import before GLBs, MP3s, and textures are available as engine resources.
- Character animation tracks target `%GeneralSkeleton`; the runtime adapter adds each library to the matching model without altering its source GLB.
- Water uses screen/depth textures. Verify the target renderer and tune reflection/refraction cost for low-end Web builds.
- Large binary files are assigned to Git LFS. Contributors need Git LFS installed before cloning or pulling this branch.
