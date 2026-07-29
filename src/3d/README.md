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
  `CHUNK_CONFIG`, storage keys, event names. No magic numbers should live outside this file (folder
  README exceptions: `world/terrain.js`'s local color/noise-scale constants and `sky.js`'s local
  color/radius constants — small, single-module tuning values that don't need to be global).
- **`camera.js`** — `createOrbitCamera()`, the dev-preview `OrbitControls` wrapper. Will likely be
  replaced (not extended) by a real third-person camera in Phase 4.
- **`sky.js`** — `createAuroraSky()`/`updateAuroraSky()`/`disposeAuroraSky()`: procedural aurora
  skybox, inline GLSL shader, no external asset files.

## Subfolders

- **`world/`** — terrain/chunk streaming; see its own `README.md`.
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
