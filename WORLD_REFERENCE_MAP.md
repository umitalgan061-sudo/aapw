# Canonical 2D → 3D World Reference Map

Owner directive, 2026-08-08: the supplied 2D world map is now the canonical macro-geography reference for the 3D world. The 3D implementation must progressively reproduce the visible geography rather than inventing unrelated terrain.

This means coast/seas, mountain chains, cold/snow zones, marshes, grasslands/steppe, forests/jungle, deserts/arid zones and the road network are placed and tuned with this map as the visual source of truth. Existing settlement coordinates, deterministic generation, 2D behavior, mobile/PWA budgets and all safety checks remain hard constraints; the map reference guides macro shape and biome identity but does not authorize silently moving canonical settlements or breaking routes.

The first additive foundation is `src/3d/world/worldReferenceMap.js`, which records normalized image-space biome/water/relief controls and a deterministic map-to-world projection helper. The source image is identified by SHA-256 `20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1`; the normalized vector controls are the repo-persisted implementation contract. Follow-up tasks consume this contract incrementally: coastline/water mask → macro relief/mountain chains → biome materials (snow/marsh/grass/steppe/desert/jungle) → roads aligned to terrain and settlements → localized rock/vegetation/detail passes.

No single giant terrain rewrite is allowed. Each visual layer remains a separately measurable additive change with pre/post terrain-seat safety, road safety, deterministic checksum, browser smoke, console, performance, mobile and PWA/cache verification.

## Coastline / water mask — run 179

`src/3d/world/worldReferenceWaterMask.js` adds the first deterministic raster-derived macro layer: a 96x64 one-bit coastline/water mask (4052 water / 2092 land cells), persisted as compact hex rows with SHA-256 `2ca2bed8d8a137ba532a56e10b079fa845b0f7214e24f955388c8dd0a4517f27`. The mask is data-only in run 179: it does not yet alter terrain height or the water plane. Runtime adoption is intentionally deferred until the existing 2D kingdom-marker/world coordinate system is proven to align with this normalized image space; a naive direct full-extent mapping is not an acceptable substitute because terrain-seat and road safety remain hard constraints.

## Exact 2D canvas alignment — run 181

The normalized reference transform is no longer an assumption. The live 2D shell defines `#map-canvas` as exactly **9000x7000** units and stretches `resimler/map.png` across that canvas with `background-size: 100% 100%`. Therefore `src/3d/world/worldReferenceAlignment.js` maps 2D coordinates exactly as `normalizedX = mapX / 9000`, `normalizedY = mapY / 7000`, and provides inverse/world-space round trips through the existing `WORLD_SCALE.MAP_BOUNDS` convention.

The alignment check also exposes two separate safety facts that must not be conflated with transform correctness: the coarse run179 mask classifies 12/14 kingdom-seat samples as land and flags `balon` + `jon` as raw-water cells, so a seat-safe hydrology override/refined mask is mandatory before runtime terrain adoption; and the current padded 3D `MAP_BOUNDS` span only about **67.3%** of the full normalized 2D reference rectangle, so whole-map 3D coverage requires a later measured world-extent/scale decision rather than silently pretending the current crop already represents the entire image.

## Seat-safe hydrology and full-map extent — run 182

Two run181 blockers are now explicit deterministic contracts, still without changing live terrain/water. `worldReferenceHydrology.js` composes the immutable coarse coastline mask with caller-supplied protected land sites. The standing settlement flatten outer radius (**75m**, read from the existing settlement source by the regression test) is used as the safety footprint during validation: raw mask remains 12/14 at kingdom-seat centers (`balon` + `jon` are the two coarse-mask false-water samples), while the protected composition is 14/14 land and leaves open Summer Sea water unchanged.

`worldReferenceExtent.js` proves that the **entire 9000x7000 owner map can fit under the existing area budget** without increasing total world area beyond the project target. Holding the canonical target at 137.5 km² gives **1.4773421007 m/map-unit**, a full-map physical extent of about **13,296m × 10,341m**, and a 500m partition grid of **27×21 = 567 chunks**. This is only ~5.9% more area than the current ~129.8 km² crop; the full-map problem is therefore primarily coordinate re-centering/scaling + streaming, not an unavoidable >150 km² expansion. The runtime constants remain untouched until a dedicated migration pass proves roads, settlements, terrain, mobile budgets and determinism under the new full-reference extent.

## Full-map runtime migration dry-run — run 184

`worldReferenceMigrationPlan.js` turns Run182's mathematical extent target into an explicit reversible migration contract: future full-map bounds are exactly **x:[0,9000], y:[0,7000]**, centered at map coordinate **(4500,3500)**, using **1.4773421007 m/map-unit**, about **13.296×10.341 km**, **137.5 km²**, and **27×21** 500m chunks. The helper migrates current world coordinates by first recovering their canonical 2D map coordinate, then projecting that coordinate into the planned full-reference world. This keeps saved/runtime positions tied to the owner map rather than to an ad-hoc direct world-space transform.

Run184 remains a dry-run: live `WORLD_SCALE`, terrain, water, roads and scene construction do not import this module. Its browser regression exercises the real modules under the planned scale and requires 14/14 kingdom-seat reversible mapping, settlement flatten safety, 14/14 seat-safe hydrology, unchanged 13-edge MST topology, finite <=20° routed road grades that remain inside the planned world rectangle, and open Summer Sea remaining water. Only after that proof may a later run switch runtime world scale and canonical hydrology.
