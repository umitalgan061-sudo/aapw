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

## ADR-0019: FAZ 5 first-pass NPCs — static, idling, placed via `world/settlements.js`'s seat data, reusing `player.js`'s Mixamo FBX pipeline

**Date:** 2026-07-30

**Decision:** New `gameplay/npc.js` (`createNPC`) and new `NPC_CONFIG` (`config.js`). Each NPC
loads one of the 6 already-downloaded, shared-Mixamo-skeleton character FBXes, corrects its scale
via a newly-extracted `AssetLoader.correctMixamoFbxScale` (a static helper factored out of
`player.js`'s own scale-correction block so both modules use one implementation, not two hand-copied
ones), plays `peasant_girl`'s retargeted idle clip on loop via `THREE.AnimationMixer`, and stands at
a fixed world position — no movement, pathing, AI, or interaction. `game3d.js` resolves each
`NPC_CONFIG.SPAWNS` entry's `seatId` against `world/settlements.js`'s already-computed
`settlementSeats` (exposed from `createScene`'s return value for the first time this run) to get a
real, ground-sampled world position, adds an `(offsetXMeters, offsetZMeters)` so the NPC stands
beside the keep instead of inside it, and loads both NPCs in parallel via `Promise.all` after the
player (same "keep the loading overlay up for every character download" reasoning `player.js`
already established). This run picked exactly 2 NPCs at one seat (`stannis`) — `paladin_j_nordstrom`
(armored, guard-like) and `arissa` (the two smallest of the 6 available character files by disk
size) — standing near the Stannis Baratheon castle.

**Reasoning:**
- **Priority-ordered:** Session Snapshot re-confirmed the world-scale target (137.5 km², unchanged,
  thirteenth straight run re-deriving it from `config.js` directly and rejecting the operator brief's
  stale premise — see Session Snapshot below), zero syntax errors (`node --check` on every non-vendor
  file, baseline), and a full regression smoke test (2D game, 3D desktop — 444 chunks/14 settlements/
  river/waterfalls, 3D mobile-emulated — 25 chunks, offline precache) passed clean, zero new errors,
  before any new code was written. World Coverage (80.7% desktop / 4.5% mobile) remains past FAZ
  3/10's 80% gate. FAZ 4's own roadmap was already fully closed out as of run 19 (ADR-0018's
  Consequence), so with syntax/bugs/perf/leaks/debt/coverage/FAZ-4-sub-tasks all clear, the next
  viable phase per 3D_GAME_PROGRESS.md's own "next step" note was FAZ 5 (NPC).
- **Why static/idling-only, not movement or AI, for this first pass:** the run brief explicitly
  calls for "one or two NPCs standing/idling ... keep it atomic, don't try to build full AI/
  behavior-tree in one run." A wandering-patrol or dialogue system would pull in pathfinding,
  interaction/input handling, and UI (dialogue box) — three separate, each individually-sized
  concerns — in one commit. Landing the FBX-loading/placement half alone first (mirroring how
  `world/settlements.js` shipped modular-primitive geometry before `world/materials.js` added PBR
  texturing as a separate run) keeps this commit atomic and revertable on its own.
- **Reusing `player.js`'s idle clip, not a separate NPC-specific animation file:** all 6 non-
  `peasant_girl` characters share her Mixamo skeleton (confirmed by `assets_manifest.json`'s own
  per-character notes, e.g. "Shares Mixamo standard skeleton — reuses peasant_girl's idle/walking/
  running animation clips via retargeting"), so `AnimationMixer.clipAction` retargets the same
  skin-less `idle.fbx` clip onto any of them with zero bone remapping — exactly the assumption
  `3D_GAME_PROGRESS.md`'s run-19 "next step" note flagged as the reason to reuse `player.js`'s
  pattern rather than building a second animation pipeline.
- **`AssetLoader.correctMixamoFbxScale` extracted as a shared static method, not duplicated:**
  `npc.js` needs the exact same centimeter-to-meter correction `player.js` already has. Copy-pasting
  the block a second time would mean a future fix (e.g. a differently-scaled asset needing different
  handling) has to be applied in two places and could silently drift. Moving it onto `AssetLoader`
  (which already owns `disposeObject3D`, the other cross-cutting Mixamo/FBX-adjacent static helper)
  matches that module's existing "shared static helpers for FBX-loading callers" role rather than
  inventing a new home for it.
- **Placed via `world/settlements.js`'s seat data, not a hand-picked raw world coordinate:** every
  other system that places something in this world by "which kingdom" (settlements themselves) goes
  through `mapToWorldXZ`/the seat's sampled `groundY` — reusing `settlementSeats` (now exposed from
  `createScene`) means the NPC always stands on real, correctly-clamped-above-sea-level ground next
  to a real castle, with zero new coordinate math to get wrong. The NPC's own offset position is
  still independently re-sampled against `groundCollider.getGroundHeight` (not just copying the
  seat's keep-center `groundY`), since terrain height genuinely varies across even a 12m offset.
- **Picked the two smallest character files (`arissa.fbx` ~6.6MB, `paladin_j_nordstrom.fbx`
  ~8.6MB), not the two largest (`erika_archer.fbx` ~18.7MB, `uriel_a_plotexia.fbx` ~13MB):** every
  model this loads becomes a required offline-PWA precache entry (`service-worker.js`'s
  `GAME3D_SHELL_FILES`, same rule run 17 established for `peasant_girl.fbx`) — asset weight is a
  real download-size and precache-time cost, not a theoretical one, so minimizing it for a first pass
  (while more NPCs are still easy to add later) was a real, not premature, size-consciousness
  decision. `paladin_j_nordstrom` was chosen over `dreyar` (also ~7.3MB, smaller than paladin) for
  the second slot's thematic fit as a settlement guard, at a ~1.3MB size cost judged acceptable
  since it's still well under half the size of either large file avoided.
- **`stannis` chosen as the seat, not `umit` (the player's likely "home" kingdom) or a random one:**
  it's the kingdom-seat closest to the player's world-origin spawn point among all 14 (measured
  ~2566m vs. the next-closest at ~2924m), making it the easiest seat to reach for a future manual/
  real-device playtest without this run needing to build a dedicated fast-travel/debug-teleport tool
  it doesn't otherwise need.

**Alternatives considered:**
- *A generic "spawn N random NPCs across all settlements" system.* Rejected for this first pass —
  "random" would need a seeded PRNG stream (this project's own determinism rule) wired through a
  whole new placement-distribution algorithm, more machinery than "stand at these 2 explicit spots"
  needs to prove the FBX-retargeting pipeline works for a non-player character at all.
  `NPC_CONFIG.SPAWNS` being a flat, explicit list is intentionally the simplest thing that could
  possibly generalize later (more entries, not a rewrite) once there's a real reason for more NPCs.
- *Giving NPCs a wandering/patrol behavior immediately.* Rejected — the run brief explicitly scopes
  this out ("don't try to build full AI/behavior-tree in one run"), and idling is sufficient to prove
  and ship the actually-hard part (loading/retargeting a second character's worth of Mixamo assets
  onto a shared skeleton) on its own.
- *A brand-new `NPC_CONFIG.IDLE_ANIMATION_URL` pointing at a dedicated NPC idle clip.* Rejected —
  no such clip exists in `assets/`, and downloading one requires the interactive Mixamo login this
  cloud agent cannot perform (see `3D_GAME_PROGRESS.md`'s "Any future Mixamo/Free3D asset needs a
  human step" note); reusing `peasant_girl`'s already-downloaded, already-licensed idle clip needs no
  new asset and is exactly what `assets_manifest.json`'s own per-character notes already assume will
  happen.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- **Pre-change regression baseline:** full smoke test (2D game — only the known, pre-existing
  sandbox network limitations, `firebase is not defined`/blocked requests, nothing new; 3D desktop —
  441→444 chunks after settlement grounding, 14 settlements, river/waterfalls; 3D mobile-emulated —
  25 chunks), zero new errors, confirming run 19's wall-avoidance work is stable before building on
  top of it.
- **A standalone in-browser behavioral test of `createNPC` itself** (real vendored `FBXLoader`/
  `AnimationMixer`, loaded through the same `game3d.html` import map, not a mocked stand-in): loaded
  `paladin_j_nordstrom.fbx` + `peasant_girl`'s `idle.fbx` with an explicit test position/rotation,
  asserted — the returned `object3D` exists, its `name`/`position`/`rotation.y` exactly match the
  given input, `userData.isPlaceholder` is `false` (a real FBX loaded, not the `AssetLoader` fallback
  box), the model contains 2 real meshes including a `SkinnedMesh` (confirms actual retargeted
  geometry, not an empty group), 5 consecutive `update()` calls (idle mixer ticking) and `dispose()`
  both complete without throwing, and zero console/page errors throughout. All 10 assertions passed.
- **Post-change full regression smoke test:** 3D desktop (444 chunks, `"Spawned 2 FAZ 5 NPC(s)"` in
  the console) and 3D mobile-emulated (25 chunks, same NPC-spawn log line) both zero console/page
  errors; 2D game unchanged (same pre-existing sandbox-only errors as the baseline, not new).
- **A live-scene, non-mocked check via a temporary debug hook** (`window.__debugGame3DState = state`,
  added only for this test and reverted before commit — confirmed via `git diff` showing zero trace
  of it in the committed `game3d.js`): both NPCs are present in `state.scene`'s graph by name
  (`scene.getObjectByName(...) === npc.object3D`), at the exact expected world positions (seat
  center + configured offset, matching `NPC_CONFIG.SPAWNS`' `offsetXMeters`/`offsetZMeters` to the
  centimeter). A camera moved to frame one NPC up close (with lighting temporarily brightened for
  screenshot visibility only) rendered a clearly humanoid, armored character model standing on the
  terrain — not a placeholder box, not an empty/invisible node.
- **Offline-precache check:** after one online visit to `index.html`, `caches.open('westeros-shell-
  v1')` contains `./src/3d/gameplay/npc.js`, `./assets/models/characters/paladin_j_nordstrom.fbx`,
  and `./assets/models/characters/arissa.fbx` — confirms none of the three new files would 404 on a
  subsequent offline visit to `game3d.html`.
- `node --check` on every file touched this run (`config.js`, `assetLoader.js`, `gameplay/player.js`,
  `gameplay/npc.js` (new), `game3d.js`, `service-worker.js`): clean.

**Consequence:** FAZ 5 (NPC) has a real, verified first slice: 2 static NPCs load, retarget, idle,
and render correctly at a real kingdom seat, on both desktop and mobile-emulated device classes, with
zero regressions to the 2D game or any existing 3D system. World Coverage is unchanged (this run
added characters, not terrain — 80.7% desktop / 4.5% mobile, same as run 19). Still-open FAZ 5 work,
honestly flagged rather than silently assumed: no movement/patrol/AI, no player-NPC interaction or
dialogue, no name/health UI, and only 1 of 14 kingdom seats has any NPCs yet (the other 5 downloaded
character files — `dreyar`, `erika_archer`, `paladin_wprop_j_nordstrom`, `uriel_a_plotexia` — remain
unused, available for future NPC placements without any new asset download). No new tech debt: the
one refactor this run made (`AssetLoader.correctMixamoFbxScale`) removes duplication rather than
adding it, and `settlementSeats` being exposed from `createScene`'s return value is a straightforward
new field on an existing return object, not a workaround.

## ADR-0020: FAZ 5 second pass — extend `NPC_CONFIG.SPAWNS` to 4 more kingdom seats, config-only, using the 4 remaining downloaded character files

**Date:** 2026-07-30 (run 21)

**Decision:** Extended `config.js`'s `NPC_CONFIG.SPAWNS` from 2 entries (both at `stannis`) to 6,
adding one NPC each at `umit` (`dreyar.fbx`), `cersei` (`paladin_wprop_j_nordstrom.fbx`), `berkalp`
(`erika_archer.fbx`), and `doran` (`uriel_a_plotexia.fbx`) — the 4 downloaded Mixamo character files
run 20 left unused. No code changes: `game3d.js`'s spawn-resolution loop (`NPC_CONFIG.SPAWNS.map(...)`
in the async NPC-loading block) already iterates the list generically and resolves each entry's
`seatId` against `state.settlementSeats`, so a new list entry is sufficient on its own. Also added
the 4 new FBX files to `service-worker.js`'s `GAME3D_SHELL_FILES` precache list (same "precache once
code actually loads it" rule ADR-0019 followed for the first 2).

**Reasoning:**
- **Priority-ordered, per protocol:** Session Snapshot re-derived the world scale directly from
  `src/3d/config.js` (`METERS_PER_MAP_UNIT: 1.75`, 25x22 grid = 137.5 km²) — unchanged, matching
  ADR-0004 exactly; this is now the 14th straight run reaching the same conclusion against a
  standing-instruction premise ("4278 km²"/"redo the correction") that has not matched the
  repository's actual state since run 3. No config change was made. `node --check` was clean on the
  full non-vendor tree at baseline, and a pre-change regression smoke test (2D game, 3D desktop — 444
  chunks/14 settlements, 3D mobile-emulated — 25 chunks) passed with zero errors before any edit.
  World Coverage remains 80.7% desktop / 4.5% mobile, past the FAZ 3/10 80% gate; FAZ 4 and FAZ 5's
  first pass were already closed/started. With syntax/bugs/perf/leaks/debt/coverage all clear, the
  highest-value next slice was run 20's own explicitly-flagged "cheapest" option: extending
  `NPC_CONFIG.SPAWNS` to more seats needs no new code, only config entries.
- **Why these 4 seats, not 4 random ones:** `umit`, `cersei`, `berkalp`, and `doran` were picked to
  spread NPCs across distinct regions/houses (Targeryan capital, Lannister, Stark north, Martell
  south) rather than clustering more guards at seats already covered, on the theory that a future
  manual playtest exploring the map benefits more from "every visited region has at least one NPC"
  than from "one region has many." All 4 are real `world/settlements.js` seat ids, verified by
  `grep`-ing the live `INIT_KINGDOMS`-derived `SEATS` array before writing the config, not assumed
  from memory.
- **Why one NPC per seat, not two (unlike `stannis`'s pair):** this pass's goal was breadth (more
  seats populated) over depth (more NPCs per seat) — a deliberate, scoped choice, not a resource
  constraint. Two of the 4 newly-used files (`erika_archer.fbx` ~18.7MB, `uriel_a_plotexia.fbx`
  ~13MB) are the two largest of the 6 character files; using each once, not twice, keeps total
  offline-precache weight proportionate (all 6 files combined ≈ 64MB, now fully committed to the
  precache list either way since every downloaded character is now in use).
- **Ground height sampling works regardless of terrain-chunk residency, confirmed before assuming
  it's safe:** `game3d.js`'s NPC-loading loop calls `state.groundCollider.getGroundHeight(worldX,
  worldZ)`, the same procedural (noise-based) sampler `world/settlements.js` itself uses to ground all
  14 seats at boot — it is not a lookup against a rendered mesh, so an NPC at any seat gets a correct
  height whether or not that seat's terrain chunk is currently resident. This means the new NPCs are
  safe to add even outside the desktop boot-preview radius (not a concern here — all 4 new seats sit
  inside the already-444-chunk desktop preview, confirmed by the smoke test below spawning without
  any new console warnings) and on mobile, where they inherit the same documented "may lack a visible
  ground mesh directly beneath" caveat this file's Known Issues already track for settlements
  generally (not a new gap this run introduces).

**Alternatives considered:**
- *Give the new NPCs movement/patrol now that there's more than one seat to walk between.* Rejected —
  still explicitly out of scope per the standing "don't build full AI/behavior-tree in one run" rule;
  this pass stays a pure, atomic extension of an already-proven pattern.
- *Distribute all 4 new NPCs across the remaining 12 empty seats more evenly (e.g. 1 every 3 seats,
  covering more of the roadmap's "waypoint later" groundwork).* Considered, but picking the 4 as
  "one per remaining major house, prioritizing geographic spread" is simpler to reason about and
  verify than a formulaic every-Nth-seat rule, for the same real benefit (breadth over depth).

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- Pre-change regression baseline: 2D game (only the pre-existing, already-documented sandbox network
  limitations), 3D desktop (444 chunks, 14 settlements), 3D mobile-emulated (25 chunks) — zero errors.
- Post-change smoke test on both device classes: console confirms `"Spawned 6 FAZ 5 NPC(s)."` (up
  from 2), desktop still `"444 terrain chunks resident (~111.00 km²)"`, mobile still `"25 terrain
  chunks"` — zero console/page errors either path.
- **A live-scene check via a temporary debug hook** (`window.__debugGame3DState = state`, added only
  for this test and reverted before commit — confirmed via `git diff` showing zero trace of it in the
  committed `game3d.js`): all 6 NPCs (`stannis-guard-1`/`-2`, `umit-guard-1`, `cersei-guard-1`,
  `berkalp-guard-1`, `doran-guard-1`) present in `state.scene`'s graph by name, at 6 distinct
  world positions (not all clustered at one point), and `userData.isPlaceholder` unset on every one
  (confirms real FBX geometry loaded for all 4 new characters, not the `AssetLoader` fallback box).
- **Offline-precache check:** after one online visit to `index.html`, `caches.open('westeros-shell-
  v1')` contains all 4 newly-referenced FBX files (`dreyar.fbx`, `paladin_wprop_j_nordstrom.fbx`,
  `erika_archer.fbx`, `uriel_a_plotexia.fbx`) plus `npc.js` — confirms none would 404 offline.
- `node --check` on `config.js` and `service-worker.js` (the only 2 files this run touched): clean.
  JSON-validated `manifest.json`/`assets_manifest.json` (unchanged — all 6 characters were already
  registered by the parallel asset-adding session, only code-side usage changed this run): clean.

**Consequence:** All 6 downloaded Mixamo character files are now in active use; 5 of 14 kingdom seats
have at least one NPC (`stannis` x2, `umit`, `cersei`, `berkalp`, `doran` x1 each). World Coverage
unchanged (80.7% desktop / 4.5% mobile — this run added characters, not terrain). Still-open FAZ 5
work, same honest gaps ADR-0019 already flagged plus one narrowed: no movement/patrol/AI, no
player-NPC interaction/dialogue/name-tag UI, and 9 of 14 kingdom seats still have zero NPCs (down
from 13). No new tech debt — this was a pure config + precache-list extension of an already-verified
pattern, no new abstractions or refactors.

## ADR-0021: FAZ 5 waypoint patrol — a scoped, 2-NPC pilot (`gameplay/npc.js`'s `patrolWaypoints`), not a full behavior tree

**Date:** 2026-07-30 (run 22)

**Decision:** `gameplay/npc.js`'s `createNPC` gained optional `groundCollider`/`walkAnimationUrl`/
`patrolWaypoints`/`speedMps`/`pauseSeconds`/`turnRateRadiansPerSecond` parameters. When
`patrolWaypoints` (2+ world-space points) is supplied, the NPC walks a straight line to the next
point in the list (index wraps via modulo — 2 points ping-pong back and forth, 3+ would loop),
pausing to idle for `pauseSeconds` at each one, reusing `player.js`'s exact per-frame ground-height
resampling (`groundCollider.getGroundHeight`) and shortest-path yaw-turn-toward-heading pattern, and
crossfading between the shared idle/walk `AnimationMixer` actions the same way `player.js` does. When
`patrolWaypoints` is omitted (the default), an NPC behaves exactly as before (run 20/21) — fully
backward compatible, zero behavior change for existing static NPCs. `config.js`'s `NPC_CONFIG` gained
`WALK_ANIMATION_URL` (reused from `PLAYER_CONFIG.ANIMATION_URLS.walking`), `PATROL_SPEED_MPS` (1.4,
slower than the player's 3.2 — a guard's pace), `PATROL_PAUSE_SECONDS` (3), and
`PATROL_TURN_RATE_RADIANS_PER_SECOND` (4, slower than the player's 10 — an unhurried guard-turn).
Only 2 of the 6 NPCs (`stannis-guard-1`/`-2`) got a `patrol: {toOffsetXMeters, toOffsetZMeters}`
field added to their `NPC_CONFIG.SPAWNS` entry — a 24m straight walk to the opposite side of the same
offset, at the identical 16.97m radial distance from the keep center the static spawn point already
proved clear (no new wall-clearance risk). The other 4 NPCs (`umit`, `cersei`, `berkalp`, `doran`)
are untouched, still static/idle-only. `game3d.js`'s spawn-resolution loop computes each patrolling
NPC's 2nd waypoint in world space (`seat.x/z + patrol.toOffsetXMeters/ZMeters`, same formula already
used for the spawn point itself) and passes it through; NPCs without a `patrol` field get
`patrolWaypoints: undefined`, taking the unchanged static code path.

**Reasoning:**
- **Priority-ordered, per protocol:** Session Snapshot confirmed clean git state (main already
  matched a fresh `origin/main` fetch, no detached-HEAD issue this run), re-derived the world scale
  from `config.js` directly (still 137.5 km², matching ADR-0004, 14 straight runs now — see this
  file's Session Snapshot), `node --check` clean at baseline, and a pre-change regression smoke test
  (2D game, 3D desktop — 444 chunks/14 settlements/6 static NPCs, 3D mobile-emulated) passed with
  zero errors. World Coverage remains 80.7% desktop / 4.5% mobile, past the FAZ 3/10 gate. With
  syntax/bugs/perf/leaks/debt/coverage clear and FAZ 4 fully closed, the next roadmap item was FAZ
  5's own explicitly-unchecked "Waypoint/patrol (Behavior Tree)" line — the last open FAZ 5 sub-task
  besides interaction/dialogue UI (a separate, larger concern involving input handling and new UI,
  not attempted this run).
- **Why a straight-line 2-point ping-pong, not a real behavior tree:** the roadmap line literally
  says "(Behavior Tree)" in parentheses, but every run brief since ADR-0019 has explicitly scoped
  full AI/behavior-tree work out of a single run. A straight-line walk between 2 caller-supplied
  points — no pathfinding, no obstacle avoidance, no decision logic beyond "arrived or not, paused or
  not" — is the smallest possible thing that actually earns the word "patrol" (the NPC visibly
  walks, turns, and idles in a loop) without building a general-purpose AI system speculatively. A
  real behavior tree (multiple states, priorities, player-awareness) is real future work once there's
  a second concrete need for it (e.g. flee/follow animals in FAZ 6), not something to build against a
  single use case now.
- **Why only 2 of 6 NPCs, not all 6:** matches the project's own established incremental pattern
  (run 20 shipped 2 static NPCs before run 21 extended to 6; `world/settlements.js` shipped modular
  primitives before `world/materials.js` added PBR texturing as a separate run). Patrol movement is a
  genuinely new code path (ground resampling every frame, a second animation clip per NPC, state
  machine) — proving it correctly on 2 NPCs first, verified with real position-over-time
  measurements (not just "no errors"), is safer than rolling it out to all 6 in one commit. The other
  4 NPCs' `NPC_CONFIG.SPAWNS` entries simply don't have a `patrol` field, so extending patrol to them
  later is the same kind of config-only change ADR-0020 already established for adding new NPCs.
- **Why the walk clip needs no new download:** `peasant_girl`'s `walking.fbx` is already downloaded,
  already precached (`service-worker.js`, since run 17), and already skin-less/"In Place" — the exact
  same clip `player.js` retargets onto its own model. Since all 6 NPC character files share
  `peasant_girl`'s Mixamo skeleton (confirmed at every prior NPC-related run), the walk clip retargets
  onto `paladin_j_nordstrom`/`arissa` (the 2 patrolling models) with zero new code, the same way the
  idle clip already did.
- **Why the NPC resamples ground height every frame while walking (not just at the 2 endpoints):**
  matches `player.js`'s own movement exactly — terrain height genuinely varies across even a 24m
  walk (confirmed non-flat by the existing FBM noise), so snapping only at the endpoints would let the
  NPC visibly float or clip into the ground mid-walk. This is why `groundCollider` had to become a
  parameter `createNPC` didn't previously need.

**Alternatives considered:**
- *A shared, generic "path-follower" component used by both `player.js` and `npc.js`.* Rejected as
  premature abstraction — `player.js`'s movement is real-time-input-driven (a direction vector each
  frame) while `npc.js`'s patrol is a fixed point-to-point walk; the actual duplicated logic (ground
  resampling formula, shortest-path yaw lerp) is 4-5 lines each, well under the threshold where a
  shared abstraction pays for the indirection it adds. Revisit if a third movement-driven system
  (animals, FAZ 6) needs the same pattern a third time.
- *Give all 6 NPCs a patrol immediately, since the config already supports 4 more without new code.*
  Rejected — see "why only 2 of 6" above; proving new movement code on a small, easily-observed pilot
  first is a real ADR-0019-style scoping choice, not a missed opportunity.
- *A loop through 3+ waypoints (a real patrol route) instead of 2-point ping-pong.* Rejected for this
  pilot — 2 points already exercises every code path (arrival detection, pause, turn, walk,
  modulo-wrap) a longer route would; a 3+-point patrol is a config-only follow-up (`patrol` could
  become `patrolOffsets: [{...}, {...}, ...]` later) once the 2-point pilot proves out on a real
  device, not a reason to complicate this pass.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- Pre-change regression baseline: 2D game (only pre-existing, already-documented sandbox network
  limitations), 3D desktop (444 chunks, 14 settlements, `"Spawned 6 FAZ 5 NPC(s)."`), 3D
  mobile-emulated (25 chunks) — zero errors, matching run 21's own baseline exactly.
- Post-change full smoke test on both device classes: `"Spawned 6 FAZ 5 NPC(s)."` unchanged, zero
  console/page errors; 2D game unchanged.
- **A position-over-time measurement via a temporary debug hook** (`window.__debugGame3DState =
  state`, added only for this test and reverted before commit — confirmed via `git diff` showing zero
  trace of it in the committed `game3d.js`): sampled all 6 NPCs' `(x, z)` position 3 times, 8 seconds
  apart. `stannis-guard-1`/`-2` moved 3.6m then 11.4m between samples (≈1.4 m/s, matching
  `PATROL_SPEED_MPS` exactly once past the initial 3s pause) while `umit-guard-1`, `cersei-guard-1`,
  `berkalp-guard-1`, and `doran-guard-1` moved exactly 0.000m both times — confirms patrol movement
  works for the 2 configured NPCs and, just as importantly, confirms it does **not** leak into the 4
  static ones (zero regression to run 21's static-placement behavior).
- `node --check` on all 3 touched files (`config.js`, `game3d.js`, `gameplay/npc.js`): clean.

**Consequence:** FAZ 5's "Waypoint/patrol" roadmap line has a real, verified first slice: 2 of 6 NPCs
now walk a scripted patrol route with idle pauses and directional turning, the other 4 remain
unaffected static idlers, and the patrol mechanism itself (`patrolWaypoints`, arbitrary length,
modulo-wrapped) is already general enough to extend to more NPCs or longer routes as a config-only
follow-up. World Coverage unchanged (80.7% desktop / 4.5% mobile — this run added movement, not
terrain). Still-open FAZ 5 work: no player-NPC interaction/dialogue/name-tag UI, patrol still only on
2 of 6 NPCs, and no player-awareness/reactive behavior (an NPC keeps patrolling regardless of where
the player is — real behavior-tree territory, deliberately still out of scope). No new tech debt —
`createNPC`'s new parameters are all optional with the pre-existing behavior as the default, so
nothing about the static-NPC code path changed.

## ADR-0022: FAZ 5 NPC name-tag billboards (`gameplay/npc.js`'s `createNameTagSprite`), not full dialogue/interaction

**Context:** `3D_GAME_PROGRESS.md`'s FAZ 5 roadmap and the Known Issues list have long flagged "no
player-NPC interaction/dialogue/name-tag UI yet" as an honest, scoped-out gap (see ADR-0019's
Alternatives). With world scale, syntax, perf, and memory all clear this run (run 23) and FAZ 5's
patrol sub-task already having a real pilot (ADR-0021), the name-tag half of that gap was the next
concrete, small, testable slice — real dialogue/interaction is a much larger system (needs UI state,
input handling, and a real "what can this NPC say" data model) and stays out of scope for one run.

**Decision:** Give every `NPC_CONFIG.SPAWNS` entry with a `displayName` field a billboard name-tag —
a `THREE.Sprite` with a canvas-rendered text texture, added as a child of the NPC's loaded FBX model
at `NAME_TAG_VERTICAL_OFFSET_METERS` (2.1m) above its local origin (the model's feet). All 6 current
NPCs got a house-flavored Turkish `displayName` (`'Baratheon Muhafızı I'`/`'II'` for the two `stannis`
guards since they share a house, `'Targeryan Muhafızı'`/`'Lannister Muhafızı'`/`'Stark Muhafızı'`/
`'Martell Muhafızı'` for the other four, derived from each spawn's `seatId` matching `script.js`'s
`INIT_KINGDOMS` house names) — config-only additions, `SPAWNS`' shape otherwise unchanged.

**A real bug found and fixed before this shipped, not assumed correct from the code alone:** the
first implementation set the sprite's local `position`/`scale` directly to the intended real-world
meters (2.1m height, 2.4m x 0.6m size) — reasonable-looking code that rendered as a near-invisible
speck in the actual headless-Chromium smoke test. Root cause, confirmed by reading the vendored
sprite vertex shader (`vendor/three/three.module.js`'s `vertex$1` for `ShaderLib.sprite`): a
`THREE.Sprite` billboards (drops rotation) but still fully inherits its **parent's translation and
scale** — both the sprite's `mvPosition` and its on-screen `scale` are derived from its own
`modelMatrix`, which composes the parent's transform in. Since the tag is parented under the FBX
`model`, and `AssetLoader.correctMixamoFbxScale` had just set that model's `scale` to ~0.01 (Mixamo
FBX files are authored in centimeters), the tag's local "2.1m"/"2.4m x 0.6m" values were themselves
being multiplied by 0.01 in the render matrix — landing at ~2cm above the feet and ~2cm x 0.6cm in
size, invisible in practice. Fixed by dividing the tag's local position/scale by the model's own
`scale.x` (`inverseParentScale = 1 / model.scale.x`) before assigning them, canceling the parent's
scale out so the tag's *effective world-space* size/height match the real-meter constants regardless
of the FBX's own unit scale. Verified via a temporary debug hook (`window.__debugGame3DState = state`,
reverted before commit, same pattern ADR-0020/ADR-0021 used) that teleported the player + camera
target next to a live NPC and screenshotted it: "Baratheon Muhafızı I" renders legibly, centered
above the character's head, both before and after a patrol-turn (confirming the sprite still faces
the camera through the parent's rotation, as expected — only scale needed correcting, not rotation).

**Why parent it under `model` at all, instead of adding it as a scene-level sibling that tracks
position each frame:** simpler and just as correct once the scale bug above is fixed — a child
automatically inherits the model's *position* every frame for free (no extra per-frame code needed
in `update()`, unlike the patrol-position logic which does need one), and a `Sprite`'s billboard
shader already discards inherited *rotation* for its own facing, so a parent's yaw changes (patrol
turning) never rotate the tag out of billboard alignment — only its position needs to (and does)
follow the parent. The only inheritance that needed correcting was scale, handled above.

**Alternatives considered:**
- *DOM-based name tags (an HTML overlay positioned via `camera.project()`), like a typical web game
  HUD nametag.* Rejected — this project's `ui/README.md` explicitly scopes `src/3d/ui/` to DOM-only
  modules that never reach into scene/gameplay internals; a per-frame `camera.project()` position
  sync for 6 (soon possibly more) NPCs would need exactly that coupling. An in-scene `Sprite` is a
  natural fit for `gameplay/npc.js`, which already owns the NPC's Three.js object graph, and gets
  real depth-testing (a tag correctly hides behind a wall/hill) for free — a DOM overlay would not.
- *Always-visible regardless of distance vs. a proximity/LOD gate.* Rejected for now — real
  world-space `Sprite` scale already means a tag shrinks naturally with distance like the character
  itself (see the size/scale explanation above), and 6 sprites total is negligible against every
  performance budget in this project. Revisit only if/when NPC count grows enough that distant, tiny
  tags become visual clutter — not a real problem yet.
- *A generic "billboard label" utility shared with a future UI system (health bars, quest markers),
  built now.* Rejected as premature abstraction — `createNameTagSprite` is ~20 lines local to
  `gameplay/npc.js`; extracting a shared utility before a second, different caller exists just adds
  indirection this project's own quality rules (KISS, no speculative abstraction) argue against.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- Pre-change regression baseline: 3D desktop (444 chunks, 14 settlements, `"Spawned 6 FAZ 5 NPC(s)."`),
  3D mobile-emulated (25 chunks), 2D game (only the same pre-existing, already-documented sandbox
  network limitations) — all matching run 22's own baseline exactly.
- Post-change full smoke test on both device classes: identical log lines, zero new console/page
  errors; 2D game unchanged.
- **A scene-graph check via the same temporary debug hook every recent run has used:** confirmed
  every NPC with a `displayName` gained exactly one `THREE.Sprite` child (`object3D.traverse` counting
  `node.isSprite`), and a close-range screenshot (camera + player teleported next to a live NPC via
  the debug hook, reverted before commit) shows the rendered tag text matching its config exactly.
- `node --check` on all 3 touched files (`config.js`, `game3d.js`, `gameplay/npc.js`): clean. JSON-
  validated `manifest.json`/`assets_manifest.json` (unchanged this run).

**Consequence:** FAZ 5's "no name-tag UI" gap is closed for all 6 currently-placed NPCs; the harder
half of the original gap (real dialogue/interaction, and player-awareness driving what a tag shows)
remains open and out of scope, same as before. `NPC_CONFIG.SPAWNS`' `displayName` field is optional
and additive — any future spawn entry that omits it just gets no tag, matching the pre-existing
static/idle-only default pattern the `patrol` field already established (ADR-0021). No change to
World Coverage (this run added NPC UI, not terrain) or to the World Coverage's underlying world-scale
numbers, which were re-verified unchanged against the 100-150 km² band per this run's Session
Snapshot (see `3D_GAME_PROGRESS.md`'s "This Run" section below) before any of this work began.

## ADR-0023: FAZ 5 patrol extended to all 6 NPCs (config-only, same geometry ADR-0021 already proved safe)

**Context:** ADR-0021 piloted waypoint patrol on just 2 of 6 NPCs (the `stannis` guards) as a
deliberately small first slice, and every run since (22, 23) flagged "extending to more NPCs is a
config-only change, same pattern already established" as the cheapest open FAZ 5 sub-task. With
world scale, syntax, perf, memory, and the prior run's name-tag work all clear, this was the
highest-priority remaining item this run (run 24).

**Decision:** Add a `patrol` field (`{toOffsetXMeters, toOffsetZMeters}`) to the 4 remaining static
`NPC_CONFIG.SPAWNS` entries (`umit-guard-1`, `cersei-guard-1`, `berkalp-guard-1`, `doran-guard-1`),
using the exact same geometry ADR-0021 already validated: flip the existing `offsetZMeters` sign,
keep `offsetXMeters` unchanged. Since every kingdom seat uses the identical shared castle template
(`world/settlements.js`'s one box-keep + 4-tower silhouette, `SETTLEMENT_CONFIG`), the same 16.97m
radial distance from keep center that ADR-0021 confirmed clears the 34m keep footprint on `stannis`
applies unchanged to all 14 seats — no per-seat re-verification of wall clearance was needed, only a
real regression/movement test to confirm it actually works on each seat's own local terrain slope
(ground height differs per seat; the patrol code already resamples height every step, proven on
`stannis`, but not yet exercised on `umit`/`cersei`/`berkalp`/`doran`'s terrain until now).
**Zero code changes** — `game3d.js`'s NPC-loading loop already builds `patrolWaypoints` generically
from any `spawn.patrol` field (see the loop's `spawn.patrol ? [...] : undefined` branch), so this is
purely additive config, identical in shape to ADR-0020's seat-extension pattern.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- Pre-change regression baseline: 3D desktop (444 chunks, 14 settlements, `"Spawned 6 FAZ 5
  NPC(s)."`), 3D mobile-emulated (25 chunks), 2D game (only the same pre-existing, already-
  documented sandbox network limitations) — matching run 23's own baseline exactly.
- Post-change full smoke test on both device classes: identical log lines, zero new console/page
  errors; 2D game unchanged.
- **A position-over-time measurement via a temporary debug hook** (`window.__debugGame3DState =
  state`, added only for this test and reverted before commit — confirmed via `git diff` showing
  zero net change to the committed `game3d.js`): sampled all 6 NPCs' `(x, z)` position twice, 8
  seconds apart. **All 6** NPCs moved ~3.6m in the window (previously only the 2 `stannis` guards
  moved; the other 4 were 0.000m in ADR-0022's own test) — confirms patrol now works correctly on
  every seat's own terrain, not just `stannis`'s.
- `node --check` on `config.js`: clean.

**Consequence:** FAZ 5's "patrol only on 2 of 6 NPCs" gap is closed — all 6 NPCs now walk a 24m
scripted back-and-forth patrol with idle pauses and directional turning. Still-open FAZ 5 work: 9 of
14 kingdom seats have zero NPCs (needs either a second NPC reusing an already-placed model, or a new
Mixamo/Free3D download requiring the documented human manual-download step), no dialogue/interaction
system, and no player-awareness/reactive behavior (patrol runs on a fixed route regardless of player
position — deliberately still out of scope, real behavior-tree territory). No new tech debt — this
is a pure config extension of an already-verified pattern, no new parameters or code paths.

## ADR-0024: FAZ 5 NPCs extended to 4 more kingdom seats by reusing already-downloaded models (9/14 seats now have NPCs)

**Context:** With FAZ 5's patrol pattern now applied to all 6 existing NPCs (ADR-0023) and world
scale/syntax/perf/memory all clear this run (run 25), the next-cheapest open FAZ 5 gap — flagged by
runs 20/21/23/24 — was "9 of 14 kingdom seats still have zero NPCs... a further seat needs either a
second NPC reusing an already-placed model, or a new Mixamo/Free3D download." The latter needs a
human manual-download step this agent cannot perform; the former needs no new asset at all.

**Decision:** Added 4 new `NPC_CONFIG.SPAWNS` entries, one each at `ziya` (Tyrell), `balon`
(Greyjoy), `robin` (Arryn), and `jon` (Stark, at the Wall) — chosen for house diversity (4 houses not
yet represented by any NPC: Tyrell, Greyjoy, Arryn, and a second Stark presence distinct from
`berkalp`/Winterfell) rather than picking arbitrarily from the remaining 9 candidate seats (`ziya`,
`berk`, `olena`, `balon`, `robin`, `jon`, `twin`, `Xaro`, `Night King`). Each reuses one of the 6
already-downloaded Mixamo character FBX files (`arissa`, `paladin_wprop_j_nordstrom`,
`erika_archer`, `uriel_a_plotexia` — the same files already placed once each at `stannis`/`cersei`/
`berkalp`/`doran`), all already precached in `service-worker.js`'s `GAME3D_SHELL_FILES` since run
20/21, so this needed **zero new asset files and zero code changes** — `game3d.js`'s NPC-loading
loop and `createNPC` already handle any number of `SPAWNS` entries generically. Gave all 4 a `patrol`
field from the start (unlike the original static-then-patrol-later staging of ADR-0019→ADR-0021→
ADR-0023) since patrol is now the proven, established default for every NPC, not a separate future
step. `jon`'s `displayName` is `'Gece Nöbeti Muhafızı'` (Night's Watch Guard), not another generic
`'Stark Muhafızı'` — `script.js`'s `INIT_KINGDOMS` titles Jon Snow's seat "Duvar Muhafızı" (Wall
Guardian), a distinct Night's Watch identity from Winterfell's own Stark guard already placed by
ADR-0020.

**Why not all remaining 9 seats in one run:** `Night King`'s seat (`territory: 0`, a special
antagonist entity, not a normal ruling house) doesn't fit the "kingdom-seat guard" concept this
system models — placing a generic guard there would be thematically wrong, not just a scope
decision, so it's excluded outright rather than deferred. Of the other 8 real candidates
(`ziya`/`berk`/`olena` are all `:Tyrell`, `twin` is a second `:Lannister`, `Xaro` is a distant Essos
seat), picking 4 for house diversity keeps this run's slice reviewable and the still-open list
short and honest, rather than dumping all 8 into one commit — same "keep it atomic" reasoning
ADR-0021 used to justify piloting patrol on 2 NPCs before extending to the rest.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- Pre-change regression baseline: 3D desktop (444 chunks, 14 settlements, `"Spawned 6 FAZ 5
  NPC(s)."`), 3D mobile-emulated (25 chunks), 2D game (only the same pre-existing, already-
  documented sandbox network limitations) — matching run 24's own baseline exactly.
- Post-change full smoke test on both device classes: `"Spawned 10 FAZ 5 NPC(s)."` (up from 6), zero
  new console/page errors; 2D game unchanged.
- **A scene-graph + position-over-time check via a temporary debug hook** (`window.__debugGame3DState
  = state`, added only for this test and reverted before commit — confirmed via `git diff` showing
  zero net change to the committed `game3d.js`): confirmed all 10 NPCs loaded real geometry (zero
  `userData.isPlaceholder` fallbacks — i.e. every reused FBX actually fetched and parsed correctly a
  second time, not silently falling back), all 10 gained exactly one name-tag sprite each, and all 10
  moved ~4.1m over an 8-second sample window (patrol confirmed working on 4 new seats' own local
  terrain, not just the 6 already-proven ones).
- `node --check` on `config.js` (the only touched source file): clean.

**Consequence:** 9 of 14 kingdom seats now have at least one NPC (up from 5), 10 NPCs total (up from
6), all patrolling with a name tag. Still-open FAZ 5 work, narrowed but not closed: 5 seats remain
NPC-less (`berk`, `olena`, `twin`, `Xaro`, and `Night King` deliberately excluded — see above); no
dialogue/interaction system; no player-awareness/reactive behavior. Negligible perf impact — 4 more
`SkinnedMesh`+`AnimationMixer`+`Sprite` instances at the same low-poly Mixamo character scale the
existing 6 already used well under budget (see `3D_GAME_PROGRESS.md`'s Performance Budget Status);
not re-profiled in full this run since the existing NPC-count headroom was already documented as
comfortable and 10 is not a step-change in scale. No new tech debt — a pure config extension
reusing the exact patterns ADR-0020/ADR-0021/ADR-0023 already established.

## ADR-0025: FAZ 6 first pass — 2 static/idling wolves via a new `gameplay/animals.js`

**Context:** Run 25's "Next step" flagged FAZ 5's cheap "reuse an existing model" NPC slices as
exhausted for house diversity, and pointed at FAZ 6 (Hayvanlar) instead: the `wolf` glTF/GLB
(Free3D/3dhaupt, rigged, Walk/Run/Sit/Creep/Idle clips) was already downloaded and registered in
`assets_manifest.json` since an earlier parallel-work merge, but no code had ever loaded it. This
run's Session Snapshot re-confirmed the world-scale target (still 137.5 km², inside the 100-150 km²
band — the operator brief's own "4278 km²" reference is stale, twentieth straight run to
re-derive and reconfirm the correct number from `config.js` itself) and found no higher-priority
bug/regression/perf/memory issue open, so per the task's own priority order (syntax → blocking bugs
→ perf → memory → tech debt → regression coverage → World Coverage → active-phase sub-task → new
feature) this run picked up run 25's own recommendation as the next real work item.

**Decision:** New `src/3d/gameplay/animals.js`, matching `gameplay/npc.js`'s run-20 starting scope
exactly (static/idling only, no patrol/AI/name-tag yet — earn those in a later run the same way NPC
patrol/name-tags landed in runs 22/23, not all at once). `createWolf({assetLoader, modelUrl,
idleClipName, stripChildNames, worldX, worldZ, groundY, rotationYRadians, name})` loads the wolf via
`assetLoader.loadModel` (glTF/GLB, not FBX — a new `AssetLoader.loadModel` code path actually
exercised for the first time; every prior consumer used `loadFBXModel`). Two config/code findings
made along the way, not assumed:
- **`loadModel` never exposed animation clips.** `GLTFLoader` returns `gltf.animations` as a
  separate top-level array, not attached to `gltf.scene` — unlike `FBXLoader`, which already sets
  `object.animations` on the group it returns (why `npc.js` can already do
  `idleSource.animations[0]`). Nothing had needed a GLTF model's clips before this run (`loadModel`
  itself was unused prior to this change — confirmed via `grep`), so the gap was latent, not a
  regression. Fixed by one line in `assetLoader.js`: `gltf.scene.animations = gltf.animations;`
  before returning, mirroring `FBXLoader`'s own convention so `gameplay/animals.js` can use the
  identical `THREE.AnimationClip.findByName(model.animations, ...)` pattern regardless of loader.
- **The source file bundles a stray "Circle" mesh.** Inspecting the `.gltf` JSON sidecar (not
  guessed): `meshes[5].name === 'Circle'`, a flat, non-skinned disc at the scene root, sibling to
  the wolf's 5 real skinned meshes — almost certainly a Blender shadow-catcher plane left in the
  export. Left in, it would render as a stray flat disc near the wolf's feet on real terrain (the
  file has no camera/lighting setup of its own to hide it in, unlike wherever it was originally
  authored). `ANIMAL_CONFIG.STRIP_CHILD_NAMES` (`['Circle']`) + a new `stripNamedChildren` helper in
  `animals.js` removes any root child by name (disposing its geometry/material) before the model is
  added to the scene.

**Placement:** `ANIMAL_CONFIG.SPAWNS` — 2 wolves at `berkalp` (House Stark/Winterfell), offset 40m/
48m from the keep center, deliberately further out than `NPC_CONFIG`'s 12m NPC offset so a wolf
reads as roaming near the walls rather than standing in a guard's own spot. `berkalp` was picked
for a deliberate lore fit (the direwolf is House Stark's own sigil — Turkish `berkalp`'s in-game
`sigil` is 🐺 in `script.js`'s `INIT_KINGDOMS`), not an arbitrary seat choice, the same reasoning
ADR-0024 used for Jon Snow's distinct Night's Watch name-tag. No scale correction was needed or
applied — checked the `.gltf` JSON's accessor bounds first rather than assuming: the wolf's own
mesh bounds are ~1.32m (nose-to-tail) x ~0.57m (height), already a plausible real-world wolf size,
unlike Mixamo's FBX exports which need a ~0.01 centimeter-to-meter correction.

**Alternatives considered:** (a) patrol from the start, like ADR-0024 did for its 4 new NPCs — but
`gameplay/npc.js` itself proved out static-then-patrol as two separate runs (ADR-0019 then
ADR-0021), and this is animals' *first* run touching movement at all, not an established pattern
yet to extend; keeping this pass static-only mirrors that same incremental discipline rather than
skipping straight to the more complex behavior on an unproven new module. (b) a name-tag, like NPCs
get — rejected: wild animals don't have names in this game's fiction, a name-tag would be a
thematic mismatch, not just extra scope.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on all 4 touched/new source files (`config.js`, `assetLoader.js`,
  `game3d.js`, `gameplay/animals.js`); `service-worker.js` also checked.
- Full smoke test on both device classes (desktop full-preview, mobile-emulated
  `hasTouch/isMobile`): `"Spawned 2 FAZ 6 animal(s)."` on both, zero console/page errors, identical
  pre-existing chunk/settlement/NPC counts (444/25 chunks, 14 settlements, 10 NPCs) — confirming
  this change is additive-only.
- **A scene-graph + bone-animation check via a temporary debug hook** (`window.__debugGame3DState =
  state`, added only for this test and reverted before commit — confirmed via `git diff` showing
  zero net change to the committed `game3d.js`): both wolves loaded real `SkinnedMesh` geometry
  (zero `userData.isPlaceholder` fallbacks), the "Circle" child was confirmed absent from both
  (`stripNamedChildren` working), each exposed all 5 source animation clips via `.animations`, and a
  before/after bone-transform sample across all 49 skeleton bones over a 1.5s window found 31 bones
  with a real quaternion/position delta (chest, head, jaw, ears, eyelids, tail) — the idle clip is
  genuinely playing, not frozen on its first frame.

**Consequence:** FAZ 6 (Hayvanlar) has a first real slice — 2 wolves, static/idling, real rigged
geometry and animation. `assetLoader.loadModel`'s GLTF code path is now actually exercised by the
project for the first time (previously dead code). Negligible perf impact: +10 draw calls (2748
triangles/wolf × 2, excluding the stripped disc) against the desktop budget's existing ~453 draw
calls/~3.67M triangles — both budgets still comfortably clear. Real remaining FAZ 6 work, all
deliberately out of scope this pass: patrol/wander AI, the other 3 animal types the roadmap lists
(horses, carts, dogs/cats, birds — none downloaded yet, would need a human manual-download step per
`3D_GAME_PROGRESS.md`'s Known Issues), and player-awareness (flee/aggro). No new tech debt — this
pass fixed one latent gap (`loadModel`'s missing `.animations`) rather than adding one.

## ADR-0026: FAZ 6 wolves gain waypoint patrol, reusing NPC_CONFIG's proven `patrol` shape

**Context:** Run 26 landed 2 static/idling wolves and explicitly flagged patrol as the cheapest next
FAZ 6 slice: `gameplay/npc.js` already has a proven waypoint-patrol implementation (ADR-0021), the
wolf glTF's `02_walk_Armature_0` clip was already downloaded and confirmed present (via the `.gltf`
JSON sidecar) but unused, and no higher-priority syntax/blocking-bug/perf/memory issue was found in
this run's Session Snapshot (git state was clean this time — local `main` already matched
`origin/main` exactly, no detached-HEAD/stale-ref repair needed, unlike several prior runs).

**Decision:** Extended `gameplay/animals.js`'s `createWolf` with the same optional
`groundCollider`/`walkClipName`/`patrolWaypoints`/`speedMps`/`pauseSeconds`/
`turnRateRadiansPerSecond` parameters and straight-line-between-waypoints/idle-pause/turn-toward
update logic `gameplay/npc.js`'s `createNPC` already uses — copied rather than extracted into a
shared helper module. **Why duplicate instead of share:** the two call sites differ in loader
(`loadFBXModel` vs. `loadModel`), clip lookup (`mixer.clipAction(idleSource.animations[0])` for FBX
vs. `THREE.AnimationClip.findByName(model.animations, name)` for glTF), and NPC-only concerns
(name-tag sprites, Mixamo scale correction) — a shared helper would need to either take on those
differences as parameters (churning both files' signatures for a ~30-line body) or become an
awkward partial abstraction. `npc.js` is a stable, tested FAZ 5 system; touching it now to extract
shared logic would widen this run's blast radius into an unrelated, already-working phase for a
readability win, not a bug/perf fix — against this project's own "refactor only for bug/perf/
readability/architecture" rule read narrowly (a second, still-small consumer doesn't yet outweigh
the regression risk to a proven system). Revisit if a *third* consumer needs the same pattern.

`ANIMAL_CONFIG` gained `WALK_CLIP_NAME` (`02_walk_Armature_0`, confirmed via the `.gltf` JSON, not
guessed), `PATROL_SPEED_MPS` (2.2 — faster than `NPC_CONFIG`'s 1.4, a wolf's trot vs. a guard's
walk), `PATROL_PAUSE_SECONDS` (3, same as NPCs), `PATROL_TURN_RATE_RADIANS_PER_SECOND` (4, same as
NPCs — no reason to differ at this scope), and a `patrol` field on both `SPAWNS` entries: each walks
a 20m line, in a different spot and along a different axis from the other (`berkalp-wolf-1` east-
west, `berkalp-wolf-2` north-south) so their paths don't cross each other or overlap the guard NPCs'
own ±12m patrol zone at the same `berkalp` seat. `game3d.js`'s wolf-spawn block gained the same
`spawn.patrol` → `patrolWaypoints` resolution `NPC_CONFIG`'s own spawn loop already does (copied, not
shared, for the same reason above — the two loops build slightly different option objects for
`createWolf` vs. `createNPC`).

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on all 3 touched files (`config.js`, `game3d.js`, `gameplay/animals.js`).
- Full smoke test on both device classes: `"Spawned 2 FAZ 6 animal(s)."` on both, zero new console/
  page errors, all pre-existing counts (444/25 chunks, 14 settlements, 10 NPCs) unchanged.
- **A position-over-time check via a temporary debug hook** (`window.__debugGame3DState = state`,
  added only for this test and reverted before commit — confirmed via `git diff` showing zero net
  change to the committed `game3d.js`): both wolves moved 13.40m over an 8-second sample window
  (identical for both — expected, both use the same speed/pause constants), confirming patrol is
  genuinely driving position, not just switching animations in place.

**Consequence:** FAZ 6's first animal type now patrols instead of standing still. Negligible perf
impact — same 2 `SkinnedMesh`+`AnimationMixer` instances as run 26, just with one more clip
(`walkAction`) loaded per patrolling wolf; no new draw calls/triangles. Real remaining FAZ 6 work:
the other 3 animal types (horses, carts, dogs/cats, birds — none downloaded, human manual-download
step needed for each), and player-awareness (flee/aggro) for the wolf. No new tech debt — the
duplication-vs-shared-helper tradeoff above was made deliberately, not accidentally, and is
explicitly flagged for revisit at a third consumer.

## ADR-0027: Wolves flee from the player within 15m (first FAZ 6 player-awareness)

**Context:** Run 27 left "player-awareness (flee/aggro) for the wolf" as an explicit next-step
candidate, alongside FAZ 5's own still-open dialogue/player-awareness gap for NPCs. This run's
Session Snapshot found the git working tree already clean and in sync with `origin/main` (no
detached-HEAD repair needed this time) and no higher-priority syntax/blocking-bug/perf/memory issue,
so per the task's priority order this run picked up the flee slice — the smaller, better-scoped of
the two open player-awareness items (a wolf's flee reaction needs only a distance check + a movement
vector; an NPC dialogue system needs a whole new interaction/UI layer, out of proportion with one
atomic run).

**Decision:** `gameplay/animals.js`'s `createWolf` gained `fleeClipName`/`fleeTriggerRadiusMeters`/
`fleeSpeedMps` parameters and a distance check against a new `playerPosition` argument on
`update(delta, playerPosition)` (previously just `update(delta)` — the signature change is
contained to this module and its one caller, `game3d.js`'s animal-update loop). When the wolf is
within `fleeTriggerRadiusMeters` (15m) of the player, flee overrides idle/patrol entirely (checked
first, highest priority) and the wolf runs in a straight line directly away from the player's
current position at `fleeSpeedMps` (4.5, faster than the 2.2 patrol trot), playing
`FLEE_CLIP_NAME` (`01_Run_Armature_0`, confirmed via the `.gltf` JSON). No hysteresis/separate
"flee until this much safer" distance — once the wolf crosses back outside the trigger radius, flee
stops immediately and normal patrol/idle resumes from wherever the wolf ended up (no waypoint-index
reset needed, since patrol targets a fixed waypoint regardless of the wolf's current position). This
is a deliberate "smallest thing that earns flee" scope, the same discipline patrol itself used
(ADR-0021/ADR-0026) — no pathfinding, no fatigue/stamina, no herd behavior (the second wolf doesn't
react to the first one fleeing).

`game3d.js`'s tick loop was restructured slightly: `playerPos` (previously read only after the NPC/
animal update calls, for the camera-chase math) is now read once right after `player.update()` and
passed into each animal's `update()` — safe because `player.update()` already moved
`player.object3D` synchronously earlier in the same frame, so the read is current, not stale by a
frame. NPCs are unaffected — `npc.js`'s own `update(delta)` signature and call site are untouched,
matching this run's decision to scope player-awareness to the wolf only.

**Why straight-line-away instead of pathfinding-away-from-threat:** the terrain has no obstacles a
straight line would need to route around at this seat (a flat-ish rolling FBM field, per
`world/terrain.js`), and `world/settlements.js`'s castle geometry is 30-48m+ away from where these
wolves patrol — a real navmesh-based flee (avoiding walls, other terrain features) is disproportionate
scope for a first pass and would duplicate `camera.js`'s own raycasting machinery for a problem this
seat doesn't actually have yet. Revisit if a future seat places a wolf close enough to a wall that
this becomes a real visible bug (see Known Issues).

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on all 3 touched files (`config.js`, `game3d.js`, `gameplay/animals.js`).
- Full smoke test on both device classes (post-cleanup, debug hook removed): `"Spawned 2 FAZ 6
  animal(s)."` on both, zero console/page errors, all pre-existing counts unchanged.
- **A live proximity test via a temporary debug hook** (`window.__debugGame3DState = state`, added
  only for this test and reverted before commit — confirmed via `git diff` showing zero net change
  to the committed `game3d.js`): with the player far away, `berkalp-wolf-1` moved at its normal
  patrol rate (unchanged baseline). Teleporting the player to 5m from the wolf (well inside the 15m
  trigger) and sampling every 1.5s showed the distance-to-player climb from 6.51m → 15.38m within
  ~4.5s (the wolf fleeing away, roughly consistent with the 4.5 m/s config value given this
  sandbox's well-documented non-representative frame timing — see Known Issues), then the wolf
  settled just outside the 15m boundary (14.88-15.38m across further samples) once safe, confirming
  flee correctly starts on proximity and correctly stops once the trigger radius is cleared, with no
  runaway/oscillation loop.

**Consequence:** FAZ 6's wolf is now feature-complete at first-pass player-awareness scope: loads,
idles, patrols, and flees. Zero new draw calls/triangles (same 2 `SkinnedMesh` instances, one more
clip loaded). Real remaining FAZ 6 work: the other 3 animal types (still need human manual-download
steps) and any herd/pack reaction. FAZ 5's own player-awareness/dialogue gap for NPCs remains
untouched, a separate and larger scope. No new tech debt — the `update(delta, playerPosition)`
signature change is additive (an optional parameter) and contained to `animals.js`'s one caller.

## ADR-0028: Move FAZ 5/6 spawn-resolution wiring out of `game3d.js` into `npc.js`/`animals.js`

**Context:** Run 29's Session Snapshot re-checked every Golden Rule before picking up new work (per
the task's own priority order, tech debt ranks above a new feature) and found `src/3d/game3d.js` at
**610 lines — over the project's 600-line-per-file cap** (Golden Rule 7), a real, previously-uncaught
regression: no run's own self-review had re-measured `wc -l` against the cap since early on, and the
file crept past it gradually across runs 20-28 (each FAZ 5/6 spawn addition was individually small,
but cumulative). `git log`/`3D_GAME_PROGRESS.md` confirmed this was genuinely new information, not a
previously-flagged-and-deferred item. Per the task's priority order (tech debt above "active phase's
missing subtask" and "new feature"), fixing this took priority over starting any new FAZ 6 slice
outright — but see ADR-0029 below for why the herd-reaction feature was still done in the same run
after the fix created enough headroom.

**Decision:** Extracted `game3d.js`'s two largest inline blocks — the FAZ 5 NPC spawn-resolution loop
(seat lookup, patrol-waypoint construction, `createNPC` call, ~55 lines) and the FAZ 6 animal
equivalent (~46 lines) — into `gameplay/npc.js`'s new `spawnConfiguredNPCs({assetLoader, npcConfig,
seatsById, sampleGroundY, groundCollider})` and `gameplay/animals.js`'s new `spawnConfiguredAnimals`
(same shape), each returning the already-`Promise.all`'d, already-`.filter(Boolean)`'d array of
loaded controllers exactly as the inline code did. `game3d.js` keeps only the two setup values every
spawn needs (`seatsById`, `sampleClampedGroundY`, both shared across NPCs *and* animals, so they stay
in the orchestrator rather than being duplicated into both gameplay files) and now calls one function
per system instead of inlining the loop. No behavior change: same console warning on an unknown
`seatId`, same parallel loading, same returned controller shape. `game3d.js` dropped from 610 to 552
lines — back under the cap with headroom.

**Why into `npc.js`/`animals.js` rather than a new `gameplay/spawner.js`:** each system already owns
its own `create*` function and is the only consumer of its own spawn config shape (`NPC_CONFIG.
SPAWNS` vs. `ANIMAL_CONFIG.SPAWNS` are structurally similar but not identical, and diverge further
once `packAlertRadiusMeters` — ADR-0029 — is NPC-config-agnostic). A shared `spawner.js` would need
either a config-shape abstraction (premature — only 2 consumers) or per-system branching inside one
file, no simpler than what each file already had. Keeping `spawnConfigured*` next to its own `create*`
function matches this folder's existing "no cross-file coupling until a 3rd real consumer" convention
(see ADR-0026's own reasoning for the same call). `game3d.js` importing `spawnConfiguredNPCs`/
`spawnConfiguredAnimals` instead of `createNPC`/`createWolf` directly is the only import-surface
change.

**Verified:**
- `node --check` clean on all 4 touched JS files (`config.js`, `game3d.js`, `gameplay/npc.js`,
  `gameplay/animals.js`).
- `wc -l` re-confirmed every touched file is under the 600-line cap after the change: `game3d.js` 552,
  `config.js` 440, `gameplay/animals.js` 299 (includes ADR-0029's pack-flee addition below),
  `gameplay/npc.js` 260.
- Manual read-through confirms `spawnConfiguredNPCs`/`spawnConfiguredAnimals`'s bodies are a verbatim
  move of the prior inline code (same variable names, same order of operations, same config field
  reads) — not a rewrite, so the risk of an accidental behavior change from this refactor alone is
  effectively zero. A full headless-Chromium smoke test after both this and ADR-0029's change (see
  ADR-0029's own Verified section) confirms `"Spawned 10 FAZ 5 NPC(s)."` / `"Spawned 2 FAZ 6
  animal(s)."` unchanged from run 28.

**Consequence:** `game3d.js` is a thinner orchestrator now — it wires config + shared helpers into
each gameplay system's own spawn function rather than performing the spawn resolution itself, closer
to the target architecture's "system per folder" intent. `gameplay/README.md` updated with both new
functions' signatures. No new tech debt; this pass *reduces* it. Flagging for future runs: re-check
`wc -l` against the 600-line cap as part of every Session Snapshot from now on (not just when a file
"looks long"), so this doesn't silently recur — `config.js` (440) and `gameplay/animals.js` (299,
post-ADR-0029) both still have real headroom, but a future run adding a 4th animal type or a dialogue
system should watch both.

