# Decisions (ADR Log)

Architecture Decision Records for the 3D Westeros world. One entry per significant, hard-to-reverse
choice. Format: date, decision, reasoning, alternatives considered, consequence.

## ADR-0001: World scale and chunk grid derived from 2D kingdom bounding box

**Date:** 2026-07-29

**Decision:** The 3D open world's extent is derived from the 2D map's `INIT_KINGDOMS` coordinates
in `script.js`, not an arbitrary size. `#map-canvas` (`style.css`) is a 9000x7000px space; the 14
kingdom seats in `INIT_KINGDOMS` span x:[920,6190], y:[300,5370] within it. We pad that box by 800
map-units per side (so seats near the edge, e.g. Night King at y=300 and Xaro Xhoan Daxos at
x=6190, aren't at the literal world edge) and clamp to the canvas bounds, giving a working area of
x:[120,6990], y:[0,6170] — 6870 x 6170 map units.

We scale at **10 meters per map unit**, giving a world of **68.7km x 61.7km (~4239 km² by exact
bounds, ~4278 km² once rounded up to whole 500m chunks)**. Chunk size is **500m x 500m**, giving a
**138 x 124 chunk grid (17,112 chunks total)**. These are recorded as `WORLD_SCALE` and
`CHUNK_CONFIG` in `src/3d/config.js`.

**Reasoning:**
- The project's explicit goal is a Westeros-continent-scale open world covering every kingdom
  location on the existing 2D map, not a small permanent tech-demo valley. Deriving the world size
  from real kingdom data (instead of picking a round number) is the only way to guarantee every
  kingdom fits, and gives a concrete, falsifiable "World Coverage %" metric to track.
- 10 m/map-unit sits in the middle of the suggested 5-15 m/unit range: fine enough that kingdoms
  keep sensible relative spacing (e.g. the two closest Tyrell seats, Berk and Ziya, are 90 map units
  apart -> 900m apart in-world, a plausible short ride), while large enough that the full map
  resolves to a "several dozen km per side" continent rather than a city-sized area.
  15 m/unit would inflate the world by 50% for no added benefit at this stage; 5 m/unit would
  compress the two Riverlands-area seats to within a few hundred meters of each other, which reads
  as one settlement instead of two lords' seats.
- 500m chunks match the streaming distance already named in this project's guidelines ("500m
  unload/preload streaming"), keep the grid a manageable 17,112-entry array of plain descriptor
  objects (not meshes — nothing is generated until a chunk is actually requested), and are coarse
  enough that a chunk's LOD0 terrain patch is still cheap to generate procedurally on demand.
- Only kingdom **seats** (the 14 `INIT_KINGDOMS` entries with `house`/`title`) were used for the
  bounding box, not the ~150 decorative `_fig` marker entries (army icons, dragon illustrations)
  also present in `script.js`. Those are 2D-map set-dressing, not settlement locations Phase 3 will
  place castles at, and including them would have pulled the box north to y=40 for no gameplay
  reason (dragon/army decorations cluster near the top of the 2D map purely for layout, not lore).

**Alternatives considered:**
- *Fixed round-number world size (e.g. a flat 10km x 10km square).* Rejected: doesn't guarantee
  kingdom coverage, and contradicts the explicit "must eventually cover every kingdom" requirement.
- *1:1 map-unit-to-meter scale.* Rejected: would make the world only ~6km x 6km, i.e. barely above
  the stated 8km x 8km minimum and clearly not continent-scale.
- *Smaller (100-250m) chunks for finer streaming granularity.* Rejected for now: at this world size
  that's 60,000-425,000 grid entries — still cheap as plain objects, but adds bookkeeping complexity
  Phase 1 doesn't need yet. Can be revisited (would require a config bump + regenerating any already
  -built chunk terrain) once real per-chunk generation cost is measured.

**Consequence:** `World Coverage %` (tracked in `3D_GAME_PROGRESS.md`) is now a concrete, computable
ratio: sum of already-generated chunk areas / 4278 km². Nothing has been generated yet, so it starts
at 0%. Every future terrain/chunk-generation task should move this number, and Phase 3/10 cannot be
marked DONE below 80% per the project's phase-gate rules. If `INIT_KINGDOMS` coordinates change
materially in a future 2D-game update, this ADR's bounding box (and the `WORLD_SCALE` constants in
`config.js`) must be recomputed rather than left stale.

## ADR-0002: separate "Phase 1 preview" chunk radius from the real streaming radius

**Date:** 2026-07-29

**Decision:** `CHUNK_CONFIG` now has two radius constants instead of one:
`STREAM_RADIUS_CHUNKS` (unchanged, still `2`) and a new `PHASE1_PREVIEW_RADIUS_CHUNKS` (`6`).
`game3d.js`'s one-time boot-time `chunkManager.loadSquare(...)` call now uses the new constant;
`STREAM_RADIUS_CHUNKS` is reserved for the future player-follow streaming system.

**Reasoning:** `STREAM_RADIUS_CHUNKS` was originally scaffolded in Phase 0/ADR-0001 as "the radius
kept loaded around the player" — a number that has to respect the **mobile** performance budget
(drawCalls<500, triangles<500K) at all times, since real gameplay on a phone keeps this many chunks
resident continuously. Reusing that same constant to size the Phase-1 no-player dev/preview load
(this run wanted to grow World Coverage, which pushed the loaded area from 25 to 169 chunks —
comfortably inside the **desktop** budget at ~1.38M triangles / 169 draw calls, but roughly 2.8x
over the mobile triangle budget) would have silently turned "mobile streaming radius" into "desktop
preview radius," corrupting a number Phase 10's `QUALITY_PRESETS` will later depend on for real
device tuning. Splitting them now costs one extra constant and keeps both honest: preview radius
can grow aggressively for World Coverage/desktop testing, streaming radius stays whatever the
mobile budget can actually afford, and neither has to be renegotiated when the other changes.

**Alternatives considered:**
- *Just raise `STREAM_RADIUS_CHUNKS` to 6.* Rejected: would make the documented "kept loaded
  around the player" number a mobile-budget violation the moment `game3d.js` treats it as gospel
  for a real streaming implementation later, unless someone remembers to lower it again first —
  exactly the kind of stale-config foot-gun this file exists to prevent.
- *Compute the preview radius from current screen/quality settings instead of a fixed constant.*
  Rejected as premature: there is no quality-detection system yet (that's Phase 10), and no player
  camera to size a "how far can you see" heuristic around; a fixed number is honest about what
  actually exists right now.

**Consequence:** `game3d.js`'s boot preview and any future real streaming implementation can now
be tuned independently. World Coverage jumped from 6.25 km² (25 chunks) to 42.25 km² (169 chunks,
~0.99%) in the run this ADR was written for, purely by raising the new preview constant — confirm
via a fresh desktop-budget check (drawCalls/triangles) whenever it's raised again, and never let
`STREAM_RADIUS_CHUNKS` itself grow past what the mobile budget in `config.js`'s `QUALITY_PRESETS`
comments can afford.

## ADR-0003: additive-only chunk streaming; World Coverage tracks cumulative, not resident, chunks

**Date:** 2026-07-29

**Decision:** `ChunkManager.streamTowards(centerChunkX, centerChunkZ, radius)` loads whatever's
newly in range of a moving center (the `OrbitControls` target, wired up in `game3d.js`), but does
**not** unload chunks that fall out of range. A separate `everGenerated` `Set` (only ever grows,
independent of the `loaded` `Map`, which eviction could shrink later) backs a new
`getCumulativeCoveredAreaKm2()`, which is now the number `3D_GAME_PROGRESS.md`'s World Coverage
section should read from — not `getCoveredAreaKm2()` (currently-resident area).

**Reasoning:** The previous approach to raising World Coverage — a bigger and bigger one-shot
`loadSquare` at boot (ADR-0002) — hits a hard ceiling around ~610 chunks (the triangle budget) and
leaves zero headroom for anything else once a real player/NPCs/water/castles exist. The
sustainable path is coverage that grows through *exploration*: as a moving reference point (camera
today, player from FAZ 4 on) crosses into unvisited territory, new chunks generate and count
permanently, while at any instant only a small, budget-safe neighborhood needs to be resident.
Implementing full eviction (unloading far chunks) right now was deliberately skipped: nothing yet
exercises exploration at a scale that would exceed the performance budget (a human dragging a dev
camera, not a full game with hours of play time), so building LRU/distance-based eviction today
would be complexity with no current failure it prevents — pure speculation about a future need.
`unloadChunk`/`disposeAll` already exist and are ready for a real eviction policy to call once
there's an actual reason to (either the resident chunk count approaches the desktop budget, or
FAZ 4 gives us a real player and a real memory-bound need). Verified this run with a headless-
browser pan simulation: panning the camera target ~7000m away from the boot-time preview's edge
streamed in new chunks exactly as expected, growing cumulative coverage from 42.25 km² to
54.75 km² with zero unload/reload thrashing anywhere near the original preview area.

