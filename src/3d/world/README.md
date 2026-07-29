# `src/3d/world/`

Owns everything about the physical world: terrain, water, vegetation, roads, rivers, weather,
settlements. Only this folder and `src/3d/eventBus.js` should be touched when working on a system
here (blast radius rule — if a change needs more than that, it's not a world-system change).

## Files

- **`terrain.js`** — seeded value-noise/FBM terrain chunk generation. `createTerrainChunk({chunkX,
  chunkZ, seed, ...})` returns a positioned, ready-to-add `THREE.Mesh`; `disposeTerrainChunk(mesh)`
  releases its geometry/material.
- **`chunkManager.js`** — `ChunkManager` class: `loadChunk`/`unloadChunk`/`loadSquare` (a fixed
  square neighborhood around a center) on top of `terrain.js`, plus `loadedCount`/
  `getCoveredAreaKm2()` for World Coverage reporting and `disposeAll()` for teardown. Currently
  only ever called once at scene-bootstrap time with a fixed radius — real position-based
  streaming (load/unload as the player moves) is a later FAZ 1 sub-task; see
  `3D_GAME_PROGRESS.md`.

## Conventions

- **Determinism:** every generator in this folder must take an explicit `seed` and use a seeded
  PRNG (`mulberry32` in `terrain.js`) — never `Math.random()`. Same seed + same config must always
  produce the same world.
- **Chunk grid:** chunk `(chunkX, chunkZ)` is centered at world position `(chunkX * size, 0,
  chunkZ * size)` (meters), where `size` should come from `CHUNK_CONFIG.CHUNK_SIZE_METERS` in
  `config.js`. Keep this convention consistent across every system that reasons about chunks
  (terrain, vegetation, settlements, streaming) — don't invent a second one.