## ADR-0029: Wolves gain a first pack/herd reaction — packmate-triggered flee

**Context:** ADR-0027's own Consequence section explicitly left "herd/pack reaction (the second wolf
doesn't react to the first one fleeing)" as real, scoped-out remaining FAZ 6 work, repeated verbatim
in every run's "Next step" since run 28. With ADR-0028's extraction freeing up headroom under the
600-line cap on every touched file, and no other higher-priority syntax/blocking-bug/perf/memory-leak
issue found this run's Session Snapshot, this was the clear next atomic FAZ 6 slice — small, already
scoped by name in the progress file, and directly reuses run 28's own proven flee mechanics rather
than introducing a new movement system.

**Decision:** `createWolf` gained an optional `packAlertRadiusMeters` parameter and its returned
controller gained a read-only `isFleeing` getter (backed by a new `currentlyFleeing` closure
variable, written once per `update()` call). `update()`'s signature grew a third optional argument,
`packmateFleePositions` — an array of `{x, z}` positions the caller collects from every *other*
animal's `isFleeing` getter. Each frame, a wolf not already triggered by its own
`fleeTriggerRadiusMeters` check now also flees if any position in `packmateFleePositions` is within
`packAlertRadiusMeters` (20m, config'd in `ANIMAL_CONFIG`) of its own position. Critically, the flee
*direction* is always computed away from the player, never away from the alerting packmate — a
pack-alerted wolf is reacting to "the same threat my packmate is fleeing," not to the packmate itself,
so reusing the existing player-relative direction math (unchanged from ADR-0027) was both the
simplest implementation and the more plausible in-fiction behavior. The pack check is skipped
entirely when `playerPosition` is falsy (defensive — the direction math needs it regardless of which
branch triggered flee; without this guard a pack-triggered flee with no known player position would
divide by `Infinity` and produce a `NaN` velocity).

`game3d.js`'s tick loop now builds each animal's `packmateFleePositions` immediately before calling
its `update()`, by filtering `state.animals` for every other entry's `isFleeing` getter. This is
O(n²) per frame over `state.animals` and deliberately sequential (not a separate pre-pass) — an
animal processed later in the array sees its earlier packmates' *this-frame* fleeing state, while one
processed earlier still sees only last frame's state for animals not yet updated. This asymmetry is
harmless at today's 2-wolf count (both directions converge within the same or next frame) and was
chosen over a two-pass "compute all flee states, then move everyone" structure because it needed no
new per-frame array allocation beyond the small `.filter().map()` already required, and no wolf's
own movement decision depends on a *precise* single-frame-accurate packmate state — a one-frame lag
in a herd-alert reaction is imperceptible and not a correctness bug the way it would be for, e.g.,
`game3d.js`'s own player-vs-camera positional math.

**Why player-relative direction, not away-from-packmate or averaged:** an away-from-packmate vector
would send a pack-alerted wolf running *toward* the actual threat if the packmate happened to be
between it and the player — the opposite of the intended behavior. An averaged "away from the nearest
threat-or-alerting-packmate" vector was considered and rejected as unearned complexity for a
first-pass reaction with only 2 wolves ever tested together; revisit if/when the animal count grows
enough that pack members regularly end up on the far side of an alerting packmate from the player.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on all 4 touched JS files.
- Full smoke test on both device classes: `"Spawned 2 FAZ 6 animal(s)."` on both, zero console/page
  errors, `"Spawned 10 FAZ 5 NPC(s)."` and all terrain/settlement counts byte-identical to run 28 —
  confirms ADR-0028's refactor and this ADR's new parameter are both behavior-preserving for every
  path that doesn't touch pack-alert.
- **A live pack-trigger test via a temporary debug hook** (`window.__debugGame3DState = state`,
  reverted before commit — confirmed via `git diff` showing zero net change to the committed
  `game3d.js`): teleported the player to within `berkalp-wolf-1`'s 15m flee-trigger radius only
  (`berkalp-wolf-2` left at its normal patrol distance, >20m from wolf-1 at that moment). Sampled
  every 1.5s: wolf-1 fled immediately (distance-to-player climbing, matching ADR-0027's own
  baseline); wolf-2's `isFleeing` flipped `true` and its own distance-to-wolf-1 stayed inside the 20m
  `packAlertRadiusMeters` band during the window it reacted, confirming the pack trigger fires only
  once the two wolves are actually close enough, not unconditionally the instant either one flees.
  A second sample with the player instead placed near wolf-2 (not wolf-1) confirmed the symmetric
  case — wolf-1 pack-flees off wolf-2's direct trigger — ruling out an accidental one-directional
  bug from the array-filter's iteration order.

**Consequence:** FAZ 6's wolves are now feature-complete at first-pass pack-awareness scope: they
load, idle, patrol, flee from the player directly, and flee from a nearby fleeing packmate. Real
remaining FAZ 6 work, narrowed but not closed: the other 3 animal types (horses, carts, dogs/cats,
birds — still need a human manual-download step each) and the current pack-alert scope is 2-wolf-only
tested (no test exists yet for 3+ animals reacting in a chain, since only 2 wolves are spawned
anywhere in `ANIMAL_CONFIG.SPAWNS`) — a future run adding a 3rd wolf/animal to the same seat should
re-verify chained pack-alert propagation, not assume it "just works" from this ADR's 2-wolf test
alone. FAZ 5's own player/pack-awareness gap for NPCs remains untouched (guards still don't
flee/alert). No new tech debt — `packAlertRadiusMeters`/`packmateFleePositions` are both optional,
additive parameters; every existing call site without them (there are none left, since
`spawnConfiguredAnimals` now always passes `ANIMAL_CONFIG.PACK_ALERT_RADIUS_METERS`) would still work
unchanged if a future spawn omitted it.

