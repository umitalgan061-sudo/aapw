# Architecture — Westeros 3D World

One entry per system. Kept in sync whenever a system is added or its dependencies change — see
`3D_GAME_PROGRESS.md` for what phase each system belongs to and `DECISIONS.md` for why it's built
the way it is.

## `src/3d/eventBus.js` — EventBus

- **Depends on:** nothing.
- **Used by:** every other system (`state.js`, `assetLoader.js`, `game3d.js`, and all future
  gameplay/world systems). Systems must talk to each other only through this bus, never via direct
  references, so the architecture stays open to a future ECS/multiplayer split.
- **Critical path:** yes — if this fails to construct, nothing in the 3D mode can communicate.
- **Failure mode:** a throwing listener is caught and logged per-listener (`emit` wraps each
  handler call in try/catch), so one broken system can't stop the rest of the world from ticking.

## `src/3d/state.js` — GameState

- **Depends on:** `eventBus.js` (emits `state:<key>` on every change).
- **Used by:** `game3d.js` (loading/phase/error tracking); future systems will read quality level,
  current phase, etc. from here instead of module-level globals.
- **Critical path:** yes for loading/error UI, not for rendering itself.
- **Failure mode:** none currently — plain object writes, cannot throw.

## `src/3d/assetLoader.js` — AssetLoader

- **Depends on:** `eventBus.js`, lazy dynamic-imports `GLTFLoader` (from
  `vendor/three/addons/loaders/`) only when a model load is first requested.
- **Used by:** `game3d.js` (`assetLoader` singleton export); will be used by every future system
  that loads a model/texture.
- **Critical path:** no — falls back to a placeholder box mesh on load failure (L1 silent fallback
  per the project's error-handling hierarchy).
- **Failure mode:** emits `asset:error`, logs, substitutes a placeholder. Never throws to callers.

## `src/3d/config.js` — Config/constants

- **Depends on:** nothing.
- **Used by:** every system. No magic numbers should live outside this file.
- **Contains:** vendor/asset paths, quality presets, `WORLD_DEFAULTS` (FOV/near/far/target FPS),
  storage keys, event names, and — as of this run — `WORLD_SCALE` and `CHUNK_CONFIG` (the
  kingdom-bounding-box-derived world size and 500m chunk grid; see `DECISIONS.md` ADR-0001).
- **Critical path:** yes — every system imports constants from here.
- **Failure mode:** N/A (static data only).

## `game3d.html` / `game3d.css` — 3D mode's own page

- **Depends on:** `src/3d/vendor/three/three.module.js` + `addons/` (via import map),
  `src/3d/game3d.js`, `src/3d/eventBus.js`, `src/3d/config.js`.
- **Used by:** nothing else — this is the page users navigate to (from the "🎮 3D Dünya" button in
  `index.html`'s toolbar). Deliberately isolated: no shared CSS/JS with `index.html`/`style.css`,
  so 3D-mode work can never accidentally break the 2D game.
- **Critical path:** yes for the 3D mode, irrelevant to the 2D game.
- **Failure mode:** the inline module script listens for `EVENTS.GAME_ERROR` and turns the loading
  overlay into a visible Turkish error message instead of leaving a blank/black screen (L3 —
  critical error screen, no silent white/black screen).

## `src/3d/world/terrain.js` — Procedural terrain chunk generation

- **Depends on:** `three` (vendored). Deliberately does not import `config.js` — callers pass
  `size`/`seed` explicitly (see `world/README.md`'s chunk-grid convention) so this module stays
  generic and reusable by any future caller, not coupled to one config shape.
- **Used by:** `game3d.js` (`createTerrainChunk`/`disposeTerrainChunk`), and will be used by the
  future chunk-manager/streaming system (not built yet — see `3D_GAME_PROGRESS.md`).
- **Critical path:** yes for anything world-geography related — every future World Coverage % gain
  goes through this module (or its eventual siblings: rivers, roads, settlements).
- **Failure mode:** none yet (pure synchronous geometry math, cannot fail at runtime short of an
  out-of-memory condition on a pathological segment count — not currently guarded, revisit if
  chunk resolution ever becomes caller-configurable beyond this project's own code).
- **Determinism:** seeded (`mulberry32`), no `Math.random()` — same `(chunkX, chunkZ, seed)` always
  produces the same chunk.

## `src/3d/game3d.js` — Entry point / scene bootstrap

- **Depends on:** `three` (vendored), `eventBus.js`, `state.js`, `assetLoader.js`, `config.js`.
- **Used by:** `game3d.html` only (calls `initGame3D()`).
- **Critical path:** yes — owns the `WebGLRenderer`/`Scene`/`PerspectiveCamera`, lighting, resize
  handling, and the `requestAnimationFrame` render loop. Currently renders one flat placeholder
  ground plane (not yet real terrain — see `3D_GAME_PROGRESS.md` for the terrain sub-task).
- **Failure mode:** `initGame3D()` is fully try/caught — a WebGL init failure sets
  `gameState.error` and emits `GAME_ERROR` (caught by `game3d.html`'s error-screen listener above)
  rather than throwing an uncaught exception. If `#game3d-canvas` isn't present, rendering is
  skipped with a `console.warn`, not a throw, so the module stays safe to import from non-browser
  contexts (tests).

## 2D game (`index.html`, `script.js`, `style.css`, `service-worker.js`)

- **Depends on:** nothing in `src/3d/` or `assets/`.
- **Used by:** the existing PWA's users. The 3D mode adds exactly one additive touchpoint: a
  `<a class="tb-btn" href="game3d.html">` button in the toolbar. No other line in `index.html`,
  and no line in `script.js`/`style.css`/`service-worker.js`, has been modified for the 3D mode.
- **Critical path:** yes — this is the whole existing product. Every 3D-mode run must verify it
  still works (see the Regression Guard smoke-test list in the system instructions and this file's
  "This Run" sections).
- **Failure mode:** unchanged by the 3D mode; see the existing code for its own error handling.
