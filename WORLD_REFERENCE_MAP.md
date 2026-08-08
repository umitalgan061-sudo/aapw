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


## Canonical hydrology-aware target terrain shadow — run 186

Run186 adds an explicit opt-in height-sampler adapter for the planned full-reference world. It converts planned world X/Z back through the exact 9000x7000 map/reference transform, samples the immutable Run179 coastline plus Run182 protected-land overlay, and deterministically composes that result with the existing target-scale procedural height sampler. Canonical water is forced below the shared water plane, canonical land is kept dry, and protected settlement footprints retain their real flatten-pad anchors. The adapter is shadow-only: live scene/chunk/terrain/water/road/settlement consumers do not import it yet.

The policy is intentionally conservative for qualification rather than final art tuning: open water can reach 8m below the water plane, coastal water stays at least 2.5m below it, raw land stays at least 0.35m dry, and protected-land edges stay at least 0.08m dry while seat centers keep the existing settlement clearance. A later visual/runtime adoption run may version these shaping values, but it must not mutate the raw coastline mask or bypass seat protection.


## Canonical chunk / water / collider integration shadow — run 187

Run187 bakes the Run186 canonical hydrology-aware sampler into real 64-segment `THREE.PlaneGeometry` chunks using the same chunk-center convention as the live world, pairs those meshes with the existing `world/water.js` flat sea plane, and exposes a `getGroundHeight(x,z)` collider facade backed by the identical sampler. This is still opt-in shadow infrastructure: live `game3d`, `sceneManager`, `ChunkManager`, terrain, water, roads, settlements and physics do not import it.

The integration check uses protected Balon and Jon plus an open Summer Sea probe, proves every baked vertex agrees with the numeric canonical sampler, raycasts the actual meshes, verifies rendered terrain and collider agreement at protected settlement centers, and proves the existing water surface raycasts above the canonical seabed. It also diagnoses every target-scale road route against canonical hydrology; any water-crossing route is recorded as an explicit blocker for bridge/ferry/water-avoidance policy before live road migration.


## Canonical road/water policy measurement — run 188

Run188 preserves Run187's 399/1020 canonical-water road-point result across 6/13 MST edges and measures policy consequences without selecting one. Bridge-only interpretation needs 6.16 km total diagnostic chord span (longest 3.11 km); ferry-only interpretation traverses 6.51 km total canonical water (longest 3.32 km); a 40m-grid full-world dry-cart search with water impassable and the current 20° hard-grade ceiling finds 3/6 affected edges feasible. Mixed remains owner-mapped per edge. Checksum `c47d6ecbacff41a6ffc4e18623642905c1865c46f37f3f82fbd69a9eecd57214`.


## Canonical rock/stone placement qualification — run 189

Run189, mevcut canonical mountain/rocky-hills biome zoneları ile relief-chain anchorlarını deterministic geology influence olarak kullanıp full-reference planned world üzerinde 120m hücreli, seed=1337 shadow-only kaya/taş aday taraması yaptı. Canonical water elendi, 14/14 kingdom-seat center protected-land olarak doğrulandı, adaylar mevcut temporary 35° walkable-slope safety sınırının üstüne çıkmadı. 343 aday üretildi: stone 241, rock 77, boulder 25; geology coverage 5 zone/source (bone-mountains:123, dorne-mountains:23, relief-chain:111, vale-mountains:28, westerlands:58). Checksum `137567a4b8a6ce24c8cbb9792096a06a98063ea29c0011e58cdd1e11e4800ce0`.

Qualification boundary: bu çıktı canlı rock mesh/spawn sistemi değildir; runtime scene/terrain/road/PWA import graphı değişmez. Yol-su policy owner kararı açık olduğu için rock-road clearance veya canonical live-road adoption bu run içinde varsayılmaz. Macro-relief height değişikliği de yapılmaz; bu yalnız ilerideki kaya geometry/placement katmanı için deterministik, su/yerleşim-güvenli aday sözleşmesidir.