## ADR-0030: Third wolf at `berkalp` — verifies chained (3-hop) pack-alert propagation

**Context:** ADR-0029's own Consequence section explicitly left "the current pack-alert scope is
2-wolf-only tested (no test exists yet for 3+ animals reacting in a chain)" as real, scoped-out
follow-up work, repeated in every run's "Next step" since run 29. `game3d.js`'s tick loop already
builds each animal's `packmateFleePositions` generically from *every other* `state.animals` entry's
`isFleeing` getter (`state.animals.filter((other) => other !== animal && other.isFleeing)`, added by
ADR-0029) — nothing in that loop or in `createWolf`/`update()` assumes exactly 2 animals. This meant
the flagged gap could be closed as a config-only change (no code edit at all), the clear next atomic
FAZ 6 slice: no other higher-priority syntax/blocking-bug/perf/memory-leak/tech-debt issue was found
this run's Session Snapshot (`node --check` clean on every file, no file over the 600-line cap,
desktop/mobile smoke tests byte-identical to run 29's own numbers).

**Decision:** Added `berkalp-wolf-3` to `ANIMAL_CONFIG.SPAWNS`, reusing the same already-downloaded
`WOLF_MODEL_URL` (no new asset, no human manual-download step needed). Positioned at offset
`(56, -6)`, patrolling to `(56, -26)` — deliberately chosen so it sits ~14.4m from `berkalp-wolf-2`
(inside `PACK_ALERT_RADIUS_METERS`, 20m) but ~28.8m from `berkalp-wolf-1` (outside it), so a real
3-hop chain (wolf-1 flees the player -> wolf-2 pack-flees off wolf-1 -> wolf-3 pack-flees off wolf-2,
one frame later, per ADR-0029's own documented one-frame-lag asymmetry) is the *only* path that can
ever bring wolf-3 into `isFleeing`. The new patrol line (`x=56`, `z` from -6 to -26) was checked
against both existing wolves' lines and the `berkalp` guard NPCs' own ±12m patrol zone for overlap —
none found.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on `config.js` (the only touched file besides docs).
- Full smoke test on both device classes: `"Spawned 3 FAZ 6 animal(s)."` on both (up from 2), zero
  console/page errors, every terrain/settlement/NPC count byte-identical to run 29
  (`"...444 terrain chunks resident (~111.00 km²)..."` desktop, `"...25 terrain chunks
  resident...(~6.25 km²)..."` mobile, `"Spawned 10 FAZ 5 NPC(s)."` both) — confirms the new spawn is
  additive only, nothing else regressed.
- **A direct-call unit-style chain test** via a temporary debug hook (`window.__debugGame3DState =
  state`, reverted before commit — confirmed via `git diff` showing zero net change to the committed
  `game3d.js`), calling all three wolves' `update(delta, playerPosition, packmateFleePositions)`
  directly with controlled synthetic arguments across 3 successive simulated frames, mirroring
  exactly how `game3d.js`'s real tick loop builds each frame's `packmateFleePositions`:
  1. Baseline (player 5000m away, no packmate positions): all three `isFleeing === false`.
  2. Distance check confirmed the live fixture's real spawn-time distances matched the config
     comment's math: wolf1↔wolf2 ≈14.42m, wolf2↔wolf3 ≈14.42m, wolf1↔wolf3 ≈28.84m.
  3. Frame 1 (player placed ~1.4m from wolf-1, empty `packmateFleePositions` for everyone — nobody
     has fled yet this frame): wolf-1 `isFleeing → true` (direct trigger); wolf-3 stayed `false`.
     Wolf-2 also read `true` this frame — not via the pack path, but because at this spacing
     (14.4m apart) the same player position that triggers wolf-1 directly is coincidentally also
     within wolf-2's own independent 15m direct-trigger radius; a real, harmless overlap of the two
     wolves' spacing, not a pack-logic bug (confirmed by inspecting `update()`'s direct-trigger term
     in isolation).
  4. Frame 2 (wolf-2 now given wolf-1's actual post-frame-1 position as its packmate list; wolf-3
     still given nothing): wolf-3 stayed `false` — confirms wolf-3 does not react merely because
     *some* animal somewhere is fleeing; it needs its own in-range packmate to actually flag
     fleeing first.
  5. Frame 3 (wolf-3 now given wolf-2's actual post-frame-2 position): wolf-3 `isFleeing → true` —
     the 3-hop chain completes exactly one frame after wolf-2's own pack-flee, matching ADR-0029's
     documented one-frame propagation lag.
  6. **Negative control:** re-ran frame 3's exact setup but handed wolf-3 wolf-1's position (≈28.8m,
     outside its 20m radius) instead of wolf-2's — wolf-3 stayed `false`, ruling out a bug where any
     array entry (regardless of distance) would trigger the flee.
  - Zero console/page errors during the entire test.

**Consequence:** The pack-alert mechanism is now verified to genuinely chain across 3+ animals, not
just directly-adjacent pairs — closing the exact gap ADR-0029 flagged. Desktop draw calls grow from
~463 to ~468 (18.7% of the 2500 budget), triangles from ~3.676M to ~3.679M (73.6% of the 5M budget);
mobile triangles grow from ~212,816 to ~215,564 (43.1% of the 500K budget) — both negligible, no
budget concern. No new tech debt: `berkalp-wolf-3` follows the exact same `SPAWNS` shape every other
wolf/NPC entry uses, consumed generically by the existing `spawnConfiguredAnimals`/tick-loop code
with no special-casing. Real remaining FAZ 6 work, unchanged by this run: the other 3 animal types
(horses, carts, dogs/cats, birds) still need a human manual-download step each; FAZ 5's own
player/pack-awareness gap for NPCs remains untouched.

## ADR-0031: 11th NPC at `Xaro` (Qarth) — first NPC at a house not yet represented

**Context:** ADR-0024's own Consequence/"Why not all remaining 9 seats" section left `berk`, `olena`,
`twin`, and `Xaro` as real, scoped-out remaining FAZ 5 candidates (`Night King` deliberately excluded
outright — a special antagonist entity, not a normal kingdom seat). With run 30's FAZ 6 pack-alert
chain verification closing that phase's one flagged gap, and no other higher-priority syntax/
blocking-bug/perf/memory-leak/tech-debt issue found this run's Session Snapshot (`node --check`
clean, no file over the 600-line cap, both device-class smoke tests byte-identical to run 30's own
numbers), the next-cheapest open item was FAZ 5's own remaining kingdom-seat gap — the same category
of work ADR-0024 already established a proven, low-risk pattern for.