**Alternatives considered:**
- *Build full load/unload (LRU or distance-based) streaming now.* Rejected for this sub-task:
  more moving parts (what evicts, when, how far past `radius` before eviction, whether an evicted
  chunk needs its terrain regenerated identically if revisited — it does, since generation is
  deterministic, but that's untested until eviction exists) for a problem this project doesn't
  have yet. Revisit the moment resident-chunk count threatens the budget.
- *Keep World Coverage tied to resident chunk count (`getCoveredAreaKm2`).* Rejected: the moment
  eviction is added, this number would silently start going backwards as old chunks unload even
  though the world has only ever grown — exactly the kind of stale/misleading metric this project's
  World Coverage tracking exists to prevent.

**Consequence:** `3D_GAME_PROGRESS.md`'s reported World Coverage baseline is the boot-time number
(currently 169 chunks / 42.25 km², from `loadSquare` — a static, reproducible figure any page load
produces). The cumulative number grows further at runtime as someone actually interacts with the
dev camera, which is real but session-specific and not something to hardcode as "the new total" —
future runs should note *that the mechanism works* (demonstrated) rather than chase a moving
runtime number. When real eviction is eventually added, it must keep incrementing
`everGenerated`/never decrementing it, or this ADR's whole point is lost.

## ADR-0004: correct world scale down from 4278 km² to ~130-138 km²

**Date:** 2026-07-29

**Decision:** ADR-0001's `METERS_PER_MAP_UNIT: 10` is superseded. The project owner corrected the
standing instruction: the earlier "5-15 m/map-unit" guidance produced a ~4278 km² target that is
not realistically completable, and the corrected requirement is a world that (a) still covers the
padded kingdom bounding box from ADR-0001 in full, but (b) has a **total area no greater than
150 km²** (target band: roughly 100-150 km², e.g. ~10km x 12km to ~12km x 15km). The bounding box
itself is unchanged (same 14 `INIT_KINGDOMS` seats, same 800-map-unit padding, same
x:[120,6990]/y:[0,6170] clamped box — re-verified against current `script.js` this run, still
identical to ADR-0001's numbers). Only the meters-per-unit scale shrinks, to **1.75 m/map-unit**:

- `WORLD_WIDTH_METERS`: 6870 map units x 1.75 = **12,022.5 m** (12.02 km)
- `WORLD_DEPTH_METERS`: 6170 map units x 1.75 = **10,797.5 m** (10.80 km)
- Exact-bounds area: 12.0225 x 10.7975 ≈ **129.8 km²**
- Chunk grid (500m chunks, unchanged size): `GRID_COLUMNS` 138→**25**, `GRID_ROWS` 124→**22**
  (ceil of width/depth over 500m), for **550 total chunk slots** (down from 17,112) and a
  rounded-to-whole-chunks target area of 25 x 22 x 0.25 km² = **137.5 km²** — the new World
  Coverage denominator, both within the 100-150 km² band.

**Reasoning:**
- The instruction is explicit that absolute meters-per-unit is not the goal; kingdom coverage and
  a completable total area are. Shrinking the scale (not the bounding box) is the only lever that
  satisfies both: every kingdom seat stays inside the world, and the world stops being
  continent-sized.
- 500m chunks were kept unchanged: at the new scale they still give a sensibly-grained streaming
  system (550 slots is easy bookkeeping, same as before) without touching `CHUNK_SIZE_METERS`,
  which nothing yet depends on being 500m specifically but which also isn't broken.
- No code outside `config.js` reads `GRID_COLUMNS`/`GRID_ROWS`/`WORLD_WIDTH_METERS`/
  `WORLD_DEPTH_METERS`/`METERS_PER_MAP_UNIT` yet (`chunkManager.js`/`terrain.js` take a
  `chunkSizeMeters` and generate around a `(chunkX, chunkZ)` center, not tied to a hard grid
  boundary) — confirmed by grep this run. So this is a pure config/documentation correction with
  zero runtime behavior change to the 169 chunks already generated; only the World Coverage
  *percentage* changes (same 42.25 km² covered, against a much smaller denominator).

**Alternatives considered:**
- *Keep 10 m/unit and instead just report coverage against a smaller "phase 1 target subset."*
  Rejected: contradicts the explicit instruction that the config constants themselves (not just
  the reporting) must reflect the new ≤150 km² target, and would leave `WORLD_SCALE`/`CHUNK_CONFIG`
  permanently wrong relative to what the project can actually finish.
- *Shrink the padded bounding box instead of the meters/unit.* Rejected: would risk excluding a
  kingdom seat, which both ADRs agree is the one non-negotiable constraint ("aim is including every
  kingdom, not an absolute meter scale").

**Consequence:** World Coverage's denominator recalculates from 4278 km² to **137.5 km²**. Combined
with ADR-0003's resident-vs-cumulative distinction (written independently, same day, by a parallel
session — the two corrections are orthogonal and compose cleanly): the reported boot-baseline
percentage moves from 0.9876% (42.25 km² / 4278 km²) to **30.73%** (42.25 km² / 137.5 km²), and any
further cumulative growth from `streamTowards()` now compounds against the smaller, achievable
target instead of the un-completable one. `3D_GAME_PROGRESS.md` is updated accordingly this run.
Any future world-scale change must update `WORLD_SCALE`/`CHUNK_CONFIG` in `config.js`, this ADR,
and the World Coverage section together, same as ADR-0001 required.

## ADR-0005: sea-level water as one camera-following plane, not per-chunk geometry; terrain.js untouched

**Date:** 2026-07-29

**Decision:** FAZ 2's water (`world/water.js`) is a single large Gerstner-wave-shaded plane, fixed
at world Y = `WORLD_DEFAULTS.WATER_LEVEL_METERS` (6m), re-centered on the camera's XZ position
every frame (same trick `sky.js` already uses for its skybox sphere) rather than one water mesh
per terrain chunk. `terrain.js`'s height generation is **not modified** — no negative heights, no
new "is this vertex underwater" concept baked into terrain data at all.

**Reasoning:**
- `terrain.js`'s existing FBM height is `noise * maxHeightMeters` (always in `[0, 24)` today) —
  its low points (noise near 0) already read as natural valleys. A flat plane at a modest sea level
  (6m, about a quarter of the height range) floods exactly those valleys into lakes/coastline with
  zero terrain-generation changes, zero regression risk to the 169 chunks already generated and
  screenshotted in prior runs, and zero new state for `ChunkManager` to track. This is the smallest
  change that produces a real, natural-looking result — preferred per the project's own
  "when in doubt, less code" rule over inventing a coupled terrain/water height system this early.
- **Camera-following, not chunk-based:** a per-chunk water mesh would need `ChunkManager` to know
  which chunks are "wet enough to bother," would multiply draw calls by resident chunk count (169
  today, growing via streaming), and would need its own load/unload lifecycle mirroring terrain's.
  A single ~4000m x 4000m plane recentered on the camera (not literally infinite, but larger than
  what's visible before the far clip plane/horizon absorbs the edge) is one mesh, one draw call,
  and needs no lifecycle beyond what `sky.js` already established as a pattern — the two systems
  now share one well-understood technique instead of two different ones.
- **Why `WATER_LEVEL_METERS` lives in `config.js`, unlike `sky.js`'s local color constants:** sea
  level is a fact multiple future systems need to agree on (Phase 3 `settlements.js` must not place
  a castle below it; Phase 2's own later `rivers.js`/waterfall work needs to know where "sea" ends
  and "river" begins). `sky.js`'s aurora colors, by contrast, are single-module cosmetic tuning
  nothing else will ever read — that's why they stayed local. This mirrors the project's own
  established distinction (see `src/3d/README.md`'s Conventions section).

**Alternatives considered:**
- *Carve real below-zero terrain (lakebeds/ocean floor) into `terrain.js`.* Rejected for now:
  meaningfully more complex (renormalizing the height curve, redoing the grass→rock vertex-color
  gradient's assumptions, revalidating all 169 already-generated/screenshotted chunks) for a visual
  difference that isn't needed yet — there's no underwater gameplay or diving camera to justify
  seeing a real seabed. Revisit if/when a system actually needs to know "how deep is this water,"
  not before.
- *Per-chunk water mesh, added/removed by `ChunkManager` alongside terrain.* Rejected: couples two
  systems that don't need to be coupled yet (water is flat/uniform everywhere at this fidelity
  level; only terrain varies per chunk) and multiplies draw calls for no visual benefit over one
  large plane at this world scale (12km x 11km total — a single reasonably-sized plane already
  covers any camera position without visible edges).
- *Truly infinite/world-sized water plane (matching `WORLD_SCALE.WORLD_WIDTH_METERS` exactly).*
  Rejected: unlike the sky (which is a backdrop, never needs geometric precision), a literal
  12,022m x 10,797m plane at full segment density would be a real triangle-budget cost for area
  the camera can't currently reach anyway (`maxDistance` is 1800m — see ADR-0004/run-4's far-plane
  fix). A camera-following ~4000m plane costs the same either way visually, at a fraction of the
  triangle count.

**Consequence:** `WORLD_DEFAULTS.WATER_LEVEL_METERS` is now a value every future world-placement
system (settlements, rivers, roads) must check against, not just `water.js`. If a later phase adds
real bathymetry (an actual seabed below the water plane) or per-region sea levels, this ADR's
"one flat plane, one constant" model is what gets superseded — update this file when that happens,
same as every prior world-scale change has.

## ADR-0006: day/night cycle as keyframe-interpolated lights, owned by a new `lighting.js`; `sky.js` extended, not duplicated

**Date:** 2026-07-29

**Decision:** FAZ 2's day/night cycle is a new `src/3d/lighting.js` module that owns the scene's
`DirectionalLight` ("sun") and `HemisphereLight` (sky/ground ambient fill) — moved out of
`game3d.js`'s `createScene()`, where they were previously created as static, unchanging lights.
Color/intensity for both lights, plus the sun's position (a fixed-radius arc, elevation via
`sin`/`cos` of the time-of-day ratio) and a `nightFactor`, are computed by linearly interpolating
between seven hand-authored keyframes spaced around a `[0, 1)` day ratio (midnight → dawn → noon →
dusk → midnight). `sky.js`'s `updateAuroraSky` is extended (not duplicated) with a fourth
`dayNight` argument so the skybox's horizon/zenith gradient and aurora visibility consume the same
`nightFactor`/colors the lights use, instead of the sky and the sun independently guessing at
"is it night" and drifting apart over time.

**Reasoning:**
- **New module, not `game3d.js` inline code:** every other visual system (`sky.js`, `world/water.js`,
  `world/terrain.js`) already follows a create/update/dispose triplet pattern living in its own
  file; the sun/hemisphere lights were the one remaining piece of scene setup still inline in
  `game3d.js`. Pulling them into `lighting.js` keeps `game3d.js` as an orchestrator (wiring systems
  together) rather than a system itself — consistent with the project's own blast-radius rule.
- **Keyframe interpolation over a continuous sinusoidal model:** a small ordered array of
  `{ratio, sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity, nightFactor}` objects, found
  and lerped by the caller's time ratio, is easy to reason about, easy to extend (a future "storm"
  or "eclipse" preset is one more keyframe, not new interpolation math), and keeps every tunable
  value in one visually-authored place rather than several independent formulas (sun color as a
  function of elevation, intensity as a separate function, etc.) that would need to be kept in sync
  by hand to avoid the sky and sun disagreeing about how dark "night" should look.
- **`sky.js` extended, not given its own independent day/night logic:** `sky.js`'s own module doc
  already flagged "revisit to gate the aurora to nighttime" as Phase 2 work. Computing time-of-day
  independently in both `sky.js` and `lighting.js` would risk exactly the kind of two-systems-
  disagreeing bug the project's `EventBus`/shared-config conventions exist to prevent. Passing
  `lighting.js`'s output into `updateAuroraSky` costs one new parameter and keeps a single source
  of truth for "what time is it and how dark should things be."
- **Real-time-driven, not tied to the seeded world PRNG:** the day/night ratio is a deterministic
  function of `elapsedSeconds` (from the same `THREE.Clock` every other per-frame system already
  reads) and two config constants (`DAY_LENGTH_SECONDS`, `START_TIME_OF_DAY_RATIO`) — not
  `Math.random()`, so it doesn't violate the project's determinism rule, but it's also not part of
  "world geography" the way terrain/chunk seeding is (a session always starts at the same
  time-of-day for the same wall-clock elapsed time, but does not need to reproduce identically
  across different real-world play sessions the way terrain must). Matches `sky.js`'s existing
  "cosmetic/non-deterministic visuals are exempt" convention (`src/3d/README.md`).
- **No shadow maps wired up yet:** `QUALITY_PRESETS.shadowMapSize` already exists in `config.js`
  but nothing currently calls `renderer.shadowMap.enabled = true` or sets `castShadow`/
  `receiveShadow` on any mesh/light (confirmed by grep this run). Enabling shadows is real added
  GPU cost (shadow-map render passes) and its own budget/quality-tier decision — deliberately out
  of scope for this ADR; `lighting.js`'s `disposeDayNightLighting` has nothing shadow-related to
  free today, but the module is where that toggle will eventually live when a phase needs it.

**Alternatives considered:**
- *Compute sun/sky color purely from the sun's elevation angle (a continuous formula), no
  keyframes.* Rejected: harder to art-direct (a "just past sunrise should look warm and orange"
  intent is naturally expressed as a keyframe near `ratio=0.27`, not as a coefficient in a
  trigonometric blend), and every future "make dusk more red" tweak would mean re-deriving a
  formula instead of editing one number in one array entry.
- *Keep `sky.js` fully independent, re-deriving its own day/night state from `elapsedSeconds`
  directly instead of taking `lighting.js`'s output.* Rejected: duplicates the keyframe table (or a
  second, differently-tuned one) in two files, and any future keyframe edit would need to touch
  both to stay visually consistent — exactly the coupling the project's "single source of truth"
  preference (see `config.js`'s own doc comment) warns against.
- *A full sky-dome shader driven entirely by sun elevation (physically-based Rayleigh/Mie
  scattering), replacing the hand-authored gradient.* Rejected as premature: real cost (more GLSL,
  more uniforms, harder to tune to a specific art direction) for a fidelity level nothing else in
  the project has reached yet; the existing gradient-plus-aurora look already reads well and this
  ADR's job is "gate it to time-of-day," not "replace it."

**Consequence:** `game3d.js` no longer creates lights directly — any future system needing to read
"is it currently day or night" (e.g. Phase 5 NPC schedules, Phase 6 nocturnal animal behavior)
should read `lighting.js`'s `updateDayNightLighting` return value (already computed once per frame
in `game3d.js`'s tick loop) rather than re-deriving it. `sky.js`'s "always-on aurora" Known Issue
(3D_GAME_PROGRESS.md) is resolved by this ADR. If a later phase adds shadows, `lighting.js`'s sun
`DirectionalLight` is where `castShadow`/`shadow.mapSize` get set — update this ADR or add a new one
when that happens.

## ADR-0007: fog color/density reuse `lighting.js`'s day/night output directly; water/sky stay unfogged for now

**Date:** 2026-07-29

**Decision:** FAZ 2's fog (`src/3d/fog.js`) is a `THREE.FogExp2` assigned to `scene.fog`, with its
color set to exactly `lighting.js`'s current `horizonColor` and its density linearly interpolated
between a day and a night constant using `lighting.js`'s `nightFactor` — no new keyframe table, no
independent "what time is it" computation. `world/terrain.js` picks it up automatically (built-in
`MeshStandardMaterial` defaults `fog: true`); `sky.js` and `world/water.js`'s custom
`ShaderMaterial`s do not, and are left that way this run rather than wired up.

**Reasoning:**
- **Fog color = horizon color, not a separate tuned value:** fog's job is to fade distant geometry
  into the backdrop. If fog had its own color, distant terrain would fade into a visibly different
  color than the sky right above the same horizon line — a seam. Reusing `lighting.js`'s
  `horizonColor` (already computed once per frame for `sky.js`) guarantees the two always match,
  for free, and keeps a single source of truth per ADR-0006's own precedent.
- **Density from `nightFactor`, not a new day/night state machine:** `nightFactor` already encodes
  "how dark/hazy should things read right now" for the sky/aurora; reduced visibility at night is
  physically plausible anyway, so reusing it for fog density (day: clear-ish, night: ~1.4x denser)
  is both the smallest-code option and a reasonable in-universe justification, not an arbitrary
  reuse of an unrelated number.
- **Density tuned against a real render, not just the formula:** an initial `0.00055`/`0.001`
  day/night pair (derived from "50% fog by ~1500m") looked washed-out in an actual headless-Chromium
  screenshot — nearby terrain read as hazy, not just the horizon. Lowered to `0.0004`/`0.00055`
  (re-verified visually: clear foreground, light haze by ~1000m, meaningfully thick only near the
  2000m far plane) — flagging this because the *first* number would have "looked correct" by the
  math alone; the project's own rule (verify after writing, not just after deriving) caught it.
- **`world/water.js` and `sky.js` deliberately not wired to `scene.fog` this run:** both are custom
  `ShaderMaterial`s; three.js only auto-populates fog uniforms for shaders that explicitly include
  the `fog_pars_*`/`fog_*` GLSL chunks — setting `material.fog = true` alone does nothing for a
  custom shader that doesn't reference those chunks (documented three.js custom-shader behavior,
  not a guess). `sky.js` already explicitly opts out (`fog: false`) since it's a backdrop that must
  never fog into itself — correct, left unchanged. `world/water.js` doesn't opt in: adding the fog
  chunks correctly needs a `vFogDepth` varying threaded through its existing Gerstner vertex shader,
  which is its own contained follow-up, not a two-line addition — doing it hastily here risked a
  worse mistake than leaving water unfogged and documenting it as tech debt (BİLMEME KURALI: don't
  guess, flag it instead).

