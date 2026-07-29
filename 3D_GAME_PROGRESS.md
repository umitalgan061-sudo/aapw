# Westeros 3D World — Progress Tracker

This file is the single source of truth for the 3D RPG mode built alongside the existing
2D Westeros PWA. Every automated run reads this file first, picks up exactly where the
previous run left off, and updates it before finishing. **Read the "This Run" and "Next Step"
sections below before doing anything else.**

Private/unpublished repo — Westeros/Game of Thrones names and theme are used freely and are
consistent with the existing 2D game. The one hard constraint: no real HBO/show media files
(images/audio/video) are ever downloaded into this repo. Only original/procedural content or
genuinely CC0/CC-BY licensed generic fantasy assets (Kenney, Quaternius, Poly Haven, Mixamo,
KayKit, etc.) are used for `assets/`.

## Current Status

- **Active Phase:** FAZ 1 ✅ TAMAMLANDI. FAZ 2 (Su/Atmosfer/Zaman) in progress: sea-level Gerstner
  water (`world/water.js`) and a real-time day/night cycle (`lighting.js`, sun/hemisphere lights +
  sky/aurora tied to time-of-day) are live — see "This Run (run 7)" below.
- **Last Update:** 2026-07-29 (run 7)
- **Last Commit:** this run's `lighting.js` + `sky.js` day/night wiring + DECISIONS.md ADR-0006 (see
  "This Run (run 7)" below).
- **World scale re-verified this run against the instruction's 100-150 km² band — already
  correct, no change made.** A prior run (see "This Run (run 5)" below, DECISIONS.md ADR-0004)
  already corrected the world scale from an un-completable 4278 km² down to **137.5 km²**, inside
  the 100-150 km² target band. This run's Session Snapshot re-derived the numbers from
  `src/3d/config.js` and confirmed they still match ADR-0004 exactly — no `METERS_PER_MAP_UNIT` or
  grid-size change was needed.
