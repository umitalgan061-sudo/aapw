# Geographic region to asset matrix

This matrix is the quick visual reference for the geography pass. It complements the detailed runtime contracts and makes accidental cross-biome asset placement easy to spot in review.

| Region | Primary terrain read | Vegetation family | Settlement fringe props | Density intent |
|---|---|---|---|---|
| lands-always-winter | permanent ice / frozen relief | birch or existing winter tree language | bonfire, barrel, crate | very sparse |
| north | cold grassland | birch / autumn | bonfire, barrel, crate | sparse to medium |
| neck | marsh | birch | farm dirt, crate, barrel | sparse wetland |
| vale-mountains | mountain | birch / deadwood | bench, barrel, crate | sparse broken cover |
| westerlands | rocky hills | deadwood / birch | bench, barrel, crate | sparse rocky |
| reach | lush grassland | canopy / birch / autumn | farm dirt, crate, barrel, bench | productive medium |
| dorne | desert | deadwood | barrel, crate | very sparse |
| dorne-mountains | mountain | birch / deadwood | bench, barrel, crate | sparse broken cover |
| braavos-coast | temperate coast | birch / canopy | barrel, crate, bench | moderate wind-exposed |
| dothraki-sea | steppe | deadwood / limited birch | barrel, crate | sparse open |
| bone-mountains | mountain | birch / deadwood | bench, barrel, bonfire | sparse steep |
| red-waste | desert | deadwood | barrel, crate | very sparse |
| yi-ti | lush grassland | canopy | farm dirt, crate, barrel | dense productive |
| jogos-nhai | steppe | deadwood / birch | barrel, crate | sparse open |
| grey-waste | arid | deadwood | barrel, crate | very sparse |
| sothoryos | jungle | canopy | crate, barrel | dense canopy |
| ulthos | jungle | canopy | crate, barrel | dense canopy |

## Reading the matrix

The matrix is not a hard-coded second map. `worldReferenceMap.js` remains the geographic source and the world-space query comes from the same projected map coordinates used by terrain.

“Primary” means the strongest first visual cue, not a restriction on every other asset. Transitional regions can borrow neighbouring families when the reference-zone influence is weak, but they should not jump directly from permanent ice to lush canopy.

Settlement props use a separate, tighter annulus than village houses. Their role is to make the inhabited landscape feel continuous without turning the fringe into another town system.

## Material expectations

Terrain materials should carry macro landform identity. Asset source materials should carry object identity. World-space variation can provide local breakup, but it should not flatten an authored PBR asset into a generic palette.

## Negative-space expectations

Dry zones deliberately spend more of the frame on uncovered ground. Mountain zones expose rock. Marsh zones leave wet grass and water edges visible. Dense jungle is the exception where canopy mass is itself the geographic signal.

## Camera-distance expectations

At high camera height the region should read mostly from terrain silhouette, macro colour and density. At medium height the vegetation/castle/village hierarchy should become obvious. At close height the authored model textures should reward inspection.

This three-distance test is more valuable than judging a single tree in isolation.

## Review failure examples

Reject a change when:

- desert gains the same tree count as fertile lowland;
- mountains become visually smooth green domes because rocks are hidden;
- a lush canopy asset appears inside permanent ice without a transition zone;
- all regions use identical tree silhouettes and only change hue;
- a realistic model is downgraded to a generated flat material;
- fringe props create a second city ring instead of a rural occupation edge.

The goal is a map whose geography changes what the player sees, not merely a map whose shader changes colour.
