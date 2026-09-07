# Geographic settlement-fringe props

This pass addresses a visual gap left between the existing canonical settlement architecture/functional landmarks and the wider terrain: the outer settlement edge has too little authored, climate-aware occupation detail.

## Scope boundary

The layer consumes, but does not replace, the canonical settlement seats, the existing road graph, owner-map biome zones, the existing terrain sampler and the shared `MaterialAssignmentCore` + `WorldAssetPlacementPipeline`. It does not create towns, roads, terrain, vegetation, NPCs, factions or a second settlement manager.

## Spatial rule

Props live in a deterministic 162–204 m annulus around canonical settlement seats. That keeps this pass outside the existing 115–155 m village/hamlet band. Candidate points are rejected when slope exceeds 22°, water depth exceeds 0.02 m, road distance is below 6 m, or local prop spacing is below 13 m.

## Geographic language

North/always-winter uses bonfire + cargo. Fertile/reach uses field dirt + storage + rest. Maritime uses cargo-first storage. Mountain/rocky regions use rest + cargo + sparse hearths. Arid/desert/steppe uses sparse cargo only. Jungle uses small, widely spaced storage. Temperate areas use a mixed rural/field-edge rhythm.

## Asset-first catalogue

The first pass reuses existing repository-authored GLBs: `barrel_zjCQP1TAci.glb`, `crate_3OEFd1AWfa.glb`, `greek_stone_bench.glb`, `bonfire_Azj9hJwwwG.glb` and `farm_dirt_8BQFbUMOeC.glb`.

The workflow selectively hydrates only those files. An LFS pointer is not guessed to be a broken model; unresolved pointers fail the browser proof instead of becoming silent placeholder boxes.

## Shared material/placement contract

Every hydrated prop is prepared through the shared placement pipeline and gets placement/material manifest evidence. For authored mapped PBR assets the generated material pass is only a validation bridge; the original source materials are restored before the final manifest and attachment so a higher-fidelity imported source is not downgraded to a flat generated palette.

## Evidence

The Node contract checks deterministic distribution, spatial constraints, family variety and the shared placement policy. The browser proof calls the actual shipped `sceneManager.createScene()` and then the production prop layer in Chromium, failing on missing assets, placeholders, missing manifests, failed placement gates or page/console errors.
