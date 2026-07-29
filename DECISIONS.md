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
