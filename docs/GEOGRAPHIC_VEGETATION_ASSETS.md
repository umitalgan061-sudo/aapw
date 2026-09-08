# Geographic vegetation asset contract

## Purpose

The 3D world already has a deterministic vegetation scatter owner. The remaining visual gap is not the existence of trees; it is that a large portion of the world can still read as a uniform procedural tree field even where the owner map implies very different climates, canopy structures, and landscape character.

This document records the asset-first solution prepared for that gap. It is deliberately additive. The canonical scatter remains owned by `src/3d/world/vegetation.js`; the canonical terrain height remains owned by `src/3d/world/terrain.js`; the owner-map climate zones remain defined in `src/3d/world/worldReferenceMap.js`.

## Authorities

| Concern | Authority | Rule |
|---|---|---|
| World X/Z | `terrainMapUvAt` / terrain alignment | A vegetation asset must be selected from the same projected geography as the terrain it decorates. |
| Climate / biome | `REFERENCE_BIOME_ZONES` | Geographic family selection is deterministic and zone-aware. |
| Northern cryosphere | `northReferenceCryosphereAtWorldXZ` | Permanent ice and tundra override lush broadleaf choices. |
| Height | `sampleHeightMeters` | Real vegetation never invents a second ground surface. |
| Roads | existing `roadEdges` | Road frontage receives a limited silhouette-selection bias only; road construction is untouched. |
| Scatter | `world/vegetation.js` | Existing instance positions remain the placement source of truth. |
| Model loading | `AssetLoader` | Missing/corrupt models fall back to the already-visible procedural representation. |
| Source material | imported GLB material | Mapped PBR is preserved rather than replaced by a flat generated palette. |

## Region language

The purpose of the catalog is not to assign one tree model to every point. The world should read as a sequence of ecological languages.

### Cold grassland
The northern middle should be sparse and wind-beaten compared with temperate lowlands. Birch-like silhouettes are preferred, with autumn variants allowed only where the cryosphere has not crossed the permanent-ice threshold.

### Marsh
The marsh zone is intentionally low-diversity. Birch is preferred because a vertical, lighter trunk silhouette reads more naturally through wet grass and reeds than a dense broadleaf canopy. The low density multiplier prevents the marsh from becoming a solid forest.

### Mountain and rocky hills
Mountain slopes use a mixed birch/dead-tree vocabulary. The objective is to break the otherwise repeated procedural green mass with exposed trunks and sparse silhouettes, especially where rock outcrops already dominate the ground read.

### Lush grassland
Lush regions are the most canopy-capable. A large canopy asset is allowed here, with birch and autumn forms mixed in to avoid a single repeating crown profile.

### Desert and arid regions
These regions should not receive lush canopy. Dead-tree silhouettes are intentionally sparse. A dry landscape needs negative space as much as it needs objects; density is therefore reduced rather than simply recoloring a dense forest green-brown.

### Steppe
Steppe is treated as a transitional sparse zone. Dead trees are preferred, with limited birch where the owner map and local cryosphere permit it. The lower replacement/density policy prevents a steppe from turning into a temperate woodland.

### Temperate coast
Coastal temperate areas use birch/canopy mixtures. The visual target is wind exposure plus moderate moisture, not dense jungle.

### Jungle
Jungle uses the canopy family only in the first pass. The point is to establish a strong, unmistakable silhouette shift relative to grasslands and steppe. Further species can be added later without changing the placement contract.

## Asset catalog

| Family | Source | Allowed regions | Intended read |
|---|---|---|---|
| birch | `assets/models/vegetation/birch_trees_R7qMWzb7nk.glb` | cold grassland, marsh, lush grassland, temperate coast, temperate | pale trunk / open crown |
| canopy | `assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_na.glb` | lush grassland, jungle, temperate, temperate coast | large broad canopy |
| autumn | `assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb` | temperate, lush grassland, cold grassland | seasonal breakup |
| dead | `assets/models/vegetation/dead_tree_n8FhMgMldD.glb` | desert, steppe, arid, rocky hills, mountain | dry/sparse silhouette |

The catalog intentionally uses existing repository-authored files instead of introducing an external download dependency. Asset names are recorded in both the source contract and the selective-LFS CI job.

## Source verification

Git LFS introduces a special failure mode: a 100-byte pointer can look like a valid repository file path without being a usable GLB. For that reason, the asset workflow performs selective hydration and rejects unresolved pointers before runtime tests begin.