**Decision:** Added one new `NPC_CONFIG.SPAWNS` entry, `xaro-guard-1`, at the `Xaro` (Qarth) kingdom
seat — reusing `dreyar.fbx` (already downloaded, already placed once at `umit`, already precached in
`service-worker.js`), needing **zero new asset files and zero code changes**: `game3d.js`'s
`spawnConfiguredNPCs` (moved there from `game3d.js` itself by ADR-0028) already handles any number of
`SPAWNS` entries generically. Chose `Xaro` over `berk`/`olena`/`twin` for house diversity, matching
ADR-0024's own stated reasoning: `berk`/`olena` are both Tyrell (already represented via `ziya`) and
`twin` is a second Lannister (already represented via `cersei`), while `Xaro`/Qarth is a house with
zero existing NPC presence. Offset/patrol/rotation follow the exact same shape every other single-NPC
seat uses (`offsetXMeters: 12, offsetZMeters: 12`, patrol to `(12, -12)`, `rotationYRadians: Math.PI`)
— no new geometry pattern introduced.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on `config.js` (the only touched file besides docs).
- Full smoke test on both device classes: `"Spawned 11 FAZ 5 NPC(s)."` (up from 10), zero
  console/page errors, every other count (terrain chunks, settlements, animals, river/waterfalls)
  byte-identical to run 30 — confirms the new spawn is additive only.

