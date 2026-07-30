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
  `vendor/three/addons/loaders/`) only when a model load is first requested, and (added FAZ 4)
  `FBXLoader` the same way — only paid for once a Mixamo-style character/animation FBX is
  requested. `FBXLoader.js` itself vendors two more transitive deps (`vendor/three/addons/libs/
  fflate.module.js`, `vendor/three/addons/curves/NURBSCurve.js` + `NURBSUtils.js`) — never imported
  by anything in this project directly, only by `FBXLoader.js` itself.
- **Used by:** `game3d.js` (`assetLoader` singleton export); `gameplay/player.js` and (added FAZ 5,
  run 20) `gameplay/npc.js` (both use `loadFBXModel` and the shared static
  `correctMixamoFbxScale(model)` helper — Mixamo FBX exports store geometry in centimeters;
  `FBXLoader` stashes the file's own conversion factor in `userData.unitScaleFactor` but doesn't
  apply it, so this one static method does, rather than two independently hand-copied blocks); and
  (added FAZ 6, run 26) `gameplay/animals.js` (uses `loadModel` — the wolf's glTF/GLB needs no
  Mixamo-style scale correction, its source file is already real-world-meter scale). `loadModel`
  itself was extended run 26 to stash `gltf.animations` onto the returned scene's own `.animations`
  property, the same convention `FBXLoader` already followed for FBX groups — previously discarded,
  since nothing had needed a GLTF model's animation clips until now.
