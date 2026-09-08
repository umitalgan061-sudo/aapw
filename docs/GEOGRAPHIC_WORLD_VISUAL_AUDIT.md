# Geographic world visual acceptance audit

## Scope

This audit is the visual integration checklist for the 3D world geography pass. It exists to prevent a common failure mode: individual modules can each be technically correct while the assembled world still looks geographically generic.

The audit evaluates the relationship between the owner reference map, terrain relief, water, roads, settlements, villages, vegetation, geology, and authored asset surfaces.

It does not create a new runtime authority. It defines evidence for the authorities that already exist.

## 1. Map-to-world alignment

The owner map is the semantic anchor. Any geography-specific object must be explainable in normalized map coordinates and then projected into world X/Z using the same map convention as terrain.

Acceptance criteria:

- west remains west;
- north remains north;
- world X grows west-to-east;
- world Z grows north-to-south under the documented convention;
- a biome decision uses the same normalized projection as terrain;
- an asset family cannot silently use an unrelated coordinate system.

A map-aligned object that is visually misplaced is considered a geography bug even if its local mesh and material are perfect.

## 2. Relief readability

Terrain should communicate landform before decorative assets attempt to explain it.

The player should be able to distinguish:

- northern cold uplands;
- mountain chains;
- broad fertile lowlands;
- dry southern or eastern basins;
- coastal transitions;
- the long eastern relief boundaries;
- volcanic/Valyria geology.

A forest can decorate a mountain, but it cannot manufacture the mountain. The terrain sampler therefore remains the canonical height authority.

## 3. Water readability

Ocean, shore, river and waterfall cues should be continuous with terrain height.

Acceptance criteria:

- dry land is not visually submerged because a decorative layer guessed the height;
- shoreline assets respect water depth;
- roads do not become wetland paths accidentally;
- vegetation does not create a dense land-cover wall over shallow water;
- river surfaces follow the same terrain height decisions used by placement-sensitive systems.

The water depth field is an additional render aid, not an alternate terrain authority.

## 4. Mountain asset language

Mountainous regions need more than high elevation. They need exposed rock, broken vegetation, silhouette interruption and sparse settlement occupation.

A good visual result shows rocky outcrops breaking through the vegetation rather than a continuous green carpet.

Natural geology is therefore intentionally rendered before dense ecological decoration so the rock language survives at medium camera heights.

## 5. Dry-region negative space

Desert, arid and steppe regions are accepted only when open ground remains visually meaningful.

Common regressions include:

- copying temperate vegetation density into dry regions;
- placing broad canopies in desert basins;
- covering all rocky ground with decorative props;
- using identical green materials with only a hue shift.

The geographic asset policy counters this with lower density multipliers and sparse dead-tree silhouettes.

## 6. Cold-region transition

Permanent ice and tundra should not transition directly into a lush temperate park.

The visual gradient should read approximately as:

`permanent ice -> tundra -> cold grassland -> mixed temperate -> fertile lowland`

The cryosphere authority is therefore consulted at the same world X/Z that receives the asset decision.

## 7. Fertile lowland language

Fertile regions should feel occupied and productive without becoming cities.

Useful cues include:

- stronger canopy mass;
- field edges;
- storage props;
- village structures;
- slightly more varied house silhouettes;
- coherent road frontage.

The purpose is to create a perceptual difference between a productive landscape and an empty plain without introducing another economy or settlement framework.

## 8. Maritime language

Maritime regions should combine wind exposure, storage, sparse structures and coastal relief.

The most useful contrast is not simply “more blue.” The land itself should show pressure from the coast through vegetation shape, rock exposure and settlement prop selection.

Barrels and crates near existing circulation are especially useful because they imply transport without needing NPC simulation.

## 9. Settlement hierarchy

The world needs a hierarchy of scale.

From largest to smallest:

1. terrain and regional landform;
2. kingdom-seat castle or major landmark;
3. village/hamlet architecture;
4. roads and field patterns;
5. fringe occupation props;
6. small ecological details.

A lower layer must not visually overpower a higher layer. The fringe prop system therefore remains sparse and outside the existing village band.

## 10. Castle grounding

Castle bases must visually meet the ground instead of hovering or cutting deeply into the terrain.

The settlement flatten pads deliberately operate against the canonical sampler and use the same clamped anchor height that castle placement uses. This keeps render geometry, collision and placement metadata coherent.

## 11. Village grounding

Village houses should be placed from full rotated footprints rather than from a single center-height guess.

