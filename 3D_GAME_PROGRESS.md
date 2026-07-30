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

- **Active Phase:** FAZ 1 ✅ TAMAMLANDI, FAZ 2 substantially complete (water/day-night/fog/rivers/
  waterfalls/stars all live; only postfx-gated god rays remain, deferred to FAZ 9 by design). FAZ 3
  (Kaleler/Yerleşimler) substantially complete (settlements + PBR textures; LOD/colliders still
  deferred — see runs 14-16, DECISIONS.md ADR-0013/ADR-0015). **FAZ 4 (Oynanabilir Karakter)
  roadmap fully implemented (runs 17-19):** a playable character (`gameplay/player.js`) loads
  `peasant_girl.fbx` + its idle/walking/running clips, moves via WASD/arrows (`input.js`) or an
  on-screen joystick on touch-primary devices (`ui/touchJoystick.js`, run 18) relative to the
  camera, snaps to real terrain height (`physics.js`), and the existing `OrbitControls` instance
  becomes its chase camera with wall-avoidance raycasting (`camera.js`'s `resolveCameraCollision`,
  run 19) pulling it in front of any terrain/castle it would otherwise clip through — see
  DECISIONS.md ADR-0016/ADR-0017/ADR-0018. **The FAZ 4-adjacent gaps this note used to track are
  now both closed:** the horizontal wall-collider landed run 35 (`physics.js`'s
  `createSettlementCollider`, ADR-0037) and gravity/jump landed run 36 (`physics.js`'s
  `integrateJumpArc`, ADR-0039 — Space, desktop keyboard only, a small ≈1.2m hop, no dedicated
  jump/fall animation clip). **FAZ 5
  (Kalabalık/NPC) started run 20, extended run 21, patrol added run 22, name-tag UI added run 23,
  patrol extended to all 6 NPCs run 24, 4 more seats added run 25, 11th NPC added run 31:** run 20
  placed a first pass of 2 static, idling NPCs (`gameplay/npc.js`) at the Stannis Baratheon kingdom
  seat; run 21 extended `NPC_CONFIG.SPAWNS` (config-only, no code change) to 4 more seats (`umit`,
  `cersei`, `berkalp`, `doran`), one NPC each, using the 4 remaining downloaded Mixamo character
  files; run 22 piloted a waypoint-patrol system (`gameplay/npc.js`'s `patrolWaypoints`) on the 2
  `stannis` NPCs; run 23 gave all 6 NPCs a billboard name-tag (`gameplay/npc.js`'s
  `createNameTagSprite`) showing a house-flavored Turkish name above their heads; run 24 extended the
  run-22 patrol pattern (config-only, same proven geometry) to the other 4 NPCs; run 25 added 4 more
  NPCs (`ziya`, `balon`, `robin`, `jon`), config-only, by reusing already-downloaded character
  models — no new asset; **run 31 added an 11th NPC at `Xaro` (Qarth), the first NPC at a house not
  yet represented, reusing `dreyar.fbx` a second time** — see DECISIONS.md ADR-0031; **run 32 added a
  first-pass interaction affordance (`ui/interactionPrompt.js`) — a static "E - Selamla" prompt shown
  when the player is within 6m of any NPC, no keypress handling or dialogue content yet** — see
  DECISIONS.md ADR-0032; **run 33 wired the actual keypress — pressing E while the prompt shows opens
  `ui/dialogueBox.js` with a generic greeting naming the NPC (`gameplay/interaction.js`'s new
  controller), Escape or E again closes it, walking out of range auto-closes it** — see DECISIONS.md
  ADR-0033; **run 34 added the last 3 seats (`berk`/`olena`/`twin`), a config-only addition reusing
  already-downloaded models — see DECISIONS.md ADR-0036.** **14 NPCs total, all patrolling with a
  name tag, every real kingdom seat (13 of 14 — `Night King` deliberately excluded, ADR-0024) now
  has at least one, and pressing E near any of them now opens a (still content-free) greeting.** All
  runs reuse `player.js`'s Mixamo FBX-loading/scale-correction/animation-retargeting pipeline — see
  DECISIONS.md
  ADR-0019/ADR-0020/ADR-0021/ADR-0022/ADR-0023/ADR-0024/ADR-0031/ADR-0032/ADR-0033/ADR-0036. **FAZ 6 (Hayvanlar) started run 26, patrol
  added run 27, flee added run 28, pack-alert added run 29, 3rd wolf + chain verification run 30:**
  a first pass of 2 static, idling wolves (`gameplay/animals.js`, new module) at the `berkalp` (House
  Stark/Winterfell) kingdom seat, loaded via `AssetLoader.loadModel`'s glTF/GLB path (previously
  unused dead code — this is the first system to actually exercise it) rather than `loadFBXModel`;
  run 27 gave both wolves a 20m waypoint patrol, reusing `gameplay/npc.js`'s already-proven
  `patrolWaypoints` pattern (copied, not shared — see DECISIONS.md ADR-0026's "why duplicate"
  reasoning); run 28 gave both wolves player-awareness — a wolf within 15m of the player overrides
  idle/patrol and runs straight away at 4.5 m/s until safe; run 29 gave them pack-awareness — a wolf
  within 20m of an already-fleeing packmate also flees (away from the player, not the packmate), and
  (same run) moved the FAZ 5/6 spawn-resolution wiring out of `game3d.js` into `npc.js`/`animals.js`
  to fix a 600-line-cap regression that run's own Session Snapshot caught; **run 30 added a 3rd wolf
  (`berkalp-wolf-3`, config-only, reuses the same downloaded model) and verified the previously-
  untested 3-hop pack-alert chain actually propagates** (wolf-1 flees the player -> wolf-2 pack-flees
  off wolf-1 -> wolf-3 pack-flees off wolf-2, one frame later) via a direct-call test with a
  negative control — see DECISIONS.md ADR-0030. See "This Run (run 29)"/"This Run (run 30)" below
  and DECISIONS.md ADR-0025/ADR-0026/ADR-0027/ADR-0028/ADR-0029/ADR-0030.
- **Last Update:** 2026-07-30 (run 38)
- **Last Commit:** run 38's third chained sub-task — fixed the double-idle-before-first-lap patrol
  timing quirk in both `gameplay/npc.js` and `gameplay/animals.js` (DECISIONS.md ADR-0045),
  updating sub-tasks 1/2's own new regression checks to assert the corrected timing. Preceded
  (same run) by sub-task 2: the wolf waypoint-patrol regression check (`checkWolfPatrol`,
  ADR-0044), and sub-task 1: the NPC waypoint-patrol regression check (`checkNpcPatrol`,
  ADR-0043), which also split `scripts/smokeTestGame3D.js` into a thin runner + a new
  `scripts/game3dSmokeChecks.js` holding all check functions (the runner was at 552 lines; adding
  a new check in place would have exceeded the 600-line cap). See "This Run (run 38)" below.
  Preceded by run 37's persisted wolf flee/pack-alert regression check
  (`scripts/smokeTestGame3D.js`'s `checkWolfPackAlert`, DECISIONS.md ADR-0042). Preceded by run 36's
  three chained sub-tasks: FAZ 4's gravity/jump physics (ADR-0039 — closes FAZ 4's last named
  mechanical gap), its own smoke-test extension (ADR-0040), and the interaction-controller
  regression check (ADR-0041); run 35's player-vs-castle collider + its own smoke-test extension
  (ADR-0037/ADR-0038); run 34's asset-manifest check, persisted smoke test, and the last 3 FAZ 5
  NPC seats (ADR-0034/ADR-0035/ADR-0036). See "This Run (run 37)" below for full details.
- **World scale re-verified this run against the instruction's 100-150 km² band — already
  correct, no change made (twenty-seventh straight run).** A prior run (see "This Run (run 5)" below,
  DECISIONS.md ADR-0004) corrected the world scale from an un-completable 4278 km² down to
  **137.5 km²**, inside the 100-150 km² target band; runs 4, 7, 9, 11, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, and 32 each re-verified this without changes needed.
  This run's Session Snapshot re-derived the numbers from `src/3d/config.js`
  (`METERS_PER_MAP_UNIT: 1.75`, 25x22 grid) once more and again confirmed they match ADR-0004
  exactly — no config change made. **If you are a future run and the operator's brief again asserts
  the old 4278 km² target is still live: it is not. Re-derive from `config.js` yourself (as this run
  did) rather than trusting the brief's own numbers — this has now been independently re-confirmed
  across runs 3, 4, 5, 7, 9, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
  31, and 32.**