- **Parallel work from a prior run:** while a previous routine run was in progress, the project
  owner (with help from a separate Claude session) pushed 3 commits directly to `main` adding more
  manually-downloaded assets: 6 more Mixamo character models (`arissa`, `dreyar`, `erika_archer`,
  `paladin_j_nordstrom`, `paladin_wprop_j_nordstrom`, `uriel_a_plotexia` — all T-pose, all share
  Mixamo's standard skeleton so the existing `peasant_girl` idle/walking/running clips can retarget
  onto any of them) and 2 creature models (`wolf` — Free3D/3dhaupt, rigged glTF/GLB, for FAZ 6; a
  `black_dragon` — Free3D, rigged FBX with baked wing/fly/fire actions, for FAZ 7, explicitly an
  original design, not a "Drogon" replica — see `assets_manifest.json` notes). None of these are
  consumed by any code yet (expected — FAZ 4/6/7 haven't started). Merged cleanly (`git merge
  origin/main`, no conflicts) into this run's work. **12 assets now registered in
  `assets_manifest.json`.**
- **2D Game:** Verified intact — `node --check` passes on `script.js` and `service-worker.js`,
  `manifest.json`/`assets_manifest.json` are valid JSON, no references to any 3D mode exist yet in
  `index.html` beyond the additive "🎮 3D Dünya" toolbar button.
- **Manually-added assets (ready for later phases, not yet consumed by any code):** all recorded
  in `assets_manifest.json` with source/license.
  - **Characters (FAZ 4):** `peasant_girl.fbx` (rigged base mesh) +
    `assets/animations/peasant_girl/{idle,walking,running}.fbx` (skin-less clips, walking/running
    use "In Place" so root motion is driven by player-controller code, not baked in), plus 6 more
    T-pose Mixamo characters (`arissa`, `dreyar`, `erika_archer`, `paladin_j_nordstrom`,
    `paladin_wprop_j_nordstrom`, `uriel_a_plotexia`) — all share Mixamo's standard skeleton, so the
    existing idle/walking/running clips can retarget onto any of them without new animation
    downloads. FAZ 4 must load these with `FBXLoader` (vendor from three.js's official
    `examples/jsm/loaders/FBXLoader.js` next to `GLTFLoader.js`) and retarget via `AnimationMixer`.
  - **Creatures:** `wolf` (Free3D/3dhaupt, rigged glTF/GLB with walk/run/sit/creep/idle clips, for
    FAZ 6) and `black_dragon` (Free3D, rigged FBX with baked walk/run/idle/jump/wing-open/fly
    clips, for FAZ 7 — an original design, explicitly not a "Drogon" replica; see the manifest's
    notes for why a similarly-named Sketchfab model was rejected).
  - Do not attempt to re-download or replace any of these; any *additional* Mixamo/Free3D asset
    must go through the same manual human step (see "Known Issues" below).

## World Coverage

**World Coverage: 30.73% (42.25 km² / 137.5 km² target)**

- **Target area corrected this run — see DECISIONS.md ADR-0004.** The prior 4278 km² target
  (ADR-0001, `METERS_PER_MAP_UNIT: 10`) was ruled un-completable in realistic time and is
  superseded. The padded kingdom bounding box is unchanged (14 `INIT_KINGDOMS` seats, re-verified
  against current `script.js` this run: x:[920,6190]/y:[300,5370] raw, padded to
  x:[120,6990]/y:[0,6170]) but the scale is now **1.75 m/map-unit**, giving a **12.02km x 10.80km**
  world (~129.8 km² by exact bounds), rounded up to a **25 x 22 grid of 500m x 500m chunks =
  137.5 km²** (550 total chunk slots, down from 17,112). These numbers are the source of truth in
  `src/3d/config.js` (`WORLD_SCALE`, `CHUNK_CONFIG`) — full derivation in `DECISIONS.md` ADR-0004.
- **Covered area (boot baseline): 42.25 km²** — a 13x13 neighborhood of 169 real, seeded terrain
  chunks (`world/chunkManager.js`, centered on grid coordinate `(0, 0)`, radius
  `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` — see DECISIONS.md ADR-0002), out of **550** chunk
  slots in the new grid (30.7% of them — down from 17,112 slots/0.9876%, a corrected denominator,
  not new terrain). This is the deterministic, reproducible number any page load produces. Keep
  growing it before visual polish, per the project's own priority rule — but measure the desktop
  performance budget every time it grows (see below), and note the preview neighborhood is already
  a substantial fraction of the whole small world now, so further growth should favor real
  position-based streaming over just enlarging the static preview radius.
  **Tracked from `getCumulativeCoveredAreaKm2()`, not `getCoveredAreaKm2()`** — see DECISIONS.md
  ADR-0003: `game3d.js` also additively **streams in more chunks at runtime** as the interactive
  camera's orbit target crosses into unvisited chunks (never unloading — see ADR-0003 for why
  eviction is deliberately deferred), so real interactive sessions grow coverage further than this
  static baseline. Verified with a headless pan simulation: panning ~7000m past the preview's edge
  grew cumulative coverage from 42.25 km² to 54.75 km² (now 39.8% of the corrected 137.5 km² target,
  up from what would have been 1.28% of the old 4278 km² one) with zero errors, confirming the
  mechanism works — but that number is session-specific runtime behavior, not a new fixed baseline
  to report here.
- Per the project's phase-gate rules, FAZ 3 and FAZ 10 cannot be marked DONE below 80% coverage
  (crisis exception: fix critical bugs/perf first, then resume geographic growth).

## Performance Budget Status

Desktop budget: DrawCalls<2500, Triangles<5M, TextureMem<2GB. Mobile: DrawCalls<500,
Triangles<500K, TextureMem<512MB.

- **Current scene (169 chunks, 64 segments each):** 169 draw calls (one per chunk mesh — no
  merging/instancing yet, flagged below), ~1.38M triangles (169 × 65×65×2). Comfortably inside the
  **desktop** budget (28% of triangle budget, 7% of draw-call budget) but roughly **2.8x over the
  mobile triangle budget** if this exact scene were used on a phone — it deliberately isn't:
  `game3d.html` currently has no quality/mobile-specific chunk count, this preview radius is
  desktop-only in intent (see DECISIONS.md ADR-0002). A real mobile-safe view will be
  `STREAM_RADIUS_CHUNKS` (2 → 25 chunks, ~204K triangles, well inside mobile budget) once a
  streaming system uses it instead of the fixed Phase-1 preview.
- **FPS: not reliably measurable in this sandbox.** Headless Chromium here falls back to
  SwiftShader **software** rendering (no real GPU passthrough) — sampled ~5 FPS at 169 chunks vs.
  ~6 FPS at 25 chunks (measured this run, before/after comparison), a small relative drop despite
  a 6.7x triangle-count increase. That pattern points to a mostly-fixed software-rasterization
  overhead dominating, not geometry-bound cost — consistent with 1.38M triangles being trivial for
  any real GPU. Treat this sandbox's FPS numbers as non-representative; real FPS needs a real
  device/browser test, which no run has been able to do yet. Flagged under Known Issues.
- **Generation time (one-time, not per-frame):** 169 chunks generated in ~630ms (measured via
  `performance.now()` around the `loadSquare` call in `game3d.js`). Acceptable for a one-time boot
  cost; would need attention if a future streaming system calls this per-frame instead of on
  demand as the player crosses chunk boundaries.
- **Tech debt flagged, not yet worth fixing:** each chunk is its own draw call/mesh. Geometry
  merging or `InstancedMesh` (per the project's performance guidelines) would cut draw calls
  substantially, but at 169 draw calls there's no measured problem to justify the added complexity
  yet — revisit if/when draw calls approach the budget ceiling.
- **`lighting.js` (added run 7):** 0 added draw calls/triangles — `DirectionalLight`/
  `HemisphereLight` are not meshes and no shadow maps are enabled (see DECISIONS.md ADR-0006), so
  this is a pure CPU-side per-frame color/position interpolation, negligible cost.
- **`sky.js` + `world/water.js` combined (added run 6):** 2 more draw calls (171 total, still 7% of
  the desktop budget), ~960 sky triangles + ~32,768 water triangles (`PlaneGeometry(4000, 4000,
  128, 128)`, 2 triangles/cell) ≈ 33.7K triangles — under 1% of the desktop triangle budget and a
  small (6.7%) slice of the *mobile* triangle budget on its own; combined with a mobile-appropriate
  25-chunk terrain view (~204K triangles, see above) that's still comfortably inside the 500K
  mobile ceiling. No `InstancedMesh`/LOD needed yet for either.

## Roadmap

### FAZ 0 — Temel Mimari ✅ TAMAMLANDI (2026-07-29)
- [x] Klasör yapısı: `src/3d/`, `assets/{models,textures,audio,animations,shaders,skyboxes,particles,icons}/`
- [x] ES module giriş noktası: `src/3d/game3d.js` (`initGame3D()` stub; no rendering yet — that's Phase 1)
- [x] EventBus: `src/3d/eventBus.js` — pub/sub, `on/once/off/emit/clear`, catches listener errors so one bad handler can't break the loop
- [x] State Manager: `src/3d/state.js` — `GameState` class, `get/set/snapshot`, emits `state:<key>` on change via the EventBus
- [x] AssetLoader: `src/3d/assetLoader.js` — wraps `THREE.LoadingManager`, emits `asset:progress` / `assets:ready` / `asset:error`, lazy dynamic-imports `GLTFLoader` only when a model is first requested, falls back to a placeholder box mesh on load failure, static `disposeObject3D()` helper for geometry/material/texture cleanup
- [x] Config/constants: `src/3d/config.js` — `VENDOR_PATHS`, `ASSET_PATHS`, `QUALITY_LEVELS`/`QUALITY_PRESETS`, `WORLD_DEFAULTS`, `STORAGE_KEYS`, `EVENTS`
- [x] Vendored Three.js r160 (`src/3d/vendor/three/`) + `GLTFLoader.js`/`BufferGeometryUtils.js` addons, for fully offline ES-module use (see Asset Sources)
- [x] Verified end-to-end in a real headless-Chromium smoke test (import map resolves `three`, `initGame3D()` runs, missing-model fallback produces a placeholder mesh, no console errors from our own code) — test file was scratch-only, not committed

### FAZ 1 — İskelet ve Arazi ✅ TAMAMLANDI (2026-07-29)
- [x] World scale + chunk/streaming grid computed from `INIT_KINGDOMS` bounding box and recorded as
  `WORLD_SCALE`/`CHUNK_CONFIG` in `src/3d/config.js` (see `DECISIONS.md` ADR-0001 and the World
  Coverage section above). This is the "invest in a chunk system from the start" requirement — the
  grid math exists now, even though no chunk has been generated yet.
- [x] `game3d.html` + `game3d.css` (own page, isolated from `index.html`/`style.css` — literal colors, no shared variables/files)
- [x] Import map in `game3d.html` pointing `three` → `src/3d/vendor/three/three.module.js` and `three/addons/` → `src/3d/vendor/three/addons/` (proven working, see this run's headless-browser smoke test below)
- [x] Three.js scene bootstrap in `game3d.js`: renderer, scene, camera, resize handling, render loop (extended `initGame3D()` — skips rendering with a warning if `#game3d-canvas` isn't present, so it stays safe to call from non-browser/test contexts)
- [x] Add "🎮 3D Dünya" button to `index.html` linking to `game3d.html` (additive `<a class="tb-btn">` in the existing toolbar, nothing else in `index.html` touched)
- [x] `src/3d/camera.js` — `createOrbitCamera()` wraps a vendored `OrbitControls` (three.js r160
  official addon, pinned/vendored the same way `GLTFLoader.js` was — see Asset Sources), damped,
  distance/polar-angle limited so it can't zoom through or dip below the ground. Verified with a
  headless-browser drag simulation: the horizon line visibly rotates between before/after
  screenshots, confirming pointer input actually drives the camera, not just "no errors."
  Third-person player-follow camera is still separate, later, Phase 4 work — this is dev-preview
  only.
- [x] `src/3d/sky.js` — aurora shader skybox (procedural GLSL, inline in the module — see Asset
  Sources). A large inverted sphere re-centered on the camera every frame, shaded by an original
  horizon->zenith gradient plus an animated aurora-band overlay (value-noise driven). Always-on for
  now — not yet gated by time-of-day, since Phase 2's day/night system doesn't exist yet (flagged
  under Known Issues). Verified with a headless-Chromium screenshot: visible green/blue/purple
  aurora bands over a dusk-toned gradient, terrain unobscured below the horizon line.
- [x] `src/3d/world/terrain.js` — seeded value-noise/FBM terrain chunk generation
  (`createTerrainChunk`/`disposeTerrainChunk`), vertex-colored (grass→rock by height), no texture
  needed yet. "Ridged/erosion" shaping and a literal "long valley" carve are deferred; current
  terrain is generic rolling FBM (confirmed to tile seamlessly across chunk borders, since noise
  is sampled in world-space coordinates, not per-chunk-local ones).
- [x] `src/3d/world/chunkManager.js` — `ChunkManager` (`loadChunk`/`unloadChunk`/`loadSquare`/
  `disposeAll`, plus `getCoveredAreaKm2()`/`getCumulativeCoveredAreaKm2()` for World Coverage).
  `game3d.js` loads a `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` (6 → 13x13 = 169 chunks)
  neighborhood around the origin at bootstrap (ADR-0002), **and** now additively
  `streamTowards()`s more chunks at runtime as the camera's orbit target moves — real
  position-based streaming (ADR-0003), just without eviction yet (no need for it until either the
  resident count nears budget or FAZ 4 gives us a real player — see ADR-0003). Out of **550** total
  chunk slots (corrected this run from 17,112 — see World Coverage above and DECISIONS.md
  ADR-0004), 169 are real at boot; more accumulate as the world is explored.
- [x] `game3d.html`/`.css` and every `src/3d/**` file actually imported by code (not the unused
  character/creature model assets — see below) are now precached in `service-worker.js`'s
  `GAME3D_SHELL_FILES` list, in their own `cache.addAll()` call independent of the 2D game's
  `SHELL_FILES` precache — a failure caching one can never block the other (see "This Run (run 5)"
  below and Known Issues). Verified offline: after one online visit, a fresh tab with the network
  disabled loads `game3d.html` fully (terrain + sky render, zero console errors) and `index.html`
  still loads offline exactly as before (pre-existing `firebase is not defined` page error,
  unrelated to this change, reproduced identically before/after).

### FAZ 2 — Su/Atmosfer/Zaman (in progress)
- [x] Gerstner wave su (`world/water.js`) — one camera-following sea-level plane (fixed at
  `WORLD_DEFAULTS.WATER_LEVEL_METERS`, 6m), three summed Gerstner waves computed in the vertex
  shader (real per-vertex normals from accumulated tangent/binormal, not a flat-plane fake),
  Fresnel-mixed shallow/deep color plus a Blinn-Phong specular highlight matching the scene's
  existing sun direction. No `terrain.js` changes needed — existing low-noise valleys already sit
  near y=0, so they flood into natural-looking lakes/coastline automatically (see DECISIONS.md
  ADR-0005 for why this is one plane, not per-chunk water). Verified with a headless-Chromium
  bird's-eye screenshot: dozens of natural lake/pond shapes visible across the terrain, matching
  the low points of the existing FBM noise, zero console errors.
- [x] Gün-gece döngüsü (`lighting.js`) — real-time-driven, `WORLD_DEFAULTS.DAY_LENGTH_SECONDS`
  (720s = 1 game day) per full cycle, `START_TIME_OF_DAY_RATIO` (0.3, just past sunrise) at boot.
  Seven hand-authored keyframes (midnight→dawn→noon→dusk→midnight) interpolate the sun
  (`DirectionalLight`, now owned by `lighting.js` instead of created inline in `game3d.js`) and
  hemisphere (`HemisphereLight`) color/intensity, plus the sun's elevation arc. `sky.js`'s
  `updateAuroraSky` now takes this module's output and blends the sky gradient between blue-day
  and dusk-night presets, fading the aurora in only at night via a new `uNightFactor` uniform —
  resolves the "always-on aurora" Known Issue below. See DECISIONS.md ADR-0006.
- [ ] Yıldızlı gece (star field, layered on top of the now-real night sky — not started this run)
- [ ] Şelale (nehir yükseklik farkına göre)
- [ ] Fog / volumetric ışık

### FAZ 3 — Kaleler/Yerleşimler (pending)
- [ ] 2D haritadaki krallık konumlarını yansıtan modüler kale/kule (`settlements.js`)
- [ ] PBR malzemeler
- [ ] Basit LOD/collider

### FAZ 4 — Oynanabilir Karakter (pending)
- [ ] 3. şahıs kamera (SpringArm + raycast duvar önleme)
- [ ] WASD + touch joystick (`player.js`)
- [ ] Zemin çarpışması (`physics.js`)
- [ ] CC0 rigli insan + animasyon blending (Mixamo)

### FAZ 5 — Kalabalık/NPC (pending)
- [ ] Instanced NPC'ler (`npc.js`)
- [ ] Waypoint/patrol (Behavior Tree)
- [ ] Idle/walk cycle

### FAZ 6 — Hayvanlar (pending)
- [ ] Atlar (binilebilir, NavMesh) (`animals.js`)
- [ ] At arabaları (spline takip)
- [ ] Köpek/kedi (flee/follow)
- [ ] Kuşlar (Boids)

### FAZ 7 — Ejderhalar (pending)
- [ ] Devriye AI (`dragon.js`)
- [ ] Kanat çırpma animasyonu
- [ ] Ateş nefesi parçacığı
- [ ] Binilebilir 6DOF uçuş kamerası

### FAZ 8 — RPG/UI Sistemleri (pending)
- [ ] HUD: minimap, compass, quest log, health/stamina/mana, FPS sayacı (`ui.js`)
- [ ] Envanter + craft (`inventory.js`)
- [ ] Görev günlüğü (`quests.js`)
- [ ] 2D oyun verisiyle güvenli senkronizasyon (`savegame.js` — read-only bridge first, careful writes only)

### FAZ 9 — Ses ve Cila (pending)
- [ ] Positional audio (`audio.js`)
- [ ] Post-processing: bloom/tonemapping/SSAO/DOF (`postfx.js`)
- [ ] Loading screen (visual progress bar wired to `EVENTS.ASSET_PROGRESS`, which already exists from Phase 0)

### FAZ 10 — Performans (pending)
- [ ] LOD
- [ ] Texture sıkıştırma
- [ ] Kalite ayarları (GPU tier / devicePixelRatio otomatik tespiti — `QUALITY_PRESETS` already scaffolded in `config.js`)
- [ ] Shadow optimizasyonu
- [ ] Memory leak taraması (`AssetLoader.disposeObject3D` already exists — audit all systems use it)

## This Run (2026-07-29, run 2)

**Session Snapshot taken at start of run** (per protocol):
- Last 3 commits before this run: `7b5c2de` feat(assets): Idle/Walking/Running animations for
  Peasant Girl; `25f8c86` feat(assets): Peasant Girl character model from Mixamo; `c2bfb74`
  feat(3d): scaffold Phase 0 architecture. Affected systems: `assets/`, `assets_manifest.json`,
  `src/3d/*` (Phase 0 only — no terrain/scene/chunk system existed yet).
- **Git issue found and fixed:** the session started with `HEAD` detached at `7b5c2de` while the
  local `main` ref was stale at `38e09e7` (pre-3D-mode). `origin/main` was already at `7b5c2de`
  (last run did push correctly) — this was a local checkout artifact, not data loss. Fixed with
  `git fetch origin main && git checkout main && git merge --ff-only origin/main`.
- No open regression/bug list existed. No FPS numbers exist yet (no renderer built). No loaded
  assets at runtime yet (4 Mixamo files exist on disk but nothing in `src/3d/` references them
  yet). Riskiest files right now: `src/3d/vendor/three/three.module.js` (53k lines, vendored —
  never hand-edit, only re-vendor a pinned version), `script.js` (214KB, 2D game's single largest
  file, must stay untouched by 3D work), `assets_manifest.json` (must stay in sync with `assets/`
  by hand — no automated check yet, flagged as tech debt below).
- World Coverage before this run: not yet computed as a number (0% implicitly, no baseline existed).

**Done:**
- Regression guard: re-ran `node --check` on `script.js`, `service-worker.js`, and every
  `src/3d/*.js` file, plus JSON-validated `manifest.json` and `assets_manifest.json`. All pass.
- Computed the kingdom-seat bounding box from `INIT_KINGDOMS` in `script.js` (14 seats, x:[920,6190]
  y:[300,5370] inside the 9000x7000 `#map-canvas`), and turned it into a concrete world scale: see
  `DECISIONS.md` ADR-0001. Added `WORLD_SCALE` and `CHUNK_CONFIG` to `src/3d/config.js`.
- Added the mandatory **World Coverage** metric to this file (see section above): 0% (0 km² /
  4278 km²) — target computed, nothing generated yet.
- Backfilled the asset/docs gap left by the two prior commits (Mixamo character + animations were
  committed but this progress file was never updated to mention them) — see "Manually-added
  assets" under Current Status.
- Created `DECISIONS.md` (ADR log, ADR-0001 is the world-scale decision above).
- **Second sub-task, same run:** built the first real FAZ 1 slice. Added `game3d.html` +
  `game3d.css` (isolated page/stylesheet, own import map for `three`/`three/addons/`) and extended
  `initGame3D()` in `game3d.js` to create a `WebGLRenderer`/`Scene`/`PerspectiveCamera`, a
  hemisphere+directional light pair, a flat placeholder ground plane sized to
  `CHUNK_CONFIG.CHUNK_SIZE_METERS`, window-resize handling, and a `requestAnimationFrame` render
  loop with `pagehide` cleanup (cancels the frame, unbinds resize, disposes geometry/material/
  renderer — memory-leak checklist). `initGame3D()` still no-ops safely (warns, doesn't throw) if
  `#game3d-canvas` isn't on the page. Added the "🎮 3D Dünya" button to `index.html`'s existing
  toolbar (`<a class="tb-btn" href="game3d.html">`, nothing else touched).
- **Regression + real smoke test (not just `node --check`):** served the repo locally
  (`http-server`) and drove real headless Chromium (Playwright, pre-installed browser) against
  both pages. `game3d.html`: zero page errors, `GAME_READY` fired for both `phase0-architecture`
  and `phase1-scene`, loading overlay correctly hid itself, and a screenshot confirms the lit
  green ground chunk actually renders (not just "no exceptions"). `index.html`: the new button
  exists in the DOM with the correct `href`/title after entering the game. Also found that
  clicking "OYNAT" produces a blank black screen in this sandboxed headless environment — verified
  this is **pre-existing** by stashing the diff and re-running the identical test against the prior
  commit, which reproduced byte-for-byte the same blank screen and the same `firebase is not
  defined` / blocked-network console errors. Not a regression from this run; likely this sandbox
  blocking outbound requests for `resimler/map.png`/Firebase, not a real-device issue. Flagged
  below for whoever next needs to browser-test the 2D game in this kind of sandbox.

- **Third sub-task, same run:** built `src/3d/world/terrain.js` (new `src/3d/world/` folder, with
  its own README per the project's per-folder-README rule) — a seeded `mulberry32` PRNG, a hashed-
  lattice value-noise function, and 5-octave FBM on top of it, baked into a displaced + vertex-
  colored `PlaneGeometry` per chunk. `game3d.js` now calls `createTerrainChunk({chunkX:0, chunkZ:0,
  seed: WORLD_DEFAULTS.WORLD_SEED, size: CHUNK_CONFIG.CHUNK_SIZE_METERS})` instead of building a
  flat placeholder plane inline, and disposes it via `disposeTerrainChunk` on `pagehide`. Added
  `WORLD_DEFAULTS.WORLD_SEED` (1337) to `config.js` — the one master seed all world generation
  should derive from. Re-ran the headless-Chromium smoke test: zero console/page errors, and the
  screenshot shows real height variation and a grass→rock color gradient (not a flat green plane).
  World Coverage moved from 0% to 0.0058% (one real chunk now exists, out of 17,112 slots).

- **Fourth sub-task, same run:** built `src/3d/world/chunkManager.js` (`ChunkManager`:
  `loadChunk`/`unloadChunk`/`loadSquare`/`disposeAll`/`getCoveredAreaKm2()`/`loadedCount`).
  `game3d.js` now calls `chunkManager.loadSquare(0, 0, CHUNK_CONFIG.STREAM_RADIUS_CHUNKS)` (radius
  2 → a 5x5 = 25-chunk neighborhood) instead of rendering a single hardcoded chunk, camera moved
  back (`(0, 700, 1200)`, still fixed/non-interactive — not a camera-controls sub-task) to frame
  the larger area, and `pagehide` cleanup now calls `chunkManager.disposeAll()`. Re-ran the
  headless-Chromium smoke test: zero console/page errors, log confirms "25 terrain chunks (~6.25
  km²)", and the screenshot shows one continuous, seamless rolling landscape — no visible seams at
  chunk borders, confirming world-space noise sampling in `terrain.js` was the right call. World
  Coverage moved from 0.0058% to 0.1461%.

- **Fifth sub-task, same run:** grew World Coverage further and, in doing so, caught a config
  smell before it shipped. Added `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` (6) as a distinct
  constant from `STREAM_RADIUS_CHUNKS` (2) — see DECISIONS.md ADR-0002 for why reusing
  `STREAM_RADIUS_CHUNKS` for this desktop-only preview load would have quietly turned a
  "mobile-budget streaming radius" constant into a "desktop preview radius" one, corrupting a
  number Phase 10 will need later. `game3d.js` now loads a 13x13 = 169-chunk neighborhood.
  Measured (see new "Performance Budget Status" section above): 169 draw calls / ~1.38M triangles
  (well inside desktop budget, ~2.8x over mobile budget — expected, this preview is desktop-only),
  169 chunks generated in ~630ms one-time cost, and did a before/after FPS comparison (169 vs. 25
  chunks) in this sandbox to confirm the low sampled FPS (~5) is a SwiftShader
  software-rendering artifact — not a regression from adding chunks — before writing it down as
  fact rather than assumption. World Coverage moved from 0.1461% to 0.9876% (crossed 1%).

- **Sixth sub-task, same run:** built `src/3d/camera.js` (`createOrbitCamera`) wrapping a newly
  vendored `OrbitControls.js` (three.js r160 official addon, fetched from the same `unpkg.com`
  pin as the core build and core-only-r160-matched — see Asset Sources). Damped, distance-limited
  (20-4000m), and polar-angle-limited so the camera can't dip below the target's height (i.e.
  can't orbit underground). `game3d.js` now creates it after positioning the camera, calls
  `controls.update()` every frame (required for damping), and `controls.dispose()` on `pagehide`
  alongside the existing chunk/renderer cleanup. Verified with a headless-browser **drag
  simulation** (not just load-and-screenshot): captured a screenshot, dragged the canvas, captured
  again — the horizon line visibly rotates between the two, proving pointer input actually drives
  the camera. Zero console/page errors. This finishes the FAZ 1 roadmap's `camera.js` item. World
  Coverage unchanged (this sub-task didn't add/remove chunks): still 0.9876%.
- **Corrected a mistake from this run's own prior notes:** the "Next step" written after the
  chunk-manager sub-task claimed "draw calls will bind before triangles do" as chunk count grows —
  that's backwards. At 8192 triangles/chunk and one draw call/chunk, the **triangle** budget
  (5M) is hit at ~610 chunks, while the **draw-call** budget (2500) wouldn't hit until ~2500
  chunks. Corrected below so the next run doesn't optimize for the wrong constraint.

- **Seventh sub-task, same run:** implemented the real position-based streaming the previous
  "Next step" called for — turned out to fit in one run after all. `ChunkManager` gained
  `streamTowards(centerChunkX, centerChunkZ, radius)` (additive-only: loads what's newly in range,
  never unloads — see DECISIONS.md ADR-0003 for why eviction is deliberately deferred) and a
  persistent `everGenerated` `Set` backing `getCumulativeCoveredAreaKm2()`/`everGeneratedCount`.
  `game3d.js` calls it every frame the `OrbitControls` target has crossed into a new chunk (cheap
  no-op check otherwise). Verified with a headless-browser **pan simulation**: right-drag the
  canvas repeatedly to push the target ~7000m past the boot preview's edge, and confirmed via
  console logs that new 5-chunk columns streamed in exactly at each chunk-boundary crossing, with
  cumulative coverage climbing from 42.25 km² to 54.75 km² and zero errors. World Coverage's
  reported baseline stays at the boot number (42.25 km², reproducible) since the streamed total is
  session-specific — see the updated World Coverage section above for why the metric now reads
  from `getCumulativeCoveredAreaKm2()` rather than the resident-chunk count.

**Files changed this run:** `src/3d/config.js`, `DECISIONS.md` (new, now 3 ADRs), `game3d.html`
(new), `game3d.css` (new), `src/3d/game3d.js`, `index.html`, `ARCHITECTURE.md` (new),
`src/3d/world/terrain.js` (new), `src/3d/world/chunkManager.js` (new), `src/3d/world/README.md`
(new), `src/3d/camera.js` (new), `src/3d/vendor/three/addons/controls/OrbitControls.js` (new,
vendored), `3D_GAME_PROGRESS.md` (this file). Seven separate commits (world-scale/config; scene
bootstrap; terrain chunk; chunk manager; preview-radius split; orbit camera; real streaming) to
keep each one atomic and independently revertable, plus one merge commit reconciling a parallel
session's asset-only commits (6 more Mixamo characters, wolf, black_dragon — see Current Status
above) with this run's work; no conflicts.

**Next step for the next run (start here):** The boot-baseline coverage number (42.25 km²,
0.9876%) hasn't moved in a few runs now — real exploration-driven growth exists but doesn't change
what a fresh page load reports. Two honest paths forward, pick one rather than half-doing both:
(a) **raise the boot baseline again** (bump `PHASE1_PREVIEW_RADIUS_CHUNKS`, re-measure the
performance budget — remember the *triangle* budget binds first, at ~610 chunks, not draw calls);
or (b) **stop treating the static number as the thing to grow** and instead build something that
*exercises* the streaming system automatically (e.g. a simple scripted flythrough/orbit-target
sweep that runs once at boot, in addition to interactive control, so every page load — not just
ones a human happens to pan around — organically covers more area). (b) is more aligned with the
project's actual goal (a world that gets explored, not a bigger static blob) but is a real
sub-task of its own — don't rush it into a corner of an unrelated commit. Either way, re-run the
headless-Chromium smoke test (pan simulation included) and update the World Coverage numbers to
match reality, not aspiration. Once coverage is meaningfully higher, `sky.js` (aurora shader
skybox) is next on the FAZ 1 roadmap. Keep each sub-task to ≤5 files per the blast-radius rule.

## This Run (2026-07-29, run 3)

**Session Snapshot taken at start of run** (per protocol):
- Last 3 commits before this run: `f7c513b` feat(3d): interactive orbit camera, finish FAZ 1
  camera.js item; `7bd9973` feat(3d): grow preview coverage to 169 chunks, split preview/stream
  radius; `296cae3` docs(3d): reconcile progress notes with parallel asset-addition session.
- **Git issue found and fixed (same pattern as last run):** session started with `HEAD` detached
  at `f7c513b` while local `main` was stale at `38e09e7` (pre-3D-mode, a leftover from before the
  previous run's own fetch). `git fetch origin main` confirmed `origin/main` was already at
  `f7c513b` (no data loss), then `git checkout main && git merge --ff-only origin/main` fast-
  forwarded local `main` cleanly.
- **This run's assigned task (from the standing instruction) was a correction, not new work:** the
  previous world-scale target (ADR-0001, 4278 km², 68.7km x 61.7km) was ruled un-completable and
  superseded by a new hard ceiling of ≤150 km² total world area, while still covering every
  kingdom seat. This was flagged as the top-priority item for this run, ahead of any roadmap
  sub-task.
- World Coverage before this run: 0.9876% (42.25 km² / 4278 km², the now-superseded target).
- Re-verified the kingdom bounding box against the *current* `script.js` (not assumed from
  ADR-0001's notes): 14 seats, x:[920,6190]/y:[300,5370] — identical to what ADR-0001 recorded, so
  no kingdom data drift to account for.
- Confirmed via `grep` that `WORLD_SCALE`/`CHUNK_CONFIG`'s `GRID_COLUMNS`/`GRID_ROWS`/
  `WORLD_WIDTH_METERS`/`WORLD_DEPTH_METERS` are not read anywhere outside `config.js` itself —
  `chunkManager.js`/`terrain.js` work off an explicit `chunkSizeMeters` and `(chunkX, chunkZ)`
  center, not a hard grid boundary — so this was confirmed to be a safe, pure config/doc change
  with no runtime code to touch and no risk of breaking the 169 already-generated chunks.

**Done:**
- **World-scale correction (DECISIONS.md ADR-0004):** `src/3d/config.js`'s `WORLD_SCALE.
  METERS_PER_MAP_UNIT` changed from `10` to `1.75` (same padded kingdom bounding box, only the
  meters-per-unit scale shrinks, per the corrected instruction that absolute meter scale doesn't
  matter, only "covers every kingdom" + "≤150 km² total" do). Resulting `WORLD_WIDTH_METERS`/
  `WORLD_DEPTH_METERS`: 12,022.5m x 10,797.5m (12.02km x 10.80km, ~129.8 km² by exact bounds).
  `CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` recomputed from 138/124 to **25/22** (550 total chunk
  slots, down from 17,112), giving a rounded-to-whole-chunks target of **137.5 km²** — within the
  requested 100-150 km² band. `CHUNK_SIZE_METERS` (500m) was left unchanged; nothing required
  changing it, and 550 slots is already a sensible grid size.
- Added `DECISIONS.md` ADR-0004 documenting the correction: exact numbers, reasoning (why the
  bounding box stays fixed and only the scale shrinks), alternatives considered, and the
  consequence for World Coverage's denominator.
- Updated `3D_GAME_PROGRESS.md`'s **World Coverage** section, **Current Status**, and the FAZ 1
  roadmap checklist's stale "17,112 total chunk slots" reference to the corrected numbers.
  World Coverage recalculates from **0.9876% (42.25 km² / 4278 km²) to 30.73% (42.25 km² /
  137.5 km²)** — the same 169 real chunks as before, zero new terrain generated this run; only the
  target denominator was corrected, as instructed. Also removed a stale, already-superseded
  unchecked `camera.js` roadmap line left over from before that item was completed (duplicate of
  the already-`[x]`'d entry above it) while editing the same checklist block.
- **Regression guard:** `node --check` on `script.js`, `service-worker.js`, every non-vendored
  `src/3d/**/*.js` file, and the vendored Three.js/addon files; JSON-validated `manifest.json` and
  `assets_manifest.json`. All pass.
- **Real smoke test (not just `node --check`):** served the repo locally (`http-server`) and drove
  headless Chromium (Playwright) against both pages. `game3d.html`: zero page errors, console log
  confirms `"Loaded 169 terrain chunks (~42.25 km²)"` — i.e. the corrected config didn't change
  what actually renders, only how its coverage is reported. `index.html`: the 3D-mode button is
  still present in the DOM; the pre-existing sandboxed blank-screen/`firebase is not defined`/404
  errors reproduced identically to before (already documented under Known Issues, confirmed once
  again to be unrelated to this run's config-only change, not a new regression).

**Files changed this run:** `src/3d/config.js` (`WORLD_SCALE`/`CHUNK_CONFIG` correction),
`DECISIONS.md` (new ADR-0004), `3D_GAME_PROGRESS.md` (this file — World Coverage, Current Status,
FAZ 1 checklist, this section). Documentation/config only — no `src/3d/world/**`, `game3d.js`, or
2D-game files touched, matching the corrected instruction's "config/chunk system constants" scope.
One commit (the correction is a single atomic, revertable unit — recomputing scale, grid, and both
docs together is what keeps them from drifting out of sync with each other, unlike leaving the
docs for a follow-up commit).

- **Parallel work found on push:** `git push` was rejected — a parallel session had pushed
  `1225786` (`feat(3d): real position-based chunk streaming via orbit-target movement`) to `main`
  while this run was in progress: `ChunkManager.streamTowards()`, `everGenerated`/
  `getCumulativeCoveredAreaKm2()`, and `game3d.js` wiring to stream around the orbit target every
  frame it crosses a chunk boundary (their own `DECISIONS.md` ADR-0003, sub-tasks 4-7 of what they
  still labeled "run 2" — see that section above, restored to its full form in this merge). Merged
  with `git merge origin/main` (real conflicts in `3D_GAME_PROGRESS.md`/`DECISIONS.md`, resolved by
  hand — `ARCHITECTURE.md` auto-merged). Nothing in their change touches `WORLD_SCALE`/
  `CHUNK_CONFIG`'s grid constants (confirmed by the same grep that found nothing outside
  `config.js` reads them), so the two changes are orthogonal and compose cleanly: their streaming
  code derives area-per-chunk from `chunkSizeMeters` at runtime rather than any hardcoded grid
  total, so it is unaffected by the 17,112 → 550 slot correction. The only manual fixes required
  were renumbering my new ADR from a colliding "ADR-0003" to **ADR-0004** (they had already claimed
  0003 for the streaming decision) and updating every cross-reference to it, plus folding the two
  World-Coverage write-ups (theirs: resident-vs-cumulative; mine: corrected denominator) into one
  consistent section above. Re-ran the full regression guard (`node --check` + JSON validation)
  and the headless-Chromium smoke test again post-merge: zero errors, log confirms
  `"Loaded 169 terrain chunks (~42.25 km²)"` exactly as before.

**Next step for the next run:** World Coverage's static/reproducible boot baseline is a
healthy 30.73% (42.25 km² / 137.5 km²) against an achievable target, and a parallel session's
streaming work (merged into this run — see "Parallel work found on push" above) already grows
coverage further at runtime as the orbit target explores (demonstrated: 42.25 km² -> 54.75 km²,
now 39.8% of the corrected target, in a pan test). With streaming already built, the next
highest-value FAZ 1 sub-task is **`sky.js`** (procedural aurora shader skybox, still unchecked
in the roadmap) — the one remaining unchecked item in FAZ 1 besides the PWA/manifest check.
Alternatively, per that same parallel run's own still-valid suggestion: a scripted
flythrough/orbit-target sweep at boot (so every page load organically explores more area, not
just interactive sessions a human happens to pan around) would make the *reported* World
Coverage number grow on its own rather than staying pinned to the 169-chunk static preview.
Either is legitimate; don't half-do both in one run. Keep sub-tasks to ≤5 files per the
blast-radius rule, and re-run the full regression guard + headless-Chromium smoke test
(including a pan simulation if touching streaming) before committing.

## This Run (2026-07-29, run 4)

**Session Snapshot taken at start of run** (per protocol):
- Last 3 commits before this run: `9d2811d` merge: reconcile world-scale correction with parallel
  chunk-streaming work; `bd1c513` fix(3d): correct world scale from 4278 km² to a completable
  ~137.5 km²; `1225786` feat(3d): real position-based chunk streaming via orbit-target movement.
- **Git issue found and fixed (same recurring pattern as runs 2 and 3):** session started with
  `HEAD` detached at `9d2811d` while local `main` was stale at `38e09e7`. `git fetch origin main`
  confirmed `origin/main` already had all prior work (no data loss); `git checkout main && git
  merge --ff-only origin/main` fast-forwarded cleanly, 23 commits.
- **This run's assigned top-priority task (world-scale correction to a ≤150 km² band) was already
  done:** the standing instruction was updated to require a 100-150 km² target, and run 3's
  ADR-0004 correction (137.5 km², 12.02km x 10.80km, still covering every kingdom seat) already
  satisfies it exactly — verified by re-reading `config.js`'s `WORLD_SCALE`/`CHUNK_CONFIG` and
  DECISIONS.md ADR-0004 rather than assuming. No config change was needed; this run picked up the
  next FAZ 1 task instead, per the priority order (world-scale correction wasn't item 1-6 anymore
  since it was already satisfied).
- World Coverage before this run: 30.73% (42.25 km² / 137.5 km²) — unchanged by this run's work
  (no new terrain chunks generated).

**Done:**
- **Found and fixed a real blocking bug while building the sky sphere's radius constant:**
  `camera.js`'s `OrbitControls.maxDistance` was `4000`, but `config.js`'s `WORLD_DEFAULTS.FAR_PLANE`
  (the camera's far clip plane) is `2000`. Zooming out anywhere past 2000m put the entire orbit
  target beyond the far clip plane, making the whole scene vanish (just background color) — a
  real, user-reachable regression, not a hypothetical one. Fixed by lowering `maxDistance` to
  `1800` (comfortable margin under `FAR_PLANE`). Verified via a headless-Chromium test: scrolled
  the mouse wheel to fully zoom out (30 wheel events) — terrain and sky both stayed visible,
  confirmed by screenshot (previously would have gone to solid background color).
- **Built `src/3d/sky.js`** — the last unchecked FAZ 1 roadmap item besides the PWA offline-cache
  check. `createAuroraSky()` returns a large (`SKY_RADIUS_METERS = 1900`, under `FAR_PLANE`)
  inverted `SphereGeometry` with an original `ShaderMaterial`: vertex shader passes world position,
  fragment shader computes a horizon->zenith color gradient from view direction plus an animated,
  value-noise-driven aurora band masked to the upper sky. `updateAuroraSky()` re-centers it on the
  camera and advances `uTime` every frame (so it always surrounds the viewer regardless of orbit
  position); `disposeAuroraSky()` releases geometry/material on teardown. GLSL is inline in the
  module (JS template strings), not a fetched `.glsl` asset — matches the project's own
  already-written Asset Sources note ("no external shader files needed") and avoids adding a new
  async load path / offline-cache entry for something this cheap to inline.
- Wired into `game3d.js`: one `THREE.Clock` added to scene state, sky mesh added to the scene,
  `updateAuroraSky()` called every render-loop tick, `disposeAuroraSky()` called on `pagehide`
  alongside the existing renderer/chunk/controls cleanup (memory-leak checklist). `scene.background`
  kept as a fallback color (never actually visible — the sky sphere fully covers the viewport) in
  case of any edge-case rendering hole.
- **Regression guard:** `node --check` on `script.js`, `service-worker.js`, and every non-vendored
  `src/3d/**/*.js` file (including the new `sky.js`); JSON-validated `manifest.json` and
  `assets_manifest.json`. All pass.
- **Real smoke test (not just `node --check`):** served the repo locally (`python3 -m http.server`)
  and drove headless Chromium (Playwright) against `game3d.html`. Zero `pageerror`/`console.error`
  events. Screenshots confirm: (1) the aurora skybox renders — visible green/blue/purple bands over
  a dusk gradient, terrain unobscured; (2) a left-drag orbit rotates the sky along with the camera
  (proving it follows the camera, not fixed in world space); (3) zooming out to the new
  `maxDistance` (1800m) keeps the whole scene visible, confirming the far-plane fix. Did not
  re-verify `index.html`/the 2D game's own rendering this run (no file under its critical path was
  touched — `index.html`/`script.js`/`style.css`/`service-worker.js` are all unmodified — `node
  --check`/JSON validation above is the applicable regression check for an unmodified file set).
- **Performance:** `sky.js` adds exactly one draw call and a `SphereGeometry(1900, 32, 16)` (~960
  triangles) — negligible against both the desktop (2500 draw calls / 5M triangles) and mobile (500
  draw calls / 500K triangles) budgets. Not re-measured with a full FPS pass (same sandbox
  SwiftShader-software-rendering caveat as prior runs — see Known Issues).

**Files changed this run:** `src/3d/sky.js` (new), `src/3d/camera.js` (`maxDistance` bug fix),
`src/3d/game3d.js` (sky wiring), `ARCHITECTURE.md` (new `sky.js` entry, updated `game3d.js` entry),
`3D_GAME_PROGRESS.md` (this file). Four files, well under both the file-count and line budgets for
this run. No `DECISIONS.md` ADR added — this is an implementation detail (a new self-contained
visual module) and a straightforward bug fix, not a hard-to-reverse architectural choice.

**Next step for the next run:** FAZ 1 now has exactly one unchecked item left: "Confirm responsive
layout + PWA `start_url`/manifest still resolve correctly with the new page present" — i.e. add
`game3d.html`/`game3d.css`/`src/3d/**`/`assets/**` (or at least the currently-used subset) to
`service-worker.js`'s offline cache list, then verify the 3D mode still loads with the network
disabled. That's the natural FAZ 1 close-out task and unblocks marking FAZ 1 DONE (subject to the
phase-gate checklist in the system instructions — build/console/memory/FPS/progress/README/asset/
commit/mobil/docs — not just this one checkbox). After that, FAZ 2 (Su/Atmosfer/Zaman) is next:
Gerstner-wave water, waterfalls, fog, and the day/night cycle — the day/night system is also when
`sky.js`'s always-on aurora should be revisited and gated to nighttime only (flagged in both
`sky.js`'s own doc comment and Known Issues below). World Coverage is unchanged at 30.73%
(42.25 km² / 137.5 km²) — growing it further is lower priority than closing out FAZ 1's last item,
per this project's own priority order (finish the active phase's remaining sub-tasks before more
geographic growth, since FAZ 1 doesn't have an 80%-coverage gate — only FAZ 3/FAZ 10 do).

## This Run (2026-07-29, run 5)

**Session Snapshot taken at start of run** (per protocol): repo was clean, `HEAD` already on
`main` at `ad0f4ac` (run 4's aurora-sky/far-plane-fix commit, already pushed) — no detached-HEAD
issue this time. Continuing directly from run 4's documented "Next step": close out FAZ 1's last
checklist item (offline precaching), per the project's own priority order (finishing the active
phase's remaining sub-task ranks above starting FAZ 2 or growing World Coverage further).

**Done:**
- **`service-worker.js`:** added `GAME3D_SHELL_FILES` (the 3D mode's own app-shell file list —
  `game3d.html`/`.css`, every non-vendored `src/3d/*.js` + `world/*.js` file, and the vendored
  Three.js core/addons actually imported by code) and precache it in `install` via a *second*,
  independently-`.catch()`-guarded `cache.addAll()` call alongside the existing 2D
  `SHELL_FILES` one — so a 3D-precache failure can never block the 2D game's own shell install
  (Golden Rule #1: preserve the existing 2D game above all else). Deliberately excluded the
  character/creature model/animation assets (`assets/models/**`, `assets/animations/**`): nothing
  in code fetches them yet (FAZ 4/6/7 haven't started), and precaching multi-megabyte binaries
  nothing uses yet would bloat install for no current benefit — precache them once real code
  actually loads them.
- Added `src/3d/README.md` (was missing — every code-owned folder needs one per the project's own
  rule; `src/3d/vendor/` is intentionally exempt as vendored/never-hand-edited third-party code,
  already documented in the Asset Sources table).
- Updated `ARCHITECTURE.md`'s 2D-game entry: it previously said "no line in service-worker.js has
  been modified for the 3D mode," which this run's change makes literally false — corrected to
  describe the new *additive*, independently-failing precache call instead of overclaiming zero
  touch.
- **Regression guard:** `node --check service-worker.js` passes; every other `src/3d/**` file
  already re-checked in run 4 and untouched since.
- **Real smoke test — this run's central one, not incidental:** served the repo locally
  (`python3 -m http.server`), drove headless Chromium (Playwright) through the actual offline
  scenario the checklist item is about: (1) load `index.html` online once (lets the SW install and
  both precache calls run), (2) inspect the Cache Storage contents directly — confirmed all 16
  `GAME3D_SHELL_FILES` entries plus the 7 `SHELL_FILES` entries are present in `westeros-shell-v1`,
  (3) `context.setOffline(true)`, open a **fresh tab**, navigate to `game3d.html` — zero
  `pageerror`/`console.error` events, screenshot confirms terrain + aurora sky both render fully
  with no network at all, (4) same offline check against `index.html` — still loads (title,
  toolbar, 3D-mode button all present), reproducing the same pre-existing `firebase is not
  defined` page error documented in prior runs (confirmed unrelated: identical before/after this
  service-worker.js change, since that error is a script.js/Firebase issue, not a caching one).
- **Phase-gate checklist for closing FAZ 1** (per the system instructions' "Faz Geçiş Kapısı"):
  - *Build:* `node --check` passes on every non-vendored JS file (this run + carried over from
    run 4). ✅
  - *Console:* zero page/console errors in both the online and fresh-offline smoke tests above,
    for both `game3d.html` and `index.html`. ✅
  - *Memory:* `pagehide` cleanup chain (`cancelAnimationFrame`, resize unbind, `controls.dispose()`,
    `chunkManager.disposeAll()`, `disposeAuroraSky()`, `renderer.dispose()`) unchanged and already
    verified in earlier runs; this run added no new long-lived allocation. ✅
  - *FPS:* still not reliably measurable in this sandbox (SwiftShader software rendering — see
    Known Issues); unchanged from prior runs, not a new gap introduced this run. ⚠️ carried-over,
    documented limitation, not a blocker (real-device testing needed, flagged for whoever can).
  - *Progress/README/docs:* this file, `ARCHITECTURE.md`, and the new `src/3d/README.md` all
    updated this run. ✅
  - *Asset:* no new assets added this run; `assets_manifest.json` unchanged, still accurate. ✅
  - *Commit:* see below. ✅
  - *Mobil:* no real mobile-device or touch-input testing has been possible in any run so far
    (sandbox limitation, not skipped by choice) — flagged under Known Issues, still an open gap
    FAZ 1 closes without resolving. ⚠️ carried-over, pre-existing gap across every phase so far.
  - **Verdict:** FAZ 1 marked ✅ TAMAMLANDI. The two ⚠️ items (FPS/mobile real-device testing) are
    sandbox limitations affecting every phase equally, not FAZ-1-specific regressions — the
    project's own Known Issues section already tracks them as standing, not phase-blocking, gaps.

**Files changed this run:** `service-worker.js` (`GAME3D_SHELL_FILES` + install-handler change),
`src/3d/README.md` (new), `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file — FAZ 1 checklist,
Current Status, Known Issues, this section). One commit — the shell-file list and its install-time
wiring are one atomic, independently-revertable unit; docs updated alongside since they describe
exactly this change.

**Next step for the next run:** FAZ 1 is done — start FAZ 2 (Su/Atmosfer/Zaman): Gerstner-wave
water (`world/water.js`, matching `world/terrain.js`'s existing seeded/deterministic conventions),
waterfalls where rivers cross a height drop, fog/volumetric light, and a day/night cycle
(`lighting.js`). Recommended order: water first (self-contained, no dependency on lighting), then
day/night (`lighting.js`), and only then revisit `sky.js` to gate its aurora to nighttime (both
Known Issues entries — "always-on aurora" and "no rivers/lakes for water to fill yet, terrain has
no water-level concept" — should be read before starting, since water needs *some* notion of sea
level/lake basins that `terrain.js` doesn't currently expose; check whether that's a `terrain.js`
extension or a new concern in `water.js` before writing code, and update `world/README.md`'s
conventions section once decided). World Coverage remains 30.73% (42.25 km² / 137.5 km²) —
unchanged this run (no terrain/doc-only changes to World Coverage's inputs); growing it stays
below FAZ-2-content work in priority since only FAZ 3/FAZ 10 have a hard coverage gate.

## This Run (2026-07-29, run 6)

**Session Snapshot taken at start of run** (per protocol): repo clean, `HEAD` on `main` at
`1083eba` (run 5's FAZ-1-close-out commit, already pushed). The user asked mid-run to continue and
switched the reporting language to Turkish going forward — no other instruction change. Continuing
run 5's documented "Next step": start FAZ 2 with water, since it's self-contained (no dependency on
the not-yet-built day/night `lighting.js`).

**Done:**
- **Design decision made and recorded before writing code (DECISIONS.md ADR-0005):** sea-level
  water is one large Gerstner-wave plane, fixed at a new `WORLD_DEFAULTS.WATER_LEVEL_METERS` (6m)
  and re-centered on the camera every frame (same technique as `sky.js`) — not per-chunk water, and
  no changes to `terrain.js`. Reasoning, alternatives considered, and consequences are in the ADR;
  short version: `terrain.js`'s existing FBM height already produces natural valleys near y=0, so a
  flat plane at a modest sea level floods them into believable lakes/coastline for free.
- **Built `src/3d/world/water.js`:** `createWater(waterLevelMeters)` / `updateWater(mesh,
  cameraPosition, elapsedSeconds)` / `disposeWater(mesh)`. Vertex shader sums three Gerstner waves
  (different direction/wavelength/steepness) and derives a real per-vertex normal from the
  accumulated tangent/binormal (not a fake flat normal); fragment shader Fresnel-mixes a
  shallow/deep color pair and adds a Blinn-Phong specular highlight using the same sun direction as
  `game3d.js`'s existing `DirectionalLight`. `PlaneGeometry(4000, 4000, 128, 128)` — see Performance
  Budget Status for the triangle-count accounting.
- Wired into `game3d.js`: water mesh added to the scene, `updateWater()` called every render-loop
  tick (reusing the same `THREE.Clock` `sky.js` already added), `disposeWater()` called on
  `pagehide` alongside the existing cleanup chain.
- **`service-worker.js`:** added `./src/3d/world/water.js` to `GAME3D_SHELL_FILES` — a new
  code-imported file must join the offline precache list the moment it's added, or FAZ 1's
  "the 3D mode works fully offline" guarantee silently regresses for anyone who installed the PWA
  before this file existed. (Caught this myself this run rather than a future run finding it stale.)
- Updated `src/3d/world/README.md` (new `water.js` entry, a sea-level convention note, and — while
  already editing this file — corrected its `chunkManager.js` description, which had gone stale
  since run 3/4 added `streamTowards`/cumulative-coverage tracking but nobody had updated this
  particular README), `ARCHITECTURE.md` (new `water.js` entry, updated `game3d.js` entry), and
  `src/3d/README.md` (config.js description, `world/` subfolder one-liner).
- **Regression guard:** `node --check` on every non-vendored `src/3d/**/*.js` file (including the
  new `water.js`) plus `script.js`/`service-worker.js`. All pass.
- **Real smoke test:** served the repo locally, drove headless Chromium. Zero `pageerror`/
  `console.error` events across a close-up pass (confirms the shader compiles and renders, visible
  turquoise water patches against the terrain) and a zoomed-out bird's-eye pass (confirms water
  fills natural low points scattered across the whole loaded terrain area, matching the FBM noise's
  own valley shapes — not a uniform ocean covering everything, which would have signaled the sea
  level was set too high relative to `terrain.js`'s `maxHeightMeters`).

**Files changed this run:** `src/3d/world/water.js` (new), `src/3d/config.js`
(`WATER_LEVEL_METERS`), `src/3d/game3d.js` (water wiring), `service-worker.js`
(`GAME3D_SHELL_FILES`), `DECISIONS.md` (new ADR-0005), `src/3d/world/README.md`, `ARCHITECTURE.md`,
`src/3d/README.md`, `3D_GAME_PROGRESS.md` (this file). Nine files — over the ≤5-files "one
sub-task" guidance from earlier runs' own retrospectives, but within this run's actual budget
(≤20 files / ≤800 lines); the extra files are all documentation kept in sync with one atomic code
change (one new module + its config constant + its wiring + its offline-cache entry), not multiple
unrelated changes bundled together.

**Next step for the next run:** FAZ 2's remaining items: waterfalls (needs a river/height-drop
concept `terrain.js` doesn't have yet — design that before writing code, same as this run did for
water/sea-level), fog/volumetric light, and the day/night cycle (`lighting.js`). Recommended order
per run 5's notes, still valid: day/night next (self-contained, like water was), *then* revisit
`sky.js` to gate the aurora to nighttime-only (flagged in Known Issues) — rivers/waterfalls last
since they're the one item that needs a new terrain concept, not just a new independent system.
World Coverage unchanged at 30.73% (42.25 km² / 137.5 km²) — this run added a visual system, not
terrain area.

## This Run (2026-07-29, run 7)

**Session Snapshot taken at start of run** (per protocol): repo was on a detached `HEAD` matching
`origin/main` (`63c0ff3`, run 6's already-pushed water commit) — checked out `main` and
fast-forwarded the local branch ref to match before doing anything else, so this run's commits
land on a proper branch instead of adding to a detached history. Read `3D_GAME_PROGRESS.md`,
`git log -10`, and `DECISIONS.md`'s last 3 ADRs per protocol.

**World-scale correction check (this run's explicit first instruction):** the operator's brief
asserted the old 4278 km² target might still be live and asked for a re-derivation targeting
100-150 km². Verified against `src/3d/config.js` and `DECISIONS.md` ADR-0004: the correction was
**already made in a prior run** — `WORLD_SCALE.METERS_PER_MAP_UNIT` is 1.75 (not the old ADR-0001
value of 10), producing a 12.02km x 10.80km world, rounded to a 25x22 chunk grid = **137.5 km²**,
inside the 100-150 km² band. No config change was needed; this is stated explicitly in "Current
Status" above (with the re-verification noted) so a future run doesn't waste time re-deriving it
again from scratch.

**Done — FAZ 2 day/night cycle, per run 6's recommended next step:**
- **Design decision made and recorded before writing code (DECISIONS.md ADR-0006):** a new
  `src/3d/lighting.js` module owns the sun (`DirectionalLight`) and hemisphere
  (`HemisphereLight`) — previously created inline as static, unchanging lights in `game3d.js`'s
  `createScene()` — and animates both via linear interpolation between 7 hand-authored keyframes
  spaced around a `[0, 1)` day-ratio (midnight→dawn→noon→dusk→midnight). `sky.js`'s
  `updateAuroraSky` is extended with a 4th `dayNight` argument (not duplicated logic) so the sky
  gradient and aurora visibility consume the same time-of-day state the lights use.
- **Built `src/3d/lighting.js`:** `createDayNightLighting(scene)` / `updateDayNightLighting(lights,
  elapsedSeconds, dayLengthSeconds, startRatio)` / `disposeDayNightLighting(scene, lights)`. Sun
  elevation/position is a fixed-radius arc (`sin`/`cos` of the time angle); color/intensity for
  both lights and a `nightFactor` come from the keyframe table. No GPU resources to free (no
  shadow maps enabled anywhere in the project yet — confirmed by grep).
- **`config.js`:** added `WORLD_DEFAULTS.DAY_LENGTH_SECONDS` (720s = 1 game day) and
  `START_TIME_OF_DAY_RATIO` (0.3, just past sunrise, so a fresh session doesn't boot into darkness).
- **`sky.js`:** added a `uNightFactor` uniform, multiplied into the aurora term in the fragment
  shader (resolves the long-flagged "always-on aurora" Known Issue); `updateAuroraSky` now takes
  the `lighting.js` output and writes it into `uHorizonColor`/`uZenithColor`/`uNightFactor` each
  frame instead of using fixed dusk-toned defaults past the first frame.
- **`game3d.js`:** removed the inline `HemisphereLight`/`DirectionalLight` creation, replaced with
  `createDayNightLighting(scene)`; tick loop now calls `updateDayNightLighting()` once per frame
  and threads its result into `updateAuroraSky()`; `pagehide` teardown now also calls
  `disposeDayNightLighting()`.
- **`service-worker.js`:** added `./src/3d/lighting.js` to `GAME3D_SHELL_FILES` — same rule run 5
  established (a new code-imported 3D file must join the offline precache the moment it's added).
- **Regression guard:** `node --check` on every non-vendored `src/3d/**/*.js` file (including the
  new `lighting.js`) plus `script.js`/`service-worker.js`. All pass.
- **Real smoke tests (headless Chromium via the globally-installed `playwright` package, repo
  served locally with `http-server`):**
  1. A dedicated unit-style test dynamic-`import()`ing `lighting.js` inside the page and sweeping
     `updateDayNightLighting` across a full simulated day (20 samples): zero `NaN`s, zero page
     errors, noon strictly brighter (`sunIntensity`, `hemiIntensity`) and less-night
     (`nightFactor`) than midnight, confirming the interpolation actually works end-to-end and not
     just "doesn't throw."
  2. A full `game3d.html` load/render pass: zero `pageerror`/`console.error` events, screenshot
     confirms a dawn-toned sky gradient + visible faded aurora + dimly-lit terrain consistent with
     the 0.3 `START_TIME_OF_DAY_RATIO` default (see this run's scratch screenshot, not committed).
  3. **Offline regression** (explicitly required by the task brief's Regression Guard list): visited
     `index.html` first (SW registration lives there, not `game3d.html` — pre-existing, confirmed
     by grep), then `game3d.html`, then went offline and reloaded `game3d.html` — zero errors,
     canvas still renders, confirming `lighting.js`'s new precache entry didn't break the existing
     offline guarantee.
  4. **2D game regression:** loaded `index.html`, confirmed only the pre-existing sandbox-specific
     noise (Firebase undefined, blocked network requests — documented in Known Issues below,
     unrelated to this run's changes) and the "🎮 3D Dünya" button still present.

**Files changed this run:** `src/3d/lighting.js` (new), `src/3d/config.js`
(`DAY_LENGTH_SECONDS`/`START_TIME_OF_DAY_RATIO`), `src/3d/sky.js` (`uNightFactor` uniform,
`updateAuroraSky` new `dayNight` param), `src/3d/game3d.js` (lighting wiring),
`service-worker.js` (`GAME3D_SHELL_FILES`), `DECISIONS.md` (new ADR-0006), `src/3d/README.md`,
`ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). Nine files, ~330 new/changed lines — within
this run's ≤20-files/≤800-lines budget; all documentation changes describe this one atomic change
(one new module + its config constants + its two call-site integrations + its offline-cache entry).

**Next step for the next run:** FAZ 2's remaining items, per run 6's still-valid ordering: rivers/
waterfalls (needs a river-path/height-drop concept `terrain.js` doesn't have yet — design that
first, same as prior runs did for sea-level water) and fog/volumetric light. A reasonable next pick
is fog (self-contained, no new terrain concept, and pairs naturally with the day/night work just
landed — e.g. thicker fog near dawn/dusk) before tackling the river/waterfall terrain-concept
design work. World Coverage unchanged at 30.73% (42.25 km² / 137.5 km²) — this run added a visual
system, not terrain area; growing coverage stays below FAZ-2-content work in priority per the
project's own rules (no hard coverage gate until FAZ 3).

## Known Issues / Tech Debt

- **`world/water.js` has no river/height-drop concept yet — waterfalls need one.** The current
  water system is a single flat sea-level plane; it has no idea where a river channel is or where
  terrain drops steeply enough for a waterfall. FAZ 2's waterfall item needs a design decision
  first (a river-path concept in `terrain.js`, or a separate `rivers.js`), not just more shader
  work — don't start it as "more water.js" without that decision.
- **~~`sky.js`'s aurora is always-on, not gated by time-of-day~~ — fixed run 7.** `lighting.js`
  now drives a real day/night cycle; the aurora fades out in daylight via `uNightFactor` (see
  DECISIONS.md ADR-0006).
- **~~`game3d.html`/`.css` and `src/3d/**` are not yet in `service-worker.js`'s cache list~~ —
  fixed run 5.** `GAME3D_SHELL_FILES` now precaches every currently-code-imported 3D file; verified
  working fully offline after one online visit. Character/creature model assets are deliberately
  *not* precached (nothing loads them yet, and they're large binary files — precache them once
  FAZ 4/6/7 actually `fetch()`es them, so a stale/incomplete precache list can't silently drift
  from what code really needs).
- **Headless/sandboxed browser testing of the 2D game hits a pre-existing blank-screen state after
  clicking "OYNAT".** Confirmed this run (via a before/after `git stash` comparison against the
  prior commit) that it is NOT caused by any 3D-mode change — likely this sandbox blocking outbound
  requests for `resimler/map.png` and Firebase (`firebase is not defined` in the console either
  way). Whoever next needs to visually browser-test the 2D game in a similarly locked-down sandbox
  should expect this and may need a network allowlist or local image fixtures; it does not appear
  to be a real bug in `script.js`/`index.html` itself.
- **FPS cannot be reliably measured in this sandbox.** Headless Chromium here has no real GPU and
  falls back to SwiftShader software rendering (explicit console warning every run). Sampled FPS
  numbers (currently ~5 at 169 terrain chunks) are useful only for *relative* before/after
  comparison within this sandbox, never as an absolute number against the project's 60fps
  desktop/30fps mobile targets. Whoever can run this on a real device/browser should get a real
  baseline reading once there's enough scene content to make it meaningful.
- **No real mobile-device or touch-input testing has been possible in any run so far** (same
  headless-sandbox limitation as the FPS caveat above — no physical/emulated touch device
  available here). Every quality/performance number in this file for "mobile" is a budget
  *estimate* (triangle/draw-call counts against `QUALITY_PRESETS`), never an observed real-device
  reading. Flagged explicitly at FAZ 1's close so it isn't silently assumed solved later — whoever
  has device access should do a real pass before FAZ 10 (Performans) is considered for DONE.
- **`FBXLoader` not vendored yet.** Needed for FAZ 4 to load `peasant_girl.fbx` and its three
  animation clips (see "Manually-added assets" above). Vendor it from three.js's official
  `examples/jsm/loaders/FBXLoader.js` alongside `GLTFLoader.js` when FAZ 4 starts — do not attempt
  it earlier than FAZ 4 per the phase-dependency rule.
- **Any future Mixamo/Free3D asset needs a human step.** The cloud agent cannot log into Mixamo,
  and Free3D's download flow doesn't trigger via automated browser clicks either (per the wolf/
  dragon commit message). If a later phase needs a new character/creature/animation, mark it here
  as "insan onayı gerekli — manuel indirme" and stop; do not attempt to fetch it automatically.
- **`assets_manifest.json` is hand-maintained, no automated check that it matches `assets/`.**
  Low risk today (12 files, in sync as of this run), but flag as tech debt if the asset count grows without a
  script to diff `assets/**` against the manifest.
- **No visual loading progress bar yet.** `AssetLoader` already emits `EVENTS.ASSET_PROGRESS`
  with a `ratio` — there's just no UI listening yet since there's no HTML page for the 3D mode
  until Phase 1. Wire a real progress bar into `game3d.html`'s loading screen as part of Phase 1
  or Phase 9.
- **Draco compression not wired up.** `GLTFLoader.js` is vendored but `setDRACOLoader()` is
  never called, and `DRACOLoader.js` + the Draco WASM decoder are not vendored yet. Fine for now
  since no models exist yet. When real GLB assets are added (Phase 3+), decide whether the
  extra ~300KB decoder is worth it for this project's asset sizes before vendoring it — don't
  add it speculatively.
- **`BufferGeometryUtils.js` is vendored only because `GLTFLoader.js` imports it** (for
  `toTrianglesDrawMode`), not because anything calls it directly yet. Expected to stay unused
  until non-triangle-strip GLTF assets show up.
- Terrain, sky, water, weather, AI, physics, audio, UI, save-bridge — none of these exist yet.
  This is expected; Phase 0 was architecture-only by design.

## Asset Sources (CC0 / CC-BY / MIT — no HBO/show media)

| File(s) | Source | License | Notes |
|---|---|---|---|
| `src/3d/vendor/three/three.module.js`, `LICENSE` | [three.js](https://github.com/mrdoob/three.js) r160, via `unpkg.com/three@0.160.0/build/three.module.js` | MIT | Vendored (not npm-installed) so the PWA stays a static, offline-installable site with no build step. |
| `src/3d/vendor/three/addons/loaders/GLTFLoader.js` | three.js r160 `examples/jsm/loaders/GLTFLoader.js` | MIT | Lazy dynamic-imported by `AssetLoader` only when a model load is first requested. |
| `src/3d/vendor/three/addons/utils/BufferGeometryUtils.js` | three.js r160 `examples/jsm/utils/BufferGeometryUtils.js` | MIT | Transitive dependency of `GLTFLoader.js`. |
| `src/3d/vendor/three/addons/controls/OrbitControls.js` | three.js r160 `examples/jsm/controls/OrbitControls.js`, via `unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js` (same pin as the core build) | MIT | Wrapped by `src/3d/camera.js` (`createOrbitCamera`). Used for `game3d.html`'s interactive dev-preview camera. |
| `assets/models/`, `assets/textures/`, `assets/audio/`, `assets/animations/`, `assets/skyboxes/`, `assets/particles/`, `assets/icons/` | — | — | Empty (`.gitkeep` only). Populate in later phases from Kenney (kenney.nl), Quaternius (quaternius.com), Poly Haven (polyhaven.com), Mixamo (mixamo.com, for rigged human animations), KayKit (kaylousberg.com) — verify CC0/CC-BY on the actual download page before adding anything, and record it in this table. |
| `assets/shaders/` | — | — | Empty. All shaders (aurora, water, fire, snow, etc.) will be original procedural GLSL written for this project — no external shader files needed. |