The visual test is simple: no house should visibly float, bury its floor, or tilt into an implausible slope at normal camera distance.

Service landmarks should follow the same footprint-aware rule.

## 12. Prop distribution

Settlement-fringe props are not intended to form a second ring-city. Their role is to connect inhabited space to countryside.

The current annulus is 162–204m from canonical seats. Existing villages occupy a closer 115–155m band.

That separation creates a readable sequence:

`castle -> village -> functional landmark / village wall -> fringe occupation -> rural landscape`

## 13. Road relationship

Roads are the strongest linear clue of human geography. Assets should respect them without making every placement a roadside prop.

Acceptance criteria:

- road clearance remains intact;
- road-frontage assets are slightly more authored;
- no asset is placed merely because it is close to a road if slope/water rules reject it;
- the road network remains the sole routing authority.

## 14. Texture hierarchy

Visual realism comes from scale hierarchy, not from adding one noisy texture.

The desired hierarchy is:

- macro: regional colour/material identity;
- meso: local soil/rock/vegetation variation;
- micro: small surface breakup;
- asset texture: authored albedo/normal/roughness detail;
- lighting: final scene response.

A generated world-space breakup should never erase or overpower a mapped PBR source.

## 15. PBR audit

A high-quality asset is not accepted merely because it loads.

Reviewers should inspect whether the source mesh has evidence of mapped texture channels, whether the material survives preparation, and whether the final object retains the authored source treatment.

A flat generated colour applied over a richly authored model is considered a regression.

## 16. Silhouette audit

At gameplay distance, silhouette often matters more than small texture details.

Each geographic family should therefore create a visibly different shape language:

- birch/open trunk;
- large canopy;
- autumn breakup;
- dead sparse tree.

The point is to create spatial identity before the player is close enough to inspect individual texels.

## 17. Repetition audit

Repeated assets are acceptable when distribution feels intentional. Unbroken repetition is not.

The deterministic layer should therefore combine:

- stable hashing;
- family variation;
- bounded density;
- biome-specific family sets;
- small road frontage bias;
- preserved negative space.

The audit should compare repeated screenshots with the same seed rather than comparing two different random worlds.

## 18. Asset failure audit

Every optional authored asset must have a graceful fallback path.

A failed load should produce one of two acceptable states:

- a verified real asset remains visible;
- the existing procedural source remains visible.

A magenta placeholder, invisible tree field, broken shader or scene crash is unacceptable.

## 19. Mobile audit

Desktop visual upgrades must not accidentally become mobile regressions.

The first geographic vegetation asset layer is deliberately desktop-only. Mobile keeps its existing procedural LOD and budget decisions.

Settlement fringe props already have their own bounded mobile count. Both policies are expected to stay additive rather than increasing mobile asset pressure unexpectedly.

## 20. Runtime telemetry

Visual systems should publish enough metadata for tests to verify their outcome without reverse engineering Three.js object graphs at runtime.

Useful fields include:

- policy id;
- placement count;
- asset family count;
- mapped PBR count;
- source asset path;
- biome id;
- road distance;
- slope;
- quality result;
- fallback result.

Telemetry is evidence, not a second gameplay state model.

## 21. Browser acceptance

A browser proof should boot the production scene. A test-only mock scene is insufficient for world geography.

The proof should inspect the real scene graph after production setup, verify the major world groups exist, wait for optional settlement asset hydration, perform a GPU pixel smoke readback, and fail on uncaught page or console errors.

It should not require a human to click a debug menu.

## 22. Cross-module consistency

The following invariants must remain true across modules:

- terrain height is sampled from the same canonical function;
- map projection is shared;
- road geometry is not duplicated;
- settlement seats are not duplicated;
- asset loading is centralized through `AssetLoader`;
- world placement is centralized through `WorldAssetPlacementPipeline` where placement policy requires it;
- material evidence stays under `MaterialAssignmentCore` where imported assets use shared validation;
- deterministic decisions avoid `Math.random()`.

## 23. Visual regression order

When a screenshot looks wrong, investigate in this order:

1. map projection;
2. terrain height;
3. water/shore classification;
4. road/settlement position;
5. biome assignment;
6. asset family choice;
7. source material preservation;
8. lighting and fog;
9. density.

Do not solve a coordinate error with a material tweak.

## 24. Acceptance outcome

The geography pass is successful when a player who never sees debug metadata can still infer climate and landform from the world itself.

The final test is not “does every system report green?” It is “does the world tell a coherent geographic story at gameplay distance?”