**Alternatives considered:**
- *A second keyframe table for fog color/density, independent of `lighting.js`.* Rejected: doubles
  the tunable surface for "what does dawn look like" across two files that must stay visually
  consistent by hand — the exact coupling problem ADR-0006 already chose to avoid for the sky.
- *Linear (`THREE.Fog`) instead of exponential-squared (`THREE.FogExp2`).* Rejected: linear fog's
  hard near/far cutoffs read artificially at this world's open, rolling-terrain scale; exponential
  falloff is the standard choice for outdoor/atmospheric fog and was already the intended technique
  going into this run.
- *Add the fog GLSL chunks to `world/water.js` in this same run.* Rejected for scope control — see
  Reasoning above; tracked instead in `3D_GAME_PROGRESS.md` Known Issues so it isn't silently
  forgotten.

**Consequence:** any future built-in-material system (e.g. Phase 3 settlement meshes, Phase 6
animal models, if built with `MeshStandardMaterial`) gets fog for free with no extra code. Any
future custom-`ShaderMaterial` system that should fog (most plausibly `world/water.js`) must add
the `fog_pars_vertex`/`fog_vertex`/`fog_pars_fragment`/`fog_fragment` chunks and set `fog: true`
itself — this ADR is the reference for why that's not automatic. If `fog.js` ever needs a
fog-specific color slightly different from the horizon (e.g. a "thick localized swamp mist" that
shouldn't affect the whole scene), that's a new, separate system — not a change to this one.

## ADR-0008: wiring `world/water.js` into `scene.fog` — the exact chunks, and the `UniformsLib.fog` merge ADR-0007 deferred

**Date:** 2026-07-29

**Decision:** `world/water.js`'s custom `ShaderMaterial` now participates in `scene.fog`
(deferred by ADR-0007 as a contained follow-up). Implementation, verified against the actual
vendored `three.module.js` source rather than assumed from memory (BİLMEME KURALI — this project's
own rule against guessing unfamiliar API/runtime behavior):

- Vertex shader: added `#include <fog_pars_vertex>` (declares `varying float vFogDepth;`), computed
  an explicit `vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);` before `gl_Position`
  (reusing it for `gl_Position = projectionMatrix * mvPosition;` too, replacing the prior inline
  `modelViewMatrix * vec4(...)`), then `#include <fog_vertex>` (sets `vFogDepth = -mvPosition.z;` —
  this chunk hard-references a variable literally named `mvPosition`, which is why the vertex
  shader now declares one instead of computing the view-space position inline).
- Fragment shader: added `#include <fog_pars_fragment>` (declares `fogColor`/`fogDensity` uniforms
  and the `vFogDepth` varying under `#ifdef USE_FOG`/`#ifdef FOG_EXP2`) and, after `gl_FragColor` is
  set, `#include <fog_fragment>` (mixes it toward `fogColor` by the exp2 fog factor).
- Material: `fog: true` (required — `WebGLProgram` only defines `USE_FOG` when
  `material.fog === true`; confirmed from source, `ShaderMaterial`'s own default is `false`, unlike
  most built-in materials).
- **The part that isn't obvious from the three.js docs and initially broke:** setting `fog: true`
  and including the chunks alone is not sufficient — `WebGLRenderer`'s `refreshFogUniforms()` reads
  `material.uniforms.fogColor.value`/`.fogDensity.value` directly every frame, and for built-in
  materials those uniform entries are auto-merged in from `THREE.UniformsLib.fog` by three.js's own
  material-uniform setup; a custom `ShaderMaterial` does **not** get that merge automatically. The
  first attempt threw `Cannot read properties of undefined (reading 'value')` inside
  `refreshFogUniforms` on every render call the moment `scene.fog` existed — caught immediately by
  this run's real headless-Chromium smoke test (page errors), not by `node --check` (pure syntax,
  can't catch a shader-uniform mismatch) or by reading the docs alone. Fixed by merging
  `THREE.UniformsLib.fog` into the material's own `uniforms` via `THREE.UniformsUtils.merge([
  THREE.UniformsLib.fog, { ...own uniforms } ])`.

**Reasoning:**
- **Verified against the actual vendored source, not memory:** the project vendors an exact,
  inspectable copy of three.js r160 (`src/3d/vendor/three/three.module.js`). Rather than trust a
  half-remembered description of "how custom-shader fog works in three.js," this run `grep`ped the
  real `fog_vertex`/`fog_pars_vertex`/`fog_fragment`/`fog_pars_fragment`/`UniformsLib.fog`/
  `refreshFogUniforms` source directly and built the implementation from what it actually says —
  the one guess made (assuming the merge wasn't needed) was caught by the smoke test within one
  iteration, not shipped.
- **Real smoke test, not just `node --check`, is why this run caught the bug at all.** Es
  Modules/syntax checking cannot catch a GLSL compile-time reference to an undefined variable or a
  runtime uniform-shape mismatch — only actually running the renderer does. This is the concrete
  case the project's "regression guard" / "verify after writing" rule exists for.
- **Reused `mvPosition` for `gl_Position` instead of computing view-space position twice:** the fog
  chunk needs a variable literally named `mvPosition`; since the vertex shader already computed
  `modelViewMatrix * vec4(displaced, 1.0)` inline for `gl_Position`, naming that computation once
  and reusing it for both is strictly less code than computing it twice under two different names.

**Alternatives considered:**
- *Pass `fogColor`/`fogDensity` as the water module's own uniforms (`uFogColor`/`uFogDensity`,
  updated manually from `game3d.js` each frame, like `uSunDirection`/`uCameraPosition` already
  are).* Rejected: duplicates data `fog.js`/`scene.fog` already owns and would need to be kept in
  sync by hand on every future fog tuning change; the `UniformsLib.fog` merge is three.js's own
  intended mechanism for exactly this case and, once correctly wired, requires zero per-frame code
  in `game3d.js` (the renderer refreshes `fogColor`/`fogDensity` from `scene.fog` automatically).
- *Leave `world/water.js` unfogged permanently, close the tech-debt item as "won't fix."* Rejected:
  ADR-0007 already scoped this as a small, well-defined follow-up, not a fundamentally hard problem
  — the actual fix ended up being about a dozen lines plus the one real gotcha documented above.

**Consequence:** the "water doesn't fog" Known Issues entry (3D_GAME_PROGRESS.md, added run 8) is
resolved. Any future custom `ShaderMaterial` added to this project that should respect `scene.fog`
must follow the same pattern: include the four `fog_*` chunks, set `fog: true`, and merge
`THREE.UniformsLib.fog` into its own `uniforms` — this ADR (not ADR-0007 alone) is the complete
reference, since ADR-0007 only established *that* custom shaders need the chunks, not the
uniform-merge requirement this run discovered.

## ADR-0009: rivers as a traced downhill path over `terrain.js`'s height field, not carved terrain; escalating-radius steepest descent

**Date:** 2026-07-29

**Decision:** FAZ 2's river (`src/3d/world/rivers.js`) is found, not authored: a deterministic
steepest-descent walk starts at the highest point within 2000m of the world origin and repeatedly
steps toward the lowest nearby height (sampled from `terrain.js`'s existing FBM field via a new
`createHeightSampler` export — see below) until it reaches `WORLD_DEFAULTS.WATER_LEVEL_METERS`
(the sea). `terrain.js`'s chunk generation itself is **not modified** — same "find the shape in the
existing noise, don't carve a new one into it" approach ADR-0005 used for sea-level water. The walk
uses an **escalating search radius** when no downhill neighbor exists at the normal step distance
(retry at `stepMeters * 2^n`, up to a cap) rather than giving up immediately, because plain
single-radius steepest descent got trapped by small local minima almost immediately in testing (see
below) — flagged explicitly because this is a case where the *first*, simpler implementation
produced an obviously-too-short/broken result and needed a real fix, not shipped as "good enough."

**Reasoning:**
- **Path-tracing over the existing height field, not terrain carving:** carving would mean
  `terrain.js` needs a "how close is the nearest river" concept baked into its per-vertex height/
  color loop, coupling two systems that don't need to be coupled and re-validating every chunk's
  existing look. Tracing costs nothing to `terrain.js` beyond one small, additive export
  (`createHeightSampler`) and produces a river that already sits naturally in the terrain's own
  valleys by construction — the same trade-off ADR-0005 already made for water, applied here.
- **`createHeightSampler(seed, fbmOptions?)` extracted from `createTerrainChunk`'s per-vertex loop:**
  previously the height formula (`fbm2D(noise2D, x*scale, z*scale) * maxHeightMeters`) only existed
  inline inside the chunk-geometry loop. Pulling it into a standalone, pure, exported function lets
  `rivers.js` query "how tall is the terrain at this exact point" without generating a whole chunk,
  and guarantees the river's rendered height always matches whatever `createTerrainChunk` would
  bake at that same point — one source of truth, not two independently-written height formulas that
  could silently drift. `createTerrainChunk` now calls `createHeightSampler` internally; verified
  behavior-identical via an unchanged before/after headless-Chromium terrain screenshot (same seed,
  same visual output) — this was a pure refactor, not a generation-behavior change.
- **`mulberry32` exported from `terrain.js` for `rivers.js` to reuse:** the project's determinism
  rule requires a seeded PRNG, never `Math.random()`, for anything that shapes world geography.
  Rather than write a second copy of the same 32-bit PRNG in `rivers.js`, it imports the one
  `terrain.js` already implements — one canonical implementation, XORed with a fixed tag
  (`seed ^ 0x52495652`) to get an independent random stream from terrain's own noise sequence
  without needing a second unrelated algorithm.
- **Escalating-radius steepest descent, discovered necessary by testing, not assumed upfront:** the
  first implementation (fixed `stepMeters`, single-radius candidate search) got stuck at a
  `local-minimum` after only ~10 points / ~360m in an actual headless-Chromium run — nowhere near
  sea level. Multi-octave FBM (5 octaves here) has many small local dips from its higher-frequency
  octaves layered on top of the macro shape a real river should follow; a single point sampled 40m
  away can easily land on a slightly-higher bump even when the broader area trends downhill. Tried
  reducing octaves for the walk's *decision* function alone (a "coarse/fine split") first — still
  got stuck, just less often. What actually worked, verified with the exact same seed across
  multiple trials before committing to it: if no candidate at `stepMeters` is downhill, retry at
  `stepMeters * 2`, `* 4`, etc. (capped at `MAX_STUCK_ESCALATIONS = 4`) before declaring the walk
  stuck — effectively "look further ahead" to step over a small bump while still preferring the
  smallest jump that finds real descent. This let the *same* full-detail (5-octave) height field
  the terrain actually renders reach the sea in 11 points, using only one escalation — simpler than
  maintaining a second coarse-only sampler, since the escalation fix addresses the root cause
  (steepest descent's blindness to nearby-but-not-visible lower ground) directly.
- **Ribbon mesh with a built-in `MeshStandardMaterial`, not a custom shader:** unlike
  `world/water.js`'s Gerstner shader, the river doesn't animate (no flow/wave motion this pass —
  see Alternatives below), so a plain vertex-colored built-in material is enough, and gets
  `scene.fog`/day-night lighting for free (no ADR-0008-style chunk wiring needed) — the smallest
  correct choice for this pass's actual visual requirements, not a shortcut that skips something
  needed.
- **Confined to a fixed radius (`maxRiverRadiusMeters`, default 2800m) around the origin, not
  world-scale:** the walk stops if it would step outside this radius, deliberately kept inside the
  FAZ 1 preview area (`PHASE1_PREVIEW_RADIUS_CHUNKS` × 500m ≈ 3000m) so the rendered ribbon never
  extends over terrain that isn't actually loaded — a river floating past the edge of loaded ground
  would look broken. **Consequence, stated plainly:** at this world's terrain relief (max height
  24m) the resulting river is short (~11 points, roughly 680m point-to-point, one river, one
  session — verified in a dedicated top-down orthographic screenshot showing it winding from a
  marked source to a marked sea outlet), not yet the many-rivers, world-spanning network a finished
  FAZ 2/3 needs. This pass establishes the *mechanism* (a working, deterministic, sea-reaching
  path-tracer); scaling to multiple rivers tied to real streaming, not just one static one, is
  future work — see Consequence below.

**Alternatives considered:**
- *Carve real riverbed geometry into `terrain.js` along the path (lower vertex heights near the
  path).* Rejected: couples two systems ADR-0005 deliberately kept decoupled for water, and would
  need every one of the 169-and-growing already-generated/screenshotted chunks re-validated against
  a new "am I near a river" concept — real cost for a visual improvement (a slightly recessed
  riverbed) not needed yet at this world's scale.
- *Grid-based flow accumulation (D8/D-infinity, the standard GIS/hydrology technique) instead of a
  single steepest-descent walk.* Rejected for this pass: correctly handles arbitrary numbers of
  rivers and endorheic basins, but needs a full heightmap grid computed and cached up front (a real
  new data structure and generation cost), not a cheap per-point query — appropriate if/when this
  project needs *many* rivers derived automatically from the whole terrain, not for a first,
  single-river pass whose job is proving the path-tracing concept works at all.
- *Two independently-tuned samplers (coarse for pathfinding, fine for rendering).* Tried first,
  rejected after testing: still got stuck in local minima just less often than the fine-only
  baseline, added a second tunable (which octave count is "coarse enough") without fully solving
  the problem the escalation fix solves directly and more simply.
- *A flow-animated custom shader (scrolling UVs, foam) for the river surface, matching `water.js`'s
  visual ambition.* Deferred, not attempted: `createRiverMesh`'s built-in material has no fog/
  lighting integration cost the way `water.js`'s custom shader did (ADR-0008), so this is a pure
  visual-polish addition for later, not blocking this pass's actual goal (a real, sea-reaching path).

**Consequence:** `world/rivers.js` is the reference for any future world-geography system that needs
to query terrain height without generating a chunk (`createHeightSampler`) or trace a path over it
(the escalating-descent technique). Known scope limits, tracked in `3D_GAME_PROGRESS.md` Known
Issues rather than silently assumed solved: only one river exists (not a network), it's static (not
streamed/regenerated as the world grows), it has no waterfall/rapids visual at steep drops, and its
surface doesn't flow-animate. Any future run generalizing to multiple rivers or tying river
generation into `ChunkManager`'s streaming should read this ADR first — the height-sampler/PRNG
exports and the escalation technique are the reusable parts; the single-fixed-river scope is not.
## ADR-0010: gate the boot-preview chunk radius on `(pointer: coarse)`, then grow it for desktop

**Date:** 2026-07-29

**Decision:** `game3d.js`'s `createScene()` now picks the boot-time preview radius by device class
— `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` (8, up from 6) on desktop-class (fine/no pointer)
devices, or the existing mobile-budget `CHUNK_CONFIG.STREAM_RADIUS_CHUNKS` (2) on touch-primary
devices, detected via `window.matchMedia('(pointer: coarse)').matches` (wrapped in try/catch,
defaulting to `false`/desktop if `matchMedia` is unavailable for any reason).

**Reasoning — a real, already-present bug, not a hypothetical one:** every run since Phase 1
(runs 2, 3, 5) grew `PHASE1_PREVIEW_RADIUS_CHUNKS` and documented it as a "desktop-only concern,"
but no code anywhere ever actually branched on device — `createScene()` called
`chunkManager.loadSquare(0, 0, CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS)` unconditionally. A real
phone opening `game3d.html` today loads exactly the same chunk count as a desktop and already blew
the mobile budget (169 chunks × 8192 triangles ≈ 1.38M triangles, ~2.8x the 500K mobile ceiling,
per 3D_GAME_PROGRESS.md's own Performance Budget Status section) — the "desktop-only" framing was
aspirational documentation, not enforced runtime behavior. This is a performance-budget violation
(priority #3 in the standing task order), ranked above growing World Coverage further (#7) — so it
was fixed *before* raising the radius, not after.

`(pointer: coarse)` was chosen over user-agent sniffing because it's the same signal a CSS media
query would use, is immune to UA-string spoofing/rot, and directly answers the question that
matters ("is the primary input touch, i.e. is this the class of device the mobile budget targets"),
not "what OS string did the browser report."

Once the mobile path was verified safe (see smoke test below), the desktop-only preview radius was
grown from 6 (169 chunks, 13x13) to 8 (289 chunks, 17x17) as this run's World Coverage improvement
— see 3D_GAME_PROGRESS.md for the updated numbers. 289 chunks is ~2,367,488 triangles (47% of the
5M desktop triangle budget) and 291 draw calls (12% of the 2500 desktop draw-call budget) — still
comfortable headroom, unlike jumping straight to the ~441 chunks (21x21) that would satisfy FAZ 3's
80%-coverage gate outright from a single config bump alone, which would cheapen a milestone FAZ 3
hasn't earned yet (no settlements exist).

**Verified via headless Chromium (Playwright), not assumed from the media-query name alone:**
- A default (fine-pointer) browser context loaded `game3d.html`: console confirms `"Loaded 289
  terrain chunks (~72.25 km²) in 1365ms (desktop-class device — full preview radius)"`, zero page
  errors, screenshot shows terrain/water/aurora sky all rendering correctly.
