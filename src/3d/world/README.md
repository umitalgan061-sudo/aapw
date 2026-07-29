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
- **`water.js`** — sea-level water. `createWater(waterLevelMeters)` returns one large
  Gerstner-wave-shaded `THREE.Mesh` plane; `updateWater(mesh, cameraPosition, elapsedSeconds)`
  re-centers it on the camera and advances the wave animation (call every frame);
  `disposeWater(mesh)` releases its geometry/material. Deliberately **not** per-chunk and **not**
  a `ChunkManager`-owned concept — a single plane at a fixed sea level already floods `terrain.js`'s
  low points into natural lakes/coastline with no terrain changes needed. See `DECISIONS.md`
  ADR-0005 for the full reasoning and alternatives considered.

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
