# Geographic settlement fringe runtime slice

## Why this pass exists

The canonical kingdom seats and the existing 115–155 m hamlet band already establish the settlement hierarchy. The missing layer was the next visible occupation zone: the space immediately outside a village where storage, rest, hearth and agricultural traces naturally break the silhouette before the world becomes open countryside.

PR #1071 introduced deterministic geography-aware fringe props in a 162–204 m ring. Its first implementation proved the planner and asset/material path in a dedicated harness, but the production `sceneManager.createScene()` did not own the layer. That meant the proof could succeed while the shipped game remained visually unchanged.

This follow-up closes that seam without creating a second settlement or placement framework.

## Runtime ownership

`sceneManager.js` remains the integration point. It already owns the canonical terrain sampler, settlement seats, roads and village groups. The geographic fringe layer consumes those authorities rather than recreating them.

`src/3d/world/geographicSettlementProps.js` remains the placement planner/loader. `src/3d/world/MaterialAssignmentCore.js` and `src/3d/world/WorldAssetPlacementPipeline.js` remain the only material and world-placement authorities.

`geographicSettlementPropQuality.js` is an audit/context layer only. It does not sample terrain to make a second decision, does not choose a new settlement position, and does not create duplicate materials. It attaches semantic context and verifies the already-authoritative output.

## Spatial composition

The existing village band is 115–155 m. The fringe begins at 162 m, leaving a 7 m visual break so the two layers do not read as one dense procedural blob.

The outer edge ends at 204 m. This is deliberately well inside the settlement's 210 m geography envelope used elsewhere in the world pass, while still reading as an occupied settlement perimeter.

Each candidate inherits the existing terrain sample and road graph. No flat-world assumption is introduced. The runtime receives the same `groundCollider.getGroundHeight` function used by roads, water depth, vegetation and other grounded systems.

## Geographic language

Cold regions favour hearth + cargo. Fertile regions expose field edge + storage + rest. Maritime regions are cargo-heavy and road-accessible. Mountain regions keep the hearth sparse and favour rest/cargo near workable ground. Arid regions remain sparse. Jungle uses very light storage traces. Temperate regions mix field edge, rest and cargo.

The quality layer makes this language queryable through `geographicSemanticRole`, `geographicApproach`, `geographicOrientationIntent` and a deterministic context score. These fields are intended to become direct hooks for future quest, vendor and settlement-activity UX without introducing a new settlement database.

## Asset-first rule

The slice uses only repository-authored GLB props already present under `assets/models/props/`:

- `barrel_zjCQP1TAci.glb`
- `crate_3OEFd1AWfa.glb`
- `greek_stone_bench.glb`
- `bonfire_Azj9hJwwwG.glb`
- `farm_dirt_8BQFbUMOeC.glb`

These files are LFS-managed in the Git tree. Their small Git blob size is therefore not treated as a broken 3D model. CI selectively hydrates them before browser proof and rejects unresolved pointers before runtime validation.

No primitive-box prop is substituted for a missing authored asset. The existing loader's fail-soft placeholder is deliberately caught by the quality gate, so an unresolved asset cannot become an invisible quality regression.

## Material contract

Each hydrated asset enters the existing placement pipeline with a material recipe. For authored mapped PBR models, the generated material pass is only a validation bridge; the source material is restored before final attachment. The runtime quality report records mesh count, material slot count, UV coverage, authored-PBR evidence, generated-material count and texture dimensions.

A single-material mesh is not automatically considered bad: a source asset can legitimately be authored as one surface. The gate therefore looks for actual missing/placeholder state and texture evidence rather than blindly recolouring imported content.

## Runtime proof contract

The browser proof must start the real `sceneManager.createScene()` and await its `geographicSettlementPropsReady` promise. Calling the prop factory separately after scene bootstrap is no longer sufficient evidence.

The proof reports:

1. actual hydrated placement count;
2. failed/missing asset families;
3. manifest coverage;
4. world-placement gate coverage;
5. placeholder count;
6. finite transforms;
7. plan ring/slope/water/road/spacing validity;
8. canonical-seat anchor consistency;
9. semantic-family distribution;
10. material and texture evidence;
11. browser console/page error count.

## Failure behaviour

If the optional fringe prop layer cannot hydrate, the main scene continues to load without creating fake substitute boxes. The returned promise is resolved with a failure record rather than rejecting into an unhandled browser error. This keeps the game robust while keeping CI strict enough to catch missing assets.

## Future gameplay hooks

The semantic metadata intentionally matches gameplay language already present elsewhere in the project:

- `storage-yard` can become a future trade/stockpile interaction anchor;
- `rest-edge` can become a safe rest or dialogue anchor;
- `hearth-shelter` can become a survival/rest point;
- `field-edge` can become a farming, gathering or settlement-economy hook;
- `road-frontage-cargo` provides a deterministic approach class for future quest markers or vendor routes.

No vendor, quest, economy or inventory implementation is duplicated here. Those systems should consume the metadata when their existing owners expose the appropriate interfaces.

## Governance note

The change intentionally avoids the active NPC/faction/fauna, combat/player and terrain/environment production ownership areas. It only wires the authored settlement-fringe asset slice into the already-existing world bootstrap and adds a pure audit layer around its output.
