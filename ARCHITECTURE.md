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
  storage keys, event names, and `WORLD_SCALE`/`CHUNK_CONFIG` (the kingdom-bounding-box-derived
  world size and 500m chunk grid; bounding box from `DECISIONS.md` ADR-0001, scale corrected down
  to a ≤150 km² target by ADR-0004 — always check ADR-0004 for the current numbers, not ADR-0001).
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
- **Fog (added run 8):** uses `MeshStandardMaterial`, a built-in material whose `fog` property
  defaults to `true` — it automatically respects `scene.fog` (`fog.js`) with zero code here, unlike
  `sky.js`/`world/water.js`'s custom `ShaderMaterial`s, which need their own fog GLSL chunks to
  participate (see `fog.js`'s module doc).
- **Now also exports `createHeightSampler(seed, fbmOptions?)` and `mulberry32` (added run 10)** —
  pulled out of `createTerrainChunk`'s per-vertex loop into a standalone, pure function so
  `world/rivers.js` can query "how tall is the terrain at this exact point" without generating a
  chunk, and reuse the exact same PRNG rather than a second implementation. `createTerrainChunk`
  itself now calls `createHeightSampler` internally — same output as before this refactor (verified
  via an unchanged headless-Chromium terrain screenshot), not a behavior change.

## `src/3d/world/chunkManager.js` — ChunkManager

- **Depends on:** `world/terrain.js` (`createTerrainChunk`/`disposeTerrainChunk`).
- **Used by:** `game3d.js` — one `ChunkManager` instance, `loadSquare(0, 0,
  PHASE1_PREVIEW_RADIUS_CHUNKS)` at scene-bootstrap time, then `streamTowards(centerChunkX,
  centerChunkZ, STREAM_RADIUS_CHUNKS)` every frame the `OrbitControls` target has crossed into a
  new chunk (see `streamAroundOrbitTarget()` in `game3d.js`).
- **Critical path:** yes for World Coverage — `getCumulativeCoveredAreaKm2()`/
  `everGeneratedCount` are that metric's source of truth (not `getCoveredAreaKm2()`/`loadedCount`,
  which reflect only currently-resident chunks — see DECISIONS.md ADR-0003).
- **Failure mode:** none currently beyond what `terrain.js` can throw (nothing, today). Load/
  unload are idempotent (loading an already-loaded chunk key, or unloading a not-loaded one, is a
  safe no-op) so callers can't double-add or double-dispose a chunk by mistake.
- **Known limitation, by design:** `streamTowards` is additive-only — it never unloads chunks that
  fall out of range. No eviction policy exists yet; see ADR-0003 for why that's deliberate for now
  and what would trigger adding one.

## `src/3d/world/water.js` — Sea-level water