The gate checks that the file exists, is materially larger than the LFS pointer representation, does not still contain the LFS pointer signature, can be loaded by the same `AssetLoader` used by the game, produces a real renderable mesh, and has a sane source shape.

## Shape validation

A real tree model is useful only when it behaves like a tree when normalized into the world. The adapter therefore measures the source bounding box before any instance is created.

The current validation rejects placeholders, objects without a renderable mesh, excessive mesh counts, empty bounds, non-finite aspect ratios, extremely wide silhouettes, degenerate heights, and source extents large enough to hide a normalization mistake.

The normalization target is approximately 7.6 m for a single-tree silhouette. This is presentation normalization only; it never alters the canonical ground height or scatter position.

## Placement model

The existing procedural instance matrix remains authoritative. The asset layer reads the matrix, decomposes position/rotation/scale, selects a compatible geographic family, and writes a new instanced representation.

The layer does not rerun world scatter. It cannot silently move a forest, alter road clearance, or change a collider. It is a visual representation upgrade of a placement that already exists.

## Density philosophy

The replacement ratio is intentionally bounded rather than set to 100%. The procedural population remains a safety and performance floor while real GLBs create recognizable silhouette islands.

Current target replacement ratio is 18–42% of eligible desktop procedural tree instances. Regional density multipliers then modulate acceptance: jungle can exceed baseline density; desert and arid areas remain intentionally sparse.

The result should read as ecological texture rather than as a hard circular biome stamp.

## Road frontage

Roadside areas receive a small authored-silhouette bias because travelers read vegetation and circulation together. The bias raises replacement likelihood near frontage without moving trees toward the road or bypassing the canonical road exclusion.

No road geometry, routing, collision, or terrain authority changes here.

## Source PBR preservation

The real tree asset should look like the source artist authored it. Imported mapped PBR is therefore treated as evidence worth preserving. It is not flattened into the generated palette used by purely procedural geometry.

A restrained world-space weathering pass can break repetitive lighting while leaving the authored texture readable.

## Failure behavior

The most important production rule is fail-closed. If an asset is missing, still an LFS pointer, corrupt, too large, too empty, or otherwise invalid, the existing procedural mesh remains visible.

A failed optional upgrade must never turn an entire biome into magenta placeholder boxes and must never stop the 3D world from booting.

## Mobile behavior

The real-tree upgrade is desktop-only in its first pass. Existing low-poly vegetation and mobile LOD rules remain authoritative on coarse-pointer devices.

This is intentional: a realistic tree GLB can contain materially more geometry than a procedural impostor. The mobile budget should remain concentrated on terrain, water, and essential interaction.

## Determinism

Family choice uses a stable hash from world seed, biome context, and procedural instance identity. No `Math.random()` is used. The same seed and canonical inputs therefore produce the same family decisions.

This is essential for save consistency, QA screenshots, browser comparison, and future streamed chunks.

## Ownership boundary

This layer does not own terrain height, hydrology, road routing, settlement placement, combat, NPC behavior, factions, save serialization, inventory, or mobile rendering policy.

It also does not create a second vegetation manager. The adapter consumes existing instances and changes only their render representation where valid assets are available.

## QA evidence

`checkGeographicVegetationAssets.mjs` validates policy, catalog, deterministic family choice, mock source shape checks, normalization, and texture evidence.

`checkGeographicVegetationAssetIntegration.mjs` keeps the adapter boundary truthful: in this PR the canonical vegetation producer is deliberately untouched until an explicit runtime integration pass is reviewed separately.

`geographic-vegetation-assets.yml` performs selective LFS hydration and contract execution on a clean checkout.

## Review checklist

Before promoting the adapter into the live vegetation path, verify the exact main SHA, all four source GLBs, mapped-PBR preservation, the 18–42% replacement target, permanent-ice/tundra restrictions, desert sparsity, road-clearance stability, absence of a new height/collider authority, mobile fallback, and deterministic output for the canonical seed.

## Visual acceptance target

From a medium-height camera the world should no longer read as “the same tree repeated everywhere.” Northern zones should have clearer cold silhouettes; mountain and rocky belts should show more deadwood; fertile areas should carry stronger canopy masses; deserts should have more negative space; jungle should have a visibly different crown language.

The objective is not maximum tree count. The objective is a believable spatial grammar in which geography has consequences for what objects the player sees.
