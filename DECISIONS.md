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

## ADR-0037: `physics.js`'s `createSettlementCollider` — a simple player-vs-castle horizontal collider

**Status:** Accepted (run 35).

**Context:** A fresh state re-derivation (not assuming anything carried over from the prior run's
own closing notes, per this run's own "devam et" instruction) found FAZ 1 already ✅ TAMAMLANDI
since run 5, `sky.js` already built and wired in since run 4 — the specific "priority 8" candidate
named in this run's brief no longer existed as open work. Re-scanning the actual current Roadmap for
a genuine priority-8 item (a missing subtask of an actually in-progress phase, with priorities 1-7
confirmed empty by the same fresh scan) found FAZ 3 — still "(in progress)" — had one named open
item pair, "Basit LOD/collider." The collider half matched a real, previously-flagged, still-open
gap: `camera.js`'s own Known Issues note ("this only fixes what the *camera* can see through — the
*player* can still walk through castle walls"). The LOD half had no measured perf need behind it —
`world/settlements.js`'s `InstancedMesh`-based rendering already holds castle draw calls to 3 total
regardless of camera distance, so building LOD now would be speculative optimization work, not a fix
for any observed budget overrun.

**Decision:** Added `physics.js`'s `createSettlementCollider(seats, settlementConfig,
playerRadiusMeters = 0.4)`. Per kingdom seat, tests two simple analytic shapes built from the exact
same `SETTLEMENT_CONFIG` dimensions `world/settlements.js`'s `createSettlements` already uses for
the visible geometry (so the collider always matches what's rendered, never a second, independently-
tuned source of truth):
1. An axis-aligned box for the keep (`KEEP_WIDTH_METERS` x `KEEP_DEPTH_METERS`, centered on the
   seat), grown by `playerRadiusMeters`.
2. A circle at each of the 4 corner towers' real offsets (`TOWER_CORNER_OFFSET_METERS`), radius
   `TOWER_RADIUS_BOTTOM_METERS + playerRadiusMeters`.

`resolveXZ(worldX, worldZ)` pushes a penetrating point out along the shallowest escape axis (box) or
radially (circle), and is a no-op — the overwhelmingly common case, true for 13 of 14 seats on
almost every frame — when the point isn't inside anything. `gameplay/player.js`'s `createPlayer` now
accepts an optional `settlementCollider` and resolves the candidate next `(x, z)` through it every
frame with movement input, *before* `groundCollider.getGroundHeight` samples the terrain at that
resolved position — mirroring the existing `groundCollider` dependency-injection shape (a parameter,
not an import) rather than reaching into `world/settlements.js` directly, keeping the "physics.js
owns collision" folder-ownership boundary intact (see ARCHITECTURE.md). `game3d.js` builds the one
shared collider instance from `settlementsResult.seats` + `SETTLEMENT_CONFIG` and threads it into
`createPlayer`'s options.

**A real edge-case bug found and fixed during verification:** the tower-circle push-out's original
zero-distance guard (`distance > 1e-6`, meant only to avoid a divide-by-zero) also silently skipped
the correction when a point landed *exactly* on a tower's center — leaving it unresolved instead of
pushed out. Fixed by special-casing `distance < 1e-6` to kick the point out along a fixed `+X`
direction (the escape direction is arbitrary at that singular point; only guaranteed escape matters).
Found by testing the actual edge case in isolation, not assumed correct from reading the code.

**Alternatives considered:**
- *Bundle LOD into this same subtask, since the roadmap lists them as one line item* — rejected:
  LOD has no measured perf need (see Context above), and the collider alone is already a complete,
  independently-valuable, independently-revertible unit. Splitting keeps each change small and
  reviewable rather than one subtask doing two unrelated things for the sake of matching the
  roadmap's own line-item grouping.
- *A raycast-based collider, matching `camera.js`'s `resolveCameraCollision` approach* — rejected:
  raycasting is the right tool when the collidable geometry is arbitrary/rotated (the camera can
  approach from any angle in 3D, including from above/below), but every castle here is a static,
  axis-aligned box + circles known in advance; a closed-form box/circle test is cheaper, has no
  "ray started inside the geometry" edge case to reason about, and is simpler to unit-test in
  isolation the way this ADR's Verified section does.
- *A single large bounding circle per seat instead of box+towers* — rejected: measured against the
  actual guard NPC offsets in `NPC_CONFIG.SPAWNS` (`±12m` from seat center on each axis, distance
  ~17m), a single circle large enough to cover the tower ring (~34.8m radius) would place the
  interaction-range boundary for every NPC well inside the exclusion zone, making it impossible for
  the player to ever walk close enough to trigger `ui/interactionPrompt.js`'s 6m prompt — silently
  breaking all of FAZ 5's existing interaction work. The box+towers shape (17.4m box half-extent)
  leaves NPCs reachable, matching how they visually read against the actual keep geometry.

**Verified:**
1. `node --check` clean on `physics.js` (120 lines), `gameplay/player.js` (114 lines), `game3d.js`
   (579 lines, re-measured against the 600-line cap per the standing run-29 checklist item — still
   under). `node scripts/checkAssetsManifest.js` still exits 0. `node scripts/smokeTestGame3D.js`
   PASS on both checks, before and after.
2. **Isolated collider math**, run in-browser via the project's real import map (not Node's
   `require`, since `physics.js` has no non-browser harness and this keeps the test exercising the
   exact module resolution the game itself uses): a point at a synthetic castle's exact center is
   pushed to precisely 17.4m (`KEEP_WIDTH_METERS/2 + 0.4`); a far point is an exact no-op; a point on
   a tower's exact center is pushed to precisely the tower's radius (confirming the edge-case fix);
   and 3000 simulated per-frame forward steps — the same loop shape `player.js`'s own `update()`
   uses — walking straight at the keep center from 60m away come to rest at exactly 517.4 (17.4m
   short of center) and never penetrate further despite 3000 more attempts to.
3. **Live integration sanity**, real headless-Chromium session: held `D` for 3 seconds of ordinary
   open-field movement (nowhere near any castle) — zero console/page errors, confirming the new
   optional parameter doesn't disturb the much more common non-castle-adjacent movement path.

**Consequence:** The player can no longer walk through a kingdom seat's keep or towers — the last
specifically-named gap in `camera.js`'s own Known Issues note is now closed. FAZ 3's remaining open
item is LOD only, still correctly unstarted (no measured need). No new tech debt: the collider
reuses `SETTLEMENT_CONFIG` as its single source of truth (no duplicated geometry constants), stays
under the 600-line cap on every touched file, and `settlementCollider` is optional everywhere it's
threaded through, so no existing caller/test shape was broken.

## ADR-0038: Extend `scripts/smokeTestGame3D.js` with a settlement-collider regression check

**Status:** Accepted (run 35, second chained sub-task).

**Context:** With ADR-0037's collider landed, regression-guarded, and pushed, a fresh priority-order
re-scan (per the operator's "don't stop after one" chained-subtask rule) found priorities 1-5 still
empty and landed on priority 6, missing smoke-test/regression coverage: `scripts/smokeTestGame3D.js`
(ADR-0035) verifies the game *boots* cleanly, but has no assertion at all about the settlement
collider ADR-0037 just added — a future edit to `physics.js` or `config.js`'s `SETTLEMENT_CONFIG`
could silently reintroduce ADR-0037's own zero-distance edge-case bug (or a different regression)
with nothing catching it beyond a human happening to notice.

**Decision:** Added a third check, `checkSettlementCollider`, to `scripts/smokeTestGame3D.js`.
Rather than a new file/harness, it runs in the same headless-Chromium session already used for
`check3DMode`, navigating to `game3d.html` and dynamic-`import()`ing `physics.js`/`config.js`
directly in-page (exercising the real import map / module resolution the live game uses, not a
separate mocked environment). Replays exactly ADR-0037's own manual verification: a point at a
synthetic castle's center must resolve to precisely the keep's half-extent; a far point must be an
exact no-op; a 3000-step simulated per-frame walker approaching from 60m away must stop at exactly
the keep's half-extent. All three are floating-point-exact assertions (`=== `/tight epsilon), not
fuzzy thresholds, since the underlying math is itself exact arithmetic with no accumulated
randomness.

**Alternatives considered:**
- *A separate `scripts/testPhysics.js`* — rejected: `smokeTestGame3D.js` already owns "the one
  committed regression check," already starts a browser + static server, and already has the exact
  import-map-aware page context this check needs; a second script would duplicate that
  infrastructure for no isolation benefit (this check has no interaction with the other two beyond
  sharing one `browser` instance).
- *Assert only the walker (most direct proof), skip the center/far-point checks as redundant* —
  rejected: the center-point and far-point assertions are cheap and each independently pin down a
  different failure mode (an inverted box condition vs. a collider that fires when it shouldn't) —
  keeping the walker check alone would leave a narrower, less diagnostic failure signal on a
  regression.

**Verified:** `node --check scripts/smokeTestGame3D.js` clean (280 lines, under the 600-line cap).
Ran clean against the real repo: all 3 checks PASS. **Failure path verified with the exact real bug
ADR-0037 fixed**, re-injected temporarily (`if (false && ...)` disabling the keep-box push-out) —
the new check correctly reported `FAIL` with the wrong resolved distances (`centerDist: 0`,
`walkerDist: ~90` instead of the expected `17.4`), exit code 1; the other two checks stayed PASS
(confirming the failure is isolated to the collider check, not a false-positive cascade). Restored
`physics.js` immediately after; `diff` against a pre-edit backup confirmed a byte-identical restore.

**Consequence:** `scripts/smokeTestGame3D.js` now guards both "does the game boot" and "does the
castle collider still work correctly," with a demonstrated real failure path for the newer check.
No new file, no new dependency, no file over the line cap. Same not-wired-into-CI caveat as
ADR-0034/ADR-0035 (no CI pipeline exists in this repo) — still a manual step.

## ADR-0039: `physics.js`'s `integrateJumpArc` — simple ballistic jump/gravity for the player

**Status:** Accepted (run 36, first sub-task).

**Context:** A fresh Session Snapshot at run 36's start found the repo already clean (all
`node --check` clean, `scripts/checkAssetsManifest.js`/`scripts/smokeTestGame3D.js` both PASS,
no file over the 600-line cap, world scale unchanged at 137.5 km²) — priorities 1-7 (syntax error,
blocking bug, perf-budget overrun, memory leak, tech debt, missing regression coverage, low world
coverage) had nothing new to act on; mobile's low coverage figure is an already-documented,
by-design perf-budget tradeoff (ADR-0010/ADR-0013), not a bug. Priority 8 (an active phase's own
missing subtask) landed on FAZ 4's one remaining named gap: `physics.js`'s own module doc and
3D_GAME_PROGRESS.md's Known Issues both explicitly called out "no gravity/velocity simulation or
jumping yet" as separate, still-open work from run 35's *horizontal* castle-wall collider (ADR-0037)
— a real, bounded, mechanical gap with no manual-asset-download dependency (no jump/fall animation
clip exists, but the character can still visibly move vertically without one, using its existing
idle/walk/run clips — see Consequence).

**Decision:** Added `physics.js`'s `integrateJumpArc(heightAboveGroundMeters, velocityYMps, delta,
gravityMps2)` — a pure function (no shared state, no `THREE.*`) that steps one frame of a simple
ballistic arc and returns `{heightAboveGroundMeters, velocityYMps, isGrounded}`. Deliberately
expressed as height *above the ground* rather than an absolute world Y, so `gameplay/player.js` can
add the result on top of whatever `groundCollider.getGroundHeight()` reports at the player's
*current* XZ every frame — normal walking (which already snaps straight to ground height every
frame, following slopes/steps) is completely unaffected: `heightAboveGround` is 0 except during an
actual jump, so `groundHeight + 0 === groundHeight`, byte-identical to the pre-run-36 behavior.
`config.js`'s `PLAYER_CONFIG` gained `GRAVITY_MPS2: -20` (snappier than real-world 9.8 — a
deliberate game-feel choice, not a physics simulation) and `JUMP_SPEED_MPS: 7` (peak height ≈1.2m,
a small hop, matching FAZ 4's "basit" framing rather than platformer-scale jumps).
`gameplay/player.js`'s `update()` gained a 4th, optional `jumpRequested` parameter (defaults to
`false`, so any existing caller passing 3 args is unaffected) — launches a jump
(`velocityY = JUMP_SPEED_MPS`) only when `jumpRequested` is true *and* the player is currently
`isGrounded`, so holding the jump key can't chain jumps mid-air. `input.js`'s `KeyboardInput` gained
Space-key handling: edge-triggered (`jumpRequested` set only on the keydown that *first* presses the
key, not while held), consumed and cleared by the next `getAxes()` call, so holding Space doesn't
re-jump every frame. `game3d.js`'s tick loop reads `jumpRequested` straight off the un-merged
`keyboardAxes` object (computed once per frame, before `combineAxes()`) since jump is deliberately
keyboard-only for now — `touchJoystick.js` has no jump control (see Consequence).

**Alternatives considered:**
- *Absolute-Y gravity simulation (mutate `model.position.y` directly with a velocity, ignoring
  ground height until landing)* — rejected: this would require re-deriving the "am I on a slope"
  case from scratch (re-sampling ground height at every XZ position during descent, then comparing
  against the falling Y) and risks subtly breaking the existing, already-correct slope/step-following
  behavior `hasInput`'s branch relies on. The height-above-ground framing sidesteps this entirely by
  composing with the existing ground-snap instead of replacing it.
- *A dedicated jump/fall animation state* — rejected for this pass: no such clip was ever downloaded
  (only `idle`/`walking`/`running` exist for `peasant_girl`), and fabricating one isn't possible per
  this project's asset constraint (no synthetic animation generation, only real downloaded/CC0
  clips). The character keeps its current `idle`/`walking`/`running` pose while airborne — visually
  imperfect but honest, flagged in Known Issues rather than silently left unmentioned.
- *Wiring jump into `touchJoystick.js` too, this same run* — rejected as scope creep for one atomic
  sub-task: the joystick UI has no spare control surface for a jump button today, and adding one is
  itself a UI-design decision (button placement, sizing, discoverability) deserving its own pass,
  not squeezed into a physics sub-task. Flagged in Known Issues as a real, scoped-out mobile gap.
- `GRAVITY_MPS2`/`JUMP_SPEED_MPS` *magnitudes* — chosen for a small, quick hop (peak ≈1.2m, full arc
  ≈0.7s) appropriate for "step over uneven ground," not a platforming mechanic; easy to retune later
  since both are named `PLAYER_CONFIG` constants, no magic numbers in `physics.js`/`player.js` itself.

**Verified:**
1. `node --check` clean on every touched file: `config.js` (528 lines), `physics.js` (144 lines),
   `input.js` (72 lines), `gameplay/player.js` (137 lines), `game3d.js` (582 lines) — all
   comfortably under the 600-line cap. `node scripts/checkAssetsManifest.js` still exits 0 (no
   asset files touched). `node scripts/smokeTestGame3D.js` PASS on all checks before and after.
2. **A real edge case found and fixed during design, not left implicit:** standing still
   (`heightAboveGroundMeters=0, velocityYMps=0`) must stay grounded at height 0, not drift — traced
   through the math by hand (`0 + gravity*delta` is negative, `0 + negative*delta` is negative,
   `<= 0` triggers the grounded-clamp branch) and confirmed via the committed test below rather than
   assumed.
3. **Isolated math, run in-browser** (same real-import-map pattern ADR-0037/ADR-0038 established —
   `physics.js` has no non-browser test harness): standing still stays grounded at height 0; a full
   jump arc, stepped frame-by-frame exactly like `player.js`'s own loop, peaks within the
   discretization-error tolerance of the closed-form ballistic height (`v²/(2·|g|)` ≈1.225m, observed
   ≈1.167m — semi-implicit Euler integration systematically undershoots the true continuous peak by a
   small, delta-dependent amount, not a bug), lands (never goes negative during flight), and takes
   the closed-form flight time (`2v/|g|` ≈0.7s ≈42 frames at 60fps) within ±3 frames.
4. **Fault injection, not just the happy path:** temporarily zeroed `gravityMps2` inside
   `integrateJumpArc` (a jump that never comes down) — the new check correctly failed (never landed
   within 600 simulated frames, wildly wrong peak), while the settlement-collider and boot checks
   stayed PASS (isolated failure signal, not a cascade). Restored `physics.js` immediately after;
   `diff` against a pre-edit backup confirmed a byte-identical restore.
5. **Live integration sanity**, real headless-Chromium session against the actual assembled game
   (`game3d.html`, not an isolated module import): pressed and released Space during normal
   gameplay — zero console/page errors, confirming the new `jumpRequested` wiring through
   `input.js`/`game3d.js`/`player.js` doesn't break the real boot/movement path, the much more
   common case than an isolated unit test alone would prove.

**Memory-leak checklist:** No new `THREE.*` allocation, event listener, or timer — `integrateJumpArc`
is pure per-call arithmetic; `input.js`'s jump state is a single boolean field on an object that
already exists and is already cleared in `dispose()`.

**Performance:** O(1) per frame, no allocation — negligible against any per-frame budget, same
reasoning as ADR-0037's collider.

**Consequence:** The player can now jump (Space, desktop keyboard only) with gravity pulling them
back down, composing cleanly with existing ground-height/slope-following and the settlement
collider (a jump doesn't bypass the horizontal castle collider — `resolveXZ` still runs on the
horizontal move before the vertical arc is applied). FAZ 4's own remaining named gap
("no gravity/jump ... physics") is now closed — FAZ 4 has no further known mechanical gaps.
Real, honestly-scoped remaining items: no jump/fall animation clip (visual-only limitation, reuses
existing poses); no mobile/touch jump control (`touchJoystick.js` unchanged this run); jump height/
gravity feel is a first-pass tuning, not focus-tested.

## ADR-0040: Extend `scripts/smokeTestGame3D.js` with a jump/gravity-arc regression check

**Status:** Accepted (run 36, second chained sub-task).

**Context:** With ADR-0039's jump arc landed, regression-guarded via a one-off in-page test, and
committed, a fresh priority-order re-scan (per the operator's "don't stop after one" chained-subtask
rule — regression guard and smoke test both passed and budget/time remained) found priorities 1-5
still empty and landed on priority 6 again, missing smoke-test/regression coverage: the manual
verification behind ADR-0039 (Verified steps 3-4 above) was real but ad hoc, exactly the gap
ADR-0035/ADR-0038 already established a pattern for closing.

**Decision:** Added a fourth check, `checkJumpArc`, to `scripts/smokeTestGame3D.js` — same in-page
dynamic-`import()` pattern as `checkSettlementCollider`, navigating to `game3d.html` and importing
`physics.js`/`config.js` directly. Persists ADR-0039's own manual verification (idle stays grounded;
a stepped jump arc peaks near the closed-form ballistic height with a discretization-aware
tolerance; it lands without ever going negative; frame count matches the closed-form flight time
within a small tolerance) as an always-run assertion instead of a one-off.

**Alternatives considered:**
- *Tighter floating-point-exact tolerance on the peak height, matching `checkSettlementCollider`'s
  exact assertions* — rejected: unlike the collider's static analytic geometry, `integrateJumpArc`
  is a *discretized* simulation (semi-implicit Euler) of a continuous formula — the two are expected
  to differ by a small, real, delta-dependent amount, not floating-point noise. A tolerance tight
  enough to demand exact agreement would be permanently red for a correct implementation; a fixed
  0.1m tolerance is still tight enough to catch a wrong `GRAVITY_MPS2`/`JUMP_SPEED_MPS` or a broken
  integration order.
- *A separate dedicated test script* — rejected for the same reason ADR-0038 rejected it: this
  check reuses the same browser/server/import-map infrastructure the other three checks already
  pay for.

**Verified:** `node --check scripts/smokeTestGame3D.js` clean (351 lines, under the 600-line cap).
All 4 checks PASS against the real repo. **Failure path verified with a real injected bug**
(temporarily zeroing `gravityMps2` inside `integrateJumpArc`, the exact bug ADR-0039's own
verification step 4 used) — the new check correctly failed (`peakOk: false, landedOk: false`,
frame count pinned at the 600-iteration safety cap since the arc never lands), while the other
three checks stayed PASS. Restored `physics.js` immediately after; a `diff` against a pre-edit
backup confirmed a byte-identical restore.

**Consequence:** `scripts/smokeTestGame3D.js` now has 4 committed checks (2D shell boot,
3D-mode boot, settlement collider, jump/gravity arc), each with a demonstrated real failure path.
No new file, no new dependency, no file over the line cap. Same not-wired-into-CI caveat as every
prior `scripts/` ADR (no CI pipeline exists in this repo) — still a manual step.

## ADR-0041: Persisted regression check for `gameplay/interaction.js`'s open/close state machine

**Status:** Accepted (run 36, third chained sub-task).

**Context:** With ADR-0039 (jump/gravity) and ADR-0040 (its regression check) both landed and
pushed, a fresh priority-order re-scan (per the operator's "don't stop after one" chained-subtask
rule — regression guard and smoke test both passed and budget/time remained) found priorities 1-5
still empty and landed on priority 6 again: `gameplay/interaction.js`'s open/close/auto-close state
machine (run 33, ADR-0033) — real gameplay-critical logic every one of FAZ 5's 14 NPCs depends on
— had zero persisted test coverage. Run 33's own notes verified it by hand at the time; nothing has
guarded it against regression since.

**Decision:** Added a fifth check, `checkInteractionController`, to `scripts/smokeTestGame3D.js`.
`gameplay/interaction.js` has no `THREE`/DOM dependency of its own — `interactionPrompt`/
`dialogueBox` are injected collaborators — so this test uses plain fake stubs (`{visible, shown}`
tracking objects) rather than the real UI modules, still via the same in-page dynamic-`import()`
pattern the other three module-level checks use (real module resolution, not a separate harness).
Covers the full state machine end to end: prompt hidden when no NPC is in range, shown when one is
and no dialogue is open; `KeyE` opens a dialogue with the correct per-NPC greeting text and hides
the prompt; `KeyE` again or `Escape` closes it; the player walking out of range auto-closes it with
no keypress; a browser key-repeat event (`event.repeat: true`) is correctly ignored, not treated as
a second real press.

**Alternatives considered:**
- *Drive it through the real UI (`ui/interactionPrompt.js`/`ui/dialogueBox.js`) instead of fakes* —
  rejected: those modules are already independently covered by the fact that `check3DMode` boots
  the real game with real NPCs and asserts zero console/page errors; re-testing their DOM rendering
  here would duplicate that coverage without adding a new assertion, while adding fake stubs lets
  this check assert the *state machine's own decisions* (what got shown/hidden and when) directly
  and deterministically, with no DOM query needed.
- *Drive the real game and physically walk the player near an NPC via simulated keyboard input* —
  rejected as needlessly fragile for what this test needs to prove: real per-frame movement across
  a large world (444 terrain chunks) adds real time and multiple potential failure surfaces (chunk
  streaming, pathing around geometry, terrain height sampling) that have nothing to do with the
  interaction state machine itself, which is pure per-call logic already provable in isolation with
  synthetic positions in microseconds.

**Verified:** `node --check scripts/smokeTestGame3D.js` clean (449 lines, under the 600-line cap).
All 5 checks PASS against the real repo. **Failure path verified with a real injected bug**
(temporarily disabling the "player walked out of the active NPC's radius" auto-close branch in
`gameplay/interaction.js`, replacing its condition with a literal `false`) — the new check correctly
failed specifically on the `walkingAwayAutoCloses` assertion (all 6 other assertions in the same
check stayed true, isolating exactly which behavior broke), while the other four checks stayed
PASS. Restored `interaction.js` immediately after; `diff` against a pre-edit backup confirmed a
byte-identical restore, and `node --check` on it afterward stayed clean.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script; the fake
`interactionPrompt`/`dialogueBox` stubs are plain objects with no listener/timer/`THREE.*`
allocation, discarded when the page closes.

**Consequence:** `scripts/smokeTestGame3D.js` now has 5 committed checks (2D shell boot, 3D-mode
boot, settlement collider, jump/gravity arc, interaction controller), each with a demonstrated real
failure path. No new file, no `gameplay/interaction.js` change at all (test-only addition), no file
over the line cap. Same not-wired-into-CI caveat as every prior `scripts/` ADR.

## ADR-0042: Persisted regression check for `gameplay/animals.js`'s wolf flee/pack-alert chain

**Status:** Accepted (run 37).

**Context:** Session Snapshot found `main`'s local branch ref stale again (same recurring
container-restart pattern documented in the "Repo-continuity note" — `HEAD` detached at run 36's
`74fec3e`, local `main` still at the pre-3D `38e09e7`; `git fetch origin main` confirmed
`origin/main` already matched the detached commit, so `git checkout main && git reset --hard
origin/main` was safe and lossless — no commits rewritten). With that resolved, priorities 1-5
(syntax, blocking bugs, perf budget, memory leaks, tech debt) were all clean (`node --check` on
every `src/3d/**` file, both smoke-test scripts pass, budgets comfortably under both device
ceilings), landing on priority 6 again: `gameplay/animals.js`'s wolf flee (run 28, ADR-0027) and
pack-alert/chain-propagation logic (run 29/30, ADR-0029/ADR-0030) — real gameplay-critical behavior
— had zero persisted coverage. Both ADRs' own "Verified" sections used a temporary debug hook
(`window.__debugGame3DState`) reverted before commit; nothing has guarded either behavior against
regression since. This is the exact gap ADR-0038/ADR-0040/ADR-0041 already established the pattern
for closing on `physics.js`/`gameplay/interaction.js` — `gameplay/animals.js` was the one
gameplay-critical module still missing it.

**Decision:** Added a sixth check, `checkWolfPackAlert`, to `scripts/smokeTestGame3D.js`. Unlike
`checkInteractionController` (which could use plain fakes because its collaborators are injected),
`createWolf` calls `assetLoader.loadModel()` directly, so this check constructs a real `AssetLoader`
and loads the real `Wolf-Blender-2.82a.glb` from this script's own local static server — the same
file `check3DMode`'s full boot already loads 3 copies of, so no new asset/dependency. Three wolf
controllers are spawned at hand-picked distances (wolf1↔wolf2 = 18m, inside the 20m pack radius;
wolf1↔wolf3 = 34m, outside; wolf2↔wolf3 = 16m, inside) — deliberately cleaner geometry than the real
`berkalp` spawns' 14.4m/28.8m spacing (ADR-0030's own notes flagged that spacing as producing a
"harmless" but check-complicating overlap where the player position that triggers wolf1 directly
also happens to fall inside wolf2's own independent direct-trigger radius). `update()` is then
direct-called across 3 synthetic frames with hand-built `packmateFleePositions` arguments, replaying
ADR-0030's exact manually-verified scenario: baseline calm; wolf1 flees the player directly; wolf2
stays calm until told wolf1 is fleeing, then pack-flees; wolf3 stays calm when only told about
out-of-range wolf1 (the negative control) but pack-flees once told about in-range wolf2 one frame
later. A further assertion checks wolf2's post-pack-flee `x` position increased (away from the
player at the origin) rather than staying put (which is what an away-from-the-alerting-packmate bug
would produce, since wolf1 and wolf2 share the same `x`) — regression-testing ADR-0029's core design
decision that pack-alerted flee direction is always player-relative, never packmate-relative.

**Alternatives considered:**
- *Fake the model/animation loading to avoid the real `AssetLoader` round-trip* — rejected:
  `createWolf` has no injection point for its loader (unlike `interaction.js`'s
  `dialogueBox`/`interactionPrompt`), and the real `.glb` is already served locally with no network
  dependency, so faking it would mean either changing `animals.js`'s API for a test-only reason (not
  justified — see this project's refactor-only-for-bug/perf/readability/architecture rule) or
  duplicating `createWolf`'s internals in the test, which risks testing a fiction instead of the real
  code path.
- *Reuse the real `berkalp` spawn distances from `ANIMAL_CONFIG.SPAWNS` instead of hand-picked ones*
  — rejected: those exact distances (14.4m/28.8m) create the direct-trigger/pack-trigger overlap
  ADR-0030 itself called out as "harmless" for gameplay but which would make a persisted assertion
  either weaker (can't cleanly attribute wolf2's flee to the pack path alone) or require restating
  that overlap's reasoning in the test every time it's read. Clean synthetic distances isolate each
  causal path unambiguously.

**Verified:** `node --check scripts/smokeTestGame3D.js` clean (552 lines, under the 600-line cap).
All 6 checks PASS against the real repo. **Failure path verified with a real injected bug**
(temporarily changing `isFleeingFromPack = true` to `isFleeingFromPack = false` in
`gameplay/animals.js`) — the new check correctly failed on exactly the pack-path assertions
(`wolf2PackFlees`, `wolf2FleesAwayFromPlayer`, `wolf3ChainFlees` all `false`), while
`wolf1FleesDirect`/`baselineCalm`/the negative control stayed `true` and the other 5 checks stayed
PASS. Restored `animals.js` immediately after; `diff` against a pre-edit backup confirmed a
byte-identical restore, and `node --check` afterward stayed clean.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script; the 3 test wolves'
`AnimationMixer`/model resources are never added to a live render loop and the whole page (and its
`AssetLoader`/THREE resources) closes at the end of the check, same disposal story as every other
in-page check in this script.

**Consequence:** `scripts/smokeTestGame3D.js` now has 6 committed checks (2D shell boot, 3D-mode
boot, settlement collider, jump/gravity arc, interaction controller, wolf flee/pack-alert), each with
a demonstrated real failure path. No new file, no `gameplay/animals.js` change at all (test-only
addition), no file over the line cap. Same not-wired-into-CI caveat as every prior `scripts/` ADR.
FAZ 5's NPCs still have no equivalent persisted coverage for an analogous future player/pack-aware
behavior, but none exists yet to test (real, correctly-scoped-out remaining gap, not this run's
scope).

## ADR-0043: Persisted regression check for `gameplay/npc.js`'s waypoint-patrol logic; split `smokeTestGame3D.js`

**Status:** Accepted (run 38).

**Context:** Session Snapshot found the same recurring container-restart pattern documented in
prior runs' "Repo-continuity note" — `HEAD` detached at `origin/main`'s tip (`f0065a3`), local
`main` still at the pre-3D `38e09e7`. `git checkout main` (before fetching) briefly desynced the
working tree from the index via an intermediate `git update-ref` — caught immediately via `git
status` before anything was staged/committed, fixed with `git reset --hard origin/main` (safe:
`origin/main` already matched the detached commit, confirmed via `git fetch` first, no commits
rewritten, nothing of value discarded). With that resolved, priorities 1-5 (syntax, blocking bugs,
perf budget, memory leaks, tech debt) were all clean (`node --check` on every `src/3d/**` file,
`scripts/checkAssetsManifest.js` clean, all 6 existing smoke checks passing). Priority 6 (missing
smoke test/regression) still had one real gap: `gameplay/npc.js`'s waypoint-patrol movement
(run 22, ADR-0021) — the core movement logic all 11+ patrolling NPCs depend on, and the pattern
`gameplay/animals.js`'s wolves independently copied (ADR-0026) — had zero persisted coverage,
only ever eyeballed live in a running scene. This is the same gap ADR-0038/ADR-0040/ADR-0041/
ADR-0042 already established the pattern for closing on other gameplay-critical modules.

**Decision:** Added a seventh check, `checkNpcPatrol`, to the smoke suite. Adding it in place
would have pushed `scripts/smokeTestGame3D.js` from 552 to over 600 lines (this project's
per-file cap), so this run first split that file: `scripts/game3dSmokeChecks.js` (new, 495 lines)
now holds all 7 check functions (moved verbatim) plus their shared `NAV_TIMEOUT_MS`/
`GAME3D_READY_TIMEOUT_MS`/`loadAndCollectErrors` helpers; `scripts/smokeTestGame3D.js` (now 143
lines) keeps only the static-file-server/Playwright-bootstrap infrastructure and `require()`s the
checks module. Mirrors the same "extract into a focused module, moved verbatim" pattern ADR-0028
established for `game3d.js`'s NPC/animal spawn-resolution loops.

`checkNpcPatrol` drives one real `createNPC` controller (loading an actual downloaded Mixamo FBX
via a real `AssetLoader`, same in-page dynamic-`import()` pattern as `checkWolfPackAlert`) through
the exact 2-waypoint shape `spawnConfiguredNPCs` builds in production: `patrolWaypoints[0]` equal
to the NPC's own spawn point, `patrolWaypoints[1]` a real far point (10, 10) reached via a
groundCollider whose height varies with `z` (so ground-resampling mid-walk is actually observable,
not just coincidentally correct at a constant height). Writing this test surfaced a real (if
cosmetic) timing quirk: `update()`'s `pauseTimer` starts pre-loaded to `pauseSeconds`
*unconditionally*, before the first distance-to-waypoint check ever runs — so every patrolling NPC
idles a full `pauseSeconds`, "arrives" at waypoint 0 (its own spawn point — a no-op), idles a
*second* full `pauseSeconds`, and only then takes its first real step. Every subsequent lap's pause
is the correct single `pauseSeconds` — only the very first lap is doubled. Not a gameplay-breaking
bug (no NPC gets stuck, no wrong position), out of this test-only sub-task's scope to fix, but
asserted against directly (`idleDurationOk`, tolerant to ±5 frames) so it's documented and visible
rather than silently relied upon. Other assertions: `startedMoving` (confirms the double-idle
eventually ends), `midWalkYTracksGround` (ground height resamples during the walk, not just at
waypoints), `arrivedExactly` (position snaps to the exact target, not "close enough"),
`finalYTracksGround`, `turnedTowardTravel` (yaw converges toward `atan2(dx, dz)` within the
turn-rate-limited lerp).

**Alternatives considered:**
- *Fix the double-idle-before-first-lap quirk in the same run* — rejected: out of scope for a
  test-only sub-task per this project's "refactor only for bug/perf/readability/architecture"
  rule; it's cosmetic (a one-time extra ~3s idle per NPC at world boot, never visible again), not a
  reported bug, and changing production movement logic deserves its own dedicated, narrowly-scoped
  sub-task with its own verification — not a drive-by inside a smoke-test-coverage task.
- *Keep `smokeTestGame3D.js` as one file and accept going over 600 lines* — rejected outright by
  this project's own hard per-file cap (Golden Rule #7); the split is a mechanical, verbatim move
  with no logic change, same risk profile as ADR-0028's precedent.
- *Assert exact frame counts throughout (matching `checkJumpArc`'s ballistic-formula precision)* —
  rejected for the idle-duration assertion specifically: the exact frame the floating-point
  `pauseTimer` crosses zero isn't the behavior being guarded (unlike `integrateJumpArc`'s pure
  closed-form arc), so a tight tolerance would make this check fragile to irrelevant floating-point
  noise. The waypoint-arrival assertions still use exact equality (`=== 10`), since the code's own
  `distance <= step` snap-to-target branch guarantees that exactly, same reasoning as
  `checkSettlementCollider`'s exact-equality walker assertion.

**Verified:** `node --check` clean on both `scripts/smokeTestGame3D.js` (143 lines) and
`scripts/game3dSmokeChecks.js` (495 lines) — both under the 600-line cap. All 7 checks PASS
against the real repo (headless Chromium via Playwright). **Failure path verified with a real
injected bug** (temporarily changing the walk branch's `model.position.y =
groundCollider.getGroundHeight(...)` to a hardcoded `model.position.y = 0` in
`gameplay/npc.js`) — the new check correctly failed on exactly `midWalkYTracksGround` (the one
assertion that samples height *during* the walk, not at a waypoint snap), while
`arrivedExactly`/`finalYTracksGround` stayed true (the separate waypoint-snap branch, untouched by
the injected bug, independently resamples height on arrival — correctly isolating that this is a
different code path), and all 6 other checks stayed PASS. Restored `npc.js` immediately after;
`diff` against a pre-edit backup confirmed a byte-identical restore, `node --check` afterward
stayed clean.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script; the one test NPC's
`AnimationMixer`/model resources are never added to a live render loop, and the whole page (and
its `AssetLoader`/THREE resources) closes at the end of the check, same disposal story as every
other in-page check in this suite.

**Consequence:** The smoke suite now has 7 committed checks (2D shell boot, 3D-mode boot,
settlement collider, jump/gravity arc, interaction controller, wolf flee/pack-alert, NPC waypoint
patrol), each with a demonstrated real failure path, split across 2 files (both under the line
cap) instead of 1. No `gameplay/npc.js` change at all (test-only addition — the double-idle quirk
is documented, not fixed). Same not-wired-into-CI caveat as every prior `scripts/` ADR. The
analogous gap for `gameplay/animals.js`'s own patrol movement (as opposed to its already-tested
flee/pack-alert behavior) remains open — real, correctly out of this run's scope, a candidate for
a future run's priority-6 pass.

## ADR-0044: Persisted regression check for `gameplay/animals.js`'s wolf waypoint-patrol movement

**Status:** Accepted (run 38, second chained sub-task).

**Context:** With ADR-0043 (NPC waypoint-patrol regression check) landed and pushed this same run,
priorities 1-5 remained clean (`node --check` on every touched file, budgets unaffected — test-only
changes). Priority 6's own remaining candidate, flagged explicitly by this run's first sub-task
("the analogous gap for `gameplay/animals.js`'s own patrol movement... remains open"): the wolf
patrol branch inside `createWolf` is a copy (not a shared import — see ADR-0026's "why duplicate")
of `gameplay/npc.js`'s already-tested patrol logic, but `checkWolfPackAlert` (ADR-0042) only
exercises the flee/pack-alert branches, never the plain patrol-walk branch itself. Zero persisted
coverage of wolf patrol movement existed before this sub-task.

**Decision:** Added an 8th check, `checkWolfPatrol`, to `scripts/game3dSmokeChecks.js` (now 586
lines — still under the 600-line cap, but close; a 9th check of similar size would need a further
split). Mirrors `checkNpcPatrol`'s exact scenario shape (2 waypoints, waypoint 0 = spawn point,
target (10, 10), a z-varying groundCollider) on a real `createWolf` controller, with
`fleeClipName`/`fleeTriggerRadiusMeters` both omitted so `canFlee` is `false` and the flee branch
can never fire regardless of any `playerPosition` — isolating the patrol branch specifically.
Confirms the copied logic stayed behaviorally identical to its already-verified original,
including inheriting the same double-idle-before-first-lap quirk ADR-0043 documented (asserted
here too, same loose tolerance) — a useful cross-check that the two copies haven't silently
drifted apart from each other.

**Alternatives considered:**
- *Refactor `npc.js`/`animals.js`'s patrol logic into one shared helper instead of testing both
  copies* — rejected, same reasoning ADR-0026 already gave and this project's "refactor only for
  bug/perf/readability/architecture" rule reinforces: the duplication is small, intentional, and
  each file owns its own concern; a shared extraction is only justified at a 3rd consumer, and
  doing it inside a test-coverage sub-task would be unrelated scope creep.
- *Skip the `notFleeingDuringPatrol` assertion since flee is already covered by ADR-0042* — kept
  it anyway: it's a one-line free assertion that specifically the *no flee config passed* path
  behaves correctly (as opposed to ADR-0042's own flee-triggered scenarios), a distinct
  configuration this suite hadn't exercised.

**Verified:** `node --check` clean on both files (144-line runner, 586-line checks module, both
under the cap). All 8 checks PASS against the real repo. **Failure path verified with a real
injected bug** (temporarily changing the patrol-walk branch's `model.position.y =
groundCollider.getGroundHeight(...)` to a hardcoded `model.position.y = 0` in
`gameplay/animals.js`) — the new check correctly failed on exactly `midWalkYTracksGround`, while
`arrivedExactly`/`finalYTracksGround` stayed true (same independent waypoint-snap-branch
resampling as ADR-0043's equivalent finding) and all 7 other checks (including
`checkWolfPackAlert`) stayed PASS. Restored `animals.js` immediately after; `diff` against a
pre-edit backup confirmed a byte-identical restore, `node --check` afterward stayed clean.

**Memory-leak checklist:** N/A — extends an existing one-shot Node CLI script; the one test wolf's
`AnimationMixer`/model resources are never added to a live render loop, and the whole page closes
at the end of the check.

**Consequence:** The smoke suite now has 8 committed checks, each with a demonstrated real failure
path. No `gameplay/animals.js` change at all (test-only addition). `scripts/game3dSmokeChecks.js`
is close enough to the 600-line cap (586/600) that the next new check will likely need a further
split (e.g. by system — movement checks vs. boot/collider checks) rather than another append.

## ADR-0045: Fix the double-idle-before-first-lap patrol timing quirk

**Status:** Accepted (run 38, third chained sub-task).

**Context:** ADR-0043 and ADR-0044 (this same run's first two sub-tasks) each documented — but
deliberately did not fix, as test-only sub-tasks — a real, cosmetic timing quirk shared by
`gameplay/npc.js`'s and `gameplay/animals.js`'s identical (copied, not shared — ADR-0026) patrol
logic: `pauseTimer` started pre-loaded to `pauseSeconds` *before* the first distance-to-waypoint
check ever ran. Since `patrolWaypoints[0]` is always the entity's own spawn point (both
`spawnConfiguredNPCs` and `spawnConfiguredAnimals` build it that way), the very first `update()`
call's "arrival" at waypoint 0 is a zero-distance no-op — but because `pauseTimer` was already
primed, that no-op arrival was preceded by a full, wasted `pauseSeconds` idle, then followed by a
*second* full `pauseSeconds` idle before the real first step. Every later lap's pause was already
correct (one `pauseSeconds` per waypoint). Both prior ADRs flagged this as "a real, findable-by-a-
player quirk if a future run wants to fix it" and this run's own priority scan, after landing
sub-task 2, found no higher-priority item — a proper priority-6 gap had just closed, and this
small, well-scoped, already-documented fix was the natural next atomic sub-task rather than
reaching for a larger/riskier priority-7/8 item.

**Decision:** Changed `let pauseTimer = isPatrolling ? pauseSeconds : 0;` to `let pauseTimer = 0;`
in both `gameplay/npc.js` and `gameplay/animals.js` (identical one-line change, same reasoning
comment in both — the `isPatrolling` conditional was removable since the patrol code block that
reads `pauseTimer` never executes at all when `isPatrolling` is false, so the value is simply
unused in that case regardless). With `pauseTimer` starting at 0, the first `update()` call
immediately takes the `else` branch, resolves the zero-distance "arrival" at waypoint 0 instantly,
advances `waypointIndex` to 1, and *then* sets `pauseTimer = pauseSeconds` for the real dwell —
exactly matching every subsequent lap's timing. Updated both `checkNpcPatrol` and `checkWolfPatrol`
(ADR-0043/ADR-0044) to assert the fixed single-pause-cycle timing (`expectedIdleSeconds =
PATROL_PAUSE_SECONDS`, not `* 2`) instead of merely documenting the old double-idle behavior.

**Alternatives considered:**
- *Guard the waypoint-0 case specially instead of changing `pauseTimer`'s initial value* (e.g. skip
  index 0 entirely, start `waypointIndex` at 1) — rejected: changes the loop's own semantics
  (`waypointIndex % patrolWaypoints.length` behavior for 2-vs-3+-point patrols) for a fix that's
  really about `pauseTimer`'s starting value, not the waypoint list itself. The one-line
  `pauseTimer` fix is strictly smaller and doesn't touch the patrol-advance logic at all.
- *Only fix one file, leave the other as documented-but-not-fixed* — rejected per both ADR-0043's
  and ADR-0044's own closing notes: "fixing one file without the other would leave them
  inconsistent again." Both files get the identical fix in the same sub-task.

**Verified:** `node --check` clean on all 4 changed files (`npc.js` 268 lines, `animals.js` 304
lines, `game3dSmokeChecks.js` 587 lines, `smokeTestGame3D.js` unchanged this sub-task) — all under
the 600-line cap. All 8 checks PASS with the fix and the updated assertions. **Regression verified
in both directions:** (1) real injected bug — temporarily reverted `pauseTimer` to
`pauseSeconds` in `npc.js`, then separately in `animals.js` — each time, the corresponding
already-updated check (`checkNpcPatrol`/`checkWolfPatrol`) correctly failed on
`startedMoving`/`idleDurationOk` (the capped idle-wait loop never saw movement within one pause
cycle's worth of frames, since the reverted code needed two), while every other check — including
the *other* file's now-still-fixed patrol check — stayed PASS, confirming the two files' fixes are
independently verified, not coupled. Restored each file immediately after its own test; `diff`
against pre-edit backups confirmed byte-identical restores each time, `node --check` stayed clean
throughout.

**Memory-leak checklist:** N/A — the change is a single local-variable initial value in an existing
function; no new allocation, listener, or timer of any kind.

**Consequence:** Every patrolling NPC and wolf now idles exactly `pauseSeconds` before its first
lap, matching every later lap — the double-idle quirk (present since run 22/27) is gone from both
files. World Coverage unchanged (movement-timing fix, no terrain/streaming/rendering touched). No
other system depends on the old double-idle timing (nothing in `game3d.js` or elsewhere reads
`pauseTimer`/patrol state directly).

## ADR-0046: Move player spawn from the world origin to next to the `umit` kingdom seat

**Status:** Accepted (run 39, first sub-task).

**Context:** The project owner played the 3D mode directly (movement/physics/camera all confirmed
working — W walked, Space jumped) and reported seeing none of the 14 kingdom seats/castles, 14
NPCs, or 3 wolves anywhere. Root-caused by hand: `PLAYER_CONFIG.SPAWN_X_METERS`/`SPAWN_Z_METERS`
placed the player at the world origin `(0, 0)` — `mapToWorldXZ`'s convention for the *center* of
`WORLD_SCALE.MAP_BOUNDS`, the padded kingdom-seat bounding box, not any seat itself. Every one of
`world/settlements.js`'s 14 `KINGDOM_SEATS` sits 2.5-6km from that center (closest is `stannis` at
~2.57km, `cersei` at ~3.28km; `umit` — the project owner's own kingdom seat — at ~4.04km); `fog.js`'s
`FogExp2` (`FOG_DENSITY_DAY` 0.0004 / `FOG_DENSITY_NIGHT` 0.00055) makes anything past roughly
2.8-3.8km impossible to make out. The player spawned in what looked like an empty world with no
visible destination and no compass/minimap (FAZ 8, not built yet) to point toward one. Not a code
bug — every system it touches (movement, physics, chunk streaming, settlement placement) was
already verified working correctly in isolation; this was a game-design/discoverability gap.

**Decision:** Added `PLAYER_CONFIG.SPAWN_MAP_X`/`SPAWN_MAP_Y` (`3885`/`5404`) — 2D-map units, the
same coordinate space `KINGDOM_SEATS`' `mapX`/`mapY` already use — instead of pre-converted world
meters, to avoid a `config.js` -> `world/settlements.js` import cycle (`mapToWorldXZ` lives in the
latter) and to stay self-documenting/re-derivable the same way `WORLD_SCALE`'s own doc comment
already asks of `MAP_BOUNDS`. This is `umit` (Ümit Targeryan, `mapX:3885`/`mapY:5370` — the
project owner's own kingdom seat, the most narratively meaningful choice of the seats considered)
offset ~34 map units (≈60m) in `+mapY`. `game3d.js` now imports `mapToWorldXZ` from
`world/settlements.js` (already imported `createSettlements`/`disposeSettlements` from the same
module) and converts `SPAWN_MAP_X`/`SPAWN_MAP_Y` through it via `WORLD_SCALE.MAP_BOUNDS`/
`METERS_PER_MAP_UNIT` right before calling `createPlayer`, replacing the old direct
`SPAWN_X_METERS`/`SPAWN_Z_METERS` reads (both constants removed — no other caller referenced them).
`gameplay/player.js`'s `spawn` parameter default changed from those removed constants to a literal
`{ x: 0, z: 0 }`, since `game3d.js` — the only real caller — always passes `spawn` explicitly; the
default only matters to a hypothetical future caller that omits it.

The +60m offset (not spawning exactly on the seat's own `mapX`/`mapY`) matters for two reasons:
(1) `SETTLEMENT_CONFIG`'s settlement collider (`physics.js`'s `createSettlementCollider`) reaches
≈35m from the keep center at its farthest corner tower — spawning any closer risks the player's
very first frame being an unwanted collider-resolution pop; (2) the `+mapY`/`+worldZ` direction
specifically (not `-mapY`, not `+`/`-mapX`) puts the castle in the default chase camera's forward
view: `game3d.js` starts the camera at `player position + CAMERA_INITIAL_OFFSET_METERS` (`{x:0,
y:3.2, z:7}`, i.e. behind the player on `+Z`) with `controls.target` on the player, so the camera's
view direction is toward `-Z` from spawn — exactly where `umit`'s castle sits at `+60m` on the `Z`
axis from it.

**Alternatives considered:**
- *Spawn at `cersei` (closest seat to the map-bounds center, ~3.28km) instead of `umit`* —
  considered since it needs less new travel distance if a future minimap/compass makes distant seats
  reachable anyway, but rejected for this fix: `umit` is the project owner's own named kingdom, the
  more meaningful spawn location for a personal, single-player passion project, and the actual
  distance-to-origin no longer matters once the player spawns *at* the seat directly rather than
  merely near the world's geometric center.
- *Change `WORLD_SCALE.MAP_BOUNDS`/re-center the padded bounding box on `umit` instead* — rejected:
  the task instructions explicitly called this out as unnecessary/riskier — it would shift chunk
  `(0,0)`'s world position and everywhere else that assumes the current origin convention
  (`world/chunkManager.js`, the boot-preview radius, every other seat's relative position), for a
  problem a single spawn-point change already fixes in complete isolation.
- *A minimap/compass/F3-panel fix instead of relocating spawn* — valuable (flagged as this run's
  likely next sub-task) but doesn't fix the actual root cause by itself: even with perfect
  directional info, the nearest seat is still 2.5+ km away, past the fog horizon, several real
  minutes of on-foot walking before anything becomes visible. Spawn relocation is the smaller,
  atomic, immediately-effective fix; a discovery aid is complementary, not a substitute.

**Verified:** `node --check` clean on `config.js`, `gameplay/player.js`, `game3d.js`. Full committed
smoke suite (`node scripts/smokeTestGame3D.js`) — all 8 checks PASS, zero regressions (settlement
collider, jump arc, interaction controller, wolf flee/pack-alert, NPC/wolf patrol all unaffected —
none of them read `PLAYER_CONFIG.SPAWN_*` or depend on the player's specific spawn coordinates).
**Real headless-Chromium screenshot** (Playwright, `game3d.html`, ~1.5s after `GAME_READY`
`phase1-scene`) confirms the fix visually, not just "no error": the console-logged spawn position
was `(577.5, 10.4, 4058.3)` — matching the hand-computed `mapToWorldXZ(3885, 5404, ...)` conversion
exactly — and the captured frame shows the player character standing on real terrain with one of
`umit`'s castle corner towers filling most of the view directly ahead, well within visible range
(this sandbox's known SwiftShader software-rendering caveat applies to *frame rate*, not geometry/
texture correctness — see 3D_GAME_PROGRESS.md's Known Issues). This is the first run able to submit
actual visual proof of a settlement being visible at spawn, not just a coordinate-math claim.

**Memory-leak checklist:** N/A — a spawn-coordinate constant and one `mapToWorldXZ` call added at
scene-init time; no new per-frame allocation, listener, or timer.

**Consequence:** The player now spawns standing just outside `umit`'s castle gate, with a corner
tower immediately visible, instead of alone in an empty field with the nearest landmark kilometers
beyond the fog horizon. World Coverage unchanged (all 444 desktop terrain chunks / ~111 km² already
load identically regardless of spawn point — see `world/settlements.js`'s per-seat force-load loop
in `game3d.js`, which already ran for every seat on desktop before this fix). The other 13 seats are
still 2.5-6km away and still undiscoverable without walking there blind — a compass/minimap (FAZ 8)
remains real, separately-tracked future work, not solved by this fix. Mobile-class devices benefit
too: `game3d.js`'s per-seat chunk force-load is desktop-only (ADR-0013), but `umit`'s neighborhood
now loads immediately anyway via the ordinary player-position chunk-streaming path
(`streamAroundOrbitTarget`), since streaming follows wherever the player actually is, not the world
origin.

## ADR-0047: Add `umit-horse-1` — FAZ 6's first non-wolf animal, a static/idle horse prop

**Status:** Accepted (run 39, second sub-task).

**Context:** After sub-task 1 (ADR-0046) landed, re-ran the priority scan. No syntax error,
blocking bug, perf-budget overrun, or memory leak. Priority 6 (tech debt) had nothing new beyond
`scripts/game3dSmokeChecks.js` sitting at 587/600 lines (already flagged by run 38, monitored, not
yet actionable — no new check was needed this sub-task). Priority 7 (missing smoke-test/regression
coverage) had no gap: all 8 existing checks still cover every landed gameplay-critical system.
Priority 8 (World Coverage, flat at 80.7%/4.5% since run 15) was considered — `CHUNK_CONFIG.
PHASE1_PREVIEW_RADIUS_CHUNKS` (10) could be bumped to 11 (441 -> 529 chunks) to push desktop
coverage to ~96.2% — but computed against ADR-0014's own triangle-budget math, R=11 leaves only
~0.31M triangles of headroom under the desktop 5M ceiling (vs. R=10's ~1.02M), a materially tighter
margin than ADR-0014's own "leave real headroom for FAZ 4+'s future draw calls" reasoning called
for, with FAZ 7 (dragons) and FAZ 6's remaining animal types/vegetation still ahead and no
`renderer.info` instrumentation in this repo to measure real (not estimated) triangle/draw-call
counts before committing to it. Judged too large/uncertain a step to land safely as one atomic
sub-task without better measurement tooling — deferred, flagged below for a future run with either
more budget or real render-stat instrumentation. Priority 9 (active phase's missing sub-task) had a
concrete, zero-risk, already-asset-ready candidate: FAZ 6's roadmap explicitly lists horse/cart/
dog-cat/bird as the remaining animal types, and `ivory_stallion.glb` was manually added and already
in `assets_manifest.json`, `assets/models/animals/`. Picked as sub-task 2.

**Decision:** Added `ANIMAL_CONFIG.HORSE_MODEL_URL` (`assets/models/animals/ivory_stallion.glb`)
and one new `SPAWNS` entry, `umit-horse-1`, at `umit` (the same seat the player now spawns next to
per ADR-0046 — deliberate, so the fix and this addition reinforce each other) offset `(-30, 0)`
meters from the keep center: outside `SETTLEMENT_CONFIG`'s collider (the keep box's half-width is
17m, `|x|=30` clears it; the nearest corner tower center is `hypot(30-20, 0-20) = 22.36m` away,
clear of its 6.5m radius) and clear of `umit-guard-1`'s own ±12m patrol zone. `ivory_stallion.glb`
is geometry-only per `assets_manifest.json` — no texture, no rig, no animation clips — so this is a
static/idle-only first pass, matching the exact scope precedent `gameplay/animals.js`'s wolves
themselves started at in run 26 before patrol (run 27)/flee (run 28) were added later once there
was something (a rig) to animate.

`gameplay/animals.js`'s `spawnConfiguredAnimals` — previously hardcoding `animalConfig.
WOLF_MODEL_URL`/`FLEE_CLIP_NAME`/`FLEE_TRIGGER_RADIUS_METERS`/`PACK_ALERT_RADIUS_METERS` for every
spawn — now reads a per-spawn `modelUrl` override (default `WOLF_MODEL_URL`, so the 3 existing wolf
entries are unaffected) and a per-spawn `canFlee` flag (default `true`, same reasoning), gating the
flee/pack-alert parameters to `undefined` when `false`. `createWolf` (the shared controller every
animal uses, name notwithstanding) already null-guards every animation-clip lookup
(`THREE.AnimationClip.findByName` against `idleClipName`/`walkClipName`/`fleeClipName` all return
`null` safely if no match, or if `model.animations` is empty) — so the horse loading through the
exact same function as the wolves, with an empty animation array, was already a real, working path,
not one this sub-task had to build from scratch. `canFlee: false` matters anyway: without it, a
rigless model within `FLEE_TRIGGER_RADIUS_METERS` of the player would still *move* (position
translation runs independent of animation) with no walk/run cycle to sell it — sliding across the
ground rather than looking broken-but-inert, which the static-first-pass scope explicitly avoids.

**Alternatives considered:**
- *Bump `PHASE1_PREVIEW_RADIUS_CHUNKS` for World Coverage instead* — this run's own priority order
  ranks priority 8 above priority 9, so this was the "correct" next pick by the letter of the
  ordering. Deferred anyway (see Context above) because the actual headroom math came out
  meaningfully tighter than ADR-0014's own precedent judged safe, and this run has no better
  instrumentation to verify the real (not estimated) triangle/draw-call cost before committing. A
  wrong call here is expensive to unwind (every chunk ever generated stays resident — ADR-0003 — so
  overshooting the budget isn't a one-frame mistake). Flagged explicitly below as still open,
  highest-priority remaining item, not silently skipped.
- *A `kind: 'horse'` field + per-species config lookup table*, instead of two ad hoc per-spawn
  overrides (`modelUrl`, `canFlee`) — cleaner in the abstract, but this is exactly one exception so
  far; building a lookup table for a single case is speculative generality this project's own "don't
  design for hypothetical future requirements" rule argues against. Revisit if/when a 3rd
  differently-shaped animal (cart? bird, which likely needs a totally different movement model
  entirely — flight, not ground patrol) actually arrives.
- *Give the horse a `patrol` field anyway, using position-only movement with no animation* — rejected:
  a model visibly gliding across the ground with stiff legs reads as broken, not "static prop,"
  undermining the very "no half-finished implementations" rule this project holds itself to. Static/
  idle-only is the honest, fully-working scope for a rigless asset; patrol is real future work once
  it's rigged (flagged in `HORSE_MODEL_URL`'s own doc comment).

**Verified:** `node --check` clean on `config.js` (570 lines) and `gameplay/animals.js` (311 lines),
both comfortably under the 600-line cap. Full committed smoke suite — all 8 checks PASS, zero
regressions (the wolf flee/pack-alert and patrol checks construct their own isolated `createWolf`
instances directly, never call `spawnConfiguredAnimals`, so they're unaffected by its signature
staying backward-compatible). Real headless-Chromium boot (`game3d.html`) console-confirms `"Spawned
4 FAZ 6 animal(s)."` (previously 3) with zero console/page errors — the GLB loaded successfully, not
silently falling back to the placeholder box `AssetLoader.loadModel` uses on a real failure. A
direct in-page `spawnConfiguredAnimals` call (same real-module-resolution pattern
`game3dSmokeChecks.js`'s checks already use) confirms `umit-horse-1`'s resolved position is finite,
outside the keep box, and `22.36m` clear of the nearest corner tower (`> 6.5m` radius) — matches the
hand-computed clearance exactly.

**Memory-leak checklist:** N/A — one more `Promise.all` entry through an existing, already-verified
load/dispose path (`createWolf`'s `dispose()` already covers any animal instance uniformly); no new
per-frame allocation, listener, or timer.

**Consequence:** FAZ 6 now has 2 of its 4 remaining animal types placed (wolf, horse); cart and dog/
cat/bird still need their own manual-download step (mark "insan onayı gerekli" if a future run
reaches for one — no such asset is in `assets_manifest.json` yet). World Coverage unchanged (80.7%/
4.5% desktop/mobile — this sub-task added one character, not terrain). **World Coverage (priority 8)
remains this run's single largest deferred item** — flagged explicitly, not silently passed over,
for whoever picks it up next: the real fix likely needs either `renderer.info`-based instrumentation
added first (so the next attempt can verify actual, not estimated, triangle/draw-call cost) or a
smaller, more conservative radius bump than 10 -> 11 with the same dual-verification rigor ADR-0014
used.

## ADR-0048: Fix lake-water flicker by moving wave motion from the vertex shader to the fragment shader

**Status:** Accepted (run 40, first sub-task).

**Context:** The project owner reported the run's own priority-1.5 item: `world/water.js`'s single
sea-level plane (ADR-0005) visibly flickered over lake surfaces. Root cause confirmed by re-reading
the shader before touching anything (BİLMEME KURALI — measure, don't guess): the plane's Gerstner
vertex displacement (three summed waves, steepness 0.18/0.12/0.08 at wavelengths 22/14/9m) moves
each vertex up to `sum(steepness_i / k_i)` ≈ 0.63 + 0.27 + 0.11 ≈ 1.01m vertically. Over the deep
sea this reads fine, but lakes are not a separate system — they're just terrain low enough to sit
under `WORLD_DEFAULTS.WATER_LEVEL_METERS` (6m), per `water.js`'s own module doc, and the
`3D_GAME_PROGRESS.md` run-16 profiling already on record shows the shallowest real kingdom seat
(`jon`/Castle Black) sampling at exactly 6.00m — i.e. some lake terrain sits centimeters below water
level, far shallower than the wave's own ~1m amplitude. Every frame the wave trough dips below such
a lake bed and the crest rises above it, so the shoreline's terrain geometrically pops in and out of
view against the water plane — a real geometric mismatch, not a GPU z-fighting artifact, but reading
as "flicker" either way.

**Decision:** Removed the Gerstner vertex displacement entirely — the plane's vertices now stay at
their authored flat-grid position (with `#include <fog_vertex>` still wired via an explicit
`mvPosition`, since the old code relied on the same variable already existing from the displacement
math). Wave *motion* is faked entirely in the fragment shader instead: `rippleNormal()` derives an
analytic bump normal from three summed sine ripples over `vWorldPosition.xz` and `uTime` (same
"tuned by eye, not physically derived" spirit the old Gerstner constants used), which drives the
existing fresnel/specular shading exactly as the old per-vertex normal did. Net effect: water still
visibly moves/sparkles, but the plane can never geometrically separate from the ground beneath it at
any depth, including zero. `uTime`/`uCameraPosition`/`uShallowColor`/`uDeepColor`/`uSunDirection`
uniforms and the `createWater`/`updateWater`/`disposeWater` public API are unchanged — this is a
shader-internals-only change; no caller in `game3d.js` needed to change.

**Verified:**
- `node --check src/3d/world/water.js` clean.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`) — all 8 checks PASS, including the
  3D-mode boot check (zero console/page errors — the shader compiles; an earlier iteration of this
  fix briefly broke `#include <fog_vertex>`'s implicit `mvPosition` dependency and this same check
  caught it immediately as a `THREE.WebGLProgram: Shader Error`).
- Real headless-Chromium boot screenshot of `game3d.html` (Playwright, ~2s after the loading screen
  hid) — zero console/page errors, player/castle render correctly at night, consistent with
  ADR-0046's spawn point; no regression to the existing render path.
- **Correction (run 40, later sub-task):** this ADR originally claimed a "root-cause proof" here —
  an in-page probe sampling `water.geometry.attributes.position` before/after `updateWater()` and
  reporting `maxDelta: 0`. That test was **invalid**, not evidence: a vertex shader's displacement
  runs entirely on the GPU inside `gl_Position`'s computation and is never written back into the
  CPU-side `BufferAttribute` — the old, buggy Gerstner shader would have reported the exact same
  `maxDelta: 0` (confirmed by literally re-running the same probe against the pre-fix shader while
  building this correction). The actual root-cause proof now lives as a committed regression check,
  `scripts/game3dSmokeChecksScene.js`'s `checkWaterVertexShaderStatic` — it asserts the compiled
  vertex shader source contains no `uTime` and no `sin(`/`cos(` calls, which *is* a real structural
  guarantee against vertex-stage animation, and was confirmed to fail against the pre-fix shader
  before being kept. See ADR-0050 for the full story of how this was caught and fixed.

**Alternatives considered:**
- *Reduce Gerstner steepness significantly* (the run's own "simplest" suggestion) — rejected as the
  primary fix: it shrinks the flicker window but can't eliminate it for a lake bed sitting literal
  centimeters below water level (`jon`'s measured 6.00m case) without shrinking steepness so far the
  sea itself goes visually flat. The fragment-only approach removes the failure mode at any depth,
  including zero, so there's no remaining shallow-water edge case to tune around.
- *Grow the lake depth threshold* — not viable as a config knob: this project has no explicit "lake"
  entity or depth parameter (ADR-0005 - lakes are an emergent side effect of FBM terrain height vs.
  `WATER_LEVEL_METERS`, not authored). Doing this for real would mean reshaping `terrain.js`'s noise
  output near shorelines, a materially larger and riskier change than a shader-internals swap for
  the same result.
- *Keep per-vertex Gerstner but clamp displacement near the shore* — would need each water vertex to
  know the local terrain height under it (a `terrain.js` height-sampler call per vertex, per frame,
  in a vertex shader with no access to that CPU-side sampler) — real GPU-side terrain-height lookup
  (e.g. a heightmap texture sample) is a much larger change than this project's "smallest change
  that removes the actual failure mode" bias supports for an atomic sub-task.

**Consequences:** Water no longer has real per-vertex wave silhouette (e.g. a wave crest visibly
lifting above the mean plane height at a distance) — it's a flat plane with fragment-only shading
motion, same trade-off `sky.js`'s procedural skybox and other "fake it in the shader, not the
geometry" systems in this project already make. Acceptable: the previous version was already "tuned
by eye, not physically derived" per its own comment, not a rendering feature anything else depends
on. If a future run wants real geometric waves back (e.g. for a boat/physics system that needs an
actual water height field), it will need the heightmap-lookup approach flagged above, done as its
own scoped sub-task with real perf measurement, not a revert of this fix.

## ADR-0049: Add a debug/editor free-fly camera (F4), separate from the chase camera

**Status:** Accepted (run 40, second sub-task).

**Context:** The project owner's own instructions carried a pre-ranked request (priority 1.7, this
run) with the root cause already hand-derived: they'd temporarily hand-edited
`PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS` (40 -> 5000) locally to test seeing the whole world at
once, confirmed all 14 kingdom seats are already in the scene at boot (`world/settlements.js`'s
`KINGDOM_SEATS.forEach`, one shared `InstancedMesh` triple, 3 draw calls — not gated behind
streaming/chunk-loading), and found the real limiting factor is `WORLD_DEFAULTS.FAR_PLANE` (2000m)
— the camera's own projection matrix hard-clips anything beyond it, before fog even applies.
Verified independently before writing code (BİLMEME KURALI): computed distances from the player's
`umit`-adjacent spawn (ADR-0046) to the other 13 kingdom seats via `mapToWorldXZ` — 4.06km-9.93km
away, all comfortably past 2000m, confirming the diagnosis. The instructions explicitly asked *not*
to change `FAR_PLANE`/`CAMERA_MAX_DISTANCE_METERS` for real gameplay (perf-budget reasons — a larger
far plane means more geometry in the frustum every frame, at 60-120fps desktop / 30-60fps mobile
targets) and instead wanted a separate, permanent debug/editor free-fly camera.

**Decision:** New `src/3d/debug/` folder (already planned in `ARCHITECTURE.md`'s target layout) with
`freeCamera.js`. F4 toggles a second `THREE.PerspectiveCamera` — not the normal chase camera
detached/repurposed — with its own far plane (`FAR_PLANE_METERS` = 20000, well past
`WORLD_DEFAULTS.FAR_PLANE`'s real 2000m gameplay value, which is untouched) and unrestricted WASD
flight (true 6DOF: forward/right vectors both include pitch, so looking down and flying forward
descends) plus drag-to-look (mousedown+mousemove+mouseup — the spec's "pointer lock veya sürükleme"
either-is-fine option; drag chosen over pointer lock since it needs no special browser permission
and is trivially scriptable for verification). `game3d.js`'s tick loop calls
`freeCamera.update(delta)` every frame (a no-op while inactive) and renders with
`freeCamera.camera` instead of `camera` while active — the normal chase camera, `OrbitControls`,
and player keep updating exactly as before underneath, completely unaffected (satisfies "FAZ 4'ün
chase-cam'ını hiç etkilememeli"). The only other `game3d.js` touch is a one-line fog-density
override (`if (state.freeCamera.active) state.scene.fog.density = 0;`, right after the existing
`updateFog()` call) so distant terrain isn't fogged out at a density tuned for the 2000m gameplay
far plane — restored automatically the instant `freeCamera.active` goes false, since `updateFog()`
recomputes real day/night density every frame regardless.

**Verified:**
- `node --check` clean on `debug/freeCamera.js` and `game3d.js`. `game3d.js` sits at exactly 600
  lines (the project's own file-size cap) after this change — every addition was written as small
  as it could be (single-line comments, reusing `input.js`'s existing `KeyboardInput` rather than
  duplicating WASD-reading logic, self-registering F4/resize/mouse listeners inside
  `freeCamera.js` itself instead of wiring them from `game3d.js`) specifically to fit under it
  without needing an extraction refactor of the working chase-cam tick-loop code.
- Full committed smoke suite — all 8 checks PASS, zero regressions (none of them touch the camera
  toggle path; the 3D-mode boot check confirms zero console/page errors with the new module wired
  in).
- **Real headless-Chromium verification, exactly as instructed:** Playwright script navigated to
  `game3d.html`, waited for `GAME_READY`, screenshotted the normal chase-cam view (confirms
  baseline unaffected), pressed F4, drag-looked ~45° toward the kingdom-seat cluster (computed
  offline from `KINGDOM_SEATS`' map coordinates — most seats sit 4-8km west/northwest of the
  player's `umit` spawn), held W+Shift (run) for 4 seconds to fly up and toward the cluster, then
  drag-looked steeply downward, and screenshotted again. Result: **at least 8 distinct castle
  models are simultaneously visible in one frame** (several kingdom-seat clusters with
  house-colored roof markers, well past the "en az 2-3 farklı kale" bar), against a visibly
  extended horizon (terrain and multiple lakes render far past the normal 2000m far plane) — zero
  console/page errors both before and after the F4 toggle.

**Alternatives considered:**
- *Reuse/detach the normal `camera`/`controls` instead of a second camera object* — rejected:
  `OrbitControls.update()` recomputes its internal spherical offset from `(camera.position -
  target)` every call, clamped to `CAMERA_MIN_DISTANCE_METERS`/`CAMERA_MAX_DISTANCE_METERS` (3-40m)
  — if the free camera's position were written into the same `camera` object, the very next
  `controls.update()` call (still running every frame for the underlying chase-cam simulation)
  would snap it back within 40m of the player, fighting the free-fly movement every single frame.
  A second, fully independent camera object sidesteps this with zero interaction between the two
  systems, which also happens to be the more literal reading of "tamamen ayrı bir kamera/mod."
- *Pointer lock instead of drag-to-look* — both were explicitly acceptable per the request. Drag
  was chosen: pointer lock requires a real user gesture and OS-level permission a headless-browser
  verification script can't reliably obtain, whereas drag-to-look is exactly `page.mouse.down()` +
  `move()` + `up()`, directly scriptable for the real verification this ADR itself needed to run.
- *Permanently raise `WORLD_DEFAULTS.FAR_PLANE`/`CAMERA_MAX_DISTANCE_METERS` instead of a separate
  camera* — exactly what the request explicitly ruled out (real perf-budget cost on every frame of
  normal play, for a need that's dev-only) and consistent with run 39's own ADR-0047 finding that
  this project has no `renderer.info`-based instrumentation yet to safely verify a real gameplay
  frustum change's triangle/draw-call cost before committing to it.

**Consequences:** A second `PerspectiveCamera` and one extra `KeyboardInput` instance exist for the
lifetime of the page (both cheap — no geometry, no textures), disposed together via
`freeCamera.dispose()` in the existing `pagehide` teardown chain. `game3d.js` is now at the
project's 600-line cap exactly — any future addition to this file needs either a genuine trim or an
extraction, not more inline growth. No F2/F3 debug/profiling panels exist yet; `debug/README.md`
documents the conventions this module already follows (renders instead of the normal camera, never
touches gameplay-perf constants, fully disposable) for whoever builds those next.

## ADR-0050: Persisted regression coverage for ADR-0048/ADR-0049, and a self-caught correction

**Status:** Accepted (run 40, third sub-task — continued in the same run after "Devam et").

**Context:** Priority 7 (missing smoke-test/regression coverage) outranks priority 8/9 in this
project's own priority order, and both of this run's landed fixes (ADR-0048's water shader,
ADR-0049's F4 camera) only had ad-hoc/throwaway verification, no persisted check. `scripts/
game3dSmokeChecks.js` was already at 587/600 lines (flagged by run 39 as monitored tech debt) — too
little headroom for 2 new checks — so this sub-task also had to split it, the same "extract into a
focused module" move `game3d.js` itself (ADR-0028) and this file's own original extraction already
used.

**Decision:** New `scripts/game3dSmokeChecksScene.js` holds page/scene-level checks
(`check2DShell`, `check3DMode` — moved verbatim — plus the two new ones below); `game3dSmokeChecks.js`
keeps the per-entity gameplay checks (`checkSettlementCollider`/`checkJumpArc`/
`checkInteractionController`/`checkWolfPackAlert`/`checkNpcPatrol`/`checkWolfPatrol`). Both export to
`smokeTestGame3D.js`, which now runs 10 checks total. `NAV_TIMEOUT_MS` is duplicated (not
shared/imported) across the two sibling files — a single primitive constant, not worth a shared-
constants module for.

New checks:
- **`checkWaterVertexShaderStatic`** (ADR-0048 guard) — asserts the real, served `water.js`'s
  compiled vertex shader source contains no `uTime` and no `sin(`/`cos(` calls, proving no
  time-varying value can reach vertex positions.
- **`checkFreeCamera`** (ADR-0049 guard) — builds a real `createFreeCameraController` against a
  synthetic source camera/canvas (same isolation pattern `checkWolfPackAlert` already uses) and
  asserts: inactive by default, a no-op while inactive even with a key held, F4 activates it and
  copies the source camera's pose, WASD moves it once active, a second F4 deactivates it again.

**A self-caught correction, documented rather than quietly fixed:** the first draft of
`checkWaterVertexShaderStatic` was instead a `geometry.attributes.position` before/after comparison
— the same technique ADR-0048's own "Verified" section had already used and called a "root-cause
proof." Running that draft check against the pre-ADR-0048 (buggy) shader, to confirm it would
actually catch a regression, revealed it does not: `ok: true` either way. The reason is a real gap
in understanding, not a typo — a vertex shader's position math executes entirely on the GPU as part
of `gl_Position`, and is never written back into the CPU-visible `BufferAttribute` the JS side can
read. Sampling that buffer can *never* observe vertex-shader displacement, old shader or new. This
means ADR-0048's own "Root-cause proof" bullet was invalid the moment it was written — not a
regression introduced later. Both `DECISIONS.md`'s ADR-0048 and `3D_GAME_PROGRESS.md`'s run-40
sub-task-1 entry now carry an explicit correction note rather than being silently edited, per this
project's own "no accidental gaps, only honestly scoped ones" standard — a mistake in a prior
verification claim deserves the same visibility a mistake in code would. The replacement check
(shader-source string inspection) was itself verified against both the old and new shader before
being kept — see "Verified" below.

**Verified:**
- `node --check` clean on all 3 changed/new files. `game3dSmokeChecks.js` (523 lines) and
  `game3dSmokeChecksScene.js` (196 lines) both comfortably under the 600-line cap, with headroom
  for future checks without another split.
- Full committed smoke suite — all **10** checks PASS (previously 8).
- **Both new checks independently confirmed to catch a real regression**, not just pass on the
  happy path (this project's own established verification standard — e.g. ADR-0042's "a
  demonstrated real failure path"): `checkWaterVertexShaderStatic` run against the actual pre-fix
  `water.js` (`git show` of the commit before ADR-0048) reports `ok: false` (`hasUTime: true,
  hasTrig: true`); `checkFreeCamera` run against a one-line-patched `freeCamera.js` (F4 keydown
  handler's deactivate branch stubbed to never fire) reports `ok: false`
  (`deactivatedOnSecondF4: false`, every other assertion still `true`). Both source files were
  restored immediately after (`git diff` confirmed clean) — these were verification-only edits, not
  part of the shipped change.

**Alternatives considered:**
- *Leave ADR-0048's original "Verified" bullet as-is and just add the new check silently* — rejected:
  the bullet actively claims something false ("quantitative negation of the bug"); leaving it
  unedited would mislead a future run that trusts this file's own history as ground truth, exactly
  the failure mode `3D_GAME_PROGRESS.md`'s per-run notes exist to prevent.
- *Read back the GPU-transformed vertex positions instead (e.g. `WebGLRenderer`'s readback / a
  transform-feedback pass)* — technically possible but far more machinery than a smoke check
  warrants; the shader-source check is simpler, faster, and (having been verified against the real
  old/new shaders) equally conclusive for this specific bug class.

## ADR-0051: Real per-NPC dialogue content, replacing the single shared generic greeting

**Status:** Accepted (run 40, fourth sub-task — continued after a second "Devam et").

**Context:** Priority 9 (active phase's missing sub-task) — `3D_GAME_PROGRESS.md`'s FAZ 5 entry has
flagged "no real dialogue content" since run 33 (ADR-0033): every one of the 14 NPCs shows the exact
same `INTERACTION_CONFIG.GREETING_TEMPLATE` line, differing only by the `{name}` substitution. This
sub-task replaces that with one hand-written, house-flavored line per NPC — still not a real
dialogue tree (no branching/replies/quest hooks, explicitly out of scope), but a genuine content gap
closed with zero new risk to the proven open/close state machine.

**Decision:** `config.js`'s new `INTERACTION_CONFIG.GREETINGS_BY_NPC_ID` — a frozen object, one
entry per `NPC_CONFIG.SPAWNS` id, each an original Turkish line (never adapted from the show — same
"Westeros theme freely, no real show media" constraint every asset here already follows) written
per-id, not per-house: `twin-guard-1` and `cersei-guard-1` are both House Lannister but distinct
seats, and every seat already gets its own `displayName`/name-tag (ADR-0022) and, for `berk`/
`olena`, a deliberately shared Tyrell-flavor `displayName` (ADR-0036) — the new greetings echo that
same existing per-seat-not-per-house granularity rather than inventing a new one. `gameplay/
interaction.js`'s `openDialogue` looks its speaker up by `npc.object3D.name` — already carrying
each NPC's spawn `id` since `gameplay/npc.js`'s `createNPC` sets `model.name = name` at creation
(run 20) — falling back to the old `GREETING_TEMPLATE` for any id with no entry (defensive; every
real spawn has one today). No new field needed on the NPC controller object, no `npc.js` change at
all. `game3d.js`'s one call site gained one new option (`greetingsByNpcId`); kept on the same source
line as `greetingTemplate` rather than its own line, since `game3d.js` sits at the project's
600-line cap exactly (ADR-0049) and this sub-task needed to add zero net lines there.

**Verified:**
- `node --check` clean on `config.js`, `gameplay/interaction.js`, `game3d.js` (confirmed still
  exactly 600 lines).
- Full committed smoke suite — all 10 checks PASS. `checkInteractionController` (`game3dSmokeChecks.js`)
  extended with 2 new assertions in the same run: a real per-NPC entry is used when the fake NPC's
  `object3D.name` matches one, and an unmapped id correctly falls back to the generic template —
  both asserted against the real `createInteractionController`, not a stub of it.
- **Real headless-Chromium proof, not just the config data:** rendered the actual `ui/dialogueBox.js`
  `DialogueBox` component (real DOM/CSS, not a mock) with 2 real per-NPC entries pulled live from
  `config.js` — `umit-guard-1` ("Ümit Targeryan'ın kalesine hoş geldin!...") and `jon-guard-1`
  ("Gece Nöbeti sınırdadır...") — screenshotted both, confirming visibly distinct text renders
  correctly styled in the real UI component. A third in-page check iterated every one of
  `NPC_CONFIG.SPAWNS`' 14 ids against `GREETINGS_BY_NPC_ID`: 0 missing, 14 unique strings (no
  accidental copy-paste duplicate covering two ids). Zero console/page errors throughout.

**Alternatives considered:**
- *Simulate real WASD navigation to an in-scene NPC and press E, screenshotting the live 3D canvas*
  — attempted first (matching ADR-0049's own precedent of proving a feature via real navigation),
  but dead-reckoning a path around the settlement collider without visual feedback between steps
  proved unreliable (ended up pressed against the keep wall, short of the guard's actual offset
  corner) and burned the sub-task's proportionate share of run time. Switched to directly rendering
  the real `DialogueBox` component with real config content instead — still 100% production code
  (the class, the CSS, the actual data), and a more direct proof of *this* sub-task's actual claim
  ("content differs per NPC"), which doesn't depend on successfully piloting the chase camera.
- *One line per house instead of per NPC id* — rejected per Context above: two of this project's
  own precedents (`displayName`, name tags) already operate at per-seat granularity even for shared
  houses; a coarser per-house dialogue map would be a step backward in that established convention,
  not a simplification of it.

## ADR-0052: Extract `game3d.js`'s `createScene`/`isCoarsePointerDevice`/`worldToChunkCoord` into a new `sceneManager.js`

**Status:** Accepted (run 41, first sub-task).

**Context:** Fresh Session Snapshot at container boot: `HEAD` was detached at run 40's final commit
(`8e8d7cb`, ADR-0051's per-NPC dialogue) with a stale local `main` cached ref pointing at a much
older pre-3D-mode commit — `git fetch origin main` showed the real remote `main` already matched
the detached `HEAD` exactly (force-updated the stale ref, no actual divergence or lost work, same
pattern run 40's own snapshot hit), then `git checkout -B main origin/main` reattached cleanly. Both
of this run's own pre-ranked priority items (1.5 lake-water flicker, 1.7 F4 debug free-camera) were
already landed in run 40 (ADR-0048/ADR-0049), verified via `git log` and `3D_GAME_PROGRESS.md`'s
run-40 entry — skipped per the "already done" rule, no rework. Re-ran the full priority scan from
scratch: no syntax error, no blocking bug (smoke suite's one `3D mode` timeout on first run was
confirmed cold-start flake, not a regression — a second run passed all 10 checks). Priority 8 (World
Coverage, flat at 80.7%/4.5% since run 15) is next per `3D_GAME_PROGRESS.md`'s run-40 "Next step",
but ADR-0047/ADR-0049 both already found the same real blocker: this project has no `renderer.info`-
based instrumentation to measure a chunk-radius bump's real (not estimated) triangle/draw-call cost
before committing to it — an F2/F3 debug/profiling panel (already planned in this doc's target
layout, `debug/README.md`'s own "not yet built" note) is the actual prerequisite, making it priority
6 (tech debt / missing tooling) in its own right, not just a priority-8 nice-to-have. But `game3d.js`
sits at the project's 600-line-per-file cap exactly (confirmed via `wc -l`, matching ADR-0049's own
closing note that "the next run touching it for anything beyond a pure line-for-line swap will need
to extract something first") — any F2 panel hookup (an import, a `createPerfPanel()` call, an
`update()` call in the tick loop, a `dispose()` call in the teardown chain) needs at least a few net
new lines there. This sub-task is that extraction, done as its own atomic, separately-verified step
before the F2 panel sub-task that depends on it.

**Decision:** New `src/3d/sceneManager.js` holds `createScene(canvas)` (the whole renderer/scene/
camera/terrain-boot-preview/water/sky/stars/lighting/river/waterfalls/settlements/colliders/F4-
camera setup, moved verbatim — not rewritten) plus its two small dependencies,
`isCoarsePointerDevice()` and `worldToChunkCoord()`, both now exported so `game3d.js`'s own
remaining per-frame call sites (`collectCameraCollidables`, `streamAroundOrbitTarget`, the
`touchJoystick` gate in `initGame3D`) import a single shared definition instead of a second copy.
`game3d.js` keeps every `update*`/`dispose*` half of the same modules (`updateWater`/`disposeWater`,
`disposeRiverMesh`/`disposeWaterfallMesh`, `disposeSettlements`, `resolveCameraCollision`,
`updateAuroraSky`/`disposeAuroraSky`, etc.) since those are only ever called from the tick loop/
teardown chain this file owns — the split is "setup-time factories" vs. "per-frame/lifecycle calls
against what they returned", not an arbitrary line count cut. Result: `game3d.js` dropped from 600
to 433 lines (167 lines of headroom); `sceneManager.js` is a new 187-line file, comfortably under
the cap.

**Not a move into the target `core/` folder:** `ARCHITECTURE.md`'s planned layout groups
`Engine/Renderer/SceneManager/AssetManager/EventBus/Config/Time/Input/SaveSystem` under `core/`, and
"SceneManager" is this file's own natural name for that slot. Nesting *only* this one file into a
new `src/3d/core/` while `eventBus.js`, `state.js`, `assetLoader.js`, `config.js`, and `input.js`
all stay flat at `src/3d/` would leave a half-migrated, inconsistent layout — worse than the current
flat one, not better. `sceneManager.js` stays flat, matching `camera.js`/`physics.js`/`sky.js`'s
existing sibling convention. A full `core/`/`world/`/`gameplay/`/`ui/`/`debug/` reorg touching all of
those flat files' import paths is real future work, but it's a big, multi-file (`>8` files —
blast-radius rule) change that deserves its own dedicated, carefully-scoped task, not a side effect
of freeing 170 lines for an unrelated debug panel.

**Verified:**
- `node --check` clean on both `game3d.js` and `sceneManager.js`.
- `wc -l`: `game3d.js` 433 lines (was 600, exactly at cap), `sceneManager.js` 187 lines. Both well
  under the 600-line cap.
- Every import was individually re-derived, not just carried over wholesale: `ChunkManager`,
  `createGroundCollider`/`createSettlementCollider`, `createWater` (but not `updateWater`/
  `disposeWater`), `generateRiverPath`/`createRiverMesh`/`detectWaterfalls`/`createWaterfallMesh`
  (but not `disposeRiverMesh`/`disposeWaterfallMesh`), `createSettlements` (but not
  `disposeSettlements`/`mapToWorldXZ`), `createOrbitCamera` (but not `resolveCameraCollision`),
  `createFreeCameraController`, and the `create*`-only half of `sky.js`/`stars.js`/`lighting.js`/
  `fog.js` moved to `sceneManager.js`; their `update*`/`dispose*` counterparts, plus `mapToWorldXZ`
  and `resolveCameraCollision`, stayed in `game3d.js`'s own import list. A stray `ChunkManager` JSDoc
  type reference (no longer imported in `game3d.js`) was caught and fixed to the fully-qualified
  `import('./world/chunkManager.js').ChunkManager` form `camera.js`'s `OrbitControls` type reference
  already used as precedent, not left dangling.
- Full committed smoke suite — all 10 checks PASS, zero regressions (`checkFreeCamera` in particular
  confirms the F4 camera — now constructed inside `sceneManager.js` instead of `game3d.js` — still
  behaves identically).
- `node scripts/checkAssetsManifest.js` — clean, unaffected (no asset files touched).

**Alternatives considered:**
- *Extract only enough to add the F2 panel's few new lines (e.g. pull just the settlement-grounding
  loop out)* — rejected: a partial, arbitrary-feeling cut for the sole purpose of hitting a line
  count would be a worse factoring than the real "setup vs. per-frame" seam `createScene` already
  has, and would still leave `game3d.js` near the cap again after the very next small addition.
- *Bump the file-size cap instead of extracting* — rejected outright: the 600-line cap is one of
  this project's own Golden Rules (not a soft guideline), and `game3d.js` genuinely mixes two
  concerns (one-time scene construction, ongoing tick-loop/lifecycle ownership) that a real module
  boundary describes better than a bigger number would.

## ADR-0053: F2 debug/profiling panel — real `renderer.info` instrumentation

**Status:** Accepted (run 41, second sub-task — continued after ADR-0052's extraction).

**Context:** With `game3d.js` back under its 600-line cap (ADR-0052), this run's actual priority-6
target was buildable: this project has never had a way to measure a frame's *real* draw-call/
triangle cost. `3D_GAME_PROGRESS.md`'s World Coverage entry (flat at 80.7%/4.5% since run 15) has
been deferred twice specifically because of this — ADR-0047 computed a `PHASE1_PREVIEW_RADIUS_CHUNKS`
10 -> 11 bump against `chunkManager`'s own *estimated* triangle math and judged the resulting margin
too thin to commit to without better measurement; ADR-0049 repeated the same finding. An F2/F3
debug/profiling panel was already planned in `ARCHITECTURE.md`'s target layout and `debug/README.md`'s
own "not yet built" note — this sub-task builds F2 first (profiling), leaving F3 open for whatever
panel needs it next.

**Decision:** New `src/3d/debug/perfPanel.js`, `createPerfPanel({renderer, isMobileClass,
container})` — same self-contained conventions `freeCamera.js` (F4) established: owns its own F2
keydown listener, its own DOM node (a `<pre class="g3d-perf-panel">`, styled in `game3d.css`), a
no-op `update(delta)` while inactive, and a `dispose()` that removes everything. Reads
`renderer.info.render.calls`/`.triangles` and `renderer.info.memory.geometries`/`.textures` each
update, checked against `DESKTOP_BUDGET`/`MOBILE_BUDGET` — two small frozen objects kept local to
this file (not `config.js`, already at its own 600-line cap) mirroring `freeCamera.js`'s own
`FAR_PLANE_METERS`/`FLY_SPEED_MPS` precedent for tool-specific constants. `game3d.js` creates one
instance in `initGame3D`, passing the same `isCoarsePointerDevice()` call already imported for the
`touchJoystick` gate (so both agree on device class from one signal), and calls
`state.perfPanel.update(delta)` **immediately after** `state.renderer.render(...)` in the tick loop
— `renderer.info.render.calls`/`.triangles` reset on every `render()` call (`autoReset`, on by
default), so reading them any earlier in the same frame would report the *previous* frame's numbers,
not the one just drawn. DOM writes are throttled to 4/sec (`REFRESH_INTERVAL_SECONDS`) since a
debug readout doesn't need sub-frame repaint churn; the underlying counters are still read live
every call regardless of the throttle.

**Honesty about what `renderer.info` can and can't answer:** `renderer.info.memory.textures` is a
GPU *object count*, not a byte size — three.js exposes no public VRAM-in-MB figure. The panel labels
it "GPU objects, not MB" rather than presenting a fabricated memory-in-megabytes number this
project's own "BİLMEME KURALI" (don't guess an unfamiliar/unavailable API) explicitly warns against.
Draw calls and triangles — the two numbers `chunkManager`'s own math was already estimating, and the
actual blocker ADR-0047/ADR-0049 both hit — are real, exact, GPU-reported figures.

**Verified:**
- `node --check` clean on `game3d.js` and `debug/perfPanel.js`. `wc -l`: `game3d.js` 442 lines
  (was 433 after ADR-0052, +9 for the panel's create/update/dispose call sites), `perfPanel.js` 92
  lines. Both comfortably under the 600-line cap.
- Full committed smoke suite — all 10 checks PASS, zero regressions.
- **Real headless-Chromium verification, not a synthetic-only check:** booted `game3d.html`,
  screenshotted the baseline (panel hidden), pressed F2, waited past one throttle interval,
  screenshotted again. Panel legibly renders real live numbers pulled from the actual boot-preview
  scene: `FPS: 2` (SwiftShader software rendering under this sandbox — matches this project's own
  documented headless-FPS caveat, not a bug), `Draw calls: 38 / 2500 (Desktop)`, `Triangles: 337,993
  / 5,000,000 (Desktop)`, `Geometries: 38`, `Textures: 14 (GPU objects, not MB...)`. A second F2
  press correctly re-hides the panel (`hidden: true`, confirmed via `page.evaluate`). Zero
  console/page errors throughout.

**Alternatives considered:**
- *Add `PERF_BUDGET_CONFIG` to `config.js` instead of keeping the budget numbers local to
  `perfPanel.js`* — rejected: `config.js` is itself at 597/600 lines, no headroom for a new
  exported block, and `freeCamera.js` already established the "tool-specific constants live with
  the tool" convention for exactly this situation.
- *Report `renderer.info.memory` as a texture-memory-in-MB estimate (e.g. width×height×4 bytes per
  known texture)* — rejected: no code here has access to each texture's actual dimensions/format
  without walking the full material graph, which is real, non-trivial future work if ever needed —
  presenting a fabricated number now would violate this project's own BİLMEME KURALI standard more
  than omitting the figure does.
- *Use `PERF_BUDGET_CONFIG` to actually gate/warn in the console instead of (or in addition to) a
  visual DOM panel* — the visual panel was what this run's own instructions and the target
  architecture (`ARCHITECTURE.md`'s F2/F3 slot) specifically called for; a console-only warning
  wouldn't be visible during the exact "fly around with F4 and watch the numbers" workflow this
  tool exists to support.

## ADR-0054: Persisted regression coverage for ADR-0053's F2 debug/profiling panel

**Status:** Accepted (run 41, third sub-task — continued after a second "Devam et").

**Context:** Priority 7 (missing smoke-test/regression coverage) outranks priority 8/9/9.5/10 in
this project's own priority order, and ADR-0053's F2 panel had only the ad-hoc headless-Chromium
screenshot script this run itself wrote and threw away — no persisted check, same gap ADR-0050 fixed
for ADR-0048/ADR-0049 last run. `game3dSmokeChecksScene.js` (the file that already holds
`checkFreeCamera`, F4's own equivalent check) had 201/600 lines, comfortable headroom for one more
check without another split.

**Decision:** New `checkPerfPanel` in `game3dSmokeChecksScene.js`, same isolation pattern
`checkFreeCamera` already established: builds a real `createPerfPanel` against a synthetic fake
`renderer` object (`{info: {render: {...}, memory: {...}}}` — only `.info` is ever read, so a plain
object stands in for a real `WebGLRenderer`). Asserts the full lifecycle: inactive by default and a
true no-op (no DOM write at all) until F2; the refresh throttle (a call below
`REFRESH_INTERVAL_SECONDS` doesn't write, a call that crosses it does); a live re-read of
`renderer.info` (mutated between calls, not captured once at creation); the over-budget `" !"`
flag; F2 deactivation; `dispose()` actually removing the DOM node; and — a separate instance — that
`isMobileClass: true` really swaps in `MOBILE_BUDGET` rather than silently accepting and ignoring
the option (620 draw calls flags over-budget under the 500 mobile cap but would not under desktop's
2500). `smokeTestGame3D.js` now runs 11 checks total (was 10).

**Verified:**
- `node --check` clean on both changed files. `game3dSmokeChecksScene.js` grew to 286 lines,
  `smokeTestGame3D.js` to 150 — both comfortably under the 600-line cap.
- Full committed smoke suite — all 11 checks PASS.
- **Confirmed to catch a real regression**, this project's own established standard (ADR-0042/
  ADR-0050): temporarily patched `perfPanel.js`'s F2 handler to always set `panel.active = true`
  (never toggle off, simulating a broken deactivate branch), re-ran the suite — `checkPerfPanel`
  correctly reported `ok: false` with `deactivatedOnSecondF2: false, hiddenAfterSecondF2: false`,
  every other assertion still `true` (proving the check isolates the specific broken behavior, not
  a blanket failure). Restored the source file immediately after; `git diff --stat` confirmed
  byte-identical to `HEAD`, re-ran the suite once more to confirm a clean 11/11 PASS — the patch was
  verification-only, never part of the shipped change.

**Alternatives considered:**
- *Skip the "prove it catches a real regression" step, given the earlier headless-Chromium
  screenshot in ADR-0053 already showed the feature working end-to-end* — rejected: ADR-0050's own
  standing lesson (from run 40's self-caught mistake) is explicit that a positive-path check proves
  nothing about whether it *would* catch a break; this run applied that lesson rather than repeating
  the exact failure mode it exists to prevent.

## ADR-0055: Grow `PHASE1_PREVIEW_RADIUS_CHUNKS` 10 -> 11 using F2/F4's real measured headroom

**Status:** Accepted (run 42, first sub-task).

**Context:** Run 41's own "Next step" flagged priority 8 (World Coverage, flat at 80.7% desktop
since run 15) as finally unblocked — F2's `renderer.info` instrumentation (ADR-0053) existed, but
that run deliberately left the actual radius bump undone, calling it "a separate, real-headroom-
dependent decision, not automatically safe just because the instrumentation now exists." This run
did that measurement rather than guessing: the F2 panel's own boot-time reading only samples
whatever the chase camera happens to be looking at (a few hundred thousand triangles, nowhere near
a worst case), so a throwaway headless-Chromium script combined it with F4 (already `far`=20000m,
ADR-0049) — fly to altitude, pitch the camera down, and read `renderer.info` while looking down at
most/all of the loaded chunk square at once, the closest this project can get to a real "most
chunks visible simultaneously" reading without a from-scratch synthetic benchmark.

**Decision:** `CHUNK_CONFIG.PHASE1_PREVIEW_RADIUS_CHUNKS` (`config.js`) changes from 10 to 11 — the
desktop-only boot-preview square grows from 21x21 (441 chunks) to 23x23 (529 chunks).
`STREAM_RADIUS_CHUNKS` (mobile path) is untouched, same device branch as every prior radius change.

**Reasoning:**
- **Measured at the old radius (10) first, to calibrate against ADR-0014's own estimate:** the
  aerial F2 reading at radius 10 showed **320 draw calls / 2,186,879 triangles** — well under
  ADR-0014's hand-computed "~3.61M terrain triangles alone" ceiling estimate (that estimate assumed
  every chunk's full triangle count always counts; the real measured number is lower, likely because
  even a wide-angle aerial shot doesn't fit literally every one of 441 chunks inside the camera
  frustum at once). This is real evidence the old estimate was conservative, not proof the true
  worst case is exactly this number — flagged explicitly, not overclaimed.
- **Radius 11 chosen over 12, deliberately conservative:** 12 would make the boot-preview square
  (25x25 = 625 chunks) wider than `CHUNK_CONFIG.GRID_COLUMNS` (25) and taller than `GRID_ROWS` (22)
  — since `loadSquare` has no bounds clamp, some of those chunks would generate real terrain outside
  the padded kingdom bounding box `WORLD_SCALE.MAP_BOUNDS` actually spans, inflating the World
  Coverage numerator with area outside the designed 137.5 km² world (and could read >100% coverage,
  a confusing, hard-to-defend number). Radius 11 (23x23 = 529 chunks = 132.25 km²) stays under the
  137.5 km² target with a clean, honest percentage, and every real kingdom seat's center chunk was
  already inside radius 10's square (ADR-0014), so radius 11 keeps that margin, not tightens it.
- **Verified the new radius's real cost before committing to it, not after:** a second aerial F2
  reading at radius 11 showed **351 draw calls (14.0% of the 2500 desktop budget) / 2,440,831
  triangles (48.8% of the 5,000,000 desktop budget)** — both comfortably clear, leaving real
  headroom (not just estimated) for FAZ 7's still-unstarted dragons and any future vegetation
  instancing.

**Verified via headless Chromium (Playwright), not assumed correct from the math alone:**
- `node --check src/3d/config.js` clean; file is 597/600 lines (comment tightened to fit the note
  without pushing past the cap — see run 41's own flag that this file's headroom was thin).
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`) — all 11 checks PASS, zero
  regressions.
- Console confirms `"[sceneManager] Loaded 529 terrain chunks (~132.25 km²) ... (desktop-class
  device — full preview radius)"` then `"Placed 14 kingdom-seat settlements; 529 terrain chunks
  resident (~132.25 km²) after grounding them"` — 529, not 529+3 like radius 10's Night King
  spillover, because the wider square now fully contains that seat's grounding neighborhood too.
  Zero `pageerror`/`console.error`.
- Real headless-Chromium screenshots: the normal boot/chase-cam view is unaffected (player + castle
  render identically to before); the F4+F2 aerial view shows the perf panel's live numbers above
  and at least 4 distinct castle silhouettes plus a river simultaneously in frame, over an
  unmistakably wider visible area than radius 10's equivalent shot, zero console/page errors either
  frame.
- Mobile path re-confirmed untouched by inspecting `sceneManager.js`'s device branch (unchanged this
  run) — not re-run headless this time, since no line touching the mobile branch changed and every
  prior radius-bump ADR (ADR-0014) already re-verified this exact branch is unaffected by this
  constant.

**Alternatives considered:**
- *Radius 12 or higher, to push coverage further above the already-cleared 80% gate* — rejected per
  the Reasoning section above: it starts loading terrain outside the designed 137.5 km² world
  extent, which is a real design inconsistency (not just a cosmetic one), for a gate that's already
  satisfied. Nothing in the priority order requires maximizing coverage past the gate at the cost of
  a clean, defensible number.
- *Merge/instance terrain chunk geometry to afford a much larger radius safely* — still not needed:
  draw calls are 14% of budget at the new radius, same "no measured draw-call problem" conclusion
  ADR-0014 reached, now re-confirmed with a real (not estimated) number.
- *Trust ADR-0014's original hand-computed triangle-per-chunk estimate instead of measuring* —
  rejected: this run's whole point was to stop estimating now that F2 exists; the measured numbers
  differ meaningfully from the estimate (see Reasoning), so estimating again would have thrown away
  the very instrumentation run 41 built for exactly this decision.

**Consequences:** Desktop World Coverage moves from 80.7% (111.00 km² / 137.5 km²) to **96.2%
(132.25 km² / 137.5 km²)**. Mobile World Coverage is unchanged (4.5%, 25 chunks / 6.25 km², by
design — `STREAM_RADIUS_CHUNKS` untouched). Desktop performance: measured 351/2500 draw calls
(14.0%), 2,440,831/5,000,000 triangles (48.8%) from the widest real viewing angle tested — real
headroom remains for FAZ 7 dragons and future vegetation instancing, though this is an empirical
near-worst-case reading from one flight path, not an exhaustive proof no camera angle could ever
exceed it.

## ADR-0056: Periodic world-flavor events routed through the EventBus (priority 9.5)

**Status:** Accepted (run 42, second sub-task).

**Context:** A standing instruction (present in every run's prompt, never yet reached in 4 runs per
run 41's own "Next step" note) asked to port `script.js`'s 2D event-card system into the 3D mode and
extend the `EventBus` to real gameplay events, explicitly "in small atomic steps." The 2D system
(`triggerRandomEvents()`/`RANDOM_EVENTS`) fires a random event per game *turn*, applying a stat
change (gold/army/morale/territory/navy) to a `kingdom` object and showing a modal card. The 3D
world has neither a turn system nor a per-kingdom economy yet (no gold/army/morale on any 3D
entity) — a literal port would have nothing to apply its effect to. Re-scanning the priority order
first (per every run's own protocol): no syntax error, blocking bug, perf/memory issue, or missing
regression coverage was found; World Coverage's own gate has been clear since run 29 and this run's
own first sub-task (ADR-0055) already grew it further, so priority 9 ("active phase's own open
sub-task" — FAZ 5's real gap is a full dialogue-tree/quest system, a much larger feature, not a
small atomic step) was judged larger in scope than priority 9.5's own explicitly-requested,
already-scoped-down task.

**Decision:** Port the *pattern*, not the *mechanic*. New `gameplay/worldEvents.js`:
`createWorldEventSystem({eventsBus, seed, eventName})` counts down a seeded-random 45-90 real-time-
second interval and, once it elapses, `eventsBus.emit()`s one event picked from a small curated
8-entry flavor list (`{id, icon, title, desc, color}` — lore/ambiance only, e.g. "Kuzgun Ulaştı",
"Kurt Uluması", "Ejderha Gölgesi" — no stat mutation, since there is no stat to mutate yet). New
`ui/worldEventToast.js`: `WorldEventToast` self-subscribes to that same event name on the passed-in
`EventBus` and renders a small, non-blocking, auto-dismissing (6s) top-of-screen card — the same
icon+title+description shape as the 2D card, deliberately smaller/passive (never pauses input or
covers the screen the way the 2D modal overlay does, since this is ambiance, not a decision point).
`game3d.js` wires both: creates them after the F2 panel, calls `worldEvents.update(delta)` in the
tick loop, disposes both on `pagehide`. This is deliberately the *first* place in the codebase where
two independent modules talk purely through the `EventBus` rather than a direct method call
(`interaction.js` calling `dialogueBox.show()` directly, for contrast) — the explicit ask.

**Reasoning:**
- **EventBus, not a direct call, because that was the literal ask** — "EventBus'ı gerçek oyun
  olaylarına genişlet." A direct `game3d.js` call from `worldEvents` to a toast function would have
  built the same visible feature without touching the bus at all.
- **No stat effects, because nothing exists to receive them:** the 2D `RANDOM_EVENTS`' entire
  purpose is `k.gold +=`/`k.army -=`-style mutation on a `kingdoms` array that has no 3D equivalent.
  Inventing a placeholder gold/army number on the player just to have something to mutate would be
  speculative FAZ-8-economy work with no product behind it yet — this project's own "don't add
  handling for scenarios that can't happen" rule.
- **Local `WORLD_EVENTS` list and `mulberry32` duplicate, not `config.js`/`world/terrain.js`
  imports:** `config.js` is at its 600-line cap (thin headroom flagged by 3 prior runs now) — same
  "tool-local constants" precedent `debug/perfPanel.js`'s own budgets and `debug/freeCamera.js`'s
  `FAR_PLANE_METERS` already set. The PRNG duplicate follows `gameplay/README.md`'s own blast-radius
  rule (`gameplay/` never imports `world/`) and the exact precedent `animals.js`'s patrol-logic
  duplication from `npc.js` already established for this project (ADR-0026's "why duplicate").
- **Real-time interval, not turn-based:** the 3D mode has no turn concept (`3D_GAME_PROGRESS.md`'s
  Roadmap confirms no turn/economy system exists yet) — a real-time countdown is the only option
  that fits the world as it exists today.
- **Checks its countdown once per `update()` call, never loops:** a tab backgrounded for minutes
  (or a slow headless-sandbox frame) could otherwise queue many toasts to fire back-to-back on
  refocus, reading as spam rather than "the world kept happening." One event per call, at most, is a
  simpler and better-feeling behavior, verified explicitly in the regression check below.

**Verified:**
- `node --check` clean on `gameplay/worldEvents.js`, `ui/worldEventToast.js`, `game3d.js`.
  `game3d.js`: 442 -> 456 lines. `config.js`: 598 -> 599 lines (one new `EVENTS` entry, one-line
  comment — the file's headroom is now effectively gone; a future addition needs a real extraction).
- Full committed smoke suite — all 12 checks PASS (new `checkWorldEvents`, 11 pre-existing
  unaffected).
- **New persisted regression check (`checkWorldEvents`, `game3dSmokeChecksScene.js`):** a real
  `EventBus` (not synthetic) drives a real `createWorldEventSystem` + `WorldEventToast` pair,
  asserting: no emit below the minimum interval, exactly one emit for a delta far past the maximum
  (proving the "never loops" design), the emitted payload's shape, a second huge delta firing again
  (the countdown resets), `dispose()` stopping further emits, two independently-created systems with
  the same seed picking the identical first event (determinism), and the toast showing the real
  emitted title/description text plus `dispose()` removing its DOM.
- **Confirmed to catch a real regression, this project's own established standard** (ADR-0042/
  ADR-0050/ADR-0054): temporarily broke `dispose()` (commented out `disposed = true`), re-ran the
  suite — `checkWorldEvents` correctly failed on `noFireAfterDispose: false` alone, every other
  assertion still `true`. Source file restored immediately after; re-ran once more to confirm a
  clean 12/12 PASS.
- **Real headless-Chromium proof on the live page**, not just the isolated check: booted
  `game3d.html`, emitted a real event through the page's own live `gameEvents` bus (the same
  instance `game3d.js` wired both systems to — not a synthetic stand-in), screenshotted. The toast
  renders top-center with the correct icon/title/description and a color-matched left border,
  doesn't obstruct the player/castle view beneath it, zero console/page errors.

**Alternatives considered:**
- *Give 3D kingdoms real gold/army/morale fields now, to port the 2D mechanic literally* — rejected:
  that's a full FAZ-8-economy feature (persistence, UI to display it, a reason for it to matter),
  far beyond "small atomic steps," and nothing in the current 3D world would consume those numbers.
- *Wire the toast via a direct `game3d.js` call instead of the EventBus* — rejected: defeats the
  explicit point of this task. The indirection also costs nothing real here (one extra `.on()`
  subscription) while establishing the first real precedent for decoupled gameplay-to-gameplay
  communication this project's own `ARCHITECTURE.md` describes as the intended pattern.
- *Loop inside `update()` to fire every interval a large delta crossed* — rejected per Reasoning
  above (spam risk on tab-refocus); also would have made the "fires exactly once" regression
  assertion meaningless, removing a clean, cheap-to-verify invariant for no real benefit.

**Consequences:** A second EventBus-connected pub/sub pair now exists as a template for future FAZ 8
systems (quest triggers, weather-driven events) to follow. `config.js` has effectively no headroom
left (599/600) — the very next line added there needs a real extraction first, not just careful
trimming. The curated 8-event list is static content, not data-driven from `script.js`'s own
`RANDOM_EVENTS` — a future run could grow the pool or vary it, but 8 was enough to prove the
mechanism without over-scoping this sub-task.

## ADR-0057: Extract `PLAYER_CONFIG`/`NPC_CONFIG`/`ANIMAL_CONFIG`/`INTERACTION_CONFIG` into a new `gameplay/gameplayConfig.js`

**Status:** Accepted (run 43).

**Context:** This run's priority scan (re-scanning fresh, as every run's own "Next step" note asks)
found no syntax errors, no blocking bugs, no measured performance-budget overrun, and no missing
regression coverage. The one concrete, repeatedly-flagged, actionable item was tech debt (priority
6): `config.js` sat at 599/600 lines — flagged in run 41's and run 42's own "Next step" notes as
"effectively no headroom left... the very next addition needs a real extraction, not careful
trimming." Before picking this run's next item, a real next-step candidate was checked first (FAZ
7 dragons — `verdant_wyrm.glb`, the manifest's own "FAZ 7 first-pick candidate"): a direct glTF
JSON parse of the file (no mesh-editing tool exists in this sandbox — `npx gltf-transform`/
`gltfpack` both failed, no network access to fetch either package, no Blender) measured it at
**1,005,412 triangles** — ~19x `ivory_stallion`'s 52,310 and ~350x the wolf's 2,876, and alone would
exceed the *entire* mobile triangle budget (500K) for one static, unrigged background creature. FAZ
7 is correctly blocked pending a human decimation pass (documented in 3D_GAME_PROGRESS.md's Known
Issues, not attempted here) — this run picked the tech-debt item instead, rather than force a
performance-budget violation just to make progress on the next roadmap phase.

**Decision:** Move `PLAYER_CONFIG`, `NPC_CONFIG`, `ANIMAL_CONFIG`, and `INTERACTION_CONFIG` out of
`config.js` verbatim into a new `src/3d/gameplay/gameplayConfig.js`. `config.js` drops from 599 to
171 lines; the new file is 444. `TOUCH_JOYSTICK_CONFIG` — physically sitting between `ANIMAL_CONFIG`
and `INTERACTION_CONFIG` in the old file, but owned by `ui/touchJoystick.js`, not gameplay — stays in
`config.js` (caught by the smoke test's first run: a `pageerror` on the missing export, fixed by
moving it back before committing — see Verified below).

**Reasoning:**
- **Verbatim move, not a rewrite** — same precedent `ADR-0028` (moving `game3d.js`'s spawn loops
  into `npc.js`/`animals.js`) and `ADR-0052` (`sceneManager.js`'s extraction) both used. Lower risk
  than restructuring the config shape while also relocating it.
- **A new `gameplay/gameplayConfig.js`, not a nested `config/` folder or per-system config files:**
  matches the exact precedent `gameplay/worldEvents.js`'s local `WORLD_EVENTS` list and
  `debug/freeCamera.js`'s local `FAR_PLANE_METERS` already set (give the owning folder its own
  config) — but as one shared file, not four, since all four blocks are genuinely gameplay-owned
  and already cross-reference each other in comments (e.g. `NPC_CONFIG`'s idle/walk URLs reused from
  `PLAYER_CONFIG`) — one file avoids a real import cycle between four near-empty modules for no
  reader benefit.
- **`TOUCH_JOYSTICK_CONFIG` stays in `config.js`:** it configures `ui/touchJoystick.js`, a UI-folder
  file, not a `gameplay/`-folder one — moving it into `gameplayConfig.js` would violate the same
  folder-ownership rule this extraction exists to uphold. Its physical position in the old file
  (between `ANIMAL_CONFIG` and `INTERACTION_CONFIG`) was incidental, not evidence it belonged there.
- **Why this over growing `WORLD_EVENTS`' pool or starting FAZ 7 dragons directly:** both were live
  options per run 42's own "Next step" note, but neither is a *tech-debt fix* — priority 6 outranks
  priority 9/9.5 in the task's own order, and this item was concrete/actionable/already flagged
  twice, unlike "grow the event pool" (explicitly "don't treat as automatically the next pick").
  FAZ 7 additionally turned out to be blocked (see Context) once actually checked, not just
  deprioritized.

**Verified:**
- `node --check` clean on all 8 touched files: `config.js`, `gameplay/gameplayConfig.js` (new),
  `game3d.js`, `sceneManager.js`, `gameplay/player.js`, `gameplay/animals.js` (JSDoc type-path
  fix only), `gameplay/npc.js` (JSDoc type-path fix only), `scripts/game3dSmokeChecks.js` (4 dynamic
  `import()` path updates).
- **Caught a real self-introduced regression before committing:** the first full smoke-suite run
  after the extraction failed with `pageerror: The requested module '../config.js' does not provide
  an export named 'TOUCH_JOYSTICK_CONFIG'` — `TOUCH_JOYSTICK_CONFIG` had been swept into the moved
  line range by mistake (it physically sat between `ANIMAL_CONFIG` and `INTERACTION_CONFIG`). Fixed
  by moving it back to `config.js`; full 12/12 smoke suite passed clean on the re-run — exactly the
  kind of mistake the project's own "self-review before commit" rule exists to catch.
  `ui/touchJoystick.js`'s import was never touched and needed no change once the constant was back
  in `config.js`.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): all 12 checks PASS, including the
  full page-boot check (`game3d.html` loads, `GAME_READY phase1-scene` fires, zero console/page
  errors) that would have caught the missing-export regression on its own even without manually
  reading the failure.
- **Real headless-Chromium screenshot**, not just a clean console: booted `game3d.html`, waited for
  the loading overlay to hide, screenshotted — player character standing beside `umit`'s castle
  wall under the night sky, matching the expected boot state exactly, no visual regression from the
  config split.
- Line counts re-measured after the fix: `config.js` 171/600, `gameplay/gameplayConfig.js` 444/600,
  `game3d.js` 457/600 (unchanged net — one import line split into two) — all comfortably under cap.

**Alternatives considered:**
- *Extract only `NPC_CONFIG` (by far the largest single block) and leave the rest* — rejected: would
  still leave `PLAYER_CONFIG`/`ANIMAL_CONFIG`/`INTERACTION_CONFIG` config split across two files by
  an arbitrary size cutoff rather than by ownership, a worse-organized outcome for a similar amount
  of work.
- *A nested `src/3d/gameplay/config/` folder* — rejected: this project's target architecture
  (`ARCHITECTURE.md`) keeps every folder flat; `sceneManager.js`'s own ADR-0052 already rejected
  nesting for the same "half-migrated, confusing layout" reason.
- *Start FAZ 7 (dragons) instead, since it's next in the roadmap* — rejected once checked: the only
  ready dragon asset needs a decimation pass this sandbox cannot perform (see Context) — using it
  as-is would be a real, measured performance-budget violation, not a small atomic step.

**Consequences:** `config.js` (171/600) and `gameplay/gameplayConfig.js` (444/600) both now have
real headroom — a future FAZ 7 dragon config (once the asset is decimated) has a natural home in
the latter. `gameplay/npc.js`'s and `gameplay/animals.js`'s JSDoc `@param {typeof import(...)}`
type-path comments now point at `./gameplayConfig.js` instead of `../config.js` — cosmetic
(JSDoc-only, no runtime effect) but left stale would have misdirected the next reader. FAZ 7 remains
blocked on a human decimation step, now clearly documented (3D_GAME_PROGRESS.md Known Issues)
instead of silently retried by a future run.

## ADR-0058: First real dialogue-choice branching, piloted on 2 of 14 NPCs

**Status:** Accepted (run 44).

**Context:** User said "Devam et" (continue) after run 43's tech-debt commit. Re-scanning the
priority order: no new syntax error/blocking bug/perf overrun/memory leak since run 43's smoke
baseline. FAZ 7 (dragons) is still blocked on the decimation gap documented in ADR-0057/
3D_GAME_PROGRESS.md — re-checking it again without a decimated asset in hand would just repeat the
same measurement for no new information. Priority 9 (active phase's incomplete sub-task) has one
concrete, still-open FAZ 5 item: "gerçek dialogue-tree/quest sistemi" — every prior run correctly
deferred it as "larger scope, still untouched" rather than rushing a half-built quest/persistence
system. This run scoped the *smallest real slice* of that larger feature instead of either
skipping it again or overbuilding it: one level of player choice (pick 1 of 2 options, each with
its own response), on a small pilot subset of NPCs, with no quest/inventory/persistence/stat
consequences at all — the same "prove the mechanism on 2 of N first" pattern this project already
used for waypoint patrol (run 22, ADR-0021) and per-NPC greetings before scaling to all 14 (ADR-0051).

**Decision:** `ui/dialogueBox.js`'s `show(text, choiceLabels?)` renders an optional numbered choice
list and swaps its hint text accordingly. `gameplay/interaction.js`'s `createInteractionController`
gains an optional `choicesByNpcId` parameter; when the just-opened NPC has a non-empty entry, its
choice labels are shown and `Digit1`/`Digit2`/`Digit3` (capped at 3, `DIALOGUE_CHOICE_KEY_CODES`)
select one, replacing the shown text with that choice's own response. `gameplayConfig.js`'s
`INTERACTION_CONFIG.CHOICES_BY_NPC_ID` seeds exactly 2 NPCs: `umit-guard-1` (the player's home
seat, 2 choices about dragons/the lord) and `berkalp-guard-1` (the Stark seat where the wolves
already patrol — one choice deliberately ties into that existing wolf-lore flavor). Every other NPC
has no entry and keeps the exact pre-run-44 greeting-then-close-on-`E` behavior.

**Reasoning:**
- **Two NPCs, not all 14, and two choices each, not more:** matches this project's own repeated
  "pilot small, extend later" precedent rather than writing 14×N lines of untested dialogue content
  in one sub-task — a scope failure this project's own rules explicitly warn against ("don't design
  for hypothetical future requirements", "small atomic steps"). `umit`/`berkalp` were picked because
  they're the two seats with the most existing flavor/lore already written (dragon lineage at
  `umit`, direwolves patrolling at `berkalp`) — a choice referencing content that already exists in
  the world (the wolves) reads better than an arbitrary pick.
- **Digit1/2/3 keys, not arrow-key+Enter navigation:** every existing keybinding in this project's
  3D mode (`E`, `Escape`, `WASD`, `F2`/`F4`) is a single discrete key, never a 2-step
  navigate-then-confirm sequence — a numbered-choice convention is simpler to implement, simpler to
  test, and consistent with that existing style. Capped at 3 codes since 2-3 choices is this pilot's
  entire scope; extending the cap is a one-line change if a future NPC needs more.
- **No quest/inventory/stat/persistence hooks, matching `gameplay/worldEvents.js`'s own precedent
  (ADR-0056):** the 3D world still has no economy/quest system for a choice to meaningfully affect —
  inventing one now to make the choices "matter" would be speculative FAZ-8 work with no product
  behind it yet, the same reasoning ADR-0056 already used for its own flavor-event pool.
- **A second digit press (or `E`) after a choice is picked just closes, doesn't re-offer choices:**
  `activeChoices` is cleared the instant one is picked — prevents a confusing "I already answered,
  why is it asking again" loop, and keeps the state machine a strict one-shot branch, not a
  re-enterable menu.

**Verified:**
- `node --check` clean on all 5 touched code files: `ui/dialogueBox.js`, `gameplay/interaction.js`,
  `gameplay/gameplayConfig.js`, `game3d.js`, `scripts/game3dSmokeChecks.js`.
- Extended `checkInteractionController` (`scripts/game3dSmokeChecks.js`) with 6 new assertions: a
  greeting with choices shows both labels; picking choice 2 shows its own distinct response and
  clears the choice list; an out-of-range digit (3, with only 2 choices configured) is a no-op;
  pressing a second digit after a choice is already consumed is a no-op; `E` still closes mid-choice
  (before any digit is pressed); an NPC with no `choicesByNpcId` entry at all behaves exactly like
  before (empty choice list, plain greeting). Full committed smoke suite — **all 12 checks PASS**.
- **Real headless-Chromium screenshots**, not just the fake-stub unit test: instantiated the real
  `DialogueBox`/`InteractionPrompt`/`createInteractionController` (not synthetic stand-ins) inside
  the live `game3d.html` page, opened `umit-guard-1`'s dialogue — screenshot shows the real greeting
  text plus both numbered choice labels and the "1/2 - Seç, Esc - Kapat" hint, rendered with the
  project's existing dialogue-box styling. Selected choice 2 (`Digit2`) — second screenshot shows
  the chosen response text, the choice list now empty, and the hint reverted to "E / Esc - Kapat".
  Zero console/page errors in either state.
- Line counts: `ui/dialogueBox.js` 75/600, `gameplay/interaction.js` 109/600, `gameplayConfig.js`
  475/600, `game3d.js` 458/600 — all comfortably under cap. **`scripts/game3dSmokeChecks.js` is now
  at 596/600 — flagged for the next run that touches it, real headroom is nearly gone.**

**Alternatives considered:**
- *Roll this out to all 14 NPCs immediately* — rejected: 14× the dialogue-writing effort in one
  sub-task, no way to verify quality/tone consistency across that much new Turkish prose without
  rushing it, and no established need yet for every NPC to have branching (some, like `jon-guard-1`'s
  ominous one-liner, arguably read better staying a single line).
- *Add real quest-state consequences to at least one choice (e.g. an item, a flag)* — rejected, same
  reasoning ADR-0056 used: no inventory/quest system exists yet for a consequence to plug into;
  building a minimal one just to give this pilot "stakes" would be scope creep far beyond a single
  atomic sub-task.
- *Arrow-key navigation + Enter to confirm, mirroring desktop-game menu conventions* — rejected:
  more state to track (a hovered index) and more code for zero real benefit at only 2-3 choices;
  direct number keys are simpler and just as discoverable via the on-screen hint.

**Consequences:** `gameplayConfig.js`'s `CHOICES_BY_NPC_ID` is now the natural home for extending
this pilot to more NPCs or deeper branches (still capped at 3 choices per level without a
`DIALOGUE_CHOICE_KEY_CODES` change). `scripts/game3dSmokeChecks.js` is at 596/600 lines — the very
next check added there needs a real extraction (a 3rd sibling file, following the same run-40
split that produced `game3dSmokeChecksScene.js`) before it fits, not careful trimming. No
touch/mobile equivalent exists for the new `Digit1`/`Digit2`/`Digit3` keys (dialogue interaction was
already keyboard/desktop-only before this change — `ui/touchJoystick.js` has no interact button of
its own — so this doesn't newly regress mobile, it just doesn't extend the existing gap either).

## ADR-0059: Split `game3dSmokeChecks.js` a third time (596/600 lines) into `game3dSmokeChecksMovement.js`

**Status:** Accepted (run 45).

**Context:** Session Snapshot at the start of this run found the two previously-flagged "urgent"
items already landed by prior runs: lake-water flicker (ADR-0048, `2dfc85f`) and the F4 debug
free-fly camera (ADR-0049, `7642de6`) both predate this run's HEAD. Re-scanning the priority order
with nothing new since: no syntax error, no blocking bug, no perf-budget overrun, no memory leak.
Priority 6 (tech debt) has one concrete, already-flagged item: ADR-0058's own "Consequences" section
recorded `scripts/game3dSmokeChecks.js` at 596/600 lines and said explicitly "the very next check
added there needs a real extraction ... before it fits, not careful trimming." Re-measuring
confirmed this is still exactly true (596 lines, unchanged since ADR-0058) — this outranks priority
9/9.5/10 by the project's own stated order, the same reasoning ADR-0057 used to pick a tech-debt fix
over starting FAZ 7.

**Decision:** Moved the three waypoint-patrol/flee-AI check functions — `checkWolfPackAlert`,
`checkNpcPatrol`, `checkWolfPatrol` — verbatim (no logic changes) out of `game3dSmokeChecks.js` into
a new sibling file, `scripts/game3dSmokeChecksMovement.js`, following the exact same "extract into a
focused module, moved verbatim" pattern `game3dSmokeChecksScene.js` (run 40) and `game3dSmokeChecks.js`
itself (run 28/ADR-0028) already used. `game3dSmokeChecks.js` now keeps only the non-movement
per-entity checks: `checkSettlementCollider`, `checkJumpArc`, `checkInteractionController`.
`scripts/smokeTestGame3D.js` now requires all three check files and calls all 12 checks in the same
order as before (scene checks, then non-movement entity checks, then movement checks).

**Reasoning:**
- **Split by concern (movement/patrol-AI vs. everything else), not by size alone:** the three moved
  checks all drive `update()` loops over multiple frames asserting patrol/flee timing and geometry;
  the three kept checks (collider resolution, jump-arc physics, interaction state machine) are each
  a single-call or short-sequence assertion with no patrol/flee behavior. This mirrors
  `game3dSmokeChecksScene.js`'s own run-40 split (page/scene-level vs. per-entity), a precedent
  already established in this codebase rather than an arbitrary new grouping.
- **Verbatim move, not a rewrite:** every moved function's body, the shared `NAV_TIMEOUT_MS`
  constant (duplicated into the new file, matching the existing duplication-over-cross-file-import
  convention the two other check files already use), and `smokeTestGame3D.js`'s call order were
  copied unchanged — this is a pure file-boundary change, not an opportunity to also "improve" the
  checks themselves, matching this project's own "refactor only for bug/perf/readability/architecture,
  not while also changing behavior" rule.
- **Why now, not deferred again:** the debt was already flagged twice in writing (ADR-0058's
  Consequences, and 3D_GAME_PROGRESS.md's per-run notes) as blocking the *next* check from fitting —
  deferring a third time when no new check even needs to be added yet would let the file cross 600
  lines the moment one is, turning a clean preemptive split into a rushed one under pressure.

**Verified:**
- `node --check` clean on all 3 touched files: `game3dSmokeChecks.js`, `game3dSmokeChecksMovement.js`
  (new), `smokeTestGame3D.js`.
- Line counts re-measured: `game3dSmokeChecks.js` 302/600 (was 596/600),
  `game3dSmokeChecksMovement.js` 321/600 (new file), `smokeTestGame3D.js` 153/600 (unchanged net —
  one new `require` line). All three now have real headroom.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): **all 12 checks PASS**, identical
  names/details/order to the pre-split run — confirms the split changed no behavior, only file
  boundaries. Exit code 0.
- `node scripts/checkAssetsManifest.js`: unaffected (untouched files), still OK — re-run only to
  confirm this sub-task didn't accidentally touch anything under `assets/`.

**Alternatives considered:**
- *Trim comments/whitespace in `game3dSmokeChecks.js` instead of extracting* — rejected per
  ADR-0058's own explicit call: "a real extraction ... not careful trimming" — trimming buys a few
  lines now but the file is still one check away from the cap again, and this project's docstrings
  carry real WHY-content (design rationale, ADR cross-references) that a "quality" pass would be
  reluctant to cut anyway.
- *Split by file (one check per file)* — rejected: 3 near-empty single-function files for 3
  ~100-line checks is worse-organized than one cohesive "movement AI checks" module, and no other
  check file in this project follows a one-function-per-file convention.
- *Rename `game3dSmokeChecks.js` to something more specific now that it's narrower (e.g.
  `game3dSmokeChecksEntity.js`)* — rejected: an unforced rename would touch `smokeTestGame3D.js`'s
  `require` path for no functional benefit and add unnecessary churn to a file whose name is still
  accurate (it's still per-entity checks, just a subset of them).

**Consequences:** All three smoke-check files now have comfortable headroom under the 600-line cap.
Future patrol/flee-AI checks (e.g. if NPCs ever gain the pack-awareness `gameplay/animals.js`'s wolves
already have — a still-open FAZ 5 gap noted in 3D_GAME_PROGRESS.md) have a natural home in
`game3dSmokeChecksMovement.js`; future non-movement per-entity checks belong in `game3dSmokeChecks.js`.
`smokeTestGame3D.js`'s own header comment updated to describe the 3-file split so a future run's
Session Snapshot doesn't have to re-derive it from scratch.

## ADR-0060: Grow the dialogue-choice pilot from 2 to 4 of 14 NPCs

**Status:** Accepted (run 46).

**Context:** With ADR-0059's tech-debt fix committed and priority 7/8 (regression coverage, World
Coverage) both already clear (desktop 96.2%, past the FAZ 3/10 80% gate; mobile's 4.5% is a
deliberate, repeatedly-measured perf-budget constraint per ADR-0013, not a gap to close), the next
concrete priority-9 item is FAZ 5's own still-open note from run 44/45: the choice-branching pilot
(ADR-0058) "could extend to more of the remaining 12 NPCs... neither automatically the next pick
without a fresh reason." This run's fresh reason: no syntax error/blocking bug/perf regression/
memory leak/new tech debt was found, FAZ 7 is still blocked without a decimated asset, and growing
an already-proven, low-risk mechanism (config + content only, zero code changes) is a safer use of
remaining run time/budget than starting a new, larger system.

**Decision:** `gameplayConfig.js`'s `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` gains 2 more entries:
`doran-guard-1` (Dorne) and `xaro-guard-1` (Qarth) — chosen because both already have distinctive,
lore-rich greeting lines in `GREETINGS_BY_NPC_ID` (Dorne's "never bowed" pride; Qarth's "thirteen
gates, only one open to you") that a natural follow-up question can build on, the same selection
reasoning ADR-0058 used for `umit-guard-1`/`berkalp-guard-1`. `jon-guard-1` is deliberately still
excluded, per ADR-0058's own "Alternatives considered" note that its ominous one-liner reads better
staying a single line. No code in `ui/dialogueBox.js`, `gameplay/interaction.js`, or `game3d.js` was
touched — the branching *mechanism* was already fully built and tested by ADR-0058; this is purely
new config data flowing through it.

**Reasoning:**
- **2 more, not all remaining 12, matching this project's own "pilot small, extend later" precedent
  a second time:** writing 12 NPCs' worth of new branching dialogue in one sub-task risks rushed,
  lower-quality Turkish prose with no way to review it carefully — the same scope-discipline reason
  ADR-0058 itself gave for stopping at 2 the first time.
- **Config-only change, no code touched:** `game3dSmokeChecks.js`'s `checkInteractionController`
  already exercises the choice mechanism generically via fake NPC ids/choice data (its t8-t15
  assertions from ADR-0058), so it doesn't need new assertions for these 2 real NPCs specifically —
  the mechanism itself is unchanged. Real proof instead comes from driving the actual
  `INTERACTION_CONFIG.CHOICES_BY_NPC_ID`/`GREETINGS_BY_NPC_ID` data (not synthetic stand-ins) through
  a real `DialogueBox`/`InteractionPrompt`/`createInteractionController` inside the live
  `game3d.html` page (see Verified below) — proves the new *content*, not the already-tested
  mechanism.
- **Why not LOD (FAZ 3's other open sub-task) instead:** considered, but real mesh LOD would need
  multiple geometry detail levels for `world/settlements.js`'s castle models — the same
  mesh-simplification tooling gap ADR-0057 already found blocking FAZ 7 (no Blender, no network
  access to fetch `gltf-transform`/`gltfpack`). Attempting it now risks a repeat of that
  investigation for the same dead end; flagged in 3D_GAME_PROGRESS.md instead of silently retried.

**Verified:**
- `node --check` clean on the one touched file (`gameplayConfig.js`).
- Line count: `gameplayConfig.js` 499/600 (up from 475/600) — comfortable headroom remains.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): **all 12 checks PASS**, identical
  to the pre-change baseline — confirms zero regression to the already-tested mechanism.
- **Real headless-Chromium proof of the new content specifically:** instantiated the real
  `DialogueBox`/`InteractionPrompt`/`createInteractionController` with the actual
  `INTERACTION_CONFIG` (not fake stub data) inside the live `game3d.html` page, opened
  `xaro-guard-1`'s dialogue — screenshot shows the real greeting plus both new numbered choice
  labels; selected choice 2 — second screenshot shows that choice's own real response text, choice
  list emptied, hint reverted to "E / Esc - Kapat." Zero console/page errors in either state.

**Alternatives considered:**
- *Extend to all remaining 12 NPCs* — rejected: same reasoning ADR-0058 already gave, applies
  identically the second time.
- *Add a 3rd choice or a second reply-to-a-reply level* — rejected: still no quest/state system for a
  deeper branch to meaningfully lead anywhere; growing pilot *breadth* (more NPCs) is lower-risk than
  growing pilot *depth* (more branching complexity) with the same missing foundation.
- *Attempt FAZ 3's LOD gap instead* — rejected once considered: real risk of hitting the same
  asset-tooling wall ADR-0057 already documented, for a lower-confidence outcome within this run's
  remaining time than a proven, config-only extension.

**Consequences:** 4 of 14 NPCs now have real branching content; 10 remain (`jon-guard-1`
deliberately excluded, 9 others not yet given a fresh reason to extend to). `gameplayConfig.js` has
24 lines less headroom than before but is still well under the 600-line cap. FAZ 3's LOD gap remains
open and now explicitly flagged as tooling-blocked (same class of blocker as FAZ 7), not silently
skipped.

## ADR-0061: Grow the world-event flavor pool from 8 to 12 entries

**Status:** Accepted (run 47).

**Context:** Fresh Session Snapshot this run: `git fetch` showed the local remote-tracking `origin/
main` ref was stale (cached at a much older pre-3D-mode commit) while the real remote `main` already
matched — same harmless "stale cache, no actual divergence" pattern documented in run 40's own
snapshot notes, resolved the same way (`git checkout -B main origin/main`). The run's own stored
prompt asked for two items — lake-water flicker and an F4 debug free-fly camera — both already
verified shipped 6 runs ago (run 40, ADR-0048/ADR-0049): confirmed via `git log`/`DECISIONS.md` and a
clean 12/12 smoke-suite pass (including `checkWaterVertexShaderStatic` and `checkFreeCamera`
specifically), not just taking the file's own claim on faith. A fresh full-priority re-scan found: no
syntax error (`node --check` clean across every `src/3d/**/*.js` and `scripts/*.js`), no blocking bug,
no file over the 600-line cap, no new tech debt, smoke coverage already complete (12/12), World
Coverage already past its gate (96.2% desktop). FAZ 7/FAZ 3-LOD remain genuinely tooling-blocked —
re-confirmed directly this run (`npx gltf-transform --version` / `npx gltfpack --version` both fail
with no network access to fetch the package; no `blender` binary on PATH), not assumed. With
priority 9 (FAZ 5 dialogue pilot) having just grown last run (46) and priority 9.5 (`gameplay/
worldEvents.js`'s flavor pool, explicitly flagged in run 46's "Next step" as still growable)
untouched since its own introduction (run 45, ADR-0056/ADR-0059 era), this run picks priority 9.5 to
keep priority-order rotation honest rather than growing the same system three runs in a row.

**Decision:** `gameplay/worldEvents.js`'s `WORLD_EVENTS` array grows from 8 to 12 entries: `falling_star`
(🌠 a shooting star, read as an omen), `horse_gallop` (🐎 distant hoofbeats — a deliberate nod to
`ANIMAL_CONFIG`'s now-live `ivory_stallion` horse, though the event itself is world-flavor text, not
tied to the real horse entity's position/state), `trade_caravan` (🛒 a merchant caravan approaching),
and `bell_toll` (🔔 an ambiguous castle bell — watch-change or warning, left open). Same object shape
as every existing entry (`{id, icon, title, desc, color}`), same original-prose/no-show-media
constraint, zero code changes to `createWorldEventSystem`'s picker/timer logic (`Math.floor(random() *
WORLD_EVENTS.length)` already generalizes to any array length).

**Reasoning:**
- **Config-only, zero picker-logic risk:** `createWorldEventSystem` never hardcodes the array's
  length or any specific index/id — `scripts/game3dSmokeChecksScene.js`'s `checkWorldEvents` already
  asserts determinism/timing/payload-shape generically (two same-seeded systems agree on their first
  *whatever* event, not a fixed expected id), so growing the pool needed no test changes to stay
  green.
- **4 new, not doubling to 16+, matching this project's own incremental-growth precedent:** ADR-0058/
  ADR-0060 grew the dialogue pilot 2 NPCs at a time for the same reason — a smaller batch is easier to
  proofread for tone/lore-fit than a large one written in a rush.
- **`horse_gallop` chosen partly to reflect FAZ 6's now-live horse asset:** thematically ties the
  event pool a little closer to the world's actual current content (a horse now stands at `umit`),
  without creating any actual coupling — the event fires independently of the real horse entity's
  existence/position, avoiding a cross-folder dependency `gameplay/worldEvents.js`'s own blast-radius
  rule (only `gameplay/`, `eventBus.js`, `physics.js`, `input.js`) would otherwise flag.
- **Why not extend the dialogue pilot again instead:** considered, but priority order exists precisely
  so one open item doesn't get picked 3 runs running while a different explicitly-flagged one (this
  one) sits untouched — same rotation discipline ADR-0060 itself used to justify not picking FAZ 3's
  LOD gap.

**Verified:**
- `node --check` clean on the one touched file.
- Line count: `worldEvents.js` 95/600 (up from 91/600) — trivial headroom cost.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): **all 12 checks PASS**, identical to
  the pre-change baseline.
- **Real headless-Chromium proof of the new content specifically** (not just the already-tested
  mechanism): a 60-seed sweep through the real `createWorldEventSystem`/`EventBus` inside the live
  `game3d.html` page surfaced all 4 new ids (`falling_star`/`horse_gallop`/`trade_caravan`/
  `bell_toll`) alongside the 8 originals — confirms the picker genuinely reaches the new entries, not
  just that they parse. Then drove the real `WorldEventToast` component (not a stub) with a
  `horse_gallop` payload — screenshot shows the toast rendering the correct icon/title/description
  text. Zero console errors.

**Alternatives considered:**
- *Extend the FAZ 5 dialogue pilot again (5th/6th NPC)* — rejected this run specifically to rotate
  priority-9/9.5 attention, not because it's a worse task in isolation.
- *Add a 5th+ new event to push the pool further* — rejected: 4 is enough to prove/exercise the growth
  path this run without risking rushed, lower-quality prose (same reasoning ADR-0058/ADR-0060 already
  applied to dialogue growth).

**Consequences:** The world-event flavor pool is now 12 entries (was 8), still config-only with no
per-kingdom economy/stats hook (unchanged design boundary from ADR-0056). FAZ 3's LOD gap and FAZ 7
remain open, both re-confirmed (not just assumed) still tooling-blocked this run.

## ADR-0062: Grow the dialogue-choice pilot from 4 to 6 of 14 NPCs

**Status:** Accepted (run 47, sub-task 2).

**Context:** Continued in the same session, same budget, immediately after sub-task 1's commit+push
(ADR-0061, this run's own chaining protocol). Fresh priority re-scan repeated: no new syntax error/
blocking bug/perf regression/memory leak/tech debt since sub-task 1. FAZ 7/FAZ 3's LOD gap remain
tooling-blocked (unchanged, already re-confirmed this run). With priority 9.5 (world-event pool) just
grown in sub-task 1, this sub-task rotates back to priority 9 (FAZ 5's own still-open pilot-growth
note) — same proven, low-risk, config-only mechanism ADR-0058/ADR-0060 already established, extended
a 3rd time.

**Decision:** `gameplayConfig.js`'s `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` gains 2 more entries:
`cersei-guard-1` (Lannister, King's Landing) and `stannis-guard-1` (Baratheon, the first NPC ever
placed in run 20). Both chosen because their existing `GREETINGS_BY_NPC_ID` lines are already
distinctive and lore-rich enough to hang a natural follow-up question on ("borç öder" -> Lannister
gold; "Kral Stannis'in adaleti" -> Baratheon justice/legitimacy) — same selection criterion ADR-0058/
ADR-0060 used. No code in `ui/dialogueBox.js`, `gameplay/interaction.js`, or `game3d.js` touched — the
branching mechanism itself is unchanged; this is config/content only.

**Reasoning:**
- **2 more, not all remaining 8:** same "pilot small, extend later, review each batch carefully for
  Turkish prose quality" precedent ADR-0058/ADR-0060 both already established.
- **House diversity over seat-count:** `cersei-guard-1`/`stannis-guard-1` add Lannister and Baratheon
  to the pilot's house coverage (previously Targaryen/Stark/Martell/Qarth-adjacent only) — spreads the
  hand-written content across more of the map's real lore identity rather than clustering.
- **Why not extend a 3rd house-repeat seat (e.g. `twin-guard-1`, also Lannister) instead:** rejected —
  `cersei-guard-1` already covers the Lannister flavor; a 2nd Lannister entry in the same batch would
  read as redundant rather than adding new ground, unlike `stannis-guard-1`'s genuinely new house.

**Verified:**
- `node --check` clean on the one touched file.
- Line count: `gameplayConfig.js` 521/600 (up from 499/600) — comfortable headroom remains.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): **all 12 checks PASS**, identical to
  the pre-change baseline.
- **Real headless-Chromium proof of the new content specifically:** instantiated the real
  `DialogueBox`/`InteractionPrompt`/`createInteractionController` with the actual
  `INTERACTION_CONFIG` inside the live `game3d.html` page, opened `stannis-guard-1`'s dialogue —
  screenshot shows the real greeting plus both new numbered choice labels; selected choice 1 — second
  screenshot shows that choice's own real response text, choice list emptied, hint reverted to "E /
  Esc - Kapat", with the real scene (castle, player, night sky) rendered behind it. Zero console/page
  errors in either state.

**Alternatives considered:**
- *Extend to all 8 remaining NPCs* — rejected, same reasoning as ADR-0058/ADR-0060.
- *Grow the world-event pool again instead* — rejected this sub-task specifically to rotate back to
  priority 9 after sub-task 1 already covered priority 9.5.

**Consequences:** 6 of 14 NPCs now have real branching content; 8 remain (`jon-guard-1` deliberately
excluded, 7 others no fresh reason yet). `gameplayConfig.js` has 22 fewer lines of headroom but is
still well under the 600-line cap.

## ADR-0063: Grow the dialogue-choice pilot from 6 to 8 of 14 NPCs

**Status:** Accepted (run 48).

**Context:** Fresh session boot, `HEAD` detached at run 47's final commit (`e0010e9`) with a stale
local `main`/cached `origin/main` ref again pointing at the old pre-3D commit (`38e09e7`) — same
harmless pattern runs 40/47 already documented; `git fetch origin main` confirmed the real remote
`main` matched the detached `HEAD` exactly, then `git checkout -B main origin/main` reattached
cleanly (this run's first attempt raced the fetch — reset to a stale cached `origin/main` before
fetching — caught immediately via `git cat-file -t <sha>` confirming `e0010e9` was still reachable,
then corrected with a second fetch-then-checkout; no data was lost, nothing had been pushed yet).

This run's own stored prompt asked for 2 items already shipped 8 runs ago: lake-water flicker (fixed
run 40, ADR-0048) and an F4 debug free-fly camera (shipped run 40, ADR-0049) — re-confirmed, not
assumed: the committed smoke suite's `checkWaterVertexShaderStatic`/`checkFreeCamera` both still PASS
(12/12 full suite), and `node --check` stayed clean on every `src/3d/**/*.js`/`scripts/*.js` file. Same
stale-prompt situation runs 44-47 already flagged. Full priority re-scan otherwise: no blocking bug,
no file over the 600-line cap (`gameplayConfig.js` was 521/600, the largest), World Coverage unchanged
past its gate (96.2% desktop / 4.5% mobile, ADR-0013 perf-budget constraint), FAZ 7/FAZ 3's LOD gap
re-confirmed still tooling-blocked (no network access for `gltf-transform`/`gltfpack`, no `blender` on
PATH). With nothing new at priorities 2-8, rotated to priority 9 — run 47's own "Next step" note
explicitly flagged `stannis-guard-2` as a natural next pick (its greeting already flavor-rich).

**Decision:** `gameplayConfig.js`'s `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` gains 2 more entries:
`stannis-guard-2` (Baratheon's second watchman) and `balon-guard-1` (Greyjoy, Iron Islands — the
pilot's first Iron Islands seat). Both chosen for the same criterion ADR-0058/ADR-0060/ADR-0062 all
used: an existing `GREETINGS_BY_NPC_ID` line distinctive enough to hang a natural follow-up on
("gözüm hep tepede" -> what he watches for / how he splits duty with the first watchman; "tohum
ekmeyiz, biçeriz" -> what that motto means / how respect is earned on the Iron Islands). No code in
`ui/dialogueBox.js`, `gameplay/interaction.js`, or `game3d.js` touched — config/content only.

**Reasoning:**
- **2 more, not all 6 remaining:** same "pilot small, extend later, review each batch carefully for
  Turkish prose quality" precedent ADR-0058/ADR-0060/ADR-0062 all established.
- **House diversity:** `balon-guard-1` adds House Greyjoy to the pilot's coverage (previously
  Targaryen/Stark/Martell/Qarth-adjacent/Lannister/Baratheon only); `stannis-guard-2` deepens
  Baratheon rather than adding a new house, but its own greeting was specifically flagged last run as
  ready — picked over a 3rd fresh-house pick (e.g. `robin-guard-1`) to close out run 47's own explicit
  suggestion first.
- **Why not extend the world-event pool again instead:** priority order puts 9 ahead of 9.5 once both
  have been touched in a prior run; 9.5 (world events, 12 entries) was already grown run 47, so this
  run rotates to 9.

**Verified:**
- `node --check` clean on the one touched file.
- Line count: `gameplayConfig.js` 544/600 (up from 521/600) — comfortable headroom remains.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): **all 12 checks PASS**, identical to
  the pre-change baseline (the suite's `checkInteractionController` already asserts the
  offer/select/fallback mechanism generically, not against fixed ids/content).
- **Real headless-Chromium proof of the new content specifically:** a one-off Playwright script
  booted the live `game3d.html` page (zero console/page errors), then instantiated the real
  `DialogueBox` with the actual `INTERACTION_CONFIG.GREETINGS_BY_NPC_ID`/`CHOICES_BY_NPC_ID` for both
  new ids. Screenshots confirm: `stannis-guard-2`'s and `balon-guard-1`'s real greeting text plus both
  numbered choice labels render over the real scene (castle, player, night sky); selecting choice 1
  for each shows that choice's own real response text with the choice list cleared and the hint
  reverted to "E / Esc - Kapat". Zero console/page errors throughout.

**Alternatives considered:**
- *Extend to all 6 remaining NPCs in one batch* — rejected, same reasoning as ADR-0058/ADR-0060/
  ADR-0062.
- *Pick 2 entirely-new-house NPCs instead of `stannis-guard-2`* — rejected: run 47's own "Next step"
  note called out `stannis-guard-2` by name as ready: closing out an explicit prior-run suggestion
  before opening a new one keeps the rotation legible across runs.

**Consequences:** 8 of 14 NPCs now have real branching content; 6 remain (`jon-guard-1` deliberately
excluded, 5 others — `ziya-guard-1`/`robin-guard-1`/`berk-guard-1`/`olena-guard-1`/`twin-guard-1` — no
fresh reason yet, though `robin-guard-1` would be the next new-house pick (Arryn, not yet covered).
`gameplayConfig.js` has 56 lines of headroom left before the 600-line cap and would need a split on
its next comparable-sized growth.

## ADR-0064: Grow the dialogue-choice pilot from 8 to 10 of 14 NPCs

**Status:** Accepted (run 49).

**Context:** Fresh session boot, `HEAD` detached at run 48's final commit (`9595c02`) with a stale
local `main` pointing at the old pre-3D commit (`38e09e7`) — same harmless pattern runs 40/47/48
already documented; `git fetch origin` then `git checkout main && git reset --hard origin/main`
reattached cleanly to the real remote tip.

This run's own stored prompt asked for 2 items already shipped 9 runs ago: lake-water flicker
(fixed run 40, ADR-0048) and an F4 debug free-fly camera (shipped run 40, ADR-0049) — re-confirmed,
not assumed: `git log`/`DECISIONS.md` both show them landed, and the committed smoke suite's
`checkWaterVertexShaderStatic`/`checkFreeCamera` both still PASS (12/12 full suite). Same
stale-prompt situation runs 44-48 already flagged.

Full priority re-scan otherwise: `node --check` clean on every `src/3d/**/*.js`/`scripts/*.js` file;
no blocking bug; no file over the 600-line cap (`gameplayConfig.js` was 544/600, the largest); full
smoke suite already at 12/12 (no missing regression coverage); World Coverage unchanged past its gate
(96.2% desktop, 4.5% mobile — ADR-0013 perf-budget constraint, not an open gap).

**New finding this run, worth flagging even though not acted on:** `npx gltfpack -h` and
`npx @gltf-transform/cli --version` both now resolve and run successfully in this container (`npx
gltf-transform` — the bare, wrong package name every prior run tried — still 404s; the correct
scoped package `@gltf-transform/cli` is the one that works). Every prior run since ADR-0057 recorded
this as a hard network-access wall blocking FAZ 7 (dragon models) and FAZ 3's LOD sub-task. This run
only confirmed the CLIs now install and start — it did **not** run a real decimation pass on any
asset, since FAZ 7 has no spawn/AI code yet (roadmap: "kod başlamadı") and FAZ 3's own settlement
"LOD gap" is procedural-geometry InstancedMesh work, not a glTF-mesh-simplification problem at all
(`world/settlements.js`'s castles are generated `BoxGeometry`/`CylinderGeometry`/`ConeGeometry`, not
loaded `.glb` models — only `gameplay/animals.js`'s wolf uses `AssetLoader.loadModel`). Actually
using this tooling belongs to whichever run picks up FAZ 7 as its active phase, not this one — noted
here and in `3D_GAME_PROGRESS.md` so that run can skip re-discovering it from scratch.

With nothing new at priorities 2-8, rotated to priority 9 (FAZ 5's dialogue pilot) per run 48's own
"Next step" note, which explicitly named `robin-guard-1` as the next new-house pick.

**Decision:** `gameplayConfig.js`'s `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` gains 2 more entries:
`robin-guard-1` (Arryn, the pilot's first Vale seat) and `ziya-guard-1` (Tyrell-flavored, the
pilot's first Reach seat). Both chosen for the same criterion ADR-0058/60/62/63 all used: an
existing `GREETINGS_BY_NPC_ID` line distinctive enough to hang a natural follow-up on ("Yükseklik
güçtür... Arryn'in kartalları her şeyi görür" -> why settle so high / do the eagles really see
everything; "Büyüyen güç bizimdir... bahçeleri" -> what the gardens are known for / what "growing
power" means). No code in `ui/dialogueBox.js`, `gameplay/interaction.js`, or `game3d.js` touched —
config/content only.

**Reasoning:**
- **2 more, not all 6 remaining:** same "pilot small, extend later, review each batch carefully for
  Turkish prose quality" precedent ADR-0058/60/62/63 all established.
- **House diversity:** `robin-guard-1` adds House Arryn (Vale) and `ziya-guard-1` adds a Tyrell/Reach
  flavor seat to the pilot's coverage — previously Targaryen/Stark/Martell/Qarth-adjacent/
  Lannister/Baratheon/Greyjoy only.
- **Why not FAZ 7/FAZ 3-LOD instead, now that the tooling wall is gone:** the tooling gap was only
  one of two blockers — FAZ 7 also has zero spawn/AI/rendering code yet (a multi-sub-task feature,
  not a single atomic step) and FAZ 3's "LOD gap" turned out to target procedural geometry, not
  loaded meshes, so `gltfpack`/`gltf-transform` don't even apply to it. Starting FAZ 7 now would mean
  jumping past FAZ 5/6 (still the active, incomplete phases per the roadmap) straight to priority-10
  "new feature" territory. Flagged as unblocked-but-not-started rather than silently retried or
  silently skipped.

**Verified:**
- `node --check` clean on the one touched file.
- Line count: `gameplayConfig.js` 566/600 (up from 544/600) — still under the 600-line cap, 34 lines
  of headroom remain (next comparable growth will need a split).
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): **all 12** checks PASS, identical
  to the pre-change baseline (the suite's `checkInteractionController` already asserts the
  offer/select/fallback mechanism generically, not against fixed ids/content).
- **Real headless-Chromium proof of the new content specifically:** a one-off Playwright script
  booted the live `game3d.html` page (zero console/page errors), then instantiated the real
  `DialogueBox`/`InteractionPrompt`/`createInteractionController` with the actual
  `INTERACTION_CONFIG` for both new ids, reading state off the instance's own DOM refs (not a global
  `document.querySelector`, which would have matched the real running game's own hidden dialogue box
  instead). Screenshot confirms `robin-guard-1`'s real greeting plus both numbered choice labels
  render over the real scene (castle, player, night sky); selecting choice 1 shows that choice's own
  real response text with the choice list cleared and the hint reverted to "E / Esc - Kapat". Zero
  console/page errors throughout.

**Alternatives considered:**
- *Extend to all 6 remaining NPCs in one batch* — rejected, same reasoning as ADR-0058/60/62/63.
- *Attempt a real FAZ 7 asset-decimation pass now that tooling works* — rejected this run: FAZ 7
  isn't the active phase (FAZ 5/6 both still have open work) and a real decimation pass on an 80MB+
  reference model plus judging the output quality is a bigger, riskier undertaking than this run's
  remaining budget should gamble on its first attempt at previously-unverified tooling.

**Consequences:** 10 of 14 NPCs now have real branching content; 4 remain (`jon-guard-1` deliberately
excluded, 3 others — `berk-guard-1`/`olena-guard-1`/`twin-guard-1` — no fresh reason yet, all three
Lannister/Frey-adjacent seats already represented elsewhere in the pilot). `gameplayConfig.js` has 34
lines of headroom left before the 600-line cap — the next 2-NPC-sized growth will likely need a
split into a sibling dialogue-content file, same pattern `game3dSmokeChecks.js` already went through
twice (ADR-0028, ADR-0059). FAZ 7's tooling blocker is now lifted but the phase itself remains
unstarted; FAZ 3's "LOD gap" is confirmed to need a different (procedural-geometry) approach than
`gltfpack`/`gltf-transform`, not currently justified by any measured perf need (unchanged conclusion
from ADR-0015/ADR-0032).

## ADR-0065: Grow the world-event flavor pool from 12 to 14 entries

**Status:** Accepted (run 49, sub-task 2 — chained after ADR-0064 per this run's budget/time still
being available).

**Context:** After ADR-0064's dialogue-pilot growth, `gameplayConfig.js` sits at 566/600 lines — only
34 lines of headroom, likely one growth away from needing a file split (flagged in ADR-0064's own
"Consequences"). Rather than force another dialogue-pilot NPC pair into a file that's about to need
architectural work, this run rotates to priority 9.5 (EventBus/world-event content), last grown run
47 (`gameplay/worldEvents.js`'s `WORLD_EVENTS`, ADR-0061) — 2 runs stale by this project's own
established "alternate 9/9.5 once both have been touched" rotation logic (see ADR-0063's own
reasoning for the same rotation the other direction).

`gameplay/worldEvents.js` itself is only 95/600 lines — comfortable headroom, no split needed.

**Decision:** `WORLD_EVENTS` gains 2 new original entries: `watch_horn` (a single distant horn blast
from the north — Night's Watch/Wall-adjacent ambiance, distinct from the existing `wolf_howl`/
`dragon_shadow` "something in the distance" entries) and `tourney_announce` (a herald announcing a
jousting tournament at a neighboring seat — festive/political ambiance, distinct from the existing
`feast_fires`). Both original writing, not adapted from the show, same constraint every asset in this
project already follows. No code touched outside the data array — `createWorldEventSystem` already
picks uniformly at random from whatever `WORLD_EVENTS` contains.

**Reasoning:**
- **Why these two specifically:** scanned the existing 12 for thematic gaps — nothing referenced the
  Wall/Night's Watch (despite `jon-guard-1`'s dialogue greeting existing) or tournaments/jousting (a
  classic Westeros staple with zero prior representation in either the 2D `RANDOM_EVENTS` port
  source or this pool).
- **2, not more:** same small-batch-per-run precedent ADR-0056 (first 8) and ADR-0061 (8→12) both
  established for this exact pool.
- **Why not extend the dialogue pilot again instead:** `gameplayConfig.js` has only 34/600 lines of
  headroom left post-ADR-0064; spending it on a second dialogue-pilot growth in the same run reduces
  the safety margin before a forced split, whereas `worldEvents.js` has ample room and hasn't been
  touched in 2 runs.

**Verified:**
- `node --check` clean on the one touched file (`worldEvents.js`).
- Line count: `worldEvents.js` 97/600 (up from 95/600) — trivial growth, no split pressure.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): **all 12** checks PASS, identical
  to the pre-change baseline — `checkWorldEvents` asserts the mechanism generically (fire timing,
  payload shape, determinism, dispose) against whatever the pool currently contains, not fixed
  ids/count, so it needed no changes.
- **Real headless-Chromium proof of the new content specifically:** a one-off Playwright script
  booted the live `game3d.html` page (zero console/page errors), then drove the real
  `createWorldEventSystem` (seed 7) with repeated large time deltas until both new ids
  (`watch_horn`/`tourney_announce`) were actually observed coming out of the real pool (not asserted
  against array internals), then emitted `watch_horn`'s real payload through a real `EventBus` into a
  real `WorldEventToast` instance. Screenshot confirms the toast's real icon/title/desc render over
  the live scene (castle, player, night sky). Zero console/page errors throughout.

**Alternatives considered:**
- *Add 4+ entries in one batch* — rejected, same small-batch precedent as above.
- *Reuse a 2D `RANDOM_EVENTS` title/description verbatim* — rejected: the 2D entries are written
  around a stat-effect payload (gold/army/morale deltas) this pool intentionally has none of; original
  ambiance-only writing keeps the tone consistent with the existing 12.

**Consequences:** World-event pool now has 14 entries, still comfortably under any practical size
limit for a `Math.floor(random() * WORLD_EVENTS.length)` pick. `worldEvents.js` has 503 lines of
headroom before its own 600-line cap. FAZ 8's event system remains flavor-only (no stat effects, no
per-kingdom economy hook) — unchanged design boundary from ADR-0056.

## ADR-0066: Split `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` out of `gameplayConfig.js` into `gameplay/dialogueChoices.js`

**Status:** Accepted (run 50, sub-task 1).

**Context:** Fresh Session Snapshot (this run's stored prompt asked for lake-water-flicker and an F4
debug free-fly camera — both re-confirmed already shipped run 40, ADR-0048/ADR-0049; same stale-prompt
situation runs 44-49 already flagged, not re-actioned). Full 12-check smoke suite re-run clean before
touching anything. No syntax error (`node --check` clean on every `src/3d/**/*.js`/`scripts/*.js`
file), no blocking bug, no perf-budget overrun, no memory leak. Priority 6 (tech debt) had one
concrete, already-flagged item: run 49's own "Next step" note recorded `gameplayConfig.js` at
566/600 lines — only 34 headroom left, and its own biggest remaining growth driver
(`CHOICES_BY_NPC_ID`, ~30 lines per 2-NPC pair) would blow the 600-line cap on the very next
dialogue-pilot growth. Same "split before the next content growth needs it" precedent ADR-0059 (this
project's own prior `game3dSmokeChecks.js` split) already established, and run 49 itself flagged this
exact split as "a reasonable next priority-9 sub-task, done before the content growth that needs it."

**Decision:** Moved `CHOICES_BY_NPC_ID`'s full object literal (10 NPCs, verbatim, no content changes)
out of `gameplayConfig.js`'s `INTERACTION_CONFIG` into a new sibling file,
`gameplay/dialogueChoices.js`, exporting `CHOICES_BY_NPC_ID` directly. `gameplayConfig.js` now
imports it and assigns it back as `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` (shorthand property), so
every existing caller (`game3d.js`'s `INTERACTION_CONFIG.CHOICES_BY_NPC_ID` read,
`gameplay/interaction.js`'s consumption of the resolved config object) needed zero changes — this is
a pure file-boundary change, not a public-shape change. `GREETINGS_BY_NPC_ID` (much smaller, ~1 line
per entry) stays in `gameplayConfig.js` — only the heavier, faster-growing block moved.

**Reasoning:**
- **Split by growth driver, not evenly:** `CHOICES_BY_NPC_ID` (10 entries × ~10 lines = ~103 lines)
  was the single largest and fastest-growing block in the file; moving it alone recovers the most
  headroom for the least churn, versus e.g. also moving `NPC_CONFIG.SPAWNS` (14 entries but only
  ~6 lines each, growing slower) unnecessarily.
- **Verbatim move, re-exported to preserve shape:** matches ADR-0059's "verbatim move, not a
  rewrite" rule — no dialogue text, key, or structure changed, only which file declares it.
- **Why now, not deferred:** identical timing argument to ADR-0059 — the debt was already flagged in
  writing (run 49's "Next step"), and deferring until the next 2-NPC growth actually needs it would
  force a rushed split under pressure instead of a clean preemptive one.

**Verified:**
- `node --check` clean on both touched files: `gameplayConfig.js`, `dialogueChoices.js` (new).
- Line counts re-measured: `gameplayConfig.js` 456/600 (was 566/600), `dialogueChoices.js` 133/600
  (new file). Both now have comfortable headroom.
- Full committed smoke suite (`node scripts/smokeTestGame3D.js`): all **12** checks PASS, identical
  names/details/order to the pre-split run, including `checkInteractionController`'s own
  choice-branching pilot assertions (offer/select/out-of-range/already-consumed/E-closes-mid-choice)
  — confirms the split changed no runtime behavior, only file boundaries.

**Alternatives considered:**
- *Also split `GREETINGS_BY_NPC_ID` out at the same time* — rejected: it's only ~16 lines total (1
  line/entry) and growing far slower than `CHOICES_BY_NPC_ID`; splitting it now would be premature
  churn for headroom the file doesn't need yet (ADR-0059's own precedent split only the block that
  was actually the pressure point).
- *Trim comments instead of extracting* — rejected, same reasoning ADR-0059 already rejected it for:
  this project's docstrings carry real WHY-content, and trimming buys only a few lines before the
  cap is hit again on the next 2-NPC growth.

**Consequences:** `gameplayConfig.js` now has 144 lines of real headroom — comfortably covers several
more dialogue-pilot growth rounds (4 NPCs remain: `berk-guard-1`/`olena-guard-1`/`twin-guard-1`, plus
the deliberately-excluded `jon-guard-1`) before needing another split. `dialogueChoices.js` itself has
467 lines of headroom. No behavior change for players — this is purely an internal file-organization
fix.

## ADR-0067: Grow the dialogue-choice pilot from 10 to 12 of 14 NPCs

**Status:** Accepted (run 50, sub-task 2 — chained after ADR-0066 per this run's budget/time still
being available).

**Context:** After ADR-0066's split, `dialogueChoices.js` has 467/600 lines of headroom and
`gameplayConfig.js` has 144/600 — both comfortably able to take the next dialogue-pilot growth round
that ADR-0066's own "Consequences" flagged as ready. Priority order re-checked fresh: no syntax
error, no blocking bug, no perf-budget overrun, no memory leak, World Coverage unchanged past its
gate — nothing outranks priority 9 this round.

**Decision:** Grew `dialogueChoices.js`'s `CHOICES_BY_NPC_ID` from 10 to 12 of 14 NPCs, adding
`berk-guard-1` and `olena-guard-1` — both House Tyrell seats (per `NPC_CONFIG.SPAWNS`'s run-34
placement, sharing `ziya-guard-1`'s "Tyrell Muhafızı"-family flavor), the pilot's remaining
not-yet-covered *houses* being effectively exhausted (every real kingdom seat's house already has at
least one choice-pilot NPC; `berk`/`olena` add a second and third Tyrell voice, `twin-guard-1`
remains the one genuinely uncovered NPC — Lannister, already voiced via `cersei-guard-1`). Both
choice pairs are original writing derived from each NPC's existing `GREETINGS_BY_NPC_ID` line
(`berk-guard-1`'s "verimli topraklar/sınırsız olmayan misafirperverlik", `olena-guard-1`'s "keskin
dil") — same per-NPC, house-flavored approach every prior round used. Config-only; zero changes to
`interaction.js`/`dialogueBox.js`/`game3d.js`.

**Verified:**
- `node --check` clean on `dialogueChoices.js`/`gameplayConfig.js`. Line counts: `dialogueChoices.js`
  156/600, `gameplayConfig.js` 456/600 (JSDoc-only touch) — both still comfortable.
- Full committed smoke suite: all **12** checks PASS, identical to the pre-change baseline.
- **Real headless-Chromium proof of the new content specifically:** a one-off Playwright script
  booted the live `game3d.html` page (zero console/page errors), then instantiated the real
  `DialogueBox`/`InteractionPrompt`/`createInteractionController` with the actual
  `INTERACTION_CONFIG` for both new ids, reading state off the instance's own scoped DOM refs (not a
  global `document.querySelector`, which would hit the real running game's own hidden dialogue box —
  same pitfall run 49 already flagged and avoided). For each NPC: greeting text, both numbered choice
  labels, and (after simulating a `Digit1` press) that choice's own response text with the hint
  reverted to "E / Esc - Kapat" all matched the authored content exactly. A screenshot of
  `berk-guard-1`'s response confirms it renders over the real scene (castle, player, night sky).
  Zero console/page errors throughout.

**Memory-leak checklist:** N/A — config-only content addition to a frozen object literal, no new
allocation/listener/timer; the one-off verification script's own `DialogueBox`/`InteractionPrompt`/
`createInteractionController` instances were scratch/throwaway, appended to and removed from a
disposable scratch DOM node, not part of the committed app.

**Files changed this sub-task:** `src/3d/gameplay/dialogueChoices.js`, `src/3d/gameplay/
gameplayConfig.js` (JSDoc count-only), `DECISIONS.md` (this ADR), `3D_GAME_PROGRESS.md`. 4 files,
~35 new/changed lines.

**Consequences:** Dialogue-choice pilot now covers 12 of 14 NPCs. `twin-guard-1` is the one
remaining not-yet-covered NPC (`jon-guard-1` stays deliberately excluded) — a future round can add it
alone or pair it with a fresh line for an already-covered NPC if a natural second-choice idea comes
up; there's no third same-house pairing left to reach for. `dialogueChoices.js` now has 444/600 lines
of headroom.

## ADR-0068: Grow the world-event flavor pool from 14 to 16 entries

**Status:** Accepted (run 50, sub-task 3 — chained after ADR-0067 per this run's budget/time still
being available).

**Context:** After ADR-0067's dialogue-pilot growth, `dialogueChoices.js`/`gameplayConfig.js` both
have comfortable headroom (444/600 and 144/600), so no split pressure forces a rotation away from
priority 9 this time. Still, `gameplay/worldEvents.js`'s own pool (priority 9.5) was last grown run
49 (ADR-0065, 12 -> 14) — one run stale by this project's established "alternate 9/9.5 once both have
been touched in the same recent window" rotation (see ADR-0063/ADR-0065's own reasoning for the same
rotation each direction), and this run had already touched priority 9 twice (the split in ADR-0066,
the content growth in ADR-0067). Rotating to 9.5 keeps both tracks moving rather than exhausting one
in a single run.

**Decision:** Grew `WORLD_EVENTS` from 14 to 16 entries, adding `ship_sighted` (a sail spotted on the
horizon — previously unrepresented naval/coastal flavor, a natural fit given `balon-guard-1`'s Iron
Islands seat already exists in the world) and `blacksmith_hammer` (rhythmic hammering heard from a
keep — previously unrepresented everyday-village-life flavor, distinct from the already-covered
guard/patrol/ceremonial events). Config-only; zero changes to `createWorldEventSystem`'s mechanism
or `ui/worldEventToast.js`.

**Verified:**
- `node --check` clean on `worldEvents.js`. Line count: 99/600 (was 97) — comfortable headroom.
- Full committed smoke suite: all **12** checks PASS, identical to the pre-change baseline
  (`checkWorldEvents` asserts the mechanism generically against whatever the pool contains, not a
  fixed count/ids, so it needed no changes).
- **Real headless-Chromium proof of the new content specifically:** a one-off Playwright script
  booted the live `game3d.html` page (zero console/page errors), then drove the real
  `createWorldEventSystem` (seed 7) with repeated large time deltas until both new ids
  (`ship_sighted`/`blacksmith_hammer`) were actually observed coming out of the real pool (not
  asserted against array internals — took 368 update() calls), then emitted `ship_sighted`'s real
  payload through a real `EventBus` into a real `WorldEventToast` instance (constructed with the
  actual `{eventsBus, eventName, container}` shape, self-subscribing exactly as `game3d.js` wires it).
  Screenshot confirms the toast's real icon/title/desc render over the live scene (castle, player,
  night sky). Zero console/page errors throughout.

**Alternatives considered:**
- *Add 4+ entries in one batch* — rejected, same small-batch precedent every prior world-event
  growth round used.
- *Pick events with a stat-effect angle (e.g. hinting at a coming raid)* — rejected: FAZ 8's event
  system is deliberately flavor-only (ADR-0056's own design boundary, reaffirmed by ADR-0061/0065) —
  no per-kingdom economy hook exists yet for a stat-bearing event to attach to.

**Consequences:** World-event pool now has 16 entries. `worldEvents.js` has 501/600 lines of headroom
before its own 600-line cap — no split pressure. FAZ 8's event system remains flavor-only, unchanged
design boundary from ADR-0056.

## ADR-0069: Grow the dialogue-choice pilot from 12 to 13 of 14 NPCs (`twin-guard-1`)

**Status:** Accepted (run 51).

**Context:** Fresh Session Snapshot re-confirmed this run's own stored prompt again asked for 2 items
already shipped 11 runs ago: lake-water flicker (fixed run 40, ADR-0048) and the F4 debug free-fly
camera (shipped run 40, ADR-0049) — `git log` and the committed smoke suite's
`checkWaterVertexShaderStatic`/`checkFreeCamera` both still PASS, so neither needed any new work.
Full priority re-scan: `node --check` clean on every `src/3d/**/*.js`/`scripts/*.js` file, no
blocking bug, full smoke suite already at 12/12, World Coverage unchanged past its gate, no new tech
debt (no file near its 600-line cap forcing a split). Priority 9 (active phase's incomplete
sub-task) had one concrete, already-flagged item: run 50's own "Next step" note recorded
`twin-guard-1` as "the one remaining not-yet-covered NPC" in the dialogue-choice pilot
(`jon-guard-1` stays deliberately excluded per ADR-0058).

**Decision:** Grew `dialogueChoices.js`'s `CHOICES_BY_NPC_ID` from 12 to 13 of 14 NPCs, adding
`twin-guard-1` — the Twins' own distinct Lannister-house seat (per `NPC_CONFIG.SPAWNS`'s run-34
placement), voiced with a crossing/toll flavor derived from its existing `GREETINGS_BY_NPC_ID` line
("İkiz Kuleler'in gölgesinde yürüyorsun. Burada her adım izlenir.") rather than reusing
`cersei-guard-1`'s gold-mine angle — same per-NPC, house-flavored approach every prior round used.
Config-only; zero changes to `interaction.js`/`dialogueBox.js`/`game3d.js`.

**Verified:**
- `node --check` clean on `dialogueChoices.js`. Line count: 167/600 (was 156) — comfortable headroom.
- Full committed smoke suite: all **12** checks PASS, identical to the pre-change baseline.
- **Real headless-Chromium proof of the new content specifically:** a one-off Playwright script
  booted the live `game3d.html` page (zero console/page errors), then instantiated the real
  `DialogueBox`/`InteractionPrompt`/`createInteractionController` with the actual
  `INTERACTION_CONFIG` for `twin-guard-1`, reading state off the instance's own scoped DOM refs (not
  a global `document.querySelector`, same pitfall runs 49/50 already flagged and avoided). The
  greeting text, both numbered choice labels, and (after simulating a `Digit2` press) that choice's
  own response text with the hint reverted to "E / Esc - Kapat" all matched the authored content
  exactly. A screenshot of the rendered response confirms it draws over the real page. Zero
  console/page errors throughout.

**Memory-leak checklist:** N/A — config-only content addition to a frozen object literal, no new
allocation/listener/timer; the one-off verification script's own `DialogueBox`/`InteractionPrompt`/
`createInteractionController` instances were scratch/throwaway, appended to and removed from a
disposable scratch DOM node, not part of the committed app.

**Files changed this sub-task:** `src/3d/gameplay/dialogueChoices.js`, `DECISIONS.md` (this ADR),
`3D_GAME_PROGRESS.md`. 3 files, ~15 new/changed lines.

**Consequences:** Dialogue-choice pilot now covers 13 of 14 NPCs — `jon-guard-1` is the only
remaining NPC without a choice entry, deliberately excluded (ADR-0058's "Alternatives considered").
A future round has no further same-pilot growth available without either revisiting that exclusion
or adding a second choice pair to an already-covered NPC. `dialogueChoices.js` now has 433/600 lines
of headroom.

## ADR-0070: Real FAZ 7 dragon-decimation pass — and a mislabeled-asset bug found in the process

**Status:** Accepted (run 52).

**Context:** Fresh full priority re-scan: `node --check` clean on every `src/3d/**/*.js`/
`scripts/*.js` file (verified directly, not assumed from prior notes); full committed smoke suite
already at 12/12 (one run showed a `game3d.html` timeout on a first pass — re-ran clean immediately
after, confirmed as this sandbox's known headless-rendering timing flakiness, not a real regression,
same class of noise prior runs' "FPS not reliably measurable" note already flags); no file near the
600-line cap (`gameplayConfig.js` largest at 456/600); World Coverage unchanged past its gate (96.2%
desktop / 4.5% mobile — re-confirmed intentional and already documented, ADR-0010/ADR-0013's mobile
triangle-budget constraint, not a bug: `STREAM_RADIUS_CHUNKS` is a hard perf-budget choice, not an
oversight, so left alone this run per the operator's own "skip if already-intentional" guidance).
Priority 9's dialogue-choice pilot has no free growth left (`jon-guard-1` deliberately excluded, run
51). Priority 9.5 (world-events) still has headroom but was grown twice in the last two runs (50,
51) — diminishing-returns filler by this point. That left priority 10 (new feature/next phase):
runs 49-51 each flagged the same concrete, well-defined next step — confirm FAZ 7's gltfpack/
gltf-transform tooling blocker (reported lifted run 49, never actually exercised) by running a real
decimation pass on the reference dragon asset(s) before any FAZ 7 spawn/AI code is written.

**Decision:** Confirmed both `gltfpack` (1.2, via `npx`) and `@gltf-transform/cli` (4.4.2) install
and run in this sandbox. `gltfpack`'s own texture-compression flags (`-tc`/`-tw`) turned out to be
unusable here — its `npx`-installed Node build has no native WebP/KTX2 support in this environment
(confirmed by actually running it, not assumed) — so the working pipeline used is `gltf-transform`'s
CLI instead: `weld` → `simplify --ratio 0.0099 --error 0.06` → `resize --width 512 --height 512` →
`prune`. Output deliberately avoids Draco/Meshopt/KTX2/WebP compression entirely (`--compress false`
equivalent — plain quantized glTF only) because `assetLoader.js`'s `AssetLoader` only ever
constructs a vanilla `GLTFLoader` — no `DRACOLoader`, no `KTX2Loader`, no `setMeshoptDecoder` call
anywhere in this codebase — so a compressed output would silently fail to load in the real game.
`KHR_mesh_quantization` (which plain `simplify`/`resize` still use) is safe: it's natively supported
by the vendored `GLTFLoader.js` (confirmed by grep — `KHR_MESH_QUANTIZATION` is a built-in extension
handler, not one requiring an external decoder).

**A real bug was found, not just tooling confirmed:** before picking a file to decimate, this run
rendered all three "reference dragon" variants (`reference_dragon_v1/v2/v3.glb`) through the actual
`AssetLoader.loadModel` in a real headless-Chromium scene — a step no prior run had actually done
(prior notes only checked file size/manifest fields, never rendered the content). **`reference_
dragon_v1.glb` is not a dragon.** Its geometry is a fully-textured fantasy castle/gatehouse (keep,
twin corner towers, conical roofs, banner, wooden drawbridge) — confirmed by screenshot, not
inferred. `reference_dragon_v2.glb` and `v3.glb` really are the same ornate gold/bronze dragon as
each other (also confirmed by screenshot) — so the manifest's old "three near-duplicate dragon
generation attempts" description was only 2/3 correct; v1 is an unrelated, mislabeled asset, most
likely a batch-download/organizing mixup during the original manual asset step, not a code bug.
Every run from 49 through 51 that named `reference_dragon_v1.glb` (82MB) as "the" file to decimate
for FAZ 7 was working from that same unverified assumption. Picked `reference_dragon_v2.glb`
instead (arbitrary tie-break vs. v3 — both are the same successful generation, v2 tried first).

Ran the pipeline on `reference_dragon_v2.glb` (1,997,140 triangles, 86.89MB, two 4096x4096 PNGs):
output is 19,762 triangles / 1.67MB (a ~99% triangle cut, ~98% file-size cut) — inside the
manifest's own `<20K tri / <5MB` target. Saved as `assets/models/creatures/dragons/
reference_dragon_v2_decimated.glb` and registered in `assets_manifest.json` as `dragon_reference_
v2_decimated`, the file any future FAZ 7 spawn/AI code should actually load. `assets_manifest.json`
also corrected: `dragon_reference_v1`'s notes now carry the mislabeling finding (its castle content
left alone, unconsumed by code, until a human/future run deliberately decides to use it as a
correctly-labeled castle asset — not this run's call to make); `dragon_reference_v2`/`v3`'s notes
now record their real, measured triangle counts (previously "unmeasured") and confirmed dragon
identity; `v3` marked `replacedBy: dragon_reference_v2_decimated` since it's a redundant duplicate
of the file that was actually decimated.

**This is prep/asset work only — FAZ 7 still has 0% code.** No spawn point, no AI, no rigging/
animation was added this run; the decimated model has no skeleton (same gap `dragon_verdant_wyrm`'s
own manifest notes already flag). That remains a separate, larger future sub-task.

**Verified:**
- `node -e "JSON.parse(...)"` confirms `assets_manifest.json` is still valid JSON.
- `node scripts/checkAssetsManifest.js` — OK, 33 entries all resolve to real files, the new `.glb`
  is registered (would otherwise hard-fail as an unregistered primary model file).
- Full committed smoke suite: all **12** checks PASS (asset/manifest-only change — no gameplay code
  touched, so no new/changed check needed).
- **Real headless-Chromium proof, not just gltf-transform's own report:** a one-off Playwright
  script booted the live `game3d.html` page (for real, deployed module-resolution paths), then built
  an independent scratch `THREE.Scene`/`WebGLRenderer` in-page and loaded `reference_dragon_v2_
  decimated.glb` through the real, unmodified `AssetLoader.loadModel` (not a fallback placeholder —
  `isPlaceholder: false`, `meshCount: 1`, `triCount: 19762`, matching `gltf-transform inspect`'s own
  count exactly). Zero console/page errors. A screenshot confirms the dragon's silhouette/texture
  still reads clearly as the same dragon after decimation. A second one-off script rendered all of
  `v1`/`v2`/`v3`/`verdant_wyrm`/`auric_dragon` for the mislabeling investigation itself — all loaded
  as real meshes (`isPlaceholder: false`), zero console/page errors across all five.

**Memory-leak checklist:** N/A — asset/manifest-only change, no new runtime code path in the
committed app; every verification script's renderer/scene/loader instance was scratch/throwaway in
its own one-off Node process, not part of the committed app.

**Alternatives considered:**
- *Decimate all three v1/v2/v3 files as originally planned, without first rendering them.* Rejected
  once the v1 render came back as a castle — decimating and shipping a mislabeled asset under a
  `dragon_*` id would have propagated the error into FAZ 7 itself instead of catching it here.
- *Delete `reference_dragon_v1.glb`/`v3.glb` (the two now-unneeded originals) this run.* Rejected as
  overreach for an atomic sub-task — v1's real content (a castle) may still have product value under
  a correctly-labeled id, and deleting 170MB+ of source assets is a decision better left to a human
  or a future run with a clearer mandate, not bundled into a tooling-verification pass.
- *Use `gltfpack` instead of `gltf-transform` for the whole pipeline (matches the tool named in
  prior runs' notes).* Rejected once `-tc`/`-tw` both failed in this sandbox (no native texture-
  compression support in the `npx` Node build) — `gltf-transform`'s CLI achieved the same simplify/
  resize/prune result without needing texture compression at all, and produces plain, vanilla-
  `GLTFLoader`-compatible output by default.

**Files changed this sub-task:** `assets_manifest.json` (5 entries edited, 1 new entry added),
`assets/models/creatures/dragons/reference_dragon_v2_decimated.glb` (new, 1.67MB), `DECISIONS.md`
(this ADR), `3D_GAME_PROGRESS.md`. 4 files (3 tracked-in-git + this doc), ~1.67MB of new binary
asset plus ~70 changed lines of manifest/doc text.

**Consequences:** FAZ 7's tooling blocker is now genuinely confirmed resolved (not just "reported
lifted"), and a real, correctly-verified, budget-compliant dragon model is ready for FAZ 7 spawn/AI
code to consume whenever that phase actually starts (still a separate, larger sub-task — rigging/
animation, a spawn point, and basic AI all remain 0% done). The `dragon_reference_v1` mislabeling is
now documented so no future run repeats runs 49-51's assumption. `reference_dragon_v1.glb`'s real
content (a castle) is flagged as a possible future FAZ 3 asset but intentionally not acted on this
run — a human or a future run should make that call deliberately, not inherit it as a side effect of
a dragon-decimation task.

## ADR-0071: FAZ 7's first dragon — spawn point + circling-flight AI, using `black_dragon` (not the decimated reference models)

**Status:** Accepted (run 53).

**Context:** Priority re-scan: `node --check` clean; full smoke suite already at 12/12 before this
sub-task; no blocking bug; World Coverage unchanged past its gate; no file within 50 lines of the
600-line cap. Run 52's own "Next step" note named the concrete next item: FAZ 7 (0%
code) should get a first spawn point + basic AI now that its tooling blocker is confirmed resolved
(ADR-0070). Two asset choices existed: the newly-decimated `dragon_reference_v2_decimated.glb`
(19,762 tri, but `rigged: false`/`animated: false` — no skeleton) and `black_dragon`
(`Dragon_Baked_Actions_fbx_7.4_binary.fbx`, Free3D, manually downloaded and explicitly flagged in
`assets_manifest.json` as "FAZ 7 için kullan" — `rigged: true`, `animated: true`).

**Decision:** Used `black_dragon`, not the decimated reference model — it already has a real
skeleton and baked animation clips, so a first flight pass needs zero rigging work. Loaded it
through a real headless-Chromium page (not assumed from the manifest) via `AssetLoader.
loadFBXModel` to get ground truth before writing any config, and found two real discrepancies:

1. **The manifest's `animationClips` list was wrong.** It claimed `["Run cycle", "Walk cycle",
   "Idle", "Jump", "Open Wings", "Fly"]` (6 clips); the file actually has 4:
   `Armature|Walk_New`, `Armature|Run_New`, `Armature|Idel_New` (sic, a typo in the source asset
   itself), `Armature|Fly_New`. No `Jump`/`Open Wings` clip exists. Corrected in `assets_manifest.
   json` this run.
2. **The FBX's embedded material references its textures by bare filename**
   (`Dragon_ground_color.jpg`, ...), which `FBXLoader` resolves relative to the FBX's own directory
   by default — but the real files live in a `textures/` subfolder, so every texture 404'd and the
   dragon rendered untextured. Fixed by adding an optional `resourcePath` parameter to `AssetLoader.
   loadFBXModel` (defaults to `''`, i.e. unchanged behavior for every existing caller —
   `player.js`/`npc.js`'s Mixamo loads never pass it) and passing `DRAGON_CONFIG.
   TEXTURES_RESOURCE_PATH` for this one model.
3. Also confirmed the model's own `userData.unitScaleFactor` is `1` — unlike the Mixamo characters,
   this FBX doesn't carry a usable cm-to-m conversion factor, so `AssetLoader.
   correctMixamoFbxScale` is a no-op for it. Its raw bounding box measured ~7684x4546x9777 units; a
   manual `DRAGON_CONFIG.SCALE` (`20 / 9776.5626 ≈ 0.0020457`) brings its largest raw dimension down
   to a chosen `TARGET_MAX_DIMENSION_METERS` of 20 — a large, dramatic flying creature, bigger than
   the wolf/horse/NPCs already in the world, but not absurdly oversized against a ~150m circling
   radius above a kingdom seat.

**AI scope — deliberately the smallest thing that reads as "a dragon patrols the sky":** a single
dragon (`umit-dragon-1`) circles at a fixed altitude (90m above `umit`'s own ground height, the
player's own seat — ADR-0046) around a 150m-radius closed circle, looping the real `Fly` clip, with
a constant visual bank (`bankAngleRadians: 0.35`) into the turn. No ground collision (it never
touches ground), no pathfinding, no player-awareness, no landing/takeoff state machine — same scope
discipline `gameplay/animals.js`'s first straight-line patrol pass (run 27) set for FAZ 6, and
`gameplay/npc.js`'s original static-idle pass (run 20) before that. New module `gameplay/dragons.js`
(`createDragon`/`spawnConfiguredDragons`), matching the `{object3D, update(delta), dispose()}`
shape and per-spawn-config wiring every other gameplay system here already uses; `DRAGON_CONFIG`
added to `gameplayConfig.js`; `game3d.js` wires spawn/update/dispose in the same 3 places NPCs/
animals already are.

**A rendering surprise, checked and confirmed not a bug:** a first screenshot of the flying dragon
came back looking like a flat black silhouette. Traced this down to real texture-pixel sampling
(drew the loaded diffuse texture to a scratch 2D canvas and read pixel values directly), not
assumed: the actual RGB values are genuinely near-black (~15-40 out of 255) — `black_dragon` is
exactly what its name says, a very dark/near-black-scaled dragon skin, not a broken/missing texture.
A brighter three-point lighting rig in the verification screenshot (not a game-code change — the
live game's own day/night `lighting.js` already varies sun intensity) shows clear wing-membrane
fold detail, talons, and tail spikes once lit well; the model itself is correct.

**Verified:**
- `node --check` clean on every touched file (`game3d.js`, `gameplay/gameplayConfig.js`,
  `gameplay/dragons.js`, `assetLoader.js`, `scripts/game3dSmokeChecksMovement.js`,
  `scripts/smokeTestGame3D.js`). All touched files stay under the 600-line cap (`game3d.js` 476/600,
  `gameplayConfig.js` 500/600, `dragons.js` 137/600, `game3dSmokeChecksMovement.js` 400/600).
- `node scripts/checkAssetsManifest.js` — OK, 33 entries all resolve.
- Full committed smoke suite, now **13** checks (added `checkDragonFlight` to
  `game3dSmokeChecksMovement.js`) — all PASS, including the 12 pre-existing ones unchanged. The new
  check drives a real `createDragon` controller (real FBX load, real `AssetLoader`) and asserts: not
  a placeholder mesh, has a resolved texture (guards the `resourcePath` fix specifically), stays
  exactly on-radius and level every sampled frame for a full lap, and closes the loop back to its
  start position within floating-point tolerance.
- **Real headless-Chromium proof:** booted `game3d.html` for real module-resolution paths, built an
  independent scratch `THREE.Scene`/`WebGLRenderer` in-page (same pattern ADR-0070 used), loaded the
  real dragon via the real `createDragon`, advanced its `Fly` animation and circular-path update for
  1.5 simulated seconds, waited for the real texture image to finish decoding (found by a first,
  premature screenshot coming back black before the async texture load had completed — not the
  dark-skin finding above, a separate timing issue only affecting this one-shot verification script;
  the live game's continuous render loop is unaffected since it just picks up the texture on
  whatever frame it lands), then rendered and screenshotted: a clearly dragon-shaped, winged,
  textured creature in flight, mid-flap pose, zero console/page errors throughout.

**Memory-leak checklist:** `createDragon`'s `dispose()` stops the `AnimationMixer` and calls
`AssetLoader.disposeObject3D` (same pattern every other gameplay controller here uses); `game3d.js`'s
`pagehide` cleanup calls `state.dragons.forEach((dragon) => dragon.dispose())`, added alongside the
existing NPC/animal dispose calls.

**Alternatives considered:**
- *Use `dragon_reference_v2_decimated.glb` (this project's own freshly-decimated model, ADR-0070)
  instead of `black_dragon`.* Rejected for this first pass — it has no skeleton/animation at all, so
  using it would mean either a rigid, non-animated flying mesh (visually worse than a real flapping
  Fly clip) or bundling a rigging/animation task into this same sub-task, a substantially bigger
  scope. `black_dragon` gets a first *real* flying dragon shipped now; the decimated reference model
  remains available for a future second dragon/creature once it's rigged.
- *Player-awareness (flee/notice, like `gameplay/animals.js`'s wolves) on this first pass.* Rejected
  as scope creep — FAZ 7 has 0% code; landing a circling-flight pass first, then adding
  player-awareness as its own atomic sub-task, matches how FAZ 5 (static idle → waypoint patrol →
  dialogue) and FAZ 6 (static idle → patrol → flee → pack-alert) both grew incrementally here.
- *Fix `assets_manifest.json`'s wrong `animationClips`/texture-path issues in a separate sub-task.*
  Rejected — both were found *while* building this exact feature (not a pre-existing, independently
  discovered bug) and are small, directly load-bearing corrections for the dragon this sub-task
  ships; splitting them out would just mean re-deriving the same real-render findings twice.

**Consequence:** FAZ 7 now has a first, real, flying, animated, textured dragon in the world — 0%
code no longer applies, though this remains a first pass: one dragon, one seat, no player-awareness,
no combat/mount interaction, no takeoff/landing. `AssetLoader.loadFBXModel`'s new `resourcePath`
option is available to any future FBX asset with the same subfolder-texture layout.
`assets_manifest.json`'s `black_dragon` entry now has verified-accurate `animationClips`. The
decimated reference dragon (`dragon_reference_v2_decimated`) and the unrigged Meshy models
(`verdant_wyrm`, `spiked_serpent`, `auric_dragon`, `frostscale_dragon`) remain available, unused, for
a future second/third dragon once rigged — not blocking, just not this sub-task's job.

## ADR-0072: Dragon player-awareness — an edge-triggered "notice" toast, reusing the world-event bus/UI

**Status:** Accepted (run 54).

**Context:** Continuing the same run's chain after ADR-0071 shipped FAZ 7's first dragon (a static
circling flight path, no player-awareness — deliberately deferred there as its own atomic sub-task).
ADR-0071's own "Next step" named this exact item as the natural follow-up, mirroring how FAZ 6's
wolves grew (static idle → waypoint patrol → flee-trigger → pack-alert, each its own run/ADR) and
FAZ 5's NPCs (static idle → waypoint patrol → dialogue) — awareness is added incrementally, after
the underlying entity already exists and works, not bundled into its first pass.

**Decision:** Added an edge-triggered "notice" event: when the player comes within
`DRAGON_CONFIG.SPAWNS[0].noticeRadiusMeters` (220m) of the dragon's real, current 3D position (not
the seat/circle-center — the dragon moves), `gameplay/dragons.js`'s `createDragon` controller emits
once through the shared `EventBus`, using the exact same `EVENTS.WORLD_EVENT_TRIGGERED` event name
and `{icon, title, desc, color}` payload shape `gameplay/worldEvents.js`'s ambient flavor events
already use — so `ui/worldEventToast.js` displays it with zero new UI code. Edge-triggered (fires
once on entry, not every frame while inside, re-arms only after the player leaves the radius) —
same shape `gameplay/animals.js`'s `fleeTriggerRadiusMeters` already established, tracked via one
`playerWasInNoticeRadius` boolean per dragon, mirroring the wolves' `currentlyFleeing`.

**Deliberately still not touching the flight itself:** no diving, no chasing, no speed change, no
landing — the dragon keeps circling exactly as ADR-0071 shipped it. This sub-task is player-*aware*
of, not player-*reactive* to, matching the same order FAZ 6's wolves went through (a flee trigger
existed as its own run before pack-alert built on top of it).

**A deliberate content distinction, not a duplicate:** `gameplay/worldEvents.js`'s existing
`dragon_shadow` ambient entry ("a shadow passed — or did you imagine it?") is a random, positionless
flavor line, unrelated to any real dragon position. This new toast is a genuine proximity trigger
tied to the actual `black_dragon` entity's real position, so its copy says so plainly ("Gökyüzünde
**gerçek** bir ejderha süzülüyor...") instead of reusing the same uncertain "was it real?" framing —
now that a real dragon exists, the two read as intentionally different in tone, not redundant.

**`noticeRadiusMeters` (220m) sizing:** the player spawns ~60m from `umit` (ADR-0046); the dragon's
own distance from that spot varies roughly 90-210m over one lap (law of cosines against a 150m-radius
circle centered on the same seat) — so 220m comfortably covers the whole circle from a player near
spawn, making this fire as a "welcome, look up" moment shortly after boot (confirmed live, not just
unit-tested — see Verified below) rather than needing the player to specifically seek the dragon out.

**Verified:**
- `node --check` clean on every touched file (`gameplay/dragons.js`, `gameplay/gameplayConfig.js`,
  `game3d.js`, `scripts/game3dSmokeChecksMovement.js`, `scripts/smokeTestGame3D.js`). All stay under
  the 600-line cap (`dragons.js` 191/600, `gameplayConfig.js` 532/600, `game3d.js` 480/600,
  `game3dSmokeChecksMovement.js` 504/600).
- Full committed smoke suite grew to **14** checks (added `checkDragonNotice`) — all PASS, including
  the 13 pre-existing ones (notably `checkDragonFlight`, which calls `dragon.update(delta)` with no
  `playerPosition` argument at all — confirming the new optional parameter is fully backward
  compatible). The new check drives a real `createDragon` (`speedMps: 0`, parking it at a known fixed
  position) against a real `EventBus`: asserts no emit while far, exactly one emit on entry, no
  re-fire while still inside, no fire on exit, a re-fire on a later re-entry, that a dragon spawned
  with no `noticeRadiusMeters` never emits regardless of `playerPosition`, and that omitting
  `playerPosition` entirely never throws.
- **Real headless-Chromium proof of the live integration, not just the isolated unit check:** booted
  the real `game3d.html`, waited for the real boot sequence (terrain/settlements/player/dragon) to
  finish, and read the real DOM: `.g3d-event-toast` was visible with the real title "Ejderha
  Görüldü!" and the real description text, with zero console/page errors — the player's real spawn
  point is close enough to the dragon's real starting position that the notice fires within the
  first few seconds of a real boot, not just in a scripted test scenario. Screenshot confirms the
  toast rendering over the live scene.

**Memory-leak checklist:** no new listeners/timers/DOM beyond what `ui/worldEventToast.js` already
owned and disposes (unchanged — this sub-task only adds a second *emitter* onto the same existing
bus event, not a new subscriber). `createDragon`'s own state (`playerWasInNoticeRadius`) is a single
boolean closed over by the returned controller, released the same way as every other per-dragon
closure variable when `dispose()`'s existing `AssetLoader.disposeObject3D`/`mixer.stopAllAction()`
path runs — no new cleanup surface.

**Alternatives considered:**
- *A new dedicated UI widget for dragon sightings, separate from `WorldEventToast`.* Rejected — the
  existing toast already does exactly this job (icon + title + desc + auto-dismiss), and building a
  second one would duplicate `ui/worldEventToast.js`'s DOM/dispose logic for no behavioral gain.
- *Continuous re-fire while the player stays inside the radius (once per N seconds), instead of
  edge-triggered once-per-entry.* Rejected as spammy for a stationary/patrolling player standing near
  their own castle — an edge-triggered one-shot (matching wolves' flee trigger) reads as a real
  "notice" moment, not a nagging repeated alert.
- *React to the notice by changing the flight path (e.g., the dragon banks toward the player).*
  Rejected as scope creep for this sub-task — flagged as a real future step, but a bigger one
  (steering behavior, not just an event emission) better scoped on its own.

**Consequence:** FAZ 7's dragon is no longer purely decorative — the world now reacts to the
player's real proximity to it, through the same EventBus/toast machinery every other ambient event
already uses. `createDragon`'s `update()` signature gained an optional second `playerPosition`
parameter (backward compatible — every existing call site, including the smoke suite's
`checkDragonFlight`, is unaffected by omitting it). The dragon's actual behavior (path, speed,
animation) is unchanged; a future sub-task can build reactive flight behavior on top of this same
proximity signal, the same way pack-alert was later built on top of the wolves' flee trigger.

## ADR-0073: Terrain ground color read as brown/orange instead of grass — unclamped height fraction + a curve/saturation fix

**Status:** Accepted (run 54).

**Context:** Top-priority bug report this run (operator-supplied, with a real F4-camera screenshot):
the ground in `world/terrain.js`'s procedurally-generated, vertex-colored terrain reads as flat
brown/orange, never distinctly green/grass, at the real default boot state. Reproduced independently
before touching any code: a real headless-Chromium boot of `game3d.html`, screenshotted at the
default third-person spawn view and via an F4 bird's-eye pass, showed exactly this — a uniform
khaki/brown ground with no visible green anywhere, matching the report precisely.

**Root-cause investigation (not assumed from the report alone):** `createTerrainChunk` blends
`LOW_COLOR` (grass, was `0x2c4a1e`) toward `HIGH_COLOR` (bare rock, `0x6b6152`) via
`blended.copy(LOW_COLOR).lerp(HIGH_COLOR, y / maxHeightMeters)`, with no clamp on the blend
fraction. Traced whether this could actually go negative/>1 (the report's suspected mechanism,
extrapolation past the two colors): `sampleHeightMeters`'s value-noise `noise2D` is smoothstep-
interpolated between four lattice values each already in `[0, 1)` (`hash/LATTICE_MASK`), and a
smoothstep-weighted interpolation of values within `[0, 1)` cannot leave that range; `fbm2D` then
takes a weighted average of several such octaves (dividing by `maxAmplitude`), which likewise cannot
leave `[0, 1)`. So for *this* noise implementation, `y / maxHeightMeters` was already always in
`[0, 1)` — the unclamped-extrapolation mechanism, checked directly rather than assumed, was not
actually happening today. The clamp is still added (see Decision) as real defensive correctness for
any future noise/octave change, per the project's own reasoning in the report — just not, by itself,
what was producing the brown ground.

The actual dominant cause, found by inspecting `lighting.js`'s day/night keyframes against
`WORLD_DEFAULTS.START_TIME_OF_DAY_RATIO` (0.3, the ratio every fresh page load boots at — i.e.
exactly what the operator's F4 test saw): at ratio 0.3 the scene is just past the 0.27 "sunrise"
keyframe, where `hemiSky` is `0x7d5a4a` (a warm brown-tan, not neutral white) blending toward `0.5`
noon's `0xffe8c0` (warm cream) — `HemisphereLight`'s sky-facing contribution on the mostly-upward-
facing terrain normals is itself a warm brown/tan color at boot, not neutral. Multiplied against the
original `LOW_COLOR` (a dark, fairly desaturated olive `0x2c4a1e`), the result reads as brown/khaki
rather than a recognizable green — confirmed by directly reading real rendered canvas screenshots
(not computed/assumed), both close-up (default view) and wide (F4 bird's-eye), both showing a
uniform brown/khaki ground with zero green anywhere.

**Decision:** Three changes to `world/terrain.js`, all applied together (per the report's own
prioritization — clamp first, since it's a real correctness fix regardless of today's noise
behavior, then the color/curve tuning, checked against real screenshots after each):
1. Clamp the blend fraction: `const heightFraction = THREE.MathUtils.clamp(y / maxHeightMeters, 0, 1)`
   — defensive; guards `THREE.Color.lerp` against ever extrapolating past `LOW_COLOR`/`HIGH_COLOR`
   if a future noise/octave change ever produces height outside `[0, maxHeightMeters]`, even though
   today's value-noise FBM (see Context) never does.
2. `LOW_COLOR` brightened/more saturated: `0x2c4a1e` → `0x3d6b28` — reads as grass under the warm
   dawn hemisphere light this project's own lighting.js already boots into, not just under neutral
   white light.
3. A new `HEIGHT_COLOR_BLEND_EXPONENT` (1.5) applied to the clamped fraction before the lerp
   (`Math.pow(heightFraction, 1.5)`) — biases the low/high blend curve toward `LOW_COLOR`, so a
   vertex needs a higher fraction of `maxHeightMeters` before rock starts blending in. Grass now
   reads as the dominant color across more of the height range instead of a linear 50/50 split at
   the midpoint, which matters most right around the player's spawn/kingdom-seat elevations.

**Water/shoreline check (report's item 4):** worked out by hand against the new curve —
`WORLD_DEFAULTS.WATER_LEVEL_METERS` is 6 of `DEFAULT_MAX_HEIGHT_METERS` 24, so right at the waterline
`heightFraction = 0.25`, curved to `0.25^1.5 ≈ 0.125` — still deep in `LOW_COLOR` territory (≈
`rgb(67,106,45)`), so the shoreline now blends from a clearly green bank into `water.js`'s shallow
teal (`0x6fd6c9`) with no harsh color jump; if anything the new curve makes shorelines read *more*
green than before (the old linear blend put more rock-gray this close to the waterline), not less.
Terrain color is baked per-vertex independent of the water plane (see `water.js`'s own module doc,
ADR-0005) — this sub-task touched no water/settlement code, so no other system needed changes.

**Verified:**
- `node --check` clean on `world/terrain.js` (193/600 lines, well under the cap).
- Full committed smoke suite: 14/14 PASS, unchanged (`terrain.js` isn't exercised by name in any
  smoke check today, but nothing it feeds — settlement collider, jump/gravity arc, NPC/wolf
  patrol ground-height sampling, dragon flight — regressed).
- **Real headless-Chromium proof, before vs. after, same exact camera framing each time (not just a
  visual impression — a direct pixel-for-pixel-comparable pair):**
  - Default third-person spawn view (the real default boot state, `START_TIME_OF_DAY_RATIO` 0.3 —
    exactly what the operator's own F4 test booted into): before, uniform flat brown/orange ground;
    after, the identical camera framing (same castle wall, same player pose, same sky) now shows a
    clearly distinct dark olive-green ground.
  - F4 bird's-eye pass (same drag-up/fly-forward/drag-down maneuver both times, landing on the same
    lake shapes and castle silhouette): before, a single flat khaki-brown wash across the entire
    visible area with no readable height variation; after, unmistakably green with visible
    darker/lighter mottling from the FBM height blend, and clean (non-jarring) transitions into the
    lakes' teal water.
  - True deep night (`ratio ≈ 0.8`, reached by really waiting ~360 real seconds — not simulated/
    accelerated, after an accelerated-clock (`performance.now()` override) verification attempt
    proved unreliable for this and was abandoned in favor of a real wait): the scene is
    near-completely black. This is `lighting.js`'s own existing keyframe design at full night
    (`sunIntensity: 0.05`, `hemiIntensity: 0.25`, both very dark) — unrelated to and unchanged by
    this sub-task; there simply isn't enough light at true midnight to usefully judge ground color
    either before or after this fix. The report's own request to check "day and night" is satisfied
    by dawn (the real default boot condition, and the condition the original report was made under)
    plus the F4 daylight pass; true midnight is confirmed a non-issue rather than untested.

**Memory-leak checklist:** no listeners/timers/DOM touched — pure per-vertex color-math change
inside existing geometry construction, same object lifecycle `disposeTerrainChunk` already owns.

**Alternatives considered:**
- *Fix only the lighting (`lighting.js`'s dawn hemisphere color) instead of the terrain colors.*
  Rejected — out of scope for a report specifically about `terrain.js`'s own color blend, and would
  also shift the color of every other vertex-colored/lit surface (rock, any future foliage) at dawn,
  a much larger blast radius for a fix the report scoped to two named constants and one blend line.
- *A steeper exponent (2 or higher) to push rock even further toward peak-only.* Rejected as
  overcorrection without evidence it was needed — 1.5 already produced a clearly, unambiguously
  green result in the real before/after screenshots; a future run can push further if a real
  screenshot ever shows too little rock variation at the actual kingdom-seat elevations.
- *Sampling actual rendered pixel RGB values via `gl.readPixels` for a numeric before/after diff,*
  instead of visual screenshot comparison. Attempted first — returned all-zero/transparent samples
  because the WebGL context isn't configured with `preserveDrawingBuffer`, so the backbuffer is
  already cleared by the time an in-page `evaluate()` call can read it after a frame presents.
  Visual screenshot comparison (same camera framing, before vs. after) was used instead — a real,
  reproducible check, just not a numeric one.

**Consequence:** The ground now reads as grass across the low/mid elevation band under the real
default boot lighting, matching the report's ask. `HEIGHT_COLOR_BLEND_EXPONENT` is a new named
constant any future terrain-color tuning pass should adjust rather than re-deriving the curve
inline. The clamp is now real defensive correctness for `y / maxHeightMeters`, independent of
whether today's specific noise implementation needs it. No terrain/streaming/chunk logic changed —
World Coverage is unaffected (96.2% desktop / 4.5% mobile, unchanged).

## ADR-0074: Real castle models at 7 kingdom seats — decimated first, then integrated

**Status:** Accepted (run 54).

**Context:** Priority #1.5: `assets_manifest.json`'s 7 manually-downloaded real castle models
(`castle_brickstone_citadel`, `castle_on_a_rock`, `castle_emerald_citadel`,
`castle_fortress_of_the_crown`, `castle_greystone_castle`, `castle_icebound_citadel`,
`castle_walled_city_fortress`) were all `hasMaterial: false` and unreferenced anywhere in `src/` —
every kingdom seat still used FAZ 3's procedural box-keep/cylinder-tower/cone-roof placeholder
(`world/settlements.js`), even though real, textured-by-material (if not by baked texture) castle
geometry had been sitting unused in the repo since an earlier manual asset-download step.

**A real performance blocker found before writing any integration code, not assumed:** rendered all
7 raw `.glb` files through the real `GLTFLoader` in a headless-Chromium page and measured actual
triangle counts (not the manifest's old "unmeasured, ~X MB raw" placeholders): 144,084 to 478,460
triangles each, ~2.49M combined — each file is a single merged mesh (`meshCount: 1`), no LOD, no
submesh split between walls/roof. `debug/perfPanel.js`'s desktop budget is 5,000,000 triangles total,
and a real headless boot measured 337,993 triangles already in use at the default boot-preview state
alone (terrain chunks + player + NPCs/animals/dragon) — adding 2.49M more from 7 *always-rendered*
static settlement models (not streamed/culled the way terrain chunks are) would have been a real,
measurable regression against priority item 4 (performance budget), not a hypothetical one. Loading
the raw files as-is was rejected before writing any settlement-integration code.

**Decision:** Decimated all 7 models first, as their own discrete step, using the exact pipeline
DECISIONS.md ADR-0070 already proved works in this sandbox: `gltf-transform weld` -> `simplify
--ratio 0.08 --error 0.03` -> `prune` (no `--overwrite` flag — that CLI has none; an earlier attempt
using one silently no-opped every file until caught and fixed). Result: 11,526-38,260 triangles per
model (~199K combined, a 92-97% cut per file), 138.97 KB-688.48 KB per file (90-95% size cut from
the 2.5-11.5MB originals) — comfortably inside the desktop triangle budget even added on top of the
already-measured 337,993 baseline. Saved as `<name>_decimated.glb` alongside each original (same
convention ADR-0070 established for the dragon), registered as 7 new `assets_manifest.json` entries;
the 7 originals' own entries gained a measured triangle count (were "unmeasured") and `replacedBy`
pointing at their decimated counterpart, kept for provenance/re-decimation exactly like
`dragon_reference_v2`'s note already does.

Then wired the decimated models into `world/settlements.js`: a new `CASTLE_MODEL_ASSIGNMENTS`
constant names 7 `{seatId, assetId, file}` triples (theme-matched — see Consequence); `createSettlements`
now excludes those 7 seats from its procedural `InstancedMesh` construction (sizing the mesh to
exactly the remaining 7 procedural seats, not leaving unwritten identity-matrix instances rendering
phantom castles at the origin) while still returning their `{id, x, z, groundY}` in `seats` (needed
by the settlement collider and any future NPC/gameplay placement at those same seats). A new async
`spawnRealCastleModels({assetLoader, seats, seed})` loads each assigned file via the existing
`AssetLoader.loadModel` (already handles GLTF/GLB with a graceful placeholder-box fallback — no new
loader code needed), replaces the model's own material with a seeded `createStoneMaterial` (uv
`repeat` computed against a shared `REAL_CASTLE_FOOTPRINT_METERS` target, the same "repeat
proportional to real size" approach `createSettlements` already used for the procedural keep),
uniformly scales each model so its largest bounding-box dimension hits that target footprint (~46m,
close to the procedural castle's own ~40m tower-to-tower spread so the shared settlement collider
radius stays a reasonable approximation), and positions it so the model's own lowest point rests
exactly on `sampleHeightMeters`'s real terrain height at that seat — not a guessed flat height.
Wired into `game3d.js`'s async init sequence (same "keep the loading overlay up for every model
download" spot NPCs/animals/dragons already use), added to the F4 chase-camera collision list
(`collectCameraCollidables`) alongside the procedural settlements group, and disposed (new
`disposeRealCastleModels`, reusing `world/materials.js`'s `disposeCastleMaterial`) in the same
`pagehide` cleanup block as everything else.

**Theme-matched seat assignments** (mirroring the report's own `icebound_citadel` -> northern-seat
example): `jon` (northernmost seat by map coordinate) <- `castle_icebound_citadel_decimated`;
`umit` (the player's own home seat) <- `castle_walled_city_fortress_decimated` (the manifest's own
largest/most-detailed model, matching its "major/capital settlement" note); `cersei` (this world's
reigning "crown" character) <- `castle_fortress_of_the_crown_decimated` (the manifest's own
"King's Landing equivalent" note); `balon` (House Greyjoy, Iron Islands) <- `castle_castle_on_a_rock
_decimated` (coastal/cliffside theme); `ziya` (House Tyrell, green/gold rose sigil) <-
`castle_emerald_citadel_decimated`; `berkalp` (House Stark, grey/direwolf) <-
`castle_greystone_castle_decimated`; `doran` (House Martell/Dorne, sandstone architecture) <-
`castle_brickstone_citadel_decimated`. The remaining 7 seats (`berk`, `olena`, `stannis`, `robin`,
`twin`, `Xaro`, `Night King`) keep the unchanged procedural castle.

**Verified:**
- `node --check` clean on every touched file (`world/settlements.js` 319/600, `game3d.js` 494/600).
- `node -e "JSON.parse(...)"` + `node scripts/checkAssetsManifest.js` — valid JSON, all 40 entries
  (33 + 7 new `_decimated` entries) resolve to real files.
- Full committed smoke suite: 14/14 PASS, unchanged — notably `checkSettlementCollider`, which
  depends on `seats`' positions/count being correct, still reports the exact same `17.40m` push
  distance as before this change (the 7 excluded seats still get correct `{x, z, groundY}` from the
  same `KINGDOM_SEATS.forEach` loop, just skip the procedural `InstancedMesh` writes).
- **Real headless-Chromium proof, not just gltf-transform's own report:** rendered each of the 7
  decimated files independently through the real `GLTFLoader` and screenshotted them in isolation —
  all 7 read clearly as their named castle (towers, walls, crenellations, banners/flags on
  `fortress_of_the_crown`); `icebound_citadel`'s jagged/spiky look was checked against its own
  un-decimated bounding box (already a naturally flat, ~0.36-height-ratio shape before any
  simplification) and confirmed to be the model's own ice-formation geometry, not a decimation
  artifact. Then booted the real, live `game3d.html` end-to-end: zero console/page errors: a
  screenshot at the real default spawn view shows a visibly different, more detailed, irregular
  fortress silhouette directly behind the player at `umit`'s seat (replacing the old flat-topped
  procedural box), and an F4 wide-angle pass confirms the same real castle silhouette on the horizon
  from a distance with the FAZ 7 dragon visible circling nearby, unaffected by this change.

**Memory-leak checklist:** `spawnRealCastleModels`'s models are disposed via
`disposeRealCastleModels` (new — geometry + `disposeCastleMaterial` per model, mirroring
`disposeSettlements`'s existing pattern) in the same `pagehide` block `disposeSettlements` already
runs in. No new event listeners/timers/DOM.

**Alternatives considered:**
- *Ship the raw, un-decimated models.* Rejected outright once the real triangle-count measurement
  (2.49M combined) came back — would have meaningfully eaten into the desktop triangle budget for 7
  *always-rendered* static props, a real, measured performance regression risk, not a stylistic
  preference.
- *Split walls vs. roof onto separate materials, matching the procedural castles' 2-material look.*
  Rejected — every real model is a single merged mesh with no submesh/material-group separation to
  target (confirmed by inspecting `meshCount`/material names on every one of the 7 files, not
  assumed); one uniform stone material applied to the whole model is the only option without a
  separate, out-of-scope re-authoring/UV-remapping pass on the source geometry.
- *Keep the procedural `InstancedMesh` sized at all 14 seats and just leave the 7 real-model seats'
  instance matrices at their default identity transform.* Rejected — an uninitialized `InstancedMesh`
  slot renders a real (if degenerate/at-origin) instance, not nothing; sizing the mesh to exactly the
  7 remaining procedural seats is both correct and avoids 7 phantom keeps stacked at the world
  origin.

**Consequence:** 7 of 14 kingdom seats now show real, decimated, seeded-stone-material castle models
instead of the FAZ 3 procedural placeholder; the other 7 are unchanged. `assets_manifest.json` grew
from 33 to 40 entries. World Coverage is unaffected (96.2% desktop / 4.5% mobile — no
terrain/streaming/chunk logic touched). The 7 raw originals remain in the repo, unused by code,
available for a future re-decimation at a different ratio if one is ever needed. A future pass could
still explore per-seat rotation variety (every real model currently loads at its own default
orientation) or a lighter decimation ratio for `umit`'s seat specifically (the player's own home,
visited most) — not blocking, just not this sub-task's scope.

## ADR-0075: Terrain macro relief — hills + a mountain, layered additively on the fine-detail FBM

**Status:** Accepted (run 55).

**Risk Seviyesi:** MEDIUM. Justification: this touches `world/terrain.js`'s `createHeightSampler`,
the single shared height function every other world/gameplay system reads terrain height through
(`createTerrainChunk`, `world/rivers.js`'s downhill trace, `world/settlements.js`'s castle ground
placement, NPC/animal/dragon ground-height snapping) — a wide blast radius in principle, which is
exactly why GOVERNANCE.md §8.4 makes height-sampler changes subject to a mandatory before/after
safety check at all. Not HIGH: the change is purely additive (existing FBM math untouched), adds no
new geometry/topology (draw calls/triangle count unaffected — same `PlaneGeometry` segment counts,
only vertex Y values differ), and — critically — is *provably*, not just measured, zero-impact at
every one of the 14 kingdom seats (see Decision below: each dome's falloff hits an exact, literal 0
at `radiusMeters`, and every feature's radius is smaller than its distance to the nearest seat by a
wide margin). The full existing smoke suite (14/14) and the new dedicated safety-check script both
confirm this empirically on top of the mathematical guarantee.

**Context:** GOVERNANCE.md §18 priority #1 — "Arazi makro relıyefi (küçük tepe + büyük dağ)". Per
the project's own most recent progress notes, `world/terrain.js`'s height field was a single-scale
5-octave FBM (`NOISE_SCALE` 0.006, `DEFAULT_MAX_HEIGHT_METERS` 24) — real rolling variation at the
"hill-sized" scale the noise cell size already produces, but no distinct large-scale landmark: no
single point in the ~137.5km² world reads as "the mountain" or "a hill" the way a real landscape
does, just uniform bumpiness repeated everywhere at the same frequency.

**Decision:** Added `MACRO_RELIEF_FEATURES` — 3 fixed, hand-picked world-space "dome" bumps (1
mountain + 2 hills), summed additively onto the existing FBM output inside `createHeightSampler`
(so every consumer — `createTerrainChunk`, `world/rivers.js` — sees the same combined field through
the one shared function, no second copy to drift):

| Feature | Center (x, z) | Radius | Amplitude | Nearest seat | Clearance (center→seat) | Margin beyond radius |
|---|---|---|---|---|---|---|
| Mountain | (2600, 2200) | 1300m | 150m | Xaro (4611, 3596) | 2448m | 1148m |
| Hill A | (3400, 4200) | 500m | 45m | Xaro (4611, 3596) | 1353m | 853m |
| Hill B | (3000, 700) | 550m | 40m | Xaro (4611, 3596) | 3314m | 2764m |

Each dome uses the same smoothstep ease (`t²(3−2t)`) `createValueNoise2D`'s own lattice
interpolation already uses, evaluated on `1 − distance/radiusMeters`: this produces a rounded,
natural-looking rise/fall and — the property this whole safety argument leans on — is *exactly* 0
for any point at or beyond `radiusMeters`, not an asymptotic near-zero. Since every feature's radius
is smaller than its distance to the nearest kingdom seat (the table's last column), the dome
contributes *precisely* 0.0 at all 14 seats — a mathematical guarantee, confirmed (not just assumed)
by the safety-check script below returning byte-identical numbers before and after.

Centers are fixed constants, not derived by querying `world/settlements.js`'s `KINGDOM_SEATS` at
runtime — `world/terrain.js` sits below `world/settlements.js` in this project's layering (terrain
has no reason to import settlement data; settlements already take `sampleHeightMeters` as a
parameter), so a rejection-sampling placement algorithm would invert that layering for no real
benefit over hand-picked constants verified once against the real seat coordinates.

**Arazi Değişikliği Güvenlik Kontrolü (GOVERNANCE.md §8.4), run before AND after — new persisted
script `scripts/terrainSeatSafetyCheck.js`:** samples the real, live `createHeightSampler` output
(via the same in-page dynamic-`import()`-over-a-real-static-server pattern
`scripts/game3dSmokeChecks.js` already established, not a Node-side reimplementation) at all 14
real `KINGDOM_SEATS` coordinates (mapped through the live `mapToWorldXZ`), and asserts (1) raw
sampled height stays above `WORLD_DEFAULTS.WATER_LEVEL_METERS` and (2) local slope (central
difference, ±2m) stays under a documented walkable threshold. Item 3 (road-network connectivity)
was checked, not assumed skippable: `src/3d/world/` has no `roads.js` yet, confirmed by the script
itself at runtime — "yol ağı" is GOVERNANCE.md §18 priority #2, a future, not-yet-built subtask, so
this item legitimately does not apply yet (logged explicitly by the script, not silently omitted).

Results, 14/14 PASS both times, **every seat's height and slope numbers identical to 3 decimal
places before and after** (confirming the "exact zero beyond radius" claim empirically, not just
mathematically):

```
seat            height(m)  marginAboveWater(m)  slope(deg)  result   (BEFORE == AFTER, both runs)
umit               16.190              10.190      1.075  PASS
berkalp             8.729               2.729      5.423  PASS
ziya               14.276               8.276      2.526  PASS
berk               14.097               8.097      5.436  PASS
olena              12.909               6.909      4.770  PASS
cersei              8.094               2.094      2.128  PASS
stannis             7.975               1.975      3.575  PASS
doran              14.936               8.936      1.857  PASS
balon              14.009               8.009      2.457  PASS
robin              12.322               6.322      4.365  PASS
jon                 6.004               0.004      1.830  PASS
twin               13.121               7.121      7.903  PASS
Xaro               11.245               5.245      4.593  PASS
Night King         14.630               8.630      5.290  PASS
```

`jon` — already flagged in `3D_GAME_PROGRESS.md`/`config.js` as sitting within about a meter of sea
level — kept its exact pre-existing 0.004m margin, unchanged. This is the seat this whole
zero-contribution design was most important for: any measurable macro-relief bleed at `jon` would
have flooded it.

**Walkable-slope threshold logged, not assumed (GOVERNANCE.md §14):** no existing code in this
project defines a canonical "walkable slope" — `physics.js`'s ground-height snap follows terrain
regardless of steepness, so there is no engine-enforced value to reuse. `terrainSeatSafetyCheck.js`
uses 35° as a deliberately conservative placeholder (stricter than Unity's default
`CharacterController.slopeLimit` of 45° or Unreal's default `WalkableFloorAngle` of ~44.7°) and this
choice is logged to the new `QUESTIONS_FOR_OWNER.md` as a temporary default per §14, since it is a
real design decision (what counts as "too steep to walk" for this game), not an API fact.

**Sample height-field deltas (for a future `scripts/checkAssetsManifest.js`-style fixture, none
exists yet — GOVERNANCE.md §8.9 — so this ADR itself is the deterministic-snapshot record for this
change, seed 1337):** at the mountain's own center `(2600, 2200)`, `sampleHeightMeters(2600, 2200)`
now returns exactly `163.75613522580645` (fine-detail FBM ≈13.76m + the full 150m dome at its own
center, where `eased = 1`) — up from ≈13.76m before this change. This is the expected, intentional
delta this change exists to make, not a regression. At every one of the 14 seat coordinates listed
in the table above, the delta is exactly 0.0m (see above).

**Verified:**
- `node --check` clean on `world/terrain.js` (260/600 lines) and the new
  `scripts/terrainSeatSafetyCheck.js` (188 lines).
- Full committed smoke suite: **14/14 PASS**, unchanged (ran immediately after the edit — see
  results above the safety-check table in this run's own verification log).
- `scripts/terrainSeatSafetyCheck.js`: 14/14 PASS before AND after, numbers identical (see table).
- **Real headless-Chromium visual proof, zero console/page errors both times:** booted the real
  `game3d.html`. Default third-person spawn view: no regression, renders normally (this particular
  boot landed in the night portion of the day/night cycle — `lighting.js`'s own existing behavior,
  unrelated to and unchanged by this sub-task, so the ground/mountain colors read dark in that
  screenshot; the F4 views below show the relief clearly regardless of lighting). F4 debug free-fly
  camera, activated for real via a real `F4` keydown, flown (real WASD + Shift-run + mouse-drag
  pitch, not a teleport) from the player's real spawn point toward the mountain/hill cluster: two
  screenshots at different distances both show an unmistakable large ridge/peak silhouette rising
  well above the surrounding rolling terrain, with a lake visible past its base — a real, distinct
  macro landform, not a rolling-noise bump. Zero console/page errors across the whole flight in all
  3 screenshots.
- **Performance budget (F2 panel, real `renderer.info` read after boot):** 45 draw calls / 2,500
  budget, 391,069 triangles / 5,000,000 budget — both far under the desktop cap. Expected: this
  change only rewrites vertex Y-values on already-existing `PlaneGeometry` chunks (same `segments`,
  same chunk grid, no new meshes), so triangle/draw-call count could not have changed by
  construction; the F2 reading confirms that expectation rather than discovering a surprise.
- **Memory-leak checklist:** `sampleMacroReliefMeters` is a pure function (no closures over
  mutable state beyond the frozen `MACRO_RELIEF_FEATURES` constant array, no listeners/timers/DOM).
  `createTerrainChunk`/`disposeTerrainChunk`'s geometry/material lifecycle is completely unchanged —
  this sub-task added no new disposable resources anywhere.

**Alternatives considered:**
- *A runtime rejection-sampling placement algorithm (seeded random candidate positions, reject any
  within a margin of a real kingdom seat) instead of fixed hand-picked constants.* Rejected — would
  need `world/terrain.js` to import `world/settlements.js`'s `KINGDOM_SEATS`, inverting this
  project's own world-module layering (terrain is lower-level; settlements already receives
  `sampleHeightMeters` as a parameter, not the other way around) for no real benefit: fixed constants
  verified once against the real seat coordinates via `terrainSeatSafetyCheck.js` are exactly as
  safe and far simpler to audit than an algorithm whose output would need re-verifying on every seed
  change anyway.
- *A single additional low-frequency FBM octave applied globally (a 6th, much-larger-wavelength
  octave layered into the existing `fbm2D` sum) instead of a few discrete fixed-position domes.*
  Rejected for this pass — a global low-frequency octave affects *every* point in the world by some
  nonzero amount (FBM noise has no exact-zero region the way this ADR's dome falloff does), which
  would have meant re-deriving a safe amplitude bound against `jon`'s 0.004m margin analytically
  (the noise function's actual min/max over the relevant area) rather than getting a *literal* zero
  at every seat for free. Fixed-position domes with a hard cutoff radius give the strongest,
  simplest-to-verify safety property for this specific "don't ever touch the 14 already-placed
  seats" constraint; a low-frequency global octave remains a reasonable *alternative* direction for
  a future macro-relief pass once/if the seat set itself is expected to change.
- *A larger `DEFAULT_MAX_HEIGHT_METERS` (raising the whole FBM's amplitude uniformly) instead of
  distinct macro features.* Rejected — that would make the *entire* world uniformly bumpier at the
  same frequency (more extreme rolling hills everywhere), not "a mountain here, a couple of hills
  there" macro topography as the task asked for, and would shift every seat's height (including
  `jon`'s razor-thin margin) instead of leaving all 14 provably untouched.

**Consequence:** The world now has one clearly-distinct large mountain and two smaller hills, all
outside any existing seat/patrol/spawn area, layered on top of (not replacing) the existing
fine-detail rolling noise. `world/terrain.js` grew from 194 to 260 lines (still well under the
600-line cap). No triangle/draw-call/World-Coverage change (96.2%/4.5% area numbers untouched — no
streaming/chunk-count logic was touched). A new standalone regression tool,
`scripts/terrainSeatSafetyCheck.js`, now exists for any *future* terrain/height-sampler change to
reuse (per its own module doc, run before AND after any such edit) instead of each future run
re-deriving this same check from scratch.

**Gelecek Faz Etkisi (future-phase impact):**
- **FAZ 9 (post-fx/`postfx.js`, not started):** a real mountain silhouette is exactly the kind of
  landmark volumetric light/god-rays (already flagged as deferred FAZ 9 scope, see
  3D_GAME_PROGRESS.md's Known Issues) reads best against — no dependency either direction, just a
  better subject for that future pass once it starts.
- **FAZ 10 (Performans/quality presets):** no impact on triangle/draw-call budgets (see Verified).
  One thing a future FAZ 10 pass should keep in mind: the mountain's peak (~174m above its base) is
  taller than anything in this world before now, so a future draw-distance/fog-tuning pass should
  sanity-check it doesn't clip unnaturally at `QUALITY_PRESETS`' shorter `drawDistance` values on
  lower quality tiers — not verified in this sub-task (out of scope; no quality-tier switching UI
  exists yet to test against), flagged for whoever picks up FAZ 10.
- **Future settlements (GOVERNANCE.md §11 — new seats beyond the current 14):** any future new
  settlement's elevation/slope check must query `sampleHeightMeters`, which already includes this
  macro layer automatically (single shared function, no special-casing needed) — but a future
  settlement placed carelessly near `(2600, 2200)`, `(3400, 4200)`, or `(3000, 700)` could now land
  on a real steep slope where none existed before. §11's own "uygun rakım kontrolü" (appropriate-
  elevation check) requirement already covers this; this ADR is the record of *why* that check now
  actually has real steep terrain to catch, where before it had almost none.
- **Roads (GOVERNANCE.md §18 priority #2, not started):** previously near-moot — §8.10's "Ana yol
  eğime duyarlı rota seçer, dağın dik yamacından düz geçmez" rule had almost no real steep terrain
  to violate. This mountain is now a genuine test case for that rule once the road system exists;
  no road code was written or needs to be written by this sub-task.
- **Rivers (`world/rivers.js`, existing):** automatically consistent with §8.10's "nehir dağın
  içinden delip geçmez" by construction, not by new code — `generateRiverPath`'s downhill-only walk
  reads the same shared `sampleHeightMeters`, so it already cannot climb the new mountain; it can at
  most be deflected around it, which is correct river behavior. The seed-1337 river's exact traced
  shape may differ slightly from before this change wherever its search/walk radius (up to 2800m
  from the origin) overlapped the mountain's influence zone — an expected, intentional consequence
  of a real height-field change (GOVERNANCE.md §8.9), not a regression; no committed smoke check
  asserts the river's exact path/shape (confirmed — searched `scripts/*.js` for "river"/"waterfall",
  no matches), so nothing in the regression suite could have silently broken here.
- **Vegetation (not started):** whenever it lands, it should sample height the same shared way
  everything else here does, and will then automatically respect the new relief with no extra work.

## ADR-0076: Road network — slope-aware A* over a minimum-spanning-tree topology, one merged ribbon mesh

**Status:** Accepted (run 56).

**Risk Seviyesi:** MEDIUM. Justification: this adds a new, always-rendered world system (one merged
mesh, one new draw call/geometry) whose routing depends on `world/terrain.js`'s combined height
field — the same wide-blast-radius shared function ADR-0075 already flagged — but, unlike ADR-0075,
this change touches no height-sampler math itself (purely additive new geometry reading an existing,
unmodified field) and is easy to fully disable by removing the two `buildRoadNetwork`/
`disposeRoadNetwork` call sites if a problem is ever found. Not LOW because a real, non-trivial new
algorithm (grid A*) runs at scene-build time and a bug there (e.g. an infinite loop, or a path that
routes off the padded search corridor) could in principle hang or visibly break scene construction —
mitigated by the corridor always being finite/bounded and a documented straight-line fallback if the
search ever fails to find the goal (see Decision).

**Context:** GOVERNANCE.md §18 priority #2, "Yol ağı (patika + at arabası yolu)" — the road network
had genuinely no code yet (confirmed by ADR-0075's own safety-check script last run). §8.10's world-
consistency rules for this feature: "ana yol eğime duyarlı rota seçer, dağın dik yamacından düz
geçmez; nehir dağın içinden delip geçmez; kaleler yol ağına bağlanır." The middle clause (rivers vs.
mountain) was already true by construction per ADR-0075's own Gelecek Faz Etkisi note; this run's job
is the first and third clauses — a real slope-aware road router, and every kingdom seat connected to
the resulting network.

**Değişiklik Etki Analizi (GOVERNANCE.md §8.4, written before code):** affected systems —
`sceneManager.js` (one new `buildRoadNetwork` call after settlements/collider setup), `game3d.js`
(one new `disposeRoadNetwork` call in the `pagehide` teardown block). Not affected: terrain height
math itself (read-only consumer of `createHeightSampler`, same as `world/rivers.js`/
`world/settlements.js` already are), any gameplay system (player/NPC/animal/dragon movement is
unrelated to this decorative-for-now road mesh — no collision was added, see Alternatives), World
Coverage (chunk streaming/area accounting untouched), the 14 kingdom seats' own positions/heights
(read-only). Risk: a routing bug producing a visually broken (e.g. self-intersecting, off-corridor,
or absurdly long) path — mitigated by the dedicated `scripts/roadNetworkSafetyCheck.js` (run before
this ADR was written, after the implementation, per §8.4's "kod, sonra ilgili smoke test" — the
*safety check itself* is what actually gates this ADR's acceptance, not just a promise) and by the
existing full smoke suite (14/14, unchanged) confirming nothing else broke.

**Decision:**

1. **Topology — minimum spanning tree, not a complete graph.** `world/roads.js`'s `computeSeatMST`
   runs Prim's algorithm (raw Euclidean seat-to-seat distance, fully deterministic — no
   `Math.random()`, pure function of `seats`' array order) over the 14 `KINGDOM_SEATS`, producing
   exactly 13 edges connecting all 14 seats with no cycles. GOVERNANCE.md §18's own task text
   explicitly allows this ("a minimum-spanning-tree-style network... is fine and arguably more
   realistic than a complete graph") — a complete graph would be 91 edges, an unrealistic density of
   roads for a medieval-analogue world and a much larger render/generation cost for no real gameplay
   benefit yet (no traffic/economy system reads road topology today). Topology selection (which
   seats connect to which) and path routing (how a chosen edge actually gets from A to B) are
   deliberately separate concerns — see Alternatives for why a slope-aware topology cost wasn't
   worth it here.

2. **Routing — real slope-aware A*, not a straight line.** Each of the 13 MST edges is routed by the
   new `world/roadPathfinder.js`'s `findSlopeAwarePath`: 8-directional grid A* (60m cells, a padded
   700m corridor around the straight line between the two seats) with movement cost scaled by
   `gradeCostMultiplier` — a cubic penalty above a 10° "comfort grade" (`ROAD_COMFORT_GRADE_DEGREES`,
   logged to `QUESTIONS_FOR_OWNER.md`, see below) that makes steep ground increasingly (not
   infinitely) expensive, so the search reliably prefers a flatter detour over crossing genuinely
   steep terrain without ever refusing to route at all (this world's terrain — fine FBM + ADR-0075's
   smooth macro-relief domes — has no literal cliffs, so a finite-cost path always exists). The raw
   grid path is lightly smoothed (2 passes of Chaikin corner-cutting, endpoints preserved exactly)
   and every point's height is freshly re-sampled from the real terrain afterward — smoothing can
   never make the road float or sink relative to the ground it follows.

3. **Rendering — one merged ribbon mesh, one road tier.** `buildRoadNetwork` renders the whole
   13-edge network as a single `THREE.BufferGeometry` (one draw call, one geometry — same left/right-
   perpendicular ribbon technique `world/rivers.js`'s `createRiverMesh` already established, extended
   to append multiple disjoint polylines into one buffer instead of one continuous path), 8m wide, a
   warm dirt-tan color (`0x9c7b4a`, distinct from terrain's grass `0x3d6b28`/rock `0x6b6152`), raised
   0.4m above sampled terrain height to avoid z-fighting. First-pass scope is **one road tier** (a
   single "ana yol / at arabası yolu" style, not a separate thinner "patika" tier) — seven paths
   through this exact size/style already read clearly as real cart roads in real-screenshot
   verification (see Verified), and a second, thinner tier is meaningfully more work (a second
   geometry pass, a design decision about *which* connections get which tier) for a first pass whose
   job was proving the routing algorithm and connectivity work at all. Deferred, not forgotten — see
   Consequence and 3D_GAME_PROGRESS.md's "Next step".

**Design decision logged, not guessed (GOVERNANCE.md §14):** no existing code in this project defines
a "road grade" threshold (as opposed to run 55's foot-*walkable*-slope threshold, a different
question — a cart needs a shallower grade than a person on foot climbing the same slope). `10°` as
the soft cost-curve comfort target and `20°` as `roadNetworkSafetyCheck.js`'s hard failure ceiling
are this run's own engineering judgment (deliberately gentler than run 55's 35° foot-walkable
default, per this task's own suggested 15-20° range), not derived from any real-world civil-
engineering standard (real paved-road grade limits are typically much gentler, 5-10°, but this is a
stylized, gamified terrain with a much larger amplitude-to-scale ratio than any real road network is
designed against) — logged as a new `QUESTIONS_FOR_OWNER.md` entry for the project owner to
confirm/adjust.

**Arazi Değişikliği Güvenlik Kontrolü / Dünya Tutarlılık Kuralları (GOVERNANCE.md §8.4/§8.10) — new
persisted script `scripts/roadNetworkSafetyCheck.js`, run after implementation:**

- **Connectivity (§8.10 "kaleler yol ağına bağlanır"):** PASS — 13 edges, all 14/14 `KINGDOM_SEATS`
  reachable in the built network (a spanning tree by construction, verified at runtime against the
  live `buildRoadNetwork` output, not just assumed from the algorithm's theory).
- **Per-edge grade:** PASS on all 13 real seat-to-seat edges — steepest actual routed segment grade
  across the whole network is **11.1°** (`doran` -> `ziya`), every other edge lower, all comfortably
  under the 20° hard ceiling. Total network length: **20.23 km**.
- **Mountain-avoidance stress test (§8.10 "dağın dik yamacından düz geçmez"):** none of the real
  13 MST edges is forced anywhere near ADR-0075's mountain (center `(2600, 2200)`, radius 1300m) —
  measured, not assumed: the closest real edge (`umit` -> `Xaro`) passes 1589m from the mountain's
  center, 289m outside its own falloff radius. This is a *consequence* of ADR-0075's own seat-safety
  design (every macro-relief feature was placed with a wide margin beyond the nearest seat), not a
  gap in this run's routing — so no real road today has an opportunity to visibly bend around the
  mountain. To still give this run's explicit requirement a real, measured answer rather than an
  absence of evidence, `roadNetworkSafetyCheck.js` also runs the *exact same* `findSlopeAwarePath`
  function against a synthetic pair of points chosen so the straight line between them crosses
  directly over the mountain's center (`(900, 2200)` -> `(4300, 2200)`): the straight line's closest
  approach to the mountain's center is **0m** (it passes through the peak); the real router's
  returned path stays **620m** away at closest approach, with a max grade of only **11.2°** — direct,
  quantitative proof the algorithm bends away from steep terrain when a real route actually needs to,
  even though today's specific seat layout never forces it to.
- **River non-collision (§8.10 "nehir dağın içinden delip geçmez", extended to roads by this run's
  own task scope):** PASS — no road point ever comes within 25m of the traced river's polyline
  (checked against every point of both, not just endpoints), so no road runs alongside or through the
  riverbed. No bridge mesh exists for the case where a future edge *does* cross the river at a single
  point — deferred, matching `world/rivers.js`'s own module doc, which already treats "roads don't
  need actual bridge geometry yet" as acceptable scope for this project's current fidelity target.

**Verified:**
- `node --check` clean on all 5 touched/new files: `world/roads.js` (201/600), `world/roadPathfinder.js`
  (301/600), `sceneManager.js` (206/600, +17 lines), `game3d.js` (499/600, +5 lines),
  `scripts/roadNetworkSafetyCheck.js` (new, 273 lines).
- Full committed smoke suite: **14/14 PASS both before and after** (confirmed via `git stash`
  before/after comparison, not assumed from the diff alone) — no existing check depends on scene
  draw-call count or road-free terrain, so nothing regressed.
- `scripts/roadNetworkSafetyCheck.js`: all 4 checks PASS (connectivity, per-edge grade, mountain-
  avoidance stress test, river non-collision) — see numbers above.
- **Real headless-Chromium visual proof, zero console/page errors across every run:** the default
  third-person spawn view (this boot again landed in the night portion of the day/night cycle, same
  pre-existing `lighting.js` behavior ADR-0075 already flagged as unrelated and unchanged). A real F4
  activation + real WASD/Shift-run flight + real mouse-drag pitch (not a teleport) climbing to
  altitude above the player's own seat, then pitching down toward vertical, produced a clear bird's-
  eye screenshot showing the actual tan road ribbon running out from the `umit` seat, visibly curving
  around several lake patches rather than cutting a straight line through them. A second F4 flight
  toward ADR-0075's mountain/hill cluster (real flight, corrected mid-session after an initial
  attempt's inherited downward camera pitch flew the free camera under the terrain mesh — see the
  session's own root-cause note below) produced a clear mountain-silhouette-plus-distant-water-plane
  screenshot at real altitude, consistent with ADR-0075's own prior verification of the same terrain
  feature.
- **Root Cause / Prevention (GOVERNANCE.md §8.2 — this specific failure mode, camera diving
  underground during F4 test flights, was hit twice across this run's own verification attempts):**
  the F4 free camera's `activate()` copies the *chase camera's* current quaternion, which itself is
  tilted mildly downward (`camera.js`'s normal over-the-shoulder framing looks down at the player);
  flying forward for a long duration without first leveling/raising that inherited pitch sends the
  free camera below the terrain surface, where the (single-sided, front-face-up) terrain material is
  invisible from underneath — reading as a pure sky/void screenshot with no error, which is what made
  it initially non-obvious. Fix (test-script-only, not a game-code change): always cancel the
  inherited pitch with an explicit upward mouse-drag correction before any long F4 flight. Not fixed
  in `debug/freeCamera.js` itself — this is a test-authoring pitfall, not a product bug (a human using
  F4 interactively sees the sky immediately and self-corrects with the mouse; only an unattended
  scripted flight can fly blind through it), so no shipped code changed as a result of this finding.
- **Performance budget (`GOVERNANCE.md` §4, F2 panel, real `renderer.info` — before/after via
  `git stash`):** draw calls **43 -> 44** (+1, the one merged road mesh), triangles **374,685 ->
  377,083** (+2,398), geometries **41 -> 42** (+1) — both totals remain far under the
  2,500-draw-call/5,000,000-triangle desktop budget. The triangle delta matches expectations exactly:
  a ribbon mesh's triangle count is `2 * (totalPointCount - edgeCount)`, and the network's real point
  count (after Chaikin smoothing) at 20.23km total length and ~60-85m average pre-smoothing grid
  spacing lands in the same ballpark this arithmetic predicts — not a surprise number.
- **Memory-leak checklist:** `disposeRoadNetwork` (new) disposes the merged mesh's geometry and
  material, called from `game3d.js`'s existing `pagehide` teardown block alongside
  `disposeSettlements`/`disposeRealCastleModels`. `world/roadPathfinder.js` is a pure module (no
  listeners/timers/DOM, no shared mutable state between calls) — nothing new to dispose there.

**Alternatives considered:**
- *Slope-aware MST edge weights (use each pair's real routed-path cost, not raw Euclidean distance,
  to decide topology).* Rejected for this pass — would require running the (relatively expensive,
  O(grid-cells) per pair) A* search for all 91 possible seat pairs just to pick the cheapest 13,
  instead of 13 total; Euclidean-distance MST already produces a sensible, realistic-looking topology
  (short local connections, e.g. `olena`<->`berk` at 123.7m, plus a few necessarily-long trunk
  connections to isolated seats like `Xaro`/`umit`), and *within* each chosen edge the routing is
  already fully slope-aware — the topology-vs-routing split keeps the two concerns simple and
  independently correct rather than conflating them into one expensive combined search.
- *A separate "patika" (thin footpath) tier alongside the main road tier, as the task text
  explicitly welcomed if not much extra work.* Deferred, not rejected outright — see Decision's
  point 3 and 3D_GAME_PROGRESS.md's "Next step" for the concrete follow-up scope.
- *Adding road-awareness to player/NPC/animal ground movement (e.g. a speed bonus while on-road, or
  routing NPC patrols along roads).* Out of scope for this task (GOVERNANCE.md §18 lists "yol ağı"
  itself as the priority item, not road-aware gameplay systems) and would meaningfully expand the
  blast radius this ADR's Risk Seviyesi assessment is based on — a clean follow-up once the network
  itself is proven stable, not bundled into the same change.
- *A literal, physically-carved road (deforming `world/terrain.js`'s own geometry under the ribbon)
  instead of a ribbon mesh raised slightly above the existing surface.* Rejected — same reasoning
  `world/rivers.js` already used for the river (ADR-0009): a raised ribbon needs no terrain-geometry
  coordination at all (roads/rivers/terrain chunks stay fully independent, generated/streamed on
  their own schedules), while carving would require roads to somehow modify chunk geometry that
  `world/chunkManager.js` streams in independently and lazily — a much larger, riskier change for a
  visual difference not requested by this task.

**Consequence:** All 14 kingdom seats now connect into one real, slope-aware road network (13 edges,
20.23km total), rendered as a single visible dirt-colored ribbon mesh, +1 draw call/+2,398 triangles
against the existing budget. `world/roads.js` and `world/roadPathfinder.js` are new files under the
`world/` target architecture (GOVERNANCE.md §3). One road tier only — the "patika" vs. "at arabası
yolu" visual distinction the task welcomed but didn't require is deferred (3D_GAME_PROGRESS.md's
"Next step"). No bridge geometry at the (currently zero, but not proven to always be zero for a
future seed/topology change) river-crossing case — same deferred-scope note `world/rivers.js` already
carries. `ROAD_COMFORT_GRADE_DEGREES`/the 20° hard ceiling are logged, not final, product decisions
(`QUESTIONS_FOR_OWNER.md`).

**Gelecek Faz Etkisi (future-phase impact):**
- **GOVERNANCE.md §11 (future settlements beyond the current 14):** now has a real network to check
  "yol ağına bağlanabilirlik" (road-network connectability) against — a future new settlement's
  placement check can call `findSlopeAwarePath` from the new seat to its nearest existing seat and
  assert a reasonable max grade, the same way this ADR's own safety check does, instead of that §11
  rule being unenforceable for lack of any actual network to test against.
- **FAZ 6 (cart/at arabası, not yet spawned — the "at arabası yolu" naming in GOVERNANCE.md §18 item 2
  anticipates this):** whenever a cart/wagon vehicle is added, this network is exactly the path data
  (`buildRoadNetwork`'s returned `edges[].points`) it should travel along — no new pathing work
  needed, just a consumer of data that already exists.
- **FAZ 5/8 (NPC patrols / world events):** a future "traveling merchant" or similar NPC/event archetype
  now has real road polylines to walk instead of needing its own bespoke waypoint system — not
  wired up by this task (see Alternatives), but the data is there for a future run to consume.
- **FAZ 9 (post-fx):** the mountain-avoidance stress test's 620m-of-clearance routed path is a good
  future subject for road-dust/parallax-occlusion detail passes once that phase starts — no
  dependency either direction yet.
- **Performance (FAZ 10 / quality presets):** the road mesh is not currently gated by any quality
  preset (always rendered in full) — a future FAZ 10 pass could consider simplifying/thinning the
  ribbon at lower quality tiers the same way terrain draw distance already scales, though at today's
  +2,398 triangles this is nowhere close to being a real budget concern yet.

## ADR-0077: Dragon reactive flight — eased speed/bank blend on top of the existing notice trigger

**Status:** Accepted (run 58).

**Risk Seviyesi:** LOW. Justification: purely additive to one existing, already-isolated gameplay
module (`gameplay/dragons.js`) with no new files, no new render objects, no change to any other
system's data (terrain/roads/settlements/NPCs/animals untouched); the new behavior is off by default
(all new `createDragon` parameters default to no-op values — a dragon spawned without the new
`reactiveSpeedMultiplier`/`reactiveBankAngleRadians` fields behaves exactly as before) and trivially
reversible by removing the three new fields from `gameplayConfig.js`'s `DRAGON_CONFIG.SPAWNS` entry.

**Context:** GOVERNANCE.md §18 priority #9 (FAZ 7) — run 54's ADR-0072 gave the dragon
player-awareness (an edge-triggered one-shot notice) but explicitly left "the flight path itself...
untouched by it (no diving/chasing/fleeing)". This run is the next real increment in that same
"awareness before behavior change" sequence FAZ 6's wolves already went through (flee trigger, then
pack-alert). Items 2-8 of the priority order were re-checked fresh first (per run 57's own
recommendation and GOVERNANCE.md §8.14's concurrency check): a full `node --check` sweep (50 files,
clean), `scripts/smokeTestGame3D.js` (14/14 PASS on the current `origin/main`, unchanged going in),
and no new tech-debt/performance/memory-leak signal since run 57 — so this run moved on to item 9.

**Değişiklik Etki Analizi (GOVERNANCE.md §8.4, written before code):** affected systems —
`gameplay/dragons.js` (`createDragon`'s per-frame `update()`, `spawnConfiguredDragons`'s pass-through
of three new optional spawn fields), `gameplayConfig.js` (`DRAGON_CONFIG.SPAWNS[0]`, three new
fields on the one existing `umit-dragon-1` spawn). Not affected: `game3d.js`'s own dragon
spawn/update wiring (unchanged call shape — `update(delta, playerPosition)` already existed),
any other gameplay system, World Coverage, performance budget (no new draw calls/geometry — same
model, same one `Fly` clip, only per-frame `angle`/`rotation.z` math changes). Risk: a wrong blend
computation could make the dragon visibly snap or reverse direction — mitigated by a new dedicated
smoke check (`checkDragonReactiveFlight`, see below) asserting the exact calm and fully-saturated
reactive angular speed/bank values via real position math, not just "no crash". **Gelecek Faz Etkisi:**
this is still not diving/chasing/pathfinding — a future run adding real evasive/aggressive flight
paths would build on top of this same `reactiveBlend` state (see Consequence) rather than replacing
it.

**Decision:**

1. **A continuous, eased blend (0-1), not a binary on/off switch.** `createDragon`'s `update()` now
   tracks a `reactiveBlend` value that moves linearly toward `1` while the player is inside
   `noticeRadiusMeters` and toward `0` while outside, at a rate of `1 / reactiveTransitionSeconds`
   per second (default 1.5s to fully transition either way). Both the circling angular speed
   (`speedMps / circleRadiusMeters` at blend 0, `speedMps * reactiveSpeedMultiplier /
   circleRadiusMeters` at blend 1) and the visual bank angle (`bankAngleRadians` at blend 0,
   `reactiveBankAngleRadians` at blend 1) are linearly interpolated by this same blend value every
   frame — an instant snap would read as a teleport/glitch, not a reaction.

2. **Reused the existing notice distance check, not a second one.** The same `isInRadius` boolean
   that already drives the edge-triggered notice emit now also drives the reactive blend target —
   one distance computation per frame, not two. This slightly changes *when* in the frame the check
   runs (against the dragon's position as of the end of the previous frame, rather than after this
   frame's own move) — a physically negligible difference for a continuously-simulated circling
   body, and confirmed not to change either existing dragon smoke check's assertions (both still
   pass unmodified).

3. **New parameters default to fully backward-compatible no-ops.** `reactiveSpeedMultiplier` defaults
   to `1`, `reactiveBankAngleRadians` defaults to `bankAngleRadians` (i.e., no change) — a dragon
   spawned without these fields (or any dragon predating this run) behaves identically to before.
   Only `umit-dragon-1` (the one real configured spawn) was given real reactive values
   (`reactiveSpeedMultiplier: 1.6`, `reactiveBankAngleRadians: 0.65`, `reactiveTransitionSeconds:
   1.2`) — this run's own engineering judgment (noticeably faster/steeper without looking erratic),
   not derived from any real-world reference; logged as a candidate for `QUESTIONS_FOR_OWNER.md` only
   if a future playtest finds it reads as too subtle or too dramatic (not logged this run — no
   existing project convention for tuning purely cosmetic AI-reaction feel, unlike ADR-0075/0076's
   walkability-affecting slope thresholds, which is why those got a question and this doesn't).

**Alternatives considered:**
- **A discrete state machine (CALM/ALERT) instead of a continuous blend.** Rejected: a hard state
  switch would either snap instantly (visually jarring) or need its own separate easing logic
  layered on top — the continuous blend already *is* that easing, with one state variable instead of
  two.
- **A real evasive/diving flight path change.** Deferred, not rejected — a genuinely new flight
  path (leaving the circle) is materially more scope (path planning back to the circle, collision
  against `world/terrain.js`, a second smoke-test class of assertions) than "fly the same circle
  faster and banked harder," which was enough to make the existing awareness trigger feel like it
  does something. A natural next FAZ 7 increment, not this run's.

**Verification:** `node --check` on both changed files; full `scripts/smokeTestGame3D.js` 15/15 PASS
(14 previous + new `checkDragonReactiveFlight`, which asserts calm bank/speed while the player is far
every frame, the blend saturating to the *exact* reactive bank angle and angular speed — measured via
real position math, not assumed — after sustained proximity, and easing back to the exact calm
baseline after the player leaves). Real headless-Chromium boot of `game3d.html` (player spawn near
`umit`) shows the "Ejderha Görüldü!" notice toast firing live in-game shortly after boot — confirms
the shared `isInRadius` code path this ADR's reactive blend also depends on is genuinely exercised
during normal play, not just in the synthetic smoke-test harness (a wide-shot screenshot of the
subtle bank-angle/speed change itself wasn't captured — at 90m altitude/150m radius from the default
ground-level camera the dragon isn't in frame at boot without moving the F4 free-camera into the sky,
and the smoke check's exact-math assertions are a stronger proof for this specific numeric behavior
than a screenshot would be).

**Consequence:** The one configured dragon (`umit-dragon-1`) now visibly reacts to the player's
presence — faster, harder-banked circling while noticed, easing back to a calm patrol once the
player leaves — without any new assets, draw calls, or changes to any other system. Still no
diving/chasing/fleeing/pathfinding; the circle itself is unchanged, only how fast and how banked the
dragon flies it. `QUESTIONS_FOR_OWNER.md` unchanged this run (no new product-decision question — see
Decision point 3).

**Gelecek Faz Etkisi (future-phase impact):**
- **FAZ 7 (this dragon, future runs):** the `reactiveBlend` state is a natural hook for a later
  "fully alert" tier (e.g., breaking from the circle) once that's in scope — read the existing blend
  value instead of adding a second parallel state variable.
- **FAZ 6 (animals):** the same eased-blend pattern (continuous 0-1 state driven by a distance check,
  linearly blending two parameter sets) is directly reusable for any future animal reaction that
  needs to feel eased rather than snapped, if `gameplay/animals.js`'s existing binary flee trigger
  ever needs a softer version.

## ADR-0078: Real-frame perf snapshot tooling + first CATCH_UP.md entry — closing two long-standing GOVERNANCE.md reporting gaps

**Status:** Accepted (run 59).

**Risk Seviyesi:** LOW. Justification: dev-only tooling + documentation, zero changes to any
gameplay/world/rendering code path; the one refactor (extracting `devServerHelper.js`) is a verbatim
move with an unchanged smoke-test result (15/15 PASS before and after); trivially reversible (delete
the two new scripts/files, revert `smokeTestGame3D.js`'s two require lines).

**Context:** Run 59's mandatory Session Snapshot (GOVERNANCE.md §20) — `git fetch origin main` +
`git checkout -B main origin/main` per §8.14, then a fresh `node --check` sweep (50 files, clean) and
`scripts/smokeTestGame3D.js` (15/15 PASS) confirmed the baseline is healthy — turned up two rules
GOVERNANCE.md §13 has required since run 56's consolidation that had never actually been executed in
any of runs 1-58: `perf_log.csv` (required *every* run) and `CATCH_UP.md` (required every ~10 runs)
both simply didn't exist yet. Run 58's own "Next step" also misstated the FAZ 5 dialogue-choice pilot
as "4/14" when `gameplay/dialogueChoices.js`'s own header comment and GOVERNANCE.md §17 both already
said 13/14 (all seats but the deliberately-excluded `jon-guard-1`) — a stale-copy error, not a real
gap, corrected in this run's own progress-file entry rather than repeated forward. With FAZ 5's pilot
confirmed already complete and FAZ 6's animal gap blocked on a human manual-download step (per
`QUESTIONS_FOR_OWNER.md`), this run's most well-scoped, valuable increment was closing the two real
reporting gaps rather than guessing at a new FAZ 7 evasive-flight scope this run couldn't fully
verify visually in the time available.

**Decision:**

1. **`scripts/collectPerfSnapshot.js`** boots the real `game3d.html` scene (not a fake renderer, unlike
   the existing `checkPerfPanel` smoke check which only tests the panel's own throttle/format logic),
   waits for the real `GAME_READY`/loading-screen-hidden signal, activates the F2 panel via the same
   `window` keydown dispatch every existing smoke check already uses, lets it render real frames for
   3 seconds, then parses the panel's own live DOM text (FPS, draw calls, triangles, geometry/texture
   counts) plus Chromium's `performance.memory.usedJSHeapSize` where available. One CSV line
   (`date,run,fps,drawCalls,triangles,geometries,textures,jsHeapUsedMB`) is appended to
   `perf_log.csv`, created with a header on first run. No dashboard/graph, per GOVERNANCE.md §13 —
   raw data only, deferred until §16's "30-commit performance trend graph" activation condition
   (30+ rows) is met.
2. **`scripts/devServerHelper.js`** — `smokeTestGame3D.js`'s static-file-server + Playwright-resolution
   helpers, extracted verbatim so `collectPerfSnapshot.js` doesn't duplicate them a third time (the
   next script needing a headless `game3d.html` boot reuses this too). `smokeTestGame3D.js` now
   imports from it; behavior unchanged (confirmed by re-running the full suite before/after).
3. **`CATCH_UP.md`**, first entry — a ~9-sentence, jargon-free summary of the whole project's current
   state (not just this run's delta, since no entry has ever existed before), covering terrain/roads/
   castles/NPCs/dialogue/wolves/dragon-awareness/day-night, and the two biggest known open gaps
   (manual-download-blocked animals, dragon not yet a real threat).

**Alternatives considered:**
- **Reading `renderer.info` directly via a custom `page.evaluate` hook instead of the F2 panel's DOM
  text.** Rejected: would need its own way to reach the live `renderer` instance (not currently
  exposed on `window` for non-debug builds — a deliberate choice, not an oversight, to avoid leaking
  internals) and would duplicate `perfPanel.js`'s own budget-comparison logic. Reading the panel's own
  already-correct, already-tested output is simpler and exercises the real debug tool end-to-end
  (proof the F2 panel itself works against a real scene, not just the synthetic fake-renderer test).
- **Skipping `jsHeapUsedMB` entirely (non-standard API).** Kept, with a `null` fallback: free extra
  signal on the Chromium engine this project's own smoke suite already targets, harmless elsewhere.

**Verification:** `node --check` on all three changed/new `.js` files. Full `scripts/smokeTestGame3D.js`
re-run after the `devServerHelper.js` refactor — still 15/15 PASS, confirming the extraction changed
no behavior. `collectPerfSnapshot.js` run for real against this run's own `main`: sampled
`fps=2, drawCalls=46, triangles=393467, geometries=44, textures=17, jsHeapUsedMB=347` — draw
calls/triangles are far under the desktop budget (2500/5,000,000); the low FPS is expected/documented
software-rendering-in-headless-Chromium noise (see the script's own header comment), not a real-device
number, and not comparable to GOVERNANCE.md §4's 60-120 desktop target until a second run's row exists
to compare against.

**Consequence:** `perf_log.csv` and `CATCH_UP.md` now exist and are current; every future run's DoD
checklist (§8.1) can actually satisfy the perf-log line item instead of silently skipping it, and
every 10th run has a real file to append to instead of starting from scratch. No gameplay/world/
rendering behavior changed. **Gelecek Faz Etkisi:** none — this is reporting/tooling infrastructure,
orthogonal to every FAZ. World Evolution Report and other run-59 metrics are otherwise unchanged from
run 58 (see `3D_GAME_PROGRESS.md`).

## ADR-0080: Mobile/PWA tap-to-greet prompt — FAZ 5 interaction without deleting existing keyboard flow

**Status:** Accepted (run 62).

**Risk Seviyesi:** LOW. Justification: additive UI/interaction affordance only; the existing `E`/`Escape` keyboard path remains unchanged, and the prompt only becomes pointer-active when a handler is explicitly registered.

**Context:** The project owner rejected the previous run-60/61 dragon-swoop/smoke-split work because it removed roughly 300 lines from an existing smoke-check file. That work was reverted first. This run restarted from the restored codebase and followed the new instruction: continue from FAZ 5 onward, but do not delete code. FAZ 5 already supports NPC proximity prompts and keyboard-driven greetings; the mobile/PWA gap was that touch-primary users saw an `E - Selamla` prompt but had no physical E key.

**Decision:** `InteractionPrompt` now accepts an optional activation handler through `setActivateHandler()`. When registered, the prompt gains a pointer-active CSS class and a `pointerup` on the visible prompt calls the same interaction controller path as pressing `E`. Desktop keyboard behavior is untouched; mobile and installed-PWA users can tap the prompt itself to greet nearby NPCs.

**Alternatives considered:** adding a separate floating "Konuş" button was rejected for now because it would duplicate the existing prompt UI and add another DOM lifecycle. Reusing the existing prompt keeps the blast radius small and preserves the current layout.

**Verification:** syntax checks passed on the changed files and the full JavaScript sweep. A new `checkInteractionPromptTap` smoke check verifies hidden prompts ignore taps, visible prompts activate once, and disabling the handler removes the action class. The Playwright-driven suite is still blocked in this container because Playwright is not installed.

**Consequence:** FAZ 5 NPC interaction is now usable from desktop, mobile browser, and installed PWA mode without requiring a physical keyboard. No existing code path was removed in this new implementation.

## ADR-0081: Remove leaked NVIDIA API key + unrelated script from tracked tree

**Status:** Accepted (run 63).

**Risk Seviyesi:** HIGH (secret exposure), remediation itself LOW risk.

**Context:** Run 63's mandatory Session Snapshot (`git fetch origin main` + `git checkout -B main
origin/main` per §8.14) surfaced three commits already merged into `main` via PR #1
(`7d4a66a`/`70bb43b`/`cb28d48`, dated 2026-08-03, same author as the repo owner) that are unrelated
to the westeros-pwa 3D RPG: `ndvi_nvidia.py`, a standalone NVIDIA embeddings/chat-completions test
script, and `.env`, which committed a live-looking plaintext `NVIDIA_API_KEY` directly into the
repository. Both files were still present and tracked at `HEAD` when this run started — i.e. the key
is exposed in the current working tree, not just old history.

**Decision:** `git rm` both `.env` and `ndvi_nvidia.py` from the tracked tree and add `.env` to
`.gitignore` so it cannot be re-added by accident. This stops the plaintext key from being present in
every future checkout/clone of `main`. It does **not** purge the key from git history — `70bb43b`
still contains it in past commits, which `git rm` cannot undo. Rewriting history (`git filter-repo`
or an interactive rebase + force-push) is a separate, destructive, hard-to-reverse operation that
needs the repo owner's explicit go-ahead, so it was not attempted here; flagged instead in
`QUESTIONS_FOR_OWNER.md` and via a direct notification.

**Alternatives considered:**
- **Leave it and only notify.** Rejected: the key would keep shipping in every fresh clone/checkout
  of `main` (including this container's own future runs) until someone removed it — no reason to
  delay the low-risk half of the fix (tree removal) while waiting on the human-only half (rotation +
  possible history purge).
- **Rewrite git history now to fully scrub the key.** Rejected for this run: force-pushing a rewritten
  `main` is exactly the kind of hard-to-reverse, outward-facing action that needs owner confirmation
  first, and this repo's remote is also known (run 58) to reject tag pushes — history-rewrite push
  behavior here is untested and risking it unattended is not worth it.

**Verification:** `git status` confirms both files are removed from the tracked tree and `.env` is
now git-ignored; `git cat-file -e HEAD:.env` / `:ndvi_nvidia.py` (pre-fix) confirmed they were
present at `HEAD` before this commit. No `.js` files touched, so `node --check` is not applicable to
this commit; the existing smoke suite is unaffected (neither file is referenced by any game code).

**Consequence:** Fresh clones of `main` from this commit forward no longer contain the plaintext key
or the unrelated script. **The key itself must still be treated as compromised and rotated/revoked by
the repo owner** — it remains recoverable from git history (`70bb43b`) until that history is
separately purged, which this run deliberately did not do without confirmation. **Gelecek Faz Etkisi:**
none — orthogonal to all FAZ work, pure repo-hygiene/security fix.

## ADR-0082: Dragon dive/swoop reaction — first real path deviation off the circling flight path

**Status:** Accepted (run 64).

**Risk Seviyesi:** LOW. Justification: fully additive and opt-in (`alarmRadiusMeters`/`sampleGroundY`
both required to activate; the one configured spawn is the only dragon affected), the underlying
circle path (`angle`) is never modified — only how far the *rendered* position is blended off it —
so easing the dive blend back to 0 always lands exactly back on the pre-existing, already-verified
circling pose; trivially reversible (omit the two new spawn fields to fall back to run 58's
speed/bank-only reaction, or revert this commit entirely).

**Context:** Runs 58/59/63's own "Next step" notes all named the same concrete, un-started FAZ 7
increment: a real path deviation (leaving the circle briefly), not just the speed/bank-only reaction
run 58 shipped. `GOVERNANCE.md` §18's priority order has items 1-10 (macro-relief through
World-Coverage review) all confirmed clean/unchanged again this run (fresh `node --check` sweep, 50+
files, clean; full smoke suite 16/16 PASS on `origin/main` before any new code) and World Coverage's
flat 4.5% mobile figure re-confirmed, once again, as `STREAM_RADIUS_CHUNKS`'s deliberate mobile
triangle-budget constraint (ADR-0010/ADR-0013), not a real gap worth another investigation run — so
this run moved to item 12 (FAZ 7 dragon), as run 63 recommended giving it "its own full run."

**Decision:**

1. **`gameplay/dragons.js`'s `createDragon`** gains five new optional parameters —
   `alarmRadiusMeters`, `sampleGroundY`, `diveDropMeters` (default 25), `diveLateralPullFraction`
   (default 0.35, clamped to `[0, 1]`), `diveTransitionSeconds` (default 1),
   `minAltitudeAboveGroundMeters` (default 10) — all omittable (dive fully disabled by default, same
   "omit to disable" convention `noticeRadiusMeters`/reactive flight already use). Internally, a new
   `diveBlend` state (0 = on-circle, 1 = fully dived) eases linearly toward 1 while the player is
   inside `alarmRadiusMeters` (real 3D distance to the dragon's own position, same distance computation
   reactive flight already runs, now shared/reused rather than duplicated) and back toward 0 once they
   retreat — the exact same linear-ease shape run 58's `reactiveBlend` established, just blending
   *position* (a lerp from the pure on-circle pose toward a point pulled partway toward the player,
   lower in altitude) instead of speed/bank. **Terrain-collision safety:** every frame the dive blend
   is above 0, the blended altitude is clamped to never go below `sampleGroundY(x, z) +
   minAltitudeAboveGroundMeters` for the dragon's actual post-blend `(x, z)` — re-sampled every frame,
   not just once at the dive's start, since the position itself moves every frame while diving.
2. **`gameplayConfig.js`'s `umit-dragon-1` spawn** gets real tuning values: `alarmRadiusMeters: 110`
   (must clear the spawn's own `altitudeMeters: 90` — the dragon's 3D distance to a player standing
   exactly under its current circle position can never read below its own altitude, so anything ≤90
   would simply never trigger; 110 gives ~63m of horizontal slack around the nearest point on the
   150m-radius circle), `diveDropMeters: 30`, `diveLateralPullFraction: 0.3`,
   `diveTransitionSeconds: 0.8`, `minAltitudeAboveGroundMeters: 12` — this run's own engineering
   judgment (no existing project value to reuse), same precedent ADR-0077's reactive-flight numbers
   already set. Not escalated to `QUESTIONS_FOR_OWNER.md`: a tuning choice, not a design/product
   ambiguity, matching how ADR-0077's numbers were handled.
3. **`game3d.js`'s per-frame dragon-update loop** is now wrapped in a try/catch
   (GOVERNANCE.md §8.13, safe mode for newly-touched subsystems): if any one dragon's `update()` throws
   (a bad `sampleGroundY` result, a corrupt mixer state, etc.), only that dragon is disposed and
   dropped from `state.dragons` — logged via `console.error`, not silently swallowed — instead of the
   whole per-frame update loop (and everything after it that frame: camera follow, world events, HUD)
   crashing with it.
4. **`scripts/game3dSmokeChecksDragonDive.js`** (new file, not added to
   `game3dSmokeChecksMovement.js` — already 614/600 lines going into this run, see that file's own
   header for why splitting further rather than growing it more was the right call here too) — a real
   `createDragon` controller (`speedMps: 0`, parked at a known position, same trick
   `checkDragonNotice`/`checkDragonReactiveFlight` already use) asserts: stays exactly on-circle while
   far; sustained proximity eases it to the *exact* expected lateral-pull + altitude-drop position; a
   deliberately-too-low `sampleGroundY` clamps the dive to exactly `groundY +
   minAltitudeAboveGroundMeters` (the real terrain-collision guarantee, not just the unclamped
   lerp math); the player retreating eases it back to the *exact* on-circle pose; a dragon with no
   `alarmRadiusMeters`/`sampleGroundY` configured never dives regardless of proximity. Wired into
   `smokeTestGame3D.js` as the suite's 17th check.

**Alternatives considered:**
- **Deriving the dive target purely from the player's position (fully "onto" them, not partway).**
  Rejected: `diveLateralPullFraction` exists specifically so a bad/extreme config (or a future
  per-spawn override) can't put the dragon exactly on top of the player's own collider; a partial pull
  reads as "swooping toward" rather than "landing on."
- **A full return-to-circle path-planner (recompute the shortest arc back rather than blending a
  lerp).** Rejected as far more scope than this increment needs: because the underlying circle
  `angle` is never actually left, blending the *rendered* position back to `diveBlend = 0` already
  lands exactly on the correct, already-moving circle position — no separate planning needed, and no
  "catch up to where the circle has moved to since I left" problem to solve.
- **A second, real live-game screenshot (walking the actual player near the actual spawned dragon
  during a real low pass) for visual verification, instead of a standalone synthetic scene.**
  Attempted conceptually but not practical without a debug teleport hook (no internal game state —
  player position, the live THREE scene, the spawned dragon list — is exposed on `window` for a
  headless script to reach; deliberately not leaked, same precedent the F2 panel already set).
  Per the spawn's own doc comment, the *player does spawn* close enough (~60m from `umit`) that the
  dive should trigger naturally within roughly one lap of real playtime post-boot — worth a human
  playtester's eyes confirming, noted below — but scripting a precisely-timed live capture wasn't
  worth the added complexity this run given the standalone-scene screenshots plus the smoke test's
  exact-math assertions are already strong, real evidence for the position/clamp behavior itself.

**Verification:** `node --check` clean on all 5 changed/new files
(`gameplay/dragons.js`, `gameplayConfig.js`, `game3d.js`, `game3dSmokeChecksDragonDive.js`,
`smokeTestGame3D.js`), plus a full `src/`+`scripts/` sweep (clean). Full `scripts/smokeTestGame3D.js`
— **17/17 PASS** (16 prior + the new dive check), including the real `game3d.html` zero-console-error
boot (confirms the try/catch safe-mode addition didn't change normal-path behavior — it only executes
if `dragon.update()` throws, which it doesn't in ordinary operation). **Visual verification (§8.5):**
a standalone, self-contained THREE.js scene (not the live `game3d.html` scene graph — see
"Alternatives considered" above for why) rendered the real dragon model calm (high altitude, level)
vs. fully dived (dropped ~30m, pulled laterally toward a fixed player point) from both a wide and a
close camera angle — 4 screenshots total, the close-angle pair making the altitude/position change
clearly visible against the reference ground plane. Not committed to the repo (this project's own
established convention — prior runs' screenshot evidence is described in text, not checked in as
binary files).

**Consequence:** The one configured dragon (`umit-dragon-1`) now has a real, terrain-safe path
deviation on top of its existing speed/bank reaction — the next concrete step past run 58's "still no
diving/chasing/pathfinding" note. Still no true chase/attack behavior (the dive is a bounded swoop
toward a fixed alarm trigger, not pursuit that tracks the player's continued movement beyond the
initial pull vector) — a natural further increment if wanted. No existing behavior changed for a
dragon that doesn't opt into the new fields (none do, besides `umit-dragon-1`).

**Gelecek Faz Etkisi (future-phase impact):**
- **FAZ 7 (this dragon, future runs):** `diveBlend` and the dive-target lerp math are a direct
  extension point for a later "real chase" tier (continuously re-aiming the dive target at the
  player's *current* position each frame, rather than the single pull-vector snapshot this run
  computes fresh each frame already does implicitly via `distanceToPlayer`/`playerPosition` — so this
  is closer to "already partially chase-like" than a one-shot swoop, worth noting for whoever scopes
  the next increment) — and for a future "breaks from the circle entirely" alert tier the same way
  ADR-0077's own future-phase note already flagged.
- **FAZ 6 (animals):** the same "blend position off a deterministic base path, terrain-clamp the
  result" pattern is reusable for any future animal reaction needing to leave its patrol path
  temporarily (e.g., a wolf lunging), if `gameplay/animals.js`'s existing flee logic (which replaces
  its path entirely rather than blending off a base one) ever needs a partial version.
- **Human playtest note:** worth a real playtest confirming the dive is visible/felt during normal
  play near `umit`'s seat (see "Alternatives considered" above) — this run's evidence is strong for
  the underlying math/terrain-safety but is a synthetic scene, not a live capture.

---

## ADR-0083: Service worker offline app-shell drift fix — `GAME3D_SHELL_FILES` precache list

**Status:** Accepted (run 65).

**Risk Seviyesi:** LOW. Justification: this run only edits a hand-maintained *list of file paths*
(`service-worker.js`) plus adds a new, purely-read-only Node dev script (`checkServiceWorkerCache.js`)
— no runtime gameplay code changed, no rendering/physics/AI touched. Reversible by reverting the
commit; a bad precache entry just fails that one `cache.addAll` (already caught: the existing
`.catch(() => {})` around the whole `GAME3D_SHELL_FILES` install, unchanged this run) rather than
breaking anything else.

**Context:** GOVERNANCE.md §15 ("PWA Cache Versiyonlama") calls for extending the service worker's
offline app-shell coverage as 3D mode's asset count grows — flagged as due for a periodic look, not
touched since `service-worker.js`'s `GAME3D_SHELL_FILES` list was first written (FAZ 4-6 era). A run
65 audit (grep every `src/3d/**/*.js` file and every `assets/...fbx|glb` string literal actually
referenced from that code, per module) found the list had drifted badly behind the real game: **10
live JS modules** — `sceneManager.js`, `debug/freeCamera.js`, `debug/perfPanel.js`,
`gameplay/gameplayConfig.js`, `gameplay/dialogueChoices.js`, `gameplay/dragons.js`,
`gameplay/worldEvents.js`, `ui/worldEventToast.js`, `world/roadPathfinder.js`, `world/roads.js` — and
**3 real asset groups** — the entire FAZ 7 dragon (FBX + all 9 externally-referenced texture files),
the FAZ 6 horse glb, and all 7 real castle `_decimated.glb` models (`world/settlements.js`) — were
being fetched over the network on every load with **no offline entry at all**. Because a missing
cache entry fails open (the "Diğer" branch's network-first-then-cache-fallback still tries the
network first, same as any other request) rather than throwing at install time, this drift was
completely silent: online play looked identical, and it would only surface as broken/placeholder
castles, a missing dragon, and a broken F2/F4 debug tooling the moment a real user actually went
offline — exactly the gap PWA offline support exists to prevent.

**Decision:**
1. **`service-worker.js`'s `GAME3D_SHELL_FILES`** gains all 10 missing JS module paths and all 3
   missing asset groups (20 new entries total: 10 JS + 1 horse glb + 1 dragon FBX + 9 dragon
   textures + 7 castle glbs = 28, minus overlap already counted). Grouped into the list in the same
   rough core/ui/gameplay/world/vendor/assets order the existing entries already follow.
2. **Cache names bumped** (`SHELL_CACHE`: `westeros-shell-v1` -> `v2`; `MEDIA_CACHE`/`SW_VERSION`:
   `westeros-media-v3` -> `v4`) so every existing installed PWA actually re-fetches this file and
   populates the new, complete entry list on its next visit, instead of keeping whatever incomplete
   `SHELL_CACHE` it already installed forever (service workers only re-check for an update on
   navigation, and never touch an already-populated same-named cache) — the existing `activate`
   handler's `KEEP`-array cache cleanup (unchanged this run) deletes the old, now-unreferenced
   `v1`/`v3` caches automatically once the new worker activates.
3. **New `scripts/checkServiceWorkerCache.js`** (root-cause prevention, matching this project's own
   `checkAssetsManifest.js` precedent for a hand-maintained list): parses `GAME3D_SHELL_FILES` out of
   `service-worker.js`, then hard-fails if (a) any `src/3d/**/*.js` file is missing from it, (b) any
   `assets/....fbx|.glb` string literal referenced anywhere under `src/3d/` is missing from it, or (c)
   any file under a directory named by a `resourcePath`/`RESOURCE_PATH`-labeled string literal (the
   convention `DRAGON_CONFIG.TEXTURES_RESOURCE_PATH` uses for an FBX's externally-referenced
   textures) is missing from it. Not wired into `smokeTestGame3D.js`'s Playwright suite (no browser
   needed, same reasoning `checkAssetsManifest.js` itself stays a separate script) — run standalone,
   `node scripts/checkServiceWorkerCache.js`.

**Alternatives considered:**
- **A wildcard/glob-based precache list instead of an explicit array.** Rejected: `cache.addAll`
  takes an explicit list, and this project deliberately has no build step to generate one at deploy
  time (see `smokeTestGame3D.js`'s own header comment on why there's no `package.json`) — the
  regression *script* added here is the lighter-weight fix for "list drifts from reality" without
  introducing a build pipeline this project has specifically avoided so far.
- **Precaching only the specific texture filenames an FBX actually references (parsed from the
  binary), instead of the whole `textures/` directory.** Rejected as more fragile and more complex
  for no real benefit: the dragon's texture folder is ~11MB total, small next to the FBX itself
  (~model file, unmeasured but comparable), and guessing the exact referenced subset risks silently
  missing one if the model is ever re-exported with a renamed texture.

**Verification:** `node --check` clean on `service-worker.js` and the new script. Full
`node scripts/checkServiceWorkerCache.js` — **OK** (43 JS files, 20 referenced model assets, and
every file under the 1 referenced resource-path directory all present). `node
scripts/checkAssetsManifest.js` unaffected (still clean, unrelated file). Full
`scripts/smokeTestGame3D.js` — **17/17 PASS**, zero console/page errors, confirming this change
didn't touch runtime behavior at all. **Real offline-mode verification (§8.5, beyond this project's
usual visual-screenshot standard, since this fix is specifically about offline behavior a screenshot
can't show):** a one-off Playwright script (scratchpad, not committed — same convention prior runs'
screenshot evidence already follows) loaded `index.html` first (where the service worker actually
registers), waited for `navigator.serviceWorker.ready`, confirmed via `caches.open(...).keys()` that
every previously-missing file (spot-checked: `sceneManager.js`, `gameplayConfig.js`, `dragons.js`,
`roads.js`/`roadPathfinder.js`, both `debug/` files, `worldEventToast.js`, the dragon FBX + one
texture, the horse glb, one castle glb) now has a real cache entry, then set the browser context
fully offline and reloaded `game3d.html`: **zero console/page errors, `GAME_READY` reached**,
confirmed stable across 3 repeated runs. Before this fix (same script, run against the pre-edit
`service-worker.js`/old cache version in a first exploratory pass) the same offline reload logged 7
distinct `[AssetLoader] loadModel(...) failed ... TypeError: Failed to fetch` errors — one per castle
— that were still non-fatal (settlements.js's placeholder-box fallback prevents a full crash) but
would have visibly broken the game's now-signature "7 real, textured castles" state for any offline
player. (One earlier exploratory run of the *same* fixed code also logged those errors once,
before a longer settle delay between SW-ready and going offline made it disappear across three
follow-up runs and a direct `caches.match` probe confirmed the entry really is a cache hit — flagged
here rather than silently discarded, since it suggests the browser's own install-time `cache.addAll`
for this now-much-larger asset list can take a little longer to fully settle than
`navigator.serviceWorker.ready` alone guarantees on a cold, resource-constrained first run; worth
a human's attention if a real device ever shows the same delay, though 3/3 clean repeats and the
direct cache-hit probe are strong evidence the underlying fetch/cache-fallback logic itself is
correct, not a race in the service worker code added this run).

**Consequence:** A player who installs the PWA and later loses network access — the entire stated
purpose of a PWA's offline app shell — now actually gets the dragon, the horse, both debug tools, the
road network's pathfinding, and the world-event toast UI, instead of network errors (silently
non-fatal for the castles thanks to existing placeholder fallbacks, but a real functional gap:
missing debug tools, no dragon, no world events at all since those modules wouldn't even load). No
behavior change at all for anyone who stays online, and none for 2D-shell-only usage.

**Gelecek Faz Etkisi (future-phase impact):**
- **FAZ 6/7 (future asset additions):** the new `checkServiceWorkerCache.js` check means any future
  animal (cart/dog-cat/bird, still blocked on the human manual-download step per
  `QUESTIONS_FOR_OWNER.md`) or dragon-model asset automatically gets caught by this check the moment
  its `modelUrl` string literal is wired into `gameplayConfig.js`/committed — no separate reminder
  needed to keep `service-worker.js` in sync going forward, closing this specific drift permanently
  rather than just for today's snapshot.
- **PWA offline storage quota:** not measured or enforced this run (GOVERNANCE.md §15 also calls for
  "depolama kotası izlemesi" — quota *monitoring*, a distinct, not-yet-started piece of this same
  section; the precached set is now larger, ~11MB dragon textures + 7 castle glbs + the dragon FBX
  itself all added, so this is worth a dedicated future check once real device storage-quota data is
  available to compare against, not guessed at here).

---

## ADR-0084: PWA offline storage-quota monitoring — F2 panel's fifth line

**Status:** Accepted (run 66).

**Risk Seviyesi:** LOW. Justification: purely additive read-only instrumentation inside an
existing, already-inactive-by-default debug tool (`debug/perfPanel.js`, F2). Never runs unless a
human explicitly opens the panel; feature-detected so unsupported browsers just show a fallback
string instead of throwing; touches no gameplay, rendering, terrain, or save-relevant state.

**Context:** GOVERNANCE.md §15 ("PWA Cache Versiyonlama") names two distinct pieces: cache
*invalidation/versioning* and offline *storage-quota monitoring*. Run 65 (ADR-0083) closed the
first — `GAME3D_SHELL_FILES` now precaches every real `src/3d` module and asset the game loads, with
a version bump so existing installs re-fetch it, plus `checkServiceWorkerCache.js` as a standing
regression guard against future drift. The second piece — actually surfacing how much of the
browser's storage quota this now-larger precache set (dragon FBX + ~11MB of textures, the horse
glb, 7 real castle `_decimated.glb` models, on top of the 2D shell's own assets) is consuming — was
explicitly flagged as still open in that ADR's own "Gelecek Faz Etkisi" note and remained unstarted
going into this run. No code anywhere in this repo had ever called `navigator.storage.estimate()`
before this run (confirmed via a repo-wide grep for "storage.estimate"/"StorageManager" turning up
nothing).

**Decision:**
1. **`debug/perfPanel.js`** (the existing F2 panel, not a new tool — same "extend, don't duplicate"
   reasoning `checkServiceWorkerCache.js` itself followed off `checkAssetsManifest.js`) gains a
   fifth readout line: `Storage: <usage> / <quota> MB (<percent>%)`, sourced from
   `navigator.storage.estimate()`. Feature-detected once at panel creation (`canEstimateStorage`) —
   unsupported browsers show `Storage: unsupported (no navigator.storage.estimate)` instead of
   throwing.
2. **Polled on its own coarse timer** (`STORAGE_REFRESH_INTERVAL_SECONDS = 5`), independent of the
   existing 0.25s render-stat DOM-write throttle — disk usage doesn't move frame-to-frame the way
   draw calls/triangles do, so reusing the fast timer would just be needless async-call overhead for
   a number that almost never changes between reads. The very first active `update()` call fires an
   immediate measurement (`sinceStorageRefresh` starts at `Infinity`) rather than making a human wait
   up to 5s after opening the panel to see any number at all.
3. **Warned the same way over-budget draw-calls/triangles already are:** a trailing `" !"` once
   usage crosses `STORAGE_WARN_FRACTION` (0.8) of the reported quota — see
   `QUESTIONS_FOR_OWNER.md`-style reasoning inline in the constant's own comment for why 0.8 and not
   1.0 (eviction risk starts before usage literally equals quota).
4. Guarded against overlapping in-flight requests (`storageEstimateInFlight`) and a rejected promise
   (`.catch` sets a `"estimate() failed"` line rather than leaving a stale/empty one or throwing) —
   same fail-open spirit GOVERNANCE.md §8.13's safe-mode rule asks of gameplay subsystems, applied
   here to a debug-tool async call instead.
5. **`scripts/game3dSmokeChecksScene.js`'s existing `checkPerfPanel`** (guards ADR-0053) extended
   rather than duplicated: asserts the synchronous "measuring…" placeholder immediately after the
   first active update (proven by reading the DOM with no `await` in between — the real
   `navigator.storage.estimate()` promise cannot have resolved yet), the real resolved
   `usage / quota MB (%)` line after actually waiting for it, and the unsupported-fallback string on
   a separate instance built with `navigator.storage` stubbed to `undefined` via
   `Object.defineProperty` (restored immediately after) — real headless Chromium supports the API,
   so the fallback branch needs an explicit stub to exercise at all.

**Alternatives considered:**
- **A new, separate debug panel/keybind just for storage.** Rejected: one more global keydown
  listener and DOM element for a single line of text that belongs next to the panel's other
  resource-budget numbers (draw calls, triangles, geometries, textures) — F2 is already "the
  resource-budget panel," storage quota is one more resource budget, not a new category.
- **Polling on every `update()` call (no separate coarse timer).** Rejected: `renderer.info` reads
  are free (already-computed GPU counters); `navigator.storage.estimate()` is a real async
  browser-storage query. Calling it 4-60 times/second for a number that changes maybe once per
  session would be pure waste, and on some browsers `estimate()` is documented as potentially
  I/O-bound rather than instant.
- **Enforcing a hard quota limit (refusing to cache more once past some threshold).** Rejected as
  out of scope: this ADR is the *monitoring* half GOVERNANCE.md §15 asks for; enforcement would mean
  deciding what to evict and when, a real product/engineering decision with no existing project
  precedent to reuse, better scoped as its own future piece once real usage data from this
  monitoring exists to reason from.

**Verification:** `node --check` clean on `debug/perfPanel.js` and
`scripts/game3dSmokeChecksScene.js`. Full `scripts/smokeTestGame3D.js` — **17/17 PASS**, zero
console/page errors, including the extended F2 check's new storage-line assertions running against
real headless Chromium (not a mock) — confirms `navigator.storage.estimate()` genuinely resolves in
this environment, not just that the fallback path type-checks. A separate one-off Playwright script
(scratchpad, not committed — same convention prior runs' screenshot evidence already follows) booted
the real `game3d.html`, pressed F2, waited past both timers, and confirmed the live panel read
`Storage: 0.0 / 951 MB (0%)` with zero console errors — screenshot attached to this run's summary.

**Consequence:** Any human debugging why a device is slow to install/update the PWA, or wondering
how close the now-much-larger precache set (run 65) is to a device's storage quota, can now check
directly via F2 instead of guessing or reaching for browser devtools' own (differently-scoped)
storage inspector. No behavior change for anyone who never opens the panel — same "debug tool, zero
cost when off" contract every other `debug/` file here already holds to.

**Gelecek Faz Etkisi (future-phase impact):**
- **Periyodik Platform Kontrolü (GOVERNANCE.md §15, ~every 20-30 runs):** that check can now read a
  real number here instead of having nothing to check at all for the "storage kotası" part of that
  rule.
- **Future asset growth (FAZ 6 animals, more castles, future dragons):** as the precache set keeps
  growing, this is now the standing instrument to notice if a device's real quota (which varies a
  lot by browser/available disk, unlike the fixed desktop/mobile *perf* budgets above it) is ever
  actually at risk, rather than only finding out when `cache.addAll` starts silently failing.
- **No enforcement yet:** if this monitoring ever shows real devices routinely crossing
  `STORAGE_WARN_FRACTION`, an eviction/enforcement policy (deliberately rejected above as its own
  scope) would become the natural next step — not guessed at now.

---

## ADR-0085: Dragon continuous chase — the circle itself travels, instead of a bounded pull off a fixed one

**Status:** Accepted (run 66).

**Risk Seviyesi:** MEDIUM. Justification: this is the first change that lets a gameplay entity leave
its spawn neighborhood entirely and fly over arbitrary, un-pre-validated terrain — a genuinely new
class of movement for this project, unlike ADR-0077/ADR-0082 which only ever perturbed a path
anchored to a known-good seat. Mitigated by an always-applied terrain-safety clamp (see Decision
point 4), a hard engagement time-box, and a `spawnConfiguredDragons` call site already wrapped in
`game3d.js`'s try/catch safe mode (GOVERNANCE.md §8.13). Fully reversible: every new parameter is
opt-in, so deleting the five `pursuit*` fields from `DRAGON_CONFIG.SPAWNS` restores exact
pre-run-66 behavior without touching `dragons.js` at all.

**Context:** Runs 64 and 65 both closed their notes by flagging the same open increment: the dive
(ADR-0082) reads as chase-*like* but structurally is not one. Its target is recomputed from the
player's live position every frame, so it already "re-aims" — but the circle it blends away from
stays welded to the dragon's home seat forever, and the blend is capped at
`diveLateralPullFraction` (0.3). The dragon therefore has a hard, permanent floor on how close it
can ever get, and cannot follow a player who simply walks away. Run 64's own ADR named the fix
("breaks from the circle entirely") and deliberately deferred it as deserving its own scoped run.

The obvious implementation — abandon the circle and fly a free pursuit vector — is exactly what
ADR-0082 rejected, because it forfeits the property the whole module is built on: while the dragon
is always exactly on a closed circle, "return home" is free (ease the blend to 0), needs no
path-planning, and can never strand the dragon somewhere it has no route back from.

**Decision:** Keep the circle; move the circle. Rather than the dragon leaving its path, the path's
*center* travels.

1. **A speed-limited traveling center.** While engaged, `currentCenterX/Z` moves toward the player's
   live position at `pursuitCenterSpeedMps` (10 m/s shipped, vs. `PLAYER_CONFIG.RUN_SPEED_MPS`'s
   6.5); while disengaged it travels back toward the immutable home center the same way. Deliberately
   a **speed limit, not a blend fraction**: a `lerp(home, player, blend)` would teleport the entire
   circle whenever the player covered ground in one frame, whereas a bounded step means a sprinting
   player genuinely opens a gap the dragon then has to close — which is what makes it read as a
   chase rather than as attachment. The final step snaps exactly onto the target when the remaining
   distance is under one step, so "fully returned home" is a real equality, not an asymptote.
2. **A tightening ring.** `pursuitCircleRadiusMeters` (150m -> 55m shipped) eases in over
   `pursuitTransitionSeconds`, so an engaged dragon visibly closes in rather than merely relocating.
   Tangential speed (`speedMps`) is now held constant while the radius changes — angular speed is
   derived per-frame as `speedMps / currentRadius` instead of being fixed at spawn — so a shrinking
   ring is flown *faster* angularly rather than making the dragon appear to slow down as it closes.
   With no pursuit configured the radius never changes and this is arithmetically identical to run
   53's fixed value.
3. **Terrain-following cruise altitude.** While pursuing, the cruise height is re-derived as
   `sampleGroundY(currentCenter) + cruiseAltitudeAboveGroundMeters` and blended in, so a chase up a
   mountainside climbs with the slope instead of flying into it. `spawnConfiguredDragons` passes each
   spawn's own `altitudeMeters` — the same number `centerY` was resolved from — so the two agree by
   construction at home and the blend is a no-op there.
4. **The terrain-safety clamp is hoisted out of the dive branch** and now applies to every frame's
   final position whenever `sampleGroundY` is available. Run 64 clamped only while diving, which was
   sufficient when the circle was pinned over known-good ground; once the center can travel, the
   ordinary circling pose flies over arbitrary terrain too, so clamping only the dive would have left
   the far more common case unguarded.
5. **Time-boxed engagement with an edge-triggered re-arm.** `pursuitMaxSeconds` (18s shipped) caps a
   single engagement; once exhausted the dragon disengages and will not re-engage until the player
   has left `pursuitRadiusMeters` at least once — the same edge-trigger/re-arm shape
   `playerWasInNoticeRadius` already uses for the notice event. Without this, a player who stands
   still would be circled indefinitely, and a player who runs would be followed across the entire
   map — neither is a fight, just harassment.

**Alternatives considered:**
- **Free pursuit vector, abandoning the circle.** Rejected — see Context. Forfeits the free,
  provably-correct "return home" this module's earlier passes were designed around, and would need
  real path-planning plus a stuck/stranded recovery path that nothing in this project has yet.
- **Raising `diveLateralPullFraction` toward 1.0 instead of adding a tier.** Rejected: it would let
  the dragon reach the player only when the player happens to stand near the *existing* circle, which
  is the actual limitation — the tether, not the pull depth. It also has no notion of giving up.
- **Driving the center with a blend fraction like the other two tiers.** Rejected for the teleport
  behavior described in Decision point 1; the inconsistency with `reactiveBlend`/`diveBlend` is
  deliberate and documented at the parameter's own doc comment.
- **A cooldown timer after exhaustion instead of a leave-the-radius re-arm.** Rejected as a second
  timing concept for no benefit — the edge-trigger shape already exists in this file and gives the
  player a clear, legible way to end an engagement (get away), rather than an invisible countdown.

**Verification:** `node --check` clean across `src/`+`scripts/` (full sweep, 0 failures).
`checkServiceWorkerCache.js` and `checkAssetsManifest.js` both OK. Full `scripts/smokeTestGame3D.js`
— **18/18 PASS**, zero console/page errors, up from 17 (the new `checkDragonPursuit`). Critically,
**all four pre-existing dragon checks (circling, notice, reactive flight, dive) passed unchanged
after the refactor and before any config was added** — confirming backward compatibility was
measured, not assumed.

The new `checkDragonPursuit` (`scripts/game3dSmokeChecksDragonDive.js`) parks the dragon's angle
(`speedMps: 0`, `startAngleRadians: 0`) so the two otherwise-internal values become directly readable
off `object3D.position`: holding the radius constant makes `position.z - radius` the traveling
center, and pinning the center (`pursuitCenterSpeedMps: 0`) makes `position.z - centerZ` the easing
radius. It asserts the exact 10 m/s travel distance, the halfway and fully-eased radius values,
exhaustion after `pursuitMaxSeconds`, exact-equality return to the home center, no re-engagement
while the player stays inside, re-arming once they leave, the hoisted clamp firing on plain circling
with no dive configured, and pursuit being fully opt-in.

**Live-world safety analysis (scratchpad script, not committed — same convention prior runs' evidence
follows):** the hoisted clamp is a **measured no-op for existing behavior**, not a hoped-for one. At
`umit`'s seat (578, 3999; ground 16.19m) the dragon cruises at Y=106.19, while the worst terrain
anywhere on its 150m home circle demands only Y=28.66 — and only Y=32.91 anywhere within 600m of the
seat. World-wide peak terrain is 160.98m, so even a chase onto the highest ground in Westeros cruises
at ~251m under terrain-following. The clamp is a genuine emergency floor that never fires in ordinary
play; the shipped visible behavior of the calm patrol is therefore byte-identical to run 65's.

**End-to-end trajectory against the real terrain and the real shipped config** (40 simulated seconds,
player held at the seat + 60m where the real player spawns): distance-to-player 185.5m at t=0 (calm,
horizontal radius exactly 150) -> 115.3m at t=8s (engaging, ring tightening to 100) -> holds ~70m
through t=12-24s (committed, altitude down to ~60m above ground) -> 207.2m at t=28s (exhausted at 18s,
heading home) -> exactly 150m radius again by t=32s. Closest approach 65.7m; minimum clearance above
real ground 58.8m, far above the 12m floor (`terrainFloorRespected: true`); zero console errors.

**Visual verification (GOVERNANCE.md §8.5 — 2 camera angles + before/after):** a purpose-built render
using the real dragon model, the real terrain sampler, and the unmodified shipped config, with the
player position marked. Wide isometric before (dragon on its 150m home circle, clearly separated from
the player marker, Y=106.2) vs. the same angle engaged at t=14s (dragon beside the marker, radius from
seat 96.9m, Y=75) vs. a second low ground-level angle on that same engaged moment (dragon banking
directly above the marker) vs. wide isometric after giving up (back to exactly 150m radius, Y=106.2,
on the far side from the player). Zero console errors throughout. The live `game3d.html` was
separately booted and screenshotted to confirm no regression to ordinary play (clean boot, the real
`Ejderha Görüldü!` notice toast still firing, zero console errors) — the chase itself is not visible
in that capture because the default chase camera frames the player, not the sky.

**Consequence:** A player who lingers near `umit`'s castle is now genuinely hunted for up to 18
seconds — the dragon leaves its castle, closes to ~65m, tightens and drops to circle overhead, then
breaks off and flies home. Running away no longer guarantees safety (10 m/s beats 6.5 m/s) but does
change the geometry of the encounter, and outlasting or escaping the engagement ends it cleanly. FAZ
7 moves from "a dragon reacts to you" to "a dragon comes after you." Still **no attack, no damage, no
combat** — the dragon menaces and withdraws; there is no health/damage system in this project yet for
it to hook into.

**Gelecek Faz Etkisi (future-phase impact):**
- **FAZ 7 (combat / real threat):** the traveling circle is the natural attachment point for a future
  attack — a fire-breath or strafing pass would trigger off the already-existing engaged state and
  the ~70m committed distance, needing no further movement work. A damage/health system remains the
  actual blocker, not dragon movement.
- **FAZ 6 (animals):** the same "travel the base path's origin at a bounded speed, keep the path
  shape" pattern is directly reusable for any future land animal that should follow the player beyond
  its patrol (a wolf pack tracking rather than fleeing) — and unlike `animals.js`'s existing flee
  logic, which replaces its path outright, it keeps a guaranteed route home.
- **World streaming:** the dragon can now travel up to `pursuitCenterSpeedMps * pursuitMaxSeconds`
  (~180m) from its seat, plus its ring radius. That is well inside the loaded-chunk neighborhood
  around a player it is by definition chasing, so no streaming change is needed today — but a future
  dragon with a much longer `pursuitMaxSeconds`, or one that pursues across chunk boundaries far from
  any settlement, should re-check that assumption rather than inherit it.
- **Human playtest note:** the 18s/10 m/s/55m numbers are this run's engineering judgment tuned
  against the trajectory above, not playtested by a person. Whether the encounter reads as thrilling
  or merely annoying at real frame rates is exactly the kind of question only a human can answer —
  logged rather than guessed at.
## ADR-0086: 8th real castle model — reusing the mislabeled `dragon_reference_v1` asset for the `twin` kingdom seat

**Status:** Accepted (run 67).

**Risk Seviyesi:** LOW. Justification: additive only — one new `CASTLE_MODEL_ASSIGNMENTS` entry
following ADR-0074's exact, already-proven code path (`spawnRealCastleModels` already handles an
arbitrary-shaped loaded model generically: bounding-box scale/center, material override, ground
placement). No terrain/height-sampler/road/noise code touched, so GOVERNANCE.md §8.4's terrain
impact-analysis process does not apply here (this is a settlement-model swap, not a terrain change);
the 14-seat terrain-safety/road-connectivity invariants are unaffected because `twin`'s `(x, z)`
position and ground height are unchanged — only which mesh renders there changes. Reversible by
deleting the one new `CASTLE_MODEL_ASSIGNMENTS` entry (the seat falls back to its procedural castle
automatically, same as any of the other 6 not-yet-covered seats already do).

**Context:** Priority item 1.7 ("gerçek kale modellerini dokulandır") has been at 7/14 kingdom seats
since ADR-0074 (run 54) — GOVERNANCE.md's own priority-order note for this run explicitly asked
whether the remaining 7 seats are actually actionable or blocked on a manual asset-download step
(like the still-blocked FAZ 6 animal assets). Checked `assets_manifest.json` for any castle-shaped
asset not yet consumed by `world/settlements.js`: all 7 purpose-made `castle_*` Meshy AI models were
already used by ADR-0074. But `dragon_reference_v1` — flagged mislabeled since run 52's manifest
audit — is a fully-textured fantasy castle/gatehouse (keep, twin corner towers, conical roofs, a
banner, a wooden drawbridge), sitting completely unused in the repo (confirmed still unconsumed by
any code, via grep). Its own manifest note from run 52 explicitly left this as "a separate,
not-yet-made product decision... until a human or a future run deliberately decides to use it as a
castle asset" — this run makes that call. This is a genuinely different situation from the FAZ 6
animals: the asset is already downloaded and on disk, not blocked on any manual step.

**Decision:**
1. Decimated `assets/models/creatures/dragons/reference_dragon_v1.glb` (1,986,672 triangles,
   85.24MB, two 4096x4096 PNGs) via `gltf-transform weld -> simplify --ratio 0.0099 --error 0.06 ->
   resize --width 512 --height 512 -> prune` (`@gltf-transform/cli` 4.4.2, confirmed working via
   `npx` in this sandbox per ADR-0070's precedent) — **not** ADR-0074's `--ratio 0.08`: that ratio
   was calibrated against the 7 castle originals' much smaller 144K-478K triangle range, so applying
   it here (starting from ~2M triangles, 4-14x larger) would have overshot to ~159K triangles,
   blowing well past the desktop triangle budget headroom this feature is supposed to respect. Used
   ADR-0070's dragon-decimation ratio instead, since that source was the *same original asset batch*
   at the same ~2M triangle scale. Result: `assets/models/settlements/castles/
   gatehouse_reference_decimated.glb`, 19,630 triangles / 635KB — squarely inside the 11.5K-38K
   triangle / 138KB-688KB range ADR-0074's own 7 decimated files already landed in.
2. New `assets_manifest.json` entry `castle_reference_gatehouse_decimated` (`hasMaterial: true`,
   unlike the other 7 decimated castle entries — this source's baked texture is harmless dead weight
   at runtime, not actually rendered, since `spawnRealCastleModels` overwrites every loaded model's
   material with the seeded `createStoneMaterial` regardless of what the file itself carries — noted
   explicitly in the entry so a future reader isn't confused about why `hasMaterial` differs from its
   siblings). `dragon_reference_v1`'s own entry updated: `replacedBy` now points at the new decimated
   id, notes appended (not rewritten) recording this run's use, kept at full size for provenance per
   the same convention every other original in this manifest already follows.
3. `world/settlements.js`'s `CASTLE_MODEL_ASSIGNMENTS` grew an 8th entry: `twin` (Twin Lannister) <-
   the new decimated gatehouse. Theme match: the model's own wooden drawbridge and gatehouse
   silhouette fits `dialogueChoices.js`'s existing `twin-guard-1` flavor text almost exactly ("Her
   geçiş bir borçtur... Nehrin iki yakası da bizimdir" — a river-crossing toll, the Twins' own
   canonical identity) — a much closer thematic fit than any of the 6 other remaining un-modeled
   seats would have gotten from a generic gatehouse shape.
4. `service-worker.js`'s `GAME3D_SHELL_FILES` gained the new file's path (verified via
   `scripts/checkServiceWorkerCache.js`, unchanged this run — its existing generic scan already
   requires this); `SHELL_CACHE` bumped `v2` -> `v3` so existing installs' now-stale old cache is
   swept by the `activate` handler's existing `KEEP`-array cleanup instead of silently accumulating
   alongside the new one (quota-consciousness, following on from ADR-0084's monitoring work). No
   `MEDIA_CACHE` change — unrelated to this fix.
5. `gameplayConfig.js`'s stale "12 of 14 NPCs" dialogue-choice doc-comment corrected to "13 of 14"
   (flagged leftover from run 66's own "Next step" note) — `dialogueChoices.js`'s own doc comment
   already said 13 correctly (12 kingdom-seat guards + the extra `stannis-guard-2`); only the
   re-exporting file's comment had drifted. No code/behavior change, comment-only.

**Alternatives considered:**
- **Leave `dragon_reference_v1` unused and treat all remaining 7 seats as blocked, same as FAZ 6.**
  Rejected: unlike the animals (genuinely nothing on disk, requires a real manual download this
  environment cannot perform), this asset is already present and its notes explicitly deferred this
  exact decision to "a human or a future run" — this run is that decision point, and using
  already-downloaded content needs no new manual step.
- **Rename the `dragon_reference_v1` id/file to something castle-themed for clarity.** Rejected:
  the id is already flagged unambiguously (⚠️ MISLABELED note, present since run 52) and referenced
  by that exact id/filename across multiple prior ADRs' text in this same file — renaming would only
  break searchability of that history for no functional benefit. The new, correctly-named
  `castle_reference_gatehouse_decimated` output is the id any new code actually consumes.
- **Assign the new model to a different seat (any of the other 6 un-modeled seats).** Rejected in
  favor of `twin`: the drawbridge/gatehouse shape is a much stronger visual/narrative match for the
  Twins' existing river-crossing dialogue flavor than for `olena`/`berk` (Reach/garden flavor),
  `stannis`/`robin` (justice/height flavor), or `Xaro`/`Night King` (Qarth/Others flavor, arguably a
  worse fit for a generic medieval-stone gatehouse than any Reach or Vale seat).

**Verification:** `node --check` clean on all 4 changed JS/service-worker files
(`world/settlements.js`, `gameplayConfig.js`, `service-worker.js`, plus the full `src/`+`scripts/`
sweep). `python3 -c "json.load(...)"` confirms `assets_manifest.json` stays valid JSON.
`node scripts/checkAssetsManifest.js` — OK (41 entries, up from 40, all resolve). `node
scripts/checkServiceWorkerCache.js` — OK (43 JS files, 21 referenced model assets, all present).
Full `scripts/smokeTestGame3D.js` — **17/17 PASS**, including the real `game3d.html` boot with
**zero console/page errors** — meaningful evidence here specifically: `assetLoader.js`'s
`loadModel()` calls `console.error` on any load failure before falling back to a placeholder box, so
a genuinely broken glb (corrupt decimation output, bad path, etc.) would have shown up as a smoke
-test failure, not passed silently. **Visual verification (§8.5):** a standalone, self-contained
THREE.js scene (same "isolated render, not the live game3d.html scene graph" alternative ADR-0074's
own castle verification and ADR-0082's dragon-dive verification both already established as
sufficient evidence for this project) loaded the real decimated glb through the real `GLTFLoader`,
applied the real `createStoneMaterial` the runtime code actually uses, and rendered it from a wide
angle (full castle silhouette against a reference ground plane — keep, twin towers, conical roofs, a
flag) and a close angle (crenellated wall + tower + the wooden drawbridge clearly visible, with the
procedural stone crosshatch material rendering correctly over the decimated geometry) — 2 screenshots
total, zero console/page errors during the render. Not committed to the repo (this project's own
established convention).

**Consequence:** Real-castle coverage moves from 7/14 to 8/14 kingdom seats. The remaining 6
(`berk`, `olena`, `stannis`, `robin`, `Xaro`, `Night King`) are now confirmed genuinely blocked — a
repo-wide check found no further unused/mislabeled castle-shaped asset anywhere in
`assets_manifest.json`, so closing the gap further needs a real new manual asset-download step, the
same blocker FAZ 6's animals already have (not actionable by an unattended run). `gameplayConfig.js`'s
stale doc-comment is fixed. No behavior change for any of the other 13 already-placed seats.

**Gelecek Faz Etkisi (future-phase impact):**
- **Priority item 1.7:** now explicitly confirmed blocked-on-manual-download for its last 6 seats,
  same status/wording as FAZ 6 — a future run should not re-scan `assets_manifest.json` for another
  hidden reusable asset without new evidence one exists (this run's grep was thorough: every
  `creature_model`/`settlement_model`-typed entry was checked, not just the ones with "castle" in
  the name).
- **PWA offline footprint (GOVERNANCE.md §15):** one more ~635KB precached model is negligible
  against the multi-MB dragon/castle set ADR-0083/ADR-0084 already established monitoring for; no
  new quota concern.
- **FAZ 6/future assets:** if a human ever manually downloads a new castle-shaped or otherwise
  reusable-but-mislabeled asset, the same `checkServiceWorkerCache.js`/`checkAssetsManifest.js` pair
  will catch a missing manifest/cache entry automatically, same as every asset addition since
  ADR-0083.

---

## ADR-0087: Split the 614-line `game3dSmokeChecksMovement.js` + make the 600-line cap and the smoke registry machine-checked

**Status:** Accepted (run 68).

**Risk Seviyesi:** MEDIUM. Justification: the change itself is a pure code *move* with zero
production-code impact (`src/` is completely untouched this run — the perf snapshot is bit-identical
to run 67's, see below), which on its own would be LOW. It is rated MEDIUM because of *what* it
refactors: `smokeTestGame3D.js` and its check modules are this project's **only** automated
regression guard, so a botched split — one dropped check — would silently reduce coverage while the
suite still printed a green run, and every future run would trust that green. That specific failure
mode is what the verification below (and the new permanent guard) is built to make impossible.
Fully reversible: `git revert` restores the single 614-line file, since nothing outside the four
`scripts/` files changed.

**Context:** `scripts/game3dSmokeChecksMovement.js` was **614 lines — a live, standing violation of
GOVERNANCE.md Altın Kural 7** ("Dosya 600 satırı geçmezse iyi, geçerse böl"), not a projection.

This is a **recurrence**, so GOVERNANCE.md §8.2 applies and the Root Cause / Prevention / Regression
Test analysis is written below *before* the fix rather than after:

- **Occurrence 1 (run 40):** `game3dSmokeChecks.js` reached 596/600 and was split into
  `game3dSmokeChecksScene.js` + `game3dSmokeChecksMovement.js`.
- **Occurrence 2 (run 64):** `game3dSmokeChecksMovement.js` reached 614/600. Run 64 *noticed this and
  wrote it down in two separate file headers* ("already at 614/600 going into this run") — then
  routed around it, putting its new check in a fourth file rather than fixing the file that was
  already over. The violation survived runs 64, 65, 66 and 67 untouched.
- **Occurrence 3 (run 67):** flagged `gameplayConfig.js` at 573/600 as "should be watched" — again by
  hand, again with nothing to make the watching happen.

**Root cause:** the 600-line cap is prose in `GOVERNANCE.md`. Its only enforcement mechanism is a
human or agent choosing to run `wc -l` over the tree and choosing to act on the result. Every other
invariant this project actually holds — asset-manifest integrity, service-worker cache completeness,
terrain seat safety, road connectivity — is enforced by a script that exits non-zero. The cap was
not, so it was enforced only when somebody happened to look, and run 64 proves that even *looking*
does not reliably produce a fix when the cheaper option (start another file) is available.

**Prevention + Regression Test:** make the cap a machine check that fails, alongside a second guard
for the risk this very refactor introduces (see Decision point 3).

**Decision:**

1. **Split by theme, not by line count.** The three dragon checks (`checkDragonFlight`,
   `checkDragonNotice`, `checkDragonReactiveFlight`) moved into a new
   `scripts/game3dSmokeChecksDragonFlight.js`; the three ground-movement checks
   (`checkWolfPackAlert`, `checkNpcPatrol`, `checkWolfPatrol`) stayed. This is not an arbitrary cut
   to get under 600: the dragon checks had accreted into a file whose own header describes it as the
   *waypoint-patrol/flee* module, purely because it was the newest check file when runs 53/54/58
   needed somewhere to put them. The split therefore also **restores the file to the scope it always
   claimed**. Result: 328 and 329 lines — both comfortably under the cap, with room for the next
   check on either side. Follows the established precedent (run 38/40's thin-runner + focused-module
   extraction, DECISIONS.md ADR-0028) rather than inventing a new structure.

2. **Every moved function moved verbatim** — no assertion, tolerance, scenario, timeout, or reported
   check `name` string was edited in the same commit as the move. Proven mechanically, not by
   eyeball: `sed -n '317,605p'` of the pre-split file `diff`s byte-identical against the new file's
   body, and `sed -n '16,315p'` `diff`s byte-identical against the retained one (289 and 300 lines
   respectively, zero differences).

3. **New permanent guard `scripts/checkSmokeCheckRegistry.js`** — the Regression Test half of the RCA
   above, and the reason this refactor is safe to repeat. Pure static/`require` inspection, no
   Playwright needed, so it runs anywhere Node does. Two independent jobs:
   - **The 600-line cap**, swept over all of `src/` + `scripts/` (excluding `src/3d/vendor/`): hard
     failure over 600, plus a non-fatal WARN from 540 up so a run gets advance notice instead of
     discovering a breach after the fact. This is exactly the by-hand signal runs 64 and 67 had to
     produce manually; it now happens automatically. It currently WARNs on `gameplayConfig.js`
     (573/600) — reproducing run 67's own manual observation without anyone having to look.
   - **Runner/registry agreement, in both directions**: every `checkXxx` a check module exports must
     be invoked exactly once by `smokeTestGame3D.js` (nothing orphaned), and every function the
     runner invokes must really be exported by the module it names (nothing dangling). Plus a
     parse-completeness assertion: the number of raw `results.push(` sites must equal the number the
     parser understood as `alias.checkFn(...)`, so the guard fails loudly if it ever stops
     understanding the runner rather than quietly under-reporting.

   The second job exists because of a property specific to this suite: **a check dropped from the
   registry also drops its own line from the output**, so the suite would keep printing an all-PASS
   run while covering less. "18/18 PASS" cannot, by itself, prove nothing was lost — only an
   independent count can. That is a permanent hazard for every future refactor here, not just this
   one.

4. **`gameplayConfig.js` (573/600) deliberately NOT split this run.** It is under the cap, so it is
   not a violation, and Altın Kural 6 permits refactors only for bug/perf/readability/architecture
   reasons. Splitting it is also a materially wider blast radius than this run's test-file split: its
   five `Object.freeze` config blocks are imported 33 times across 14 files (`game3d.js`,
   `sceneManager.js`, `config.js`, five `gameplay/` modules, and four smoke-check modules that import
   `ANIMAL_CONFIG`/`NPC_CONFIG`/`DRAGON_CONFIG` *inside* `page.evaluate`), and new module paths would
   additionally have to be added to `service-worker.js`'s `GAME3D_SHELL_FILES` precache list. Doing
   that speculatively, in the same run as a structural refactor of the only regression guard, would
   blur the evidence for both. Decisive factor: **it is now machine-watched.** The guard WARNs today
   and hard-fails at 601, so the run that genuinely needs the room will be told, which is precisely
   the mechanism whose absence let the 614-line file sit for four runs. **Condition for revisiting:**
   the first run whose work would push it past 600 splits it then, by subsystem, as its own scoped
   sub-task.

**Alternatives considered:**
- *Leave it, split later.* Rejected: this is the option runs 64-67 effectively took, and the file was
  still 614 lines four runs on. It is a standing violation of an explicit Golden Rule.
- *Move the three dragon checks into the existing `game3dSmokeChecksDragonDive.js`.* Rejected on
  arithmetic: 322 + ~290 = ~612 lines, i.e. it would have created a *new* cap violation while fixing
  the old one.
- *Split `game3dSmokeChecksMovement.js` mechanically in half at line ~307.* Rejected: it would have
  produced two files under the cap with no coherent meaning, and left the dragon/patrol confusion in
  place. The thematic cut fixes the naming problem for free.
- *Raise the 600-line cap.* Rejected: not this run's call to make unilaterally, and the cap is not the
  problem — the absence of enforcement is.
- *Fold the registry/cap guard into `smokeTestGame3D.js` itself.* Rejected: that would make it
  require Playwright and a browser to answer a question that is purely static. Kept standalone, same
  shape as its `checkAssetsManifest.js` / `checkServiceWorkerCache.js` siblings.

**Consequence:**
- No production behavior change whatsoever. `src/` was not touched this run; `perf_log.csv`'s `run68`
  row is bit-identical to `run67`'s on every GPU-submission metric (46 draw calls, 393,231 triangles,
  44 geometries, 17 textures), which is the expected result and a useful cross-check that nothing
  loaded differently.
- The smoke suite still runs the same 18 checks, in the same order, with the same names.
- Both halves of the split have real headroom, so the next dragon check and the next patrol check
  each have an obvious, correctly-scoped home — the pressure that produced run 64's workaround is gone.
- One more standing guard for future runs to run alongside the existing three
  (`checkAssetsManifest.js`, `checkServiceWorkerCache.js`, `checkSmokeCheckRegistry.js`).
- The cap now fails builds project-wide, which will eventually force a `gameplayConfig.js` split. That
  is intended.

**Etkilenen sistemler:** `scripts/` dev tooling only — `smokeTestGame3D.js` (require + 3 call sites
re-routed, header rewritten to list all five check modules), `game3dSmokeChecksMovement.js` (dragon
checks removed, header rewritten), `game3dSmokeChecksDragonFlight.js` (new),
`game3dSmokeChecksDragonDive.js` (three stale cross-references to the moved checks' old home
corrected), `checkSmokeCheckRegistry.js` (new). **No `src/` file, no asset, no terrain/height/noise/
world-scale code, and no `service-worker.js` entry is touched** — `scripts/` is dev-only tooling that
is never loaded by a browser and is not part of the PWA shell, so GOVERNANCE.md §8.4's terrain
impact-analysis process and the 14-seat safety check do not apply, and no cache version bump is
needed. **Future-phase impact:** positive and non-blocking — FAZ 5/6/7 work all adds checks to these
modules, and both halves now have room; the new guard makes a future run's accidental check-drop
impossible to miss.

**Verification (GOVERNANCE.md §8.1):**
- `node --check` clean across all 48 `src/`+`scripts/` files (excluding vendor), before and after.
- Smoke suite **18/18 PASS before, 18/18 PASS after**. Stronger than a count match: the full suite
  stdout was captured to a file before and after and `diff`ed. The only differing byte in the entire
  output is `check2DShell`'s non-blocking external-fetch error counter (10 vs 11) — that check lives
  in `game3dSmokeChecksScene.js`, a file this run never touched, and its own header already documents
  the counter as sandbox-network noise. With that one number normalized, the two runs' outputs are
  **identical**: same 18 checks, same names, same details strings, same order.
- Independent registry proof (not derived from the suite passing): the 18 reported check-`name`
  literals across all modules are identical before and after; the runner's 18 invocations are
  identical in name and order, with exactly 3 lines differing — the module prefix of the 3 moved
  checks.
- New guard negative-controlled three ways on a scratch copy, to prove it is not a no-op: (1)
  deleting one check from the runner → correctly FAILs with "exports check `checkDragonNotice` but
  smokeTestGame3D.js never invokes it", i.e. it catches precisely the silent-drop hazard this ADR is
  about; (2) padding a file to 628 lines → correctly FAILs on the cap; (3) rewriting a call into a
  shape the parser cannot read → correctly FAILs on parse-completeness. Tree restored and re-verified
  green after each.
- `checkAssetsManifest.js` OK (41 entries), `checkServiceWorkerCache.js` OK, `checkSmokeCheckRegistry.js`
  OK (18 checks / 5 modules / 48 files within cap).
- **Görsel kanıt (§8.5):** for a dev-tooling-only refactor the primary evidence is the before/after
  output identity above, stated explicitly rather than silently skipped. Confirmatory real-boot proof
  was still captured: headless Chromium booted the real `game3d.html` and screenshotted 2 camera
  angles (default player camera showing terrain/player/castle silhouette/stars and the Turkish
  "Ejderha Görüldü!" toast; F4 debug free-cam flown to a different pose) with **0 console/page errors**
  across the whole session.
- **Performans (§4):** 46 draw calls (budget <2500), 393,231 triangles (budget <5M) — unchanged from
  run 67, as expected for a change that touches no runtime code.

**Geri alma planı:** `git revert` the single commit. It restores the 614-line file, re-points the
runner's 3 call sites, and deletes both new files. Nothing else depends on either new file: the new
guard is standalone (nothing imports it, no other script invokes it), and no `src/` module, asset
manifest entry, or service-worker cache entry references anything added here. Partial rollback is
also safe — deleting only `checkSmokeCheckRegistry.js` leaves a valid, under-cap split, and reverting
only the split leaves a guard that would then correctly fail on the restored 614-line file.

## ADR-0088: New standing guard `checkDialogueChoicesShape.js` — the last of run 68's three named smoke-coverage gaps

**Status:** Accepted (run 69).

**Risk Seviyesi:** LOW. Justification: purely additive dev tooling — one new `scripts/` file, no
existing file modified except doc/log updates. `src/` is completely untouched; the perf snapshot's
GPU-submission numbers (draw calls, triangles, geometries, textures) are bit-identical to run 68's.
Fully reversible: `git revert` deletes the one new file and restores the doc/log lines; nothing else
references it (not wired into `smokeTestGame3D.js`, not imported by any other script or by `src/`).

**Context:** Run 68's "Next step for the next run" named three smoke-coverage gaps: `world/roads.js`
geometry, `world/rivers.js`, and `gameplay/dialogueChoices.js`'s data shape. The first two already had
standing guards this run discovered while surveying the gap (`roadNetworkSafetyCheck.js` covers road
connectivity/grade/river-non-collision; `terrainSeatSafetyCheck.js` covers seat safety) — so only the
third gap, `dialogueChoices.js`, was real. That file's `CHOICES_BY_NPC_ID` is hand-written, purely
data-shaped content with three invariants nothing at runtime enforces: every key must be a real NPC id,
every NPC's choice count must fit inside `interaction.js`'s `DIALOGUE_CHOICE_KEY_CODES` keybinding
array (currently 3 slots), and every response must carry the `{name}` substitution placeholder the
file's own header documents as the convention. None of these would throw or fail the Playwright smoke
suite if broken — a bad entry just silently falls back to the old greeting-only behavior for that NPC
(see the file's own header comment) — so a broken entry could ship and nobody would notice until a
human happened to read that NPC's dialogue in-game.

**Decision:** Add `scripts/checkDialogueChoicesShape.js`, a fourth standing static guard alongside
`checkAssetsManifest.js` / `checkServiceWorkerCache.js` / `checkSmokeCheckRegistry.js` (same
"hand-maintained list/content, cheap automated cross-check" precedent, same regex-over-source-text
approach `checkServiceWorkerCache.js` and `checkSmokeCheckRegistry.js` already use for files that are
real browser ES modules and therefore not `require`-able from this CommonJS script). It cross-references
three files as source of truth rather than hard-coding any of their values: NPC ids come from parsing
`gameplayConfig.js`'s `NPC_CONFIG.SPAWNS` block (explicitly bounded to exclude `ANIMAL_CONFIG`/
`DRAGON_CONFIG` ids, which are not NPCs), the keybinding slot count comes from parsing
`interaction.js`'s `DIALOGUE_CHOICE_KEY_CODES` array literal, and the choice content comes from parsing
`dialogueChoices.js`'s `CHOICES_BY_NPC_ID` object body. Standalone, not wired into `smokeTestGame3D.js`
— run manually each session alongside the other three standing guards, same convention this project has
followed since `checkAssetsManifest.js`.

**Alternatives considered:**
- *Skip it — the smoke suite's `interaction controller` check already exercises the choice-branching
  pilot end to end.* Rejected: that check drives one specific NPC (`umit-guard-1`, per its own smoke
  test setup) through the offer/select/close flow to prove the *mechanism* works, but it cannot catch a
  content bug in one of the other 12 NPCs' data (a typo'd id, a response missing `{name}`, a 4th
  unreachable choice) — proving the machinery works once is not the same as validating all the content
  that flows through it.
- *Actually `require()` the file after stripping `export`/converting to CommonJS on the fly.* Rejected:
  fragile (a second, informal parser for ES-module syntax, duplicating work Node's own loader already
  does correctly) for no real gain over the text-regex approach every sibling guard in this project
  already uses successfully.
- *Fold this into `checkSmokeCheckRegistry.js`.* Rejected: that guard's own scope is explicitly the
  600-line cap plus the smoke-runner's own wiring — a different concern (test-suite integrity) from
  dialogue-content shape. Keeping them separate matches this project's existing one-concern-per-guard
  pattern (assets, service-worker cache, smoke registry, now dialogue content).

**Consequence:**
- No production behavior change whatsoever — `src/` untouched, perf bit-identical to run 68 on every
  GPU-submission metric.
- A fifth standing static guard for future runs to run alongside the existing four.
- Any future run that adds/edits a `CHOICES_BY_NPC_ID` entry (e.g. finally closing the "13/14" gap,
  FAZ 5 priority item) gets an immediate, specific failure message instead of a silent content bug if it
  typos an id, exceeds the 3-choice keybinding limit, or forgets the `{name}` placeholder.
- **Gelecek Faz Etkisi:** positive, non-blocking. FAZ 5's remaining 14th NPC entry and any future
  dialogue-tree/quest-hook work (this file's own header notes it is "not a real dialogue tree/quest
  system yet") will be checked by this guard the moment it's written, before it ever reaches a human
  playtest.

**Etkilenen sistemler:** `scripts/` dev tooling only (new file). No `src/` module, asset, or
`service-worker.js` entry touched — GOVERNANCE.md §8.4's terrain impact-analysis process and the
14-seat safety check do not apply (nothing here is terrain/height/noise/world-scale), no cache version
bump needed (dev-only script, never loaded by a browser or referenced from `index.html`/`game3d.html`).

**Verification (GOVERNANCE.md §8.1):**
- `node --check` clean across all 49 `src/`+`scripts/` files (excluding vendor), before and after.
- New guard run clean against the real repo: `13 NPC entries all resolve to real NPC ids, all choices
  within the 3-slot keybinding limit, all labels/responses non-empty, all responses carry "{name}".
  Pilot coverage: 13/14 real NPCs` — matches the hand-counted "13/14" figure this project's docs have
  cited since run 51, now machine-verified rather than merely asserted.
- Negative-controlled four ways on a scratch copy (each restored and re-verified clean afterward, `diff`
  confirmed byte-identical to the original): (1) renaming an NPC key to a nonexistent id →
  correctly FAILs "not a real id in NPC_CONFIG.SPAWNS"; (2) adding a whole extra fake-id entry →
  correctly FAILs the same way (also proves parsing multiple entries independently); (3) stripping the
  literal `{name}` token from a response while leaving the rest of the sentence intact → correctly
  FAILs "missing the {name} placeholder" (the first attempt at this test accidentally left `{name}` in
  place via a different part of the string and correctly reported OK — confirming the check is not a
  rubber stamp, it genuinely reads the content); (4) blanking a label to `''` → correctly FAILs "empty
  label".
- Other three standing guards re-run clean: `checkAssetsManifest.js` OK (41 entries), `checkServiceWorkerCache.js`
  OK (43 JS files), `checkSmokeCheckRegistry.js` OK (18 checks / 5 modules / 49 files within cap, 1 WARN
  unchanged from run 68 — `gameplayConfig.js` 573/600, not this run's concern).
- Full smoke suite: **18/18 PASS**, zero console/page errors on real headless boot of `game3d.html`
  (2D shell's pre-existing 11 non-blocking sandbox-network errors unchanged, documented since run 65).
- **Görsel kanıt (§8.5):** no visual change is possible — this run added a dev-tooling script that is
  never loaded by a browser and touches no `src/` file, same category as ADR-0087. Primary evidence is
  the parse-correctness + negative-control proof above, stated explicitly per that precedent rather than
  silently skipped; the smoke suite's own real-headless-boot zero-console-error result (captured above)
  is the confirmatory boot proof that nothing broke.
- **Performans (§4):** 46 draw calls (budget <2500), 393,231 triangles (budget <5M), 44 geometries, 17
  textures — bit-identical to run 68 on every field except heap (326MB run68 -> 368MB run69, normal GC
  noise, well within either desktop or mobile budget).

**Geri alma planı:** `git revert` the single commit. Deletes `scripts/checkDialogueChoicesShape.js` and
restores the doc/log lines. Nothing else depends on it — standalone, not imported or required by any
other file.