- **Critical path:** no — falls back to a placeholder box mesh on load failure (L1 silent fallback
  per the project's error-handling hierarchy).
- **Failure mode:** emits `asset:error`, logs, substitutes a placeholder. Never throws to callers.

## `src/3d/config.js` — Config/constants

- **Depends on:** nothing.
- **Used by:** every system. No magic numbers should live outside this file.
- **Contains:** vendor/asset paths, quality presets, `WORLD_DEFAULTS` (FOV/near/far/target FPS),
  storage keys, event names, `WORLD_SCALE`/`CHUNK_CONFIG` (the kingdom-bounding-box-derived
  world size and 500m chunk grid; bounding box from `DECISIONS.md` ADR-0001, scale corrected down
  to a ≤150 km² target by ADR-0004 — always check ADR-0004 for the current numbers, not ADR-0001),
  `SETTLEMENT_CONFIG` (castle keep/tower/roof dimensions for `world/settlements.js`, added FAZ 3 —
  see ADR-0013), and (added FAZ 4) `PLAYER_CONFIG` (character/animation asset URLs, walk/run
  speeds, turn rate, animation crossfade duration, spawn point, chase-camera framing/distance
  limits — see ADR-0016), `TOUCH_JOYSTICK_CONFIG` (drag radius, dead zone, run threshold for
  `ui/touchJoystick.js` — see ADR-0017), and (added FAZ 5, run 20, extended run 21/22) `NPC_CONFIG`
  (idle/walk animation URLs reused from `PLAYER_CONFIG`, patrol speed/pause/turn-rate constants added
  run 22, and the flat `SPAWNS` list mapping a kingdom-seat id + world offset to a Mixamo character
  FBX for each NPC, with an optional `patrol` field — 10 entries across 9 seats, all patrolling, as
  of run 25 — see `gameplay/npc.js` and ADR-0019/ADR-0020/ADR-0021/ADR-0023/ADR-0024), and (added
  FAZ 6, run 26, patrol added run 27, flee added run 28) `ANIMAL_CONFIG` (wolf model URL, idle/walk/
  flee clip names, patrol speed/pause/turn-rate constants, flee trigger-radius/speed constants, the
  `STRIP_CHILD_NAMES` list for the source file's bundled non-skinned decoration mesh, and a `SPAWNS`
  list — same seat+offset+optional-`patrol` shape as `NPC_CONFIG.SPAWNS` — see `gameplay/animals.js`
  and ADR-0025/ADR-0026/ADR-0027).
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
  new chunk (see `streamAroundOrbitTarget()` in `game3d.js`). Also `getLoadedChunkMesh(chunkX,
  chunkZ)` (ADR-0018), read every frame by `collectCameraCollidables()` to fetch the player's
  current chunk mesh (+ 8 neighbors) as camera wall-avoidance raycast candidates, without that
  caller needing to know the internal `chunkKey` format.
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

## `src/3d/world/settlements.js` — Kingdom-seat castles (FAZ 3)

- **Depends on:** `three` (vendored) and `world/materials.js` (`createStoneMaterial`/
  `createRoofMaterial`/`disposeCastleMaterial`, added run 16/ADR-0015). Deliberately does not
  import `config.js` (matches `terrain.js`/`water.js`/`rivers.js`'s "caller passes config values
  in" convention) or `script.js`
  (see the module's own doc comment: importing the 2D game's top-level script as an ES module here
  would execute 2D-game logic against DOM elements this page doesn't have — a real risk to the
  "keep the 2D game intact" golden rule, not hypothetical). `KINGDOM_SEATS` is a hand-copied,
  frozen snapshot of `script.js`'s `INIT_KINGDOMS` (id/name/house/color/map-x/map-y only, no
  gameplay state) — hand-sync if kingdom data changes materially, same rule as `config.js`'s
  `WORLD_SCALE` bounding box.
- **Used by:** `game3d.js` (`createSettlements`/`disposeSettlements`) — one `THREE.Group` holding 3
  `InstancedMesh`es (keeps/towers/roofs, one per castle *part*, not one per castle) covering all 14
  kingdom seats, generated once at scene bootstrap like `world/rivers.js`. Its `seats` return value
  (id/name/world x,z/groundY) is also exposed on `game3d.js`'s scene state as `settlementSeats`
  (added FAZ 5, run 20) so `NPC_CONFIG.SPAWNS` entries can resolve a `seatId` to a real, already-
  sampled world position without re-deriving `mapToWorldXZ` themselves — see `gameplay/npc.js` and
  ADR-0019.
- **Critical path:** no — purely visual/geographic; a pathological height field would at worst
  place castles at an unusual (but still sea-level-clamped) height, never throw.
- **Failure mode:** none currently guarded — pure synchronous math over a caller-provided height
  sampler, same failure profile as `terrain.js`/`rivers.js`.
- **Determinism:** every seat's *position* is a deterministic function of its fixed `mapX`/`mapY`
  and the (already-seeded) `sampleHeightMeters` — no randomness in placement at all. Material
  *appearance* now involves seeded randomness too, via `world/materials.js`'s `mulberry32`-driven
  texture generation (`createSettlements`'s new required `seed` option, passed straight through) —
  see that module's own Determinism note below.
- **Coordinate convention established here (ADR-0013):** `mapToWorldXZ(mapX, mapY, mapBounds,
  metersPerMapUnit)` maps the padded kingdom bounding box's *center* to the world origin — the same
  origin chunk `(0, 0)` is centered on. Any future system placing things by 2D-map coordinate
  (roads, NPC spawn points, quest markers) should reuse this exact function, not invent a second
  mapping.
- **Device-class dependent (see `game3d.js` below):** on desktop-class devices, `game3d.js` force-
  loads a 3x3 terrain-chunk neighborhood under every seat so no castle renders floating over
  unrendered ground. On mobile-class devices this is skipped — measured to add ~92 chunks (~753K
  triangles, 1.9x the *entire* mobile triangle budget on its own) if done unconditionally; mobile
  castles still sample the real terrain height, just may render without a visible ground mesh
  directly beneath until player-streaming (FAZ 4+) reaches that chunk naturally.
- **Fog/lighting:** built-in `MeshStandardMaterial` (like `terrain.js`/`rivers.js`) — gets
  `scene.fog` and the day/night lights for free, no custom shader chunks needed.

## `src/3d/world/materials.js` — Procedural castle PBR textures (FAZ 3, run 16)

- **Depends on:** `three` (vendored) and `world/terrain.js`'s exported `mulberry32` (reused, not
  reimplemented — same PRNG every other world-generation module uses). Uses the browser's
  `document.createElement('canvas')`/`CanvasRenderingContext2D` — browser-only, same as every other
  file under `src/3d/`.
- **Used by:** `world/settlements.js` only (`createStoneMaterial`/`createRoofMaterial` build the
  keep/tower and roof materials; `disposeCastleMaterial` releases a material's maps on teardown).
  Not imported anywhere else — if a future system (roads? a second building type?) needs similar
  procedural stone texturing, reuse this module rather than duplicating the height-field/canvas
  logic.
- **Critical path:** no — purely cosmetic; a pathological seed would at worst produce visually
  scrappy variance, never throw or block scene bootstrap.
- **Failure mode:** none currently guarded — synchronous canvas drawing over a fixed-size
  (`TEXTURE_SIZE = 256`) buffer, same failure profile as the rest of `world/`.
- **Determinism:** `createStoneMaterial`/`createRoofMaterial` both take `seed` and use
  `mulberry32(seed)` — same seed always paints the same texture. `settlements.js` passes
  `WORLD_DEFAULTS.WORLD_SEED` for stone, `WORLD_SEED + 1` for roofs (deliberately different, so the
  two materials don't paint an identical pattern).
- **Memory:** each material owns up to 3 `THREE.CanvasTexture`s (`map`/`roughnessMap`/`normalMap`)
  at 256x256 RGBA — three.js does not dispose a material's textures when the material itself is
  disposed, so `disposeCastleMaterial` (not a bare `material.dispose()`) must be used on teardown;
  `settlements.js`'s `disposeSettlements` already does this correctly.

## `src/3d/camera.js` — Orbit camera controls / FAZ 4 chase camera

- **Depends on:** `src/3d/vendor/three/addons/controls/OrbitControls.js` (vendored three.js r160
  addon, same pin as the core build — see `3D_GAME_PROGRESS.md` Asset Sources).
- **Used by:** `game3d.js` (`createOrbitCamera(camera, canvas, {minDistance, maxDistance})`, and,
  every frame, `resolveCameraCollision(raycaster, target, desiredPosition, collidables,
  marginMeters, minDistanceMeters)`).
- **Critical path:** no — purely a camera convenience.
- **Failure mode:** none currently (vendored, well-tested upstream code; this module only
  configures it). Caller must call `.update()` every frame (damping requires it) and `.dispose()`
  on teardown to remove its pointer/wheel listeners — both already wired in `game3d.js`.
- **FAZ 4 update (ADR-0016):** rather than a separate custom spring-arm rig, `game3d.js` reuses this
  same instance as the player's chase camera — `createOrbitCamera` now accepts `minDistance`/
  `maxDistance` overrides (`PLAYER_CONFIG.CAMERA_MIN_DISTANCE_METERS`/`CAMERA_MAX_DISTANCE_METERS`,
  much tighter than the 20-1800m dev-preview defaults), and `game3d.js`'s tick loop translates both
  `camera.position` and `controls.target` by the player's per-frame movement delta every frame
  (required — see ADR-0016's "real bug found" note: moving `target` alone does *not* move the
  camera, `OrbitControls.update()`'s offset math cancels it out). Free-pan is disabled
  (`controls.enablePan = false`) once a player exists, since a panned target would just get
  overwritten next frame.
- **FAZ 4 wall-avoidance (ADR-0018):** `resolveCameraCollision` raycasts from `controls.target`
  toward the free-orbit camera position every frame and, if a terrain/castle mesh occludes it,
  returns a new position pulled in just short of the hit (`PLAYER_CONFIG.
  CAMERA_COLLISION_MARGIN_METERS`, floored at `CAMERA_COLLISION_MIN_DISTANCE_METERS`). Stateless —
  it never writes back into `OrbitControls`' own spherical radius; `game3d.js` applies the pulled-in
  position only for that frame's `renderer.render()` call and restores the true desired position
  immediately after, so a collision is a one-frame visual clamp, not a permanent zoom change (the
  camera eases back out the instant line of sight clears). Reuses one caller-owned `THREE.Raycaster`
  (no per-frame allocation) against a small caller-supplied candidate list — see `game3d.js`'s
  `collectCameraCollidables` entry below for what's actually tested.

## `src/3d/physics.js` — Ground-collision resolution (FAZ 4)

- **Depends on:** `world/terrain.js` (`createHeightSampler`) — the one exception to "gameplay code
  doesn't reach into `world/` directly": this module exists specifically so *other* gameplay code
  gets that indirection instead.
- **Used by:** `game3d.js` (`createGroundCollider`, also feeds `world/rivers.js`'s
  `generateRiverPath` and `world/settlements.js`'s `createSettlements` their height sampler now —
  one shared instance per scene instead of three independent ones) and `gameplay/player.js`
  (`getGroundHeight` every movement step).
- **Critical path:** no — pure synchronous math, cannot fail at runtime.
- **Failure mode:** none (same as `world/terrain.js`'s own height sampler).
- **Scope, deliberately minimal:** ground-height snapping only. No gravity/velocity simulation, no
  wall/collider raycast against settlements — real future work once a concrete need exists
  (jumping, castle collision), not built speculatively now.

## `src/3d/input.js` — Keyboard input (FAZ 4)

- **Depends on:** nothing (reads `window` keydown/keyup events, passed in as a constructor param
  for testability).
- **Used by:** `game3d.js` (`KeyboardInput`, read once per frame via `getAxes()`).
- **Critical path:** no — if input never registers, the player just never moves (a stationary
  character is a safe degraded state, not a crash).
- **Failure mode:** none — plain `Set` membership tracking, cannot throw.
- **Camera-agnostic by design:** returns input-local `{forward, strafe, running}`, not a
  world-space direction — `game3d.js` combines this with the camera's facing itself (see
  `game3d.js`'s own entry below). Touch/joystick input lives separately in `ui/touchJoystick.js`.

## `src/3d/ui/touchJoystick.js` — On-screen touch joystick (FAZ 4, run 18)

- **Depends on:** `config.js` (`TOUCH_JOYSTICK_CONFIG`). Appends its own DOM (base+knob `<div>`s,
  styled via `game3d.css`) to a container element (`document.body` by default).
- **Used by:** `game3d.js` — instantiated only when `isCoarsePointerDevice()` is true, read once
  per frame via `getAxes()` (same shape as `KeyboardInput.getAxes()`), combined with keyboard axes
  via `game3d.js`'s `combineAxes()`, disposed on `pagehide`.
- **Critical path:** no — if it fails to construct or never registers a touch, the player just
  can't move via touch (keyboard still works if a keyboard happens to be attached; a stationary
  character is the same safe degraded state `input.js` already documents).
- **Failure mode:** none expected — plain DOM creation and Pointer Event listeners, no external
  data or async work, cannot throw under normal use.
- **Camera-agnostic by design:** same convention as `input.js` — returns input-local
  `{forward, strafe, running}` (continuous, not discrete, since it's an analog stick), never reads
  `OrbitControls`/`camera` directly. See `ui/README.md`.

## `src/3d/ui/interactionPrompt.js` — Proximity interaction affordance (FAZ 5 first pass, run 32)

- **Depends on:** nothing beyond the DOM — no `config.js` import (unlike `touchJoystick.js`); the
  proximity radius (`INTERACTION_CONFIG.PROMPT_RADIUS_METERS`) and the distance math are read/
  computed by `gameplay/interaction.js` (run 33), not by this file. Appends its own DOM
  (`<div class="g3d-interaction-prompt">`, styled via `game3d.css`) to a container element
  (`document.body` by default).
- **Used by:** `game3d.js` (instantiated unconditionally, not gated by device class, unlike
  `touchJoystick.js`) and `gameplay/interaction.js`'s controller, which calls `setVisible()` once per
  frame — hidden while a dialogue is open, shown when an NPC is in range and no dialogue is active.
  Disposed on `pagehide`.
- **Critical path:** no — a static text affordance with no game-state consequence; if it fails to
  construct, the player simply doesn't see the "someone's nearby" cue.
- **Failure mode:** none expected — plain DOM creation, no external data, no async work, cannot
  throw under normal use.
- **Deliberately narrow scope:** shows a static string, always the same text, regardless of which
  NPC triggered it or how many are in range — no per-NPC identity of its own (that lives in
  `gameplay/interaction.js`/`ui/dialogueBox.js` now, run 33).

## `src/3d/ui/dialogueBox.js` — Generic-greeting dialogue box (FAZ 5, run 33)

- **Depends on:** nothing beyond the DOM — no `config.js` import; `gameplay/interaction.js` passes
  in the already-built greeting string. Appends its own DOM
  (`<div class="g3d-dialogue-box">` with a text `<p>` and a static "E / Esc - Kapat" hint `<p>`,
  styled via `game3d.css`) to a container element (`document.body` by default).
- **Used by:** `gameplay/interaction.js`'s controller — `show(text)`/`hide()` called from its
  `openDialogue`/`closeDialogue` helpers, `isVisible` getter available if a future caller needs it
  (unused today). Disposed on `pagehide` (`game3d.js`).
- **Critical path:** no — a static text panel with no game-state consequence.
- **Failure mode:** none expected — plain DOM creation, cannot throw under normal use.
- **Deliberately narrow scope:** one generic greeting line, always the same template regardless of
  which NPC — no branching, no reply options, no per-NPC personality. A real dialogue *system*
  (content/branching/quest hooks) is separate, still-open FAZ 5 work — see DECISIONS.md ADR-0033 and
  3D_GAME_PROGRESS.md's Known Issues.

## `src/3d/ui/` (folder) — On-screen UI (joystick + interaction prompt + dialogue box today; future
HUD/inventory/debug panels)

- **Depends on:** `config.js` (only `touchJoystick.js` actually imports it; `interactionPrompt.js`
  and `dialogueBox.js` do not — their config values are read by `gameplay/interaction.js` instead
  and passed in as plain arguments). Only this folder plus `config.js` should be touched for a
  UI-system change (blast radius rule) — see `ui/README.md`.
- **Used by:** `game3d.js` directly (`touchJoystick.js`, `interactionPrompt.js`, `dialogueBox.js`
  instantiation) and `gameplay/interaction.js` (calls `interactionPrompt`/`dialogueBox` methods).
- **Critical path:** varies per file — see each file's own entry above.
- **Failure mode:** varies per file.

## `src/3d/gameplay/player.js` — Playable character (FAZ 4)

- **Depends on:** `three` (vendored, dynamic-imports `FBXLoader` via `assetLoader.js`),
  `config.js` (`PLAYER_CONFIG`), `assetLoader.js` (`loadFBXModel`, and the static
  `disposeObject3D` helper on teardown). Takes `groundCollider` (`physics.js`) and a pre-computed
  world-space movement direction as parameters rather than importing either — see
  `gameplay/README.md`'s Conventions for why (keeps this folder reusable if the camera system is
  ever replaced).
- **Used by:** `game3d.js` (`createPlayer`, `update()` called every frame, `dispose()` on
  `pagehide`).
- **Critical path:** yes for FAZ 4 — if the character fails to load, `assetLoader`'s existing L1
  silent-fallback substitutes a placeholder box (movement/ground-snapping still work on it, just no
  animation) rather than crashing the whole scene.
- **Failure mode:** an FBX load failure is caught inside `assetLoader.loadFBXModel` itself (L1,
  same as `loadModel`); a wholesale player-creation failure (e.g. a bug in this module, not an
  asset issue) propagates up to `game3d.js`'s existing top-level try/catch (L3 — critical error
  screen, not a silent blank page).
- **Determinism note:** the character's *position* is real-time-input-driven (inherently
  non-deterministic session to session, expected) but its ground-height sampling still goes
  through the same seeded `physics.js` collider every other system uses.

## `src/3d/gameplay/npc.js` — Static + patrolling NPCs (FAZ 5, run 20; extended to 5 seats/6 NPCs run 21, ADR-0020; waypoint patrol added run 22, pilot on 2 of 6, ADR-0021; name-tag billboards added run 23, ADR-0022; spawn-resolution wiring moved in from `game3d.js` run 29, ADR-0028; `displayName` exposed on the returned controller run 33, ADR-0033)

- **Depends on:** `three` (vendored, dynamic-imports `FBXLoader` via `assetLoader.js`),
  `assetLoader.js` (`loadFBXModel`, `AssetLoader.correctMixamoFbxScale` — static helper shared with
  `gameplay/player.js` — and `disposeObject3D` on teardown). No static `import` of `config.js` — the
  exported `spawnConfiguredNPCs({assetLoader, npcConfig, seatsById, sampleGroundY, groundCollider})`
  (run 29, ADR-0028) receives the whole `NPC_CONFIG` object as a runtime parameter from its caller
  (`game3d.js`) instead, resolves every `NPC_CONFIG.SPAWNS` entry against the passed-in
  `seatsById`/`world/settlements.js` seat data, and calls `createNPC` per spawn — this file owns the
  resolution loop itself now, `game3d.js` only supplies the config object and the two cross-system
  helpers (`seatsById`, `sampleGroundY`). Patrolling NPCs (run 22) get
  `groundCollider`/`walkAnimationUrl`/`patrolWaypoints` derived the same way, inside
  `spawnConfiguredNPCs`. A `displayName` (run 23) gets a `createNameTagSprite`-built `THREE.Sprite`
  (canvas-rendered text, `THREE.CanvasTexture`) added as a child of the model — see ADR-0022 for the
  parent-scale correction this required (`AssetLoader.correctMixamoFbxScale`'s ~0.01 model scale
  otherwise shrinks a naively child-parented sprite's position/size to near-invisibility).
- **Used by:** `game3d.js` (`spawnConfiguredNPCs` once at boot; `update()` called every frame per NPC
  — keeps the idle/walk mixer ticking and, for patrolling NPCs, advances position/rotation —
  `dispose()` on `pagehide`). The returned controller's `displayName` field (run 33) is read by
  `gameplay/interaction.js` to build a greeting without a separate lookup back into
  `NPC_CONFIG.SPAWNS`.
- **Critical path:** no — a load failure degrades the same way `player.js`'s does: `assetLoader`'s
  existing L1 silent-fallback substitutes a placeholder box (no animation, but no crash) rather than
  throwing; `initGame3D`'s own try/catch is the backstop for anything else.
- **Failure mode:** same profile as `gameplay/player.js` — an FBX load failure is caught inside
  `assetLoader.loadFBXModel` itself (L1); a wholesale creation failure propagates to `game3d.js`'s
  top-level try/catch (L3).
- **Determinism note:** an NPC's position is **not** real-time-input-driven (unlike the player) — a
  static NPC's `(worldX, worldZ, groundY)` and a patrolling NPC's `patrolWaypoints` are both computed
  once at load time from `NPC_CONFIG.SPAWNS`' static offsets and `world/settlements.js`'s
  deterministic seat placement, so an NPC's full position-over-time trajectory is itself deterministic
  given the same seed/config/elapsed-time, not just its ground-height sampling.
- **Movement, when `patrolWaypoints` is supplied (run 22, ADR-0021):** a straight line to the next
  point (index wraps via modulo — 2 points ping-pong, 3+ loop), pausing to idle at each one. No
  pathfinding/obstacle-avoidance/player-awareness — deliberately the smallest thing that earns
  "patrol," not a behavior tree (see ADR-0021's "Alternatives considered"). Omitting
  `patrolWaypoints` (the default) keeps the run-20/21 static-idle behavior byte-for-byte.
- **Scope, deliberately minimal (ADR-0019, extended ADR-0021/ADR-0022):** loads, retargets, positions,
  idles, (all 11, run 24) walks a scripted patrol, and shows a billboard name-tag above its head. No
  real AI or player-awareness (patrol runs on a fixed clock regardless of the player) — a proximity
  prompt + generic greeting dialogue exist since run 32/33 (see `ui/interactionPrompt.js`,
  `ui/dialogueBox.js`, `gameplay/interaction.js`), but this file itself has no interaction logic —
  it only exposes `displayName` for the interaction system to read.

## `src/3d/gameplay/animals.js` — Wild animals, wolf (FAZ 6, run 26; patrol run 27; flee run 28; pack-alert run 29, ADR-0029; spawn-resolution wiring moved in from `game3d.js` run 29, ADR-0028)

- **Depends on:** `three` (vendored), `assetLoader.js` (`loadModel` — dynamic-imports `GLTFLoader`,
  and the static `disposeObject3D` helper on teardown). No static `import` of `config.js`, same
  runtime-parameter convention as `gameplay/npc.js`'s `spawnConfiguredNPCs`: the exported
  `spawnConfiguredAnimals({assetLoader, animalConfig, seatsById, sampleGroundY, groundCollider})`
  (run 29, ADR-0028) receives the whole `ANIMAL_CONFIG` object from `game3d.js`, resolves
  `ANIMAL_CONFIG.SPAWNS` entries against the passed-in `seatsById`, and calls `createWolf` per spawn
  with the final `modelUrl`/`idleClipName`/`stripChildNames`/`worldX`/`worldZ`/`groundY`, plus
  `groundCollider`/`walkClipName`/`patrolWaypoints` (run 27), `fleeClipName`/
  `fleeTriggerRadiusMeters`/`fleeSpeedMps` (run 28), and `packAlertRadiusMeters` (run 29, ADR-0029).
- **Used by:** `game3d.js` (`spawnConfiguredAnimals` once at boot; `update(delta, playerPosition,
  packmateFleePositions)` called every frame per animal — keeps the idle/walk/flee mixer ticking and
  advances position/rotation for patrolling or fleeing wolves — `dispose()` on `pagehide`). The
  `playerPosition`/`packmateFleePositions` parameters are optional — omitting `playerPosition`
  disables flee entirely (same as omitting `patrolWaypoints` disables patrol); omitting
  `packmateFleePositions` just means no pack-alert check happens that frame. `game3d.js`'s tick loop
  also reads each animal's `isFleeing` getter (run 29) to build every *other* animal's
  `packmateFleePositions` for that same frame.
- **Critical path:** no — a load failure degrades the same way `npc.js`'s does: `assetLoader`'s
  existing L1 silent-fallback substitutes a placeholder box (no animation, but no crash); a
  wholesale creation failure propagates to `game3d.js`'s top-level try/catch (L3).
- **Failure mode:** a GLTF load failure is caught inside `assetLoader.loadModel` itself (L1).
- **`stripNamedChildren` helper:** the wolf's source glTF bundles a non-skinned "Circle" mesh (a
  Blender shadow-catcher disc) as a scene-root sibling of the wolf's own skinned meshes — confirmed
  via the `.gltf` JSON sidecar, not guessed. `createWolf` removes any root child whose name is in
  `ANIMAL_CONFIG.STRIP_CHILD_NAMES` (disposing its geometry/material first) before adding the model
  to the scene, so it doesn't render as a stray flat disc near the wolf's feet.
- **Movement priority each frame (run 28): flee overrides patrol overrides idle.** If
  `fleeTriggerRadiusMeters` is configured and the player is within it, the wolf runs in a straight
  line directly away from the player's current position at `fleeSpeedMps`, checked first every frame
  — see ADR-0027. Otherwise, when `patrolWaypoints` is supplied (run 27, ADR-0026): a straight line
  to the next point (index wraps via modulo — 2 points ping-pong, 3+ loop), pausing to idle at each
  one. Both the patrol-walk and flee branches share a local `turnToward(targetYaw, delta)` closure
  (shortest-path turn, extracted run 28 since flee needed the identical logic a second time within
  this same file) — the movement *logic itself* is still copied from `gameplay/npc.js` rather than
  shared across files (see ADR-0026's "why duplicate" reasoning: differing loaders/clip-lookup APIs
  between the two files, and not wanting to widen blast radius into the already-stable FAZ 5 system
  for a readability-only win). Omitting both `patrolWaypoints` and `fleeTriggerRadiusMeters` keeps
  the run-26 static-idle-only behavior byte-for-byte.
- **Scope, deliberately minimal (extended ADR-0026/ADR-0027/ADR-0029):** loads, retargets, positions,
  idles, walks a scripted 2-point patrol, flees the player in a straight line, and (run 29) also
  flees when a packmate within `packAlertRadiusMeters` is already fleeing (no pathfinding/obstacle-
  avoidance, no hysteresis distance, only tested at today's 2-wolf count — see ADR-0029's
  Consequence for the chained-propagation caveat at 3+ animals). No real AI or name-tag yet — real
  future FAZ 6 work (other animal types — horses/carts/dogs/birds per the roadmap; each needs a
  human manual-download step), not built speculatively now.

## `src/3d/gameplay/interaction.js` — Proximity-prompt/dialogue-box state machine (FAZ 5, run 33)

- **Depends on:** nothing beyond the two UI objects passed into `createInteractionController`
  (`interactionPrompt`, `dialogueBox` — see `ui/interactionPrompt.js`/`ui/dialogueBox.js`) and plain
  config values (`greetingTemplate`, `radiusMeters`) passed as arguments — no static `import` of
  `config.js` or the UI modules themselves, consistent with `npc.js`/`animals.js`'s "receive
  everything as a parameter" convention (ADR-0028).
- **Used by:** `game3d.js` — `update(npcs, playerPos)` called once per tick-loop frame,
  `handleKeyDown(event)` forwarded from a single `window.addEventListener('keydown', ...)` added at
  init and removed on `pagehide`.
- **Critical path:** no — a UI/state-machine layer with no effect on terrain/streaming/rendering; a
  failure here would only mean the prompt/dialogue stop responding, not a scene crash.
- **Failure mode:** none expected — pure JS state tracking and `Math.hypot` distance checks, no
  external data, no async work, cannot throw under normal use.
- **Extracted from `game3d.js` (run 33):** inlining this logic directly in `game3d.js`'s
  `initGame3D()` pushed the file to 615 lines, over the project's 600-line-per-file cap — the same
  situation ADR-0028 already hit once for spawn-resolution loops. Same fix: move the self-contained
  logic into its own module. `game3d.js` now only wires the controller to the tick loop and the
  `keydown` listener.
- **Auto-close semantics:** `update()` recomputes the nearest in-range NPC every frame; if the
  currently-open dialogue's NPC is no longer that nearest NPC (whether because the *player* moved
  away, or because the *NPC* patrolled away — both look identical from this module's point of view),
  the dialogue auto-closes. See DECISIONS.md ADR-0033's "false alarm" note — this was verified
  against a real patrolling NPC, not just assumed correct from the distance math.

## `src/3d/gameplay/` (folder) — Playable characters, NPCs, animals, future dragons/combat/etc.

- **Depends on:** `eventBus.js`, `physics.js`, `input.js`, `config.js`, `assetLoader.js`. Only
  these plus this folder itself should be touched for a gameplay-system change (blast radius rule)
  — see `gameplay/README.md`.
- **Used by:** `game3d.js`.
- **Critical path:** varies per file — see `player.js`'s, `npc.js`'s, `animals.js`'s, and
  `interaction.js`'s own entries above.
- **Failure mode:** varies per file.

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

## `src/3d/stars.js` — Night starfield

- **Depends on:** `three` (vendored) only. Deliberately does not import `world/terrain.js`'s
  `mulberry32` — carries its own copy of the same PRNG algorithm, tagged for an independent stream,
  since stars are an atmosphere concern kept at the top `src/3d/` level, not a `world/` system (see
  DECISIONS.md ADR-0012).
- **Used by:** `game3d.js` (`createStarfield`/`updateStarfield`/`disposeStarfield`) — one
  `THREE.Points` cloud (1200 seeded points across the upper hemisphere), re-centered on the camera
  every frame like `sky.js`'s sphere, opacity driven directly by `lighting.js`'s `nightFactor`.
- **Critical path:** no — purely visual; a shader/material issue would misrender or stay invisible,
  never throw (built-in `PointsMaterial`, no custom shader).
- **Failure mode:** none currently guarded — pure synchronous geometry math, no external input.
- **Determinism:** seeded (`mulberry32`, XORed with a distinct tag from `terrain.js`/`rivers.js`'s
  own streams) — same seed always produces the same star pattern.
- **Fog:** deliberately `fog: false`, same reasoning as `sky.js`'s sphere — stars sit "at infinity"
  and would visibly (and wrongly) dim under this world's night fog density otherwise.

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
  `world/chunkManager.js`, `physics.js` (ground collider, feeds `world/rivers.js`/
  `world/settlements.js` too), `input.js`, `ui/touchJoystick.js`, `gameplay/player.js`,
  `gameplay/npc.js` (added FAZ 5, run 20), `gameplay/animals.js` (added FAZ 6, run 26),
  `world/water.js`, `world/rivers.js`, `world/settlements.js`, `camera.js`, `sky.js`, `stars.js`,
  `lighting.js`, `fog.js`.
- **Used by:** `game3d.html` only (calls `initGame3D()`).
- **Critical path:** yes — owns the `WebGLRenderer`/`Scene`/`PerspectiveCamera`, the day/night
  lights (`lighting.js`), the scene fog (`fog.js`), resize handling, the `OrbitControls` instance
  (now also the FAZ 4 chase camera — see `camera.js`'s entry), the `ChunkManager` instance, the
  aurora sky mesh, the water plane, the static river mesh and its waterfall curtain meshes
  (`world/rivers.js`), the 14 kingdom-seat settlements (`world/settlements.js`, all generated once,
  not part of the per-frame loop), the playable character (`gameplay/player.js`, loaded async
  *after* the rest of the scene — see `computeCameraRelativeMove` below), 10 static/patrolling NPCs
  (`gameplay/npc.js`'s `spawnConfiguredNPCs`, loaded async in parallel right after the player — added
  FAZ 5, run 20, see ADR-0019; spawn-resolution itself moved into `npc.js` run 29, ADR-0028), 2
  patrolling, player-fleeing, pack-alerted wolves (`gameplay/animals.js`'s `spawnConfiguredAnimals`,
  loaded async right after the NPCs — FAZ 6, run 26, patrol added run 27, flee added run 28,
  pack-alert added run 29, see ADR-0025/ADR-0026/ADR-0027/ADR-0028/ADR-0029), and the
  `requestAnimationFrame` render loop (which now also drives `keyboardInput.getAxes()`,
  `computeCameraRelativeMove()`, `player.update()` (its resulting `object3D.position` is read once,
  right after, into a local `playerPos` — run 28 moved this read earlier in the frame specifically
  so it could also feed each animal's flee check), each NPC's `update(delta)` and, for each animal, a
  freshly-built `packmateFleePositions` array (every *other* animal's position whose `isFleeing`
  getter reads true this frame — run 29, ADR-0029) passed into `update(delta, playerPos,
  packmateFleePositions)` (keeps their idle/walk/flee mixers ticking and advances position/rotation
  for patrolling/fleeing/pack-alerted entries), the chase-camera translation, `controls.
  update()`, `streamAroundOrbitTarget()`, `updateDayNightLighting()`, `updateAuroraSky()`,
  `updateFog()`, `updateWater()`, and (ADR-0018) `collectCameraCollidables()` +
  `camera.js`'s `resolveCameraCollision()` each frame — see `world/chunkManager.js`, `lighting.js`,
  `fog.js`, `sky.js`, `world/water.js`, and DECISIONS.md ADR-0003/ADR-0006/ADR-0007/ADR-0009/
  ADR-0011/ADR-0013/ADR-0016/ADR-0018/ADR-0019/ADR-0025/ADR-0026/ADR-0027).
- **`collectCameraCollidables(state, worldX, worldZ)` (module-local, added ADR-0018):** builds the
  small candidate list `resolveCameraCollision` raycasts against each frame — the player's current
  terrain chunk + its 8 immediate neighbors (via `chunkManager.getLoadedChunkMesh`, sufficient
  since `CAMERA_MAX_DISTANCE_METERS` is 40m, far short of one 500m chunk) plus every settlement
  part (`state.settlements.children`, 3 cheap `InstancedMesh`es). Reuses one module-local array
  (`_cameraCollidables.length = 0` then refill) rather than allocating a new array every frame.
  Water/river meshes are deliberately excluded — not "walls" in the sense this exists to fix.
- **Wall-avoidance apply/restore (tick loop, ADR-0018):** after `controls.update()` and the sky/
  stars/fog/water updates (which use the true free-orbit `camera.position`), the tick loop snapshots
  that desired position, calls `resolveCameraCollision`, applies the (possibly pulled-in) result to
  `camera.position` only for that frame's `renderer.render()` call, then immediately restores
  `camera.position` to the snapshotted desired value. This keeps the pull-in a purely visual,
  per-frame effect — the next frame's chase-delta translation (which reads `camera.position`) always
  starts from the user's true, uncollided zoom/orbit state.
- **`computeCameraRelativeMove(camera, controls, axes)` (module-local, added FAZ 4):** turns raw
  input axes into a world-space movement direction from the camera's current facing. Kept here,
  not in `gameplay/player.js`, so gameplay code stays camera-agnostic (see `gameplay/README.md`).
- **`combineAxes(keyboardAxes, joystickAxes)` (module-local, added FAZ 4 run 18):** sums the
  continuous forward/strafe components (clamped to [-1, 1]) and ORs `running`, so a touch-capable
  device with a keyboard attached can use either input source without one overriding the other.
  `joystickAxes` is `null` on desktop (no `TouchJoystick` instantiated there), in which case this
  just returns `keyboardAxes` unchanged. See `ui/touchJoystick.js`'s entry and ADR-0017.
- **`elapsedSeconds` tracking (changed FAZ 4):** the tick loop now calls `clock.getDelta()` once
  per frame (needed for player movement/animation) and accumulates it into `state.elapsedSeconds`
  itself, instead of calling `clock.getElapsedTime()` separately — avoids the two clock-reads
  fighting over the same internal `oldTime` bookkeeping. Numerically equivalent to before for every
  existing day-night/water/aurora consumer.
- **Failure mode:** `initGame3D()` is fully try/caught (now also wraps the `await createPlayer(...)`
  call) — a WebGL init *or* player-load failure sets `gameState.error` and emits `GAME_ERROR`
  (caught by `game3d.html`'s error-screen listener) rather than throwing an uncaught exception. If
  `#game3d-canvas` isn't present, rendering is skipped with a `console.warn`, not a throw, so the
  module stays safe to import from non-browser contexts (tests). In practice a player-load failure
  is unlikely to reach this outer catch at all — `assetLoader.loadFBXModel`'s own L1 fallback
  already substitutes a placeholder box for a missing/corrupt FBX.
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

## `scripts/checkAssetsManifest.js` — asset manifest consistency check (tooling, run 34)

- **Depends on:** `assets_manifest.json` and the real contents of `assets/`. Plain Node `fs` only —
  no npm dependency, no build step (consistent with this repo having no `package.json`).
- **Used by:** a human or a future run, invoked manually (`node scripts/checkAssetsManifest.js`)
  after adding/removing any file under `assets/` or any entry in `assets_manifest.json`. Not wired
  into a CI pipeline or git hook — this repo has neither today (see ADR-0034's Consequence).
- **Critical path:** no — a dev-time consistency check, not runtime code. Never imported by
  `game3d.js`/`index.html`/any browser-loaded file.
- **Failure mode:** exits 1 (with a listed reason) if a manifest entry points at a file that
  doesn't exist, or if a `.fbx`/`.glb` file on disk isn't registered in the manifest. Exits 0 (with
  non-fatal warnings for expected texture/sidecar files) otherwise. See ADR-0034 for the full
  design/alternatives.

## `scripts/smokeTestGame3D.js` — persisted regression-guard smoke test (tooling, run 34)

- **Depends on:** Playwright's Chromium (dev-only, not a repo dependency — see ADR-0035), a local
  static file server it starts itself (plain Node `http`), and `game3d.html`'s existing
  `#game3d-loading` / `g3d-loading-hidden` / `g3d-loading-error` DOM contract (see the `game3d.html`
  entry above) — no code change to that contract was needed, this script only observes it.
- **Used by:** a human or a future run, invoked manually (`node scripts/smokeTestGame3D.js`) as the
  Regression Guard's smoke test, replacing the ad-hoc throwaway Playwright script every prior run
  wrote fresh. Not wired into CI (none exists in this repo).
- **Critical path:** no — dev-time verification only, never imported by any browser-loaded file.
- **Failure mode:** exits 1 if the 3D mode (`game3d.html`) fails to reach its `GAME_READY`
  (`phase1-scene`) DOM signal within 60s, reaches its `GAME_ERROR` signal instead, or throws any
  uncaught page exception / logs any `console.error` during load — verified against a real injected
  failure, see ADR-0035. The 2D shell (`index.html`) check is informational-only (see ADR-0035 for
  why) and only fails this script if the page fails to navigate at all. Exits 2 (distinct from a
  real failure) if Playwright itself isn't resolvable in the current environment.