- **Repo-continuity note (recurs — run 18, run 29, run 30, run 36, run 37):** run 18's Session Snapshot found the
  container's git working tree in a `HEAD` state detached at that run's own prior final commit, while
  the local `main` branch ref and `origin/main` were both still pointing at the pre-3D-mode commit
  (`38e09e7`) — i.e. `main` had silently fallen behind every run's actual work by one run's worth of
  commits at container-restart time. Run 29 hit the exact same pattern again (`HEAD` detached at run
  28's `eac41ab`, local `main` still at `38e09e7`) — confirming this is a recurring property of how
  the container/session restarts, not a one-off. Both times, `main` was a strict git ancestor of the
  detached commit, so fast-forwarding was safe and lossless: `git checkout main && git merge
  <detached-commit> --ff-only`, then confirmed via a fresh `git fetch` that `origin/main` already
  matched — the remote push had actually succeeded both times; only the container's local branch/
  tracking refs were stale before fetching. No commits were ever rewritten or discarded. **Every
  future run should expect this at boot** — check `git status`/`git branch --contains HEAD` in the
  Session Snapshot and fast-forward `main` (never force-push) if `HEAD` is detached ahead of a stale
  local `main`.
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
- **Manually-added assets:** all recorded in `assets_manifest.json` with source/license.
  - **Characters (FAZ 4) — `peasant_girl.fbx` loaded by code since run 17.**
    `gameplay/player.js` loads the rigged base mesh + `assets/animations/peasant_girl/
    {idle,walking,running}.fbx` (skin-less clips, walking/running use "In Place" so root motion is
    driven by player-controller code — confirmed working: the character doesn't visibly slide
    while playing the walk/run clip, `player.js` itself drives all translation) via the newly
    vendored `FBXLoader` and retargets them onto the mesh's own skeleton via `AnimationMixer` — see
    DECISIONS.md ADR-0016. **All 6 of the T-pose Mixamo characters now loaded (FAZ 5, run 20 + 21):**
    all as static idling NPCs (`gameplay/npc.js`, DECISIONS.md ADR-0019/ADR-0020) reusing
    `peasant_girl`'s retargeted idle clip — `paladin_j_nordstrom.fbx`/`arissa.fbx` at `stannis`
    (run 20), `dreyar.fbx` at `umit`, `paladin_wprop_j_nordstrom.fbx` at `cersei`, `erika_archer.fbx`
    at `berkalp`, and `uriel_a_plotexia.fbx` at `doran` (run 21). No character files remain unused.
  - **Creatures:** `wolf` (Free3D/3dhaupt, rigged glTF/GLB with walk/run/sit/creep/idle clips, for
    FAZ 6) and `black_dragon` (Free3D, rigged FBX with baked walk/run/idle/jump/wing-open/fly
    clips, for FAZ 7 — an original design, explicitly not a "Drogon" replica; see the manifest's
    notes for why a similarly-named Sketchfab model was rejected). Neither consumed by code yet.
  - Do not attempt to re-download or replace any of these; any *additional* Mixamo/Free3D asset
    must go through the same manual human step (see "Known Issues" below).

## World Coverage

**World Coverage: 96.2% (132.25 km² / 137.5 km² target) on desktop-class devices — grown from 80.7%
at run 42 (`PHASE1_PREVIEW_RADIUS_CHUNKS` 10 -> 11, DECISIONS.md ADR-0055, using F2/F4's real
measured headroom, not an estimate); 4.5% (6.25 km² / 137.5 km²) on mobile-class devices, unchanged
— see below for why the two paths differ and stay different by design (same device-branching
pattern as ADR-0010).**
**Unchanged by run 17 — FAZ 4's player addition doesn't generate or force-load any new terrain
chunks, re-verified via the same headless-Chromium console-log method (`"...444 terrain chunks
resident (~111.00 km²)..."` desktop, `"...25 terrain chunks resident...(~6.25 km²)..."` mobile,
byte-identical to run 16). Still unchanged by run 19 (camera wall-avoidance is a per-frame render
adjustment, not a terrain/streaming change), by run 20 (FAZ 5's NPCs are 2 more characters, not
terrain — same `"444 terrain chunks resident"` desktop / `"25 terrain chunks resident"` mobile log
lines re-confirmed byte-identical this run), by run 26 (FAZ 6's 2 wolves are 2 more characters,
same reasoning — `"444 terrain chunks resident"` desktop / `"25 terrain chunks resident"` mobile
re-confirmed byte-identical again), by run 27 (giving those same 2 wolves a patrol is a per-frame
position update, not a terrain/streaming change — figures re-confirmed byte-identical a third time),
by run 28 (adding flee is likewise a per-frame movement-priority check, not a terrain/streaming
change — figures re-confirmed byte-identical a fourth time), and by run 29 (moving spawn-resolution
wiring into `npc.js`/`animals.js` and adding pack-alert flee are both non-terrain changes — figures
re-confirmed byte-identical a fifth time) — same figures re-confirmed via an identical console-log
check each time.**

- **Target area (100-150 km² band) re-verified this run — still correct, no change made.** Same
  re-derivation every run performs: `src/3d/config.js`'s `WORLD_SCALE.METERS_PER_MAP_UNIT` is 1.75
  (not ADR-0001's original 10), the padded kingdom bounding box is unchanged (14 `INIT_KINGDOMS`
  seats), giving a **12.02km x 10.80km** world (~129.8 km² by exact bounds), rounded up to a **25 x
  22 grid of 500m x 500m chunks = 137.5 km²** (550 total chunk slots). Confirmed identical to
  ADR-0004/ADR-0013 — the earlier "4278 km²" target this instruction set once warned about does not
  exist anywhere in this codebase; nothing to revert.
- **Covered area (boot baseline, desktop-class): 132.25 km²** (up from 111.00 km²) — `CHUNK_CONFIG.
  PHASE1_PREVIEW_RADIUS_CHUNKS` bumped from 10 to 11 at run 42 (21x21/441 chunks -> 23x23/529
  chunks) — see DECISIONS.md ADR-0055. Unlike radius 10's Night King spillover, no extra grounding
  chunks were needed this time (that seat's grounding neighborhood now fits fully inside the wider
  square). 529 total resident chunks / 550 (96.2%), verified via headless Chromium (`"Placed 14
  kingdom-seat settlements; 529 terrain chunks resident (~132.25 km²) after grounding them"`).
  Radius 11, not 12: 12 would make the boot-preview square (25x25) wider/taller than `GRID_COLUMNS`
  (25) and `GRID_ROWS` (22), generating real terrain outside the designed 137.5 km² world extent
  (`loadSquare` has no bounds clamp) — see ADR-0055's Reasoning for why that was rejected.
- **Mobile-class boot baseline is unchanged at 25 chunks (~6.25 km², 4.5% of 550 slots) — this run's
  change is desktop-only.** `PHASE1_PREVIEW_RADIUS_CHUNKS` is never read on touch-primary devices
  (they use `STREAM_RADIUS_CHUNKS` instead, per ADR-0010's device branch) — re-verified via the same
  touch-emulated headless Chromium context as every prior run: console still confirms `"Loaded 25
  terrain chunks (~6.25 km²)"` and `"25 terrain chunks resident ... (mobile — grounding skipped)"`.
  **Tracked from `getCumulativeCoveredAreaKm2()`, not `getCoveredAreaKm2()`** — see DECISIONS.md
  ADR-0003: `game3d.js` also additively **streams in more chunks at runtime** as the interactive
  camera's orbit target crosses into unvisited chunks (never unloading — see ADR-0003 for why
  eviction is deliberately deferred), so real interactive sessions grow coverage further than either
  static baseline above.
- Per the project's phase-gate rules, FAZ 3 and FAZ 10 cannot be marked DONE below 80% coverage
  (crisis exception: fix critical bugs/perf first, then resume geographic growth). **The coverage
  gate itself is clear on desktop (96.2% as of run 42, was 80.7%)**, but FAZ 3 is **not** being
  marked DONE — its PBR-materials and LOD/collider sub-tasks (see Roadmap below) are still open,
  and FAZ 10 (Performans) hasn't been started at all.

## Performance Budget Status

Desktop budget: DrawCalls<2500, Triangles<5M, TextureMem<2GB. Mobile: DrawCalls<500,
Triangles<500K, TextureMem<512MB.

- **Current desktop-class boot scene (529 chunks, up from 444 — `PHASE1_PREVIEW_RADIUS_CHUNKS`
  bumped 10 -> 11 at run 42, DECISIONS.md ADR-0055):** figures below are a **real F2 (`renderer.
  info`) measurement**, not a hand-computed estimate — taken from an F4 high-altitude view chosen to
  keep most/all of the loaded chunk square in frame at once (the boot camera's own default view only
  samples whichever few chunks it happens to be looking at, far below any real worst case). Measured
  **351 draw calls (14.0% of budget) / 2,440,831 triangles (48.8% of budget)** — both comfortably
  clear, and triangles remain the tighter of the two budgets by a wide margin (51.2% headroom left
  vs. 86.0% on draw calls). This is an empirical near-worst-case reading from one flight path, not
  an exhaustive proof — see ADR-0055's own caveat. Verified via headless Chromium, not just
  computed: console confirms `"Placed 14 kingdom-seat settlements; 529 terrain chunks resident
  (~132.25 km²) after grounding them"`, zero page errors. **Note on the bullets below:** they
  document each system's own incremental cost on top of run 29's old 453-draw-call/~3.67M-triangle
  baseline (since superseded) — the 351/2,440,831 figures above are a fresh, real, *whole-scene*
  measurement including every one of those systems already, not a number to add the bullets on top
  of again.
- **`gameplay/animals.js` (added run 26, 3rd wolf added run 30):** 3 wolves × 5 draw calls each (one
  per glTF primitive — body/fur/claws/eyes/teeth; the bundled non-skinned "Circle" mesh is stripped
  before it ever reaches the scene, see DECISIONS.md ADR-0025) = 15 draw calls, 2,748 triangles/wolf
  × 3 = 8,244 triangles. Desktop total grows to **~468 draw calls (18.7% of budget) / ~3.679M
  triangles (73.6% of budget)** — both still comfortably clear, the addition is under 0.1% of either
  budget on its own. Same 15 draw calls/8,244 triangles also apply on mobile (animal spawning isn't
  gated by device class, same as NPCs) — mobile total grows to ~215,564 triangles (43.1% of the
  mobile budget, up from 42.6%). Verified via headless Chromium: console confirms `"Spawned 3 FAZ 6
  animal(s)."` (up from 2) on both device classes, zero page errors. **Patrol (run 27) adds zero new draw
  calls/triangles** — same 2 `SkinnedMesh` instances, just a second clip (`walkAction`) loaded per
  wolf and a per-frame position/rotation update; no new GPU resources. **Flee (run 28) likewise adds
  zero new draw calls/triangles** — one more clip (`fleeAction`) loaded per wolf and a per-frame
  distance check against the player; no new GPU resources, no new meshes.
- **`world/settlements.js` (added run 14):** 3 draw calls total (one `InstancedMesh` per castle
  part — keeps/towers/roofs — covering all 14 kingdom seats, not 3-per-castle), ~2,520 triangles
  total. On its own, negligible against both budgets. On **mobile**, settlement force-grounding is
  skipped entirely (see World Coverage above) specifically because the *terrain* chunks it would
  otherwise force-load would have added ~753K triangles — 1.9x the mobile triangle budget by
  itself; the settlement meshes' own ~2,520 triangles were never the problem. Mobile total with
  settlements: unchanged 25 terrain chunks (~204,800 triangles) + ~2,520 settlement triangles ≈
  207,320 triangles (41.5% of the mobile budget, up from 41% — the settlement meshes themselves are
  cheap enough to include on mobile even though their grounding chunks aren't).
- **Mobile is now genuinely protected, not just documented as "deliberately not this."** This run
  found and fixed a real gap (DECISIONS.md ADR-0010): nothing in code actually branched on device,
  so a real phone loading `game3d.html` got the exact same chunk count as desktop — at the old
  169-chunk preview that was already ~2.8x over the mobile triangle budget, and would have gotten
  worse every time a future run grew the "desktop-only" radius further. `game3d.js`'s `createScene()`
  now detects `(pointer: coarse)` and loads `STREAM_RADIUS_CHUNKS` (2 → 25 chunks, ~204K triangles,
  41% of the mobile triangle budget) instead on touch-primary devices. Verified via a
  touch-emulated headless Chromium context (`hasTouch: true, isMobile: true`): console confirms
  `"Loaded 25 terrain chunks (~6.25 km²) in 472ms (touch/mobile-class device — mobile-budget
  radius)"`, `window.matchMedia('(pointer: coarse)').matches` read `true` inside the page (confirms
  the emulation actually flips the signal this code reads), zero page errors.
- **FPS: not reliably measurable in this sandbox.** Headless Chromium here falls back to
  SwiftShader **software** rendering (no real GPU passthrough) — sampled ~5-6 FPS in this sandbox
  across prior chunk-count comparisons, a pattern pointing to a mostly-fixed software-rasterization
  overhead dominating, not geometry-bound cost. Treat this sandbox's FPS numbers as
  non-representative; real FPS needs a real device/browser test, which no run has been able to do
  yet. Flagged under Known Issues. Not re-sampled this run (same sandbox limitation, no new
  information to add).
- **Generation time (one-time, not per-frame):** 289 chunks generated in ~1365ms on the desktop path
  (up from 630ms at 169 chunks — roughly linear, as expected), 472ms on the mobile path (25 chunks).
  Both measured via `performance.now()` around the `loadSquare` call in `game3d.js`, both masked
  behind `game3d.html`'s loading overlay (only hidden once `phase1-scene` `GAME_READY` fires, i.e.
  after generation completes) so neither shows as visible jank. Would need attention if a future
  streaming system called this per-frame instead of on demand as the player crosses chunk
  boundaries.
- **Tech debt flagged, not yet worth fixing:** each chunk is its own draw call/mesh. Geometry
  merging or `InstancedMesh` (per the project's performance guidelines) would cut draw calls
  substantially, but at 169 draw calls there's no measured problem to justify the added complexity
  yet — revisit if/when draw calls approach the budget ceiling.
- **`fog.js` (added run 8):** 0 added draw calls/triangles/GPU resources — `THREE.FogExp2` is
  plain color+density data consumed by materials that already opt in (`world/terrain.js`'s
  built-in `MeshStandardMaterial`); the per-fragment fog-mix cost on those materials is part of
  three.js's standard built-in shader, not new/custom work this project added.
- **`lighting.js` (added run 7):** 0 added draw calls/triangles — `DirectionalLight`/
  `HemisphereLight` are not meshes and no shadow maps are enabled (see DECISIONS.md ADR-0006), so
  this is a pure CPU-side per-frame color/position interpolation, negligible cost.
- **`sky.js` + `world/water.js` combined (added run 6):** 2 more draw calls (291 total on the
  desktop path, still 12% of the desktop budget), ~960 sky triangles + ~32,768 water triangles
  (`PlaneGeometry(4000, 4000, 128, 128)`, 2 triangles/cell) ≈ 33.7K triangles — under 1% of the
  desktop triangle budget and a small (6.7%) slice of the *mobile* triangle budget on its own;
  combined with the real mobile-path 25-chunk terrain view (~204K triangles, see above, now
  actually reachable via the device-class branch, not just a hypothetical) that's still comfortably
  inside the 500K mobile ceiling. No `InstancedMesh`/LOD needed yet for either.

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
- [x] Yıldızlı gece (`stars.js`) — 1200 tohumlu (seeded) noktadan oluşan üst-yarımküre yıldız
  bulutu, kamerayla birlikte yeniden merkezlenen bir `THREE.Points`, opaklığı doğrudan
  `lighting.js`'in `nightFactor`'üyle sürülüyor (aurora'nın kullandığı aynı gece-gündüz geçidi).
  Kendi içine kapalı bir `mulberry32` kopyası taşıyor (`world/terrain.js`'den import etmiyor —
  yıldızlar bir atmosfer meselesi, `world/` sistemi değil). Gerçek `game3d.html` sahnesinde ve ayrı
  bir gece-zorlamalı doğrulama render'ında sıfır hatayla, gün döngüsü boyunca opaklığın
  `nightFactor`'ü tam eşleştirdiği bir birim-testi taramasıyla doğrulandı. Detaylar: DECISIONS.md
  ADR-0012.
- [x] Nehir — ilk gerçek geçiş (`world/rivers.js`) — deterministik yokuş-aşağı yürüyüş
  (steepest-descent, `terrain.js`'in mevcut FBM yükseklik alanı üzerinde, `terrain.js`'e hiç
  dokunmadan — su için ADR-0005'in aynı tekniği), kaynak noktasından (orijine 2000m içindeki en
  yüksek nokta) deniz seviyesine kadar. Küçük yerel minimumlara takılmayı önlemek için artan
  yarıçaplı arama (escalating-radius) eklendi — ilk basit (tek yarıçaplı) sürüm ~360m'de takılıp
  kalıyordu, gerçek smoke testinde yakalandı ve düzeltildi. `terrain.js`'den yeni
  `createHeightSampler`/`mulberry32` export'ları ile besleniyor. Statik tek nehir, FAZ 1 önizleme
  alanıyla sınırlı (`maxRiverRadiusMeters`) — birden fazla nehir/streaming entegrasyonu gelecek iş.
  Gerçek üstten-görünüm ekran görüntüsüyle doğrulandı (kaynak→deniz ağzı işaretçileriyle).
  Detaylar: DECISIONS.md ADR-0009.
- [x] Şelale (nehir yükseklik farkına göre) — `detectWaterfalls(points)` nehrin izlenmiş yolundaki
  dik segmentleri işaretliyor (`dropMeters >= 2.5` VE `slope >= 0.06`, bu dünyanın gerçek nehir
  verisine karşı ölçülmüş eşikler — bkz. DECISIONS.md ADR-0011), `createWaterfallMesh` her birinde
  dikey bir "perde" mesh'i oluşturuyor (üstte köpük-beyazı, altta nehir mavisine geçiş). Bilinçli
  olarak şematik: `terrain.js`'in düz FBM yüzeyinde gerçek uçurum yok, bu yüzden perde arazi
  eğimini takip etmek yerine dikey duruyor. Gerçek tohumla (1337) 2 şelale tespit edildi, headless
  Chromium ile hem gerçek `game3d.html` sahnesinde hem ayrı bir üstten-görünüm doğrulama
  render'ında sıfır hatayla doğrulandı.
- [x] Fog (`fog.js`) — `THREE.FogExp2` on `scene.fog`, color reused directly from `lighting.js`'s
  current horizon color (so fogged terrain fades into the sky, not a mismatched flat color),
  density interpolated day→night via the same `nightFactor`. Automatically applies to
  `world/terrain.js` (built-in `MeshStandardMaterial`); `sky.js`/`world/water.js`'s custom shaders
  do not consume it yet (see Known Issues). See DECISIONS.md ADR-0007, including why the initial
  density guess looked wrong in an actual screenshot and was retuned.
- [ ] Volumetric ışık (god rays / light shafts) — **not started.** Fog above only covers distance
  haze; true volumetric/light-shaft rendering (screen-space raymarching or similar) is a separate,
  larger technique not attempted this run — do not mark this checklist item done from the fog work
  alone.

### FAZ 3 — Kaleler/Yerleşimler (in progress)
- [x] 2D haritadaki krallık konumlarını yansıtan modüler kale/kule (`world/settlements.js`) — 14
  kingdom seats, `InstancedMesh`-based (box keep + 4 corner towers + conical roofs), colored by
  house via per-instance roof color. See DECISIONS.md ADR-0013.
- [x] PBR malzemeler — `world/materials.js` (new, run 16): seeded canvas-generated color/roughness/
  normal maps for the stone keep/tower material, color/roughness maps for the roof material (mortar
  grooves, per-block variance, real normal-map bevel depth). Procedural, not an external texture
  file. See DECISIONS.md ADR-0015.
- [x] Basit collider — **run 35** (`physics.js`'s `createSettlementCollider`, DECISIONS.md ADR-0037):
  an axis-aligned box (keep) + 4 circles (corner towers) per seat, grown by a small player-radius
  margin; `gameplay/player.js` resolves the player's horizontal movement through it every frame
  before ground-height sampling, so the player can no longer walk through a castle's keep or towers.
- [ ] LOD — still not attempted; castles are a fixed triangle count regardless of camera distance.
  Deliberately not bundled into run 35's collider work (see ADR-0037's Alternatives) — `settlements.js`'s
  `InstancedMesh` already keeps this at 3 draw calls total regardless of distance, and no perf-budget
  overrun has ever been measured that LOD would fix, so it stays a real but low-urgency remaining item.

### FAZ 4 — Oynanabilir Karakter ✅ TAMAMLANDI (run 17-19)
- [x] 3. şahıs kamera — chase-cam (mevcut `OrbitControls` yeniden kullanılıyor, `game3d.js` her
  frame kamera+target'ı oyuncunun hareket deltası kadar öteliyor — bkz. DECISIONS.md ADR-0016) +
  **raycast duvar önleme (`camera.js`'in `resolveCameraCollision`'ı, run 19, bkz. ADR-0018)** —
  kamera artık arazi/kaleyi kesip geçmiyor, `controls.target`'tan ışın atıp önündeki yüzeye kadar
  çekiliyor, sonraki frame'de kullanıcının gerçek zoom mesafesi geri yükleniyor.
- [x] WASD + touch joystick (`input.js` + `ui/touchJoystick.js` + `gameplay/player.js`) —
  WASD/ok tuşları + Shift-koşu ve dokunmatik cihazlarda ekran üstü joystick (run 18, DECISIONS.md
  ADR-0017), her ikisi de `game3d.js`'in `combineAxes()`'i ile birleştirilip
  `computeCameraRelativeMove`'a besleniyor. Gerçek fiziksel dokunmatik cihazda hâlâ test edilemedi
  (bu sandbox'ın kalıcı sınırı — bkz. Known Issues), sadece Playwright'ın pointer-event simülasyonu
  ile doğrulandı.
- [x] Zemin çarpışması (`physics.js`) — `createGroundCollider(seed)`, `world/terrain.js`'in
  `createHeightSampler`'ını sarmalıyor; oyuncu her adımda gerçek arazi yüksekliğine yapışıyor.
  Kale duvar çarpışması run 35'te eklendi (`createSettlementCollider`, ADR-0037). **Yerçekimi/
  zıplama run 36'da eklendi** (`physics.js`'in `integrateJumpArc`'ı, ADR-0039) — Space tuşu (sadece
  masaüstü klavye) basit bir balistik zıplama tetikliyor, karakter havadayken mevcut yer
  yapışmasının üstüne bir "yerden yükseklik" ofseti biniyor, eğim/basamak takibi bozulmuyor.
- [x] CC0 rigli insan + animasyon blending (Mixamo) — `gameplay/player.js`, `peasant_girl.fbx` +
  idle/walking/running klipleri aynı Mixamo iskeletine retarget edilip `THREE.AnimationMixer` ile
  hıza göre crossfade ediliyor.

### FAZ 5 — Kalabalık/NPC (in progress, started run 20, extended run 21, patrol added run 22, name-tag UI added run 23, patrol extended to all 6 NPCs run 24, 4 more seats added run 25)
- [~] Statik/idle NPC'ler (`gameplay/npc.js`) — **ilk pas (run 20):** `stannis` kalesi yanında 2
  NPC (`paladin_j_nordstrom`, `arissa`), `player.js`'in aynı Mixamo FBX/retarget hattı yeniden
  kullanılarak yükleniyor. Literal "instanced" değil (`THREE.InstancedMesh` iskeletsel animasyon
  başına ayrı state gerektirdiği için bu ölçekte uygun değil) — her NPC kendi `SkinnedMesh`'i ve
  `AnimationMixer`'ı ile ayrı ayrı yükleniyor. **İkinci pas (run 21, config-only):** `NPC_CONFIG.
  SPAWNS` 6 girdiye çıkarıldı — `umit` (`dreyar`), `cersei` (`paladin_wprop_j_nordstrom`), `berkalp`
  (`erika_archer`), `doran` (`uriel_a_plotexia`), her biri 1 NPC. **Üçüncü pas (run 25, config-only,
  yeni asset indirmeden):** `ziya` (`arissa`, tekrar kullanım), `balon` (`paladin_wprop_j_nordstrom`,
  tekrar kullanım), `robin` (`erika_archer`, tekrar kullanım), `jon` (`uriel_a_plotexia`, tekrar
  kullanım) — 14 krallık koltuğundan 9'unda artık en az 1 NPC var (5'ten yükseldi), 10 NPC toplam
  (6'dan yükseldi). Bkz. DECISIONS.md ADR-0019/ADR-0020/ADR-0024.
- [x] Waypoint/patrol — **pilot (run 22) + tüm NPC'lere genişletildi (run 24), yeni eklenen 4 NPC de
  baştan dahil (run 25), tam bir Behavior Tree değil:** `gameplay/npc.js`'in `createNPC`'i isteğe
  bağlı `patrolWaypoints` alıyor — verilirse NPC 2+ dünya-uzayı nokta arasında düz bir çizgide
  yürüyor (indeks modulo ile sarılıyor — 2 nokta gidiş-geliş, 3+ döngü), her noktada
  `PATROL_PAUSE_SECONDS` kadar idle bekliyor, `player.js`'in aynı zemin-yükseklik yeniden-örnekleme
  ve en-kısa-yol dönüş mantığını yeniden kullanıyor. **Artık 10 NPC'nin tamamı** 24m gidiş-geliş
  devriyesi yürüyor — ilk 6'sı run 24'te genişletildi (ADR-0021'in `stannis` için kanıtladığı aynı
  geometri: offsetZ işareti ters çevrildi, offsetX değişmedi — bkz. DECISIONS.md ADR-0023), run
  25'te eklenen 4 yeni NPC ise baştan patrol'lü doğdu (bkz. ADR-0024). Gerçek AI/oyuncu-
  farkındalığı/çok-noktalı rota henüz yok — bilinçli olarak kapsam dışı (bkz. ADR-0021'in
  "Alternatives considered" bölümü).
- [x] Idle animasyon döngüsü — `peasant_girl`'in `idle.fbx`'i her NPC'nin paylaşılan iskeletine
  retarget edilip döngüsel oynatılıyor. **Yürüme döngüsü (run 22):** patrol eden NPC'ler için
  `peasant_girl`'in `walking.fbx`'i de aynı şekilde retarget edilip idle/walk arası crossfade
  ediliyor; statik NPC'ler için hâlâ gerekmiyor.
- [x] İsim etiketi (name-tag) UI — **run 23:** `gameplay/npc.js`'in `createNameTagSprite`'ı, canvas'a
  çizilmiş metinden bir `THREE.CanvasTexture` + `THREE.SpriteMaterial` billboard'u, NPC modelinin
  başının üstünde (`NPC_CONFIG.NAME_TAG_VERTICAL_OFFSET_METERS`, 2.1m) çocuk nesne olarak duruyor.
  Tüm NPC'ler (run 25 itibarıyla 10) ev-temalı bir Türkçe isim gösteriyor (`'Baratheon Muhafızı I/II'`,
  `'Targeryan/Lannister/Stark/Martell/Tyrell/Greyjoy/Arryn Muhafızı'`, `'Gece Nöbeti Muhafızı'`).
  Gerçek bir ölçek hatası bulunup düzeltildi: sprite
  ilk halinde FBX modelinin ~0.01'lik Mixamo cm→m ölçek düzeltmesinden miras aldığı için görünmez
  kalıyordu — `model.scale.x`'in tersiyle çarpılarak (bkz. DECISIONS.md ADR-0022) düzeltildi,
  headless Chromium'da gerçek bir yakın-çekim ekran görüntüsüyle doğrulandı. Diyalog/etkileşim
  sistemi hâlâ yok — sadece görsel bir etiket, bilinçli olarak kapsam dışı (bkz. ADR-0022).

### FAZ 6 — Hayvanlar (in progress, started run 26, patrol added run 27, flee added run 28, pack-alert added run 29)
- [x] Kurt (vahşi — run 26 statik/idle, run 27 devriye, run 28 oyuncu-farkındalığı, run 29 sürü
  tepkisi) — `gameplay/animals.js`'in `createWolf`'u, `berkalp` (Stark) kingdom seatinde 2 adet,
  glTF/GLB (`AssetLoader.loadModel`) ile yüklenip idle klibi döngüde oynatılıyor. **Devriye (run
  27):** her iki kurt da 20m'lik düz bir hat üzerinde gidip geliyor (`gameplay/npc.js`'in
  kanıtlanmış `patrolWaypoints` deseni kopyalanarak, paylaşılan bir modüle çıkarılmadan — bkz.
  DECISIONS.md ADR-0026'nın "neden kopyalama" gerekçesi), duraklarda idle'a dönüyor, walk klibine
  crossfade ediyor. **Oyuncu-farkındalığı (run 28):** oyuncu 15m içine girdiğinde kurt devriyeyi/
  idle'ı bırakıp doğrudan oyuncudan uzağa 4.5 m/s ile koşuyor (run klibi), güvenli mesafeye çıkınca
  normale dönüyor — bkz. DECISIONS.md ADR-0027. **Sürü/pack tepkisi (run 29):** bir kurt kendi 15m
  eşiğine girmemiş olsa bile, 20m içindeki bir "paketdaşı" (packmate) zaten kaçıyorsa o da kaçmaya
  başlıyor — yön her zaman oyuncudan uzağa (paketdaşından değil) — bkz. DECISIONS.md ADR-0029.
  Gerçek pathfinding hâlâ yok, sürü tepkisi sadece 2 kurtla test edildi (3+ hayvanlı zincirleme
  yayılım doğrulanmadı) — bilinçli olarak kapsam dışı. Bkz. DECISIONS.md
  ADR-0025/ADR-0026/ADR-0027/ADR-0029.
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

## This Run (2026-07-29, run 8)

**Continuation of the same operator session** (user said "devam et" / "continue" right after run
7's push) — no new Session Snapshot re-read needed since repo state was already fresh in context
(clean, `main` at `b59a31c`, run 7's day/night commit already pushed). Picked up run 7's own
documented "Next step": fog, since it's self-contained and pairs with the day/night work just
landed.

**Done — FAZ 2 fog, per run 7's recommended next step:**
- **Design decision made and recorded before writing code (DECISIONS.md ADR-0007):** a new
  `src/3d/fog.js` reuses `lighting.js`'s per-frame output directly — fog color = current horizon
  color (so fogged terrain fades into the sky, not a mismatched flat color), fog density
  interpolated day→night via `lighting.js`'s existing `nightFactor` — rather than a second,
  independently-tuned keyframe table.
- **Built `src/3d/fog.js`:** `createFog()` / `updateFog(fog, dayNight)`, `THREE.FogExp2` on
  `scene.fog`. No dispose needed (plain data, not a GPU resource).
- **Wired into `game3d.js`:** `scene.fog = createFog()` at scene setup; tick loop calls
  `updateFog(state.scene.fog, dayNight)` right after `updateDayNightLighting()`/`updateAuroraSky()`.
- **`service-worker.js`:** added `./src/3d/fog.js` to `GAME3D_SHELL_FILES`.
- **Density tuned against a real screenshot, not just the formula** — flagged explicitly in
  DECISIONS.md ADR-0007: the first density guess (derived from "50% fog by ~1500m") rendered
  visibly washed-out/hazy even in the near field when actually screenshotted, not just at range.
  Halved-ish to `0.0004`/`0.00055` (day/night) and re-verified: clear foreground, light haze by
  ~1000m, meaningfully thick only near the 2000m far plane — the intended "atmosphere, not a wall"
  look.
- **Scoped `world/water.js`/`sky.js` out of this change, explicitly, not silently:** three.js only
  auto-fogs shaders that include the `fog_*` GLSL chunks; wiring that into water's existing
  Gerstner vertex shader is its own contained follow-up (a `vFogDepth` varying threaded through),
  not a two-line addition — logged as a new Known Issues entry below instead of rushed in.
- **Regression guard:** `node --check` on every non-vendored `src/3d/**/*.js` file (including the
  new `fog.js`) plus `service-worker.js`. All pass.
- **Real smoke tests (same headless-Chromium/`http-server` setup as run 7):**
  1. A unit-style test sweeping `updateFog` across a full simulated day (20 samples, chained after
     `updateDayNightLighting`): zero `NaN`s, fog color exactly matches `dayNight.horizonColor` at
     every sample (confirms the "single source of truth" design actually holds, not just intended),
     midnight density > noon density as expected.
  2. Full `game3d.html` render pass, twice (before/after the density retune) — zero
     `pageerror`/`console.error` both times; the *screenshot* comparison (not just "no errors") is
     what caught the initial density being too strong and drove the retune.
  3. Offline regression (SW registration via `index.html`, then `game3d.html`, then offline reload):
     zero errors, canvas still renders — confirms `fog.js`'s new precache entry didn't break the
     existing offline guarantee.
  4. 2D game regression: only the pre-existing, documented sandbox noise (Firebase/network),
     3D-mode button still present.

**Files changed this run:** `src/3d/fog.js` (new), `src/3d/game3d.js` (fog wiring),
`service-worker.js` (`GAME3D_SHELL_FILES`), `DECISIONS.md` (new ADR-0007), `src/3d/README.md`,
`ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). Seven files, ~150 new/changed lines — well
within budget; documentation changes describe this one atomic change (one new module + its single
call-site integration + its offline-cache entry).

**Next step for the next run:** FAZ 2's remaining items: rivers/waterfalls (needs a river-path/
height-drop concept `terrain.js` doesn't have yet — design that first) and volumetric light (god
rays — a separate, larger technique from the distance fog just landed, not started). Also worth
picking up opportunistically: wiring `world/water.js` into `scene.fog` (flagged in Known Issues
this run) is a small, well-scoped task if a future run wants a quick win before tackling the
river/waterfall design work. World Coverage unchanged at 30.73% (42.25 km² / 137.5 km²) — this run
added a visual system, not terrain area.

## This Run (2026-07-29, run 9)

**Continuation of the same operator session** ("Devam et" / "continue" right after run 8's push).
Repo state already fresh in context (clean, `main` at `9d45d08`, run 8's fog commit already
pushed) — no re-read needed. Picked up run 8's own flagged "quick win": wiring `world/water.js`
into `scene.fog`, deferred by ADR-0007 as a small, contained follow-up rather than done in run 8.

**Done — `world/water.js` fog participation:**
- **Verified the exact mechanism against the real vendored source before writing code** (BİLMEME
  KURALI): `grep`ped `src/3d/vendor/three/three.module.js` for `fog_vertex`/`fog_pars_vertex`/
  `fog_fragment`/`fog_pars_fragment`/`UniformsLib.fog`/`refreshFogUniforms` rather than trusting a
  half-remembered description of three.js's custom-shader fog support.
- Added the four `fog_*` GLSL chunks to `world/water.js`'s vertex/fragment shaders, set `fog: true`
  on the material, and named the vertex shader's existing inline `modelViewMatrix * vec4(...)`
  computation `mvPosition` (the fog chunk needs a variable with exactly that name) instead of
  computing it anonymously for `gl_Position` alone.
- **Caught a real runtime bug via the smoke test, not the docs:** the first version (chunks +
  `fog: true`, no uniform merge) threw `Cannot read properties of undefined (reading 'value')`
  inside three.js's `refreshFogUniforms` on every render call — `ShaderMaterial` doesn't
  auto-merge `THREE.UniformsLib.fog` into its `uniforms` the way built-in materials do. Fixed with
  `THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {...own uniforms}])`. Full mechanism recorded
  in DECISIONS.md ADR-0008 so a future run wiring up a *different* custom shader's fog doesn't
  rediscover this the hard way.
- **Regression guard:** `node --check` on `world/water.js`. Pass.
- **Real smoke tests:** full `game3d.html` render pass — first attempt failed with the uniform
  error above (19 repeated `pageerror`s, one per frame before the loop presumably errored out
  consistently); fixed, re-ran, zero errors, screenshot confirms terrain and water render together
  with the fog reaching the horizon.  Re-ran the offline-precache and 2D-game regression tests
  (unchanged files there, but cheap to re-verify) — both still clean.

**Files changed this run:** `src/3d/world/water.js` (fog chunks/uniforms), `DECISIONS.md` (new
ADR-0008), `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). Four files, ~80 changed lines —
well within budget; no `service-worker.js` change needed (no new file, `world/water.js` was
already precached).

**Next step for the next run:** FAZ 2's remaining items: rivers/waterfalls (needs a river-path/
height-drop concept `terrain.js` doesn't have yet — design that first, this is now the largest
remaining FAZ 2 design task) and volumetric light (god rays — separate, larger technique, not
started). World Coverage unchanged at 30.73% (42.25 km² / 137.5 km²) — this run improved an
existing visual system, not terrain area.

## This Run (2026-07-29, run 10)

**Continuation of the same operator session** ("Devam et" / "continue" right after run 9's push).
Repo state already fresh in context (clean, `main` at `3c8236d`, run 9's water-fog fix already
pushed) — no re-read needed. Picked up FAZ 2's largest remaining design task, flagged as pending
across runs 6-9: rivers/waterfalls, blocked on "a river-path/height-drop concept `terrain.js`
doesn't have yet."

**Done — FAZ 2 river, first real pass:**
- **Design decision made and recorded before writing code (DECISIONS.md ADR-0009):** rivers are
  *traced* over `terrain.js`'s existing FBM height field (deterministic steepest-descent walk from
  a high point to sea level), not carved into `terrain.js` — same "find the shape in the existing
  noise" approach ADR-0005 used for sea-level water, so `terrain.js`'s chunk generation itself
  needed no changes.
- **Extracted `createHeightSampler(seed, fbmOptions?)` and exported `mulberry32` from
  `terrain.js`:** pulls the per-vertex height formula out of `createTerrainChunk`'s loop into a
  standalone, pure, reusable function (`world/rivers.js` needs to query height without generating a
  whole chunk) and shares the one PRNG implementation instead of a second copy. `createTerrainChunk`
  now calls this internally — verified behavior-identical (unchanged terrain screenshot, same seed).
- **Built `src/3d/world/rivers.js`:** `generateRiverPath({seed, sampleHeightMeters,
  seaLevelMeters, ...})` → `{points, endReason}`; `createRiverMesh(points, widthMeters)` → a static
  ribbon `THREE.Mesh` (built-in `MeshStandardMaterial`, so it gets `scene.fog`/day-night lighting
  for free); `disposeRiverMesh`.
- **Caught and fixed a real algorithmic bug via testing, not assumed correct from the design alone:**
  the first version (single fixed search radius) got stuck in a small local minimum after only ~10
  points/~360m — nowhere near the sea — confirmed via an actual headless-Chromium run reading the
  `console.info` path stats, not just eyeballing the code. Root cause: multi-octave FBM has many
  small local dips layered on the macro shape. Tried a coarse/fine sampler split first (still got
  stuck, just less often); the fix that actually worked, verified across several trials before
  committing: escalate the search radius (`stepMeters * 2^n`, capped) when no downhill neighbor
  exists at the normal distance. With this fix, the exact same full-detail (5-octave) height field
  the terrain renders reaches the sea in 11 points using only one escalation.
- **Regression guard:** `node --check` on `world/rivers.js`, `world/terrain.js`, `game3d.js`. All pass.
- **Real smoke tests (headless Chromium):**
  1. Full `game3d.html` render pass — zero `pageerror`/`console.error`, `console.info` confirms
     `"River path traced: 11 points, ended via \"sea\""`.
  2. **A dedicated independent top-down orthographic verification render** (separate scene, real
     terrain chunks + real river mesh, source/mouth marked with colored spheres) — visually confirms
     the river actually winds from a high source point down to a sea-level outlet over real terrain,
     not just "the function returned without throwing."
  3. Terrain-refactor regression check: `createHeightSampler` extraction produces byte-for-byte the
     same visual terrain (compared the standard boot screenshot before/after — identical).
  4. Offline-precache and 2D-game regression tests — both still clean.
- **`service-worker.js`:** added `./src/3d/world/rivers.js` to `GAME3D_SHELL_FILES`.

**Files changed this run:** `src/3d/world/rivers.js` (new), `src/3d/world/terrain.js`
(`createHeightSampler`/`mulberry32` exports, internal refactor), `src/3d/game3d.js` (river wiring),
`service-worker.js` (`GAME3D_SHELL_FILES`), `DECISIONS.md` (new ADR-0009), `src/3d/world/README.md`,
`ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). Eight files, ~350 new/changed lines — within
budget; documentation changes describe this one atomic addition (one new module + one small,
behavior-preserving refactor to enable it + its wiring + its offline-cache entry).

**Next step for the next run:** waterfalls (a steep-height-drop detector over the river's own path
points — much smaller now that a real path exists to walk) or generalizing to multiple rivers/
streaming integration (bigger, see ADR-0009's Consequence). Volumetric light (god rays) also still
not started. World Coverage unchanged at 30.73% (42.25 km² / 137.5 km²) — this run added a
geography feature, not chunk-covered area.

## This Run (2026-07-29, run 11)

**Session Snapshot taken at start of run** (per protocol): repo started `HEAD` detached, matching
`origin/main` (`3c8236d`, run 9's fog-uniform-merge commit) while local `main` was stale at
`38e09e7` — the same recurring pattern documented in runs 2-4. Fixed with `git checkout main && git
merge --ff-only origin/main` (29 commits fast-forwarded, no data loss — confirmed `origin/main` was
already ahead of local `main`, not the other way around). Read `3D_GAME_PROGRESS.md` in full,
`git log -10`, and `DECISIONS.md`'s last ADR (ADR-0008) per protocol.

**World-scale correction check (this run's explicit first instruction):** the operator's brief
restated the 100-150 km² band requirement, asserting the old (already-superseded) 4278 km² target
might still be live. Re-verified directly against `src/3d/config.js`: `WORLD_SCALE.
METERS_PER_MAP_UNIT` is `1.75`, `CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` are `25`/`22` — exactly
ADR-0004's numbers (137.5 km², inside the 100-150 km² band). No config change needed — stated
explicitly here (again) so a future run doesn't re-derive this from scratch a fifth time.

**Done — found and fixed a real, previously-undetected perf-budget bug, then grew coverage safely
on top of the fix:**
- **Regression guard first:** `node --check` on every non-vendored `src/3d/**/*.js` file plus
  `script.js`/`service-worker.js`, JSON-validated `manifest.json`/`assets_manifest.json`. All pass —
  no syntax errors going into this run.
- **Investigated the standing instruction's priority order** (syntax → blocking bugs → perf-budget
  overrun → memory leak → tech debt → missing regression test → low coverage → active-phase
  subtask → new feature) before picking a task, rather than defaulting straight to "grow coverage"
  (priority #7) or "next FAZ 2 item" (#8). While scoping *how* to grow World Coverage safely (the
  obvious next lever being `PHASE1_PREVIEW_RADIUS_CHUNKS`, per runs 2/3/5's own precedent), re-read
  `game3d.js`'s `createScene()` and found that **every prior run's "desktop-only" framing for this
  constant was aspirational documentation, never enforced code** — `chunkManager.loadSquare(0, 0,
  CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS)` runs unconditionally, with zero device branching
  anywhere in `src/3d/**` (confirmed by grep for `mobile`/`matchMedia`/`userAgent`/
  `maxTouchPoints`/`QUALITY_PRESETS` usage — only comments mentioned "mobile," no code read it). A
  real phone opening `game3d.html` today already loads the full 169-chunk desktop preview
  (~1.38M triangles, ~2.8x the mobile triangle budget) with no mitigation — a real, already-present
  performance-budget violation (priority #3), ranked above growing coverage further (#7). Fixed that
  before touching the radius, per the priority order.
- **Built the fix (DECISIONS.md ADR-0010):** `game3d.js` gained `isCoarsePointerDevice()`
  (`window.matchMedia('(pointer: coarse)').matches`, try/caught to `false` if `matchMedia` is
  unavailable). `createScene()` now picks `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` on
  desktop-class devices or the existing mobile-budget `CHUNK_CONFIG.STREAM_RADIUS_CHUNKS` on
  touch-primary ones, logging which path was taken and why. `(pointer: coarse)` was chosen over
  user-agent sniffing as the more reliable, spoof-resistant, directly-relevant signal (see ADR-0010
  for the full reasoning/alternatives).
- **Only once the mobile path was verified safe, grew the desktop-only radius** (this run's actual
  World Coverage improvement): `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` 6 → 8 (169 → 289 chunks,
  13x13 → 17x17), World Coverage 30.73% → **52.5%** (42.25 km² → 72.25 km² / 137.5 km²).
  Deliberately did **not** jump straight to the ~441-chunk (21x21) radius that would satisfy FAZ 3's
  80% coverage gate in one edit — no settlement exists yet, so hitting that gate via a pure config
  bump would be a hollow win; see ADR-0010's alternatives-considered for the full reasoning. 289
  chunks measures at 47% of the desktop triangle budget and 12% of the desktop draw-call budget —
  comfortable headroom remains for future runs.
- **Real smoke tests (headless Chromium via Playwright, repo served locally with
  `python3 -m http.server`), both device paths, not just the math:**
  1. Default (fine-pointer) context: console confirms `"Loaded 289 terrain chunks (~72.25 km²) in
     1365ms (desktop-class device — full preview radius)"`, zero page errors, screenshot confirms
     terrain/water/aurora sky all render correctly at the larger chunk count.
  2. Touch-emulated context (`hasTouch: true, isMobile: true`): confirmed
     `window.matchMedia('(pointer: coarse)').matches` reads `true` *inside the page* (the emulation
     genuinely flips the signal this code reads, not just the viewport size) — console confirms
     `"Loaded 25 terrain chunks (~6.25 km²) in 472ms (touch/mobile-class device — mobile-budget
     radius)"`, zero page errors, screenshot confirms the scene still renders correctly at the
     smaller chunk count.
  3. **Offline regression:** visited `index.html` then `game3d.html` online (SW install + both
     precache calls), then a fresh tab with the network disabled reloading `game3d.html` — loading
     overlay's hidden class present (full load succeeded), zero page errors. No new file was added
     this run, so no `service-worker.js` `GAME3D_SHELL_FILES` change was needed — verified this
     rather than assumed.
  4. **2D game regression:** `index.html` offline reproduced the same single, already-documented
     pre-existing `firebase is not defined` error from every prior run's Known Issues — confirmed
     unrelated, since this run touched only `src/3d/config.js` and `src/3d/game3d.js`, neither of
     which `index.html`/`script.js` depend on.

**Files changed this run:** `src/3d/game3d.js` (`isCoarsePointerDevice()` + device-branched preview
radius), `src/3d/config.js` (`PHASE1_PREVIEW_RADIUS_CHUNKS` 6 → 8, updated doc comment),
`DECISIONS.md` (new ADR-0010), `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file — World Coverage,
Current Status, Performance Budget Status, this section). Five files, well within this run's
≤20-files/≤800-lines budget; one atomic change (the mobile-safety fix and the coverage growth it
unblocked are a single reviewable/revertable unit — the growth wouldn't have been safe to make
without the fix landing in the same commit).

**Parallel work found on push, merged into this run:** `git push` was rejected — a parallel session
had pushed `5a99675` (`feat(3d): deterministic downhill river tracing over terrain's height field`,
run 10 above) to `main` while this run was in progress: `world/rivers.js`, `terrain.js`'s
`createHeightSampler`/`mulberry32` exports, and `game3d.js` wiring to trace and render one static
river. Merged with `git merge origin/main` (real conflicts in `3D_GAME_PROGRESS.md`/`DECISIONS.md`,
resolved by hand — `ARCHITECTURE.md`/`game3d.js`/`config.js` auto-merged cleanly, confirmed by
re-reading the merged `game3d.js` rather than assumed). Both changes touch `game3d.js`'s
`createScene()` but at disjoint spots (device-branched chunk radius vs. river-mesh generation) so
they composed without semantic conflict. The one real collision: **both runs independently claimed
"ADR-0009"** for their respective decisions (same date, parallel sessions) — resolved by keeping
the rivers ADR as ADR-0009 (it reached `origin/main` first) and renumbering this run's device-radius
ADR to **ADR-0010** everywhere it's referenced (`DECISIONS.md`, `3D_GAME_PROGRESS.md`,
`ARCHITECTURE.md`, `src/3d/config.js`, `src/3d/game3d.js`). Re-ran the full regression guard
(`node --check` on every non-vendored `src/3d/**/*.js` file + JSON validation) and the headless-
Chromium smoke test again post-merge, both device paths: zero errors, console confirms both `"Loaded
289 terrain chunks (~72.25 km²)"`/`"Loaded 25 terrain chunks (~6.25 km²)"` (device-branched radius,
this run's change) **and** `"River path traced: 11 points, ended via \"sea\""` (their change) in the
same boot sequence — the two features coexist correctly.

**Next step for the next run:** now that a real river exists (`world/rivers.js`, from the merged
run 10), the remaining FAZ 2 items are smaller than previously scoped: waterfalls (a steep-height-
drop detector walking the river's own path points, per run 10's "Next step" — no longer needs a
river concept designed from scratch) and volumetric light (god rays — separate, larger technique).
World Coverage is now 52.5% (72.25 km² / 137.5 km², up from 30.73% — unaffected by the river merge,
since rivers don't add chunk-covered area) — further growth remains legitimate (real headroom in
both the desktop triangle budget, 47% used, and the draw-call budget, 12% used) via either another
`PHASE1_PREVIEW_RADIUS_CHUNKS` bump (re-verify both device paths again, same as this run) or the
still-valid "scripted flythrough at boot" idea from run 2/3's notes (grows coverage by genuinely
streaming terrain rather than a bigger static preview — arguably the better long-term direction).
Either is legitimate; per this project's own rule, don't half-do both in one run. No new tech debt
introduced this run; one long-standing gap (mobile chunk-count safety) was closed instead of added
to.

## This Run (2026-07-29, run 12)

**Continuation of the same operator session** ("Devam et" / "continue" right after run 11's push).
Repo state already fresh in context (clean, `main` at `9a8f9fe`, run 11's device-radius fix +
merge-resolution docs already pushed) — re-checked with `git fetch origin main` anyway (no new
parallel work landed). Picked up run 11's own "Next step": waterfalls, now smaller in scope since
the merged run 10 already built a real river to walk.

**Done — FAZ 2 waterfalls, per run 11's recommended next step:**
- **Measured the real river's height profile before picking any threshold (BİLMEME KURALI):** wrote
  a scratch headless-Chromium script that imports the actual `createHeightSampler`/
  `generateRiverPath` and logs every segment's horizontal distance, vertical drop, and slope for the
  world's real seed-1337 river (11 points, reaching the sea). Result: eight segments drop under
  1.3m (≤3.2% grade — the river's ordinary gentle flow) while exactly two stand out: 2.61m/40m
  (6.5% grade) and 4.02m/40m (10.1% grade). This measured profile, not a guess, is what set this
  run's thresholds.
- **Design decision made and recorded before writing code (DECISIONS.md ADR-0011):** waterfalls are
  *detected*, not authored — `detectWaterfalls(points)` flags a river segment when both
  `dropMeters >= 2.5` and `slope >= 0.06` (sitting between the measured 8-segment "normal" cluster
  and the 2-segment "steep" cluster above). `createWaterfallMesh` renders each as a vertical
  "curtain" quad standing at the segment's horizontal midpoint, spanning the full vertical drop,
  reusing `createRiverMesh`'s `perpX`/`perpZ` orientation technique. Deliberately vertical rather
  than slanted to match the real (gently-sloped, non-cliff) terrain between the two points —
  `terrain.js`'s smooth FBM has no actual cliff faces, so this is an explicitly schematic
  "steep-section marker," not a physically-carved waterfall, consistent with `rivers.js`'s own
  established "find the shape, don't carve it" approach (ADR-0009).
- **Built directly into `world/rivers.js`** (`detectWaterfalls`, `createWaterfallMesh`,
  `disposeWaterfallMesh`) rather than a new file — waterfalls are a derived query over the same
  river-path data, not an independent world system. File grew from 205 to 316 lines, still well
  under the project's 600-line cap.
- **Wired into `game3d.js`:** right after generating the river, `detectWaterfalls(riverPoints).map
  (createWaterfallMesh)` builds the curtain meshes, all added to the scene and logged
  (`"Detected N waterfall-grade drop(s) along the river"`); disposed alongside the river mesh on
  `pagehide` (memory-leak checklist).
- **Regression guard:** `node --check` on `world/rivers.js`, `game3d.js`. Both pass.
- **Real smoke tests (headless Chromium):**
  1. Full `game3d.html` render pass — zero `pageerror`/`console.error`, console confirms `"Detected
     2 waterfall-grade drop(s) along the river"`, matching the calibration profiling exactly (not
     just "some number came back").
  2. **A dedicated broadside verification render** (separate scratch scene, real terrain chunks +
     real river + real waterfall mesh, source/mid markers, camera placed along the curtain's own
     face-normal direction — derived from `createWaterfallMesh`'s `perp`/vertical spanning vectors,
     not guessed): confirms the curtain renders at the correct location, correctly oriented
     (broadside when viewed along its normal, edge-on if viewed from the wrong axis — caught this
     distinction by trying the wrong camera axis first and correcting it), and reads as a modest,
     wide-but-short cascade (14m wide, 4m tall) — an honest consequence of this terrain's actual
     24m height budget, not a bug to paper over with a bigger/taller quad.
  3. Offline-precache and 2D-game regression tests — both still clean. No new file was added this
     run (`detectWaterfalls`/`createWaterfallMesh` live inside the already-precached
     `world/rivers.js`), so no `service-worker.js` change was needed — verified, not assumed.

**Files changed this run:** `src/3d/world/rivers.js` (`detectWaterfalls`/`createWaterfallMesh`/
`disposeWaterfallMesh` additions), `src/3d/game3d.js` (waterfall wiring + disposal),
`DECISIONS.md` (new ADR-0011), `ARCHITECTURE.md`, `src/3d/world/README.md`,
`3D_GAME_PROGRESS.md` (this file — Roadmap checklist, Known Issues, this section). Six files,
~220 new/changed lines — well within budget; one atomic addition (detection function + its visual
+ its wiring + its disposal, all one reviewable unit).

**Next step for the next run:** FAZ 2's remaining items: volumetric light (god rays — a separate,
larger technique, still not started) is now the only unchecked FAZ 2 roadmap item besides the
starfield. World Coverage unchanged at 52.5% (72.25 km² / 137.5 km² — this run added a geography
*detail*, not chunk-covered area). No new tech debt: waterfalls are static/non-streamed/
non-flow-animated by explicit, documented design choice (same profile as the river itself), not an
accidental gap. If a future run wants dramatically taller/more numerous waterfalls, that requires
`terrain.js` to actually generate steeper local relief (a real, separate change) — not a bigger
threshold or taller quad grafted onto this world's current rolling-hill terrain.

## This Run (2026-07-29, run 13)

**Continuation of the same operator session** ("Devam et" / "continue" right after run 12's push).
Repo state already fresh in context (clean, `main` at `dd6678b`, run 12's waterfall commit already
pushed) — re-checked with `git fetch origin main` anyway (no new parallel work landed). Picked up
run 12's own "Next step": between the two remaining FAZ 2 items, chose the starfield over
volumetric light — god rays are explicitly flagged in the roadmap as needing a real post-processing
pipeline (`EffectComposer`/render targets) this project doesn't have yet (that's FAZ 9's
`postfx.js` scope), so building it now would mean either half-building a postfx pipeline early or a
fragile fake; the starfield is self-contained and lower-risk, matching this project's own pattern
of preferring the smaller, well-scoped task when both remain.

**Done — FAZ 2 starfield, per run 12's recommended next step:**
- **Design decision made and recorded before writing code (DECISIONS.md ADR-0012):** a new
  top-level `src/3d/stars.js` (not folded into `sky.js`) adds a `THREE.Points` cloud of 1200 seeded
  points scattered across the upper hemisphere, re-centered on the camera every frame (same
  technique `sky.js`/`world/water.js` already use), opacity driven directly by `lighting.js`'s
  `nightFactor` — the same day/night gating `sky.js` already applies to its aurora. Carries its own
  self-contained `mulberry32` copy (XOR-tagged for an independent stream) rather than importing
  `world/terrain.js`'s, since stars are an atmosphere concern kept at the top `src/3d/` level, not a
  `world/` system — matches the target architecture's folder ownership.
- **Built `src/3d/stars.js`:** `createStarfield(seed)` / `updateStarfield(starfield,
  cameraPosition, nightFactor)` / `disposeStarfield(starfield)`. Built-in `PointsMaterial`
  (`sizeAttenuation: false`, `fog: false` — same reasoning `sky.js` gives for its own `fog: false`,
  stars sit "at infinity" and this world's night fog density would visibly (and wrongly) dim
  anything real positioned that far away), `renderOrder: -0.5` (after `sky.js`'s sphere at `-1`,
  before ordinary opaque scene geometry at the default `0`).
- **Wired into `game3d.js`:** star cloud added to the scene at boot, `updateStarfield()` called
  every render-loop tick right after `updateAuroraSky()`, `disposeStarfield()` called on
  `pagehide` alongside the existing cleanup chain.
- **`service-worker.js`:** added `./src/3d/stars.js` to `GAME3D_SHELL_FILES` — a new code-imported
  file must join the offline precache the moment it's added, per the rule established since run 5.
- **Regression guard:** `node --check` on `stars.js`/`game3d.js`/`service-worker.js`. All pass.
- **Real smoke tests (headless Chromium via Playwright):**
  1. Full `game3d.html` render pass: zero `pageerror`/`console.error` with the starfield wired into
     the full scene alongside every other system (terrain, water, river, waterfalls, sky, fog).
  2. **A unit-style sweep** (same technique runs 7/8 used for `lighting.js`/`fog.js`): drove
     `updateDayNightLighting`/`updateStarfield` directly across 20 samples spanning a full simulated
     day — confirmed `stars.material.opacity` exactly equals `dayNight.nightFactor` at every single
     sample (not just "some fade happens"), and that the point cloud actually re-centers on a given
     camera position.
  3. **A dedicated visual verification render** (a separate scratch canvas, since the real page's
     own `requestAnimationFrame` loop would otherwise immediately overwrite a one-off render to its
     canvas — caught this on the first attempt, when the screenshot showed the real running scene
     instead of the isolated test): forced `nightFactor = 1` and rendered the starfield alone —
     screenshot confirms hundreds of small white points scattered correctly across the upper half
     of the view only, nothing below the horizon.
  4. Offline-precache (verified fully offline after one online visit, including the new
     `stars.js` precache entry) and 2D-game regression tests — both still clean.

**Files changed this run:** `src/3d/stars.js` (new), `src/3d/game3d.js` (starfield wiring +
disposal), `service-worker.js` (`GAME3D_SHELL_FILES`), `DECISIONS.md` (new ADR-0012),
`ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file — Roadmap checklist, this section). Six files,
~200 new/changed lines — well within budget; one atomic addition (one new self-contained module +
its wiring + its disposal + its offline-cache entry).

**Next step for the next run:** FAZ 2's only remaining unchecked item is volumetric light (god
rays) — per this run's own reasoning above, that should wait for a real post-processing pipeline
(FAZ 9's `postfx.js` scope: `EffectComposer`, render targets, bloom/tonemapping/SSAO/DOF all live
there together) rather than being half-built in isolation now. A reasonable alternative next pick:
start FAZ 3 (Kaleler/Yerleşimler) instead, since FAZ 2's atmosphere work is now substantially
complete (water, day/night, fog, rivers, waterfalls, stars) and FAZ 3 has its own real subtasks
(`settlements.js`, PBR materials, LOD/colliders) independent of the postfx-gated god-rays item.
World Coverage unchanged at 52.5% (72.25 km² / 137.5 km² — this run added atmosphere polish, not
chunk-covered area; FAZ 3 cannot be marked DONE below 80% coverage, so coverage growth should be
revisited before or alongside FAZ 3's own close-out). No new tech debt: stars are a fixed,
non-twinkling pattern by explicit, documented design choice (flagged in ADR-0012's Consequence),
not an accidental gap.

## This Run (2026-07-29, run 14)

**Session Snapshot taken at start of run** (per protocol): repo started `HEAD` detached at `3ef056d`
(run 13's starfield commit) while local `main` was stale at `38e09e7` — the same recurring pattern
every prior run has hit. Fixed with `git fetch origin --prune && git checkout main && git merge
--ff-only origin/main` (35 commits fast-forwarded, confirmed `origin/main` was ahead, not the other
way around — no data loss). Read this file in full, `git log -10 --oneline`, DECISIONS.md's last 3
ADRs (ADR-0010/0011/0012), and `src/3d/config.js` directly.

**World-scale correction check (this run's explicit first instruction):** the operator's brief again
asserted the old 4278 km² target might still be live and asked for a fresh 100-150 km² recalculation.
Re-verified directly against `src/3d/config.js`: `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`,
`CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` are `25`/`22` — exactly ADR-0004's numbers (137.5 km², inside
the 100-150 km² band). No config change needed, same conclusion runs 3/4/5/7/9/11 already reached —
see the added note under Current Status above so a future run doesn't need to re-derive this a
seventh time from scratch.

**Regression guard first:** `node --check` on every non-vendored `src/3d/**/*.js` file plus
`script.js`/`service-worker.js`, JSON-validated `manifest.json`/`assets_manifest.json`. All pass — no
syntax errors going into this run.

**Picked FAZ 3 (Kaleler/Yerleşimler) as this run's task**, per the priority order: no blocking bugs/
perf overruns/memory leaks/missing regression tests were found in the snapshot above (World Coverage
was already reasonably high for FAZ 1/2's own gates), and FAZ 3 has real, well-scoped sub-tasks
independent of FAZ 2's one remaining item (volumetric light, correctly deferred to FAZ 9's postfx
groundwork per run 13's own reasoning — not revisited this run, still correctly blocked).

**Done — FAZ 3's first sub-task, kingdom-seat settlements:**
- **Measured before designing (BİLMEME KURALI):** wrote a scratch Node probe (real `WORLD_SCALE`/
  `createHeightSampler`, all 14 real `INIT_KINGDOMS` seats copied from `script.js`) to check whether
  any seat's real terrain height falls below sea level before writing any clamping logic. Result:
  all 14 sample above `WATER_LEVEL_METERS` (6m) — lowest is `jon` (Castle Black/the Wall) at exactly
  6.00m — and 5 of 14 fall outside even the desktop 17x17 boot-preview radius (all 14 fall outside
  the mobile radius). This measured profile, not a guess, is what shaped both the height-clamp
  safety net and the settlement-grounding design below.
- **Design decisions made and recorded before writing code (DECISIONS.md ADR-0013):** a new
  `src/3d/world/settlements.js` — `KINGDOM_SEATS` (a hand-copied, frozen `INIT_KINGDOMS` snapshot,
  position/color/name only, explicitly *not* a live `script.js` import — see ADR-0013 for the real
  risk that would pose to the 2D game), `mapToWorldXZ()` (a new map->world coordinate convention:
  the padded kingdom bounding box's center maps to the world origin, matching the chunk grid's own
  origin), and `createSettlements()`/`disposeSettlements()` building 3 `InstancedMesh`es (keep/
  tower/roof — one draw call per *part*, not per castle) covering all 14 seats, roofs colored per-
  kingdom via `setColorAt`. New `SETTLEMENT_CONFIG` in `config.js` holds every castle dimension (no
  magic numbers in `settlements.js` itself).
- **Wired into `game3d.js`:** settlements created and added to the scene right after the river/
  waterfalls, disposed on `pagehide` alongside the existing cleanup chain (memory-leak checklist).
- **Found and fixed a real mobile perf-budget bug within this same run, before commit:** the first
  version force-loaded a 3x3 terrain-chunk neighborhood under every seat unconditionally, so each
  castle would have visible ground beneath it. Before adding the device-mobile smoke test, this
  measured out to **92 extra chunks (~753K triangles) on the mobile path alone — 1.9x the entire
  mobile triangle budget by itself**, on top of the mobile boot preview's own 25 chunks. Caught by
  this run's own headless-Chromium mobile smoke test (same touch-emulated context ADR-0010
  established), not shipped and fixed later. Fixed by gating the forced-grounding loop on the same
  `isCoarsePointerDevice()` check `game3d.js` already has: desktop-class devices force-ground every
  seat (289 → 321 resident chunks), mobile-class devices skip it (stays at the existing 25-chunk
  preview; settlements still placed at the correct real height, just occasionally without visible
  ground directly beneath, until a later phase's player-streaming reaches that chunk). See
  DECISIONS.md ADR-0013 for the full writeup.
- **`service-worker.js`:** added `./src/3d/world/settlements.js` to `GAME3D_SHELL_FILES`.
- **Regression guard:** `node --check` on `settlements.js`/`game3d.js`/`config.js`/
  `service-worker.js`. All pass.
- **Real smoke tests (headless Chromium via Playwright, repo served locally with
  `python3 -m http.server`):**
  1. Full `game3d.html` render pass, both device paths (default + touch-emulated `hasTouch: true,
     isMobile: true`): zero `pageerror`/`console.error` on either. Desktop console confirms `"Placed
     14 kingdom-seat settlements; 321 terrain chunks resident (~80.25 km²) after grounding them"`;
     mobile console confirms `"Placed 14 kingdom-seat settlements; 25 terrain chunks resident (~6.25
     km²) (mobile — grounding skipped, see ADR-0013)"` — the fix verified on both paths, not just
     computed.
  2. **A dedicated close-up verification render** (separate scratch canvas + isolated scene, same
     technique ADR-0009/ADR-0011/ADR-0012 used for river/waterfall/star verification — the real
     page's own `requestAnimationFrame` loop would otherwise overwrite a one-off render to the real
     canvas, so `#game3d-canvas` was removed before creating an isolated one): loaded the real 3x3
     terrain neighborhood under seat `umit` (Targaryen), rendered the real `createSettlements`
     output there — screenshot confirms a stone-gray keep + 4 corner towers with orange (`#c8430a`,
     matching `INIT_KINGDOMS`'s own `umit.color`) conical roofs, correctly seated on the real
     terrain, not floating or misaligned.
  3. Offline-precache (new file added to `GAME3D_SHELL_FILES`, one online visit then a fresh
     tab/context with the network disabled — `game3d.html` still loads with the same `[game3d]`
     console log sequence, zero errors) and 2D-game regression tests (`index.html` still reproduces
     only the same pre-existing, already-documented `firebase is not defined` error) — both clean.

**Files changed this run:** `src/3d/world/settlements.js` (new), `src/3d/config.js`
(`SETTLEMENT_CONFIG`), `src/3d/game3d.js` (settlements wiring, disposal, device-branched grounding),
`service-worker.js` (`GAME3D_SHELL_FILES`), `DECISIONS.md` (new ADR-0013), `ARCHITECTURE.md`,
`src/3d/world/README.md`, `3D_GAME_PROGRESS.md` (this file). Eight files, ~330 new/changed lines —
within this run's ≤20-files/≤800-lines budget; one atomic addition (new module + its config
constants + its wiring + its device-safety fix + its offline-cache entry + its docs, all landing
together since the growth wouldn't have been mobile-safe without the fix in the same commit).

**Next step for the next run:** FAZ 3's remaining sub-tasks are PBR materials/textures (current
castles are flat-color `MeshStandardMaterial`, no texture maps) and simple LOD/colliders (not
attempted — no player exists yet to collide with anything, and castles are cheap enough that LOD
isn't a measured need yet). World Coverage is now 58.4% (80.25 km² / 137.5 km²) on desktop — still
below FAZ 3/10's 80% gate, so further growth (another `PHASE1_PREVIEW_RADIUS_CHUNKS` bump, re-
verified on both device paths, or the still-valid "scripted flythrough at boot" idea from runs 2/3)
remains legitimate future work, alongside or after FAZ 3's remaining items. No new tech debt beyond
what's flagged below (PBR/LOD/collider gaps were pre-existing FAZ 3 scope, not introduced this run).

## This Run (2026-07-29, run 15)

**Session Snapshot:** read this file, `git log -10`, `DECISIONS.md`'s last 3 ADRs (ADR-0012/0013 and
the settlements consequence), and `ARCHITECTURE.md` (>7 days rule doesn't apply yet — project is
one day old real-time, but every prior run's docs were re-read anyway per the standing instruction).
`node --check` across every non-vendor `.js` file: clean, zero syntax errors.

**World-scale correction task (this run's stated top priority) — verified already done, nothing to
fix:** the instruction's premise (an old "4278 km²" target still on record somewhere) does not match
this codebase's actual state. `config.js`'s `WORLD_SCALE.METERS_PER_MAP_UNIT` has been 1.75 (not
ADR-0001's original 10) since ADR-0003/ADR-0004, giving the same ~129.8 km² real-bounds / 137.5 km²
grid-nominal world every run since has used — squarely inside the 100-150 km² band this instruction
re-stated. Run 14's own commit message already re-confirmed this identical fact one run ago. No
`config.js`/chunk-constant edit was needed for the scale itself; re-derived from source directly
this run (not assumed from the doc) to be sure, cross-checked against `DECISIONS.md` ADR-0004/
ADR-0013 and found identical.

**Picked "grow World Coverage toward the FAZ 3/10 80% gate" as this run's task**, per the priority
order: zero syntax errors, zero blocking bugs, desktop performance budget had real headroom (52.6%
triangles / 13% draw calls at the time), zero new memory leaks, zero missing regression coverage —
with those clear, priority #7 (World Coverage still below the FAZ 3/10 80% gate) outranks starting a
new FAZ 3 sub-task (PBR/LOD, priority #8), and is exactly what run 14's own "Next step" flagged as
legitimate work.

**Done:**
- Computed the smallest `PHASE1_PREVIEW_RADIUS_CHUNKS` that would put every one of the 14 real
  `KINGDOM_SEATS`' center chunk inside the desktop boot-preview square, via a real script against
  `mapToWorldXZ`/`WORLD_SCALE.MAP_BOUNDS` (not guessed) — **10** (up from 8), verified budget
  headroom at that radius first (441 chunks × 8192 triangles ≈ 3.61M, still under the 5M desktop
  ceiling with room for settlements/water/sky/river on top; a radius of 12 would have exceeded it on
  terrain alone).
- Changed exactly one constant: `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` 8 -> 10 in `config.js`,
  with an updated doc comment. No other file's logic changed — `STREAM_RADIUS_CHUNKS` (mobile path)
  and the settlement-grounding loop are untouched, so this is a desktop-only change by construction,
  not by a new branch.
- **Real smoke tests (headless Chromium via Playwright, repo served locally with
  `python3 -m http.server`):**
  1. Desktop-viewport pass: console confirms `"Loaded 441 terrain chunks (~110.25 km²)"` then
     `"Placed 14 kingdom-seat settlements; 444 terrain chunks resident (~111.00 km²) after grounding
     them"` — 444, not 441, because the Night King seat's grounding neighborhood pokes 3 chunks past
     the square's edge (predicted from the bounding-box computation, then confirmed, not just
     assumed). Zero `pageerror`/`console.error`.
  2. Touch-emulated pass (`hasTouch: true, isMobile: true`): unchanged at `"Loaded 25 terrain chunks
     (~6.25 km²)"` / `"25 terrain chunks resident ... (mobile — grounding skipped)"` — confirms the
     change never reaches the mobile code path. Zero `pageerror`/`console.error`.
  3. 2D-game regression (`index.html`): same pre-existing, already-documented `firebase is not
     defined` / sandbox-network-blocked errors as every prior run — nothing new introduced.
- Updated `DECISIONS.md` (new ADR-0014), this file's **World Coverage** and **Performance Budget
  Status** sections (new 80.7%/111.00 km² desktop figures, new draw-call/triangle totals, and the
  narrowing-headroom note below).

**Files changed this run:** `src/3d/config.js` (one constant + its doc comment), `DECISIONS.md` (new
ADR-0014), `3D_GAME_PROGRESS.md` (this file). Three files, ~1 new/changed line of actual code plus
docs — far under this run's ≤20-files/≤800-lines budget; deliberately not padded with unrelated
work just because the budget allows more, per the project's own "don't write more code than the
task needs" rule.

**Next step for the next run:** FAZ 3's coverage *gate* is now clear on desktop (80.7%), but FAZ 3
itself is still open — PBR materials/textures and simple LOD/colliders are its two remaining
sub-tasks (unchanged scope from run 14, not attempted this run either; still no player to justify
colliders/LOD, and this run's task was coverage, not settlement polish). Triangle budget is now the
tighter constraint (73.4% used, 26.6% headroom) — a future run should not keep bumping
`PHASE1_PREVIEW_RADIUS_CHUNKS` as a free lever; the next meaningful jump in raw terrain radius would
need chunk-geometry merging or LOD first, not just a bigger number. Mobile coverage (4.5%) remains
far below any comparable gate for that path, but no gate currently keys off the mobile number
specifically — revisit if that becomes a real requirement. No new tech debt.

## This Run (2026-07-29, run 16)

**Session Snapshot:** read this file, `git log -10 --oneline`, `DECISIONS.md`'s last 3 ADRs
(ADR-0013/0014 and the settlements/coverage consequences). `node --check` across every non-vendor
`.js` file: clean, zero syntax errors. Repo was on a detached `HEAD` at session start (37 commits
behind `origin/main`, all already-merged prior-run history) — checked out `main` and fast-forwarded
before doing anything else, not a real divergent-work conflict.

**World-scale correction task (this run's stated top priority) — verified already done, nothing to
fix, for the eighth straight run:** re-derived `WORLD_SCALE.METERS_PER_MAP_UNIT` (1.75) and
`CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` (25x22) directly from `config.js`, computed 25 x 22 x 0.25
km²/chunk = 137.5 km² by hand — squarely inside the 100-150 km² band, identical to every run since
ADR-0004. No `config.js` edit made for the scale itself.

**Picked FAZ 3's "PBR malzemeler" sub-task as this run's task**, per the priority order: zero
syntax errors, zero blocking bugs, FAZ 3/10's 80% desktop coverage gate already clear (80.7%, from
run 15), zero new memory leaks, zero missing regression coverage — with those clear, priority #8
(the active phase's remaining sub-task) was next. Of FAZ 3's two open sub-tasks, textures (not
LOD/colliders) was the legitimate one to build: no player exists until FAZ 4, so a collider has
nothing to collide with yet, and LOD has no measured need (settlements are already only 3 draw
calls / ~2,520 triangles, nowhere near budget) — see DECISIONS.md ADR-0015 for the full reasoning.

**Done:**
- Added `src/3d/world/materials.js` (new, 246 lines): `createStoneMaterial`/`createRoofMaterial`
  build seeded canvas-generated PBR maps (`mulberry32`-seeded, reused from `terrain.js`, not
  reimplemented) — one shared height field drives a mortared-stone-block color map, a roughness
  map, and a real gradient-derived normal map for the keep/tower material; a shingle-row color +
  roughness pair for the roof material. `disposeCastleMaterial` disposes a material's own maps plus
  itself (three.js doesn't do this automatically on `material.dispose()`).
- `world/settlements.js`: replaced the two flat-color `MeshStandardMaterial`s with
  `createStoneMaterial`/`createRoofMaterial` calls; `createSettlements` now takes a required `seed`
  option; repeat counts (`stoneRepeat`/`roofRepeat`) computed from `SETTLEMENT_CONFIG`'s real
  meters, not hardcoded; `disposeSettlements` dedupes the keep/tower's shared material through a
  `Set` before calling the new `disposeCastleMaterial`.
- `game3d.js`: passes `seed: WORLD_DEFAULTS.WORLD_SEED` into `createSettlements` (one line).
- `service-worker.js`: added `./src/3d/world/materials.js` to `GAME3D_SHELL_FILES`, same pattern
  every prior new 3D file has followed — offline precache would otherwise silently miss it.
- `world/README.md`: documented the new `materials.js` module and `createSettlements`'s new `seed`
  parameter.
- **Real smoke tests (headless Chromium via Playwright, repo served locally with
  `python3 -m http.server`):**
  1. A scratch texture-preview page (written this run to visually verify the maps, deleted before
     commit — `git status` confirms it's not in the diff) rendered one real castle from
     `createSettlements` close-up: screenshot shows genuine mortared-stone-block depth from the
     normal map (not flat per-block color) and a roof correctly tinted by the seat's house color
     multiplied over the shingle shading. Zero console errors.
  2. Desktop-viewport pass on the real `game3d.html`: console confirms `"Loaded 441 terrain chunks
     (~110.25 km²)"` then `"Placed 14 kingdom-seat settlements; 444 terrain chunks resident
     (~111.00 km²)"` — identical counts to run 15 (materials-only change, no geometry/placement
     change). Zero `pageerror`/`console.error`.
  3. Touch-emulated pass (`hasTouch: true, isMobile: true`): unchanged at `"Loaded 25 terrain
     chunks (~6.25 km²)"`. Zero `pageerror`/`console.error`.
  4. Offline-precache regression: visited `index.html` online first (the page that actually calls
     `serviceWorker.register` — `game3d.html` alone never registers it), confirmed via
     `caches.open('westeros-shell-v1')` that `./src/3d/world/materials.js` is now cached, then set
     the browser context offline and loaded `game3d.html` directly — loaded fully, zero page
     errors.
  5. 2D-game regression (`index.html`): same pre-existing, already-documented sandbox-only
     `firebase is not defined` / blocked-network-request errors as every prior run — nothing new.
- Updated `DECISIONS.md` (new ADR-0015), this file's **Current Status**, FAZ 3 roadmap checklist,
  and Known Issues (this section).

**Files changed this run:** `src/3d/world/materials.js` (new), `src/3d/world/settlements.js`,
`src/3d/game3d.js`, `service-worker.js`, `src/3d/world/README.md`, `DECISIONS.md`,
`3D_GAME_PROGRESS.md` (this file). Seven files, ~250 new lines (`materials.js`) plus small edits to
the rest — well under this run's ≤20-files/≤800-lines budget.

**World Coverage:** unchanged at 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
137.5 km²) — this run changed materials only, not chunk geometry or settlement placement.

**Next step for the next run:** FAZ 3's only remaining sub-task is simple LOD/colliders — still
correctly deferred until FAZ 4 gives the world a player to justify either (a collider with nothing
to collide with, or LOD tuned against a camera that doesn't exist yet, would both be speculative
work against this project's own "don't build for hypothetical future requirements" rule). Once FAZ
4 lands a real player and camera, LOD/colliders becomes real, measurable work — until then, the
next legitimate FAZ 3 work is exhausted and a future run should either start FAZ 4 (Oynanabilir
Karakter — `peasant_girl.fbx` and its idle/walking/running clips are ready, `FBXLoader` still needs
vendoring first, per Known Issues) or, if performance/coverage priorities resurface first, follow
the existing priority order. No new tech debt.

## This Run (2026-07-29, run 17)

**Session Snapshot taken at start of run** (per protocol):
- Read this file, `git log -10 --oneline`, DECISIONS.md's last 3 ADRs (ADR-0013/0014/0015).
- **Git issue found and fixed (same recurring pattern as every prior run):** session started with
  `HEAD` detached at `58878d3` while local `main` was stale at `38e09e7` (38 commits behind).
  `git fetch origin main` confirmed `origin/main` already had everything (no data loss); `git
  checkout main && git merge --ff-only origin/main` fast-forwarded cleanly.
- **This run's brief re-asserted the old, already-superseded "4278 km²"/"5-15m per unit" world-scale
  target and told this run to fix it "back" to 100-150 km².** Re-derived from `src/3d/config.js`
  directly rather than trusting the brief (same skepticism every prior run since run 3 has applied):
  `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`, 25x22 grid, 137.5 km² — already inside the
  requested 100-150 km² band, exactly matching ADR-0004. **No config change made** — the brief's
  premise was stale, not the codebase. This is now independently re-confirmed across 9 runs (3, 4,
  5, 7, 9, 11, 14, 15, 16, 17); see Current Status above for the standing note to future runs.
- FAZ 3's only remaining sub-task (LOD/colliders) is still correctly deferred until a player
  exists. With every higher-priority item (syntax/bugs/perf/leaks/debt/tests/coverage) already
  clear, the active-phase sub-task is FAZ 4 itself — this run started it.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 16).

**Done:**
- **Vendored `FBXLoader.js`** (three.js r160, same `unpkg.com/three@0.160.0` pin as every other
  vendored addon) plus its two transitive dependencies discovered by actually reading the fetched
  source rather than assuming: `libs/fflate.module.js` (zlib inflate for compressed FBX binary
  blocks) and `curves/NURBSCurve.js` + `curves/NURBSUtils.js` (NURBS-curve deformers). All four
  `node --check` clean.
- **`assetLoader.js`:** added `loadFBXModel(url)` (lazy dynamic-import, same L1-silent-fallback
  pattern as the existing `loadModel`) and its backing `_getFBXLoader()`.
- **New `src/3d/physics.js`** (`createGroundCollider(seed)`) — thin wrapper around
  `world/terrain.js`'s `createHeightSampler`, so gameplay code depends on "physics", not a
  world-generation internal. `game3d.js` now builds one `groundCollider` and feeds it to
  `world/rivers.js`/`world/settlements.js` too (previously each built its own local
  `sampleHeightMeters` — now one shared instance, numerically identical output, confirmed by
  identical river/waterfall/settlement counts in the smoke test below).
- **New `src/3d/input.js`** (`KeyboardInput`) — WASD/arrow keys + Shift-to-run, exposing
  camera-agnostic `{forward, strafe, running}` axes.
- **New `src/3d/gameplay/player.js`** (`createPlayer`, + `gameplay/README.md`) — loads
  `peasant_girl.fbx` + its three animation clips, corrects Mixamo's centimeter-scale export via the
  FBX's own `unitScaleFactor` (not a hardcoded `0.01` guess), snaps to `physics.js`'s ground height
  every step, turns to face its movement heading, crossfades idle/walking/running off real speed.
- **`camera.js`:** `createOrbitCamera` now accepts `{minDistance, maxDistance}` overrides.
  `game3d.js` passes FAZ-4-appropriate tight limits (3-40m) instead of the Phase-1 dev-preview
  defaults (20-1800m).
- **`game3d.js` wiring:** creates `KeyboardInput` + awaits `createPlayer(...)` after the rest of the
  scene (keeps the loading overlay up for the ~6MB of character/animation downloads too — no
  half-loaded pop-in), frames the camera behind/above the player, disables `OrbitControls`'
  free-pan (meaningless now that the target is player-driven), and each tick: reads input axes,
  computes a camera-relative world-space move direction (`computeCameraRelativeMove`, kept in
  `game3d.js` so `gameplay/player.js` stays camera-agnostic), updates the player, and chases with
  the camera.
- **Real bug found and fixed via this run's own headless-browser test, not shipped:** the first
  chase-camera version only moved `controls.target` to the player's position each frame. A
  screenshot after 1.5s of held-W movement showed the character visibly shrinking into the
  distance — the camera never moved. Root cause (confirmed by reading the vendored
  `OrbitControls.js` source, not guessed): `update()` computes `offset = camera.position - target`
  fresh every call, so moving `target` alone cancels itself out — the resulting camera position is
  unchanged, only its look-at direction changes. Fixed by translating **both**
  `camera.position` and `controls.target` by the player's per-frame position delta before calling
  `update()`. Re-tested: character now stays consistently framed across a 4s run + 2s strafe
  sequence, and a subsequent mouse-drag still correctly orbits the camera around the (moving)
  player. See DECISIONS.md ADR-0016 for the full writeup.
- **`elapsedSeconds` refactor:** the tick loop now calls `clock.getDelta()` once per frame (needed
  for movement/animation) and accumulates it itself, replacing the separate `clock.
  getElapsedTime()` call every existing day-night/water/aurora consumer read from — avoids two
  clock-reads fighting over the same internal bookkeeping. Numerically equivalent for every
  existing consumer (confirmed: identical day/night, fog, water, aurora, and starfield behavior in
  the smoke test, no visual change).
- **`service-worker.js`:** `GAME3D_SHELL_FILES` gained every new code file this run added, plus —
  for the first time — actual binary assets: `peasant_girl.fbx` and its 3 animation clips, now that
  FAZ 4 code really fetches them (every prior run's "no character assets precached yet" note no
  longer applies to this specific character).
- **Regression guard:** `node --check` on every non-vendored `.js` file (`script.js`,
  `service-worker.js`, all of `src/3d/**` except `vendor/`) plus the 4 newly vendored files; JSON-
  validated `manifest.json`/`assets_manifest.json`. All pass.
- **Real smoke tests (headless Chromium/Playwright), not assumed correct from the code alone:**
  1. Desktop boot: zero `pageerror`/`console.error`. Console confirms unchanged
     `"...444 terrain chunks resident (~111.00 km²)..."` and a new
     `"...player spawned at (0.0, 20.8, 0.0)."` — a real, ground-sampled spawn height, not 0.
  2. Movement: held W 1.5s (caught the chase-camera bug above); after the fix, held Shift+W 4s
     then A 2s then idle 1s — character stays consistently framed throughout, confirming the fix
     and that running/strafing/idle-return and animation-state switching all work without errors.
  3. Orbit-drag after movement: a left-mouse-drag visibly rotates the view around the (moved)
     player while keeping her centered — confirms user camera control still works on a chase-cam.
  4. Touch-emulated pass (`hasTouch: true, isMobile: true`): unchanged `"Loaded 25 terrain chunks
     (~6.25 km²)"` / `"...grounding skipped..."`, player still spawns correctly, zero errors.
  5. Offline-precache regression: visited `index.html` online, confirmed via `caches.open` that
     every new file (including the FBX/animation binaries themselves) is cached, went offline,
     loaded `game3d.html` fresh — loaded fully (overlay hid, meaning the player finished loading
     from cache), zero errors.
  6. 2D-game regression (`index.html`): same pre-existing, already-documented sandbox-only
     `firebase is not defined`/blocked-network/404 errors as every prior run — nothing new.
- Updated `DECISIONS.md` (new ADR-0016), `ARCHITECTURE.md` (new entries for `physics.js`,
  `input.js`, `gameplay/player.js`, `gameplay/` folder; updated entries for `assetLoader.js`,
  `config.js`, `camera.js`, `game3d.js`), this file's Current Status/FAZ 4 checklist/World Coverage
  (this section).

**Files changed this run:** `src/3d/vendor/three/addons/loaders/FBXLoader.js` (new, vendored),
`src/3d/vendor/three/addons/libs/fflate.module.js` (new, vendored),
`src/3d/vendor/three/addons/curves/NURBSCurve.js` (new, vendored),
`src/3d/vendor/three/addons/curves/NURBSUtils.js` (new, vendored), `src/3d/assetLoader.js`,
`src/3d/config.js`, `src/3d/camera.js`, `src/3d/game3d.js`, `src/3d/physics.js` (new),
`src/3d/input.js` (new), `src/3d/gameplay/player.js` (new), `src/3d/gameplay/README.md` (new),
`service-worker.js`, `DECISIONS.md`, `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). ~380
hand-written new lines (vendored files excluded from that count, same convention every prior run
vendoring an addon has used — see e.g. run 6's `OrbitControls.js`), 15 files — within this run's
≤800-line/≤20-file budget. One commit (the whole FAZ 4 first slice is one atomic, revertable unit —
splitting the vendoring/physics/input/player/camera-wiring apart would leave intermediate commits
that don't actually run).

**World Coverage:** unchanged at 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
137.5 km²) — this run added a player, not new terrain.

**Next step for the next run:** FAZ 4's two still-open items are real, scoped sub-tasks: (a) a
touch joystick for mobile input (`input.js` currently keyboard-only; mobile still can't be tested
for real in this sandbox — see Known Issues, so build it carefully against the emulated
`hasTouch`/`isMobile` context the same way ADR-0010's mobile branch was verified), and (b) camera
wall-avoidance raycasting (the chase-cam can currently clip through terrain/castles at some orbit
angles — not yet observed as a problem in testing, since the player spawns in open terrain, but
will become one once the player walks near a castle or a steep slope). Neither blocks moving on:
once FAZ 4's core loop (this run) is felt to be "enough" for now, FAZ 5 (NPC) becomes viable to
start, reusing `gameplay/player.js`'s FBX-loading/retargeting pattern for the 6 already-downloaded
Mixamo characters. No new tech debt; the two open items above are honest, flagged gaps, not
accidental ones.

## This Run (2026-07-29, run 18)

**Session Snapshot taken at start of run** (per protocol):
- Read this file, `git log -10 --oneline`, DECISIONS.md's last 3 ADRs (ADR-0014/0015/0016).
- **Git issue found and fixed, same recurring pattern as runs 5/17 — this time worse (main was
  18 runs behind, not one):** session started with `HEAD` detached at `d9a3260` (run 17's own
  final commit) while local `main`/`origin/main` were both still at `38e09e7`, the commit from
  *before* any 3D-mode work existed. Since `main` was a strict ancestor of `d9a3260`, `git checkout
  main && git merge d9a3260 --ff-only` fast-forwarded losslessly; a subsequent `git fetch origin
  main` showed `origin/main` already matched (the previous run's push had actually succeeded —
  only this container's local `origin/main` tracking ref was stale before fetching, not a real
  divergence). No commits rewritten/discarded. See Current Status above for the standing note.
- The operator's brief again asserted the old "4278 km²"/"5-15m per unit" target needs fixing "to"
  100-150 km². Re-derived from `src/3d/config.js` directly (not the brief) per the now-10-run-old
  standing skepticism rule: `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`, 25x22 grid, 137.5 km² —
  already correct, matching ADR-0004. No config change made.
- `node --check` clean on every non-vendor `.js` file (baseline, before any edits this run).
- **Ran a full regression smoke test (Playwright/headless Chromium) before writing any new code**,
  per the Regression Guard — 2D game, 3D desktop, 3D mobile-emulated, and service worker all
  passed with zero new errors (only the same pre-existing, already-documented sandbox network
  limitations on the 2D side). Confirmed run 17's player/FBX/chase-camera work is stable before
  building anything on top of it.
- With syntax/bugs/perf/leaks/debt/world-scale/coverage all clear, the highest-priority remaining
  item was FAZ 4's own still-open sub-task closest to a real blocking bug (not just cosmetic): a
  touch-primary device could load and see the player (confirmed run 17) but had **no way to move
  it at all** — `input.js` is keyboard-only. Camera wall-avoidance (FAZ 4's other open item) stays
  a visual-clipping gap, not a "some device class simply can't play" gap, so it's lower priority.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 17).

**Done:**
- **New `src/3d/ui/` folder** (the target architecture's `ui/` bucket, first populated this run)
  plus `ui/README.md` (ownership/conventions, same style as `gameplay/README.md`).
- **New `src/3d/ui/touchJoystick.js`** (`TouchJoystick`) — on-screen virtual joystick via Pointer
  Events (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`, `setPointerCapture`), appends its
  own base+knob DOM to `document.body`, exposes `getAxes()` in the same `{forward, strafe, running}`
  shape `KeyboardInput` uses (continuous here, not discrete). `dispose()` removes DOM + listeners.
- **New `TOUCH_JOYSTICK_CONFIG`** (`config.js`): `RADIUS_PX` (50), `DEADZONE_RATIO` (0.15),
  `RUN_THRESHOLD_RATIO` (0.75) — push-to-edge-to-run, no separate run button needed.
- **`game3d.js` wiring:** instantiates a `TouchJoystick` only when `isCoarsePointerDevice()` is
  true (same signal `createScene()` already uses for the mobile chunk-radius split); new
  module-local `combineAxes(keyboardAxes, joystickAxes)` sums forward/strafe (clamped to [-1, 1])
  and ORs `running`, falling back to keyboard axes unchanged when no joystick exists (desktop);
  disposed on `pagehide` alongside the existing keyboard/player/controls teardown.
- **`game3d.css`:** joystick base/knob styles, bottom-left with `env(safe-area-inset-*)` padding
  (matching `.g3d-back-link`'s existing top-left safe-area convention).
- **`input.js`'s doc comment updated** to point at `ui/touchJoystick.js` instead of describing
  touch input as "not yet built."
- **`service-worker.js`:** `GAME3D_SHELL_FILES` gained `./src/3d/ui/touchJoystick.js`.
- **Regression guard:** `node --check` clean on `config.js`, `input.js`, `game3d.js`, the new
  `ui/touchJoystick.js`, `service-worker.js`.
- **Real smoke tests (headless Chromium/Playwright), not assumed correct from the code alone:**
  1. Pre-change baseline (see Session Snapshot above): full regression pass, zero new errors.
  2. Mobile-emulated (Pixel 5, `hasTouch`/`isMobile`) post-change: `.g3d-joystick-base` DOM
     present; a simulated drag from the base's center 45px "up" (Pointer Events treat a mouse drag
     identically to a touch drag) updated the knob's `transform` to `translate(0px, -45px)`
     mid-drag; before/during screenshots differ (both MD5 and file size changed), confirming the
     chase camera actually moved — the player walked/ran, not just a static knob graphic. Releasing
     the pointer reset the knob's `transform` to empty (cleanup confirmed). Zero console/page
     errors.
  3. Desktop (default Playwright context, fine pointer/no touch): `.g3d-joystick-base` is absent
     — confirms `isCoarsePointerDevice()` correctly gates it off and desktop is unaffected. Zero
     errors.
  4. Offline precache check: after one online visit to `index.html` (registers the service
     worker), `caches.open('westeros-shell-v1')` contains `./src/3d/ui/touchJoystick.js` —
     confirms no 404 on a subsequent offline visit to `game3d.html`.
- Updated `DECISIONS.md` (new ADR-0017), `ARCHITECTURE.md` (new `ui/touchJoystick.js` and `ui/`
  folder entries; updated `config.js`, `input.js`, `game3d.js` entries), this file's Current
  Status/World Coverage/Known Issues and this section.

**Files changed this run:** `src/3d/ui/touchJoystick.js` (new), `src/3d/ui/README.md` (new),
`src/3d/config.js`, `src/3d/game3d.js`, `src/3d/input.js`, `game3d.css`, `service-worker.js`,
`DECISIONS.md`, `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). ~140 hand-written new lines,
10 files — comfortably within this run's ≤800-line/≤20-file budget. One commit (the joystick
module, its config, and its `game3d.js` wiring are one atomic, revertable unit — none of the
pieces are independently useful without the others).

**World Coverage:** unchanged at 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
137.5 km²) — this run added input, not terrain.

**Next step for the next run:** FAZ 4's only still-open item now is camera wall-avoidance
raycasting (the chase-cam can clip through terrain/castles at some orbit angles — not yet observed
as an actual visible problem, since the player still spawns/moves mostly in open terrain, but will
become one once the player walks near a settlement or a steep slope). Once that's judged "enough"
for FAZ 4 (it's a polish item, not a blocking gap — the core playable-character loop is fully
functional on both desktop and mobile input now), FAZ 5 (NPC) becomes the next viable phase,
reusing `gameplay/player.js`'s FBX-loading/retargeting pattern for the 6 already-downloaded Mixamo
characters. No new tech debt this run.

## This Run (2026-07-29, run 19)

**Session Snapshot taken at start of run** (per protocol):
- Read this file, `git log -10 --oneline`, DECISIONS.md's last 3 ADRs (ADR-0016/0017, this file's
  Known Issues). `git status`/`git branch` showed `HEAD` detached at `68072ab` (run 18's own final
  commit) — the same recurring pattern flagged in runs 5/17/18's snapshots, though milder this
  time. A stale local `origin/main` tracking ref (from before this container's `git fetch`) made it
  briefly look like `main` was 42 commits behind; `git fetch origin main` immediately showed
  `origin/main` already at `68072ab` (the push had genuinely succeeded — only the local ref cache
  was stale), so `git branch -f main origin/main && git checkout main` was a safe, lossless
  fast-forward with nothing to merge or rewrite. Flagging again for a future run: check the *fetched*
  `origin/main`, not the pre-fetch cached one, before concluding `main` is actually behind.
- **World scale re-derived from `src/3d/config.js` directly (not the operator brief), per the
  now-eleven-run-old standing skepticism rule:** `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`,
  `CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` are `25`/`22` → 137.5 km² grid-nominal — already inside
  the requested 100-150 km² band, exactly matching ADR-0004. **No config change made** — the brief's
  restated "4278 km²"/"5-15m per unit" premise does not match the repository's actual state, same
  conclusion runs 3/4/5/7/9/11/14/15/16/17/18 already reached.
- `node --check` clean on every non-vendor `.js` file (baseline, before any edits this run).
- **Ran a full regression smoke test (Playwright/headless Chromium) before writing any new code**,
  per the Regression Guard — 2D game (only the same pre-existing, already-documented sandbox
  network limitations — `firebase is not defined`, blocked external requests, nothing new), 3D
  desktop (441→444 terrain chunks after settlement grounding, 14 settlements, river/waterfalls,
  zero errors), 3D mobile-emulated (25 chunks, mobile-budget path, zero errors) all passed clean.
  Confirmed run 18's touch-joystick work is stable before building on top of it.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 18).
- With syntax/bugs/perf/leaks/debt/world-scale/coverage all clear (coverage is already past FAZ
  3/10's 80% gate), the highest-priority remaining item was FAZ 4's own last still-open sub-task,
  explicitly named as "next step" in run 18's own entry above: chase-camera wall-avoidance
  raycasting.

**Done:**
- **New `camera.js` export `resolveCameraCollision(raycaster, target, desiredPosition,
  collidables, marginMeters, minDistanceMeters)`** — raycasts from the `OrbitControls` target
  toward the free-orbit desired camera position; if a candidate mesh occludes it, returns a new
  `Vector3` pulled in to `hitDistance - marginMeters` (floored at `minDistanceMeters`), else returns
  `desiredPosition` unchanged (no allocation on the common unobstructed case).
- **New `PLAYER_CONFIG.CAMERA_COLLISION_MARGIN_METERS` (0.4) and
  `CAMERA_COLLISION_MIN_DISTANCE_METERS` (1.5)** in `config.js` — no magic numbers in `camera.js`
  itself, per the project's config convention.
- **New `ChunkManager.getLoadedChunkMesh(chunkX, chunkZ)`** (`world/chunkManager.js`) — a one-line
  accessor so `game3d.js` can look up a specific resident chunk's mesh without reimplementing the
  module-private `chunkKey` format itself.
- **New `game3d.js` module-local `collectCameraCollidables(state, worldX, worldZ)`** — builds the
  small per-frame candidate list: the player's current terrain chunk + 8 neighbors (via the new
  `getLoadedChunkMesh`) plus the 3 settlement `InstancedMesh` parts. Reuses one module-local array
  (cleared and refilled, not reallocated) every call.
- **`game3d.js` tick loop wiring:** after the existing chase-camera translation + `controls.
  update()` (unchanged from run 17/18) and the sky/stars/fog/water updates that already use the
  free-orbit `camera.position`, the loop snapshots that desired position, resolves collision
  against `collectCameraCollidables()`'s output, applies the (possibly pulled-in) result for that
  one `renderer.render()` call, and restores the snapshotted desired position right after — see
  DECISIONS.md ADR-0018 for why this apply-then-restore shape is what keeps the user's actual
  zoom/orbit distance from permanently shrinking after a collision.
- Added one `THREE.Raycaster` to `createScene()`'s returned state (`cameraCollisionRaycaster`),
  reused every frame — no per-frame `Raycaster` allocation.
- **Regression guard:** `node --check` clean on `config.js`, `camera.js`, `game3d.js`,
  `world/chunkManager.js`.
- **Real tests, not assumed correct from the code alone:**
  1. Pre-change baseline (see Session Snapshot above): full regression pass, zero new errors.
  2. **A standalone in-browser behavioral test of `resolveCameraCollision`** (real vendored
     `THREE.Raycaster`/`Mesh`/`InstancedMesh`, loaded through the same `game3d.html` import map, not
     a mocked stand-in): unobstructed case returns the same reference; a `Mesh` wall pulls the
     camera in to the exact expected distance (9.100m for a 9.5m hit with a 0.4m margin); a
     near-target wall clamps to the 1.5m floor; an empty collidables array is a no-op;
     `InstancedMesh` occlusion (what settlements actually are) triggers a pull-in identically to a
     plain `Mesh`. All 5 assertions passed.
  3. Post-change full regression smoke test: 3D desktop (444 chunks) and 3D mobile-emulated (25
     chunks) both zero console/page errors; 2D game unchanged (same pre-existing sandbox-only
     errors as the baseline).
  4. **6+ seconds of continuous simulated player movement** (held "w" in the real `game3d.html`
     render loop, ~360+ frames each running `resolveCameraCollision` for real, not just the
     isolated test above) — zero console/page errors, confirming the per-frame apply-then-restore
     position juggling doesn't destabilize `OrbitControls` damping or accumulate drift over time.
- Updated `DECISIONS.md` (new ADR-0018), `ARCHITECTURE.md` (`camera.js`, `world/chunkManager.js`,
  `game3d.js` entries), this file's Current Status/World Coverage/Known Issues and this section.

**Files changed this run:** `src/3d/camera.js`, `src/3d/config.js`, `src/3d/game3d.js`,
`src/3d/world/chunkManager.js`, `DECISIONS.md`, `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this
file). 7 files, well within this run's ≤800-line/≤20-file budget (~110 hand-written new lines).
One commit (the collision function, its config constants, the `ChunkManager` accessor, and the
`game3d.js` wiring are one atomic, revertable unit — none of the pieces are independently useful
without the others).

**World Coverage:** unchanged at 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
137.5 km²) — this run changed a per-frame camera behavior, not terrain/streaming.

**Next step for the next run:** FAZ 4's roadmap is now fully implemented (playable character, WASD
+ touch input, ground snapping, chase-camera wall-avoidance). The one FAZ 4-adjacent gap left is
player-side physics (no gravity/jump/wall-collider — a player can still *walk* through a castle
wall even though the camera no longer clips through one), flagged as future work rather than
blocking FAZ 4's own close-out. With FAZ 4 substantially done and World Coverage already past the
FAZ 3/10 gate, the next viable phase is **FAZ 5 (NPC)** — reusing `gameplay/player.js`'s
FBX-loading/retargeting pattern for the 6 already-downloaded T-pose Mixamo characters
(`arissa`/`dreyar`/`erika_archer`/`paladin_j_nordstrom`/`paladin_wprop_j_nordstrom`/
`uriel_a_plotexia`), which all share `peasant_girl`'s skeleton and can reuse its idle/walking/
running clips via retargeting. No new tech debt this run.

## This Run (2026-07-30, run 20)

**Session Snapshot taken at start of run** (per protocol):
- Confirmed git state (already fixed before this session started, per the operator's own note):
  `main` at `28f4cad` (run 19's own final commit), matching a fresh `git fetch origin main`'s
  `origin/main` exactly — no detached-`HEAD`/stale-tracking-ref issue this run, unlike runs 5/17/18/
  19. Read this file's last ~400 lines, `ARCHITECTURE.md` in full, and `DECISIONS.md`'s last 3 ADRs
  (ADR-0016/0017/0018) before doing anything else, per protocol.
- **World scale re-verified from `src/3d/config.js` directly (not the operator brief), per the
  now-thirteen-run-old standing skepticism rule:** `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`,
  `CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` are `25`/`22` → 137.5 km² grid-nominal / ~129.8 km² real
  bounds — already inside the requested 100-150 km² band, exactly matching ADR-0004. **No config
  change made** — the operator brief's restated "4278 km²" premise does not match the repository's
  actual state, same conclusion runs 3/4/5/7/9/11/14/15/16/17/18/19 already reached.
- `node --check` clean on every non-vendor `.js` file (baseline, before any edits this run).
- **Ran a full regression smoke test (Playwright/headless Chromium, repo served via `python3 -m
  http.server`) before writing any new code**, per the Regression Guard — 2D game (only the same
  pre-existing, already-documented sandbox network limitations — `firebase is not defined`, blocked
  external requests, nothing new), 3D desktop (441→444 terrain chunks after settlement grounding, 14
  settlements, river/waterfalls, zero errors), 3D mobile-emulated (25 chunks, mobile-budget path,
  zero errors) all passed clean. Confirmed run 19's wall-avoidance work is stable before building on
  top of it.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 19).
- With syntax/bugs/perf/leaks/debt/world-scale/coverage all clear (coverage is already past FAZ
  3/10's 80% gate) and FAZ 4's own roadmap fully closed out as of run 19, the highest-priority
  remaining item was run 19's own "next step" note: start **FAZ 5 (NPC)**, reusing `gameplay/
  player.js`'s FBX-loading/retargeting pattern for the 6 already-downloaded T-pose Mixamo
  characters.

**Done:**
- **New `AssetLoader.correctMixamoFbxScale(model)` static method** (`assetLoader.js`) — the
  centimeter-to-meter FBX scale correction `gameplay/player.js` already had, extracted so
  `gameplay/npc.js` (this run) doesn't hand-copy the same block a second time; `player.js` now calls
  the shared method too (behavior unchanged, verified via the same smoke test below).
- **New `src/3d/gameplay/npc.js`** (`createNPC`) — loads a Mixamo character FBX + `peasant_girl`'s
  skin-less idle clip (shared skeleton, no bone remapping), corrects its scale via the new shared
  helper, positions it at a caller-supplied `(worldX, worldZ, groundY)`, plays the idle clip on loop
  via `THREE.AnimationMixer`, and returns the same `{object3D, update(delta), dispose()}` shape
  `player.js`'s `createPlayer` returns, minus movement. No AI/pathing/interaction — deliberately
  atomic, see DECISIONS.md ADR-0019.
- **New `NPC_CONFIG`** (`config.js`) — `IDLE_ANIMATION_URL` (reused from `PLAYER_CONFIG`) and a flat
  `SPAWNS` list, each entry mapping a `seatId` (a `world/settlements.js` kingdom-seat id) + world
  offset + `modelUrl` to one static NPC. This run's list: 2 entries at `stannis` (`paladin_j_
  nordstrom.fbx`, `arissa.fbx` — the two smallest of the 6 available character files, a deliberate
  offline-precache-size choice — see ADR-0019).
- **`world/settlements.js`'s seat data now exposed from `game3d.js`'s scene state
  (`settlementSeats`)** — `createScene`'s return value gained this field (was already computed
  internally for the existing desktop grounding loop, just not returned) so `initGame3D` can resolve
  `NPC_CONFIG.SPAWNS`' `seatId`s against real, already-sampled world positions without re-deriving
  `mapToWorldXZ` a second time.
- **`game3d.js` wiring:** after the player loads and its camera framing is set, resolves each
  `NPC_CONFIG.SPAWNS` entry's seat, re-samples ground height at the NPC's own offset position
  (clamped above sea level, same convention `world/settlements.js` itself uses), and loads both NPCs
  in parallel via `Promise.all` (loading overlay stays up for their FBX downloads too, same reasoning
  as the player). The tick loop calls each NPC's `update(delta)` every frame (keeps the idle mixer
  animating); `pagehide` teardown disposes them.
- **`service-worker.js`:** `GAME3D_SHELL_FILES` gained `./src/3d/gameplay/npc.js`,
  `./assets/models/characters/paladin_j_nordstrom.fbx`, and `./assets/models/characters/arissa.fbx`
  — now that code actually loads them (same "precache once actually fetched" rule run 17 established
  for `peasant_girl.fbx`).
- **Regression guard:** `node --check` clean on `config.js`, `assetLoader.js`, `gameplay/player.js`,
  `gameplay/npc.js` (new), `game3d.js`, `service-worker.js`.
- **Real tests, not assumed correct from the code alone:**
  1. Pre-change baseline (see Session Snapshot above): full regression pass, zero new errors.
  2. **A standalone in-browser behavioral test of `createNPC`** (real vendored `FBXLoader`/
     `AnimationMixer`, loaded through the same `game3d.html` import map, not a mocked stand-in):
     loaded `paladin_j_nordstrom.fbx` + `peasant_girl`'s `idle.fbx` with an explicit test position/
     rotation — the returned object's name/position/rotation exactly matched the input,
     `userData.isPlaceholder` was `false` (a real FBX loaded, not the `AssetLoader` fallback box),
     the model contained 2 real meshes including a `SkinnedMesh`, 5 consecutive `update()` calls and
     `dispose()` both completed without throwing, zero console/page errors. All 10 assertions passed.
  3. Post-change full regression smoke test: 3D desktop (444 chunks, new `"Spawned 2 FAZ 5 NPC(s)"`
     log line) and 3D mobile-emulated (25 chunks, same NPC-spawn line) both zero console/page errors;
     2D game unchanged (same pre-existing sandbox-only errors as the baseline, not new).
  4. **A live-scene check via a temporary debug hook** (`window.__debugGame3DState = state`, added
     only for this test and reverted before commit — confirmed via `git diff` showing zero trace of
     it in the committed `game3d.js`): both NPCs present in `state.scene`'s graph by name at the
     exact expected world positions (seat center + configured offset, to the centimeter). A camera
     moved to frame one NPC up close (lighting temporarily brightened for screenshot visibility only)
     rendered a clearly humanoid, armored character standing on the terrain — not a placeholder box.
  5. Offline-precache check: after one online visit to `index.html`, `caches.open('westeros-shell-
     v1')` contains all 3 new files — confirms none would 404 on a subsequent offline visit to
     `game3d.html`.
- Updated `DECISIONS.md` (new ADR-0019), `ARCHITECTURE.md` (new `gameplay/npc.js` entry; updated
  `assetLoader.js`, `config.js`, `world/settlements.js`, `gameplay/` folder, `game3d.js` entries),
  this file's Current Status/Roadmap (FAZ 4 checklist corrected to reflect run 19's actual completed
  state, FAZ 5 checklist started)/World Coverage/Known Issues and this section.

**Files changed this run:** `src/3d/assetLoader.js`, `src/3d/config.js`, `src/3d/gameplay/npc.js`
(new), `src/3d/gameplay/player.js`, `src/3d/gameplay/README.md`, `src/3d/game3d.js`,
`service-worker.js`, `DECISIONS.md`, `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). 10 files,
well within this run's ≤800-line/≤20-file budget (~179 hand-written new lines of code across
`assetLoader.js`/`config.js`/`game3d.js`/`gameplay/npc.js`/`service-worker.js`, plus doc updates —
`gameplay/player.js`'s own edit is a net removal, not addition). One commit (the shared
scale-correction helper, the NPC module, its
config, and the `game3d.js` wiring are one atomic, revertable unit — none of the pieces are
independently useful without the others).

**World Coverage:** unchanged at 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
137.5 km²) — this run added 2 characters, not terrain.

**Next step for the next run:** FAZ 5's own still-open sub-tasks are real, scoped gaps, not
accidental ones: (a) NPC movement/patrol (waypoint following or a small behavior tree — the run
brief for this run explicitly scoped this out as "don't try to build full AI/behavior-tree in one
run," so it remains genuinely unstarted, not silently skipped), (b) NPCs only exist at 1 of 14
kingdom seats (`stannis`) — the other 13 have none yet, and 4 of the 6 downloaded character files
(`dreyar`, `erika_archer`, `paladin_wprop_j_nordstrom`, `uriel_a_plotexia`) are still unused and
need no new asset download to place, and (c) no player-NPC interaction/dialogue/name-tag UI yet.
Any of these three is a reasonable next slice on its own — extending `NPC_CONFIG.SPAWNS` to more
seats is the cheapest (config-only, no new code), while patrol/dialogue are real new systems. FAZ
4's own remaining gap (no gravity/jump/wall-collider physics) also remains open and un-touched this
run, same status as run 19 left it. No new tech debt this run — the one refactor made
(`AssetLoader.correctMixamoFbxScale`) removes duplication rather than adding it.

## This Run (2026-07-30, run 21)

**Session Snapshot taken at start of run** (per protocol):
- Confirmed git state: session started with `HEAD` detached at `ef8ed38` (run 20's own final
  commit) while the local `main` ref was stale at `38e09e7` (pre-3D-mode) — same recurring
  container-restart pattern runs 5/17/18/19 already documented, not data loss. `git fetch origin
  main` confirmed `origin/main` was already at `ef8ed38` (the push had succeeded; only the local
  tracking ref was stale before fetching). Fixed with `git checkout -B main origin/main` — no
  commits rewritten or discarded.
- Read this file's most recent run section (run 20), `DECISIONS.md`'s last 2 ADRs (ADR-0018/0019),
  and grepped `ARCHITECTURE.md` for relevant entries before doing anything else, per protocol.
- **World scale re-verified from `src/3d/config.js` directly (not the operator brief), per the
  now-fourteen-run-old standing skepticism rule:** `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`,
  `CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` are `25`/`22` → 137.5 km² grid-nominal, inside the
  requested 100-150 km² band, exactly matching ADR-0004. **No config change made** — the operator
  brief's restated "4278 km²"/"redo the correction" premise does not match the repository's actual
  state, same conclusion runs 3/4/5/7/9/11/14/15/16/17/18/19/20 already reached independently.
- `node --check` clean on every non-vendor `.js` file (baseline, before any edits this run); JSON-
  validated `manifest.json`/`assets_manifest.json`.
- **Ran a full regression smoke test (Playwright/headless Chromium, repo served via `python3 -m
  http.server`) before writing any new code**, per the Regression Guard — 2D game (only the same
  pre-existing, already-documented sandbox network limitations), 3D desktop (444 terrain chunks, 14
  settlements, 2 NPCs, river/waterfalls, zero errors), 3D mobile-emulated (25 chunks, 2 NPCs, zero
  errors) all passed clean, matching run 20's own baseline exactly.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 20).
- With syntax/bugs/perf/leaks/debt/world-scale/coverage all clear and FAZ 4/FAZ 5's first pass
  already landed, the highest-priority remaining item was run 20's own explicitly-flagged cheapest
  next slice: "extending `NPC_CONFIG.SPAWNS` to more seats needs no new code, only config entries."

**Done:**
- **Extended `NPC_CONFIG.SPAWNS`** (`config.js`) from 2 entries (both `stannis`) to 6, adding one
  NPC each at `umit` (`dreyar.fbx`), `cersei` (`paladin_wprop_j_nordstrom.fbx`), `berkalp`
  (`erika_archer.fbx`), and `doran` (`uriel_a_plotexia.fbx`) — the 4 downloaded Mixamo character
  files run 20 left unused. Zero code changes: `game3d.js`'s NPC spawn-resolution loop already
  iterates `NPC_CONFIG.SPAWNS` generically. See DECISIONS.md ADR-0020 for the full reasoning
  (seat-selection criteria, why breadth over depth, why ground-height sampling is safe regardless
  of chunk residency).
- **`service-worker.js`:** `GAME3D_SHELL_FILES` gained the 4 newly-referenced FBX files
  (`dreyar.fbx`, `paladin_wprop_j_nordstrom.fbx`, `erika_archer.fbx`, `uriel_a_plotexia.fbx`) —
  same "precache once code actually fetches it" rule run 17/20 established.
- **Regression guard:** `node --check` clean on both touched files (`config.js`, `service-worker.
  js`); JSON-validated `manifest.json`/`assets_manifest.json` (unchanged — all 6 characters were
  already registered by a prior parallel asset-adding session).
- **Real tests, not assumed correct from the code alone:**
  1. Pre-change regression baseline (see Session Snapshot above): zero new errors.
  2. Post-change full smoke test: 3D desktop (`"Placed 14 kingdom-seat settlements; 444 terrain
     chunks resident (~111.00 km²) after grounding them."`, `"Spawned 6 FAZ 5 NPC(s)."`, up from 2)
     and 3D mobile-emulated (25 chunks, same `"Spawned 6 FAZ 5 NPC(s)."` line) both zero console/
     page errors; 2D game unchanged (same pre-existing sandbox-only errors, not new).
  3. **A live-scene check via a temporary debug hook** (`window.__debugGame3DState = state`, added
     only for this test and reverted before commit — confirmed via `git diff` showing zero trace of
     it in the committed `game3d.js`): all 6 NPCs present in `state.scene`'s graph by name, at 6
     distinct world positions (not clustered), `userData.isPlaceholder` unset on every one (confirms
     real FBX geometry loaded for all 4 newly-used characters, not the `AssetLoader` fallback box).
  4. Offline-precache check: after one online visit to `index.html`, `caches.open('westeros-shell-
     v1')` contains all 4 newly-referenced FBX files plus `npc.js` — confirms none would 404 on a
     subsequent offline visit to `game3d.html`.
- Updated `DECISIONS.md` (new ADR-0020), `ARCHITECTURE.md` (`config.js`/`gameplay/npc.js` entries
  noted the run-21 extension), this file's Current Status/Roadmap (FAZ 5 checklist)/Known Issues
  and this section.

**Files changed this run:** `src/3d/config.js` (`NPC_CONFIG.SPAWNS` extension), `service-worker.js`
(`GAME3D_SHELL_FILES` extension), `DECISIONS.md` (new ADR-0020), `ARCHITECTURE.md`,
`3D_GAME_PROGRESS.md` (this file). 5 files, well within this run's ≤800-line/≤20-file budget (4
new config-object entries, ~18 hand-written lines of code, plus doc updates). One commit (the
config extension and its precache-list counterpart are one atomic, revertable unit — a spawn entry
referencing a model the service worker doesn't precache would be a real, if minor, inconsistency).

**World Coverage:** unchanged at 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
137.5 km²) — this run added NPCs at existing seats, not terrain.

**Next step for the next run:** FAZ 5's remaining honest gaps, narrowed but not closed: (a) NPC
movement/patrol (waypoint following or a small behavior tree — still explicitly out of scope for a
single run per the standing instruction), (b) 9 of 14 kingdom seats still have zero NPCs (down from
13) — all 6 downloaded character files are now in use, so any further seat needs either a second
NPC reusing an already-placed model (no new asset) or a genuinely new Mixamo/Free3D download
(requires the documented human manual-download step, not something this agent can do), and (c) no
player-NPC interaction/dialogue/name-tag UI yet. FAZ 4's own remaining gap (no gravity/jump/wall-
collider physics) also remains open and untouched, same status as run 19/20 left it. No new tech
debt this run — a pure config + precache-list extension of an already-verified pattern.

## This Run (2026-07-30, run 22)

**Session Snapshot taken at start of run** (per protocol, triggered by a live "Devam et" — continue
— request rather than a scheduled firing):
- Confirmed git state: `main` already matched a fresh `git fetch origin main`'s `origin/main`
  exactly (`0c0af45`, run 21's own final commit) — no detached-HEAD/stale-tracking-ref issue this
  run, unlike the recurring container-restart pattern runs 5/17/18/19/20 documented.
- Read this file's most recent run section (run 21) and grepped `DECISIONS.md`/`ARCHITECTURE.md`
  for the current `NPC_CONFIG`/`gameplay/npc.js` state before doing anything else, per protocol.
- **World scale re-verified from `src/3d/config.js` directly, per the now-fourteen-run-old standing
  skepticism rule:** `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`, `CHUNK_CONFIG.GRID_COLUMNS`/
  `GRID_ROWS` are `25`/`22` → 137.5 km², inside the requested 100-150 km² band, matching ADR-0004.
  **No config change made.**
- `node --check` clean on every non-vendor `.js` file (baseline). `git status` clean, nothing
  uncommitted at session start.
- **Ran a full regression smoke test (Playwright/headless Chromium, repo served via `python3 -m
  http.server`) before writing any new code**, per the Regression Guard — 2D game (only the same
  pre-existing, already-documented sandbox network limitations), 3D desktop (444 chunks, 14
  settlements, `"Spawned 6 FAZ 5 NPC(s)."`), 3D mobile-emulated (25 chunks) all passed clean.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 21).
- With syntax/bugs/perf/leaks/debt/world-scale/coverage all clear, the highest-priority remaining
  item was FAZ 5's own last unchecked roadmap line: "Waypoint/patrol (Behavior Tree)."

**Done:**
- **`gameplay/npc.js`:** `createNPC` gained optional `groundCollider`/`walkAnimationUrl`/
  `patrolWaypoints`/`speedMps`/`pauseSeconds`/`turnRateRadiansPerSecond` parameters. When
  `patrolWaypoints` (2+ world-space points) is passed, the NPC walks a straight line to the next
  point (modulo-wrapped index), pausing to idle at each one, reusing `player.js`'s exact per-frame
  ground-resampling and shortest-path yaw-turn pattern. Omitting it (the default) keeps the
  pre-existing static/idle-only behavior byte-for-byte. See DECISIONS.md ADR-0021.
- **`config.js`'s `NPC_CONFIG`:** added `WALK_ANIMATION_URL` (reused from `PLAYER_CONFIG`),
  `PATROL_SPEED_MPS` (1.4), `PATROL_PAUSE_SECONDS` (3), `PATROL_TURN_RATE_RADIANS_PER_SECOND` (4),
  and a `patrol: {toOffsetXMeters, toOffsetZMeters}` field on the 2 `stannis` spawn entries only —
  a 24m straight walk to the opposite side of each guard's existing offset, at the identical radial
  distance from the keep center the static spawn already proved clear. The other 4 NPCs are untouched.
- **`game3d.js`:** the NPC-loading loop now computes each patrolling NPC's 2nd waypoint in world
  space from `spawn.patrol` and passes `groundCollider`/`walkAnimationUrl`/`patrolWaypoints`/speed/
  pause/turn-rate through to `createNPC`; NPCs without a `patrol` field get `patrolWaypoints:
  undefined`, taking the unchanged static code path.
- **Regression guard:** `node --check` clean on all 3 touched files (`config.js`, `game3d.js`,
  `gameplay/npc.js`).
- **Real tests, not assumed correct from the code alone:**
  1. Pre-change regression baseline (see Session Snapshot above): zero new errors.
  2. Post-change full smoke test: 3D desktop and mobile-emulated both still `"Spawned 6 FAZ 5
     NPC(s)."`, zero console/page errors; 2D game unchanged.
  3. **A position-over-time measurement via a temporary debug hook** (`window.__debugGame3DState =
     state`, added only for this test and reverted before commit — confirmed via `git diff` showing
     zero trace of it in the committed `game3d.js`): sampled all 6 NPCs' world position 3 times, 8
     seconds apart. `stannis-guard-1`/`-2` moved 3.6m then 11.4m between samples (≈1.4 m/s, matching
     `PATROL_SPEED_MPS` once past the initial pause) while the other 4 NPCs moved exactly 0.000m
     both times — confirms patrol works for the 2 configured NPCs and does not leak into the 4
     static ones.
- Updated `DECISIONS.md` (new ADR-0021), `ARCHITECTURE.md` (`config.js`/`gameplay/npc.js` entries),
  this file's Current Status/Roadmap (FAZ 5 checklist)/this section.

**Files changed this run:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/gameplay/npc.js`,
`DECISIONS.md` (new ADR-0021), `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). 6 files, well
within the ≤800-line/≤20-file budget (~90 hand-written lines of code across the 3 source files, plus
doc updates). One commit (the patrol parameters, config constants, and `game3d.js` wiring are one
atomic, revertable unit — none independently useful without the others).

**World Coverage:** unchanged at 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
137.5 km²) — this run added NPC movement, not terrain.

**Next step for the next run:** FAZ 5's remaining honest gaps: (a) patrol still only on 2 of 6 NPCs
— extending to more is the same kind of config-only change ADR-0020 already established (add a
`patrol` field to more `SPAWNS` entries, no new code), (b) 9 of 14 kingdom seats still have zero
NPCs, (c) no player-NPC interaction/dialogue/name-tag UI yet, and (d) no player-awareness/reactive
behavior — an NPC patrols regardless of where the player is, real behavior-tree territory,
deliberately still out of scope (see ADR-0021's "Alternatives considered"). FAZ 4's own remaining
gap (no gravity/jump/wall-collider physics) also remains open and untouched. No new tech debt this
run — all new `createNPC` parameters are optional with the pre-existing behavior as the default.

## This Run (2026-07-30, run 23)

**Session Snapshot taken at start of run** (per protocol, triggered by a scheduled/automated firing):
- Confirmed git state: session started with `HEAD` detached at `01231fe` (run 22's own final commit)
  while the local `main` ref was stale at `38e09e7` (pre-3D-mode) — same recurring container-restart
  pattern runs 5/17/18/19/20/21 already documented, not data loss. `git fetch origin main` confirmed
  `origin/main` was already at `01231fe` (the push had succeeded; only the local tracking ref was
  stale). Fixed with `git checkout main && git merge --ff-only 01231fe` — no commits rewritten.
- **This run's brief re-asserted the old, already-superseded "world scale must be corrected to
  100-150 km²" instruction as top priority.** Re-derived from `src/3d/config.js` directly (not the
  brief's own numbers), per the now-sixteen-run-old standing skepticism rule: `WORLD_SCALE.
  METERS_PER_MAP_UNIT` is `1.75`, `CHUNK_CONFIG.GRID_COLUMNS`/`GRID_ROWS` are `25`/`22` → 137.5 km²
  grid-nominal, inside the requested 100-150 km² band, exactly matching ADR-0004. **No config change
  made** — the correction the brief asked for was already done in run 3 (ADR-0004) and independently
  re-verified every run since (3/4/5/7/9/11/14/15/16/17/18/19/20/21/22, now 23) without drift. The
  brief's separate "the previous 300-line/10-file budget was too small, raise it to 800/20" note is
  a process change, not a code change — noted, no action needed beyond following the new ceiling.
- Read this file's most recent run section (run 22), `DECISIONS.md`'s last 2 ADRs (ADR-0020/0021),
  and grepped `ARCHITECTURE.md` for `gameplay/npc.js`'s current state before doing anything else.
- `node --check` clean on every non-vendor `.js` file (baseline, before any edits this run); JSON-
  validated `manifest.json`/`assets_manifest.json`. `git status` clean, nothing uncommitted at start.
- **Ran a full regression smoke test (Playwright/headless Chromium, repo served via `python3 -m
  http.server`) before writing any new code**, per the Regression Guard — 2D game (only the same
  pre-existing, already-documented sandbox network limitations: `firebase is not defined`, blocked
  `resimler/map.png`/network requests), 3D desktop (441 preview + 3 grounding = 444 terrain chunks,
  14 settlements, river/waterfalls, `"Spawned 6 FAZ 5 NPC(s)."`), 3D mobile-emulated (25 chunks, same
  NPC count) all passed clean, matching run 22's own baseline exactly.
- World Coverage before this run: 80.7% desktop (111.00 km² / 137.5 km²) / 4.5% mobile (6.25 km² /
  137.5 km²) — unchanged from run 22, world-scale target re-verified unchanged this run (see above).
- With syntax/bugs/perf/leaks/debt/world-scale/coverage all clear, the highest-priority remaining
  item under the task-priority order was FAZ 5's own explicitly-flagged gap: "no player-NPC
  interaction/dialogue/name-tag UI yet" (run 22's "Next step," Known Issues list). Dialogue/
  interaction is too large for one atomic slice; the name-tag half is real, scoped, and testable.

**Done:**
- **`gameplay/npc.js`:** added `createNameTagSprite(text, widthMeters, heightMeters)` — a canvas-
  rendered text texture on a `THREE.Sprite`/`SpriteMaterial` (`depthWrite: false`, `depthTest` stays
  on so the tag still hides correctly behind real terrain/walls). `createNPC` gained optional
  `displayName`/`nameTagWidthMeters`/`nameTagHeightMeters`/`nameTagVerticalOffsetMeters` parameters;
  when `displayName` is set, the tag is added as a child of the loaded FBX model at
  `nameTagVerticalOffsetMeters` above its local origin. **A real scale bug found and fixed during
  this run's own testing, not shipped from code review alone:** the first version positioned/sized
  the tag directly in "real-world meters," which rendered as a near-invisible speck — traced to the
  vendored sprite vertex shader deriving both the sprite's position and its on-screen size from its
  own `modelMatrix`, which (since the tag is parented under the FBX model) includes
  `AssetLoader.correctMixamoFbxScale`'s ~0.01 Mixamo cm→m scale correction. Fixed by dividing the
  tag's local position/scale by `model.scale.x` before assigning them. See DECISIONS.md ADR-0022 for
  the full root-cause trace and verification.
- **`config.js`'s `NPC_CONFIG`:** added `NAME_TAG_WIDTH_METERS` (2.4), `NAME_TAG_HEIGHT_METERS`
  (0.6), `NAME_TAG_VERTICAL_OFFSET_METERS` (2.1), and a `displayName` field on all 6 `SPAWNS`
  entries — house-flavored Turkish names derived from each spawn's `seatId` matching `script.js`'s
  `INIT_KINGDOMS` house names (`'Baratheon Muhafızı I'`/`'II'` for the two `stannis` guards,
  `'Targeryan Muhafızı'`/`'Lannister Muhafızı'`/`'Stark Muhafızı'`/`'Martell Muhafızı'` for the rest).
- **`game3d.js`:** the NPC-loading loop now passes `spawn.displayName` and the three
  `NPC_CONFIG.NAME_TAG_*` constants through to `createNPC`.
- **Regression guard:** `node --check` clean on all 3 touched files (`config.js`, `game3d.js`,
  `gameplay/npc.js`).
- **Real tests, not assumed correct from the code alone:**
  1. Pre-change regression baseline (see Session Snapshot above): zero new errors.
  2. Post-change full smoke test: 3D desktop and mobile-emulated both still `"Spawned 6 FAZ 5
     NPC(s)."`, identical chunk/settlement counts, zero console/page errors; 2D game unchanged (same
     pre-existing sandbox-only errors, not new).
  3. **A scene-graph check via a temporary debug hook** (`window.__debugGame3DState = state`, added
     only for this test and reverted before commit — confirmed via `grep`/`git diff` showing zero
     trace of it in the committed `game3d.js`): confirmed every NPC gained exactly one
     `THREE.Sprite` child (`object3D.traverse` counting `node.isSprite`).
  4. **A real close-range screenshot**, not just an object-count check: teleported the player +
     camera + `OrbitControls.target` next to a live NPC via the same debug hook (bypassing the
     chase-cam's normal follow logic for one test frame), screenshotted, and visually confirmed
     "Baratheon Muhafızı I" renders legibly, centered above the character's head — this is what
     caught the scale bug above in the first place (the pre-fix screenshot showed nothing).
- Updated `DECISIONS.md` (new ADR-0022), `ARCHITECTURE.md` (`gameplay/npc.js` entry), this file's
  FAZ 5 roadmap checklist, Known Issues, and this section.

**Files changed this run:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/gameplay/npc.js`,
`DECISIONS.md` (new ADR-0022), `ARCHITECTURE.md`, `3D_GAME_PROGRESS.md` (this file). 6 files, well
within the ≤800-line/≤20-file run budget (~75 hand-written lines of code across the 3 source files,
plus doc updates). One commit (the sprite helper, config constants, and `game3d.js` wiring are one
atomic, revertable unit — none independently useful without the others).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 22, re-verified via the same headless-
Chromium console-log method (`"...444 terrain chunks resident (~111.00 km²)..."` desktop,
`"...25 terrain chunks resident...(~6.25 km²)..."` mobile). This run added NPC UI, not terrain. The
100-150 km² world-scale target itself was re-verified unchanged against `src/3d/config.js` at the
start of this run (see Session Snapshot above) — the operator brief's restated "redo the world-scale
correction" premise does not match the repository's actual state, same conclusion 15 prior runs
already reached independently; no config change was needed or made.**

**Next step for the next run:** FAZ 5's remaining honest gaps, narrowed but not closed: (a) patrol
still only on 2 of 6 NPCs — extending to more is a config-only change (ADR-0020/ADR-0021 pattern, add
a `patrol` field to more `SPAWNS` entries, no new code), (b) 9 of 14 kingdom seats still have zero
NPCs — a further seat needs either a second NPC reusing an already-placed model (no new asset) or a
genuinely new Mixamo/Free3D download (human manual-download step, not something this agent can do),
(c) no dialogue/interaction system — clicking/approaching an NPC does nothing beyond seeing its name
tag now, and (d) no player-awareness/reactive behavior — an NPC patrols regardless of where the
player is, real behavior-tree territory, deliberately still out of scope. FAZ 4's own remaining gap
(no gravity/jump/wall-collider physics) also remains open and untouched, same status as run 19-22
left it. No new tech debt this run — the one bug found (the sprite scale issue) was caught and fixed
within this same run before any commit, not shipped and left for later.

## This Run (2026-07-30, run 24)

**Session Snapshot taken at start of run** (per protocol, triggered by a live "Devam et" — continue
— request rather than a scheduled firing):
- Confirmed git state: `main` already matched a fresh `git fetch origin main`'s `origin/main` exactly
  (`fead398`, run 23's own final commit) — no detached-HEAD/stale-tracking-ref issue this run.
- **World scale re-verified from `src/3d/config.js` directly, per the now-seventeen-run-old standing
  skepticism rule:** `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`, `CHUNK_CONFIG.GRID_COLUMNS`/
  `GRID_ROWS` are `25`/`22` → 137.5 km², inside the 100-150 km² band, matching ADR-0004. **No config
  change made.**
- `node --check` clean on every non-vendor `.js` file (baseline). `git status` clean, nothing
  uncommitted at session start.
- **Ran a full regression smoke test (Playwright/headless Chromium, repo served via `python3 -m
  http.server`) before writing any new code**, per the Regression Guard — 2D game (only the same
  pre-existing, already-documented sandbox network limitations), 3D desktop (444 chunks, 14
  settlements, `"Spawned 6 FAZ 5 NPC(s)."`), 3D mobile-emulated (25 chunks) all passed clean,
  matching run 23's own baseline exactly.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 23).
- With syntax/bugs/perf/leaks/debt/world-scale/coverage all clear, the highest-priority remaining
  item was run 23's own explicitly-flagged cheapest next slice: "patrol still only on 2 of 6 NPCs —
  extending to more is a config-only change."

**Done:**
- **Extended patrol to the 4 remaining static NPCs** (`config.js`'s `NPC_CONFIG.SPAWNS`) — added a
  `patrol` field to `umit-guard-1`, `cersei-guard-1`, `berkalp-guard-1`, and `doran-guard-1`, using
  the exact same geometry ADR-0021 proved safe on the 2 `stannis` guards (flip `offsetZMeters`'
  sign, keep `offsetXMeters` unchanged — every kingdom seat shares the identical castle template, so
  the same 16.97m radial clearance from the keep applies everywhere). **Zero code changes** —
  `game3d.js`'s NPC-loading loop already builds `patrolWaypoints` generically from any
  `spawn.patrol` field. See DECISIONS.md ADR-0023.
- **Regression guard:** `node --check` clean on `config.js` (the only touched source file).
- **Real tests, not assumed correct from the code alone:**
  1. Pre-change regression baseline (see Session Snapshot above): zero new errors.
  2. Post-change full smoke test: 3D desktop and mobile-emulated both still `"Spawned 6 FAZ 5
     NPC(s)."`, identical chunk/settlement counts, zero console/page errors; 2D game unchanged.
  3. **A position-over-time measurement via a temporary debug hook** (`window.__debugGame3DState =
     state`, added only for this test and reverted before commit — confirmed via `git diff` showing
     zero net change to the committed `game3d.js`): sampled all 6 NPCs' world position twice, 8
     seconds apart. **All 6** NPCs now moved ~3.6m in the window (previously only the 2 `stannis`
     guards moved; the other 4 were 0.000m as of run 22/23's own tests) — confirms patrol now works
     on every seat's own local terrain, not just `stannis`'s.
- Updated `DECISIONS.md` (new ADR-0023), this file's FAZ 5 roadmap checklist, Known Issues, and this
  section.

**Files changed this run:** `src/3d/config.js`, `DECISIONS.md` (new ADR-0023), `3D_GAME_PROGRESS.md`
(this file). 3 files, well within the ≤800-line/≤20-file run budget (~16 hand-written config lines,
plus doc updates). One commit (the 4 `patrol` field additions are one atomic, revertable unit — all
following the same already-established pattern, no reason to split).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 23, re-verified via the same headless-
Chromium console-log method. This run added NPC movement, not terrain. The 100-150 km² world-scale
target itself was re-verified unchanged against `src/3d/config.js` at the start of this run (see
Session Snapshot above) — no config change was needed or made.**

**Next step for the next run:** FAZ 5's remaining honest gaps: (a) 9 of 14 kingdom seats still have
zero NPCs — a further seat needs either a second NPC reusing an already-placed model (no new asset)
or a genuinely new Mixamo/Free3D download (human manual-download step, not something this agent can
do), (b) no dialogue/interaction system — clicking/approaching an NPC does nothing beyond seeing its
name tag now, and (c) no player-awareness/reactive behavior — an NPC patrols regardless of where the
player is, real behavior-tree territory, deliberately still out of scope. FAZ 4's own remaining gap
(no gravity/jump/wall-collider physics) also remains open and untouched. With FAZ 5's cheap
config-only slices now exhausted, the next FAZ 5 sub-task (dialogue/interaction, or a 2nd NPC per
seat) is a real new system, not a quick follow-up — alternatively, FAZ 6 (Hayvanlar) is ready to
start: the `wolf` glTF/GLB model is already downloaded and registered in `assets_manifest.json`,
unused by any code yet. No new tech debt this run — a pure config extension of an already-verified
pattern, no new parameters or code paths.

## This Run (2026-07-30, run 25)

**Session Snapshot taken at start of run** (per protocol, triggered by a live "Devam et" — continue
— request rather than a scheduled firing):
- Confirmed git state: `main` already matched a fresh `git fetch origin main`'s `origin/main`
  exactly (`b86c863`, run 24's own final commit) — no detached-HEAD/stale-tracking-ref issue.
- **World scale re-verified from `src/3d/config.js` directly, per the now-eighteen-run-old standing
  skepticism rule:** `WORLD_SCALE.METERS_PER_MAP_UNIT` is `1.75`, `CHUNK_CONFIG.GRID_COLUMNS`/
  `GRID_ROWS` are `25`/`22` → 137.5 km², inside the 100-150 km² band, matching ADR-0004. **No config
  change made.**
- `node --check` clean on every non-vendor `.js` file (baseline). `git status` clean, nothing
  uncommitted at session start.
- **Ran a full regression smoke test (Playwright/headless Chromium, repo served via `python3 -m
  http.server`) before writing any new code**, per the Regression Guard — 2D game (only the same
  pre-existing, already-documented sandbox network limitations), 3D desktop (444 chunks, 14
  settlements), 3D mobile-emulated (25 chunks, `"Spawned 6 FAZ 5 NPC(s)."`) all passed clean,
  matching run 24's own baseline exactly.
- World Coverage before this run: 80.7% desktop / 4.5% mobile (unchanged from run 24).
- With FAZ 5's patrol pattern now on all 6 NPCs (run 24) and world-scale/syntax/perf/leaks/debt/
  coverage all clear, the highest-priority remaining item under the task-priority order (active
  phase's incomplete subtask, before starting a new feature/phase) was FAZ 5's own explicitly-
  flagged gap: "9 of 14 kingdom seats still have zero NPCs — a further seat needs either a second
  NPC reusing an already-placed model (no new asset) or a new Mixamo/Free3D download." The reuse
  path needs no human step, so it was this run's pick over starting FAZ 6.

**Done:**
- **Added 4 new `NPC_CONFIG.SPAWNS` entries** (`config.js`) — `ziya-guard-1` (Tyrell, reuses
  `arissa.fbx`), `balon-guard-1` (Greyjoy, reuses `paladin_wprop_j_nordstrom.fbx`), `robin-guard-1`
  (Arryn, reuses `erika_archer.fbx`), `jon-guard-1` (Stark/Night's Watch, reuses
  `uriel_a_plotexia.fbx`) — chosen for house diversity among the 9 remaining candidate seats.
  `Night King`'s seat was deliberately excluded (a special antagonist entity, not a normal ruling
  house — a generic guard there would be thematically wrong, not just descoped). All 4 got a
  `displayName` and a `patrol` field from the start (patrol is now the established default, not a
  later follow-up). **Zero new asset files, zero code changes** — all 4 reused FBX files were
  already precached in `service-worker.js` since run 20/21, and `game3d.js`'s NPC-loading loop
  already handles any number of `SPAWNS` entries generically. See DECISIONS.md ADR-0024.
- **Regression guard:** `node --check` clean on `config.js` (the only touched source file).
- **Real tests, not assumed correct from the code alone:**
  1. Pre-change regression baseline (see Session Snapshot above): zero new errors.
  2. Post-change full smoke test: 3D desktop and mobile-emulated both `"Spawned 10 FAZ 5 NPC(s)."`
     (up from 6), identical chunk/settlement counts, zero console/page errors; 2D game unchanged.
  3. **A scene-graph + position-over-time check via a temporary debug hook**
     (`window.__debugGame3DState = state`, added only for this test and reverted before commit —
     confirmed via `git diff` showing zero net change to the committed `game3d.js`): confirmed all
     10 NPCs loaded real geometry (zero `userData.isPlaceholder` fallbacks — every reused FBX
     fetched/parsed correctly a second time), all 10 gained exactly one name-tag sprite, and all 10
     moved ~4.1m over an 8-second sample window (patrol confirmed working on the 4 new seats' own
     local terrain).
- Updated `DECISIONS.md` (new ADR-0024), this file's FAZ 5 roadmap checklist, Known Issues, and this
  section.

**Files changed this run:** `src/3d/config.js`, `DECISIONS.md` (new ADR-0024), `3D_GAME_PROGRESS.md`
(this file). 3 files, well within the ≤800-line/≤20-file run budget (~46 hand-written config lines,
plus doc updates). One commit (the 4 spawn entries are one atomic, revertable unit — all following
the same already-established pattern).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 24, re-verified via the same headless-
Chromium console-log method. This run added NPCs, not terrain. The 100-150 km² world-scale target
itself was re-verified unchanged against `src/3d/config.js` at the start of this run (see Session
Snapshot above) — no config change was needed or made.**

**Next step for the next run:** FAZ 5's cheap "reuse an existing model" slices are now genuinely
exhausted for house diversity — 5 seats remain NPC-less (`berk`, `olena`, `twin` — all same house as
an already-represented seat — plus `Xaro` and the deliberately-excluded `Night King`); any of these
would just duplicate a house already on the map, still config-only if wanted, but lower value than
before. Real remaining FAZ 5 work: (a) a dialogue/interaction system (clicking/approaching an NPC
does nothing beyond seeing its name tag), (b) player-awareness/reactive behavior — an NPC patrols
regardless of where the player is, real behavior-tree territory. FAZ 4's own remaining gap (no
gravity/jump/wall-collider physics) also remains open and untouched. **Recommend the next run
seriously consider starting FAZ 6 (Hayvanlar)** — the `wolf` glTF/GLB model is already downloaded,
registered in `assets_manifest.json`, and unused by any code; a first-pass static/idle wolf (mirroring
how `gameplay/npc.js` started in run 20) would be a comparably-scoped new slice with more roadmap
value than another NPC-seat config tweak. No new tech debt this run — a pure config extension
reusing already-established patterns.

## This Run (2026-07-30, run 26)

**Session Snapshot taken at start of run** (per protocol):
- Read this file, `git log -10 --oneline`, and DECISIONS.md's last 3 ADRs (ADR-0022/0023/0024)
  before doing anything else.
- **Git state at boot:** `HEAD` detached at run 25's own final commit (`5297817`), local `main`
  stale at the pre-3D-mode commit (`38e09e7`) — the same recurring container-restart pattern flagged
  at run 18. `git ls-remote --heads origin` confirmed `origin/main` was already at `5297817` (no
  data loss, matching the detached `HEAD` exactly) — only this container's local refs were stale.
  Fixed with `git fetch origin main && git checkout -B main origin/main` (a clean reset onto the
  already-correct remote tip, not a merge — safe since local `main` had zero unique commits to
  preserve).
- **The operator brief's own "4278 km² target, previously invalidated" framing is stale** (see
  Current Status above) — `src/3d/config.js` already shows the corrected 137.5 km² scale from
  ADR-0004, re-confirmed by 19 prior runs. Re-derived it myself from `config.js` rather than
  trusting the brief, per the standing instruction in this file's own text: still correct, no change
  made.
- No syntax errors, no open regression list, no memory-leak reports, no perf-budget breach — checked
  via `node --check` on every non-vendored `src/3d/**/*.js` file plus `script.js`/`service-worker.js`
  before starting (all clean). Per the task's priority order (syntax → blocking bugs → perf → memory
  → tech debt → regression coverage → World Coverage → active-phase sub-task → new feature), nothing
  above "active-phase sub-task" needed attention, so this run picked up run 25's own explicit
  recommendation: start FAZ 6 (Hayvanlar) with a first-pass wolf.

**Done:**
- **`src/3d/assetLoader.js`:** `loadModel` (glTF/GLB loader, previously unused by any caller —
  confirmed via `grep` before touching it) now sets `gltf.scene.animations = gltf.animations` before
  returning — `GLTFLoader` keeps clips as a separate top-level array, unlike `FBXLoader`, which
  already attaches them to the group it returns (why `gameplay/npc.js` can already read
  `idleSource.animations[0]`). One line, makes both loaders' outputs usable the same way.
- **`src/3d/config.js`:** new `ANIMAL_CONFIG` — `WOLF_MODEL_URL`, `IDLE_CLIP_NAME` (confirmed exact
  against the source `.gltf` JSON sidecar, not guessed), `STRIP_CHILD_NAMES` (`['Circle']` — the
  source file bundles a non-skinned shadow-catcher disc as a scene-root sibling of the wolf's real
  meshes, confirmed the same way), and a 2-entry `SPAWNS` list at the `berkalp` (Stark) seat.
- **New `src/3d/gameplay/animals.js`:** `createWolf(...)`, matching `gameplay/npc.js`'s
  `{object3D, update(delta), dispose()}` shape and its run-20 static/idle-only starting scope. A
  `stripNamedChildren` helper removes the bundled decoration mesh (disposing its GPU resources)
  before the model joins the scene.
- **`src/3d/game3d.js`:** imports `createWolf`/`ANIMAL_CONFIG`, spawns `ANIMAL_CONFIG.SPAWNS` in
  parallel right after the NPC block (same seat-resolution/ground-clamping helpers reused, not
  duplicated), updates each animal's mixer every frame, disposes them on `pagehide`.
- **`service-worker.js`:** added `./src/3d/gameplay/animals.js` and the wolf's single `.glb` (its
  buffer/textures are embedded, no separate entries needed) to `GAME3D_SHELL_FILES` for offline use.
- **`ARCHITECTURE.md`:** new `gameplay/animals.js` Depends-On/Used-By/Critical-Path/Failure-Mode
  section, `assetLoader.js`/`config.js`/`game3d.js`'s own entries updated to mention it.
- **`src/3d/gameplay/README.md`:** documented `animals.js` alongside `npc.js`.
- **Regression guard:** `node --check` clean on all 4 touched/new source files plus
  `service-worker.js`; JSON-validated `manifest.json`/`assets_manifest.json` (unchanged, still valid).
- **Real tests, not assumed correct from the code alone** (headless Chromium via Playwright,
  `http-server` serving the repo root):
  1. Pre-change regression baseline matched run 25's own documented numbers exactly (444/25 chunks,
     14 settlements, 10 NPCs, zero errors).
  2. Post-change full smoke test on both device classes: `"Spawned 2 FAZ 6 animal(s)."` on both
     desktop and touch-emulated (`hasTouch: true, isMobile: true`) contexts, zero new console/page
     errors, all pre-existing counts unchanged (confirms this is purely additive).
  3. **A scene-graph + bone-animation check via a temporary debug hook**
     (`window.__debugGame3DState = state`, added only for this test and reverted before commit —
     confirmed via `git diff` showing zero net change to the committed `game3d.js`): both wolves
     loaded real `SkinnedMesh` geometry (zero placeholder fallbacks), the bundled "Circle" mesh was
     confirmed absent from both, and a before/after sample across all 49 skeleton bones over 1.5s
     found 31 with a real position/quaternion delta (chest, head, jaw, ears, eyelids, tail) —
     the idle clip is genuinely animating, not frozen on frame 0.
- Updated `DECISIONS.md` (new ADR-0025), this file's FAZ 6 roadmap checklist, Performance Budget
  Status, Known Issues, and this section.

**Files changed this run:** `src/3d/assetLoader.js`, `src/3d/config.js`, `src/3d/gameplay/animals.js`
(new), `src/3d/game3d.js`, `service-worker.js`, `ARCHITECTURE.md`, `src/3d/gameplay/README.md`,
`DECISIONS.md` (new ADR-0025), `3D_GAME_PROGRESS.md` (this file). 9 files — within the ≤20-file run
budget; well under ≤800 new lines (the new `animals.js` module is ~75 lines, `ANIMAL_CONFIG` ~35
lines, the rest are small wiring edits plus doc updates). One commit (the whole FAZ 6 first-pass
slice is one atomic, revertable unit).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 25, re-verified via the same headless-
Chromium console-log method. This run added 2 animals, not terrain. The 100-150 km² world-scale
target itself was re-verified unchanged against `src/3d/config.js` at the start of this run (see
Session Snapshot above) — no config change was needed or made.**

**Next step for the next run:** FAZ 6 now has one real animal type (wolf, static/idle, 2 instances)
out of four the roadmap lists (horses, carts, dogs/cats, birds — none downloaded, all would need a
human manual-download step, see Known Issues). Cheapest next FAZ 6 slice: give the 2 existing wolves
a wander/patrol behavior reusing `gameplay/npc.js`'s already-proven `patrolWaypoints` pattern (the
wolf glTF's `02_walk_Armature_0` clip is already available and unused) — this is genuinely a
same-scope repeat of what NPCs did in run 22, not new territory. Real remaining FAZ 5 work (still
open, untouched this run): a dialogue/interaction system, player-awareness/reactive behavior. FAZ
4's own remaining gap (no gravity/jump/wall-collider physics) also remains open. No new tech debt
this run — the one latent gap found (`loadModel`'s missing `.animations`) was fixed, not deferred.

## This Run (2026-07-30, run 27)

**Session Snapshot taken at start of run** (per protocol):
- Read this file's tail, `git log -5 --oneline`, and DECISIONS.md's last ADR (ADR-0025) before doing
  anything else.
- **Git state at boot was clean this time** — `git status` showed a clean working tree on `main`,
  `git fetch origin main` confirmed local `main` already matched `origin/main` exactly (`1f8f68b`,
  run 26's own final commit). No detached-`HEAD`/stale-ref repair needed, unlike several prior runs.
- World scale re-derived from `src/3d/config.js` once more (`METERS_PER_MAP_UNIT: 1.75`, 25x22
  grid): still 137.5 km², still matches ADR-0004 exactly — no change made, twenty-first straight run
  to reconfirm this.
- No syntax errors, no open regression list, no memory-leak reports, no perf-budget breach — checked
  via `node --check` on every non-vendored `src/3d/**/*.js` file plus `script.js`/`service-worker.js`
  before starting (all clean). Per the task's priority order, nothing above "active-phase sub-task"
  needed attention, so this run picked up run 26's own explicit recommendation: give the 2 existing
  wolves a waypoint patrol.

**Done:**
- **`src/3d/gameplay/animals.js`:** `createWolf` gained the same optional
  `groundCollider`/`walkClipName`/`patrolWaypoints`/`speedMps`/`pauseSeconds`/
  `turnRateRadiansPerSecond` parameters and straight-line/idle-pause/turn-toward update logic
  `gameplay/npc.js`'s `createNPC` already has — copied, not extracted into a shared module (see
  DECISIONS.md ADR-0026 for the reasoning: differing loader/clip-lookup APIs between the two files,
  and not wanting to widen this run's blast radius into the stable, already-tested FAZ 5 system for
  a readability-only win at just 2 consumers).
- **`src/3d/config.js`:** `ANIMAL_CONFIG` gained `WALK_CLIP_NAME` (confirmed against the source
  `.gltf` JSON, not guessed), `PATROL_SPEED_MPS` (2.2, a wolf's trot — faster than `NPC_CONFIG`'s
  1.4), `PATROL_PAUSE_SECONDS` (3, same as NPCs), `PATROL_TURN_RATE_RADIANS_PER_SECOND` (4, same as
  NPCs), and a `patrol` field on both `SPAWNS` entries — each wolf walks a 20m line, different spot
  and axis from the other so their paths don't cross each other or the guard NPCs' own patrol zone
  at the same seat.
- **`src/3d/game3d.js`:** the wolf-spawn block now resolves `spawn.patrol` into a 2-waypoint array
  and passes the new patrol options through, the same way the NPC block already does (copied, not
  shared, for the same reason above).
- **Regression guard:** `node --check` clean on all 3 touched files (`config.js`, `game3d.js`,
  `gameplay/animals.js`); no other files touched this run.
- **Real tests, not assumed correct from the code alone** (headless Chromium via Playwright,
  `http-server` serving the repo root):
  1. Pre-change regression baseline matched run 26's own documented numbers exactly (444/25 chunks,
     14 settlements, 10 NPCs, 2 animals, zero errors).
  2. Post-change full smoke test on both device classes: `"Spawned 2 FAZ 6 animal(s)."` on both, zero
     new console/page errors, all other counts unchanged (confirms purely additive).
  3. **A position-over-time check via a temporary debug hook** (`window.__debugGame3DState = state`,
     added only for this test and reverted before commit — confirmed via `git diff` showing zero net
     change to the committed `game3d.js`): both wolves moved 13.40m over an 8-second sample window,
     confirming patrol genuinely drives position rather than just switching animations in place.
- Updated `DECISIONS.md` (new ADR-0026), this file's FAZ 6 roadmap checklist, Performance Budget
  Status, Known Issues, and this section.

**Files changed this run:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/gameplay/animals.js`,
`DECISIONS.md` (new ADR-0026), `ARCHITECTURE.md`, `src/3d/gameplay/README.md`,
`3D_GAME_PROGRESS.md` (this file). 7 files — within the ≤20-file run budget; well under the
≤800-new-line budget (the patrol logic addition is ~55 hand-written lines, the rest is config/doc
updates). One commit (the whole patrol slice is one atomic, revertable unit).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 26, re-verified via the same headless-
Chromium console-log method. This run changed animal movement, not terrain. The 100-150 km²
world-scale target itself was re-verified unchanged against `src/3d/config.js` at the start of this
run (see Session Snapshot above) — no config change was needed or made.**

**Next step for the next run:** FAZ 6's wolf is now feature-complete at this scope (loads, idles,
patrols) — the same place `gameplay/npc.js` was after its own run-22 patrol pilot. Real remaining
FAZ 6 work: the other 3 animal types (horses, carts, dogs/cats, birds — none downloaded, each needs
a human manual-download step, see Known Issues) and player-awareness (flee/aggro) for the wolf. Real
remaining FAZ 5 work (still open, untouched this run): a dialogue/interaction system, player-
awareness/reactive behavior. FAZ 4's own remaining gap (no gravity/jump/wall-collider physics) also
remains open. If none of those feel like the highest-value next slice, revisit whether `npc.js`'s and
`animals.js`'s now-duplicated patrol logic has hit "3 consumers" yet (per ADR-0026, extract to a
shared module only then) — it hasn't as of this run (still exactly 2). No new tech debt this run —
the duplication tradeoff was made deliberately and is explicitly flagged for revisit.

## This Run (2026-07-30, run 28)

**Session Snapshot taken at start of run** (per protocol):
- Read this file's tail, `git log -5 --oneline`, and DECISIONS.md's last ADR (ADR-0026) before doing
  anything else.
- **Git state at boot was clean** — `git status` showed a clean working tree on `main`,
  `git fetch origin main` confirmed local `main` already matched `origin/main` exactly (`e809ce5`,
  run 27's own final commit). No detached-`HEAD`/stale-ref repair needed, same as run 27.
- World scale re-derived from `src/3d/config.js` once more: still 137.5 km², still matches ADR-0004
  exactly — no change made, twenty-second straight run to reconfirm this.
- No syntax errors, no open regression list, no memory-leak reports, no perf-budget breach — checked
  via `node --check` on every non-vendored `src/3d/**/*.js` file plus `script.js`/`service-worker.js`
  before starting (all clean). Per the task's priority order, nothing above "active-phase sub-task"
  needed attention, so this run picked the smaller of run 27's two flagged player-awareness
  candidates: the wolf's flee reaction (a distance check + movement vector) over FAZ 5's NPC dialogue
  system (a whole new interaction/UI layer, out of proportion with one atomic run).

**Done:**
- **`src/3d/gameplay/animals.js`:** `createWolf` gained `fleeClipName`/`fleeTriggerRadiusMeters`/
  `fleeSpeedMps` parameters; `update(delta)` became `update(delta, playerPosition)` (optional
  second argument — omitting it disables flee, same convention `patrolWaypoints` already uses for
  patrol). When within `fleeTriggerRadiusMeters` of `playerPosition`, flee overrides idle/patrol
  (checked first, highest priority) and the wolf runs a straight line directly away from the player
  at `fleeSpeedMps`. Extracted a small local `turnToward(targetYaw, delta)` closure — the patrol-walk
  and flee branches both needed the identical shortest-path turn logic, so this run de-duplicated it
  *within this one file* (does not touch `npc.js` — see below).
- **`src/3d/config.js`:** `ANIMAL_CONFIG` gained `FLEE_CLIP_NAME` (`01_Run_Armature_0`, confirmed
  against the source `.gltf` JSON), `FLEE_TRIGGER_RADIUS_METERS` (15), `FLEE_SPEED_MPS` (4.5, faster
  than the 2.2 patrol trot).
- **`src/3d/game3d.js`:** the wolf-spawn block now always passes `state.groundCollider` (previously
  only when patrolling — flee needs ground-height sampling too, regardless of whether a spawn also
  patrols) plus the 3 new flee options. The tick loop's `playerPos` read was moved from after the
  NPC/animal update calls to right after `player.update()`, so it can be passed into each animal's
  `update()` this frame rather than a frame late — safe because `player.update()` already moved
  `player.object3D` synchronously earlier in the same tick.
- **Why duplicate `turnToward`/movement logic instead of sharing with `npc.js`:** unchanged reasoning
  from ADR-0026 — the two files' loaders/clip-lookup APIs differ, and `npc.js` is a stable, already-
  tested FAZ 5 system not worth widening this run's blast radius into for a readability-only win at
  2 consumers. `turnToward` itself was only de-duplicated *inside* `animals.js` (patrol-walk and flee
  both needed it in the same file), not across files — see DECISIONS.md ADR-0027 for the full
  reasoning.
- **Regression guard:** `node --check` clean on all 3 touched files (`config.js`, `game3d.js`,
  `gameplay/animals.js`); no other files touched this run.
- **Real tests, not assumed correct from the code alone** (headless Chromium via Playwright,
  `http-server` serving the repo root):
  1. Pre-change regression baseline matched run 27's own documented numbers exactly (444/25 chunks,
     14 settlements, 10 NPCs, 2 animals, zero errors).
  2. Post-change full smoke test on both device classes (debug hook already removed): `"Spawned 2
     FAZ 6 animal(s)."` on both, zero new console/page errors, all other counts unchanged.
  3. **A live proximity test via a temporary debug hook** (`window.__debugGame3DState = state`,
     added only for this test and reverted before commit — confirmed via `git diff` showing zero net
     change to the committed `game3d.js`): with the player far away, the wolf's movement matched its
     normal patrol rate (unchanged baseline, confirming flee doesn't fire spuriously). Teleporting
     the player to 5m from `berkalp-wolf-1` (inside the 15m trigger) and sampling every 1.5s showed
     distance-to-player climb from 6.51m → 15.38m within ~4.5s, then the wolf settled just outside
     the 15m boundary (14.88–15.38m) once safe — confirming flee starts on proximity, runs in the
     correct direction (away), and correctly stops once clear, with no runaway/oscillation loop.
- Updated `DECISIONS.md` (new ADR-0027), this file's FAZ 6 roadmap checklist, Performance Budget
  Status, Known Issues, and this section.

**Files changed this run:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/gameplay/animals.js`,
`DECISIONS.md` (new ADR-0027), `ARCHITECTURE.md`, `src/3d/gameplay/README.md`,
`3D_GAME_PROGRESS.md` (this file). 7 files — within the ≤20-file run budget; well under the
≤800-new-line budget (the flee logic addition is ~50 hand-written lines, the rest is config/doc
updates). One commit (the whole flee slice is one atomic, revertable unit).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 27, re-verified via the same headless-
Chromium console-log method. This run added a movement-priority check, not terrain. The 100-150 km²
world-scale target itself was re-verified unchanged against `src/3d/config.js` at the start of this
run (see Session Snapshot above) — no config change was needed or made.**

**Next step for the next run:** FAZ 6's wolf is now feature-complete at first-pass player-awareness
scope (loads, idles, patrols, flees). Real remaining FAZ 6 work: the other 3 animal types (horses,
carts, dogs/cats, birds — none downloaded, each needs a human manual-download step, see Known
Issues) and any herd/pack reaction (the second wolf doesn't currently react to the first one
fleeing). Real remaining FAZ 5 work (still open, untouched this run): a dialogue/interaction system,
player-awareness/reactive behavior for NPCs (guards don't flee/alert like the wolf now does — could
reuse this run's exact pattern if wanted). FAZ 4's own remaining gap (no gravity/jump/wall-collider
physics) also remains open. No new tech debt this run — `turnToward`'s in-file de-duplication was a
genuine readability improvement with zero cross-file risk; the `npc.js`/`animals.js` duplication
tradeoff itself remains deliberate and unchanged (still 2 consumers, not 3).

## This Run (2026-07-30, run 29)

**Session Snapshot taken at start of run:**
- **Git issue found and fixed:** the container started with `HEAD` detached at `eac41ab` (run 28's
  final commit) while the local `main` ref was stale at `38e09e7` (the pre-3D-mode commit) —
  the same "local checkout artifact, not real data loss" pattern run 18 already documented (see the
  Current Status note above dated run 18). Confirmed `38e09e7` was a strict ancestor of `eac41ab`
  (`git merge-base --is-ancestor`), fast-forwarded `main` (`git checkout main && git merge eac41ab
  --ff-only`), then confirmed via `git fetch origin main` that `origin/main` already matched — the
  remote push had genuinely already succeeded; only this container's local branch ref hadn't caught
  up. No commits rewritten or discarded, no force-push used.
- Read `3D_GAME_PROGRESS.md` in full, `git log -10 --oneline`, and skimmed `DECISIONS.md`'s last 3
  ADRs (0025-0027).
- **World scale re-verified against the instruction's 100-150 km² band — already correct, no change
  made (twenty-third straight run).** Re-derived from `src/3d/config.js` directly (not the operator
  brief's own numbers, which repeat a stale 4278 km² warning every run): `METERS_PER_MAP_UNIT: 1.75`,
  25×22 chunk grid × 500m chunks = 137.5 km², inside the 100-150 km² band. No config change needed.
- **`node --check` on every `.js` file under `src/`, plus `script.js`/`service-worker.js`: all clean**
  — no syntax regressions carried over from run 28.
- **New tech-debt finding this run's own Golden-Rule re-check turned up:** `src/3d/game3d.js` was
  **610 lines — over the project's 600-line-per-file cap.** No prior run's self-review had re-run
  `wc -l` against the cap since the file was small; it crept past gradually across runs 20-28's
  incremental FAZ 5/6 spawn additions. Per the task's own priority order (tech debt ranks above
  "active phase's missing subtask" and "new feature"), this took priority over starting a brand-new
  FAZ 6 slice outright.

**Decision and work this run (two atomic, separately-reasoned changes — DECISIONS.md ADR-0028 and
ADR-0029, done in the same run since ADR-0028's fix is what created the headroom ADR-0029 needed):**

1. **Fixed the 600-line-cap regression (ADR-0028).** Moved `game3d.js`'s inline FAZ 5 NPC and FAZ 6
   animal spawn-resolution loops (seat lookup, patrol-waypoint construction, per-spawn `create*`
   call — ~100 combined lines) into `gameplay/npc.js`'s new `spawnConfiguredNPCs` and
   `gameplay/animals.js`'s new `spawnConfiguredAnimals`, a verbatim logic move (same variable names,
   same order of operations), not a rewrite. `game3d.js` now calls one function per system and keeps
   only the two setup values every spawn needs (`seatsById`, `sampleClampedGroundY`) — both genuinely
   shared across NPCs *and* animals, so they stay in the orchestrator. `game3d.js` dropped from 610
   to 552 lines.
2. **FAZ 6 herd/pack reaction (ADR-0029).** `createWolf` gained `packAlertRadiusMeters` and an
   `isFleeing` getter; `update()` gained a third optional `packmateFleePositions` argument. A wolf not
   yet within its own 15m player-trigger radius now also flees if a packmate within 20m
   (`ANIMAL_CONFIG.PACK_ALERT_RADIUS_METERS`) is already fleeing — direction is always computed away
   from the player (the actual threat), never away from the alerting packmate, reusing ADR-0027's
   existing direction math unchanged. `game3d.js`'s tick loop builds each animal's
   `packmateFleePositions` from every *other* animal's `isFleeing` getter immediately before calling
   its `update()`.

**Regression guard:** `node --check` clean on all 4 touched JS files after both changes. Full
headless-Chromium smoke test (both device classes, `python3 -m http.server` + Playwright, per the
project's standard method) confirms **zero page/console errors**, and every pre-existing count
byte-identical to run 28: `"Loaded 441 terrain chunks (~110.25 km²)"` desktop / `"Loaded 25 terrain
chunks (~6.25 km²)"` mobile, `"Placed 14 kingdom-seat settlements; 444 terrain chunks resident
(~111.00 km²)"` desktop, `"Detected 2 waterfall-grade drop(s)"` both, **`"Spawned 10 FAZ 5 NPC(s)."`**
and **`"Spawned 2 FAZ 6 animal(s)."`** both device classes — confirms ADR-0028's refactor is fully
behavior-preserving for the existing spawn/render/streaming/2D-game paths.

**Real smoke tests beyond `node --check`, verifying ADR-0029's actual pack-flee logic (not just that
nothing else broke):**
1. **Live proximity integration test** via a temporary debug hook (`window.__debugGame3DState = state`,
   added only for this test and reverted before commit — confirmed via `git diff` showing zero net
   change to the committed `game3d.js`): teleported the player next to `berkalp-wolf-1` and sampled
   both wolves' `isFleeing`/positions every 1.5s. Observed both wolves transitioning in and out of
   `isFleeing` as the player-relative distance and inter-wolf distance fluctuated during the chase —
   the moving-target scenario is noisy across 1.5s polling windows (many frames pass between samples),
   so this alone couldn't cleanly isolate the pack-only trigger path.
2. **Direct-call unit-style test** (same debug hook) calling `wolf2.update(delta, playerPosition,
   packmateFleePositions)` directly with controlled synthetic arguments, isolating the exact behavior
   ADR-0029 changed: (a) a packmate position 10m away + a player 5000m away → `isFleeing` became
   `true` and the wolf moved *away from the distant player's direction*, not toward/away from the
   packmate; (b) a packmate position 25m away (outside the 20m radius) + the same far player →
   `isFleeing` stayed `false`; (c) `playerPosition` omitted entirely + a packmate 5m away → `isFleeing`
   stayed `false` and the wolf's position stayed finite (confirms the defensive guard against a
   `NaN` velocity — described in ADR-0029 — actually holds, not just reads correctly in the diff).
   All three cases matched the intended design exactly.
- Updated `DECISIONS.md` (new ADR-0028, ADR-0029), this file's FAZ 6 roadmap checklist, Known Issues,
  and this section, `ARCHITECTURE.md` (`gameplay/npc.js`/`gameplay/animals.js`/`game3d.js` entries),
  `src/3d/gameplay/README.md`.

**Files changed this run:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/gameplay/animals.js`,
`src/3d/gameplay/npc.js`, `DECISIONS.md` (new ADR-0028, ADR-0029), `ARCHITECTURE.md`,
`src/3d/gameplay/README.md`, `3D_GAME_PROGRESS.md` (this file). 8 files — within the ≤20-file run
budget; well under the ≤800-new-line budget (the pack-flee logic itself is ~40 hand-written lines,
the spawn-function extraction is a near-verbatim move of ~100 existing lines into 2 new functions,
the rest is config/doc updates). One commit — the two decisions (ADR-0028's refactor, ADR-0029's
feature) ended up touching several of the same files closely enough (e.g. `animals.js`'s
`createWolf` signature and its new `spawnConfiguredAnimals` both reference `packAlertRadiusMeters`)
that splitting into two independently-revertable commits risked a messier diff than the benefit was
worth; both are individually described and reasoned about in their own ADR regardless.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 28, re-verified via the same headless-
Chromium console-log method (`"...444 terrain chunks resident (~111.00 km²)..."` desktop,
`"...25 terrain chunks resident...(~6.25 km²)..."` mobile). Neither this run's refactor nor its
pack-flee feature touches terrain/streaming. The 100-150 km² world-scale target itself was
re-verified unchanged against `src/3d/config.js` at the start of this run (see Session Snapshot
above) — no config change was needed or made.**

**Next step for the next run:** FAZ 6's wolves are now feature-complete at first-pass pack-awareness
scope (load, idle, patrol, flee from the player, flee from a fleeing packmate). Real remaining FAZ 6
work: the other 3 animal types (horses, carts, dogs/cats, birds — none downloaded, each needs a
human manual-download step, see Known Issues) and re-verifying pack-alert propagation once/if a 3rd
animal is ever added to the same seat (current pack-alert logic is untested beyond 2 wolves — see
ADR-0029's Consequence). Real remaining FAZ 5 work (still open, untouched this run): a dialogue/
interaction system, player/pack-awareness for NPCs (guards don't flee/alert — could reuse this run's
exact `isFleeing`/`packmateFleePositions` pattern if wanted). FAZ 4's own remaining gap (no gravity/
jump/wall-collider physics) also remains open. **Every future run's Session Snapshot should now
include a `wc -l` check against the 600-line cap on any file it's about to touch, not just when a
file "looks long"** — this run's own catch of `game3d.js` at 610 lines shows the cap can be crossed
gradually without any single run's addition looking alarming on its own. No other new tech debt this
run — the `spawnConfigured*` extraction reduces coupling (each gameplay file now owns its own spawn
wiring) rather than adding any, and `packAlertRadiusMeters`/`packmateFleePositions` are both optional,
additive parameters with no call site left passing neither.

## This Run (2026-07-30, run 30)

**Session Snapshot taken at start of run:**
- Container started with `HEAD` detached at `d464234` (run 29's final commit) while the local `main`
  ref was stale at `38e09e7` — the same recurring container-restart artifact runs 18 and 29 already
  documented. Confirmed `38e09e7` was a strict ancestor via `git merge-base --is-ancestor`, ran
  `git checkout -B main origin/main` after a fresh `git fetch origin main` confirmed `origin/main`
  already matched `d464234` exactly — the remote push had genuinely already succeeded, only this
  container's local branch ref hadn't caught up. No commits rewritten, no force-push used.
- Read `3D_GAME_PROGRESS.md` in full (Current Status, World Coverage, Performance Budget, Known
  Issues, run 27-29's logs), `git log -10 --oneline`, and DECISIONS.md's last 5 ADRs (0025-0029).
  `ARCHITECTURE.md` was last touched this same day (run 29) — no 7-day re-read needed.
- **World scale re-verified against the instruction's 100-150 km² band — already correct, no change
  made (twenty-fourth straight run).** Re-derived from `src/3d/config.js` directly:
  `METERS_PER_MAP_UNIT: 1.75`, 25×22 chunk grid × 500m chunks = 137.5 km², inside the 100-150 km²
  band. No config change needed.
- **`node --check` on every `.js` file under `src/` (excluding vendored `three.js`/addons), plus
  `script.js`/`service-worker.js`: all clean.** No file over the 600-line cap (`game3d.js` sits at
  552 lines, the closest to the ceiling).
- **Live smoke-tested the baseline itself before touching anything** (both device classes, headless
  Chromium via `python3 -m http.server` + Playwright, `hasTouch`/`isMobile` context flags for the
  mobile pass): zero console/page errors, every count byte-identical to run 29's own documented
  numbers (`"...444 terrain chunks resident (~111.00 km²)..."` desktop, `"...25 terrain chunks
  resident...(~6.25 km²)..."` mobile, `"Spawned 10 FAZ 5 NPC(s)."` and `"Spawned 2 FAZ 6
  animal(s)."` both). No syntax errors, no blocking bugs, no perf-budget overrun, no memory-leak
  regression, no missing regression test found beyond the one already flagged below.
- No new tech debt found this run beyond what run 29 already flagged. Per the task's own priority
  order, with no higher-priority item (syntax/blocking-bug/perf/memory-leak/tech-debt/missing-test)
  found, and desktop World Coverage already clearing the FAZ 3/10 80% gate (mobile's lower coverage
  is a deliberate, documented perf-budget tradeoff, not a bug — see Known Issues), the next item is
  the active phase's (FAZ 6) own flagged open sub-task: **"a 3rd animal's chained pack-alert
  propagation is unverified"** (ADR-0029's Consequence, repeated in run 29's own "Next step").

**Decision and work this run (one atomic change — DECISIONS.md ADR-0030):**

Added `berkalp-wolf-3` to `ANIMAL_CONFIG.SPAWNS` (`src/3d/config.js`) — config-only, reusing the
already-downloaded `WOLF_MODEL_URL`, no new asset, no code change to `game3d.js`/`animals.js` (the
tick loop's `packmateFleePositions` construction was already generic over `state.animals`, built by
ADR-0029). Positioned deliberately (~14.4m from `berkalp-wolf-2`, ~28.8m from `berkalp-wolf-1`) so a
genuine 3-hop pack-alert chain is the only path that can bring it into `isFleeing`. See ADR-0030 for
the exact reasoning and the full verification method.

**Regression guard:** `node --check` clean on `config.js`. Full smoke test on both device classes
after the change: `"Spawned 3 FAZ 6 animal(s)."` (up from 2) on both, zero console/page errors, every
other count (terrain chunks, settlements, NPCs, river/waterfalls) byte-identical to run 29 — confirms
this is a purely additive spawn with no regression to any existing system.

**Chain-propagation verification (the actual point of this run's work, not just "nothing broke"):**
a temporary debug hook (`window.__debugGame3DState = state`, reverted before commit — confirmed via
`git diff` showing zero net change to the committed `game3d.js`) let a Playwright script call all
three wolves' `update(delta, playerPosition, packmateFleePositions)` directly across 3 simulated
frames, mirroring exactly how `game3d.js`'s real tick loop builds each frame's
`packmateFleePositions` argument:
1. Baseline (player far away, no packmate positions): all three `isFleeing === false`.
2. Confirmed the live fixture's actual spawn-time distances matched `config.js`'s doc-comment math
   (wolf1↔wolf2 ≈14.42m, wolf2↔wolf3 ≈14.42m, wolf1↔wolf3 ≈28.84m) — the test wasn't accidentally
   exercising the wrong geometry.
3. Frame 1 (player near wolf-1, nobody's packmate list populated yet): wolf-1 fled directly; wolf-3
   correctly stayed calm. (Wolf-2 also read `true` this frame, but via its own independent direct
   15m player-trigger — an expected, harmless overlap of the two wolves' 14.4m spacing, not a
   pack-logic artifact; confirmed by inspecting the direct-trigger term in isolation.)
4. Frame 2 (wolf-2 given wolf-1's real post-frame-1 position; wolf-3 given nothing): wolf-3 stayed
   `false` — it doesn't react to "someone, somewhere" fleeing, only to its own in-range packmate.
5. Frame 3 (wolf-3 given wolf-2's real post-frame-2 position): wolf-3 `isFleeing → true` — the chain
   completes exactly one frame after wolf-2's own pack-flee, matching ADR-0029's documented one-frame
   lag.
6. **Negative control:** repeated frame 3's setup but handed wolf-3 wolf-1's (out-of-range, ~28.8m)
   position instead of wolf-2's — wolf-3 stayed `false`, ruling out a bug where any packmate entry
   regardless of distance would trigger flee.
Zero console/page errors throughout.

- Updated `DECISIONS.md` (new ADR-0030), this file's Current Status, Performance Budget Status, and
  Known Issues sections, and this section. `ARCHITECTURE.md`/`gameplay/README.md` needed no edit —
  neither hardcodes a wolf count, both already describe `ANIMAL_CONFIG.SPAWNS` generically.

**Files changed this run:** `src/3d/config.js`, `DECISIONS.md` (new ADR-0030), `3D_GAME_PROGRESS.md`
(this file). 3 files — well within the ≤25-file chained-run budget; the code change itself is one
9-line config entry (well under the ≤1200-new-line chained-run budget), the rest is documentation.
One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 29, re-verified via the same headless-
Chromium console-log method. This run's change (one more wolf) touches neither terrain nor
streaming. The 100-150 km² world-scale target itself was re-verified unchanged against
`src/3d/config.js` at the start of this run — no config change was needed or made.**

**Next step for the next run:** FAZ 6's pack-alert mechanism is now verified to chain across 3+
animals, not just adjacent pairs — the one gap ADR-0029 flagged is closed. Real remaining FAZ 6
work: the other 3 animal types (horses, carts, dogs/cats, birds — none downloaded, each needs a
human manual-download step, see Known Issues). Real remaining FAZ 5 work (still open, untouched this
run): a dialogue/interaction system, player/pack-awareness for NPCs (guards don't flee/alert — could
reuse this run's/ADR-0029's exact pattern if wanted). FAZ 4's own remaining gap (no gravity/jump/
wall-collider physics) also remains open. No new tech debt this run — `berkalp-wolf-3` is a plain
`SPAWNS` entry, the same shape every other wolf/NPC uses, consumed by already-generic code.

## This Run (2026-07-30, run 31)

**Chained sub-task within the same execution as run 30** (per the operator's updated instruction:
after run 30's commit passed its own regression guard and smoke test, with budget/time still
available, continued to the next atomic item rather than stopping).

**Session Snapshot re-taken at the start of this sub-task:** `node --check` still clean on every
`.js` file (including run 30's just-committed `config.js` change), no file over the 600-line cap,
both device-class smoke tests still byte-identical to run 30's own numbers (`"Spawned 3 FAZ 6
animal(s)."`, `"Spawned 10 FAZ 5 NPC(s)."`, `"...444 terrain chunks resident (~111.00 km²)..."`
desktop / `"...25 terrain chunks resident...(~6.25 km²)..."` mobile, zero errors both). No new
syntax/blocking-bug/perf/memory-leak/tech-debt issue found. World scale re-verified against
`src/3d/config.js` directly — still 137.5 km², inside the 100-150 km² band, no change needed
(twenty-fifth straight confirmation). With FAZ 6's own flagged gap now closed by run 30, the next
item per the task's priority order was FAZ 5's own remaining open sub-task: 4 of 14 kingdom seats
(`berk`, `olena`, `twin`, `Xaro`) still had zero NPCs (`Night King` deliberately excluded, ADR-0024).

**Decision and work this run (one atomic change — DECISIONS.md ADR-0031):** Added `xaro-guard-1` to
`NPC_CONFIG.SPAWNS` at the `Xaro` (Qarth) kingdom seat — config-only, reusing the already-downloaded
`dreyar.fbx` (already placed once at `umit`), no new asset, no code change. Chose `Xaro` over
`berk`/`olena`/`twin` for house diversity (Qarth has zero existing NPC presence; the other three
duplicate an already-represented house), matching ADR-0024's own stated reasoning. See ADR-0031 for
the full decision.

**Regression guard:** `node --check` clean on `config.js`. Full smoke test on both device classes:
`"Spawned 11 FAZ 5 NPC(s)."` (up from 10), zero console/page errors, every other count (terrain,
settlements, animals, river/waterfalls) byte-identical to the pre-change baseline — confirms this is
a purely additive spawn.

- Updated `DECISIONS.md` (new ADR-0031), this file's Current Status, Known Issues sections, and this
  section. `ARCHITECTURE.md`/`gameplay/README.md` needed no edit — neither hardcodes an NPC count.

**Files changed this run:** `src/3d/config.js`, `DECISIONS.md` (new ADR-0031), `3D_GAME_PROGRESS.md`
(this file). 3 files — the code change itself is one 9-line config entry plus a small doc-comment
update. One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 30 (this run's change touches neither
terrain nor streaming).**

**Cumulative for this chained execution (runs 30+31 combined):** 2 atomic sub-tasks, 2 commits, 6
files touched total (`src/3d/config.js`, `src/3d/game3d.js` reverted to zero net diff, `DECISIONS.md`,
`3D_GAME_PROGRESS.md`) — well within the ≤25-file/≤1200-new-line chained-run budget (combined new
code is ~20 lines across two config-only spawn entries; the remainder is documentation). Both
sub-tasks passed their own independent regression guard and smoke test before committing.

**Next step for the next run:** FAZ 5's remaining real gaps: 3 kingdom seats still without any NPC
(`berk`, `olena`, `twin` — each would now duplicate an already-represented house, or need a new
human-downloaded asset for further diversity), a dialogue/interaction system, and player/pack-
awareness for NPCs (could reuse ADR-0029's exact `isFleeing`/`packmateFleePositions` pattern if
wanted, though a guard fleeing the player reads narratively odd — worth reconsidering the design, not
just copy-pasting, before building it). FAZ 6's remaining real gap: the other 3 animal types (horses,
carts, dogs/cats, birds), each needing a human manual-download step. FAZ 4's own remaining gap (no
gravity/jump/wall-collider physics) also remains open. No new tech debt this run — `xaro-guard-1` is
a plain `SPAWNS` entry, the same shape every other single-NPC seat already uses.

## This Run (2026-07-30, run 32)

**Third chained sub-task within the same execution as runs 30-31** (per the operator's updated
instruction: after run 31's commit passed its own regression guard and smoke test, with budget/time
still available, continued to the next atomic item rather than stopping).

**Session Snapshot re-taken at the start of this sub-task:** `node --check` still clean on every
`.js` file (including run 31's just-committed `config.js` change), no file over the 600-line cap,
both device-class smoke tests still byte-identical to run 31's own numbers (`"Spawned 11 FAZ 5
NPC(s)."`, `"Spawned 3 FAZ 6 animal(s)."`, zero errors both). No new syntax/blocking-bug/perf/
memory-leak/tech-debt issue found. World scale re-verified — still 137.5 km², no change needed
(twenty-sixth straight confirmation). With FAZ 6's gap closed by run 30 and FAZ 5's kingdom-seat gap
narrowed by run 31, the next item per the task's priority order was FAZ 5's other real, longer-
standing open gap: "no dialogue/interaction system," flagged since run 20.

**Decision and work this run (one atomic change — DECISIONS.md ADR-0032):** Deliberately scoped down
from "build the dialogue system" (too large for one atomic, reviewable slice, and requires content/
UX decisions beyond this run's remit) to its smallest real first step: a proximity *affordance* only.
Added `INTERACTION_CONFIG.PROMPT_RADIUS_METERS` (`config.js`) and a new `ui/interactionPrompt.js`
module (`InteractionPrompt`, following `ui/touchJoystick.js`'s exact DOM-ownership pattern).
`game3d.js`'s tick loop shows a static "E - Selamla" prompt whenever the player is within 6m of any
NPC — no keypress handling, no dialogue content, no per-NPC identity yet. Registered in
`service-worker.js`'s `GAME3D_SHELL_FILES`. See ADR-0032 for the full reasoning.

**Regression guard:** `node --check` clean on all 4 touched files (`config.js`, `game3d.js`,
`interactionPrompt.js`, `service-worker.js`). `game3d.js` grew from 552 to 564 lines — still
comfortably under the 600-line cap. Full smoke test on both device classes: zero console/page
errors, every existing count byte-identical to the pre-change baseline — confirms this is purely
additive.

**Prompt-toggle verification (the actual point of this run's work, not just "nothing broke"):** a
temporary debug hook (`window.__debugGame3DState = state`, reverted before commit — confirmed via
`git diff` showing zero net change to the committed `game3d.js`) let a Playwright script confirm
`.g3d-interaction-prompt` exists in the DOM with the `hidden` attribute set by default, then
teleported the player 500m from every NPC (attribute stayed `hidden`) and 2m from one (attribute was
removed) — both checked against the real DOM element, not just the boolean distance math.

- Updated `DECISIONS.md` (new ADR-0032), `ARCHITECTURE.md` (new `interactionPrompt.js` entry),
  `src/3d/ui/README.md` (new file entry + convention note), this file's Current Status and Known
  Issues sections, and this section.

**Files changed this run:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/ui/interactionPrompt.js`
(new), `service-worker.js`, `ARCHITECTURE.md`, `src/3d/ui/README.md`, `DECISIONS.md` (new ADR-0032),
`3D_GAME_PROGRESS.md` (this file). 8 files — the code change itself is ~50 new lines across 4 files;
the rest is documentation. One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 31 (this run's change is a DOM overlay, not
a Three.js mesh, and touches neither terrain nor streaming).**

**Cumulative for this chained execution (runs 30+31+32 combined):** 3 atomic sub-tasks, 3 commits,
~10 distinct files touched total across the whole chain — within the ≤25-file/≤1200-new-line
chained-run budget (combined new code across all three sub-tasks is well under 100 lines; the
remainder is documentation). Each sub-task passed its own independent regression guard and smoke
test before committing.

**Next step for the next run:** FAZ 5's remaining real gaps: the actual dialogue system (keypress
handling + per-NPC content — a genuinely separate design decision from this run's affordance-only
prompt), 3 kingdom seats still without any NPC (`berk`, `olena`, `twin`), and player/pack-awareness
for NPCs (worth reconsidering the design before building — a guard fleeing the player character reads
narratively odd, unlike a wolf fleeing a hunter). FAZ 6's remaining real gap: the other 3 animal
types, each needing a human manual-download step. FAZ 4's own remaining gap (no gravity/jump/wall-
collider physics) also remains open. No new tech debt this run — `InteractionPrompt` follows
`TouchJoystick`'s proven shape exactly, and the tick-loop distance check reuses the same
`.some()`/`Math.hypot` pattern already used one function away for animal flee triggers.

## This Run (2026-07-30, run 33)

**Fourth chained sub-task within the same execution as runs 30-32** (continued past run 32's commit
since its regression guard and smoke test both passed and budget/time remained — per the operator's
explicit "complete the next sub-task too, don't stop" instruction for this run).

**Session Snapshot re-taken at the start of this sub-task:** `node --check` still clean on every
`.js` file, no file over the 600-line cap, both device-class smoke tests byte-identical to run 32's
own numbers. World scale re-verified — still 137.5 km², no change needed (twenty-seventh straight
confirmation). With no higher-priority syntax/blocking-bug/perf/memory-leak/tech-debt issue found,
the next item was FAZ 5's other half of "no dialogue/interaction system": run 32 shipped the
proximity affordance, but pressing E still did nothing.

**Decision and work this run (one atomic change — DECISIONS.md ADR-0033):** Wired the actual
keypress. `gameplay/npc.js`'s `createNPC` now exposes `displayName` on its returned object (a
minimal, additive field). New `ui/dialogueBox.js` (same DOM-ownership pattern as
`interactionPrompt.js`/`touchJoystick.js`). `config.js`'s `INTERACTION_CONFIG` gained
`GREETING_TEMPLATE` (one generic `{name}`-templated line, not real per-NPC content). New
`gameplay/interaction.js` (`createInteractionController`) owns the actual state machine — nearest-
NPC tracking, `KeyE` open/close toggle (`event.repeat`-guarded), `Escape` close, and distance-based
auto-close. This was extracted into its own module *after* an inline version pushed `game3d.js` to
615 lines (over the 600-line cap) — caught by this run's own re-check before committing, and fixed
the same way ADR-0028 fixed an identical regression: move the self-contained logic to its own file.
`game3d.js` settled at 574 lines after the extraction.

**Regression guard:** `node --check` clean on all 6 touched/new files (`config.js`, `game3d.js`,
`gameplay/npc.js`, `gameplay/interaction.js` [new], `ui/dialogueBox.js` [new], `service-worker.js`).
Full smoke test on both device classes: zero console/page errors, every existing count byte-
identical to run 32's own numbers — confirms this is purely additive.

**Keypress-flow verification (the actual point of this run's work):** a temporary debug hook
(`window.__debugGame3DState = state`, reverted before commit — confirmed via `git diff` showing
zero net change to the committed `game3d.js`) let a Playwright script drive **real**
`page.keyboard.press()` events (not direct function calls) through a 5-step open/close/open/
Escape-close/reopen sequence, checking the dialogue box's actual DOM `hidden` attribute and its text
content after each step. All 5 steps matched the intended toggle. A captured real-event log
confirmed `event.repeat` was `false` for every distinct press, and a synthetic `repeat: true` call
confirmed a simulated held-key repeat is correctly ignored.

**A false alarm worth recording (see ADR-0033's own account in full):** an earlier version of this
same test — without re-teleporting the player before each step — intermittently showed the final
"reopen" step failing. Debug logging traced this to *correct* auto-close behavior: the target NPC
patrols on a fixed route and, over the test's real elapsed wall-clock time, walked far enough from
the stationary test player to exit the 6m interaction radius on its own. Re-running with the player
re-teleported next to the NPC's current position before each step (removing patrol drift as a
confound) reproduced the correct toggle every time. Not a bug — recorded in ADR-0033 so a future run
re-investigating a similar report doesn't have to re-derive this explanation from scratch.

- Updated `DECISIONS.md` (new ADR-0033), `ARCHITECTURE.md` (new `gameplay/interaction.js` and
  `ui/dialogueBox.js` entries, updated `npc.js`/`interactionPrompt.js` entries), `src/3d/ui/README.md`
  and `src/3d/gameplay/README.md` (new file entries), this file's Current Status and Known Issues
  sections, and this section.

**Files changed this run:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/gameplay/npc.js`,
`src/3d/gameplay/interaction.js` (new), `src/3d/ui/dialogueBox.js` (new), `game3d.css`,
`service-worker.js`, `ARCHITECTURE.md`, `src/3d/ui/README.md`, `src/3d/gameplay/README.md`,
`DECISIONS.md` (new ADR-0033), `3D_GAME_PROGRESS.md` (this file). 12 files — the code change itself
is under 150 new lines across 5 files; the rest is documentation. One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 32 (this run's change is a DOM overlay + a
keydown listener, not a Three.js mesh, and touches neither terrain nor streaming).**

**Cumulative for this chained execution (runs 30+31+32+33 combined):** 4 atomic sub-tasks, 4
commits, ~14 distinct files touched total across the whole chain — within the ≤25-file/
≤1200-new-line chained-run budget (combined new code across all four sub-tasks is roughly 250-300
lines; the remainder is documentation). Each sub-task passed its own independent regression guard
and smoke test before committing, and one (this one) caught and fixed its own 600-line-cap
regression before committing rather than after.

**Next step for the next run:** FAZ 5's remaining real gaps: actual dialogue *content*
(per-NPC personality/branching/reply options/quest hooks — a real content-design decision, not a
config constant), 3 kingdom seats still without any NPC (`berk`, `olena`, `twin`), and player/pack-
awareness for NPCs (still needs its own design reconsideration, per run 32's note — a guard fleeing
the player character reads narratively odd). FAZ 6's remaining real gap: the other 3 animal types,
each needing a human manual-download step. FAZ 4's own remaining gap (no gravity/jump/wall-collider
physics) also remains open. No new tech debt this run — the `gameplay/interaction.js` extraction
*reduces* coupling (same reasoning ADR-0028 already established), and `displayName` on the NPC
controller is a plain additive field no existing caller needs to change for.

## This Run (2026-07-30, run 34)

**Session Snapshot re-taken at container boot:** found `HEAD` detached at run 33's own final commit
(`64519ee`) with local `main` still pointing at the pre-3D-mode commit (`38e09e7`) — the exact
recurring container-restart pattern documented in this file's "Repo-continuity note" (runs 18, 29,
30). Confirmed `origin/main` already matched the detached `HEAD` (the push had succeeded); fast-
forwarded local `main` (`git checkout main && git merge 64519ee --ff-only`) — no rewrite, no force,
strictly a stale-local-ref fix. `node --check` re-verified clean on every non-vendor `.js` file
(zero failures across `src/3d/**`, `script.js`, `service-worker.js`), no file over the 600-line cap
(`game3d.js` still the largest at 574), both `assets_manifest.json`/`manifest.json` valid JSON.
World scale re-derived from `config.js` once more — still 137.5 km², no change needed (twenty-eighth
straight confirmation).

**Decision and work this run (one atomic change — DECISIONS.md ADR-0034):** With no syntax error,
blocking bug, perf-budget overrun, or memory leak found, and no run-length-appropriate tech-debt
item open besides the one already called out by name in Known Issues, picked that item per the
priority order (5. Technical debt, ahead of 6. missing coverage / 7-9 feature work): "no automated
check that `assets_manifest.json` matches `assets/`." Added `scripts/checkAssetsManifest.js` (new
`scripts/` directory) — a dependency-free Node script that hard-fails on a manifest entry pointing
at a missing file or an unregistered `.fbx`/`.glb` on disk, and soft-warns (non-fatal) on
unreferenced texture/sidecar files. See ADR-0034 for the full design and alternatives considered.

**Regression guard:** `node --check scripts/checkAssetsManifest.js` clean. Ran against the real repo
state: exit 0, all 12 manifest entries resolve, all `.fbx`/`.glb` files on disk registered, 20
expected sidecar files (wolf/dragon textures + the wolf's unused `.gltf`/`.bin` alternate encoding
of its already-registered `.glb`) correctly reported as non-fatal warnings. Both hard-fail paths
independently verified against temporary test fixtures (a manifest copy with one entry's `file`
pointed at a nonexistent path; a throwaway empty `.fbx` dropped into `assets/models/characters/`) —
each correctly exited 1 with the specific offending path listed; both fixtures were removed/restored
before commit, confirmed via `git status --short` showing no unintended tracked-file diff. Full
project smoke test unaffected by this subtask (a new dev-tooling script only, never imported by any
browser-loaded file) — no `game3d.js`/browser-facing file was touched, so no re-run of the
headless-Chromium checks was needed for this specific change; existing figures (444/25 terrain
chunks, both device classes) stand unchanged from run 33.

**Memory-leak checklist:** N/A — this subtask adds a one-shot Node CLI script (no browser runtime
code, no event listeners, no `THREE.*` object allocation, no long-lived state); process exits
immediately after `main()` returns.

- Updated `DECISIONS.md` (new ADR-0034), `ARCHITECTURE.md` (new `scripts/checkAssetsManifest.js`
  entry), this file's Known Issues section (marked resolved) and this section.

**Files changed this run:** `scripts/checkAssetsManifest.js` (new), `ARCHITECTURE.md`,
`DECISIONS.md` (new ADR-0034), `3D_GAME_PROGRESS.md` (this file). 4 files, 129 new lines of code
(the script itself) plus documentation. One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 33 (this subtask is a dev-tooling script,
touches no terrain/streaming/rendering code).**

**Second chained sub-task within this same run (per the operator's "don't stop after one" rule —
regression guard and smoke test both passed and budget/time remained):** with technical debt's
named item now paid down (ADR-0034), re-scanned the priority order fresh — still no syntax error,
blocking bug, perf-budget overrun, or memory leak — and landed on priority 6, missing smoke-test/
regression coverage: every prior run's own smoke test was a throwaway script, never committed.

**Decision and work (DECISIONS.md ADR-0035):** Added `scripts/smokeTestGame3D.js` — starts a local
static file server (plain Node `http`), then in headless Chromium (1) loads `game3d.html` and waits
for its existing `#game3d-loading` element to gain `g3d-loading-hidden` (the real `EVENTS.GAME_READY`
DOM signal `game3d.html`'s own inline script already sets) as the hard gate, failing on a timeout,
an `g3d-loading-error` outcome, or any console/page error; (2) loads `index.html` (2D shell) and
reports console/page errors informationally without failing on them — a direct Playwright trace
showed every error there traces to this sandbox's own external-CDN network restriction (gstatic/
cloudflare/fonts.googleapis all `net::ERR_CONNECTION_RESET`, cascading into `firebase is not
defined`) or to `resimler/`/`videolar/` paths that don't exist anywhere in this git checkout at all
— neither a code regression, and hard-failing on either would make the check permanently red
regardless of correctness. See ADR-0035's Investigation section for the full trace.

**Regression guard — verified with a real injected failure, not just reasoning:** `node --check`
clean (220 lines). Ran clean against the real repo (both checks PASS, exit 0). Then temporarily
added `throw new Error(...)` as `initGame3D()`'s first line, re-ran the script — correctly reported
`FAIL` for the 3D-mode check with the exact injected error/stack trace, exit code 1 — confirming the
failure path actually works, not just the happy path. Restored `game3d.js` immediately after;
`diff` against a pre-edit backup and the final `git diff --stat`/`git status` both confirm a
byte-identical restore (zero net change to that file in this run's commit).

**Memory-leak checklist:** N/A — one-shot Node CLI script (server + browser both explicitly closed
in a `finally` block before `process.exit`), no long-lived browser-side state of its own.

- Updated `DECISIONS.md` (new ADR-0035), `ARCHITECTURE.md` (new `scripts/smokeTestGame3D.js`
  entry), and this section.

**Files changed this sub-task:** `scripts/smokeTestGame3D.js` (new), `ARCHITECTURE.md`,
`DECISIONS.md` (new ADR-0035), `3D_GAME_PROGRESS.md` (this file). 4 files, 220 new lines of code
(the script itself) plus documentation. One commit, separate from the ADR-0034 sub-task's commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged (this sub-task is dev-tooling only, touches no
terrain/streaming/rendering code; the smoke test's own PASS output for `game3d.html` re-confirms
the 3D mode still boots to `GAME_READY` cleanly).**

**Third chained sub-task within this same run:** with both readily-available tech-debt/coverage gaps
closed (ADR-0034/ADR-0035), re-scanned the priority order fresh once more — still no syntax error,
blocking bug, perf-budget overrun, memory leak, or open tech-debt item — landing on priority 8,
missing subtask of the active phase: FAZ 5's own Known Issues named exactly one remaining mechanical
(non-content-decision) gap, the 3 kingdom seats (`berk`/`olena`/`twin`) still without any NPC.

**Decision and work (DECISIONS.md ADR-0036):** Added 3 entries to `config.js`'s `NPC_CONFIG.SPAWNS`
— `berk-guard-1`, `olena-guard-1`, `twin-guard-1` — each reusing an already-downloaded/precached
character model (no new asset), the same offset/rotation/patrol geometry every other entry already
uses, and each house's existing guard displayName (`berk`/`olena` are both Tyrell, already
represented at `ziya`; `twin` is Lannister, already represented at `cersei` — the last genuinely
*new* house was already used by run 31's `Xaro`). Zero code change — `game3d.js`/`gameplay/npc.js`'s
existing generic spawn-resolution loop (ADR-0028) picks up new `SPAWNS` entries automatically.

**Regression guard:** `node --check src/3d/config.js` clean (520 lines, under the 600-line cap).
`node scripts/checkAssetsManifest.js` (this run's own sub-task 1) still exits 0 — no new asset files,
nothing new to register. `node scripts/smokeTestGame3D.js` (this run's own sub-task 2) passed both
before and after this change, run twice for confidence — the 3D-mode check specifically asserts zero
`console.error`, and `assetLoader.js`'s FBX-load fallback always logs a `console.error` on any load
failure before substituting a placeholder box, so a clean pass is direct evidence all 3 new model
references actually resolved, not merely that nothing crashed. (An ad-hoc supplementary diagnostic
script attempting to also capture the exact "Spawned N FAZ 5 NPC(s)" console line intermittently
timed out launching a 3rd headless Chromium instance back-to-back in the same session — a resource/
timing artifact of the diagnostic itself, not the app; the actual committed smoke test's repeated,
consistent PASS results are the real evidence and were treated as authoritative.)

**Memory-leak checklist:** N/A — purely additive static config data (frozen objects in an
already-frozen array), no new event listener, timer, or long-lived allocation.

- Updated `DECISIONS.md` (new ADR-0036), this file's Current Status and Known Issues sections, and
  this section. `ARCHITECTURE.md` needed no change — its existing `NPC_CONFIG`/`spawnConfiguredNPCs`
  entries already describe the mechanism generically, not a specific NPC count.

**Files changed this sub-task:** `src/3d/config.js`, `DECISIONS.md` (new ADR-0036),
`3D_GAME_PROGRESS.md` (this file). 3 files, ~30 new lines of config plus documentation. One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged (3 more characters is not a terrain/streaming
change, same reasoning every prior NPC-adding run already established).**

**Cumulative for this chained execution (run 34's three sub-tasks):** 3 atomic sub-tasks, 3 commits,
9 distinct files touched total (`scripts/checkAssetsManifest.js`, `scripts/smokeTestGame3D.js`,
`src/3d/config.js`, `ARCHITECTURE.md`, `DECISIONS.md`, `3D_GAME_PROGRESS.md`, plus the fast-forward
of `main` itself) — well within the ≤25-file/≤1200-new-line chained-run budget (combined new code
is ~380 lines across all three sub-tasks; the remainder is documentation). Each sub-task passed its
own independent regression guard before its own commit — two of the three included a real
fault-injection test (a bad manifest path/an unregistered model file for ADR-0034, a thrown error
inside `initGame3D` for ADR-0035), and the third (ADR-0036) relied on the now-committed smoke test
from sub-task 2, run twice.

**Next step for the next run:** all readily-available tech-debt/coverage/mechanical-gap items this
run's scans turned up are now closed. A fresh priority-order scan next run will very likely land on
FAZ 5/6's remaining *real* gaps, each needing either a content-design decision or a human
manual-download step, not a mechanical fix: FAZ 5's actual dialogue content (per-NPC personality/
branching/reply options/quest hooks) and NPC player/pack-awareness (needs its own design
reconsideration — a guard fleeing the player character reads narratively odd, per run 32's note);
FAZ 6's other 3 animal types (horses, carts, dogs/cats, birds — each needs a human manual-download
step); FAZ 4's own remaining gap (no gravity/jump/wall-collider physics). A future run could also
wire `scripts/checkAssetsManifest.js` and `scripts/smokeTestGame3D.js` into a lightweight
pre-commit hook if that friction becomes real, but that would be speculative today (see both ADRs'
Consequence sections).

## This Run (2026-07-30, run 35)

**Fresh state re-derivation at start of run** (per the operator's explicit "devam et" / continue
instruction — nothing assumed carried over): repo was already clean and `main` up to date with
`origin/main` at `3a417b9` (run 34's third commit) — no detached-HEAD/stale-ref issue this time.
Re-read `3D_GAME_PROGRESS.md`'s Current Status/Roadmap/Known Issues, `git log -10`, `DECISIONS.md`'s
last 3 ADRs (0034/0035/0036), and re-ran `node --check` across every non-vendor `.js` file (all
pass) plus `node scripts/smokeTestGame3D.js` as the pre-subtask Regression Guard baseline (both
checks PASS, zero console/page errors). World scale re-confirmed at 137.5 km² (no change) and World
Coverage unchanged from run 34's figures (see below) — nothing in priorities 1-7 had anything new to
act on (no syntax error, blocking bug, perf overrun, memory leak, open tech-debt item, missing
smoke-test coverage, or a coverage-gate failure — coverage is already clear of both gates).

**Correcting the prior run's stale framing:** the instruction handed into this run named "FAZ 1's
remaining sky.js work" as the priority-8 candidate, but re-deriving state (not assuming) showed FAZ 1
has been ✅ TAMAMLANDI since run 5, and `sky.js` itself has existed and been fully wired in since run
4 — there was no remaining sky.js work to do. Re-scanning the actual current Roadmap for the true
priority-8 candidate (a missing subtask of an *actually* in-progress phase) found FAZ 3 — still
explicitly "(in progress)" — had exactly one named open item pair: "Basit LOD/collider." Of the two,
the collider half matched a real, separately-named, previously-unresolved gap (`camera.js`'s own
Known Issues entry: "the *player* can still walk through castle walls"), while LOD had no measured
perf need behind it (`settlements.js`'s `InstancedMesh` already holds castle rendering to 3 draw
calls total regardless of distance — no perf-budget overrun anywhere near this). Picked the collider
as this run's one atomic sub-task; left LOD as the (correctly, still-real) remaining FAZ 3 item.

**Decision and work (DECISIONS.md ADR-0037):** Added `physics.js`'s `createSettlementCollider(seats,
settlementConfig, playerRadiusMeters)` — per kingdom seat, an axis-aligned box matching the keep's
real footprint plus a circle at each of the 4 corner towers' real positions (same
`SETTLEMENT_CONFIG` dimensions `world/settlements.js` builds the visible geometry from), each grown
by a small player-radius margin so the character's own mesh doesn't visually poke through. Wired
into `gameplay/player.js`: `createPlayer` now accepts an optional `settlementCollider` and, on every
frame with movement input, resolves the candidate next `(x, z)` through it *before* ground-height
sampling — mirroring the existing `groundCollider` dependency-injection shape rather than reaching
into `world/settlements.js` directly (keeps the "physics.js owns collision" folder-ownership rule
intact). `game3d.js` builds the one shared `settlementCollider` instance from `settlementsResult.
seats` + `SETTLEMENT_CONFIG` and threads it into `createPlayer`'s options — 3 files touched
(`physics.js`, `gameplay/player.js`, `game3d.js`), no new file, no EventBus involvement needed since
this is the same kind of direct-dependency wiring `groundCollider` already used, not cross-system
communication.

**A real bug found and fixed during verification (not just written and assumed correct):** an
isolated unit test of the tower-circle push-out found that a point landing *exactly* on a tower's
center (distance 0) was silently left unresolved — the original zero-distance guard (`distance >
1e-6`) meant to avoid a divide-by-zero also skipped the correction entirely in that exact case.
Fixed by special-casing `distance < 1e-6` to kick the point out along a fixed `+X` direction instead
of skipping it (the escape direction doesn't matter at that singular point, only that it always
escapes). Real per-frame player movement essentially never lands on that exact point, but a collider
that can silently fail to resolve isn't a safe primitive to ship — caught by testing the actual
edge case, not just the common path.

**Regression guard — verified beyond `node --check`, with real behavioral proof:**
1. `node --check` clean on `physics.js` (120 lines), `gameplay/player.js` (114 lines), `game3d.js`
   (579 lines — re-measured against the 600-line cap per the standing checklist item from run 29;
   still comfortably under). `node scripts/checkAssetsManifest.js` still exits 0 (no asset files
   touched). `node scripts/smokeTestGame3D.js` PASS on both checks, before and after this change.
2. **Isolated collider math**, run in-browser (real `three`-resolved ES modules via the existing
   import map, not Node's `require`, since `physics.js` has no non-browser test harness): a point at
   a synthetic castle's exact center is pushed to precisely the keep's half-extent (17.4m, i.e.
   `KEEP_WIDTH_METERS/2 + playerRadiusMeters`); a point far away is a no-op; a point exactly on a
   tower's center is pushed to exactly the tower's radius (the edge-case fix above, confirmed
   working); and — the most direct proof this actually blocks movement, not just that isolated calls
   don't throw — 3000 simulated per-frame forward steps (the same shape `player.js`'s own `update()`
   loop uses) walking straight at the keep center from 60m away come to rest at *exactly* 517.4
   (17.4m short of the center), never penetrating further despite 3000 more attempts to.
3. **Live integration sanity**, real headless-Chromium session against `game3d.html`: held `D` for
   3 seconds of normal open-field movement (nowhere near any castle) — zero console/page errors,
   confirming the new `settlementCollider` wiring doesn't break ordinary movement, the much more
   common case than castle-adjacent movement.
4. Reviewed `gameplay/player.js`'s diff directly: `settlementCollider` is optional (defaults to
   `null`, a no-op when omitted) so any future caller/test constructing a player without one still
   works exactly as before this change.

**Memory-leak checklist:** No new `THREE.*` geometry/material/texture allocated by
`createSettlementCollider` — it's pure per-call arithmetic over the same `seats` array
`world/settlements.js` already owns and disposes; no event listener, timer, or long-lived resource
added. `disposeSettlements`'s existing cleanup is untouched and still the sole owner of the castles'
actual GPU resources.

**Performance:** `resolveXZ` is O(seat count) = O(14) simple arithmetic comparisons per moving
frame, no allocation in the common (no-op) path — negligible against any per-frame budget, not
re-measured with a dedicated FPS pass (same SwiftShader-software-rendering sandbox caveat as every
prior run).

**Files changed this run:** `src/3d/physics.js`, `src/3d/gameplay/player.js`, `src/3d/game3d.js`,
`DECISIONS.md` (new ADR-0037), `3D_GAME_PROGRESS.md` (this file — FAZ 3 checklist, two Known Issues
entries, this section), `ARCHITECTURE.md` (updated `physics.js`/`gameplay/player.js` entries). 6
files, ~95 new lines of code (`physics.js`'s new export + `player.js`'s wiring) plus documentation —
well within this run's budget. One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged from run 34 (this sub-task adds horizontal collision
logic only, touches no terrain/streaming/rendering geometry or chunk count).**

**Second chained sub-task within this same run (per the operator's "don't stop after one" rule —
regression guard and smoke test both passed and budget/time remained):** re-scanned the priority
order fresh after ADR-0037's collider was committed and pushed. Priorities 1-5 still empty; landed
on priority 6, missing smoke-test/regression coverage — `scripts/smokeTestGame3D.js` verifies the
game boots cleanly but had zero assertions about the settlement collider this run's first sub-task
just added, leaving a future regression in it with nothing to catch it.

**Decision and work (DECISIONS.md ADR-0038):** Extended `scripts/smokeTestGame3D.js` with a third
check, `checkSettlementCollider`, reusing the same headless-Chromium session already opened for the
existing `game3d.html` check. It dynamic-`import()`s `physics.js`/`config.js` in-page (real import
map, real module resolution) and replays ADR-0037's own manual verification as a permanent,
always-run assertion: a synthetic castle-center point resolves to exactly the keep's half-extent; a
far point is an exact no-op; a 3000-step simulated walker approaching from 60m away stops at exactly
the keep's half-extent.

**Regression guard — verified with the real bug, not just reasoning:** `node --check` clean (280
lines, under the 600-line cap). All 3 checks (2D shell, 3D mode, settlement collider) PASS against
the real repo. Then re-injected the exact zero-distance/box-disable bug ADR-0037 had fixed
(temporarily, via a one-line `if (false && ...)` in `physics.js`) — the new check correctly failed
with the wrong resolved distances, exit code 1, while the other two checks stayed PASS (confirming
an isolated, non-cascading failure signal). Restored `physics.js` immediately after; `diff` against
a pre-edit backup confirmed a byte-identical restore, and the final `git status`/`git diff --stat`
show zero net change to that file from this sub-task.

**Memory-leak checklist:** N/A — this sub-task only extends an existing one-shot Node CLI script
(server + browser both explicitly closed before `process.exit`, same as ADR-0035's original design);
no new long-lived browser-side state.

**Files changed this sub-task:** `scripts/smokeTestGame3D.js`, `ARCHITECTURE.md`, `DECISIONS.md`
(new ADR-0038), `3D_GAME_PROGRESS.md` (this file). 4 files, ~60 new lines of code (the new check)
plus documentation. One commit, separate from the ADR-0037 sub-task's commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged (this sub-task is test-tooling only, touches no
terrain/streaming/rendering code).**

**Cumulative for this chained execution (run 35's two sub-tasks):** 2 atomic sub-tasks, 2 commits,
7 distinct files touched total (`src/3d/physics.js`, `src/3d/gameplay/player.js`,
`src/3d/game3d.js`, `scripts/smokeTestGame3D.js`, `ARCHITECTURE.md`, `DECISIONS.md`,
`3D_GAME_PROGRESS.md`) — well within the ≤25-file/≤1200-new-line chained-run budget (combined new
code across both sub-tasks is ~155 lines; the remainder is documentation). Each sub-task passed its
own independent regression guard before its own commit, and each included a real fault-injection
test (the zero-distance tower edge case for ADR-0037; the same bug re-injected to prove ADR-0038's
new check actually catches it).

**Next step for the next run:** re-scan the priority order fresh, as always. FAZ 3's one remaining
item is LOD (still no measured perf need behind it — don't treat "the roadmap has an unchecked box"
as equivalent to "there's a perf problem to fix"). Real higher-value remaining gaps, unchanged from
run 34's own assessment: FAZ 5's actual dialogue content and NPC player/pack-awareness (content-
design decisions), FAZ 6's other 3 animal types (each needs a human manual-download step, mark as
"insan onayı gerekli" and stop if attempted), FAZ 4's own remaining gap (no gravity/jump physics —
note the *horizontal* castle-wall gap this run closed is a different, now-resolved item from that
one). A fresh priority-order scan next run may land on any of these or on a newly-introduced gap —
don't assume this list is exhaustive without re-deriving it.

## This Run (2026-07-30, run 36)

**Session Snapshot at container boot:** repo was clean, `HEAD` detached at run 35's own final
commit (`bdba1a1`, ADR-0038's smoke-test extension) with local `main` still pointing at the
pre-3D-mode commit (`38e09e7`) — the same recurring container-restart pattern documented in this
file's "Repo-continuity note" (runs 18/29/30/34). Confirmed `origin/main` already matched the
detached `HEAD` (the push had succeeded); fast-forwarded local `main`
(`git checkout main && git merge origin/main --ff-only`) — no rewrite, no force. Re-read
`3D_GAME_PROGRESS.md`'s Current Status/Roadmap/Known Issues and `DECISIONS.md`'s last 3 ADRs
(0037/0038 plus 0036). `node --check` clean on every non-vendor `.js` file, no file over the
600-line cap (`game3d.js` largest at 579), `node scripts/checkAssetsManifest.js` exits 0, and
`node scripts/smokeTestGame3D.js` PASS on all 3 checks (2D shell, 3D mode, settlement collider) —
all taken as this run's pre-subtask Regression Guard baseline. World scale re-derived once more from
`config.js` — still 137.5 km², no change (twenty-ninth straight confirmation).

**Priority-order scan:** no syntax error, blocking bug, perf-budget overrun, or memory leak found.
No fresh tech-debt item beyond what runs 34-35 already closed (asset-manifest check, persisted
smoke test, settlement collider + its own regression check). Missing smoke-test coverage was
already closed for everything landed so far. Mobile's 4.5% world-coverage figure is unchanged and
still a documented, by-design perf-budget tradeoff (ADR-0010/ADR-0013), not a bug to chase.
Priority 8 (the active phase's own missing subtask) found FAZ 4's one remaining named mechanical
gap, called out explicitly in this file's Known Issues and `physics.js`'s own module doc: "no
gravity/velocity simulation or jumping yet" — separate, still-open work from run 35's *horizontal*
castle-wall collider. No manual-asset-download dependency (no jump animation clip exists, but
vertical movement is visible without one using the existing idle/walk/run poses) — picked as this
run's first atomic sub-task.

**Decision and work (DECISIONS.md ADR-0039):** Added `physics.js`'s `integrateJumpArc` — a pure
function stepping one frame of a simple ballistic jump arc, expressed as height *above the ground*
so it composes with (rather than replaces) the existing ground-height snap: 0 height-above-ground
reproduces the pre-run-36 behavior exactly. `config.js`'s `PLAYER_CONFIG` gained `GRAVITY_MPS2`
(-20) and `JUMP_SPEED_MPS` (7, peak ≈1.2m). `gameplay/player.js`'s `update()` gained an optional
4th `jumpRequested` parameter (defaults `false`), launching a jump only when grounded.
`input.js`'s `KeyboardInput` gained edge-triggered Space handling (`jumpRequested`, set once per
press, cleared on read) so holding the key doesn't chain-jump. `game3d.js`'s tick loop reads
`jumpRequested` off the un-merged `keyboardAxes` (jump is keyboard-only for now — no mobile
control yet). See ADR-0039 for full alternatives considered.

**Regression guard — verified beyond `node --check`, with real behavioral proof:**
1. `node --check` clean on every touched file (`config.js` 528 lines, `physics.js` 144, `input.js`
   72, `gameplay/player.js` 137, `game3d.js` 582 — all under the 600-line cap).
   `node scripts/checkAssetsManifest.js` still exits 0. `node scripts/smokeTestGame3D.js` PASS on
   all 3 existing checks before and after.
2. **Isolated math**, run in-browser (same real-import-map pattern as ADR-0037/ADR-0038): standing
   still stays grounded at height 0; a full stepped jump arc (same per-frame loop shape as
   `player.js`'s own `update()`) peaks within a discretization-aware tolerance of the closed-form
   ballistic height, lands without ever going negative, and takes the closed-form flight time
   within ±3 frames.
3. **A real ad hoc verification, temporarily zeroing gravity inside `integrateJumpArc`** — the
   isolated test correctly showed the arc never landing (peak wildly wrong, never returns to
   grounded) — confirming the test actually exercises the failure path, not just the happy path.
   Restored immediately; `diff` against a pre-edit backup confirmed a byte-identical restore.
4. **Live integration sanity**, real headless-Chromium session against the actual assembled game
   (`game3d.html`): pressed and released Space during normal gameplay — zero console/page errors,
   confirming the new wiring through `input.js`/`game3d.js`/`player.js` doesn't break the real
   boot/movement path.

**Memory-leak checklist:** No new `THREE.*` allocation, event listener, or timer —
`integrateJumpArc` is pure per-call arithmetic; `input.js`'s jump flag is one boolean field on an
object whose `dispose()` already runs on teardown (now also clears the new field).

**Files changed this sub-task:** `src/3d/config.js`, `src/3d/physics.js`, `src/3d/input.js`,
`src/3d/gameplay/player.js`, `src/3d/game3d.js`, `ARCHITECTURE.md`, `DECISIONS.md` (new ADR-0039),
`3D_GAME_PROGRESS.md` (this file). 8 files, ~65 new lines of code plus documentation. One commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged (this sub-task adds vertical player movement only,
touches no terrain/streaming/rendering geometry or chunk count).**

**Second chained sub-task within this same run (per the operator's "don't stop after one" rule —
regression guard and smoke test both passed and budget/time remained):** re-scanned the priority
order fresh after ADR-0039 was committed. Priorities 1-5 still empty; landed on priority 6 again,
missing smoke-test/regression coverage — ADR-0039's own verification (steps 2-3 above) was real but
ad hoc, the same gap ADR-0035/ADR-0038 already established a pattern for closing.

**Decision and work (DECISIONS.md ADR-0040):** Extended `scripts/smokeTestGame3D.js` with a fourth
check, `checkJumpArc`, reusing the same in-page dynamic-`import()` pattern as
`checkSettlementCollider`. Persists ADR-0039's manual verification (idle stays grounded; a stepped
jump arc peaks near the closed-form ballistic height with a discretization-aware 0.1m tolerance;
never goes negative; lands within ±3 frames of the closed-form flight time) as an always-run
assertion.

**Regression guard — verified with the real bug, not just reasoning:** `node --check` clean
(351 lines, under the 600-line cap). All 4 checks PASS against the real repo. Re-injected the exact
zeroed-gravity bug from this run's first sub-task — the new check correctly failed
(`peakOk: false, landedOk: false`, frame count pinned at the 600-iteration safety cap), while the
other three checks stayed PASS (isolated, non-cascading failure signal). Restored `physics.js`
immediately after; `diff` against a pre-edit backup confirmed a byte-identical restore.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script (server + browser
both explicitly closed before `process.exit`), no new long-lived browser-side state.

**Files changed this sub-task:** `scripts/smokeTestGame3D.js`, `DECISIONS.md` (new ADR-0040),
`3D_GAME_PROGRESS.md` (this file). 3 files, ~65 new lines of code (the new check) plus
documentation. One commit, separate from the ADR-0039 sub-task's commit.

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged (this sub-task is test-tooling only, touches no
terrain/streaming/rendering code).**

**Third chained sub-task within this same run (per the operator's "don't stop after one" rule —
regression guard and smoke test both passed and budget/time remained):** re-scanned the priority
order fresh once more after ADR-0040 was committed and pushed. Priorities 1-5 still empty; landed on
priority 6 again — a real, previously-uncovered gap: `gameplay/interaction.js`'s open/close/
auto-close state machine (run 33, ADR-0033), which every one of FAZ 5's 14 NPCs' E-key dialogue
depends on, had zero persisted regression coverage — only ad hoc verification notes from run 33
itself.

**Decision and work (DECISIONS.md ADR-0041):** Added a fifth check, `checkInteractionController`,
to `scripts/smokeTestGame3D.js`. `gameplay/interaction.js` takes its `interactionPrompt`/
`dialogueBox` collaborators as injected parameters (no `THREE`/DOM import of its own), so the check
uses plain fake stubs rather than the real UI modules — same in-page dynamic-`import()` pattern the
other module-level checks use, so it still exercises the real module resolution the live game uses.
Covers the full state machine: prompt hidden/shown correctly by distance; `E` opens a dialogue with
the right per-NPC greeting and hides the prompt; `E` again or `Escape` closes it; walking out of
range auto-closes it with no keypress; a browser key-repeat event is correctly ignored.

**Regression guard — verified with a real injected bug, not just reasoning:** `node --check`
clean (449 lines, under the 600-line cap). All 5 checks PASS against the real repo. Re-injected a
real bug — disabled the "player walked out of the active NPC's radius" auto-close condition in
`gameplay/interaction.js` (replaced with a literal `false`) — the new check correctly failed
specifically on the `walkingAwayAutoCloses` assertion (all 6 other assertions in that same check
stayed true, isolating exactly which behavior broke), while the other four checks stayed PASS.
Restored `interaction.js` immediately after; `diff` against a pre-edit backup confirmed a
byte-identical restore, `node --check` on it afterward stayed clean.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script; fake collaborator
stubs are plain objects with no listener/timer/`THREE.*` allocation.

**Files changed this sub-task:** `scripts/smokeTestGame3D.js`, `DECISIONS.md` (new ADR-0041),
`3D_GAME_PROGRESS.md` (this file). 3 files, ~80 new lines of code (the new check) plus
documentation. One commit, separate from the ADR-0039/ADR-0040 sub-tasks' commits. No change to
`gameplay/interaction.js` itself (test-only addition).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged (this sub-task is test-tooling only, touches no
terrain/streaming/rendering code).**

**Cumulative for this chained execution (run 36's three sub-tasks):** 3 atomic sub-tasks, 3 commits,
10 distinct files touched total (`src/3d/config.js`, `src/3d/physics.js`, `src/3d/input.js`,
`src/3d/gameplay/player.js`, `src/3d/game3d.js`, `scripts/smokeTestGame3D.js`, `ARCHITECTURE.md`,
`DECISIONS.md`, `3D_GAME_PROGRESS.md`) — well within the ≤25-file/≤1200-new-line chained-run budget
(combined new code across all three sub-tasks is ~210 lines; the remainder is documentation). Each
sub-task passed its own independent regression guard before its own commit, and each included a
real fault-injection test (zeroed gravity twice, for the same reason noted in the prior run's
retrospective; a disabled auto-close condition for the third).

**Next step for the next run:** re-scan the priority order fresh, as always. FAZ 4 now has no known
mechanical gaps left (both the horizontal wall-collider and vertical gravity/jump are done and
regression-guarded). FAZ 3's one remaining item is still LOD (still no measured perf need). Real
higher-value remaining gaps, unchanged from run 34/35's own assessment: FAZ 5's actual dialogue
content and NPC player/pack-awareness (content-design decisions), FAZ 6's other 3 animal types
(each needs a human manual-download step, mark as "insan onayı gerekli" and stop if attempted). Two
new, honestly-scoped mobile gaps surfaced by this run's first sub-task: `touchJoystick.js` has no
jump control, and jump feel (height/gravity constants) hasn't been focus-tested — either could be a
legitimate future sub-task if a run's priority scan reaches them. `scripts/smokeTestGame3D.js` now
has 5 checks; the only FAZ 5/6 system left with zero persisted coverage is the NPC/animal
patrol-and-pack-alert logic itself (`gameplay/npc.js`/`gameplay/animals.js`) — a plausible priority-6
candidate for a future run, same reasoning as this run's third sub-task. A fresh priority-order scan
next run may land on any of these or on a newly-introduced gap — don't assume this list is
exhaustive without re-deriving it.

## This Run (2026-07-30, run 37)

**Session Snapshot at container boot:** repo working tree clean but `HEAD` was detached at run 36's
own final commit (`74fec3e`, ADR-0041's interaction-controller smoke test), with local `main` still
pointing at the pre-3D-mode commit (`38e09e7`) — the same recurring container-restart pattern
documented in this file's "Repo-continuity note" (runs 18/29/30/34/36). `git fetch origin main`
confirmed `origin/main` already matched the detached `HEAD` exactly (the push had genuinely
succeeded; only this container's local ref/tracking branch was stale) — `git checkout main && git
reset --hard origin/main` brought local `main` in line, losslessly (verified beforehand: local
`main`'s own 2 pre-3D commits are a strict content subset of `origin/main`'s history — a byte
`diff` on `service-worker.js`/`ios-pwa-fix.css` confirmed `origin/main` is a superset, not a
divergent rewrite, so no work was ever at risk). Re-read `3D_GAME_PROGRESS.md`'s Current
Status/World Coverage/Performance Budget and `DECISIONS.md`'s last 3 ADRs (0039/0040/0041). `node
--check` clean on every non-vendor `.js` file, no file over the 600-line cap, `node
scripts/checkAssetsManifest.js` exits 0, and `node scripts/smokeTestGame3D.js` PASS on all 5
existing checks — taken as this run's pre-subtask Regression Guard baseline. World scale re-derived
once more from `config.js` — still 137.5 km², no change (thirtieth straight confirmation).

**Priority-order scan:** no syntax error, blocking bug, perf-budget overrun, or memory leak found.
No fresh tech-debt item beyond what runs 34-36 already closed. Priority 6 (missing smoke-test/
regression coverage) — flagged as the likely next candidate by run 36's own "Next step" note — was
confirmed still open: `gameplay/animals.js`'s wolf flee (ADR-0027) and pack-alert/chain-propagation
(ADR-0029/ADR-0030) logic had zero persisted coverage, only ever verified ad hoc via a temporary
debug hook reverted before each of those runs' commits. Picked as this run's atomic sub-task — same
priority-6 pattern as run 36's third sub-task, just on the one gameplay-critical module that still
lacked it.

**Decision and work (DECISIONS.md ADR-0042):** Added a sixth check, `checkWolfPackAlert`, to
`scripts/smokeTestGame3D.js`. Spawns 3 real `createWolf` controllers (via a real `AssetLoader`
loading the actual `Wolf-Blender-2.82a.glb` from the script's own local static server — no new
asset/dependency, the same file `check3DMode`'s full boot already loads 3 copies of) at hand-picked
distances (18m/34m/16m) chosen to cleanly isolate each causal path, then direct-calls `update()`
across 3 synthetic frames replaying ADR-0030's exact manually-verified chain scenario: wolf1 flees
the player directly; wolf2 pack-flees only once told wolf1 is fleeing; wolf3 stays calm on an
out-of-range packmate (negative control) but chain-flees once told about in-range wolf2 a frame
later; plus a new assertion that a pack-alerted wolf's flee direction stays player-relative (moves
away from the player), not packmate-relative — regression-testing ADR-0029's core design decision,
not just its "does it flee at all" outcome. See ADR-0042 for full alternatives considered.

**Regression guard — verified with a real injected bug, not just reasoning:** `node --check` clean
(552 lines, under the 600-line cap). All 6 checks PASS against the real repo. Injected a real bug —
changed `isFleeingFromPack = true` to `isFleeingFromPack = false` in `gameplay/animals.js` — the new
check correctly failed on exactly the pack-path assertions (`wolf2PackFlees`,
`wolf2FleesAwayFromPlayer`, `wolf3ChainFlees`), while the direct-flee/baseline/negative-control
assertions in the same check and all 5 other checks stayed PASS (isolated, non-cascading failure
signal). Restored `animals.js` immediately after; `diff` against a pre-edit backup confirmed a
byte-identical restore, `node --check` on it afterward stayed clean.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script; the 3 test wolves'
`AnimationMixer`/model resources are never added to a live render loop, and the whole page (with its
`AssetLoader`/THREE resources) closes at the end of the check.

**Files changed this sub-task:** `scripts/smokeTestGame3D.js`, `DECISIONS.md` (new ADR-0042),
`3D_GAME_PROGRESS.md` (this file). 3 files, ~95 new lines of code (the new check) plus
documentation. One commit. No change to `gameplay/animals.js` itself (test-only addition).

**World Coverage: 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5% (6.25 km² /
137.5 km²) on mobile-class devices — unchanged (this sub-task is test-tooling only, touches no
terrain/streaming/rendering code).**

**Next step for the next run:** re-scan the priority order fresh, as always.
`scripts/smokeTestGame3D.js` now has 6 checks covering every gameplay-critical system landed so far
except FAZ 5's NPC patrol logic (`gameplay/npc.js`) itself, which remains a plausible priority-6
candidate (NPCs have no flee/pack-awareness yet, so there's nothing analogous to this run's chain
test to write for them beyond a basic patrol-waypoint regression check). Real higher-value remaining
gaps, unchanged from run 36's own assessment: FAZ 5's actual dialogue content and NPC
player/pack-awareness (content-design decisions), FAZ 6's other 3 animal types (each needs a human
manual-download step — mark as "insan onayı gerekli" and stop if attempted), FAZ 3's LOD (no measured
perf need yet), `touchJoystick.js`'s missing jump control, and jump feel tuning. A fresh
priority-order scan next run may land on any of these or on a newly-introduced gap — don't assume
this list is exhaustive without re-deriving it.

## This Run (2026-07-30, run 38)

**Session Snapshot at container boot:** repo working tree clean but `HEAD` was detached at run
37's own final commit (`f0065a3`, ADR-0042's wolf-pack-alert smoke test), with local `main` still
pointing at the pre-3D-mode commit (`38e09e7`) — the same recurring container-restart pattern
documented in this file's "Repo-continuity note" (runs 18/29/30/34/36/37). `git fetch origin main`
confirmed `origin/main` already matched the detached `HEAD` exactly. `git checkout main` (before
the fetch-confirmed reset) briefly left the working tree pointed at a stale ref via an intermediate
`git update-ref` step — caught immediately by `git status` showing dozens of unexpected staged
deletions before anything was committed, fixed with `git reset --hard origin/main` (safe and
lossless: nothing had been committed, `origin/main` was already confirmed to be the real, pushed
history). Re-read `DECISIONS.md`'s last 3 ADRs (0041/0042 and this run's own) and this file's
Current Status/World Coverage. `node --check` clean on every non-vendor `.js` file, no file over
the 600-line cap (before this run's own split), `node scripts/checkAssetsManifest.js` exits 0
(only expected sidecar-texture warnings), and `node scripts/smokeTestGame3D.js` PASS on all 6
existing checks — taken as this run's pre-subtask Regression Guard baseline. World scale re-derived
once more from `config.js` — still 137.5 km², no change.

**Chained-run mode:** this run followed the updated instructions allowing multiple atomic
sub-tasks per container run instead of stopping after one. Sub-task 1 (below) landed, was
regression-guarded, committed, and pushed. Sub-task 2 (below) then reused the same priority-6 scan
result — its own "Next step" had already named the exact next candidate — and repeated the same
pattern: pick, implement, regression-guard with a real injected-bug verification, commit, push.
Both sub-tasks together stayed well inside the run's 1200-line/25-file budget (~340 new lines
across 4 touched files total) and its rough time budget.

**Repo-continuity note (sub-task 1 -> sub-task 2 handoff):** between the two sub-tasks' pushes,
`origin/main` moved twice more from a parallel session adding new binary assets (castles, a horse,
4 characters, then 4 dragon models — `feat(assets)` commits, no overlap with any file this run
touched). Each push was `git fetch` + `git rebase origin/main` + re-verify (`node --check` +
full smoke suite) + push, not a blind force-push — confirmed clean via `git diff --stat` against
the fetched range that only `assets/` and (once) `assets_manifest.json` changed, never this run's
own files, before rebasing.

**Priority-order scan:** no syntax error, blocking bug, perf-budget overrun, or memory leak found.
No fresh tech-debt item beyond what runs 34-37 already closed. Priority 6 (missing smoke-test/
regression coverage) — flagged as the likely next candidate by run 37's own "Next step" note — was
confirmed still open: `gameplay/npc.js`'s waypoint-patrol movement (run 22, ADR-0021), the core
logic all 11+ patrolling NPCs depend on (and the pattern `gameplay/animals.js`'s wolves
independently copied per ADR-0026), had zero persisted coverage. Picked as this run's atomic
sub-task.

**Sub-task 1 — decision and work (DECISIONS.md ADR-0043):** Split `scripts/smokeTestGame3D.js`
(552 lines) into a thin runner (143 lines: static file server + Playwright bootstrap only) and a
new `scripts/game3dSmokeChecks.js` (495 lines: all 7 check functions, moved verbatim, plus their
shared timeout constants/`loadAndCollectErrors` helper) — required because adding the new check
in place would have exceeded the 600-line cap. Same "extract into a focused module, moved
verbatim" pattern ADR-0028 established for `game3d.js`. Added a 7th check, `checkNpcPatrol`,
driving one real `createNPC` controller (real Mixamo FBX via a real `AssetLoader`) through the
exact 2-waypoint shape `spawnConfiguredNPCs` builds in production, with a ground collider whose
height varies by `z` so ground-resampling mid-walk is actually observable. Writing it surfaced a
real (cosmetic, not gameplay-breaking) timing quirk: `pauseTimer` starts pre-loaded, so every
patrolling NPC idles *two* full `pauseSeconds` cycles (not one) before its first real step — every
subsequent lap's pause is correct. Documented and asserted against (loose tolerance), not fixed —
out of this test-only sub-task's scope. See ADR-0043 for full alternatives considered.

**Regression guard — verified with a real injected bug, not just reasoning:** `node --check` clean
on both new/changed files, both under the 600-line cap. All 7 checks PASS against the real repo.
Injected a real bug — changed the walk branch's ground-height resample to a hardcoded
`model.position.y = 0` in `gameplay/npc.js` — the new check correctly failed on exactly
`midWalkYTracksGround`, while `arrivedExactly`/`finalYTracksGround` stayed true (the separate
waypoint-snap branch independently resamples height on arrival, untouched by the injected bug —
correctly isolating the failure to the specific code path broken) and all 6 other checks stayed
PASS. Restored `npc.js` immediately after; `diff` against a pre-edit backup confirmed a
byte-identical restore, `node --check` afterward stayed clean.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script; the one test NPC's
`AnimationMixer`/model resources are never added to a live render loop, and the whole page (with
its `AssetLoader`/THREE resources) closes at the end of the check.

**Files changed this sub-task:** `scripts/smokeTestGame3D.js` (rewritten as a thin runner),
`scripts/game3dSmokeChecks.js` (new), `DECISIONS.md` (new ADR-0043), `3D_GAME_PROGRESS.md` (this
file). 4 files. No change to `gameplay/npc.js` itself (test-only addition — the double-idle quirk
is documented, not fixed). One commit, direct push to `main`.

**World Coverage (after sub-task 1): 80.7% (111.00 km² / 137.5 km²) on desktop-class devices; 4.5%
(6.25 km² / 137.5 km²) on mobile-class devices — unchanged (test-tooling only, touches no
terrain/streaming/rendering code).**

**Sub-task 2 — priority scan:** re-ran the full priority order after sub-task 1's push. No syntax
error, blocking bug, perf-budget overrun, memory leak, or fresh tech-debt item. Priority 6's own
remaining gap — named explicitly by sub-task 1's own note above — was `gameplay/animals.js`'s wolf
waypoint-patrol *movement* (the plain patrol-walk branch; `checkWolfPackAlert` from run 37 already
covers flee/pack-alert, a different branch of the same file). Picked as sub-task 2.

**Sub-task 2 — decision and work (DECISIONS.md ADR-0044):** Added an 8th check, `checkWolfPatrol`,
to `scripts/game3dSmokeChecks.js` (now 586 lines — under the 600-line cap, but close; flagged for
whoever adds a 9th check next). Same scenario shape as sub-task 1's `checkNpcPatrol` (2 waypoints,
waypoint 0 = spawn point, target (10, 10), z-varying groundCollider), driven on a real `createWolf`
controller with `fleeClipName`/`fleeTriggerRadiusMeters` both omitted so the flee branch can never
fire — isolating the patrol branch specifically, and confirming the copied-not-shared patrol logic
(ADR-0026's own "why duplicate" call) stayed behaviorally identical to `npc.js`'s already-tested
original, including inheriting the same double-idle-before-first-lap quirk.

**Regression guard — verified with a real injected bug:** `node --check` clean on both files (144
+ 586 lines). All 8 checks PASS against the real repo. Injected bug — hardcoded
`model.position.y = 0` in the patrol-walk branch of `gameplay/animals.js` — the new check failed
on exactly `midWalkYTracksGround`; `arrivedExactly`/`finalYTracksGround` stayed true (independent
waypoint-snap resampling), and all 7 other checks (including `checkWolfPackAlert`) stayed PASS.
Restored `animals.js`; `diff` against a pre-edit backup confirmed byte-identical, `node --check`
afterward stayed clean.

**Memory-leak checklist:** N/A — same one-shot-script reasoning as sub-task 1; one test wolf's
resources never enter a live render loop, page closes at the end of the check.

**Files changed this sub-task:** `scripts/game3dSmokeChecks.js`, `scripts/smokeTestGame3D.js`
(2-line wiring + comment update), `DECISIONS.md` (new ADR-0044), `3D_GAME_PROGRESS.md` (this
file). 4 files, ~95 new lines (the new check). No change to `gameplay/animals.js` itself
(test-only addition). One commit, rebased onto 2 rounds of parallel `origin/main` asset-commit
pushes, then pushed.

**World Coverage (after sub-task 2): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5% (6.25 km² /
137.5 km²) mobile — unchanged, both sub-tasks were test-tooling only.**

**Sub-task 3 — priority scan:** re-ran the full priority order after sub-task 2's push. No syntax
error, blocking bug, perf-budget overrun, or memory leak. Priority 6 now had no remaining gap —
both patrol regression checks (sub-tasks 1/2) plus the pre-existing 6 checks cover every landed
gameplay-critical system. The only concrete, already-scoped item left at a *lower* priority number
than 7 (World Coverage) or 8 (active-phase feature work) was priority 5 in spirit: a small, already
-fully-documented tech debt item — the double-idle-before-first-lap patrol quirk both sub-tasks 1
and 2 explicitly flagged as "out of this test-only sub-task's scope" but real and fixable. Picked
as sub-task 3, since it's smaller and lower-risk than starting a World Coverage or new-feature
sub-task with whatever time/budget remained.

**Sub-task 3 — decision and work (DECISIONS.md ADR-0045):** Changed `gameplay/npc.js`'s and
`gameplay/animals.js`'s identical `pauseTimer` initialization from `isPatrolling ? pauseSeconds :
0` to a flat `0` (one line each, same reasoning comment in both). This makes the first `update()`
call resolve `patrolWaypoints[0]`'s zero-distance "arrival" (it's always the entity's own spawn
point) immediately instead of after a wasted `pauseSeconds` idle, so the real dwell only happens
once before the first lap — matching every later lap's timing. Updated sub-tasks 1/2's own
`checkNpcPatrol`/`checkWolfPatrol` to assert the corrected single-pause-cycle timing instead of
merely documenting the old double-idle.

**Regression guard — verified with real injected bugs in both directions:** `node --check` clean
on all 4 changed files. All 8 checks PASS with the fix. Temporarily reverted `pauseTimer` back to
`pauseSeconds` in `npc.js` alone — `checkNpcPatrol` correctly failed (`startedMoving`/
`idleDurationOk`) while all 7 other checks, including `checkWolfPatrol`, stayed PASS. Restored,
confirmed byte-identical, then repeated the same revert/verify/restore cycle for `animals.js` alone
— `checkWolfPatrol` correctly failed while `checkNpcPatrol` (now fixed) stayed PASS. This confirms
the two files' fixes and their tests are independently verified, not accidentally coupled.

**Memory-leak checklist:** N/A — a single local-variable initial-value change; no new allocation,
listener, or timer.

**Files changed this sub-task:** `src/3d/gameplay/npc.js`, `src/3d/gameplay/animals.js`,
`scripts/game3dSmokeChecks.js` (updated assertions in the 2 patrol checks), `DECISIONS.md` (new
ADR-0045), `3D_GAME_PROGRESS.md` (this file). 5 files, ~10 net new lines (a one-line fix plus a
short explanatory comment in each of the 2 gameplay files; the test file's changes are edits to
existing lines, not additions). One commit, direct push to `main` (rebased against any further
parallel `origin/main` asset pushes, same as sub-tasks 1/2).

**World Coverage (final for this run, after all 3 sub-tasks): 80.7% (111.00 km² / 137.5 km²)
desktop; 4.5% (6.25 km² / 137.5 km²) mobile — unchanged across the whole run; every sub-task was
test-tooling or a movement-timing fix, none touched terrain/streaming/rendering.**

**Regression guard, all 3 sub-tasks combined — final state:** `scripts/smokeTestGame3D.js` (144
lines) + `scripts/game3dSmokeChecks.js` (587 lines), 8 checks total, all PASS, every touched file
under the 600-line cap. `node --check` clean across every non-vendor `.js` file in the repo.
`node scripts/checkAssetsManifest.js` clean (only expected sidecar-texture warnings).

**Run totals (3 chained sub-tasks):** ~9 files touched across the run (`scripts/
smokeTestGame3D.js`, `scripts/game3dSmokeChecks.js`, `src/3d/gameplay/npc.js`, `src/3d/gameplay/
animals.js`, `DECISIONS.md`, `3D_GAME_PROGRESS.md` — well under the 25-file cap) and roughly
650-700 new/changed lines of actual code (the 2 new check functions plus the 1-line-plus-comment
fix in each gameplay file; `DECISIONS.md`/`3D_GAME_PROGRESS.md` prose is documentation, not code),
comfortably inside the 1200-line budget. 3 commits, each individually regression-guarded with a
real injected-bug verification and pushed directly to `main` (each rebased against 1-2 rounds of
a parallel session's concurrent asset-adding commits — never conflicting, since that session only
ever touched `assets/`/`assets_manifest.json`).

**Next step for the next run:** re-scan the priority order fresh, as always — don't assume this
list is exhaustive without re-deriving it. Priorities 1-6 are all clean with no known remaining
gap on any landed gameplay system, and the one priority-5-adjacent item found this run (the
double-idle patrol quirk) is now fixed in both files. The most likely next landing spots: priority
7 (World Coverage — 80.7%/4.5% has been flat since run 15, a real, long-standing gap, and the
largest concrete remaining priority above "new feature"); priority 8 (FAZ 5's real dialogue
content, or FAZ 6's other 3 animal types — each needs a human manual-download step, mark "insan
onayı gerekli" and stop if attempted); or `scripts/game3dSmokeChecks.js` nearing its own 600-line
cap (587/600) — a 9th check will likely need a further split before it can be added, worth
flagging as tech debt (priority 5) if a future run tries to add one without checking first.

## This Run (2026-07-30, run 39)

**Session Snapshot at container boot:** repo working tree clean but `HEAD` was detached at run
38's own final commit (`dca186d`, ADR-0045's patrol double-idle fix) — same recurring
container-restart pattern documented in this file's "Repo-continuity note" (runs 18/29/30/34/36/
37/38). `git fetch origin main` confirmed `origin/main` already matched the detached `HEAD`
exactly (it had also picked up 3 further `feat(assets)` dragon-model commits from a parallel
session since run 38). `git checkout -B main origin/main` reattached cleanly. Read `3D_GAME_PROGRESS.md`'s
tail, `git log -10`, and `DECISIONS.md`'s last 3 ADRs (0044/0045 and this run's own).

**Priority-order override, this run only:** the run's own instructions carried an urgent,
pre-ranked override ahead of the normal priority scan — the project owner had played the 3D mode
directly and found none of the 14 kingdom seats, 14 NPCs, or 3 wolves visible from spawn, with the
root cause already hand-derived (spawn at the world origin vs. every kingdom seat sitting 2.5-6km
away, beyond `fog.js`'s visibility range). Verified the math independently before touching any code
(`WORLD_SCALE.MAP_BOUNDS` center is `(3555, 3085)` map units; closest seat `stannis` at ~2.57km,
`cersei` at ~3.28km, `umit` — the project owner's own kingdom — at ~4.04km; `fog.js`'s
`FOG_DENSITY_DAY`/`FOG_DENSITY_NIGHT` confirmed at `0.0004`/`0.00055`) — confirmed correct, not a
code bug, a spawn/discoverability gap, exactly as diagnosed. Took this as sub-task 1, ahead of the
normal priority-order scan.

**Sub-task 1 — decision and work (DECISIONS.md ADR-0046):** Added `PLAYER_CONFIG.SPAWN_MAP_X`/
`SPAWN_MAP_Y` (`3885`/`5404` — 2D-map units, `umit`'s own seat offset ~60m in `+mapY`) to
`config.js`, replacing the old `SPAWN_X_METERS`/`SPAWN_Z_METERS` (both `0`, the world origin).
`game3d.js` now imports `mapToWorldXZ` from `world/settlements.js` (already imported
`createSettlements`/`disposeSettlements` from the same module) and converts the new map-unit
constants to world meters right before `createPlayer`, instead of reading pre-converted meters
directly — keeps `config.js` free of a `world/settlements.js` import cycle and keeps the spawn
point re-derivable the same way `WORLD_SCALE.MAP_BOUNDS`'s own doc comment already expects.
`gameplay/player.js`'s `spawn` default changed to a literal `{x:0, z:0}` (its only real caller,
`game3d.js`, always passes `spawn` explicitly). See ADR-0046 for the full "why `umit`, why +60m,
why that direction" reasoning and alternatives considered.

**Regression guard:** `node --check` clean on all 3 changed files. Full committed smoke suite
(`node scripts/smokeTestGame3D.js`) — all 8 checks PASS, zero regressions (none of them read
`PLAYER_CONFIG.SPAWN_*` or depend on specific spawn coordinates). **Real headless-Chromium
screenshot** (Playwright, `game3d.html`, ~1.5s after `GAME_READY` `phase1-scene`) — not a throwaway,
kept as this run's verification artifact — confirms the fix visually: console-logged spawn position
`(577.5, 10.4, 4058.3)` matches the hand-computed `mapToWorldXZ(3885, 5404, ...)` conversion
exactly, and the captured frame shows the player standing on real terrain with one of `umit`'s
castle corner towers filling most of the view directly ahead — the first run able to submit actual
visual proof of a settlement being visible at spawn, not just a coordinate-math claim.

**Memory-leak checklist:** N/A — a spawn-coordinate constant change plus one `mapToWorldXZ` call at
scene-init time; no new per-frame allocation, listener, or timer.

**Files changed this sub-task:** `src/3d/config.js`, `src/3d/game3d.js`, `src/3d/gameplay/
player.js`, `DECISIONS.md` (new ADR-0046), `3D_GAME_PROGRESS.md` (this file). 5 files, ~40 new/
changed lines. One commit, direct push to `main`.

**World Coverage (after sub-task 1): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5% (6.25 km² /
137.5 km²) mobile — unchanged (spawn-point-only change; all 444 desktop terrain chunks already
loaded per-seat regardless of spawn point — see `game3d.js`'s pre-existing per-seat force-load
loop, ADR-0013). Mobile benefits indirectly: `umit`'s chunk neighborhood, previously outside both
the mobile boot-preview and the desktop-only per-seat force-load, now loads immediately via the
ordinary player-position chunk-streaming path, since streaming follows the player wherever they
actually are, not the world origin.

**Sub-task 2 — priority scan:** re-ran the full priority order after sub-task 1's push. No syntax
error, blocking bug, memory leak, or new tech debt beyond `scripts/game3dSmokeChecks.js`'s
already-monitored 587/600 lines. No missing smoke-test/regression coverage (priority 7). Priority 8
(World Coverage, flat 80.7%/4.5% since run 15) was seriously considered — bumping
`CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` 10 -> 11 would push desktop coverage to ~96.2% — but the
triangle-budget headroom at R=11 computed out meaningfully tighter than ADR-0014's own precedent
judged safe (~0.31M triangles of margin under the 5M desktop ceiling vs. R=10's ~1.02M), with no
`renderer.info`-based instrumentation in this repo to verify the real (not estimated) cost first.
Deferred rather than risk landing an unmeasured perf regression — see DECISIONS.md ADR-0047's
Context/Consequence for the full reasoning, flagged as this run's single largest deferred item, not
silently skipped. Priority 9 (active phase's missing sub-task) had a concrete, zero-risk,
already-asset-ready candidate instead: FAZ 6's roadmap-listed horse type, with `ivory_stallion.glb`
already manually downloaded and in `assets_manifest.json`. Picked as sub-task 2.

**Sub-task 2 — decision and work (DECISIONS.md ADR-0047):** Added `ANIMAL_CONFIG.HORSE_MODEL_URL`
and a new `umit-horse-1` spawn entry — a static/idle-only horse at `umit` (the same seat the player
now spawns next to per sub-task 1, deliberately reinforcing it), offset `(-30, 0)`m from the keep
center (outside the settlement collider: keep box half-width 17m, nearest tower center 22.36m away
vs. its 6.5m radius). `ivory_stallion.glb` is geometry-only (no rig/animation clips) per
`assets_manifest.json` — `gameplay/animals.js`'s `spawnConfiguredAnimals` gained a per-spawn
`modelUrl` override (default `WOLF_MODEL_URL`, existing wolves unaffected) and a per-spawn
`canFlee` flag (default `true`) so the horse skips the flee/pack-alert branches entirely instead of
sliding across the ground with no animation to sell the movement.

**Regression guard:** `node --check` clean on `config.js` (570 lines) and `gameplay/animals.js`
(311 lines). Full smoke suite — all 8 checks PASS, zero regressions (the wolf checks build their
own isolated `createWolf` instances directly, never call `spawnConfiguredAnimals`). Real
headless-Chromium boot confirms `"Spawned 4 FAZ 6 animal(s)"` (previously 3) with zero console/page
errors — the GLB loaded successfully, not silently falling back to `AssetLoader`'s placeholder box.
A direct in-page `spawnConfiguredAnimals` call confirmed `umit-horse-1`'s resolved position is
finite, outside the keep box, and 22.36m clear of the nearest tower — matching the hand-computed
clearance exactly.

**Memory-leak checklist:** N/A — one more entry through `createWolf`'s existing, already-verified
load/dispose path; no new per-frame allocation, listener, or timer.

**Files changed this sub-task:** `src/3d/config.js`, `src/3d/gameplay/animals.js`, `DECISIONS.md`
(new ADR-0047), `3D_GAME_PROGRESS.md` (this file). 4 files, ~60 new lines. One commit, direct push
to `main`.

**World Coverage (final for this run, after both sub-tasks): 80.7% (111.00 km² / 137.5 km²)
desktop; 4.5% (6.25 km² / 137.5 km²) mobile — unchanged across the whole run (a spawn-point change
and one new character, neither touched terrain/streaming). Remains this run's single largest
deferred item — see sub-task 2's priority scan above for why, and the "Next step" note below for
what a future run attempting it should have ready first.**

**Run totals (2 chained sub-tasks):** 9 files touched (`src/3d/config.js`, `src/3d/game3d.js`,
`src/3d/gameplay/player.js`, `src/3d/gameplay/animals.js`, `DECISIONS.md`, `3D_GAME_PROGRESS.md` —
well under the 25-file cap) and ~290 new/changed lines total (well under the 1200-line budget). 2
commits, each regression-guarded (full smoke suite + a real headless-Chromium boot/screenshot or
direct in-page verification) and pushed directly to `main`.

**Next step for the next run:** re-scan the priority order fresh, as always. The most likely next
landing spot is priority 8, World Coverage — genuinely the largest remaining gap, flat since run 15,
now deferred twice (run 38 flagged it as an option without acting, this run computed the actual
tradeoff and found it too tight to land safely without better instrumentation). A future run
attempting it should either (a) add lightweight `renderer.info`-based triangle/draw-call logging to
`game3d.js`'s boot-time `console.info` calls first, so the real cost is measured, not estimated, or
(b) pick a smaller, more conservative step than 10 -> 11 (e.g. asymmetric preview shape matching the
actual 25x22 grid aspect ratio, rather than a square, might cover more real area per triangle spent).
Other open candidates: priority 9's remaining FAZ 5/6 gaps (real per-NPC dialogue content; cart/dog-
cat/bird still need a human manual-download step — mark "insan onayı gerekli" and stop if attempted);
FAZ 7 (dragons — `verdant_wyrm` model ready, no code started yet); or the priority-9.5 world-events/
EventBus-expansion task from this run's own instructions, not yet reached.

## This Run (2026-07-30, run 40)

**Session Snapshot at container boot:** `HEAD` was detached at run 39's final commit (`6092de4`,
ADR-0047's horse addition) with a stale local `main`/`origin/main` cached ref pointing at a much
older pre-3D-mode commit — a fresh `git fetch origin main` showed the real remote `main` already
matched the detached `HEAD` exactly (force-updated the stale cached ref, no actual divergence or
lost work), then `git branch -f main origin/main && git checkout main` reattached cleanly. Read
`3D_GAME_PROGRESS.md`'s tail, `git log -10`, and `DECISIONS.md`'s last 3 ADRs (0046/0047 and this
run's own).

**Priority-order override, this run only:** the run's own instructions carried a pre-ranked
override — priority 1 (spawn) already verified fixed by the project owner (commit `5ba86de`,
skipped per instruction), so priority 1.5 (lake-water flicker) was this run's first sub-task, ahead
of the normal priority scan.

**Sub-task 1 — decision and work (DECISIONS.md ADR-0048):** Confirmed the root cause before writing
any code: `world/water.js`'s Gerstner vertex displacement moves each vertex up to ~1.01m vertically
(3 summed waves, steepness 0.18/0.12/0.08), but lakes are just terrain sitting under
`WORLD_DEFAULTS.WATER_LEVEL_METERS` (6m) — no separate lake system exists — and the run-16 profiling
already on record shows the shallowest real seat (`jon`/Castle Black) sampling at exactly 6.00m, far
shallower than the wave's own amplitude. Fixed by moving all wave *motion* from the vertex shader to
the fragment shader: vertices now stay at their flat authored grid position (geometrically
immovable, so water can never separate from the ground beneath it, at any depth including zero), and
a new `rippleNormal()` fakes the moving-water look via an analytic bump normal driven by
`vWorldPosition.xz`/`uTime`, feeding the same fresnel/specular shading the old per-vertex normal did.
Public API (`createWater`/`updateWater`/`disposeWater`, all uniforms) unchanged — no caller needed
to change. See ADR-0048 for the full alternatives-considered reasoning (steepness reduction and a
larger lake-depth threshold were both considered and rejected as the primary fix).

**Regression guard:** `node --check` clean. Full committed smoke suite — all 8 checks PASS,
including a real shader-compile catch mid-development (an early version of the fix broke
`#include <fog_vertex>`'s implicit `mvPosition` dependency; the 3D-mode boot check caught it
immediately as a `THREE.WebGLProgram: Shader Error`, fixed before commit). Real headless-Chromium
boot screenshot (Playwright, ~2s post-ready) — zero console/page errors, scene renders correctly.
**Correction (this run, later sub-task):** this entry originally also claimed a quantitative
"root-cause proof" here (sampling `water.geometry.attributes.position` before/after `updateWater()`
and reporting `maxDelta: 0`). That probe was invalid — vertex-shader displacement never reaches the
CPU-side `BufferAttribute`, so the *old, buggy* shader reports the identical `maxDelta: 0`, proving
nothing. Caught and replaced later this same run with a real structural check — see ADR-0050.

**Memory-leak checklist:** N/A — shader-internals-only change, no new per-frame allocation,
listener, or timer; `createWater`/`updateWater`/`disposeWater`'s object lifecycle is unchanged.

**Files changed this sub-task:** `src/3d/world/water.js`, `DECISIONS.md` (new ADR-0048),
`3D_GAME_PROGRESS.md` (this file). 3 files, ~70 changed lines. One commit, direct push to `main`.

**World Coverage (unchanged this sub-task): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5%
(6.25 km² / 137.5 km²) mobile — a shader fix touches no terrain/streaming/chunk logic.**

**Sub-task 2 — decision and work (DECISIONS.md ADR-0049):** Priority 1.7 per this run's own
pre-ranked override: a debug/editor free-fly camera (F4), requested to inspect the whole world
(e.g. multiple kingdom seats at once) without touching real-gameplay perf budgets
(`WORLD_DEFAULTS.FAR_PLANE`/`PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS`). New `src/3d/debug/`
folder (already planned in `ARCHITECTURE.md`'s target layout), `freeCamera.js`:
`createFreeCameraController({sourceCamera, domElement})` returns a self-contained controller — its
own `THREE.PerspectiveCamera` (far = 20000m), its own F4 keydown/drag-to-look/resize listeners, and
`update(delta)`/`dispose()`. `game3d.js` only needed to create it, call `update(delta)` once per
frame, render with `freeCamera.camera` instead of `camera` while `.active`, and override
`scene.fog.density` to 0 while active (one line, right after the existing per-frame `updateFog()`
call — restores itself automatically once inactive since `updateFog()` recomputes real density
every frame). The normal chase camera/`OrbitControls`/player keep running underneath, completely
unaware — verified by design, not just claimed (see ADR-0049's "why a second camera object, not a
detached/reused main one" reasoning: `OrbitControls.update()` would otherwise fight any external
camera-position write every single frame).

**Regression guard:** `node --check` clean on both changed/new files. `game3d.js` sits at exactly
600 lines (the project's own file-size cap) — every addition was kept as small as possible
specifically to land this without an extraction refactor of the working, proven chase-cam tick-loop
code (reused `input.js`'s existing `KeyboardInput` rather than duplicating WASD-reading logic;
self-registered listeners inside `freeCamera.js` itself). Full committed smoke suite — all 8 checks
PASS, zero regressions. **Real headless-Chromium verification, exactly as instructed:** booted
`game3d.html`, screenshotted the normal chase-cam view first (baseline, confirmed unaffected),
pressed F4, drag-looked ~45° toward the kingdom-seat cluster (computed offline from
`world/settlements.js`'s `KINGDOM_SEATS` map coordinates — most seats sit 4-8km west/northwest of
the player's `umit` spawn, ADR-0046), flew W+Shift (run) for 4 seconds, drag-looked steeply
downward, screenshotted again. **Result: at least 8 distinct castle models are simultaneously
visible in one frame** — several kingdom-seat clusters with house-colored roof markers, well past
the "en az 2-3 farklı kale" bar — against a visibly extended horizon (terrain and multiple lakes
render far past the normal 2000m far plane, with clean, non-flickering shorelines — a live
incidental confirmation of this same run's sub-task 1 fix). Zero console/page errors before or
after the F4 toggle.

**Memory-leak checklist:** the free camera's `THREE.PerspectiveCamera` and `KeyboardInput` instance
(plus its own `keydown`/`mousedown`/`mouseup`/`mousemove`/`resize` listeners) are all created once
at scene setup and released together via `freeCamera.dispose()`, wired into the existing `pagehide`
teardown chain alongside every other system's cleanup. No per-frame allocation in the inactive
(no-op) path; the active path allocates no new objects either (reuses module-scope scratch
`THREE.Euler`/`Vector3`s, same pattern `camera.js`'s `resolveCameraCollision` already uses).

**Files changed this sub-task:** `src/3d/debug/freeCamera.js` (new), `src/3d/debug/README.md`
(new), `src/3d/game3d.js`, `ARCHITECTURE.md`, `DECISIONS.md` (new ADR-0049), `3D_GAME_PROGRESS.md`
(this file). 6 files, ~290 new/changed lines. One commit, direct push to `main`.

**World Coverage (unchanged this sub-task): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5%
(6.25 km² / 137.5 km²) mobile — a new debug-only camera touches no terrain/streaming/chunk logic.**

**Run totals (2 chained sub-tasks, run 40):** 9 files touched across both sub-tasks
(`src/3d/world/water.js`, `src/3d/world/README.md`, `src/3d/debug/freeCamera.js`,
`src/3d/debug/README.md`, `src/3d/game3d.js`, `ARCHITECTURE.md`, `DECISIONS.md`,
`3D_GAME_PROGRESS.md` — well under the 25-file cap) and ~430 new/changed lines total (well under
the 1200-line budget). 3 commits (one drive-by docs fix + the two sub-tasks), each
regression-guarded (full smoke suite + a real headless-Chromium screenshot or quantitative in-page
probe) and pushed directly to `main`.

**Sub-task 3 — decision and work (DECISIONS.md ADR-0050), continued after "Devam et":** priority 7
(missing smoke-test/regression coverage) for this run's own 2 landed fixes, both of which had only
ad-hoc/throwaway verification. `scripts/game3dSmokeChecks.js` was at 587/600 lines (already
flagged tech debt), too little headroom for 2 new checks — split it: `check2DShell`/`check3DMode`
moved verbatim into a new `scripts/game3dSmokeChecksScene.js` (page/scene-level checks), alongside
2 new checks there (`checkWaterVertexShaderStatic` for ADR-0048, `checkFreeCamera` for ADR-0049);
`game3dSmokeChecks.js` keeps the 6 per-entity gameplay checks. `smokeTestGame3D.js` now runs 10
checks total (was 8).

**A mistake caught and corrected, not silently fixed:** building `checkWaterVertexShaderStatic`'s
first draft (a `geometry.attributes.position` before/after comparison — the same technique run 40's
own sub-task 1 had already used and called a "root-cause proof") and testing it against the actual
pre-fix shader (to confirm it would catch a regression) revealed it does not: a vertex shader's
displacement runs entirely on the GPU inside `gl_Position`, never written back to the CPU-side
buffer JS can read — so that comparison always reports `maxDelta: 0`, old buggy shader or new fixed
one alike. **This means sub-task 1's own "Root-cause proof" claim earlier in this same run was
invalid from the moment it was written.** Both this file's sub-task-1 entry above and `DECISIONS.md`
ADR-0048 now carry an explicit correction note instead of a silent edit — see ADR-0050 for the full
account. Replaced with a real structural check instead: the compiled vertex shader source must
contain no `uTime` and no `sin(`/`cos(` calls — verified to correctly fail against the real pre-fix
shader and correctly pass against the real current one.

**Regression guard:** `node --check` clean on all 3 files. Full smoke suite — all **10** checks
PASS. Both new checks independently verified to catch a real regression (this project's own
"demonstrated real failure path" standard, ADR-0042): `checkWaterVertexShaderStatic` run against a
`git show` of the actual pre-ADR-0048 `water.js` reports `ok: false`; `checkFreeCamera` run against
a one-line-patched `freeCamera.js` (deactivate branch stubbed out) reports `ok: false`
(`deactivatedOnSecondF4: false`). Both source files restored immediately after, confirmed clean via
`git diff` — verification-only edits, never part of the shipped change.

**Memory-leak checklist:** N/A — test-infrastructure-only change, no runtime code path touched.

**Files changed this sub-task:** `scripts/game3dSmokeChecksScene.js` (new), `scripts/
game3dSmokeChecks.js`, `scripts/smokeTestGame3D.js`, `DECISIONS.md` (correction + new ADR-0050),
`3D_GAME_PROGRESS.md` (this file, correction + this entry). 5 files, ~330 new/changed lines.

**World Coverage (unchanged this sub-task): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5%
(6.25 km² / 137.5 km²) mobile — test-infrastructure-only, no terrain/streaming touched.**

**Run totals (3 chained sub-tasks, run 40):** 12 files touched across all 3 sub-tasks (well under
the 25-file cap) and ~760 new/changed lines total (well under the 1200-line budget). 5 commits (1
drive-by docs fix + 3 sub-tasks + this coverage sub-task pending its own commit below), each
regression-guarded.

**Sub-task 4 — decision and work (DECISIONS.md ADR-0051), continued after a second "Devam et":**
priority 9's flagged FAZ 5 gap — real per-NPC dialogue content, replacing the single generic
`GREETING_TEMPLATE` every NPC shared since run 33. New `config.js` `INTERACTION_CONFIG.
GREETINGS_BY_NPC_ID`: one hand-written, house-flavored Turkish line per `NPC_CONFIG.SPAWNS` id (14
total, original writing — not adapted from the show). `gameplay/interaction.js`'s `openDialogue`
looks the speaker up by `npc.object3D.name` (already carrying the spawn id since run 20 — no
`npc.js` change needed), falling back to the old template for any unmapped id. `game3d.js`'s one
call site gained the new option on the same source line as the existing one — net zero new lines,
since the file sits at the 600-line cap exactly.

**Regression guard:** `node --check` clean, `game3d.js` confirmed still exactly 600 lines. Full
smoke suite — all 10 checks PASS; `checkInteractionController` extended with 2 new assertions
(per-NPC lookup used when the id matches, falls back to template when it doesn't) in the same run.
**Real headless-Chromium proof:** rendered the actual `ui/dialogueBox.js` component (real DOM/CSS)
with 2 real entries pulled live from `config.js` — `umit-guard-1` and `jon-guard-1` — screenshotted
both, visibly distinct correctly-styled text. A coverage check over all 14 `NPC_CONFIG.SPAWNS` ids
found 0 missing entries and 14 unique strings (no accidental duplicate). Zero console/page errors.

**Memory-leak checklist:** N/A — a config data table + one lookup at dialogue-open time; no new
per-frame allocation, listener, or timer.

**Files changed this sub-task:** `src/3d/config.js`, `src/3d/gameplay/interaction.js`,
`src/3d/game3d.js`, `scripts/game3dSmokeChecks.js`, `DECISIONS.md` (new ADR-0051),
`3D_GAME_PROGRESS.md` (this file, correction + this entry). 6 files, ~90 new/changed lines.

**World Coverage (unchanged this sub-task): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5%
(6.25 km² / 137.5 km²) mobile — dialogue content only, no terrain/streaming touched.**

**Run totals (4 chained sub-tasks, run 40):** 15 files touched across all 4 sub-tasks (well under
the 25-file cap) and ~850 new/changed lines total (well under the 1200-line budget). 6 commits (1
drive-by docs fix + 4 sub-tasks + this dialogue sub-task pending its own commit below), each
regression-guarded (full smoke suite plus a real headless-Chromium screenshot or verified-against-
a-real-regression check).

**Next step for the next run:** re-scan the priority order fresh, as always — priorities 1/1.5/1.7
are resolved, priority 7 has coverage for run 40's fixes, and priority 9's dialogue-content gap is
closed. Likely next landing spots: priority 8 (World Coverage, flat at 80.7%/4.5% since run 15,
deferred twice already — see run 39's ADR-0047 Context for what a safe attempt needs: either
`renderer.info`-based triangle/draw-call instrumentation first, or a smaller step than
`PHASE1_PREVIEW_RADIUS_CHUNKS` 10 -> 11); FAZ 5/6's remaining gap (cart/dog-cat/bird still need a
human manual-download step — mark "insan onayı gerekli" and stop if attempted); FAZ 7 (dragons —
`verdant_wyrm` model ready, no code started); or the priority-9.5 world-events/EventBus-expansion
task, not yet reached across 2 runs now. `game3d.js` is at the 600-line cap exactly — the next run
touching it for anything beyond a pure line-for-line swap will need to extract something first.
**Standing lesson from this run's own correction (ADR-0050):** when a verification claim can't be
tested against a known-bad case (the old shader, a broken toggle), treat it as unverified, not
proven — this run's mistake and fix are exactly that pattern; apply it to every future "Verified"
bullet, not just this file's water/camera checks.

## This Run (2026-07-30, run 41)

**Session Snapshot at container boot:** `HEAD` was detached at run 40's final commit (`8e8d7cb`,
ADR-0051's per-NPC dialogue) with a stale local `main` cached ref pointing at a much older
pre-3D-mode commit (same pattern run 40 itself hit at boot) — `git fetch origin main` confirmed the
real remote `main` already matched the detached `HEAD` exactly, no divergence or lost work, then
`git checkout -B main origin/main` reattached cleanly. Both of this run's own pre-ranked priority
items — 1.5 (lake-water flicker) and 1.7 (F4 debug free-camera) — were already landed in run 40
(commits `2dfc85f`/`7642de6`, ADR-0048/ADR-0049), confirmed via `git log --oneline -10` and this
file's own run-40 entry, including the exact "multiple kingdom seats visible via F4" real
headless-Chromium proof this run's own instructions asked for. Both skipped per the "already
verified, don't redo" rule. Re-ran the full smoke suite as a fresh regression-guard baseline before
any new work: one `3D mode` timeout on the very first run (confirmed cold-start flake, not a
regression — an immediate second run passed all 10/10 checks).

**Sub-task 1 — decision and work (DECISIONS.md ADR-0052):** priority scan found no syntax error/
blocking bug/perf overrun/memory leak. Priority 8 (World Coverage) is next per run 40's own "Next
step", but its own prerequisite (real `renderer.info`-based triangle/draw-call instrumentation,
flagged as missing by both ADR-0047 and ADR-0049) doesn't exist yet — building it (an F2 debug
panel, already planned in `ARCHITECTURE.md`'s target layout) is really priority 6 (tech debt/missing
tooling) in its own right. But `game3d.js` sat at the project's 600-line cap exactly, with no room
for even a small F2 hookup. This sub-task is the prerequisite extraction: `game3d.js`'s
`createScene`/`isCoarsePointerDevice`/`worldToChunkCoord` moved verbatim into a new `sceneManager.js`
(setup-time factories only; every `update*`/`dispose*` call stayed in `game3d.js`'s own tick loop/
teardown chain, since those are what actually call them every frame). `game3d.js`: 600 -> 433 lines.
A full move into the target `core/` folder was considered and deferred — every other "core" module
(`eventBus.js`, `state.js`, `assetLoader.js`, `config.js`, `input.js`) is still flat at `src/3d/`, so
nesting only this file would be a half-migrated layout, not a cleaner one. See ADR-0052 for the full
per-import breakdown and alternatives considered.

**Regression guard:** `node --check` clean on both files. `wc -l`: `game3d.js` 433 lines,
`sceneManager.js` 187 lines — both comfortably under the 600-line cap. Full committed smoke suite —
all 10 checks PASS, zero regressions (including `checkFreeCamera`, proving the F4 camera — now
constructed inside `sceneManager.js` — still works identically). `node scripts/
checkAssetsManifest.js` — clean (no asset files touched, unaffected).

**Memory-leak checklist:** N/A — pure code relocation, no change to what's created, when it's
created, or when it's disposed; the same objects are constructed in the same order with the same
lifetimes, just from a different file.

**Files changed this sub-task:** `src/3d/sceneManager.js` (new), `src/3d/game3d.js`,
`ARCHITECTURE.md`, `DECISIONS.md` (new ADR-0052), `3D_GAME_PROGRESS.md` (this file). 5 files, ~440
new/changed lines (mostly the moved code's own doc comments, carried over verbatim). One commit,
direct push to `main`.

**World Coverage (unchanged this sub-task): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5%
(6.25 km² / 137.5 km²) mobile — a pure code-organization refactor touches no terrain/streaming/chunk
logic or values.**

**Sub-task 2 — decision and work (DECISIONS.md ADR-0053), continued after "Devam et":** priority 6
(tech debt/missing tooling), the real prerequisite behind priority 8's twice-deferred World Coverage
growth (ADR-0047, ADR-0049 both found the same blocker: no `renderer.info`-based instrumentation to
measure a chunk-radius bump's real, not estimated, triangle/draw-call cost). New `src/3d/debug/
perfPanel.js`: F2 toggles a real-time `renderer.info` readout (draw calls, triangles, geometry/
texture object counts) against this project's own desktop/mobile perf budgets — same self-contained
conventions `freeCamera.js` (F4) established (own listener, own DOM, no-op while inactive, full
`dispose()`). `game3d.js` creates one instance and calls `update(delta)` immediately after
`renderer.render()` each frame (required ordering — `renderer.info` resets on every `render()`
call). `game3d.js`: 433 -> 442 lines (9 new lines: import, create call, one comment + update call,
one dispose call) — well under the cap, exactly the headroom sub-task 1 existed to free up.

**Regression guard:** `node --check` clean on both files. `wc -l`: `game3d.js` 442 lines,
`perfPanel.js` 92 lines. Full committed smoke suite — all 10 checks PASS, zero regressions. **Real
headless-Chromium proof:** booted `game3d.html`, screenshotted the hidden baseline, pressed F2,
screenshotted again — the panel legibly shows real live numbers from the actual boot-preview scene
(`Draw calls: 38 / 2500`, `Triangles: 337,993 / 5,000,000`, `Geometries: 38`, `Textures: 14`), a
second F2 press correctly re-hides it, zero console/page errors throughout.

**Memory-leak checklist:** the panel's one DOM node and one `window` `keydown` listener are created
once at scene setup and released together via `perfPanel.dispose()`, wired into the existing
`pagehide` teardown chain. No per-frame allocation in the inactive path (`update()` returns
immediately); the active path's DOM write is throttled to 4/sec, not every frame.

**Files changed this sub-task:** `src/3d/debug/perfPanel.js` (new), `src/3d/game3d.js`,
`game3d.css`, `src/3d/debug/README.md`, `ARCHITECTURE.md`, `DECISIONS.md` (new ADR-0053),
`3D_GAME_PROGRESS.md` (this file). 7 files, ~200 new/changed lines. One commit, direct push to
`main`.

**World Coverage (unchanged this sub-task): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5%
(6.25 km² / 137.5 km²) mobile — a new debug-only panel touches no terrain/streaming/chunk logic;
it now exists as the real instrumentation the *next* World Coverage attempt needs to be safe.**

**Sub-task 3 — decision and work (DECISIONS.md ADR-0054), continued after a second "Devam et":**
priority 7 (missing smoke-test/regression coverage) for sub-task 2's own F2 panel, which so far only
had this run's throwaway verification screenshot script. New `checkPerfPanel` in
`game3dSmokeChecksScene.js` (same isolation pattern as `checkFreeCamera`, a synthetic fake
`renderer` object standing in for a real `WebGLRenderer`): asserts inactive-by-default/no-op, the
refresh throttle, a live re-read of `renderer.info`, the over-budget flag, F2 toggle, `dispose()`
removing the DOM node, and that `isMobileClass` really swaps in the mobile budget. `smokeTestGame3D.js`
now runs **11** checks (was 10).

**Regression guard:** `node --check` clean on both files. Full smoke suite — all 11 checks PASS.
**Confirmed to catch a real regression, not just pass on the happy path** (this project's own
established standard, ADR-0042/ADR-0050): temporarily patched `perfPanel.js`'s F2 handler to always
activate (never deactivate), re-ran the suite — `checkPerfPanel` correctly failed with
`deactivatedOnSecondF2: false, hiddenAfterSecondF2: false`, every other assertion still `true`.
Source file restored immediately after — `git diff --stat` confirmed byte-identical to `HEAD`, then
re-ran the suite once more to confirm a clean 11/11 PASS. Verification-only edit, never shipped.

**Memory-leak checklist:** N/A — test-infrastructure-only change, no runtime code path touched.

**Files changed this sub-task:** `scripts/game3dSmokeChecksScene.js`, `scripts/smokeTestGame3D.js`,
`DECISIONS.md` (new ADR-0054), `3D_GAME_PROGRESS.md` (this file). 4 files, ~100 new/changed lines.
One commit, direct push to `main`.

**World Coverage (unchanged this sub-task): 80.7% (111.00 km² / 137.5 km²) desktop; 4.5%
(6.25 km² / 137.5 km²) mobile — test-infrastructure-only, no terrain/streaming touched.**

**Run totals (3 chained sub-tasks, run 41):** 15 files touched across all 3 sub-tasks
(`src/3d/sceneManager.js`, `src/3d/game3d.js`, `src/3d/debug/perfPanel.js`, `game3d.css`,
`src/3d/debug/README.md`, `scripts/game3dSmokeChecksScene.js`, `scripts/smokeTestGame3D.js`,
`ARCHITECTURE.md`, `DECISIONS.md`, `3D_GAME_PROGRESS.md` — well under the 25-file cap) and ~970
new/changed lines total (well under the 1200-line budget). 3 commits, each regression-guarded (full
smoke suite plus a real headless-Chromium screenshot or a demonstrated-real-failure-path check).

**Next step for the next run:** re-scan the priority order fresh, as always. Priority 8 (World
Coverage) now has its real prerequisite (F2's `renderer.info` readout) — a future run could boot
`game3d.html`, press F2, read the live draw-call/triangle numbers against `DESKTOP_BUDGET`
(`debug/perfPanel.js`), and use *that* real headroom (not `chunkManager`'s estimate) to decide how
far `PHASE1_PREVIEW_RADIUS_CHUNKS` can safely grow — this run intentionally left that actual bump
undone, since it's a separate, real-headroom-dependent decision, not automatically safe just because
the instrumentation now exists. Other open items unchanged from run 40's own list: FAZ 5/6's
cart/dog-cat/bird gap (needs a human manual-download step); FAZ 7 (dragons — `verdant_wyrm` ready,
no code started); priority-9.5 world-events/EventBus expansion (not yet reached across 3 runs now).
`game3d.js` is at 442/600 lines and `config.js` at 597/600 — both have some headroom now, but
`config.js`'s is thin; a future addition there may need its own extraction first.

## This Run (2026-07-30, run 42)

**Session Snapshot at container boot:** `HEAD` was detached at run 41's final commit (`70980b5`,
ADR-0054's F2 regression coverage), local `main` cached ref stale (same pattern every run since 40
hits) — `git fetch origin main` confirmed real remote `main` already matched `HEAD` exactly, then
`git checkout -B main origin/main` reattached cleanly, zero divergence/lost work. Both of this run's
own pre-ranked priority items — 1.5 (lake-water flicker) and 1.7 (F4 debug free-camera) — were
already landed in run 40 (ADR-0048/ADR-0049), and this run's own new instruction (1.7's "debug free
camera") had also already shipped, so both were skipped per the "already verified, don't redo" rule,
confirmed via `git log --oneline -10` and run 40/41's own entries. Full smoke suite (11 checks)
re-run as a fresh regression-guard baseline — all PASS before any new work.

**Sub-task 1 — decision and work (DECISIONS.md ADR-0055):** priority scan found no syntax error/
blocking bug/perf overrun/memory leak, and no missing regression coverage. Priority 8 (World
Coverage, flat at 80.7% desktop since run 15) was next, and — unlike every prior run that considered
it — finally had its real prerequisite: run 41's F2 panel plus the existing F4 free-camera. Wrote a
throwaway headless-Chromium script (not committed) combining both: F4 to altitude, pitch the camera
down, F2 to read `renderer.info` while looking down at the *entire* loaded chunk square at once —
the closest approximation this project can get to a real worst-case reading, instead of either the
boot camera's narrow sample or a hand-computed per-chunk estimate. Measured radius 10's real cost
(320 draw calls / 2,186,879 triangles — well under ADR-0014's own conservative estimate), then
picked radius 11 (not 12, to avoid loading terrain outside the designed 137.5 km² extent — see
ADR-0055's Reasoning) and re-measured to confirm the new cost before committing: **351 draw calls
(14.0%) / 2,440,831 triangles (48.8%)**, both comfortably clear. `config.js`'s
`PHASE1_PREVIEW_RADIUS_CHUNKS`: 10 -> 11.

**Regression guard:** `node --check src/3d/config.js` clean, file at 597/600 lines (comment written
tight to avoid pushing past the cap, per run 41's own flag that this file's headroom was thin). Full
committed smoke suite — all 11 checks PASS, zero regressions. **Real headless-Chromium proof:**
normal boot/chase-cam screenshot unaffected (player + castle render identically); F4+F2 aerial
screenshot shows the perf panel's live numbers plus at least 4 distinct castle silhouettes and a
river simultaneously in frame, over a visibly wider area than the same shot at radius 10; console
confirms `"Loaded 529 terrain chunks (~132.25 km²) ... (desktop-class device — full preview
radius)"` then `"Placed 14 kingdom-seat settlements; 529 terrain chunks resident (~132.25 km²)
after grounding them"` (no extra grounding spillover this time, unlike radius 10's +3 for Night
King); zero console/page errors in any of the four screenshots taken (radius 10 boot, radius 10
aerial, radius 11 boot, radius 11 aerial).

**Memory-leak checklist:** N/A — a single config constant changed; no new listeners/DOM
nodes/GPU resources beyond the terrain chunks `ChunkManager` already knew how to load/dispose.

**Files changed this sub-task:** `src/3d/config.js`, `DECISIONS.md` (new ADR-0055),
`3D_GAME_PROGRESS.md` (this file). 3 files, ~110 new/changed lines (mostly ADR-0055's own
reasoning/verification prose). One commit, direct push to `main`.

**World Coverage (after this sub-task): 96.2% (132.25 km² / 137.5 km²) desktop — up from 80.7%
(111.00 km²); 4.5% (6.25 km² / 137.5 km²) mobile, unchanged (`STREAM_RADIUS_CHUNKS` untouched, same
device branch as every prior radius change).**

**Next step for the next run:** re-scan the priority order fresh, as always. World Coverage's own
gate (80%) has been clear since run 29 and is now comfortably ahead of it (96.2%) — a future run
should not treat "grow it further" as automatically the next priority-8 pick without a fresh reason
(e.g. new content changing the real measured headroom); radius 12+ was deliberately rejected this
run for loading terrain outside the designed world extent (ADR-0055). Other open items unchanged:
FAZ 5/6's cart/dog-cat/bird gap (needs a human manual-download step); FAZ 7 (dragons —
`verdant_wyrm` ready, no code started); priority-9.5 world-events/EventBus expansion (not yet
reached across 4 runs now — likely the best next pick if no higher-priority regression/bug turns
up). `game3d.js` is at 442/600 lines, `config.js` at 597/600 (still thin headroom).

## Known Issues / Tech Debt

- **~~Player spawned at the world origin — 2.5-6km from every kingdom seat, beyond `fog.js`'s
  visibility range, so the game looked completely empty on boot~~ — fixed run 39 (`config.js`'s
  `PLAYER_CONFIG.SPAWN_MAP_X`/`SPAWN_MAP_Y`, DECISIONS.md ADR-0046).** The world origin is
  `mapToWorldXZ`'s convention for the *center* of the padded kingdom-seat bounding box, not any
  seat itself — every real kingdom seat sits well outside `fog.js`'s ~2.8-3.8km FogExp2 visibility
  range from there. The player now spawns ~60m from `umit` (the project owner's own kingdom seat),
  verified with a real headless-Chromium screenshot showing a castle tower immediately in view, not
  just "no console error". **Still open:** the other 13 seats remain 2.5-6km away with no compass/
  minimap (FAZ 8) to guide the player toward them — a real, separately-tracked future gap, not
  solved by this fix.
- **~~No river-path concept~~ — a first pass landed run 10 (`world/rivers.js`).** See DECISIONS.md
  ADR-0009's Consequence section.
- **~~Waterfalls need a steep-height-drop detector~~ — landed run 12 (`detectWaterfalls`/
  `createWaterfallMesh` in `world/rivers.js`).** Thresholds calibrated against the real traced
  river (seed 1337): 2 segments flagged. The visual is a deliberately schematic vertical curtain,
  not a terrain-carved cliff (`terrain.js` has no real cliff relief) — see DECISIONS.md ADR-0011.
- **`world/rivers.js` is one static river, not a network, and doesn't stream.** Generated once at
  boot, confined to a fixed radius around the origin (see ADR-0009) — a real multi-river system
  tied to `ChunkManager`'s streaming (so rivers appear/persist correctly as the player explores
  beyond the FAZ 1 preview area) is future work, not this pass's scope.
- **`stars.js`'s starfield is a fixed, non-twinkling pattern.** Same seed always produces the same
  star positions (by design — determinism rule), but there's no per-star flicker/twinkle animation
  and no relation to real astronomical positions — a flat, uniform opacity per scene, not per-star
  variation. See DECISIONS.md ADR-0012's Consequence for what a future flow-animated pass would need.
- **Volumetric light (god rays) intentionally deferred, not skipped.** Flagged in the FAZ 2 roadmap
  and DECISIONS.md ADR-0012's Consequence as needing a real post-processing pipeline
  (`EffectComposer`/render targets) this project doesn't have yet — that's FAZ 9's `postfx.js`
  scope. Building it in isolation now would mean either half-building a postfx pipeline early or a
  fragile screen-space fake; wait for FAZ 9's groundwork.
- **`world/rivers.js`'s surface doesn't flow-animate.** Uses a static built-in `MeshStandardMaterial`
  (see ADR-0009's Alternatives) — no scrolling-UV or foam shader like `world/water.js`'s Gerstner
  waves. Low priority until the river network itself is more developed.
- **~~`sky.js`'s aurora is always-on, not gated by time-of-day~~ — fixed run 7.** `lighting.js`
  now drives a real day/night cycle; the aurora fades out in daylight via `uNightFactor` (see
  DECISIONS.md ADR-0006).
- **~~`sky.js`'s aurora is always-on, not gated by time-of-day~~ — fixed run 7.** `lighting.js`
  now drives a real day/night cycle; the aurora fades out in daylight via `uNightFactor` (see
  DECISIONS.md ADR-0006).
- **~~`world/water.js` does not participate in `scene.fog`~~ — fixed run 9.** Added the
  `fog_pars_vertex`/`fog_vertex`/`fog_pars_fragment`/`fog_fragment` chunks, `fog: true`, and a
  `THREE.UniformsLib.fog` merge into its uniforms (the non-obvious missing piece — see DECISIONS.md
  ADR-0008 for the exact `WebGLRenderer` internals this required and the runtime error it threw
  before the uniform merge was added).
- **Volumetric light (god rays / light shafts) not started.** FAZ 2's roadmap lists this alongside
  fog; only the distance-fog half is done (see Roadmap above). True volumetric lighting is a larger,
  separate technique (screen-space raymarching or similar) — do not assume it's covered by `fog.js`.
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
- **~~`FBXLoader` not vendored yet~~ — vendored run 17** (`vendor/three/addons/loaders/
  FBXLoader.js` + its `libs/fflate.module.js`/`curves/NURBSCurve.js`/`curves/NURBSUtils.js`
  transitive deps). `gameplay/player.js` uses it to load `peasant_girl.fbx` + its three animation
  clips. See DECISIONS.md ADR-0016.
- **~~Chase camera has no wall-avoidance raycast~~ — landed run 19 (`camera.js`'s
  `resolveCameraCollision`).** Raycasts from `controls.target` toward the desired camera position
  every frame against nearby terrain chunks + settlement parts, pulling the camera in front of
  whatever it hits — see DECISIONS.md ADR-0018. The pull-in is deliberately non-persistent (applied
  only for that frame's render, restored right after) so the user's actual zoom/orbit distance is
  never permanently shrunk. **~~Still open: player can still walk through castle walls~~ — fixed
  run 35** (`physics.js`'s `createSettlementCollider`, DECISIONS.md ADR-0037) — see the settlements
  collider item below for the shape/verification details.
- **~~FAZ 4's own remaining gap: no gravity/jump physics~~ — fixed run 36** (`physics.js`'s
  `integrateJumpArc`, DECISIONS.md ADR-0039). Space (desktop keyboard only — `input.js`'s
  `KeyboardInput`, edge-triggered so holding it doesn't chain-jump) launches a small ≈1.2m ballistic
  hop; gravity (`PLAYER_CONFIG.GRAVITY_MPS2`) pulls the player back down, composing with the
  existing ground-height snap (0 height-above-ground reproduces the pre-run-36 behavior exactly, so
  slope/step-following is unaffected) and the settlement collider (horizontal movement is still
  resolved through `resolveXZ` before the vertical arc). **Still open:** no jump/fall animation clip
  (none was ever downloaded — the character keeps its current idle/walk/run pose while airborne);
  `ui/touchJoystick.js` has no jump control yet (mobile/touch players can't jump); jump height/
  gravity feel is a first-pass tuning value, not focus-tested against real gameplay.
- **FAZ 5's NPCs exist at 13 of 14 kingdom seats now, with no real dialogue content (open/close
  now works since run 33, but the greeting itself is one generic line, not per-NPC content).**
  `NPC_CONFIG.SPAWNS` places 14 NPCs across `stannis` (2), `umit`, `cersei`, `berkalp`, `doran`,
  `ziya`, `balon`, `robin`, `jon`, `Xaro`, `berk`, `olena`, and `twin` (1 each) — only `Night King`
  (deliberately excluded, see DECISIONS.md ADR-0024) still has none. **~~9 of 14 seats have zero
  NPCs~~ — narrowed to 5 in run 25, narrowed to 4 in run 31, narrowed to 0 (excluding the
  deliberately-excluded `Night King`) in run 34** (run 25: 4 more seats added by reusing
  already-downloaded models, no new asset, DECISIONS.md ADR-0024; run 31: `Xaro`, a house not yet
  represented, added the same way — see DECISIONS.md ADR-0031; **run 34: the last 3 seats
  (`berk`/`olena`/`twin`) added, each reusing an already-downloaded model and its house's existing
  guard displayName — see DECISIONS.md ADR-0036**). **Every real kingdom seat now has at least one
  NPC.** **~~Patrol-only-at-2-of-6~~ — landed run 24** (config-only extension of ADR-0021's proven
  geometry, see DECISIONS.md ADR-0023) — **all 11 NPCs now patrol** a 24m back-and-forth line with
  idle pauses and directional turning. **~~No name-tag UI~~ — landed run 23**
  (`gameplay/npc.js`'s `createNameTagSprite`, a billboard `THREE.Sprite` above each NPC's head, see
  DECISIONS.md ADR-0022) — all 11 NPCs now show a house-flavored Turkish name tag. **~~No
  interaction affordance at all~~ — first pass landed run 32** (`ui/interactionPrompt.js`, a static
  "E - Selamla" prompt shown within 6m of any NPC — see DECISIONS.md ADR-0032). **~~No keypress
  handling~~ — landed run 33** (`gameplay/interaction.js`'s new controller, DECISIONS.md ADR-0033):
  pressing E while the prompt shows opens `ui/dialogueBox.js` with a greeting naming the NPC (via
  its `displayName`), Escape or E again closes it, and walking out of range — the player's or the
  patrolling NPC's own movement, either counts — auto-closes it. **~~The greeting was one static
  template, identical for every NPC~~ — fixed run 40** (`config.js`'s `INTERACTION_CONFIG.
  GREETINGS_BY_NPC_ID`, DECISIONS.md ADR-0051) — all 14 NPCs now speak their own hand-written,
  house-flavored line. **Still no real dialogue system:** no branching, no reply options, no quest
  hooks — one static line per NPC, not a tree. No NPC reacts to the player's presence otherwise —
  patrol runs on a fixed clock/route regardless of where the player is, deliberately not real
  behavior-tree AI. All remaining gaps are honest, scoped-out ones (see
  DECISIONS.md ADR-0019/ADR-0020/ADR-0021/ADR-0022/ADR-0023/ADR-0024/ADR-0031/ADR-0032/ADR-0033/
  ADR-0051's "Alternatives considered"), not accidental. **~~Every patrolling NPC's and wolf's `update()`
  idled a full `pauseSeconds` before its first distance-to-waypoint check ever ran, so it idled
  *two* full `pauseSeconds` cycles (not one) before its first real step~~ — documented run 38
  sub-tasks 1/2 (DECISIONS.md ADR-0043/ADR-0044), fixed run 38 sub-task 3 (ADR-0045).** `pauseTimer`
  now starts at 0 in both `gameplay/npc.js` and `gameplay/animals.js` (identical one-line fix in
  both, since it was present identically in both — same copied-not-shared code), so the
  zero-distance "arrival" at waypoint 0 (always the entity's own spawn point) resolves immediately
  on the first `update()` call and the real `pauseSeconds` dwell only happens once, matching every
  later lap. Verified via reverting each file independently and confirming its own
  already-updated regression check (`checkNpcPatrol`/`checkWolfPatrol`) catches the regression
  while the other stays PASS.
- **FAZ 6's wolves exist at only one seat, with no real pathfinding AI.** 3 wolves at
  `berkalp` (`ANIMAL_CONFIG.SPAWNS`). **~~static/idle only, no wander~~ — landed run 27**
  (`gameplay/animals.js`'s patrol support, copied from `gameplay/npc.js`'s proven pattern, see
  DECISIONS.md ADR-0026) — all wolves patrol a 20m line. **~~no player-reaction (flee/aggro)~~ —
  landed run 28** (DECISIONS.md ADR-0027) — a wolf within 15m of the player now overrides idle/patrol
  and runs straight away at 4.5 m/s until safe, no hysteresis distance. **~~no herd reaction (the
  second wolf doesn't react to the first one fleeing)~~ — landed run 29** (DECISIONS.md ADR-0029) —
  a wolf within `PACK_ALERT_RADIUS_METERS` (20m) of an already-fleeing packmate now also flees, still
  running away from the player (the actual threat), not the packmate; verified with both a live
  proximity smoke test and a direct-call unit test isolating the pack-only trigger path (see "This
  Run (run 29)" below). **~~Only ever tested with 2 wolves — a 3rd animal's chained pack-alert
  propagation is unverified~~ — landed run 30** (DECISIONS.md ADR-0030) — a 3rd wolf
  (`berkalp-wolf-3`, config-only, same downloaded model) was added specifically to test this, and a
  direct-call 3-frame chain test (plus a negative control) confirmed a wolf outside any single
  wolf's direct pack-alert range still flees once its own in-range packmate starts fleeing — see
  "This Run (run 30)" below. **~~Flee/pack-alert had no persisted regression coverage, only ad hoc
  debug-hook verification~~ — fixed run 37** (`scripts/smokeTestGame3D.js`'s `checkWolfPackAlert`,
  DECISIONS.md ADR-0042) — replays the exact run-30 chain scenario as a committed, always-run
  assertion, with a demonstrated real failure path. **~~Only wolves exist, no other animal type~~ —
  narrowed run 39** (`umit-horse-1`, a static/idle horse at `umit`, reusing the manually-added
  `ivory_stallion.glb` — see DECISIONS.md ADR-0047). Geometry-only (no rig/animation clips), so it's
  static/idle-only, not patrolling/fleeing — matches wolves' own run-26 starting scope before rigged
  animation enabled patrol/flee later. Cart, dog/cat, and bird still have no downloaded asset — each
  needs a human manual-download step (see below), same constraint every future asset addition faces.
  `npc.js`'s and `animals.js`'s patrol/turn movement logic is still
  duplicated across 2 files (deliberate, see ADR-0026's "why duplicate" — revisit extraction only at
  a 3rd consumer). NPCs have no equivalent player/pack-awareness yet — a real, still-open FAZ 5 gap
  (could reuse this run's exact pattern if a future run wants it).
- **~~`src/3d/game3d.js` exceeded the project's 600-line-per-file Golden Rule (was 610 lines)~~ —
  caught and fixed run 29 (DECISIONS.md ADR-0028).** Crept past the cap gradually across runs 20-28
  as FAZ 5/6 spawn logic was added incrementally; no run's self-review had re-measured `wc -l` against
  the cap since early on. Fixed by moving the NPC/animal spawn-resolution loops into
  `gameplay/npc.js`'s new `spawnConfiguredNPCs` and `gameplay/animals.js`'s new
  `spawnConfiguredAnimals` (verbatim logic move, not a rewrite — see ADR-0028's Verified section).
  `game3d.js` is now 552 lines. **Flagging for every future run's Session Snapshot: re-check `wc -l`
  against the 600-line cap on every touched file, not just when a file "looks long"** — this is now a
  standing checklist item, not a one-time fix.
- **~~No touch joystick for FAZ 4 movement~~ — landed run 18 (`ui/touchJoystick.js`).** Mobile-class
  devices now get an on-screen joystick alongside keyboard (`input.js`) support — see DECISIONS.md
  ADR-0017. Verified via a Playwright-simulated drag (Pointer Events treat mouse and touch drags
  identically), not a real physical touch device — this sandbox still can't provide one, same
  caveat as every other "mobile" verification in this file.
- **Any future Mixamo/Free3D asset needs a human step.** The cloud agent cannot log into Mixamo,
  and Free3D's download flow doesn't trigger via automated browser clicks either (per the wolf/
  dragon commit message). If a later phase needs a new character/creature/animation, mark it here
  as "insan onayı gerekli — manuel indirme" and stop; do not attempt to fetch it automatically.
- **~~`assets_manifest.json` is hand-maintained, no automated check that it matches `assets/`~~ —
  fixed run 34 (`scripts/checkAssetsManifest.js`).** A dependency-free Node script hard-fails if any
  manifest entry points at a missing file, or if any `.fbx`/`.glb` on disk isn't registered
  (unregistered license/source would go untracked); soft-warns (non-fatal) on texture/sidecar files
  that legitimately ship without their own entry. Run manually — `node
  scripts/checkAssetsManifest.js` — after touching `assets/` or the manifest; not wired into CI
  (none exists in this repo). See DECISIONS.md ADR-0034.
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
- **~~`world/settlements.js`'s castles have no PBR texture maps~~ — fixed run 16
  (`world/materials.js`).** See DECISIONS.md ADR-0015. **~~No collider~~ — fixed run 35**
  (`physics.js`'s `createSettlementCollider`, DECISIONS.md ADR-0037): a box (keep) + 4 circles
  (corner towers) per seat, grown by a small player-radius margin; `gameplay/player.js` resolves
  the player's horizontal movement through it every frame, so the player can no longer walk through
  a castle. Verified both in isolation (a simulated 200+ frame walk straight at a synthetic
  castle's center stops exactly at the keep's half-extent, not before/after) and via the real
  headless-Chromium smoke test (zero regressions, normal open-field movement unaffected). **Still
  no LOD** — a fixed triangle count regardless of camera distance; `settlements.js`'s
  `InstancedMesh` already keeps this at 3 draw calls total though, so this is real but low-urgency
  remaining work, not a measured perf problem. This is FAZ 3's one remaining open sub-task.
- **Kingdom seats outside the desktop boot-preview radius render without visible ground on
  mobile-class devices.** By design (see DECISIONS.md ADR-0013's "real mobile perf-budget bug"):
  force-loading a terrain neighborhood under every seat on mobile would add ~753K triangles, 1.9x
  the mobile triangle budget on its own. Settlements still sample the correct real terrain height on
  mobile, they just may lack a visible ground mesh directly beneath until a later phase's
  player-driven streaming naturally reaches that chunk. Revisit once FAZ 4 gives mobile a real
  streaming trigger.
- Sky, water, weather, AI, physics, audio, UI, save-bridge — none of the *unstarted* ones exist yet
  (terrain/sky/water/settlements now do — see the Roadmap above for what's live per phase).
  This is expected; Phase 0 was architecture-only by design.

## Asset Sources (CC0 / CC-BY / MIT — no HBO/show media)

| File(s) | Source | License | Notes |
|---|---|---|---|
| `src/3d/vendor/three/three.module.js`, `LICENSE` | [three.js](https://github.com/mrdoob/three.js) r160, via `unpkg.com/three@0.160.0/build/three.module.js` | MIT | Vendored (not npm-installed) so the PWA stays a static, offline-installable site with no build step. |
| `src/3d/vendor/three/addons/loaders/GLTFLoader.js` | three.js r160 `examples/jsm/loaders/GLTFLoader.js` | MIT | Lazy dynamic-imported by `AssetLoader` only when a model load is first requested. |
| `src/3d/vendor/three/addons/utils/BufferGeometryUtils.js` | three.js r160 `examples/jsm/utils/BufferGeometryUtils.js` | MIT | Transitive dependency of `GLTFLoader.js`. |
| `src/3d/vendor/three/addons/controls/OrbitControls.js` | three.js r160 `examples/jsm/controls/OrbitControls.js`, via `unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js` (same pin as the core build) | MIT | Wrapped by `src/3d/camera.js` (`createOrbitCamera`). Used for `game3d.html`'s interactive camera, and (FAZ 4) the player's chase camera. |
| `src/3d/vendor/three/addons/loaders/FBXLoader.js` | three.js r160 `examples/jsm/loaders/FBXLoader.js`, same `unpkg.com/three@0.160.0` pin | MIT | Lazy dynamic-imported by `AssetLoader.loadFBXModel`, added FAZ 4 to load `peasant_girl.fbx` + its animation clips. |
| `src/3d/vendor/three/addons/libs/fflate.module.js` | three.js r160 `examples/jsm/libs/fflate.module.js` | MIT | Transitive dependency of `FBXLoader.js` (zlib inflate for compressed FBX binary data blocks). Never imported directly by this project's own code. |
| `src/3d/vendor/three/addons/curves/NURBSCurve.js`, `NURBSUtils.js` | three.js r160 `examples/jsm/curves/` | MIT | Transitive dependency of `FBXLoader.js` (NURBS-curve deformers). Never imported directly by this project's own code. |
| `assets/models/`, `assets/textures/`, `assets/audio/`, `assets/animations/`, `assets/skyboxes/`, `assets/particles/`, `assets/icons/` | — | — | Empty (`.gitkeep` only). Populate in later phases from Kenney (kenney.nl), Quaternius (quaternius.com), Poly Haven (polyhaven.com), Mixamo (mixamo.com, for rigged human animations), KayKit (kaylousberg.com) — verify CC0/CC-BY on the actual download page before adding anything, and record it in this table. |
| `assets/shaders/` | — | — | Empty. All shaders (aurora, water, fire, snow, etc.) will be original procedural GLSL written for this project — no external shader files needed. |