- A touch-emulated context (`hasTouch: true, isMobile: true`, matching Playwright's standard mobile
  device recipe) loaded the same page: `window.matchMedia('(pointer: coarse)').matches` read `true`
  inside the page (confirming the emulation actually flips the signal this code reads, not just
  the device viewport), console confirms `"Loaded 25 terrain chunks (~6.25 km²) in 472ms
  (touch/mobile-class device — mobile-budget radius)"`, zero page errors, screenshot confirms the
  scene still renders (smaller view, same visual style).
- Offline regression (SW registration via `index.html`, then `game3d.html`, then a fresh tab with
  the network disabled): `game3d.html` still fully loads (loading overlay's `hidden` class present,
  zero page errors) — this change touched no new files, so no `service-worker.js`
  `GAME3D_SHELL_FILES` update was needed, but re-verified rather than assumed. `index.html` offline
  reproduced the same single pre-existing `firebase is not defined` error documented in every prior
  run's Known Issues — confirmed unrelated, since this change touched only `src/3d/config.js` and
  `src/3d/game3d.js`, neither of which `index.html`/`script.js` depend on.

**Alternatives considered:**
- *User-agent sniffing (`navigator.userAgent` regex).* Rejected: brittle against desktop browsers
  with touch screens (would misclassify as mobile) and against UA-string spoofing/future browser
  changes; `(pointer: coarse)` answers the actual question (touch-primary input) directly.
- *`window.innerWidth` viewport-width threshold.* Rejected: conflates screen size with input type —
  a tablet or a resized desktop window at a narrow width isn't necessarily touch-primary, and this
  project already has a real, more precise signal available.
- *Jump straight to the ~441-chunk (21x21) radius that hits FAZ 3's 80% coverage gate in one run.*
  Rejected this run: FAZ 3 hasn't started (no settlements), and previous runs' own retrospectives
  explicitly warned against treating World Coverage as "a bigger static blob to inflate" rather than
  a genuinely explored/generated world — satisfying the gate via one preview-radius config edit,
  before any castle exists, would be a hollow win. A smaller, real, verified step (169 → 289 chunks)
  was taken instead; nothing prevents a future run from growing it further once it's independently
  justified (or from building the FAZ-1-era "scripted flythrough" idea instead, which grows coverage
  by actually generating streamed terrain rather than a bigger static preview).

**Consequence:** any future change to `PHASE1_PREVIEW_RADIUS_CHUNKS` must keep re-verifying against
the *desktop* triangle budget only (mobile is now genuinely protected by the pointer-type branch,
not just a comment). If a future phase adds real quality tiers (`QUALITY_PRESETS`, Phase 10), this
binary device split is the natural seam to extend into a full tier selection — replace the ternary
with a `QUALITY_PRESETS`-driven radius lookup at that point rather than adding a third special case
here.

## ADR-0011: waterfalls as vertical "curtain" markers on the river's steepest segments, thresholds calibrated against the actual traced path

**Date:** 2026-07-29

