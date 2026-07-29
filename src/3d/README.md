# `src/3d/`

Entry point and core architecture for the 3D Westeros world (a separate mode from the existing 2D
PWA — see the repo root `README.md`/`3D_GAME_PROGRESS.md` for how the two relate). Full dependency
graph and failure modes for every file below live in `ARCHITECTURE.md`; design rationale for
non-obvious choices lives in `DECISIONS.md` (ADR log). This file is just an index.

## Files

- **`game3d.js`** — entry point (`initGame3D()`), scene bootstrap (renderer/scene/camera/lights),
  render loop, teardown.
- **`eventBus.js`** — pub/sub (`gameEvents`); all cross-system communication goes through this,
  never direct references.
- **`state.js`** — `gameState`, a small observable key/value store (`state:<key>` events).
- **`assetLoader.js`** — `AssetLoader`: wraps `GLTFLoader` (lazy-imported), placeholder-mesh
  fallback on load failure, `disposeObject3D()` cleanup helper.
- **`config.js`** — every constant: vendor/asset paths, quality presets, `WORLD_SCALE`/
  `CHUNK_CONFIG`, `WORLD_DEFAULTS.WATER_LEVEL_METERS`, storage keys, event names. No magic numbers
  should live outside this file *unless* they're single-module cosmetic tuning nothing else reads
  (e.g. `world/terrain.js`'s color/noise-scale constants, `sky.js`'s aurora colors, `world/water.js`'s
  wave shape/plane-extent constants) — shared, cross-system facts like sea level belong here instead.
- **`camera.js`** — `createOrbitCamera()`, the dev-preview `OrbitControls` wrapper. Will likely be
  replaced (not extended) by a real third-person camera in Phase 4.
- **`sky.js`** — `createAuroraSky()`/`updateAuroraSky()`/`disposeAuroraSky()`: procedural aurora
  skybox, inline GLSL shader, no external asset files. `updateAuroraSky()` takes `lighting.js`'s
  day/night output so the gradient and aurora visibility track time-of-day.
- **`lighting.js`** — `createDayNightLighting()`/`updateDayNightLighting()`/
  `disposeDayNightLighting()`: owns the scene's sun (`DirectionalLight`) and sky-fill
  (`HemisphereLight`), keyframe-interpolated across a real-time day/night cycle.
- **`fog.js`** — `createFog()`/`updateFog()`: `scene.fog` (`THREE.FogExp2`), color/density synced
  every frame to `lighting.js`'s day/night output. Only affects built-in materials
  (`world/terrain.js`'s ground) — `sky.js`/`world/water.js`'s custom shaders don't consume it (see
  the module doc comment and 3D_GAME_PROGRESS.md Known Issues for `world/water.js`).

## Subfolders

- **`world/`** — terrain, chunk streaming, sea-level water; see its own `README.md`.
- **`vendor/`** — vendored third-party code (Three.js r160 + official addons), never hand-edited;
  see `3D_GAME_PROGRESS.md`'s Asset Sources table for exact provenance/license of each file.

## Conventions

- **Determinism:** anything that generates world geography must take an explicit `seed` and use a
  seeded PRNG (`mulberry32`), never `Math.random()`. Purely cosmetic/non-deterministic visuals
  (e.g. `sky.js`'s aurora animation) are exempt — nothing reads them back as world state.
- **Memory:** every system that allocates GPU resources (geometry/material/texture) must expose a
  `dispose*()` counterpart, called from `game3d.js`'s `pagehide` handler.
- **Blast radius:** a change to one system here should only need to touch that system's own
  file(s) plus `eventBus.js` — if it needs more, it's not a contained change (see the project's
  blast-radius rule in the top-level task instructions).
