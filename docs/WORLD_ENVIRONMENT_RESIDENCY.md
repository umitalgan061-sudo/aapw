# World Environment Residency & Surface Contract

## Purpose

The shipped world already has independent authorities for canonical terrain height, hydrology, biome classification, roads, settlements, vegetation, geology, sky and the shared material/placement core. This contract does not replace those authorities.

Its job is narrower: decide how much environment work should remain resident around the player and what visual material quality an already-selected environmental asset should receive at that distance.

The distinction is important. A terrain chunk can be geometrically correct while the surrounding environment still looks sparse, primitive, or over-budget. Conversely, a high-quality imported model can be geographically correct but visually flat if the runtime loses its normal/roughness response. Residency and surface fidelity therefore travel together, but neither is allowed to invent geography or asset identity.

## Live ownership boundary

`src/3d/world/worldEnvironmentResidency.js` owns:

- deterministic near/mid/far/outer residency bands;
- quality and device scaling;
- per-family density and spacing budgets;
- material distance response presets;
- asset-fidelity requirements expressed as required PBR channels;
- deterministic environment manifest generation;
- machine-readable residency telemetry.

`src/3d/world/worldEnvironmentSurfaceProfiles.js` owns:

- surface response ranges for grass, soil, mud, rock, scree, snow, wet ground, bark, leaves, walls, roofs, metal and shoreline transition;
- macro/micro breakup targets;
- physically bounded roughness and normal response;
- profile-level texture-channel expectations.

Neither file chooses a concrete asset path, changes a canonical map cell, edits water classification, moves a settlement, changes a collider, or replaces the shared `MaterialAssignmentCore`/`WorldAssetPlacementPipeline`.

## Distance bands

Desktop uses four bands over the active environment neighborhood:

| Band | Distance | Intent |
| --- | ---: | --- |
| near | 0–750 m | player-facing detail, strongest PBR, full environment density |
| mid | 750–1500 m | reduced density, preserved silhouette and surface breakup |
| far | 1500–3000 m | strong budget reduction, terrain readability retained |
| outer | 3000–4500 m | boundary representation, minimum expensive environment work |

Mobile uses tighter bands to keep the resident environment budget bounded while terrain streaming remains responsible for world coverage.

These bands are evaluated in world/chunk space, not map-cell index space. The chunk grid remains the only coordinate authority. This prevents grid edges from becoming visual seams or material boundaries.

## Material response

Near terrain is allowed to use the strongest normal-scale and shadow response permitted by the selected quality level. As chunks move outward, normal intensity and shadow cost decrease while roughness is biased slightly upward. This is a distance response, not a different geographic material.

The same policy is used by environment-family budgets. A rock, cliff, tree, shrub or settlement asset can request a family-specific fidelity requirement, but the concrete asset and its authored texture provenance remain owned by the shared asset/placement pipeline.

## Asset fidelity rules

The old failure mode this contract prevents is a model that is technically loaded but reads as a single painted color. Every environment-family requirement therefore forbids single-color placeholders and expects explicit PBR response.

At minimum, environmental surfaces require authored albedo, normal and roughness channels. AO is required where the surface profile can materially benefit from it; wet and shoreline profiles deliberately keep the wet response in roughness/specular terms rather than baking a cyan overlay into geometry.

Lower-resolution textures are allowed only at distance tiers where the contract says they are sufficient. A far-distance asset may legitimately resolve at a lower texture budget than a player-facing asset, but it may not silently become a placeholder.

## Determinism

Every residency decision is derived from explicit seed, chunk coordinates, quality and device class. Candidate-slot ranking uses stable hashing rather than `Math.random()`.

Two identical inputs must therefore produce identical:

- chunk ordering;
- residency band;
- asset-family budgets;
- candidate slot ranking;
- generated manifests;
- audit snapshots.

This is important for screenshot comparison, CI diagnosis and regression isolation.

## Runtime integration

`ChunkManager` is still responsible for loading and unloading terrain geometry. On every terrain load the residency manifest is attached to the live chunk mesh. On a streaming-center change, the manager refreshes all resident manifests so environment consumers can use one exact distance result rather than duplicating radius math.

The runtime does not evict desktop terrain as part of this slice. Existing mobile eviction and mobile terrain LOD behavior remain intact. This avoids invalidating existing World Coverage semantics while still giving the environment layer a real bounded budget.

## Acceptance evidence

The workflow `.github/workflows/world-environment-residency.yml` performs:

1. exact-main freshness verification;
2. repository diff hygiene and the global 3000-line additions+deletions cap;
3. static syntax validation;
4. deterministic residency and budget suites;
5. asset-fidelity matrix checks;
6. shipped `sceneManager.createScene()` runtime proof at 1536×1024;
7. shipped live-material/PBR inspection and screenshot capture;
8. final exact-main freshness verification.

The browser proofs write JSON evidence together with untouched runtime screenshots. No post-processing step may be added to hide seams, water blocks, texture repetition, floating assets or black-sky failures.

## Relationship to active production PRs

This slice is intentionally separated from the current biome-distribution and mountain-relief candidates. It does not modify their canonical terrain, distribution planner, or geology authority. It also does not supersede the shared material/placement contract in PR #590.

The environment owner should revisit the visual acceptance images after every major terrain/material/vegetation merge. When a concrete P0–P5 visual defect is fixed by another candidate, the residency bands should continue to describe that result rather than reintroducing a parallel visual authority.