- **Depends on:** `three` (vendored) only. Deliberately does not import `terrain.js`/
  `chunkManager.js` — it doesn't need to know where terrain chunks are; a fixed-height plane
  intersects whatever terrain exists automatically. Reads `WORLD_DEFAULTS.WATER_LEVEL_METERS` via
  the `waterLevelMeters` parameter its caller passes in, not by importing `config.js` directly
  (matches `terrain.js`'s existing "caller passes config values explicitly" convention).
- **Used by:** `game3d.js` (`createWater`/`updateWater`/`disposeWater`) — one water mesh,
  re-centered on the camera every frame, same pattern as `sky.js`.
- **Critical path:** no — purely visual, same failure-mode profile as `sky.js` (a shader compile
  issue would misrender, not throw).
- **Failure mode:** none currently guarded. See DECISIONS.md ADR-0005 for why this is one
  camera-following plane rather than per-chunk water geometry, and why `terrain.js` needed no
  changes for lakes/coastline to appear (existing low-noise valleys are already at/near y=0,
  below the new sea level).
- **Participates in `scene.fog` (added run 9).** Its custom `ShaderMaterial` includes the
  `fog_pars_vertex`/`fog_vertex`/`fog_pars_fragment`/`fog_fragment` chunks and sets `fog: true`,
  with `THREE.UniformsLib.fog` merged into its own `uniforms` (required for a custom
  `ShaderMaterial` — unlike built-in materials, it isn't merged automatically; omitting it makes
  `WebGLRenderer`'s `refreshFogUniforms` throw at render time). See DECISIONS.md ADR-0008.

## `src/3d/world/rivers.js` — Deterministic downhill river + waterfall markers

- **Depends on:** `three` (vendored), `world/terrain.js` (`mulberry32` only — reuses the project's
  one PRNG implementation; does **not** import `createHeightSampler`, since the caller
  (`game3d.js`) builds the sampler and passes it in, same "caller wires config/dependencies
  together" convention `water.js`/`terrain.js` already follow).
- **Used by:** `game3d.js` (`generateRiverPath`/`createRiverMesh`/`disposeRiverMesh`, and
  `detectWaterfalls`/`createWaterfallMesh`/`disposeWaterfallMesh`) — one static river mesh plus zero
  or more waterfall "curtain" meshes, all generated once at scene bootstrap (not per-frame, not
  streamed — see DECISIONS.md ADR-0009 for the river's deliberately-scoped-down first pass and
  ADR-0011 for the waterfall detection built on top of it).
- **Critical path:** no — purely visual/geographic decoration; a pathological height field would
  at worst produce a very short or absent river (`createRiverMesh` returns `null` for <2 points,
  handled by `game3d.js`) or zero detected waterfalls, never a throw.
- **Failure mode:** none currently guarded — pure synchronous math over a caller-provided sampler
  function / an already-traced points array, same failure profile as `terrain.js`.
- **Determinism:** seeded (`mulberry32`, XORed with a fixed tag for an independent stream from
  terrain's own noise) — same `(seed, sampleHeightMeters)` always produces the same path, and
  `detectWaterfalls` is a pure function of that path (same points always flag the same segments).
- **Fog/lighting:** both the river ribbon and waterfall curtains use `MeshStandardMaterial`
  (built-in, `vertexColors`) like `terrain.js` — get `scene.fog` and the day/night lights for free,
  no custom shader chunks needed (contrast with `world/water.js`'s `ShaderMaterial`, which needed
  ADR-0008's explicit chunk/uniform wiring).
- **Waterfall thresholds (ADR-0011):** `detectWaterfalls` flags a segment when
  `dropMeters >= 2.5` AND `slope >= 0.06` — both constants calibrated against this world's actual
  traced river (seed 1337), not guessed. The rendered curtain is a deliberately schematic vertical
  quad, not a terrain-carved cliff — `terrain.js`'s smooth FBM has no real cliff faces yet.

## `src/3d/camera.js` — Orbit camera controls

- **Depends on:** `src/3d/vendor/three/addons/controls/OrbitControls.js` (vendored three.js r160
  addon, same pin as the core build — see `3D_GAME_PROGRESS.md` Asset Sources).
- **Used by:** `game3d.js` only (`createOrbitCamera(camera, canvas)`).
- **Critical path:** no — purely a dev-preview convenience. A real third-person player-follow
  camera (spring-arm + wall-avoidance raycast) is separate Phase 4 work and will likely replace
  this rather than build on it.
- **Failure mode:** none currently (vendored, well-tested upstream code; this module only
  configures it). Caller must call `.update()` every frame (damping requires it) and `.dispose()`
  on teardown to remove its pointer/wheel listeners — both already wired in `game3d.js`.

## `src/3d/sky.js` — Aurora skybox

- **Depends on:** `three` (vendored) only. Deliberately does not import `config.js` — its GLSL is
  inline (see the module doc comment for why: avoids a new fetched-`.glsl` async load path and
  offline-cache entry for something this cheap to inline; consistent with `3D_GAME_PROGRESS.md`'s
  Asset Sources note that shaders need no external files).
- **Used by:** `game3d.js` (`createAuroraSky`/`updateAuroraSky`/`disposeAuroraSky`) — one sky mesh,
  re-centered on the camera and re-animated every frame so it always surrounds the viewer.
- **Critical path:** no — purely visual; a shader compile failure would render an invalid
  color/black sphere (three.js logs to console, doesn't throw) rather than break the rest of the
  scene.
- **Failure mode:** none currently guarded beyond three.js's own shader-compile console logging.
  `SKY_RADIUS_METERS` (1900) must stay under `WORLD_DEFAULTS.FAR_PLANE` (config.js, 2000m) or the
  sphere itself gets frustum-clipped — flagged in the module's own comment, not currently enforced
  by code (both are static constants that don't currently share a source of truth; revisit if
  `FAR_PLANE` ever becomes runtime-configurable via `QUALITY_PRESETS`).
- **Time-of-day driven (added FAZ 2 run 7):** `updateAuroraSky` now takes a fourth `dayNight`
  argument (`{horizonColor, zenithColor, nightFactor}`, produced by `lighting.js`'s
  `updateDayNightLighting`) and applies it to `uHorizonColor`/`uZenithColor`/`uNightFactor` every
  frame — the sky gradient blends blue-day to dusk-night, and the aurora fades out in daylight
  (`uNightFactor` scales the aurora term in the fragment shader). The always-on placeholder noted
  above is resolved; see DECISIONS.md ADR-0006.

## `src/3d/lighting.js` — Day/night cycle

- **Depends on:** `three` (vendored) only. Deliberately does not import `config.js` — callers pass
  `dayLengthSeconds`/`startRatio` explicitly (matches `terrain.js`/`world.js`'s existing
  "caller passes config values in" convention).
- **Used by:** `game3d.js` (`createDayNightLighting`/`updateDayNightLighting`/
  `disposeDayNightLighting` — owns the scene's `DirectionalLight` "sun" and `HemisphereLight` sky
  fill, previously created inline in `game3d.js`) and `sky.js` indirectly (`game3d.js` passes
  `updateDayNightLighting`'s return value straight into `updateAuroraSky`).
- **Critical path:** no — purely visual; a bad interpolation would misrender lighting, not throw
  (all math is plain arithmetic on finite keyframe constants, no external input).
- **Failure mode:** none currently guarded — no user/network input reaches this module, only
  `elapsedSeconds` from `game3d.js`'s own `THREE.Clock`.
- **No GPU resources of its own:** lights have no geometry/texture/shadow-map yet (shadows aren't
  enabled anywhere in the project). `disposeDayNightLighting` just removes the two lights from the
  scene, for symmetry with every other system's create/update/dispose triplet.

## `src/3d/fog.js` — Distance fog

- **Depends on:** `three` (vendored) only. Takes `lighting.js`'s per-frame output (`horizonColor`,
  `nightFactor`) as a plain argument to `updateFog` — does not import `lighting.js` itself, same
  "caller wires systems together, modules don't reach across to each other" pattern as everything
  else here.
- **Used by:** `game3d.js` (`createFog()` assigned to `scene.fog`, `updateFog()` called once per
  frame after `updateDayNightLighting()`). Consumed automatically by any built-in material in the
  scene (`world/terrain.js`'s `MeshStandardMaterial`) via three.js's own `scene.fog` mechanism —
  no per-material wiring needed for those. Custom `ShaderMaterial`s (`sky.js`, `world/water.js`) do
  **not** pick it up automatically; `sky.js` deliberately opts out, `world/water.js` doesn't opt in
  yet (tech debt, see `3D_GAME_PROGRESS.md`).
- **Critical path:** no — purely visual.
- **Failure mode:** none currently guarded — plain arithmetic on finite inputs, no external data.
- **No GPU resources of its own:** `THREE.FogExp2` is plain JS data (color + density), not a
  GPU-backed resource — no `dispose*()` needed, unlike every mesh-owning system in this file.

## `src/3d/game3d.js` — Entry point / scene bootstrap

- **Depends on:** `three` (vendored), `eventBus.js`, `state.js`, `assetLoader.js`, `config.js`,
  `world/chunkManager.js`, `world/terrain.js` (`createHeightSampler` only), `world/water.js`,
  `world/rivers.js`, `camera.js`, `sky.js`, `lighting.js`, `fog.js`.
- **Used by:** `game3d.html` only (calls `initGame3D()`).
- **Critical path:** yes — owns the `WebGLRenderer`/`Scene`/`PerspectiveCamera`, the day/night
  lights (`lighting.js`), the scene fog (`fog.js`), resize handling, the `OrbitControls` instance,
  the `ChunkManager` instance, the aurora sky mesh, the water plane, the static river mesh and its
  waterfall curtain meshes (`world/rivers.js`, all generated once, not part of the per-frame loop),
  and the `requestAnimationFrame` render loop (which also drives `controls.update()`,
  `streamAroundOrbitTarget()`, `updateDayNightLighting()`, `updateAuroraSky()`, `updateFog()`, and
  `updateWater()` each frame — see `world/chunkManager.js`, `lighting.js`, `fog.js`, `sky.js`,
  `world/water.js`, and DECISIONS.md ADR-0003/ADR-0006/ADR-0007/ADR-0009/ADR-0011).
- **Failure mode:** `initGame3D()` is fully try/caught — a WebGL init failure sets
  `gameState.error` and emits `GAME_ERROR` (caught by `game3d.html`'s error-screen listener above)
  rather than throwing an uncaught exception. If `#game3d-canvas` isn't present, rendering is
  skipped with a `console.warn`, not a throw, so the module stays safe to import from non-browser
  contexts (tests).
- **Device-class chunk radius (ADR-0010):** `createScene()` picks the one-time boot preview radius
  via `isCoarsePointerDevice()` (`window.matchMedia('(pointer: coarse)')`, try/caught to `false`) —
  `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` on desktop-class devices, the mobile-budget
  `STREAM_RADIUS_CHUNKS` on touch-primary ones. Fixes a real gap: every prior run grew the preview
  radius under a "desktop-only" comment that nothing actually enforced at runtime, so a real phone
  was silently loading the full desktop chunk count and blowing the mobile triangle budget.

## 2D game (`index.html`, `script.js`, `style.css`, `service-worker.js`)

- **Depends on:** nothing in `src/3d/` or `assets/`.
- **Used by:** the existing PWA's users. The 3D mode adds two additive touchpoints: a
  `<a class="tb-btn" href="game3d.html">` button in `index.html`'s toolbar, and a second,
  independent `cache.addAll(GAME3D_SHELL_FILES)` call in `service-worker.js`'s `install` handler
  (own `.catch()`, so a 3D-precache failure can never block the 2D app shell's own
  `cache.addAll(SHELL_FILES)` — see that file's comments and `3D_GAME_PROGRESS.md`'s FAZ 1
  checklist). No line in `script.js`/`style.css`, and no *existing* line in `service-worker.js`,
  has been modified for the 3D mode — only new, additive lines were added.
- **Critical path:** yes — this is the whole existing product. Every 3D-mode run must verify it
  still works (see the Regression Guard smoke-test list in the system instructions and this file's
  "This Run" sections).
- **Failure mode:** unchanged by the 3D mode; see the existing code for its own error handling.