**Consequence:** 10 of 14 kingdom seats now have at least one NPC (11 NPCs total); `berk`, `olena`,
and `twin` remain the only real candidates without one (`Night King` stays deliberately excluded).
A further seat still needs either a second NPC reusing an already-placed model (lower value now that
all 6 downloaded characters are placed at least once, several twice) or a new Mixamo/Free3D download
(human manual-download step, per every prior ADR's same constraint). No new tech debt — `xaro-guard-1`
is a plain `SPAWNS` entry, the same shape every other single-NPC seat already uses. FAZ 5's other two
real gaps (a dialogue/interaction system; player/pack-awareness for NPCs) remain untouched by this run.

## ADR-0032: FAZ 5 first-pass interaction affordance — proximity prompt only, no dialogue yet

**Context:** FAZ 5's own Known Issues entry has flagged "no dialogue/interaction system (clicking/
approaching an NPC does nothing beyond seeing its tag)" since run 20, repeated in every subsequent
run's "Next step." With run 31's kingdom-seat NPC gap narrowed and no other higher-priority syntax/
blocking-bug/perf/memory-leak/tech-debt issue found this run's Session Snapshot, this was the next
real FAZ 5 item. A full dialogue system (branching content, per-NPC lines, a UI panel) is
substantial, multi-decision work — not a single atomic, reviewable slice. Deliberately scoped this
run down to the smallest real step: the player-facing *affordance* that something is interactable,
with no actual interaction logic behind it yet (no keypress handling, no dialogue content, no
per-NPC identity). This mirrors how `ui/touchJoystick.js` (FAZ 4) and `gameplay/npc.js`'s name tags
(FAZ 5, ADR-0022) were each shipped as one focused capability rather than a whole system at once.

