# `src/3d/world/`

Owns everything about the physical world: terrain, water, vegetation, roads, rivers, weather,
settlements. Only this folder and `src/3d/eventBus.js` should be touched when working on a system
here (blast radius rule — if a change needs more than that, it's not a world-system change).

## Files

- **`terrain.js`** — seeded value-noise/FBM terrain chunk generation. `createTerrainChunk({chunkX,
  chunkZ, seed, ...})` returns a positioned, ready-to-add `THREE.Mesh`; `disposeTerrainChunk(mesh)`
  releases its geometry/material.
- **`chunkManager.js`** — `ChunkManager` class: `loadChunk`/`unloadChunk`/`loadSquare` (a fixed
  square neighborhood, used once at boot for the Phase 1 preview) and `streamTowards` (additive,
  position-based — called every time the camera/player crosses into a new chunk) on top of
  `terrain.js`, plus `loadedCount`/`getCoveredAreaKm2()`/`everGeneratedCount`/
  `getCumulativeCoveredAreaKm2()` for World Coverage reporting and `disposeAll()` for teardown.
  Does not evict chunks that fall out of range yet — see `DECISIONS.md` ADR-0003.
- **`water.js`** — sea-level water. `createWater(waterLevelMeters)` returns one large flat
  `THREE.Mesh` plane whose fragment shader fakes wave motion via an analytic ripple normal (no
  vertex displacement — see `DECISIONS.md` ADR-0048, fixed a lake-shoreline flicker a real Gerstner
  vertex displacement caused over shallow water); `updateWater(mesh, cameraPosition,
  elapsedSeconds)` re-centers it on the camera and advances the ripple animation (call every
  frame); `disposeWater(mesh)` releases its geometry/material. Deliberately **not** per-chunk and
  **not** a `ChunkManager`-owned concept — a single plane at a fixed sea level already floods
  `terrain.js`'s low points into natural lakes/coastline with no terrain changes needed. See
  `DECISIONS.md` ADR-0005 for the full reasoning and alternatives considered.
- **`rivers.js`** — one deterministic downhill-flow river, traced (not carved) over `terrain.js`'s
  height field. `generateRiverPath({seed, sampleHeightMeters, seaLevelMeters, ...})` walks
  steepest-descent from the highest point near the origin down to sea level, returning
  `{points, endReason}`; `createRiverMesh(points, widthMeters)` builds a static ribbon `THREE.Mesh`
  (`null` if fewer than 2 points); `disposeRiverMesh(mesh)` releases it. Static — no per-frame
  `update()`, unlike `water.js`. See `DECISIONS.md` ADR-0009 for why path-tracing (not terrain
  carving) was chosen and how the steepest-descent walk avoids getting stuck in the many small
  local minima multi-octave FBM noise produces. Also exports `detectWaterfalls(points)` (flags
  segments with `dropMeters >= 2.5` and `slope >= 0.06`, thresholds measured against the actual
  traced river — see `DECISIONS.md` ADR-0011) and `createWaterfallMesh(waterfall, widthMeters)` /
  `disposeWaterfallMesh(mesh)` — a deliberately schematic vertical "curtain" quad at each flagged
  segment, not a terrain-carved cliff.
- **`settlements.js`** — one procedural castle (box keep + 4 corner towers + conical roofs) per
  kingdom seat. `KINGDOM_SEATS` is a hand-copied, frozen snapshot of `script.js`'s `INIT_KINGDOMS`
  (position/color/name only). `mapToWorldXZ(mapX, mapY, mapBounds, metersPerMapUnit)` converts a
  2D-map coordinate to world `(x, z)` — the map-bounds *center* maps to the world origin, matching
  the chunk grid's own `(0, 0)`-centered convention; reuse this function for any future system that
  places something by kingdom location (roads, NPC spawns, quest markers), don't invent a second
  mapping. `createSettlements({sampleHeightMeters, seaLevelMeters, mapBounds, metersPerMapUnit,
  settlementConfig, seed})` returns `{group, seats}` — `group` is 3 `InstancedMesh`es (keeps/towers/
  roofs, one draw call per part, not per castle); `seats` exposes each seat's real world position/
  ground height so `game3d.js` can force-load terrain under it. `disposeSettlements(group)` releases
  all three (geometries plus each material's texture maps, via `materials.js`). See `DECISIONS.md`
  ADR-0013.
- **`materials.js`** — procedural (canvas-generated, no external image files) PBR-ish materials for
  `settlements.js`. `createStoneMaterial({seed, baseColor, repeat})` returns a
  `MeshStandardMaterial` with seeded color/roughness/normal maps depicting mortared stone blocks
  (a shared height field drives all three maps so the grooves/bevels/shading agree).
  `createRoofMaterial({seed, repeat})` returns a `MeshStandardMaterial` with color/roughness maps
  depicting horizontal slate shingle rows, deliberately grayscale-ish so `InstancedMesh`'s
  per-instance house color still shows through the multiply. `disposeCastleMaterial(material)`
  disposes a material's own maps plus itself. See DECISIONS.md's newest ADR for why procedural
  generation was chosen over an external texture file.

- **`roadPathfinder.js`** — slope-aware A* pathfinder over a padded grid corridor between two
  world-space points (DECISIONS.md ADR-0076). `findSlopeAwarePath({...})` returns a polyline that
  visibly bends around steep terrain instead of cutting a straight line through it (GOVERNANCE.md
  §8.10) — 8-directional grid A* with an admissible Euclidean heuristic, movement cost scaled by a
  cubic grade penalty (`ROAD_COMFORT_GRADE_DEGREES = 10°`, the soft target below which a segment is
  treated as effectively free). Pure/stateless: takes a height sampler (the same
  `createHeightSampler` output every other world system reads through) and never touches THREE.js
  or scene state, so it's independently regression-checked by `scripts/roadNetworkSafetyCheck.js`.
  Deterministic — no `Math.random()`, same inputs always produce the same grid/expansion
  order/output path.
- **`roads.js`** — road network connecting the 14 kingdom seats (DECISIONS.md ADR-0076).
  `computeSeatMST(seats)` builds a minimum-spanning-tree topology (Prim's algorithm, 13 edges over
  raw Euclidean seat-to-seat distance — deterministic tie-breaking by array order) rather than a
  complete point-to-point graph; `buildRoadNetwork({seats, sampleHeightMeters})` routes each MST
  edge through `roadPathfinder.js`'s slope-aware A* and merges every edge into one dirt-colored
  ribbon `THREE.Mesh` (`ROAD_WIDTH_METERS = 8`, raised `VERTICAL_OFFSET_METERS = 0.06` above the
  sampled terrain to avoid z-fighting) following the real combined fine-FBM + macro-relief terrain
  height. `disposeRoadNetwork(group)` releases the mesh's geometry/material. First-pass scope: one
  road tier ("ana yol" / at arabası yolu) — see `QUESTIONS_FOR_OWNER.md` for the deferred second
  "patika" tier question.

- **`vegetation.js`** — procedural instanced trees (run 111, DECISIONS.md ADR-0138; species variety
  added run 112, ADR-0139). `createVegetation({sampleHeightMeters, seaLevelMeters, seed, seats,
  roadEdges, radiusMeters, densityPerKm2?})` scatters deterministic trees, mixed across a `SPECIES`
  table (today: a conical "pine" and a round-crown sphere-foliage tree, 60/40 weighted), over a disc
  centered on the world origin, rejecting points in water, on ground steeper than 45°, inside a kingdom
  seat's exclusion radius, or within a road edge's exclusion corridor — returns `{group, targetCount,
  placedCount}`; `group.children` is `SPECIES.length * 2` meshes (trunk+foliage per species, in
  `SPECIES` order — 4 today). `disposeVegetation(group)` releases every mesh's geometry/material, same
  `disposeSettlements`/`disposeRoadNetwork`/`disposeWater` single-argument convention every other
  disposer here follows. Also exports pure helpers (`distancePointToSegment2D`, `isPlaceablePosition`,
  `pickSpeciesIndex`) for direct smoke-test assertions without spinning up a full scatter pass. Closes
  a real, long-named-but-never-built gap — see the file's own header for the full history.

## Conventions

- **Determinism:** every generator in this folder must take an explicit `seed` and use a seeded
  PRNG (`mulberry32` in `terrain.js`) — never `Math.random()`. Same seed + same config must always
  produce the same world.
- **Chunk grid:** chunk `(chunkX, chunkZ)` is centered at world position `(chunkX * size, 0,
  chunkZ * size)` (meters), where `size` should come from `CHUNK_CONFIG.CHUNK_SIZE_METERS` in
  `config.js`. Keep this convention consistent across every system that reasons about chunks
  (terrain, vegetation, settlements, streaming) — don't invent a second one.
- **Sea level:** `WORLD_DEFAULTS.WATER_LEVEL_METERS` (`config.js`) is the one shared constant for
  "where is the water." Any future system that places things by height (settlements, roads, rivers)
  must check against it rather than assuming its own threshold.
