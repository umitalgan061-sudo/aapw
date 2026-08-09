# Meshy source batch — 2026-08-08

This folder preserves the six original, unchanged model downloads supplied by the project owner.

The sources contained one GLB and five FBX files. Each was a single static high-poly mesh with no UV layer, material, texture, skeleton, or animation.

Derived assets were produced in Blender 4.5.12 LTS with repeating cube UVs, one embedded model-specific material, and one generated base-color texture:

| Original source | Runtime GLB | Textured FBX | Standalone texture |
|---|---|---|---|
| `Meshy_AI_Create_exactly_ONE_dr_0808193627_generate.glb` | `../../assets/models/creatures/dragons/storm_dragon_textured.glb` | `textured_fbx/storm_dragon_textured.fbx` | `../../assets/models/creatures/dragons/textures/storm_cobalt_scales.png` |
| `Meshy_AI_Create_exactly_ONE_hi_0808194328_generate.fbx` | `../../assets/models/creatures/dragons/verdant_dragon_textured.glb` | `textured_fbx/verdant_dragon_textured.fbx` | `../../assets/models/creatures/dragons/textures/verdant_bronze_scales.png` |
| `Meshy_AI_Frostwing_Dragon_0808195300_generate.fbx` | `../../assets/models/creatures/dragons/frostwing_dragon_textured.glb` | `textured_fbx/frostwing_dragon_textured.fbx` | `../../assets/models/creatures/dragons/textures/frostwing_ice_scales.png` |
| `Meshy_AI_Golden_Ember_Dragon_0808200332_generate.fbx` | `../../assets/models/creatures/dragons/golden_ember_dragon_textured.glb` | `textured_fbx/golden_ember_dragon_textured.fbx` | `../../assets/models/creatures/dragons/textures/golden_ember_scales.png` |
| `Meshy_AI_Obsidian_Wyvern_0808195051_generate.fbx` | `../../assets/models/creatures/dragons/obsidian_wyvern_textured.glb` | `textured_fbx/obsidian_wyvern_textured.fbx` | `../../assets/models/creatures/dragons/textures/obsidian_wyvern_scales.png` |
| `Meshy_AI_Iron_Throne_0808200614_generate.fbx` | `../../assets/models/props/iron_throne/iron_throne_textured.glb` | `textured_fbx/iron_throne_textured.fbx` | `../../assets/models/props/iron_throne/weathered_iron.png` |

All twelve derived FBX/GLB files were re-imported successfully. Every file reported one mesh, one UV layer, one material, and one packed image. The six final GLBs were also rendered after re-import to confirm their embedded textures.

These assets are static and not yet rigged or animated. The runtime GLBs are high-poly reference assets; decimate them before wiring them into performance-sensitive gameplay.
