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

- **Active Phase:** FAZ 1 — İskelet ve Arazi (in progress: world scale corrected down to a
  completable ~137.5 km² target — see World Coverage below — `game3d.html` renders 169 real seeded
  terrain chunks via `ChunkManager` + an interactive orbit camera; sky not built yet)
- **Last Update:** 2026-07-29 (run 3)
- **Last Commit:** `f7c513b` (interactive orbit camera, before this run's world-scale correction).
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

- **Target area corrected this run (2026-07-29, run 3) — see DECISIONS.md ADR-0003.** The prior
  4278 km² target (ADR-0001, `METERS_PER_MAP_UNIT: 10`) was ruled un-completable in realistic time
  and is superseded. The padded kingdom bounding box is unchanged (14 `INIT_KINGDOMS` seats,
  re-verified against current `script.js` this run: x:[920,6190]/y:[300,5370] raw, padded to
  x:[120,6990]/y:[0,6170]) but the scale is now **1.75 m/map-unit**, giving a **12.02km x 10.80km**
  world (~129.8 km² by exact bounds), rounded up to a **25 x 22 grid of 500m x 500m chunks =
  137.5 km²** (550 total chunk slots, down from 17,112). These numbers are the source of truth in
  `src/3d/config.js` (`WORLD_SCALE`, `CHUNK_CONFIG`) — full derivation in `DECISIONS.md` ADR-0003.
- **Covered area:** 42.25 km² — unchanged from before this run; no new chunks were generated, only
  the target denominator was corrected. Still the same 13x13 neighborhood of 169 real, seeded
  terrain chunks (`world/chunkManager.js`, centered on grid coordinate `(0, 0)`, radius
  `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` — see DECISIONS.md ADR-0002), out of 550 chunk slots
  in the new grid (30.7% of them). Keep growing it before visual polish, per the project's own
  priority rule — but measure the desktop performance budget every time it grows (see below), and
  note the preview neighborhood is already a substantial fraction of the whole small world now, so
  further growth should favor real position-based streaming over just enlarging the static preview
  radius (see "Next step" below).
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
- [x] `src/3d/camera.js` — `createOrbitCamera()` wraps a vendored `OrbitControls` (three.js r160
  official addon, pinned/vendored the same way `GLTFLoader.js` was — see Asset Sources), damped,
  distance/polar-angle limited so it can't zoom through or dip below the ground. Verified with a
  headless-browser drag simulation: the horizon line visibly rotates between before/after
  screenshots, confirming pointer input actually drives the camera, not just "no errors."
  Third-person player-follow camera is still separate, later, Phase 4 work — this is dev-preview
  only.
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
  camera-follow position to stream around, which doesn't exist until FAZ 4. Out of 550 total
  chunk slots (corrected this run — see World Coverage above), 169 are now real.
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
- **World-scale correction (DECISIONS.md ADR-0003):** `src/3d/config.js`'s `WORLD_SCALE.
  METERS_PER_MAP_UNIT` changed from `10` to `1.75` (same padded kingdom bounding box, only the
  meters-per-unit scale shrinks, per the corrected instruction that absolute meter scale doesn't
  matter, only "covers every kingdom" + "≤150 km² total" do). Resulting `WORLD_WIDTH_METERS`/
  `WORLD_DEPTH_METERS`: 12,022.5m x 10,797.5m (12.02km x 10.80km, ~129.8 km² by exact bounds).
  `CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` recomputed from 138/124 to **25/22** (550 total chunk
  slots, down from 17,112), giving a rounded-to-whole-chunks target of **137.5 km²** — within the
  requested 100-150 km² band. `CHUNK_SIZE_METERS` (500m) was left unchanged; nothing required
  changing it, and 550 slots is already a sensible grid size.
- Added `DECISIONS.md` ADR-0003 documenting the correction: exact numbers, reasoning (why the
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
`DECISIONS.md` (new ADR-0003), `3D_GAME_PROGRESS.md` (this file — World Coverage, Current Status,
FAZ 1 checklist, this section). Documentation/config only — no `src/3d/world/**`, `game3d.js`, or
2D-game files touched, matching the corrected instruction's "config/chunk system constants" scope.
One commit (the correction is a single atomic, revertable unit — recomputing scale, grid, and both
docs together is what keeps them from drifting out of sync with each other, unlike leaving the
docs for a follow-up commit).

**Next step for the next run:** World Coverage is now a healthy 30.73% against an achievable
target, with 380 chunk slots still unloaded out of 550. Per the previous run's own (still valid)
recommendation, the next structural move should be **position-based streaming** rather than
further brute-force preview-radius growth: `PHASE1_PREVIEW_RADIUS_CHUNKS` (169 chunks) is already
30.7% of the *entire* new world, so growing that static preview further has much less room before
it becomes "just render everything" — a `ChunkManager.update(centerX, centerZ)` method that loads/
unloads around a moving position (the orbit camera target works fine as a stand-in before FAZ 4's
player exists), wired to `STREAM_RADIUS_CHUNKS` (the small, mobile-safe constant), is what actually
lets World Coverage keep growing by *exploring* rather than by enlarging one fixed blob. `sky.js`
(procedural aurora skybox, still unchecked in the FAZ 1 roadmap) is a good alternative next
sub-task if streaming feels too large for one run — either is legitimate FAZ 1 work at this point.

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
| `src/3d/vendor/three/addons/controls/OrbitControls.js` | three.js r160 `examples/jsm/controls/OrbitControls.js`, via `unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js` (same pin as the core build) | MIT | Wrapped by `src/3d/camera.js` (`createOrbitCamera`). Used for `game3d.html`'s interactive dev-preview camera. |
| `assets/models/`, `assets/textures/`, `assets/audio/`, `assets/animations/`, `assets/skyboxes/`, `assets/particles/`, `assets/icons/` | — | — | Empty (`.gitkeep` only). Populate in later phases from Kenney (kenney.nl), Quaternius (quaternius.com), Poly Haven (polyhaven.com), Mixamo (mixamo.com, for rigged human animations), KayKit (kaylousberg.com) — verify CC0/CC-BY on the actual download page before adding anything, and record it in this table. |
| `assets/shaders/` | — | — | Empty. All shaders (aurora, water, fire, snow, etc.) will be original procedural GLSL written for this project — no external shader files needed. |