**Decision:** Added `INTERACTION_CONFIG` (`config.js`, one constant: `PROMPT_RADIUS_METERS: 6`,
tighter than `NPC_CONFIG`'s 12m keep-clearance offset — a "standing right next to them" cue) and a
new `ui/interactionPrompt.js` module, `InteractionPrompt`, following `ui/touchJoystick.js`'s exact
DOM-ownership pattern (own `<div>`, own CSS class, own `dispose()`). Unlike `TouchJoystick`,
`InteractionPrompt` is instantiated unconditionally (`game3d.js`'s `initGame3D()`, alongside the
player) — relevant on every device class, not gated by `isCoarsePointerDevice()`. `game3d.js`'s tick
loop computes, once per frame right after `playerPos` is read, whether the player is within
`PROMPT_RADIUS_METERS` of *any* `state.npcs` entry (a plain `.some()` over the existing array, no
new per-frame allocation beyond what the pack-alert loop already does two lines below) and calls
`setVisible()` with the result; `InteractionPrompt.setVisible()` no-ops when the value hasn't
changed, avoiding a redundant DOM write every frame. The prompt shows the same static text
("E - Selamla") regardless of which NPC (or how many) triggered it — no per-NPC branching, since
there's no dialogue content yet to differentiate by. Registered in `service-worker.js`'s
`GAME3D_SHELL_FILES` alongside every other currently-imported 3D module.

**Why not wire an actual "E" keypress yet:** a keypress with no dialogue content to open would just
be dead input-handling code with nothing to verify against — the affordance (visual cue) is the
complete, independently valuable, and independently testable unit; the keypress+content step is a
separate future decision (what should the dialogue system's data shape even look like — deserves its
own ADR, not bundled in here as an afterthought).

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on all 4 touched JS files (`config.js`, `game3d.js`, `interactionPrompt.js`,
  `service-worker.js`); no file over the 600-line cap (`game3d.js` now 564 lines).
- Full smoke test on both device classes: zero console/page errors, every existing count
  (terrain/settlements/NPCs/animals/river/waterfalls) byte-identical to run 31's own numbers —
  confirms this is purely additive.
- **A direct-manipulation DOM test** via a temporary debug hook (`window.__debugGame3DState = state`,
  reverted before commit — confirmed via `git diff` showing zero net change to the committed
  `game3d.js`): confirmed `.g3d-interaction-prompt` exists in the DOM with the `hidden` attribute set
  by default; teleported the player 500m from every NPC and ran the exact same any-NPC-within-radius
  computation `game3d.js`'s tick loop uses — the element's `hidden` attribute stayed present; then
  teleported the player to 2m from an NPC and re-ran it — `hidden` was removed. Both transitions
  verified against the real DOM element, not just the boolean math in isolation.

**Consequence:** FAZ 5 now has a visible "something's here" cue, closing half of the flagged
dialogue/interaction gap — the other half (actual interaction logic and content) remains real,
open, and *not* pretended to be solved by this prompt alone. No new tech debt: `InteractionPrompt`
follows `TouchJoystick`'s proven shape exactly, and the tick-loop distance check is the same
`.some()`/`Math.hypot` pattern already used one function away for animal flee triggers. Desktop/
mobile draw calls and triangles are unaffected (a DOM element, not a Three.js mesh). Real remaining
FAZ 5 work: the actual dialogue system (content + keypress handling) and NPC player/pack-awareness;
3 kingdom seats (`berk`, `olena`, `twin`) still lack any NPC.

## ADR-0033: FAZ 5 dialogue open/close — "E" opens a generic greeting, walking away auto-closes it

**Context:** ADR-0032's proximity prompt closed half of FAZ 5's long-flagged "no dialogue/interaction
system" gap — the affordance that something is interactable — but explicitly left the other half
open: no keypress opens anything, no content exists behind the cue. With no higher-priority syntax/
blocking-bug/perf/memory-leak/tech-debt issue found this run's Session Snapshot, and the kingdom-seat
NPC gap (run 31) and FAZ 6 pack-alert gap (run 30) both already closed, this was the natural next
FAZ 5 slice: wire the actual keypress, still deliberately short of a *real* dialogue system (no
branching, no per-NPC personality/content, no reply options — those need real dialogue-writing, a
separate future decision this run doesn't make on the project owner's behalf).

**Decision:**
- `gameplay/npc.js`'s `createNPC` return object gained a `displayName` field (the value it already
  received as a constructor option, previously only used internally to build the name-tag sprite) —
  a minimal, backward-compatible addition so callers can address an NPC by name without a separate
  lookup back into `NPC_CONFIG.SPAWNS`.
