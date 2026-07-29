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

- **Active Phase:** FAZ 1 — İskelet ve Arazi (in progress: world scale + chunk grid defined,
  `game3d.html` renders 25 real seeded terrain chunks via `ChunkManager`, ~0.15% World Coverage;
  sky/camera-controls not built yet)
- **Last Update:** 2026-07-29
- **Last Commit:** `5bea1d4` (merge of this run's chunk-manager work with a parallel session's
  asset additions — see below).
- **Parallel work this run:** while this routine was running, the project owner (with help from a
  separate Claude session) pushed 3 commits directly to `main` adding more manually-downloaded
  assets: 6 more Mixamo character models (`arissa`, `dreyar`, `erika_archer`,
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

**World Coverage: 0.9876% (42.25 km² / 4278 km² target)**

- **Target area** is derived from the 14 kingdom seats in `script.js`'s `INIT_KINGDOMS` (not the
  ~150 decorative marker/figure entries also in that file), padded and scaled to real-world meters.
  Full derivation, alternatives considered, and the exact numbers: `DECISIONS.md` ADR-0001.
  Summary: 68.7km x 61.7km world, rounded up to a 138 x 124 grid of 500m x 500m chunks = 4278 km².
  These numbers are now the source of truth in `src/3d/config.js` (`WORLD_SCALE`, `CHUNK_CONFIG`).
- **Covered area:** 42.25 km² — a 13x13 neighborhood of 169 real, seeded terrain chunks
  (`world/chunkManager.js`, centered on grid coordinate `(0, 0)`, radius
  `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` — see DECISIONS.md ADR-0002 for why this is a
  separate constant from `STREAM_RADIUS_CHUNKS`), out of 17,112 chunk slots in the grid. Crossed
  1% this run; keep growing it before visual polish, per the project's own priority rule — but
  measure the desktop performance budget every time it grows (see below).
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

### FAZ 1 — İskelet ve Arazi (in progress)
- [x] World scale + chunk/streaming grid computed from `INIT_KINGDOMS` bounding box and recorded as
  `WORLD_SCALE`/`CHUNK_CONFIG` in `src/3d/config.js` (see `DECISIONS.md` ADR-0001 and the World
  Coverage section above). This is the "invest in a chunk system from the start" requirement — the
  grid math exists now, even though no chunk has been generated yet.
