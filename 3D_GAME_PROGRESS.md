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

- **Active Phase:** FAZ 1 — İskelet ve Arazi (pending, not started)
- **Last Update:** 2026-07-29
- **Last Commit:** `feat(3d): scaffold Phase 0 architecture (EventBus, GameState, AssetLoader, vendored Three.js)`
- **2D Game:** Verified intact — `node --check` passes on `script.js` and `service-worker.js`,
  `manifest.json` is valid JSON, no references to any 3D mode exist yet in `index.html`.

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

### FAZ 1 — İskelet ve Arazi (pending)
- [ ] `game3d.html` + `game3d.css` (own page, isolated from `index.html`/`style.css`)
- [ ] Import map in `game3d.html` pointing `three` → `src/3d/vendor/three/three.module.js` and `three/addons/` → `src/3d/vendor/three/addons/` (already proven working in the Phase 0 smoke test)
- [ ] Three.js scene bootstrap in `game3d.js`: renderer, scene, camera, resize handling, render loop (extend `initGame3D()`)
- [ ] `src/3d/sky.js` — aurora shader skybox (procedural GLSL)
- [ ] `src/3d/terrain.js` — heightmap-based long valley terrain (FBM noise to start; ridged/erosion can follow in a later Phase-1 sub-task)
- [ ] `src/3d/camera.js` — orbit/free camera for now (third-person arrives in Phase 4)
- [ ] Add "🎮 3D Dünya" button to `index.html` linking to `game3d.html` (additive only — must not touch any existing 2D game logic/markup)
- [ ] Confirm responsive layout + PWA `start_url`/manifest still resolve correctly with the new page present

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

## This Run (2026-07-29)

**Done:**
- Fixed a leftover git issue from a previous run: HEAD was detached at the merge commit for
  `claude/westeros-pwa-quality-audit-pninxh` while the local `main` branch ref was stale
  (pointing at an old commit). Fetched `origin/main` (which already contained the merge) and
  checked out `main` properly so this and future runs commit on the real branch.
- Confirmed no `3D_GAME_PROGRESS.md` or `src/3d/` existed yet — this is a genuine first run.
- Verified the 2D game is intact (`node --check` on `script.js`/`service-worker.js`, JSON-valid
  `manifest.json`, no 3D references anywhere in `index.html`).
- Built all of FAZ 0 (see checklist above) and verified it with a real headless-browser smoke
  test (not committed — scratch only), not just `node --check`.

**Files added this run:**
`3D_GAME_PROGRESS.md`, `src/3d/config.js`, `src/3d/eventBus.js`, `src/3d/state.js`,
`src/3d/assetLoader.js`, `src/3d/game3d.js`, `src/3d/vendor/three/three.module.js` (+`LICENSE`),
`src/3d/vendor/three/addons/loaders/GLTFLoader.js`, `src/3d/vendor/three/addons/utils/BufferGeometryUtils.js`,
`assets/{models,textures,audio,animations,shaders,skyboxes,particles,icons}/.gitkeep`.

**Next step for the next run (start here):** Begin FAZ 1. Suggested first atomic sub-task
(30-60 min): create `game3d.html` + `game3d.css` with the import map (copy the mapping proven
in this run's smoke test) and a minimal Three.js scene in `game3d.js` — renderer attached to a
`<canvas>`, a camera, an empty scene with a ground-plane placeholder, resize handling, and a
render loop calling `initGame3D()`. Do **not** attempt terrain/sky/camera-controls in the same
sub-task — that's the following FAZ 1 sub-tasks. Only after the bare scene renders and resizes
correctly, add the "🎮 3D Dünya" button to `index.html` (additive `<a>`/`<button>` linking to
`game3d.html`, nothing else in `index.html` touched) and re-verify the 2D game still loads.

## Known Issues / Tech Debt

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