- New `ui/dialogueBox.js` (`DialogueBox`), following `ui/touchJoystick.js`/`ui/interactionPrompt.js`'s
  exact DOM-ownership pattern: one `<div>` with a text line and a static "E / Esc - Kapat" hint,
  `show(text)`/`hide()`/`dispose()`.
- `config.js`'s `INTERACTION_CONFIG` gained `GREETING_TEMPLATE` — one generic line with a literal
  `{name}` placeholder, the same text for every NPC (no per-character content yet).
- **New `gameplay/interaction.js`** (`createInteractionController`) — owns the actual state machine:
  nearest-in-range-NPC tracking, `KeyE` open/close toggle, `Escape` close, and *distance-based
  auto-close* (if the player or the NPC moves far enough apart that the previously-active NPC is no
  longer the nearest in-range one, the dialogue closes on its own next frame, rather than leaving a
  stale box open with no one nearby). This was extracted into its own module rather than inlined in
  `game3d.js` — the inline version pushed `game3d.js` to 615 lines, over the project's 600-line cap;
  extracting it (same reasoning ADR-0028 used for spawn-resolution loops) brought it back to 574.
  `game3d.js` now only instantiates the controller, forwards `keydown` events to it, and calls one
  `update(npcs, playerPos)` per tick.
- `event.repeat` is checked first in `handleKeyDown` — without it, holding "E" down would rapid-fire
  open/close on every OS key-repeat interval instead of toggling once per physical press.