- [x] `game3d.html` + `game3d.css` (own page, isolated from `index.html`/`style.css` — literal colors, no shared variables/files)
- [x] Import map in `game3d.html` pointing `three` → `src/3d/vendor/three/three.module.js` and `three/addons/` → `src/3d/vendor/three/addons/` (proven working, see this run's headless-browser smoke test below)
- [x] Three.js scene bootstrap in `game3d.js`: renderer, scene, camera, resize handling, render loop (extended `initGame3D()` — skips rendering with a warning if `#game3d-canvas` isn't present, so it stays safe to call from non-browser/test contexts)
- [x] Add "🎮 3D Dünya" button to `index.html` linking to `game3d.html` (additive `<a class="tb-btn">` in the existing toolbar, nothing else in `index.html` touched)
- [ ] `src/3d/sky.js` — aurora shader skybox (procedural GLSL)
- [x] `src/3d/world/terrain.js` — seeded value-noise/FBM terrain chunk generation
  (`createTerrainChunk`/`disposeTerrainChunk`), vertex-colored (grass→rock by height), no texture
  needed yet. "Ridged/erosion" shaping and a literal "long valley" carve are deferred; current
  terrain is generic rolling FBM (confirmed to tile seamlessly across chunk borders, since noise
  is sampled in world-space coordinates, not per-chunk-local ones).
- [x] `src/3d/world/chunkManager.js` — `ChunkManager` (`loadChunk`/`unloadChunk`/`loadSquare`/
  `disposeAll`, plus `getCoveredAreaKm2()` for World Coverage). `game3d.js` loads a
  `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` (6 → 13x13 = 169 chunks) neighborhood around the
  origin at bootstrap — see DECISIONS.md ADR-0002 for why this is a separate constant from
  `STREAM_RADIUS_CHUNKS` (which stays mobile-budget-sized for the real future streaming system).
  Still a **fixed one-time load**, not real position-based streaming — that needs a player/
  camera-follow position to stream around, which doesn't exist until FAZ 4. Out of 17,112 total
  chunk slots, 169 are now real (World Coverage above).
- [ ] `src/3d/camera.js` — orbit/free camera for now (third-person arrives in Phase 4). Current camera in `game3d.js` is a fixed, non-interactive `PerspectiveCamera` looking at the origin.
- [ ] Confirm responsive layout + PWA `start_url`/manifest still resolve correctly with the new page present (not yet checked — `game3d.html`/`.css`/`src/3d/**` are not in `service-worker.js`'s cache list yet, so the 3D mode currently requires network/first-load; flagged under Known Issues)

### FAZ 2 — Su/Atmosfer/Zaman (pending)
- [ ] Gerstner wave su (`water.js`)
- [ ] Şelale (nehir yükseklik farkına göre)
- [ ] Fog / volumetric ışık
- [ ] Gün-gece döngüsü + yıldızlı gece (`lighting.js`)

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

**Files changed this run:** `src/3d/config.js`, `DECISIONS.md` (new, now 2 ADRs), `game3d.html`
(new), `game3d.css` (new), `src/3d/game3d.js`, `index.html`, `ARCHITECTURE.md` (new),
`src/3d/world/terrain.js` (new), `src/3d/world/chunkManager.js` (new), `src/3d/world/README.md`
(new), `3D_GAME_PROGRESS.md` (this file). Five separate commits (world-scale/config; scene
bootstrap; terrain chunk; chunk manager; preview-radius split) to keep each one atomic and
independently revertable, plus one merge commit reconciling a parallel session's asset-only
commits (6 more Mixamo characters, wolf, black_dragon — see Current Status above) with this run's
work; no conflicts.

**Next step for the next run (start here):** Coverage is just under 1% (0.9876%) — still keep
growing it before `sky.js`/`camera.js` polish, per the project's own priority rule, but the easy
"just raise the radius" lever is getting closer to its ceiling: at the current 64-segments/chunk
resolution, draw calls (1 per chunk, no merging yet) will bind before triangles do. Options, in
order of value: (a) **get a real (non-sandboxed) FPS reading** before pushing coverage further —
this run could only confirm the low sandbox FPS is a software-rendering artifact by relative
comparison, not get an absolute real number; if a real-browser test becomes possible, do it before
trusting further growth is "free"; (b) reduce `segments` per chunk (a cheap manual LOD ahead of a
real LOD system) so a larger preview area costs proportionally less; (c) merge/instance chunk
geometry to cut draw calls, which is the real fix for scaling past a few hundred chunks — bigger
task, likely its own sub-task rather than a quick addition; (d) once coverage is meaningfully
higher and the desktop budget still has headroom, move to `sky.js` (aurora shader skybox) and
`camera.js` (orbit camera — the current camera is still fixed). Keep each sub-task to ≤5 files per
the blast-radius rule, and re-run the headless-Chromium smoke test each time, not just
`node --check`.

## Known Issues / Tech Debt

- **`game3d.html`/`.css` and `src/3d/**` are not yet in `service-worker.js`'s cache list.** The 3D
  mode currently needs network access on first load; add it to the offline cache list once the
  mode has enough content to be worth using offline (premature right now, still just a placeholder
  scene).
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
| `assets/models/`, `assets/textures/`, `assets/audio/`, `assets/animations/`, `assets/skyboxes/`, `assets/particles/`, `assets/icons/` | — | — | Empty (`.gitkeep` only). Populate in later phases from Kenney (kenney.nl), Quaternius (quaternius.com), Poly Haven (polyhaven.com), Mixamo (mixamo.com, for rigged human animations), KayKit (kaylousberg.com) — verify CC0/CC-BY on the actual download page before adding anything, and record it in this table. |
| `assets/shaders/` | — | — | Empty. All shaders (aurora, water, fire, snow, etc.) will be original procedural GLSL written for this project — no external shader files needed. |