**Decision:** `world/rivers.js` gained `detectWaterfalls(points)` and `createWaterfallMesh(waterfall)`.
`detectWaterfalls` scans consecutive pairs of points from `generateRiverPath`'s output and flags a
segment as a waterfall when both `dropMeters >= 2.5` and `slope (drop/horizontalDistance) >= 0.06`.
`createWaterfallMesh` renders each flagged segment as a flat vertical quad — standing upright at the
horizontal midpoint between the segment's two points, spanning the full vertical drop, oriented
perpendicular to the flow direction (reusing `createRiverMesh`'s `perpX`/`perpZ` technique) — colored
white-foam at the top fading to the river's own blue at the bottom, using a built-in
`MeshStandardMaterial` (not a custom shader), same choice `createRiverMesh` already made for the
ribbon itself.

**Reasoning:**
- **Thresholds measured, not guessed (BİLMEME KURALI):** before writing `detectWaterfalls`, this
  run drove a headless-Chromium page that imports the real `createHeightSampler`/`generateRiverPath`
  and logged every segment's `(horizontalDistance, drop, slope)` for the world's actual seed-1337
  river (11 points, reaching the sea). The result: eight segments drop under 1.3m (≤3.2% grade,
  the river's normal gentle flow) while exactly two stand out — 2.61m/40m (6.5% grade) and
  4.02m/40m (10.1% grade). `WATERFALL_MIN_DROP_METERS = 2.5` and `WATERFALL_MIN_SLOPE = 0.06` sit
  between those two clusters, so they flag the two genuinely steeper segments without also
  catching the river's ordinary descent. Verified via a second headless run (real `game3d.html`
  boot, not just the profiling script) that `detectWaterfalls` returns exactly those 2 segments
  against the live code path, not just the standalone profiling script.
- **Vertical curtain, not a slanted patch following the real terrain:** `terrain.js`'s smooth
  multi-octave FBM has no actual cliff faces — the "steep" segments above are still a gentle,
  continuous slope in the real height field, just steeper than the river's average. A quad slanted
  to match the real terrain between the two points would look like a slightly-more-tilted
  continuation of the river ribbon, not a fall. Standing the quad up vertically (spanning the full
  `top.y` to `bottom.y` range at one fixed horizontal position, the segment's midpoint) is a
  deliberate, explicitly schematic simplification — a "steep-section marker," not a physically
  carved waterfall — consistent with `world/rivers.js`'s own established approach of *finding*
  shapes in the existing noise (ADR-0009) rather than reshaping `terrain.js` to match a desired
  visual. Verified via a dedicated top-down/broadside verification render (separate scratch scene,
  real terrain chunks + real river + real waterfall mesh, source/mid markers): the curtain renders
  at the correct location, correctly oriented (broadside when viewed along its face normal, not
  edge-on), and — at this terrain's actual height budget (`maxHeightMeters` 24, this segment's own
  4.02m drop) — reads as a modest, wide-but-short cascade (14m wide, 4m tall) rather than a
  dramatic tall waterfall. That is an honest consequence of the terrain's own scale, not a
  half-finished result: a taller, more dramatic fall would need `terrain.js` to actually generate
  steeper local relief (a separate, larger change), not a bigger threshold or taller quad grafted
  onto ordinary rolling-hill terrain.
- **Built-in `MeshStandardMaterial`, not a custom shader:** same reasoning `createRiverMesh` already
  used — gets `scene.fog`/day-night lighting for free with zero fog-chunk/`UniformsLib` wiring
  (contrast `world/water.js`'s ADR-0008 requirement), and this pass has no flow-animation ambition
  yet (flagged as future work in this module's own doc comment, same as the river ribbon).
- **No new file:** added directly to `world/rivers.js` rather than a separate `waterfalls.js` —
  waterfalls are a query/derived-visual over the same river path data, not an independent world
  system; `rivers.js` is still well under the project's 600-line file cap after this addition
  (~316 lines).

**Verified via headless Chromium (Playwright), not assumed correct from the design alone:**
- The threshold-calibration profiling run (above) against the real, unmodified `generateRiverPath`.
- A full `game3d.html` render pass: zero `pageerror`/`console.error`, console confirms `"Detected 2
  waterfall-grade drop(s) along the river"` matching the calibration data exactly.
- A dedicated top-down/broadside scratch-scene render (not committed) confirming correct
  placement, orientation, and readable color gradient at the second (steeper, 4.02m) segment.
- Offline-precache and 2D-game regression tests, re-run — both still clean. No new file was added
  this run (`detectWaterfalls`/`createWaterfallMesh` live inside the already-precached
  `world/rivers.js`), so no `service-worker.js` change was needed — confirmed, not assumed.

**Alternatives considered:**
- *A single combined "drop severity" score instead of two separate thresholds (drop AND slope).*
  Rejected: a long, gradual descent could accumulate 2.5m of total drop over hundreds of meters
  without ever being locally steep — pairing an absolute drop minimum with a slope minimum is what
  actually distinguishes "a real steep spot" from "a long gentle stretch," and both are simple,
  legible constants rather than one opaque composite number.
- *Carve an actual step/cliff into `terrain.js` at each detected waterfall.* Rejected for this pass
  (same reasoning as ADR-0009's river-carving alternative): would couple `terrain.js` to a "how
  close is the nearest waterfall" concept and require revalidating every already-generated chunk's
  look, for a visual improvement that isn't this pass's actual goal (marking existing steep spots).
  Flagged as a real future direction if this project wants dramatic, cliff-faced waterfalls later.
- *A flow-animated shader (scrolling foam/spray) matching the visual ambition of `water.js`'s
  Gerstner waves.* Deferred, not attempted — same reasoning `createRiverMesh` already gave for the
  river ribbon itself: no fog/lighting integration cost this pass needs to pay, pure visual polish
  for later.

**Consequence:** `world/rivers.js` is now the reference for any future "detect a feature along an
already-traced path" system (the same `detectWaterfalls` pattern could generalize to rapids,
fords, or bridge-crossing points once those become relevant). Known scope limits, tracked in
`3D_GAME_PROGRESS.md` Known Issues: waterfalls are static (regenerated only at boot, tied to the
one static river, not to a future streamed/multi-river system), don't flow-animate, and their
visual scale is honestly bounded by `terrain.js`'s current lack of real cliff relief — a future run
wanting dramatically taller waterfalls should start there, not by inflating this pass's thresholds
or quad dimensions.

## ADR-0012: night starfield as a self-contained `THREE.Points` cloud in a new `stars.js`, not folded into `sky.js`

**Date:** 2026-07-29

**Decision:** A new top-level module, `src/3d/stars.js`, adds a procedural night starfield —
`createStarfield(seed)` builds a `THREE.Points` cloud of 1200 points scattered across the upper
hemisphere (a small margin above the horizon, mirroring `sky.js`'s own aurora mask), re-centered on
the camera every frame (`updateStarfield`, same technique `sky.js`/`world/water.js` already use)
and faded in/out purely via opacity driven by `lighting.js`'s `nightFactor` — the same gating
mechanism `sky.js` already uses for the aurora. `disposeStarfield` releases its geometry/material.

**Reasoning:**
- **New file, not added to `sky.js`:** `sky.js` is a `ShaderMaterial`-backed inverted sphere (a
  gradient + aurora shader); a starfield is a completely different rendering primitive
  (`THREE.Points` over a `BufferGeometry` of point positions, a built-in `PointsMaterial`, no custom
  GLSL needed). Cramming both into one file would mean `sky.js` owns two unrelated rendering
  techniques under one name; a dedicated `stars.js` keeps each module's `create/update/dispose`
  triplet about exactly one visual system, consistent with `fog.js`/`lighting.js`'s existing
  granularity (each a small, focused file) rather than `sky.js` growing into a general "atmosphere"
  catch-all.
- **Self-contained seeded PRNG, not imported from `world/terrain.js`:** the project's determinism
  rule (seeded PRNG, never `Math.random()`) applies everywhere, not just `world/`. Rather than
  import `mulberry32` across the `world/` folder boundary — `world/` is reserved for physical-world
  systems (terrain/water/rivers/vegetation/roads/settlements) per the target architecture, while
  sky/lighting/fog/stars are atmosphere, kept at the top `src/3d/` level — `stars.js` carries its
  own copy of the same small algorithm, XORed with a distinct tag (`0x53544152`, "STAR"-ish) for an
  independent stream. This mirrors `world/rivers.js`'s own choice to XOR-tag its stream rather than
  reuse `terrain.js`'s raw seed, and keeps `stars.js` dependency-free (`three` only), matching
  `sky.js`'s own self-contained noise functions.
- **Built-in `PointsMaterial`, not a custom shader:** no per-star flicker/twinkle animation is
  attempted this pass (flagged as future work below), so a plain built-in material with a single
  `opacity` uniform driven once per frame is the simplest correct choice — avoids the
  `UniformsLib.fog`-merge complexity ADR-0008 had to solve for a genuinely custom shader, since
  this module has no such shader to begin with.
- **`fog: false` on the star material:** same reasoning `sky.js` already gives for its own
  `fog: false` — stars sit "at infinity" (rendered at `STARFIELD_RADIUS_METERS`, 1850m, just inside
  `sky.js`'s 1900m sphere), and this world's fog density at night (`fog.js`) would visibly dim
  anything real positioned that far away, which would look wrong for something meant to read as
  impossibly distant.
- **Upper-hemisphere-only distribution, small margin above the horizon:** stars scattered across
  the *entire* sphere (including below `y = 0`) would place some "underground," visible only if the
  camera looked down past the terrain's edge — a real but pointless edge case to render. Restricting
  to `heightFactor` in `[0.05, 1.0]` (mirroring `sky.js`'s own `auroraMask` starting at `dir.y =
  0.05`) avoids this cheaply, without needing any terrain-relative occlusion logic.
- **`renderOrder = -0.5`:** between `sky.js`'s sphere (`-1`, drawn first) and ordinary opaque scene
  geometry (`0`, the three.js default) — stars draw after the sky gradient/aurora but before
  terrain/water/river meshes, so real geometry's normal depth test correctly occludes stars behind
  it (neither the sky sphere nor the stars write depth, so anything drawn afterward with real
  depth values naturally wins).

**Verified via headless Chromium (Playwright), not assumed correct from the design alone:**
- A full `game3d.html` render pass: zero `pageerror`/`console.error` with the starfield wired into
  the full scene alongside every other system (terrain, water, river, waterfalls, sky, fog).
- **A unit-style sweep** (same technique runs 7/8 used for `lighting.js`/`fog.js`): drove
  `updateDayNightLighting`/`updateStarfield` directly across 20 samples spanning a full simulated
  day — confirmed `stars.material.opacity` exactly equals `dayNight.nightFactor` at every sample
  (not just "some fade happens"), and that `updateStarfield` actually re-centers the point cloud on
  a given camera position.
- **A dedicated visual verification render** (separate scratch canvas, not the real page's own —
  the real page's `requestAnimationFrame` loop would otherwise overwrite a one-off render to the
  same canvas): forced `nightFactor = 1` and rendered the starfield alone — confirms hundreds of
  small white points scattered correctly across the upper half of the view only, nothing below the
  horizon, correct point size/color, not just "some points exist somewhere."
- Offline-precache (new file added to `service-worker.js`'s `GAME3D_SHELL_FILES`, verified fully
  offline after one online visit) and 2D-game regression tests — both still clean.

**Alternatives considered:**
- *Fold stars into `sky.js`'s existing shader as another term in the fragment color.* Rejected: a
  shader-based "is this fragment near a star" test (e.g. hashing screen-space or view-direction
  coordinates into sparse bright dots) is a legitimate alternative technique, but couples an
  unrelated rendering approach into `sky.js`'s single gradient+aurora shader, and a `THREE.Points`
  cloud is both simpler to reason about (explicit star positions, not a procedural density function
  tuned to *look* sparse) and cheaper (a few thousand tiny points vs. per-fragment noise sampling
  across the entire sky sphere's surface).
- *Reuse `world/terrain.js`'s exported `mulberry32` directly instead of a second copy.* Rejected:
  crosses the `world/`-vs-atmosphere folder boundary this project's target architecture draws
  deliberately; a ~15-line PRNG function duplicated once, tagged for an independent stream, costs
  less than coupling an atmosphere module to `world/`'s internals.
- *Twinkle animation (per-star opacity/size varying with `uTime`) via a custom `ShaderMaterial`.*
  Deferred, not attempted — real visual polish for later, and would need the same kind of
  fog-uniform-merge care ADR-0008 documents if it should also respect `scene.fog` (it currently
  opts out via `fog: false`, so this isn't an immediate concern either way).

**Consequence:** `stars.js` closes FAZ 2's "Yıldızlı gece" roadmap item, leaving volumetric light
(god rays) as FAZ 2's only remaining unchecked item — explicitly flagged in the roadmap as needing
a real post-processing pipeline (`EffectComposer`/render targets) that doesn't exist yet in this
project (that's FAZ 9's `postfx.js` scope), so it should wait for that groundwork rather than be
half-built early. Known scope limits, tracked in `3D_GAME_PROGRESS.md` Known Issues: stars are a
fixed pattern (not tied to real astronomical positions/rotation), don't twinkle, and their brightness
is a flat per-scene opacity, not per-star variation.

## ADR-0013: kingdom-seat settlements as procedural `InstancedMesh` castles, a new map->world coordinate convention, and mobile-safe grounding

**Date:** 2026-07-29

**Decision:** A new `src/3d/world/settlements.js` places one procedural castle (box keep + 4 corner
towers + conical roofs, `SETTLEMENT_CONFIG` in `config.js`) at each of the 14 kingdom seats from
`script.js`'s `INIT_KINGDOMS`, starting FAZ 3. Three pieces:
1. **`KINGDOM_SEATS`** — a hand-copied, frozen snapshot of `INIT_KINGDOMS` (`id`/`name`/`house`/
   `color`/`mapX`/`mapY` only, no gameplay state), not a live import of `script.js`.
2. **`mapToWorldXZ(mapX, mapY, mapBounds, metersPerMapUnit)`** — a new map->world coordinate
   convention: the padded kingdom bounding box's *center* (`WORLD_SCALE.MAP_BOUNDS`) maps to the
   world origin `(0, 0)`, the same origin chunk `(0, 0)` is already centered on (`world/terrain.js`/
   `chunkManager.js`'s existing convention). This is the first system that needs to place something
   at a *specific* 2D-map location rather than "somewhere near the origin" (rivers/water don't care
   where kingdoms are), so it's the first time this mapping needed to exist at all.
3. **Device-branched grounding in `game3d.js`** — force-loads a 3x3 terrain-chunk neighborhood under
   each seat, desktop-class devices only (see Consequence for why mobile is excluded).

**Reasoning:**
- **Frozen snapshot, not a live import of `script.js`:** `script.js` is the 2D game's own top-level
  script — it runs immediately against 2D-game DOM elements (`#map-canvas`, etc.) the moment it's
  evaluated. Importing it as an ES module from `game3d.js`'s page would execute all of that logic in
  the 3D page's context, a real risk to the "keep the 2D game intact" golden rule (not a
  hypothetical one — `script.js` is 214KB of tightly-coupled 2D game logic). A small, hand-copied,
  explicitly-labeled-as-hand-synced data snapshot costs one manual step if `INIT_KINGDOMS` ever
  changes materially — the exact same tradeoff `config.js`'s `WORLD_SCALE` bounding box already
  made in ADR-0001, extended to per-seat data instead of just the aggregate bounding box.
- **Bounding-box-center-to-origin mapping:** the alternative (map the bounding box's top-left corner
  to the origin, or pick some other anchor) would work equally well mathematically, but centering
  keeps `mapToWorldXZ`'s output symmetric around the same origin every other world system already
  treats as "the middle of the map" (chunk `(0, 0)`, the river's search origin, the boot-preview
  radius) — one mental model for "where is the middle of the world," not two.
- **`InstancedMesh`, not one mesh per castle:** 14 castles x (1 keep + 4 towers + 4 roofs) = 126
  separate meshes would be 126 draw calls for repeated geometry — exactly the case
  `InstancedMesh` exists for for per the project's own performance guidelines. Built as 3
  `InstancedMesh`es (one per part) instead: 3 draw calls total, regardless of kingdom count. Per-
  kingdom identity (which house owns which castle) comes from `roofMesh.setColorAt(i, color)` (a
  per-instance color attribute three.js's built-in `MeshStandardMaterial` already supports), not
  from a separate material per kingdom (which would defeat instancing).
- **Procedural primitives, not an external model, for this first pass:** matches this project's
  established "geography/gameplay shape first, asset-based detail later" pattern — `terrain.js`,
  `water.js`, and `rivers.js` all shipped as procedural geometry before any model asset existed.
  FAZ 4+ can later replace/augment these with real castle models if a suitable CC0/CC-BY one is
  found; nothing here blocks that.
- **Height clamp, not a floor-height assumption:** every seat's ground height comes from the real
  `sampleHeightMeters(x, z)` (the same function `terrain.js`/`rivers.js` use), clamped up to
  `WORLD_DEFAULTS.WATER_LEVEL_METERS + SETTLEMENT_CONFIG.MIN_GROUND_CLEARANCE_METERS` — `world/
  README.md`'s own "Sea level" convention already anticipated this exact requirement ("any future
  system that places things by height (settlements, roads, rivers) must check against it rather
  than assuming its own threshold"). **Measured, not assumed:** a scratch probe script (real
  `WORLD_SCALE`/`createHeightSampler`, all 14 real seats) found all 14 already sample above sea
  level (lowest: `jon` — Castle Black/the Wall — at exactly 6.00m, essentially *at* sea level, a
  thematically fitting "cold, low, near the literal edge" reading but close enough that the clamp is
  a real safety net, not dead code for this seed).

**Verified via headless Chromium (Playwright), not assumed correct from the design alone:**
- Full `game3d.html` render pass, both device paths (default + touch-emulated): zero
  `pageerror`/`console.error`, console confirms `"Placed 14 kingdom-seat settlements"` on both,
  with the correct resident-chunk count for each path (see Consequence).
- **A dedicated close-up verification render** (separate scratch canvas + isolated scene, same
  technique ADR-0009/ADR-0011/ADR-0012 used — the real page's own `requestAnimationFrame` loop
  would otherwise overwrite a one-off render to the real canvas, caught on the first attempt by
  removing `#game3d-canvas` before creating an isolated one): loaded the real 3x3 terrain
  neighborhood under seat `umit` (Targaryen), rendered the real `createSettlements` output at that
  seat — confirms a stone-gray keep + 4 corner towers with orange (`#c8430a`, matching `INIT_KINGDOMS`'
  own `umit.color`) conical roofs, correctly seated on the real sampled terrain, not floating or
  misaligned.
- Offline-precache (new file added to `service-worker.js`'s `GAME3D_SHELL_FILES`) and 2D-game
  regression tests — both still clean (same pre-existing, already-documented `firebase is not
  defined` error, unrelated to this change).

**A real mobile perf-budget bug found and fixed within this same run, before commit — not shipped
and fixed later:** the first version of the device-branched grounding force-loaded a 3x3 chunk
neighborhood under every seat unconditionally, on every device. Measured via the same headless
touch-emulated smoke test every prior device-branching run (ADR-0010) uses: this added **92 extra
chunks (~753K triangles) on the mobile path alone** — 1.9x the *entire* mobile triangle budget by
itself, stacked on top of the mobile boot preview's own 25 chunks. Fixed by gating the forced-
grounding loop on the same `isCoarsePointerDevice()` check `game3d.js` already established in
ADR-0010: desktop-class devices force-ground every seat (289 -> 321 resident chunks, ~80.25 km²,
comfortably inside the desktop budget); mobile-class devices skip it (stays at the existing 25-chunk
mobile preview, settlements still placed at the correct real height, just occasionally without
visible ground directly beneath until player-streaming reaches that chunk in a later phase).

**Alternatives considered:**
- *Skip forced grounding entirely, on every device, and rely on `streamTowards` to eventually catch
  up.* Rejected: `streamTowards` only fires as the *camera's orbit target* moves — with no player
  yet (FAZ 4+), nothing drives the target near a distant kingdom seat in a fresh page load, so most
  castles would float indefinitely in the current dev-preview. Forcing a small neighborhood at boot
  (desktop only, per the fix above) makes every seat visually correct without waiting on a system
  that doesn't have a real trigger yet.
- *Skip settlements at seats outside the loaded radius instead of placing-but-not-grounding them
  (mobile).* Rejected for this pass: all 14 seats would disappear on mobile (none fall inside the
  tiny 5x5 mobile preview), a much larger visual gap than "castle without visible ground under it."
  Revisit once a real per-seat visibility/culling need exists.
- *One mesh per castle instead of `InstancedMesh`.* Rejected: no benefit at 14 castles today, but
  actively contradicts the project's own "prefer `InstancedMesh` for repeated geometry" guideline
  for zero cost — the instanced version is not more complex to write.

**Consequence:** FAZ 3's first roadmap item ("2D haritadaki krallık konumlarını yansıtan modüler
kale/kule") is done. World Coverage grows on desktop from 52.5% to **58.4% (80.25 km² / 137.5 km²)**
as a side effect of grounding settlements (32 extra resident chunks) — not the primary goal of this
change, but an honest side benefit worth recording since it's the metric the project tracks (mobile
World Coverage is unaffected, unchanged at 25 chunks / 6.25 km², by design — see the perf-bug fix
above). Remaining FAZ 3 items (PBR materials/textures beyond the current flat-color
`MeshStandardMaterial`, simple LOD/colliders) are follow-up work, not attempted this pass — flagged
in `3D_GAME_PROGRESS.md` Known Issues, same "don't half-do the phase in one run" pattern every prior
FAZ has followed.

## ADR-0014: bump `PHASE1_PREVIEW_RADIUS_CHUNKS` 8 -> 10 to clear FAZ 3/10's 80% World Coverage gate

**Date:** 2026-07-29

**Decision:** `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` (`config.js`) changes from 8 to 10 — the
desktop-only boot-preview square grows from 17x17 (289 chunks) to 21x21 (441 chunks). No other code
changed; `STREAM_RADIUS_CHUNKS` (mobile path) and the settlement-grounding logic are untouched.

**Reasoning:**
- **Priority-ordered, not incidental:** this run's Session Snapshot found zero syntax errors,
  blocking bugs, or new tech debt, and the standing 100-150 km² world-scale target was re-verified
  already correct (no change needed — see World Coverage section below). With those higher
  priorities clear, priority #7 (low World Coverage against the still-open FAZ 3/10 80% gate) ranks
  above picking a new FAZ 3 sub-task (PBR/LOD, priority #8) per this project's own task-priority
  order — exactly the "still legitimate future work" `3D_GAME_PROGRESS.md`'s prior run flagged
  under Next Step.
- **Radius chosen by direct computation against the real kingdom-seat bounding box, not guessed:**
  all 14 `KINGDOM_SEATS` map to world-space chunk coordinates with `max(|chunkX|, |chunkZ|) <= 10`
  (computed via `mapToWorldXZ` against the real `WORLD_SCALE.MAP_BOUNDS`/`METERS_PER_MAP_UNIT`) —
  radius 10 is the smallest radius that puts every seat's *center* chunk inside the boot-preview
  square itself, before any per-seat grounding runs, without overshooting into a needlessly large
  square. A radius of 9 would still leave the Night King seat's `chunkZ = -10` outside the square.
- **Budget headroom checked before picking the number, not after:** at 8192 triangles/chunk (a
  64x64-segment `PlaneGeometry`, unchanged), 441 chunks is ~3.61M terrain triangles alone — pushing
  a radius further (e.g. 12, 25x25=625 chunks, ~5.12M triangles) would have *exceeded* the desktop
  5M-triangle ceiling on terrain alone, before settlements/water/sky/river. 10 was the largest radius
  that (a) covers every real kingdom seat and (b) leaves real headroom under the budget for FAZ 4+'s
  future draw calls (player, NPCs, animals, dragons, vegetation) rather than spending the whole
  ceiling on empty terrain today.

**Verified via headless Chromium (Playwright), not assumed correct from the math alone:**
- Desktop-viewport pass: console confirms `"Loaded 441 terrain chunks (~110.25 km²)"`, then
  `"Placed 14 kingdom-seat settlements; 444 terrain chunks resident (~111.00 km²) after grounding
  them"` — 444, not 441, because the Night King seat's grounding neighborhood (`chunkZ` from -11 to
  -9) pokes 3 chunks past the square's `z = -10` edge, exactly as predicted from the bounding-box
  computation above. Zero `pageerror`/`console.error`.
- Touch-emulated pass (`hasTouch: true, isMobile: true`): unchanged at `"Loaded 25 terrain chunks
  (~6.25 km²)"` and `"25 terrain chunks resident ... (mobile — grounding skipped)"` — confirms this
  change is genuinely desktop-only, the mobile path never reads `PHASE1_PREVIEW_RADIUS_CHUNKS`.
  Zero `pageerror`/`console.error`.
- 2D-game regression (`index.html`): same pre-existing, already-documented `firebase is not defined`
  / sandbox-network-blocked errors as every prior run, nothing new.

**Alternatives considered:**
- *Radius 12 (625 chunks) for a rounder margin above the 80% gate.* Rejected: terrain triangles
  alone (~5.12M) would exceed the entire desktop triangle budget before counting settlements/water/
  sky/river, and leaves no room for FAZ 4+ content. Radius 10 already clears the 80% gate (80.7%);
  going further isn't needed to satisfy the gate and actively works against future headroom.
- *Merge/instance terrain chunk geometry now, to afford a much larger radius.* Rejected as
  premature: draw calls are still only 18% of budget (453 of 2500) at radius 10 — no measured draw-
  call problem exists to justify the complexity yet, consistent with this project's existing "revisit
  if draw calls approach the ceiling" tech-debt note. Triangle count, not draw calls, is the binding
  constraint here, and merging geometry doesn't reduce triangle count.
- *The "scripted flythrough at boot" idea (runs 2/3/11's notes).* Still valid future work for
  organically growing *cumulative* coverage via `streamTowards` during real exploration, but doesn't
  address today's *boot-baseline* gate the same direct radius bump does — not mutually exclusive,
  just a different lever, left for a future run.

**Consequence:** Desktop World Coverage moves from 58.4% (80.25 km² / 137.5 km²) to **80.7% (111.00
km² / 137.5 km²)** — clears FAZ 3/10's 80% coverage gate. Mobile World Coverage is unchanged (4.5%,
25 chunks / 6.25 km², by design). Desktop performance budget: ~453 draw calls (18.1% of the 2500
ceiling, up from 324) and ~3.67M triangles (73.4% of the 5M ceiling, up from 2.63M) — comfortably
inside both, but triangle headroom is now the tighter of the two budgets (26.6% remaining vs. 81.9%
remaining on draw calls); flagged in `3D_GAME_PROGRESS.md` as a real constraint on how much more
raw terrain radius future runs can add before needing chunk-geometry merging or LOD. Clearing the
80% *coverage* gate does not close FAZ 3 itself — its PBR/LOD/collider sub-tasks (flagged in prior
runs) remain open, unaffected by this change.

## ADR-0015: procedural canvas-generated PBR maps for castle materials (`world/materials.js`), not an external texture file or a collider/LOD pass

**Date:** 2026-07-29

**Decision:** New module `src/3d/world/materials.js` generates seeded, canvas-based color +
roughness + normal maps for `settlements.js`'s stone keep/tower material, and color + roughness
maps for its roof material. `settlements.js` now calls `createStoneMaterial`/`createRoofMaterial`
instead of building two flat-color `MeshStandardMaterial`s inline, and `createSettlements` takes a
new required `seed` option (`game3d.js` passes `WORLD_DEFAULTS.WORLD_SEED`). `disposeSettlements`
now dedupes shared materials through a `Set` before calling the new `disposeCastleMaterial` (which
also disposes each material's texture maps — three.js does not do this automatically when a
material is disposed).

**Reasoning:**
- **Priority-ordered:** this run's Session Snapshot found zero syntax errors, blocking bugs, or
  new tech debt; the 100-150 km² world-scale target was re-verified correct for the eighth
  straight run (`config.js`'s `METERS_PER_MAP_UNIT: 1.75`, 25x22 grid = 137.5 km², unchanged — see
  `3D_GAME_PROGRESS.md`'s World Coverage section); and FAZ 3/10's 80% desktop coverage gate is
  already clear (80.7%, from ADR-0014). With those higher priorities settled, priority #8 (the
  active phase's remaining sub-task) is next — FAZ 3's two open items are "PBR materials/textures"
  and "simple LOD/colliders." This run picked the texture item.
- **Textures over colliders/LOD, specifically:** no player exists until FAZ 4, so a collider has
  nothing to collide with yet and would be dead code (violates the project's own "don't add
  handling for scenarios that can't happen" rule); LOD has no measured need either — settlements
  are already only 3 draw calls / ~2,520 triangles total, nowhere near either performance budget.
  PBR materials/textures is the one FAZ 3 sub-task with a real, immediately-visible payoff and no
  speculative dependency on an unbuilt system.
- **Procedural, not an external file:** this project's one hard constraint is no downloaded
  HBO/show media, but even a generic CC0 stone texture would still need a human download step (per
  `3D_GAME_PROGRESS.md`'s "any future asset needs a human step" note) — unnecessary when the
  castles are simple enough for a canvas-generated result to look correct, and it matches this
  project's established "procedural first" pattern (`sky.js`'s aurora, `water.js`'s Gerstner
  waves, `terrain.js`'s FBM noise — none of them use an image file either).
- **Height-field-driven, not three independent noise passes:** `buildStoneHeightField` computes one
  seeded height field (beveled blocks, recessed mortar grooves, small per-block variation); the
  color, roughness, and normal maps all read from it, so the mortar lines in the color map, the
  rougher-mortar shading, and the normal map's grooves all agree with each other pixel-for-pixel —
  three independently-seeded noise passes could plausibly disagree on where a groove is.
- **Determinism preserved:** both `createStoneMaterial`/`createRoofMaterial` take `seed` and use
  `terrain.js`'s exported `mulberry32` (reused, not reimplemented — `world/README.md`'s
  "Determinism" convention already says to reuse this exact PRNG). `settlements.js` passes
  `WORLD_DEFAULTS.WORLD_SEED` (roof gets `seed + 1` so it's a different-but-still-deterministic
  pattern from the stone material, not an accidental identical texture).
- **Repeat counts computed from real geometry size, not guessed:** `settlements.js` derives
  `stoneRepeat`/`roofRepeat` from `KEEP_WIDTH_METERS`/`ROOF_HEIGHT_METERS` against a target
  ~1-1.5m real-world block/shingle-row scale, rather than hardcoding an arbitrary repeat count that
  would look wrong if `SETTLEMENT_CONFIG`'s dimensions ever change.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- A scratch preview page (written this run, deleted before commit — never part of the repo) built
  one real castle via `createSettlements` with a real `importmap` for `three`, positioned a camera
  close to it, and rendered — screenshot confirms visible mortared stone blocks with real
  normal-map depth (not flat per-block color) and a roof correctly tinted by the seat's house color
  (`#c8430a`, Targeryan orange) multiplied over the shingle-row shading. Zero console errors.
- Desktop-viewport pass on the real `game3d.html` (not the scratch page): console still confirms
  `"Loaded 441 terrain chunks (~110.25 km²)"` then `"Placed 14 kingdom-seat settlements; 444
  terrain chunks resident (~111.00 km²)"` — identical chunk/settlement counts to ADR-0014, since
  this change only replaces materials, not geometry or placement. Zero `pageerror`/`console.error`.
- Touch-emulated pass (`hasTouch: true, isMobile: true`): unchanged at `"Loaded 25 terrain chunks
  (~6.25 km²)"` / `"...grounding skipped, see ADR-0013"`. Zero `pageerror`/`console.error`.
- Offline-precache regression: visited `index.html` online first (the page that actually calls
  `serviceWorker.register`, not `game3d.html` itself), confirmed via `caches.open` that the new
  `./src/3d/world/materials.js` entry (added to `service-worker.js`'s `GAME3D_SHELL_FILES`, same
  pattern every prior new 3D file has followed) is present in the `westeros-shell-v1` cache, then
  set the browser context offline and loaded `game3d.html` directly — loaded successfully, zero
  page errors, confirming this run didn't silently break the offline-PWA golden rule.
- `node --check` across every non-vendor `.js` file: clean. `script.js`/`service-worker.js`
  individually re-checked; `manifest.json`/`assets_manifest.json` still valid JSON.
- 2D-game regression (`index.html`): same pre-existing, already-documented sandbox-only
  `firebase is not defined` / blocked-network-request errors as every prior run — nothing new.

**Alternatives considered:**
- *Skip textures, do colliders/LOD instead.* Rejected per the priority reasoning above — no
  consumer for either yet, so building them now would be speculative, not needed work.
- *One shared material for keep+tower+roof.* Rejected: roof needs per-instance house-color tint to
  keep working (existing `InstancedMesh.setColorAt` behavior, unchanged by this ADR), which only
  makes sense against a grayscale-ish map, not the same stone-colored map the walls use.
- *A single higher-resolution texture atlas covering stone+roof in one file.* Rejected as
  unnecessary complexity: two separate small (256x256) canvases are already cheap (~768KB
  combined, negligible against either texture budget) and simpler to reason about than atlas UV
  packing, for a total of two materials.
- *Bake the normal map from the color map (e.g. luminance-as-height) instead of a dedicated height
  field.* Rejected: the color map's per-pixel tint jitter would produce a noisy, incorrect normal
  map; a shared explicit height field (used for all three maps, per the Reasoning above) is more
  work upfront but the only way to get grooves/bevels that actually line up.

**Consequence:** FAZ 3's second roadmap sub-task ("PBR materials/textures beyond the current
flat-color `MeshStandardMaterial`") is done. World Coverage and performance budget are unchanged by
this ADR (same geometry, same draw-call count — 3 `InstancedMesh`es, same as ADR-0013 — only the
materials' maps changed); texture memory grows by a negligible ~768KB (2 materials x up to 3 maps x
256x256x4 bytes), nowhere near either device budget. FAZ 3's one remaining sub-task is simple
LOD/colliders — still correctly deferred until a player exists (FAZ 4) to justify either. `service-
worker.js`'s `GAME3D_SHELL_FILES` now includes `materials.js`, keeping the offline-PWA golden rule
intact for every currently-code-imported 3D file.

## ADR-0016: FAZ 4 first pass — playable character (`gameplay/player.js`), vendored `FBXLoader`, and an `OrbitControls`-based chase camera instead of a custom spring-arm rig

**Date:** 2026-07-29

**Decision:** Vendored three.js r160's `FBXLoader.js` (plus its two transitive dependencies,
`libs/fflate.module.js` and `curves/NURBSCurve.js`/`NURBSUtils.js`, all fetched from the same
`unpkg.com/three@0.160.0` pin every other vendored addon uses) alongside `GLTFLoader.js`.
`assetLoader.js` gained `loadFBXModel(url)` (lazy dynamic-import, same L1-silent-fallback pattern
as `loadModel`). New `src/3d/physics.js` (`createGroundCollider(seed)`) wraps `world/terrain.js`'s
`createHeightSampler` so gameplay code depends on "physics", not a world-generation internal. New
`src/3d/input.js` (`KeyboardInput`) tracks WASD/arrow keys + Shift-to-run, exposing camera-agnostic
`{forward, strafe, running}` axes. New `src/3d/gameplay/player.js` (`createPlayer`) loads
`peasant_girl.fbx` plus its three skin-less idle/walking/running clips (retargeted via
`THREE.AnimationMixer` — no bone remapping needed, they share Mixamo's standard skeleton),
corrects Mixamo's centimeter-scale export using the FBX's own `unitScaleFactor` rather than a
hardcoded `0.01`, snaps to `physics.js`'s ground height every step, turns to face its movement
heading, and crossfades idle/walking/running off real speed. `game3d.js` computes a camera-relative
world-space movement direction each frame (`computeCameraRelativeMove`, kept in `game3d.js` — not
`player.js` — so gameplay code stays camera-agnostic per `gameplay/README.md`'s Conventions) and
reuses the existing `OrbitControls` instance as the player's chase camera by translating both
`camera.position` and `controls.target` by the player's per-frame movement delta, then letting
`OrbitControls.update()` layer the user's own drag/zoom input on top. `PLAYER_CONFIG` (new,
`config.js`) holds every constant this introduces (asset URLs, speeds, turn rate, crossfade
duration, spawn point, camera framing/distance limits).

**Reasoning:**
- **Priority-ordered:** Session Snapshot found zero syntax errors, blocking bugs, or new tech debt
  this run; the 100-150 km² world-scale target was re-verified correct for the ninth straight run
  (unchanged, see World Coverage below); FAZ 3/10's 80% coverage gate is already clear (80.7%); and
  FAZ 3's own last sub-task (LOD/colliders) is explicitly deferred until a player exists to justify
  either. With every higher priority settled, the roadmap's active-phase item is FAZ 4 itself —
  this run started it.
- **Reuse `OrbitControls` rather than write a new spring-arm rig in the same run:** a real
  third-person camera eventually wants spring-arm-style smoothing and raycast wall-avoidance (so it
  can't clip through terrain/castles) — meaningfully more work than this run's movement/animation
  scope. `OrbitControls` is already vendored, tested (camera.js's own drag-simulation smoke test
  from FAZ 1), and already distance/angle-limited. Reusing it for the chase camera let this run's
  budget go toward the actually-new work (character loading, retargeted animation, ground
  collision, camera-relative input) instead of a second parallel camera system. Wall-avoidance
  raycasting is explicitly not done — flagged in 3D_GAME_PROGRESS.md's Known Issues, same
  "partial credit, be honest about what's left" pattern as ADR-0015's PBR-vs-LOD split.
- **A real bug found and fixed mid-run, not shipped:** the first working version set
  `controls.target` to the player's new position every frame and called `controls.update()`,
  assuming `OrbitControls` would "follow." It doesn't — `OrbitControls.update()` computes its
  internal offset as `camera.position - target` fresh every call, so moving `target` alone (without
  moving `camera.position` by the same amount) mathematically cancels itself out: the resulting
  camera position is unchanged, only its look-at direction changes. Found via this run's own
  headless-browser movement test (screenshot showed the character visibly shrinking/walking away
  from a camera that never moved), not assumed correct from reading the code. Fixed by translating
  both `camera.position` and `controls.target` by the player's per-frame position delta before
  calling `update()` — this preserves whatever relative offset the user's own mouse-drag/zoom has
  set, while actually making the camera chase the player.
- **Scale-correct via the FBX's own metadata, not a guessed constant:** Mixamo FBX exports store
  geometry in centimeters; three.js's `FBXLoader` does not auto-convert (confirmed by reading the
  vendored loader source — it only stashes `GlobalSettings.UnitScaleFactor` into `userData`, it
  never applies it). The well-known workaround is a hardcoded `scale.setScalar(0.01)`, but that's a
  guess baked into gameplay code with no link back to why; instead `player.js` reads the loaded
  model's own `unitScaleFactor` and derives `metersPerFbxUnit = unitScaleFactor / 100`, so a
  differently-scaled future character asset (a different source, not Mixamo) still comes out
  correct instead of silently wrong. Verified via screenshot: the character renders at a
  visually correct human height relative to the terrain and the ~7m chase-camera distance.
- **Camera-agnostic gameplay code:** `gameplay/player.js` never imports or reads `camera`/
  `controls` — `update(delta, moveDirectionXZ, isRunning)` takes an already-computed world-space
  direction. `game3d.js` (which owns the camera) computes that direction from the camera's current
  facing and the raw keyboard axes. Keeps the gameplay/camera boundary clean if the camera system
  is ever replaced with a real spring-arm rig later, per this file's own per-folder ownership rule.
- **Keyboard only, no touch joystick yet:** FAZ 4's roadmap also wants touch input for mobile.
  Building a joystick UI is a distinct, real sub-task of its own (and mobile input still can't be
  tested for real in this sandbox — see Known Issues) — not half-added alongside the movement/
  animation/camera work in the same run.
- **No gravity, jumping, or wall/collider raycast:** `physics.js` only does ground-height snapping.
  Building more would be speculative — nothing in the world needs jumping yet, and no collider
  exists to raycast against (castles have none either — FAZ 3's own deferred sub-task). Real future
  work once a concrete need exists (e.g., castle collision once LOD/colliders finally lands).

**Alternatives considered:**
- *Write a dedicated `SpringArm`-style camera class this run instead of reusing `OrbitControls`.*
  Rejected per the Reasoning above — real wall-avoidance raycasting is substantial, separate work;
  reusing tested infrastructure was the better use of this run's budget.
- *Hardcode `model.scale.setScalar(0.01)` for the known-Mixamo-centimeter case.* Rejected — reading
  the file's own `unitScaleFactor` costs nothing extra and doesn't silently break if the asset
  source ever changes (see `assets_manifest.json`'s note that 6 more Mixamo characters share this
  same skeleton/scale convention, but a *different* future source might not).
- *Have `player.js` read `camera`/`controls` directly instead of taking a pre-computed direction.*
  Rejected — couples gameplay to the specific camera implementation, contradicting `gameplay/
  README.md`'s stated convention and making a future camera-system replacement touch gameplay code
  too.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- Desktop pass: zero `pageerror`/`console.error`. Console confirms unchanged terrain/river/
  waterfall/settlement counts (`"Loaded 441 terrain chunks (~110.25 km²)"` → `"Placed 14
  kingdom-seat settlements; 444 terrain chunks resident (~111.00 km²)"`, identical to ADR-0015 —
  this run added a player, it didn't touch world generation) plus a new line confirming the player
  spawned at real, ground-sampled height: `"player spawned at (0.0, 20.8, 0.0)"`.
- Screenshot at boot: the character renders at a correct visual scale, standing on terrain.
- Movement test: held W for 1.5s — first attempt exposed the chase-camera bug above (screenshot
  showed the character shrinking into the distance); after the fix, a second run (Shift+W held 4s,
  then A held 2s, then idle 1s) shows the character staying consistently framed/centered across the
  whole sequence, confirming the fix.
- Orbit-drag test: after the movement sequence, a left-mouse-drag across the canvas visibly
  rotated the view to a different angle on the character (now seen from the side) while keeping
  her centered/in-frame — confirms user orbit control still works correctly around a moving player,
  not just a fixed origin point.
- Touch-emulated pass (`hasTouch: true, isMobile: true`): unchanged `"Loaded 25 terrain chunks
  (~6.25 km²)"` / `"...grounding skipped, see ADR-0013"`, player still spawns correctly, zero
  errors — FAZ 4's addition doesn't disturb the existing mobile budget branch.
- Offline-precache regression: visited `index.html` online first, confirmed via `caches.open` that
  every new file this run added — `physics.js`, `input.js`, `gameplay/player.js`, the vendored
  `FBXLoader.js`/`fflate.module.js`/`NURBSCurve.js`/`NURBSUtils.js`, and (new this run) the actual
  `peasant_girl.fbx` + 3 animation clips themselves, now that FAZ 4 code really fetches them — are
  all present in the `westeros-shell-v1` cache, then went offline and loaded `game3d.html` fresh:
  loaded fully (loading overlay hid, meaning the player finished loading from cache too), zero
  errors.
- `node --check` across every non-vendor `.js` file (including the 4 newly vendored ones):
  clean. `manifest.json`/`assets_manifest.json` still valid JSON.
- 2D-game regression (`index.html`): same pre-existing, already-documented sandbox-only
  `firebase is not defined` / blocked-network-request/404 errors as every prior run — nothing new.

**Consequence:** FAZ 4's roadmap now has two of its four sub-tasks meaningfully started: "3rd
person camera" (chase-cam via reused `OrbitControls`, wall-avoidance raycast still open) and "WASD
+ touch joystick" (WASD done, touch joystick still open) plus "ground collision" (height-snapping
done, no gravity/jump/wall-collider) and "rigged human + animation blending" (done — idle/walking/
running crossfade off real speed). World Coverage is unchanged (444/550 chunks desktop, 25/550
mobile — this run added a player, not new terrain). Texture memory grows by the character's own
maps (baked into the FBX, not measured separately here — negligible against either device budget
at this single-character scale). `service-worker.js`'s `GAME3D_SHELL_FILES` now includes every
file this run added, keeping the offline-PWA golden rule intact.

## ADR-0017: on-screen touch joystick (`ui/touchJoystick.js`) via Pointer Events, merged with keyboard axes in `game3d.js`

**Date:** 2026-07-29

**Decision:** New `src/3d/ui/` folder (per the target architecture's `ui/` bucket) and its first
module, `touchJoystick.js`. `TouchJoystick` appends a base+knob `<div>` pair to `document.body`
(styled via new `game3d.css` rules), tracks exactly one active pointer via Pointer Events
(`pointerdown`/`pointermove`/`pointerup`/`pointercancel`, `setPointerCapture` so a drag past the
base's own bounds still tracks correctly), and exposes `getAxes()` returning the same
`{forward, strafe, running}` shape `input.js`'s `KeyboardInput` already uses — continuous -1..1
here (an analog stick) rather than keyboard's discrete -1/0/1, which `game3d.js`'s existing
camera-relative-move math already handles either way. New `TOUCH_JOYSTICK_CONFIG` (`config.js`):
`RADIUS_PX` (drag clamp), `DEADZONE_RATIO` (small-jitter absorption), `RUN_THRESHOLD_RATIO` (push
to the edge to run, so one stick covers both walk and run without a separate button). `game3d.js`
instantiates a `TouchJoystick` only when `isCoarsePointerDevice()` is true (same signal
`createScene()` already uses for the mobile chunk-radius split — one source of truth for "is this
a touch device"), and a new module-local `combineAxes(keyboardAxes, joystickAxes)` sums the
forward/strafe components (clamped to [-1, 1]) and ORs `running`, falling back to the keyboard
axes unchanged when `joystickAxes` is `null` (desktop).

**Reasoning:**
- **Priority-ordered:** Session Snapshot re-confirmed the world-scale target (137.5 km²,
  unchanged, tenth straight run — see World Coverage below), zero syntax errors (`node --check`
  across every non-vendor file, including the two new ones), and a full regression smoke test
  (2D game, 3D desktop, 3D mobile, service worker — see Verified below) passed clean before any
  new code was written, confirming FAZ 4's run-17 player/camera work is stable. With no higher
  priority item outstanding, this run picked FAZ 4's one still-open item flagged as closest to a
  "blocking bug" rather than a cosmetic gap: touch-primary devices could load and see the player
  (run 17 confirmed this) but had **no way to actually move it** — `input.js` is keyboard-only.
  Camera wall-avoidance raycasting (FAZ 4's other open item) stays deferred; it's a visual-clipping
  gap, not a device class with zero usable input.
- **Pointer Events over Touch Events:** `pointerdown`/`pointermove`/`pointerup` unify mouse and
  touch under one API and support `setPointerCapture` (so a fast drag that leaves the base's visual
  bounds keeps delivering move events to it) — a raw `touchmove` listener would need its own
  manual "did this touch's target change" bookkeeping to get the same behavior. Also means this
  works under Playwright's `context.mouse` API for automated testing (verified below), not just a
  real touch device this sandbox still can't provide.
- **DOM overlay, not a canvas draw:** costs nothing from the render/triangle budget (a plain
  `<div>` pair, styled via CSS, `pointer-events: none` on the knob so only the base receives
  events). Positioned bottom-left with `env(safe-area-inset-*)` padding, matching the existing
  `.g3d-back-link`'s safe-area convention (top-left) rather than inventing a new one.
- **One stick, no separate run button:** `RUN_THRESHOLD_RATIO` (0.75) means pushing the stick
  toward its edge sets `running: true`, the same way `KeyboardInput`'s Shift key does — avoids a
  second on-screen button competing for the same thumb's reach.
- **Conditionally instantiated, not self-gating:** `TouchJoystick` itself has no device-detection
  logic — `game3d.js` decides whether to construct one at all (mirrors `ui/README.md`'s stated
  convention). A desktop session never gets an idle joystick DOM node sitting in the document.
- **`combineAxes()` sums rather than picks one source:** a touch-class device with a Bluetooth
  keyboard attached (not unheard of on tablets) can use either input without one silently
  overriding the other; on any device without a `TouchJoystick` instance, `joystickAxes` is `null`
  and this is a no-op pass-through — no behavior change for existing keyboard-only sessions.

**Alternatives considered:**
- *Raw `touchstart`/`touchmove`/`touchend` listeners.* Rejected — Pointer Events give capture
  semantics for free and unify mouse/touch, letting this run's own Playwright verification exercise
  the exact same code path a real touch device would use, not a parallel mocked one.
- *A separate fixed "Run" button instead of a drag-distance threshold.* Rejected as unnecessary
  extra UI real estate — `RUN_THRESHOLD_RATIO` gives the same walk/run distinction keyboard's
  Shift key does, from the same single stick.
- *Have `KeyboardInput` and `TouchJoystick` both live under `input.js`.* Rejected — `input.js`'s
  own doc comment and `ARCHITECTURE.md` already scope it to keyboard only; a DOM-owning module
  with its own CSS classes fits the target architecture's dedicated `ui/` folder better, and keeps
  `input.js`'s "no DOM, just event listeners" character intact.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- **Pre-change regression baseline (before writing any joystick code):** full smoke test across
  2D game (only the known, pre-existing sandbox network limitations — `firebase is not defined`,
  blocked image/video/CDN requests, nothing new), 3D desktop (444 terrain chunks, river/waterfall/
  settlement/water/sky/stars/OrbitControls all clean, player loads and responds to WASD, zero
  errors), 3D mobile-emulated (25 chunks, mobile-budget path, player loads, zero errors), and
  service worker (registers cleanly on `index.html`; confirmed `game3d.html` never registers one
  itself, by design, not a regression). Zero regressions found — safe to build on top of.
- **Mobile-emulated (Pixel 5, `hasTouch`/`isMobile`) joystick test, post-change:** joystick DOM
  (`.g3d-joystick-base`) present; simulated a mouse-drag (Pointer Events treat this identically to
  a touch drag) from the base's center 45px upward (near `RADIUS_PX`'s 50px clamp) — knob's
  `transform` updated to `translate(0px, -45px)` mid-drag, screenshots before/during the drag
  differ (MD5/file-size both changed), confirming the chase camera actually moved in response
  (the player walked/ran forward), not just a static knob graphic. Releasing the pointer reset the
  knob's `transform` to empty, confirming cleanup. Zero console errors/page errors throughout.
- **Desktop (default Playwright context — fine pointer, no touch) regression check:**
  `.g3d-joystick-base` is absent (`isCoarsePointerDevice()` correctly gates it off), zero errors —
  confirms desktop sessions are completely unaffected by this run's change.
- **Offline precache check:** after one online visit to `index.html` (which registers the service
  worker), `caches.open('westeros-shell-v1')` contains `./src/3d/ui/touchJoystick.js` — confirms
  the new file won't 404 on a subsequent offline visit to `game3d.html`.
- `node --check` on every non-vendor `.js` file touched this run (`config.js`, `input.js`,
  `game3d.js`, the new `ui/touchJoystick.js`, `service-worker.js`): clean.

**Consequence:** FAZ 4's roadmap sub-task "WASD + touch joystick" is now fully done (both halves
implemented). The remaining FAZ 4 gaps are exactly the two already flagged in 3D_GAME_PROGRESS.md:
camera wall-avoidance raycasting, and no gravity/jump/wall-collider physics — neither touched by
this run. World Coverage is unchanged (this run added input, not terrain). No new tech debt.

## ADR-0018: chase-camera wall-avoidance via a per-frame, non-persistent raycast pull-in (`camera.js`'s `resolveCameraCollision`)

**Date:** 2026-07-29

**Decision:** New `resolveCameraCollision(raycaster, target, desiredPosition, collidables,
marginMeters, minDistanceMeters)` in `camera.js`. Each frame, after `OrbitControls.update()` has
computed the free-orbit "desired" camera position, `game3d.js`'s tick loop raycasts from
`controls.target` (roughly the player's chest) toward that desired position; if the ray hits
anything in a small candidate list before reaching it, the function returns a new position pulled
in to just short of the hit (`PLAYER_CONFIG.CAMERA_COLLISION_MARGIN_METERS`, floored at
`CAMERA_COLLISION_MIN_DISTANCE_METERS` so the camera can never end up inside the player model
itself). The candidate list (`game3d.js`'s new `collectCameraCollidables`) is deliberately small:
the player's current terrain chunk + its 8 immediate neighbors (via `chunkManager.
getLoadedChunkMesh`, a new lookup method — `CAMERA_MAX_DISTANCE_METERS` is 40m, far short of one
500m chunk, so nothing farther out can ever be the real occluder) plus the 3 settlement
`InstancedMesh` parts (cheap regardless of distance, only 14 castles total). Critically, the
pulled-in position is applied to `camera.position` **only** for that frame's `renderer.render()`
call — immediately afterward, `game3d.js` restores `camera.position` to the pre-collision desired
value, and `resolveCameraCollision` itself never touches `OrbitControls`' own spherical radius.

**Reasoning:**
- **Priority-ordered:** Session Snapshot re-confirmed the world-scale target (137.5 km², unchanged,
  eleventh straight run this operator brief has re-asserted the stale "4278 km²"/"5-15m per unit"
  premise and been re-derived-and-rejected against `config.js` directly — see Session Snapshot
  below), zero syntax errors (`node --check` on every non-vendor file, baseline), and a full
  regression smoke test (2D game, 3D desktop — 444 chunks/14 settlements/river/waterfalls, 3D
  mobile-emulated — 25 chunks, service worker) passed clean, zero new errors, before any new code
  was written. World Coverage (80.7% desktop / 4.5% mobile) is already past FAZ 3/10's 80% gate, so
  with syntax/bugs/perf/leaks/debt/coverage all clear, the highest-priority remaining item was FAZ
  4's one still-open sub-task: chase-camera clipping through terrain/castles, flagged since run 17.
- **Why non-persistent (the "apply-then-restore" pattern), not writing into `OrbitControls.
  spherical.radius` directly:** `OrbitControls.update()` recomputes `offset = camera.position -
  target` fresh every call and re-derives its internal spherical radius/angles from *whatever
  `camera.position` currently is* (confirmed by reading the vendored `OrbitControls.js` source,
  not assumed) — there's no separately-stored "user's desired zoom" the library tracks for you.
  Naively leaving a collision-shortened `camera.position` in place would get that shortened radius
  picked up as the new baseline on the very next `update()` call, permanently shrinking the user's
  zoom with no way to grow back out once the obstruction clears. Restoring `camera.position` to the
  desired value right after render keeps `OrbitControls`' internal state — and therefore the user's
  actual zoom/orbit distance — completely untouched by collisions; only that one frame's rendered
  image is pulled in, and the camera eases back out the instant line of sight clears (no explicit
  "recovery" logic needed, since nothing was ever damaged to recover from).
- **Small, cheap-to-build candidate list over raycasting the whole scene:** with 441-444 terrain
  chunks resident on desktop, testing every one every frame would mean 441 bounding-sphere checks
  purely to rule out chunks nowhere near the 40m-max chase radius. Restricting to the player's
  chunk + 8 neighbors (guaranteed to contain anything within 40m regardless of where in its chunk
  the player stands) cuts that to at most 9, and `getLoadedChunkMesh` — a new one-line method on
  `ChunkManager` — means `game3d.js` doesn't need to reimplement `chunkManager.js`'s private
  `chunkKey` format to look them up.
- **Ray origin at `controls.target` (chest height), not the player's feet:** matches what the
  camera is actually orbiting around — a ray from ground level would false-hit the player's own
  terrain chunk at a glancing angle on flat ground where there's no real occlusion.
- **`InstancedMesh` collidables work with three.js's stock `Raycaster` out of the box** (r160's
  `InstancedMesh.raycast` override, no extra wiring) — confirmed by this run's own behavioral test
  (see Verified below), not assumed from the API docs.

**Alternatives considered:**
- *A full custom spring-arm camera rig replacing `OrbitControls` entirely.* Rejected for the same
  reason ADR-0016 rejected it originally: `OrbitControls` is already tested/damped/limited, and a
  parallel rig is a much larger, riskier rewrite for a problem a raycast bolted onto the existing
  rig fully solves.
- *Writing the collision-shortened distance into `spherical.radius` (a "sticky" pull-in that only
  grows back via a slow lerp once clear).* Rejected — reads as laggy/rubber-bandy compared to an
  instant, render-only clamp, and requires tracking a separate "was I just in collision" state
  machine to know when to start lerping back out. The apply-then-restore pattern gets the same
  visual result (camera pulled in while occluded) with strictly less state.
- *Player capsule/collider itself excluded from the candidate list on purpose* — not a rejected
  alternative so much as a non-issue: `collectCameraCollidables` never includes `player.object3D` at
  all, so there's no self-occlusion risk to guard against in the first place.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- **Pre-change regression baseline:** full smoke test (2D game, 3D desktop, 3D mobile-emulated) —
  only the known, pre-existing sandbox network limitations on the 2D side (`firebase is not
  defined`, blocked external requests), zero new errors, confirming run 18's touch-joystick work is
  stable before building on top of it.
- **A standalone in-browser behavioral test of `resolveCameraCollision` itself** (loaded through the
  same `game3d.html` import map, real vendored `THREE.Raycaster`/`Mesh`/`InstancedMesh`, not a
  mocked stand-in), asserting: (1) an unobstructed ray returns the exact same `desiredPosition`
  reference — no wasted allocation on the common case; (2) a `Mesh` wall placed between target and
  camera returns a *new* `Vector3` pulled in to `hitDistance - marginMeters` (measured 9.100m for a
  wall front-face at 9.5m with a 0.4m margin — exact, not approximate); (3) a wall extremely close
  to the target clamps to `CAMERA_COLLISION_MIN_DISTANCE_METERS` (1.5m) rather than going tighter or
  negative; (4) an empty collidables array is a safe no-op; (5) an `InstancedMesh` (what settlements
  actually are) triggers the same pull-in as a plain `Mesh`. All 5 assertions passed.
- **Post-change full regression smoke test:** 3D desktop (444 chunks) and 3D mobile-emulated (25
  chunks) both zero console/page errors; 2D game unchanged (same pre-existing sandbox-only errors as
  the baseline, not new).
- **6+ seconds of continuous simulated player movement** (held-down "w" key in `game3d.html`,
  running `resolveCameraCollision` every one of ~360+ real render-loop frames, not just the isolated
  unit-style test above) produced zero console/page errors — confirms the apply-then-restore
  position juggling every frame doesn't destabilize `OrbitControls` damping or accumulate drift.
- `node --check` on every file touched this run (`config.js`, `camera.js`, `game3d.js`,
  `world/chunkManager.js`): clean.

**Consequence:** FAZ 4's roadmap is now fully implemented — playable character, WASD + touch
joystick input, ground snapping, and chase-camera wall-avoidance all landed. The two gaps still
flagged in 3D_GAME_PROGRESS.md's Known Issues (no gravity/jump/wall-collider *physics* — this ADR
only fixes what the *camera* can see through, not what the *player* can walk through — and no LOD/
collider on castles themselves) remain future work, not touched by this run. World Coverage is
unchanged (80.7% desktop / 4.5% mobile — this run added a camera behavior, not terrain). No new
tech debt: the one new `ChunkManager` method (`getLoadedChunkMesh`) is a straightforward accessor
matching its class's existing style, not a workaround.