**Verified via headless Chromium (Playwright), not assumed correct from the code alone:**
- `node --check` clean on all 6 touched/new files; no file over the 600-line cap (`game3d.js` 574,
  down from an intermediate 615 before the `gameplay/interaction.js` extraction — caught by this
  run's own `wc -l` re-check, the standing checklist item run 29 established).
- Full smoke test on both device classes: zero console/page errors, every existing count
  (terrain/settlements/NPCs/animals/river/waterfalls) byte-identical to run 32's own numbers.
- **A real-keyboard-event test** via a temporary debug hook (`window.__debugGame3DState = state`,
  reverted before commit — confirmed via `git diff` showing zero net change to the committed
  `game3d.js`): teleported the player next to an NPC and drove `page.keyboard.press('KeyE')` (a real
  synthesized keyboard event, not a direct function call) through 5 steps — open, close, open,
  Escape-close, reopen — confirming the toggle and the DOM text (`"{displayName}: ..."`) at each
  step. Also confirmed via a captured real-event log that `event.repeat` was `false` for every
  distinct press (ruling out an OS-level repeat-flag misread) and, via a synthetic `repeat: true`
  call, that a simulated held-key repeat is correctly ignored.
- **A false alarm worth recording:** an earlier version of the same 5-step test (without re-
  teleporting the player before each step) intermittently showed the final "reopen" step failing.
  Debug logging traced this to the *real* auto-close path firing correctly — the target NPC
  (`stannis-guard-1`) patrols on a fixed route and, over the test's real elapsed wall-clock time,
  walked far enough from the stationary test player to fall outside `PROMPT_RADIUS_METERS` (6m) on
  its own, independent of anything the player did. Re-running with the player re-teleported next to
  the NPC's *current* position before each step (removing patrol drift as a confound) reproduced the
  correct toggle every time. This is correct, intentional behavior (a conversation should end if the
  person you're talking to walks away), not a bug — recorded here so a future run re-investigating a
  similar "sometimes E doesn't reopen it" report starts from this explanation instead of re-deriving
  it from scratch.

**Consequence:** FAZ 5 now has an actual open/close interaction loop, though still content-free (one
static line, no branching, no replies) — a real dialogue *system* (per-NPC content, options, a data
shape for future quest hooks) remains open, separate, future work, not something this run pretends
to have solved. No new tech debt: the extraction into `gameplay/interaction.js` *reduces* coupling
(the same reasoning ADR-0028 already established), and `displayName` on the NPC controller is a
plain additive field no existing caller needs to change for. Real remaining FAZ 5 work: actual
dialogue content/branching, 3 kingdom seats still without any NPC (`berk`, `olena`, `twin`), and
player/pack-awareness for NPCs (still needs its own design reconsideration per run 32's note).

## ADR-0034: `scripts/checkAssetsManifest.js` — automated `assets_manifest.json` vs. `assets/` consistency check

**Status:** Accepted (run 34).

**Context:** `3D_GAME_PROGRESS.md`'s Known Issues had flagged since early on that
`assets_manifest.json` is hand-maintained with "no automated check that it matches `assets/`." At
12 manifest entries / 32 real files this was low risk, but the note itself said to flag it as real
tech debt once the asset count grows — and per this run's priority order (technical debt ranks
above missing-coverage and new-feature work when nothing higher-priority is open), this was the
correct next atomic subtask: no syntax errors, no blocking bugs, budgets/coverage all unchanged and
healthy, no memory leak found.

**Decision:** Added `scripts/checkAssetsManifest.js`, a small dependency-free Node script (plain
`fs`, no npm install needed) that:
1. **Hard-fails** if any manifest entry's `file` path doesn't exist on disk (typo'd path / entry
   for an asset that was never actually added).
2. **Hard-fails** if any `.fbx`/`.glb` file on disk (the two formats this project's code actually
   loads — see `assetLoader.js`'s `loadFBXModel`/`loadModel`) isn't referenced by any manifest
   entry (an asset dropped in without its source/license ever being recorded).
3. **Soft-warns** (does not fail) on any other unreferenced file under `assets/` — texture/sidecar
   files (`.png`/`.jpg`/`.jpeg`) and glTF's `.bin` buffer routinely ship alongside a registered
   primary model file without needing their own manifest entry, and are expected to appear here.

**Alternatives considered:**
- *Hard-fail on every unregistered file, no soft-warning tier* — rejected: would force every wolf/
  dragon texture PNG (20 files today) into the manifest as a fake individual "asset" with no
  source info beyond "ships inside the model's already-registered zip," adding noise without adding
  real license-tracking value.
- *Only check manifest-file→disk existence, skip the disk→manifest direction* — rejected: catches
  fewer real mistakes. The actual regression this is meant to prevent is a *new* asset landing in
  `assets/` (e.g. a future manual Mixamo/Free3D download) without a human remembering to also add
  its manifest entry — that's a disk→manifest gap, not a manifest→disk one.
- *A `.gltf` companion to the manifest (declarative allowlist of expected sidecar files)* —
  rejected as speculative: the soft-warning tier already reports the exact same information without
  needing a second file to keep in sync.

**Verified:** `node --check scripts/checkAssetsManifest.js` passes. Ran clean against the real
repo state (exit 0, 12/12 manifest entries resolve, all `.fbx`/`.glb` files on disk registered, 20
expected sidecar files listed as warnings). Both hard-fail paths independently verified against a
temporary copy of the manifest / a temporary dummy file (restored before commit, confirmed via
`git status --short` showing no unintended tracked-file changes): a manifest entry pointed at a
nonexistent path correctly exits 1 and lists it; an unregistered `.fbx` dropped into
`assets/models/characters/` correctly exits 1 and lists it as unregistered. Script is 129 lines,
well under the 600-line-per-file cap.

**Consequence:** Future runs (or the project owner) can run
`node scripts/checkAssetsManifest.js` after adding/removing any asset file or manifest entry and
get an immediate, precise answer instead of a manual `diff`-by-eye. Not wired into any CI/git-hook
yet (no CI pipeline or package.json exists in this repo — see the "no npm/build step" project
convention noted throughout `3D_GAME_PROGRESS.md`'s Asset Sources table); running it is a manual
step for now. A future run could add a lightweight pre-commit hook if that friction becomes real,
but that would be speculative today with only one contributor pattern (manual asset drops) actually
exercising this path.

## ADR-0035: `scripts/smokeTestGame3D.js` — a persisted, committed regression-guard smoke test

**Status:** Accepted (run 34, second chained sub-task).

**Context:** Every prior run (per this file's "This Run" sections back to at least run 5) performed
its Regression Guard smoke test by writing a one-off Playwright script inline, running it, and
discarding it — the check itself was never committed. This matches this run's priority-order
category 6 (missing smoke-test/regression coverage), correctly ranking below any open syntax
error/blocking bug/perf overrun/memory leak/technical-debt item (none were found — see run 34's
first sub-task, ADR-0034 — before this was picked up as the next one).

**Decision:** Added `scripts/smokeTestGame3D.js` (dependency-free beyond Playwright itself, which
is dev-only tooling, consistent with ADR-0034's precedent — this repo has no `package.json` by
design). It starts a local static file server over the repo root (plain Node `http`, no external
network), then in headless Chromium:
1. Loads `game3d.html` and waits for `#game3d-loading` to gain the `g3d-loading-hidden` class — the
   exact DOM signal `game3d.html`'s own inline script already sets on `EVENTS.GAME_READY`'s
   `phase1-scene` (or `g3d-loading-error` on `EVENTS.GAME_ERROR`). This is the real gate: any
   uncaught page exception, `console.error`, error-class outcome, or timeout fails the whole run
   (exit 1).
2. Loads `index.html` (2D shell) and reports console/page errors for visibility, but does **not**
   fail on them — see "Investigation" below for why.

**Investigation (why the 2D check is non-blocking):** A direct Playwright trace (`page.on('console'
/'requestfailed'/'response')`, run manually before deciding the design) showed every console error
this sandbox produces on `index.html` traces to one of two causes, neither a code regression:
- External CDN requests (`gstatic.com`, `cdnjs.cloudflare.com`, `fonts.googleapis.com`) failing with
  `net::ERR_CONNECTION_RESET` — this sandbox's own outbound-network restriction — which cascades
  into `firebase is not defined` once the (never-loaded) Firebase SDK script is referenced.
- 404s for `resimler/*.png` and `videolar/*.mp4` — confirmed via `ls resimler/` → "No such file or
  directory": these paths do not exist anywhere in this git checkout, a pre-existing gap predating
  every 3D-mode run and outside this initiative's scope (Golden Rule #1: preserve, don't fix, the
  2D game; the 2D game is untouched by any 3D-mode commit).

Hard-failing on either would make the check permanently red in this sandbox regardless of actual
code correctness — the opposite of a useful regression guard, and exactly the "cries wolf" failure
mode that trains future runs to ignore it. Only a failed navigation (`index.html` itself not
loading, or an empty `<title>`) counts against the 2D check.

**Alternatives considered:**
- *Fail the whole script on any 2D console error* — rejected per the Investigation above: produces
  a permanently-failing check in this sandbox, unrelated to any actual regression risk.
- *Allowlist specific error-message substrings for the 2D check instead of making it fully
  non-blocking* — considered, but the two root causes (external-CDN network policy, missing local
  media directories) are both entirely orthogonal to anything a 3D-mode code change could affect,
  and both are already independently documented in `3D_GAME_PROGRESS.md`'s Known Issues from prior
  runs' own manual investigations. A substring allowlist would be strictly more code for the same
  practical guarantee, and would silently need updating if the 2D game's own (out-of-scope)
  external-dependency list ever changes. Revisit only if this smoke test is ever asked to *also*
  gate 2D-game regressions specifically — not this project's stated goal.
- *Skip the 2D check entirely* — rejected: still valuable as a fast crash/navigation-failure guard
  (Golden Rule #1, "preserve the existing 2D game") even without asserting on console noise.

**Verified:** `node --check scripts/smokeTestGame3D.js` passes (220 lines, under the 600-line cap).
Ran clean against the real repo: both checks report PASS, exit 0. **Failure-path verified with a
real injected bug**, not just reasoning: temporarily added `throw new Error(...)` as the first line
inside `initGame3D()`'s `try` block, ran the script — correctly reported `FAIL` for the 3D-mode
check with the exact injected error text and stack trace, exit code 1. Restored `game3d.js`
immediately after, confirmed via `diff` against a pre-edit backup copy that the restore was
byte-identical (also visible in the final `git status`/`git diff --stat` showing zero net change to
that file). Requires Playwright's Chromium; gracefully exits 2 (not a stack trace) with install
guidance if unavailable, tried both a plain `require('playwright')` and a fallback global-install
path.

**Consequence:** Future runs get one command (`node scripts/smokeTestGame3D.js`) that replaces
writing a fresh ad-hoc Playwright script every time, with a real, demonstrated-working failure path
for the 3D mode specifically. Not wired into CI (none exists in this repo, same as ADR-0034) — a
manual step for now. The 2D shell's own real regression coverage remains exactly what it was before
this script (a human/future-run visual check plus this script's crash/navigation guard) — deep 2D
interaction testing (clicking "OYNAT", etc.) is still blocked by this sandbox's network restrictions
and remains explicitly out of scope, same as every prior run's note on this.

## ADR-0036: FAZ 5 NPCs at the last 3 real kingdom seats (`berk`/`olena`/`twin`)

**Status:** Accepted (run 34, third chained sub-task).

**Context:** With both this run's technical-debt (ADR-0034) and missing-coverage (ADR-0035) items
paid down, a fresh priority-order scan again found no syntax error/blocking bug/perf overrun/memory
leak/tech debt open, so priority 8 (missing subtask of the active phase) was next. FAZ 5's own
Known Issues named exactly one remaining mechanical (non-content-decision) gap: 3 of 14 real
kingdom seats — `berk`, `olena`, `twin` (`Night King` is separately, deliberately excluded per
ADR-0024) — still had zero NPCs.

**Decision:** Added 3 entries to `config.js`'s `NPC_CONFIG.SPAWNS` — `berk-guard-1`
(`paladin_j_nordstrom.fbx`), `olena-guard-1` (`arissa.fbx`), `twin-guard-1`
(`paladin_wprop_j_nordstrom.fbx`) — all 3 reusing already-downloaded/precached models (no new asset
download), same offset/rotation/patrol-geometry shape every other `SPAWNS` entry already uses (see
ADR-0021/ADR-0023's proven wall-clearance math), and `game3d.js`/`gameplay/npc.js`'s existing
generic spawn-resolution loop (`spawnConfiguredNPCs`, ADR-0028) requiring zero code change — purely
additive config. `berk`/`olena` are both House Tyrell (already represented at `ziya`) and `twin` is
House Lannister (already represented at `cersei`) — the last available *new* house was already used
by run 31's `Xaro` addition, so this is explicitly the "lower value than a new house, but still real
coverage" option ADR-0031/run 33's notes already flagged as the only remaining option short of a
human manual-download step. Reused each seat's house's existing guard displayName ("Tyrell
Muhafızı"/"Lannister Muhafızı") rather than inventing a numbering scheme — precedent (`jon`'s
distinct "Duvar Muhafızı") is reserved for a *thematically* distinct seat, not merely a repeated
house, and multiple guards sharing one generic title across different locations reads naturally
(an army routinely has more than one soldier with the same rank/title).

**Alternatives considered:**
- *Invent a numbering convention (`Tyrell Muhafızı II`/`III`) across different seats* — rejected:
  the existing "I"/"II" convention (`stannis-guard-1`/`stannis-guard-2`) was established specifically
  for two guards at the *same* seat; extending it across different seats would require retroactively
  renaming `ziya-guard-1`'s already-stable, previously-tested entry to "I" for consistency, an
  unnecessary risk to a working entry for a cosmetic reason.
- *Wait for a human manual-download step to give these seats a visually distinct model instead* —
  rejected as unnecessarily blocking: nothing about the last-3-seats gap actually requires a new
  asset (unlike a genuinely new house or animal type would), and the existing 6 character models are
  already reused 2-3 times each elsewhere with no reported issue.

**Verified:** `node --check src/3d/config.js` passes (520 lines, under the 600-line cap).
`node scripts/checkAssetsManifest.js` still exits 0 (no new asset files were added, nothing to
register). `node scripts/smokeTestGame3D.js` (ADR-0035, run this same session) passes both before
and after this change — the 3D-mode check specifically asserts zero `console.error`, and
`assetLoader.js`'s FBX-load fallback path always logs a `console.error` on any load failure before
substituting a placeholder box, so a clean pass is direct evidence all 3 new NPC model references
resolved successfully, not merely that nothing crashed.

**Consequence:** 13 of 14 real kingdom seats now have at least one NPC (`Night King` remains the one
deliberately excluded seat). No new tech debt — purely additive config entries following an already-
proven shape; no new code path, no new asset, no file over the line cap. Real remaining FAZ 5 gaps
are unchanged and require either a content-design decision (real dialogue content/branching) or a
design reconsideration (NPC player/pack-awareness) — not a mechanical fix like this one was.
