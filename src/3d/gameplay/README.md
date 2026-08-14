# `src/3d/gameplay/`

Owns the playable character and (future) NPCs/dragons/animals/combat/inventory/quests/dialogue —
anything that acts in the world rather than being part of it. Only this folder,
`src/3d/eventBus.js`, `src/3d/physics.js`, and `src/3d/input.js` should be touched when working on
a system here (blast radius rule).

## Files

- **`gameplayConfig.js`** — thin re-export barrel for this folder's own config/constants:
  `PLAYER_CONFIG`, `NPC_CONFIG`, `ANIMAL_CONFIG`, `DRAGON_CONFIG`, `INTERACTION_CONFIG`. Moved out
  of `../config.js` verbatim (run 43, DECISIONS.md ADR-0057) once that file hit the project's
  600-line cap; grew as its own single file for 34 more runs until it hit 597/600 with no headroom
  left, then run 77 (DECISIONS.md ADR-0100) split it by domain into the five sibling files below —
  every existing importer of `gameplayConfig.js` kept working unchanged, only its internal shape
  changed. `../config.js` keeps everything core/world/UI-owned (`WORLD_DEFAULTS`, `WORLD_SCALE`,
  `SETTLEMENT_CONFIG`, `TOUCH_JOYSTICK_CONFIG`, ...) — this file (and its siblings) is just the
  gameplay-owned slice, matching the blast-radius rule below.
- **`playerConfig.js`** — `PLAYER_CONFIG` (FAZ 4): base mesh + Mixamo-retargeted animation clip
  paths, `WALK_SPEED_MPS`/`RUN_SPEED_MPS`/turn rate/crossfade timing, jump/gravity tuning
  (`GRAVITY_MPS2 = -20`, snappier than real-world 9.8 by design), and spawn point. See `player.js`
  and DECISIONS.md ADR-0016.
- **`npcConfig.js`** — `NPC_CONFIG` (FAZ 5): the 6 shared-skeleton Mixamo character FBXes, idle/walk
  clip URLs (reused from `PLAYER_CONFIG`), patrol speed/pause/turn-rate, and FAZ 11's
  `COMBAT_STANCE_TRIGGER_RADIUS_METERS`/alert-idle-speed tuning (run 73, DECISIONS.md ADR-0096). See
  `npc.js` and DECISIONS.md ADR-0019.
- **`animalConfig.js`** — `ANIMAL_CONFIG` (FAZ 6): wolf/horse model URLs, exact glTF clip names
  (confirmed against the source `.gltf` JSON, not guessed), patrol/flee/pack-alert speeds and radii.
  See `animals.js` and DECISIONS.md ADR-0026/ADR-0027.
- **`dragonConfig.js`** — `DRAGON_CONFIG` (FAZ 7): the `black_dragon` FBX model/texture paths and
  clip name, its manually-derived `SCALE` (this FBX's own `unitScaleFactor` is already 1, so the
  shared Mixamo scale-correction helper doesn't apply), and `SPAWNS` — one dragon per kingdom seat
  with every reaction tier's tunables (notice/reactive/dive/pursuit/give-up/attack radii, speeds,
  transition times). See `dragons.js` and DECISIONS.md ADR-0071.
- **`interactionConfig.js`** — `INTERACTION_CONFIG` (FAZ 5 dialogue): `PROMPT_RADIUS_METERS`,
  the fallback `GREETING_TEMPLATE`, per-NPC `GREETINGS_BY_NPC_ID` lines, and a re-export of
  `dialogueChoices.js`'s `CHOICES_BY_NPC_ID`. See `interaction.js` and DECISIONS.md ADR-0051.
- **`dialogueChoices.js`** — `CHOICES_BY_NPC_ID`, split out of `gameplayConfig.js` (run 50,
  DECISIONS.md ADR-0066) since it's this folder's single heaviest-growing config block (~30
  lines/NPC). The FAZ 5 branching-dialogue pilot: 14/14 NPCs now have a 2-choice greeting, several
  have grown a 3rd choice slot one at a time across many runs (see the file's own header for the
  full run-by-run list) — each addition its own ADR with a distinct personal/tonal angle, not a
  repeated template.
- **`player.js`** — the playable character (FAZ 4). `createPlayer({assetLoader, groundCollider,
  spawn})` loads `PLAYER_CONFIG.MODEL_URL` (Mixamo `peasant_girl.fbx`) plus its three skin-less
  idle/walking/running animation clips (`PLAYER_CONFIG.ANIMATION_URLS`, retargeted onto the
  model's own skeleton via `THREE.AnimationMixer` — they share a skeleton, no bone remapping
  needed), corrects Mixamo's centimeter-scale FBX export to real-world meters from the file's own
  `unitScaleFactor`, and returns `{object3D, update(delta, moveDirectionXZ, isRunning),
  dispose()}`. `update()` moves the character in the given world-space `(x, z)` direction (already
  camera-relative — computed by the caller, this module stays camera-agnostic), snaps its height
  to `groundCollider.getGroundHeight()` every step (`physics.js`), turns to face its movement
  heading, and crossfades idle/walking/running based on speed and the `isRunning` flag. No
  gravity/jumping and no wall/collider avoidance yet — ground-height snapping only (see
  `physics.js`'s own doc comment for why).
- **`npc.js`** — static, idling non-player characters (FAZ 5, run 20). `createNPC({assetLoader,
  modelUrl, idleAnimationUrl, worldX, worldZ, groundY, rotationYRadians, name, displayName})` loads
  any of the 6 shared-skeleton Mixamo character FBXes (`NPC_CONFIG.SPAWNS`), corrects its scale the
  same way `player.js` does (via `AssetLoader.correctMixamoFbxScale`, shared rather than
  duplicated), plays `peasant_girl`'s retargeted idle clip on loop, and returns `{object3D,
  displayName, update(delta), dispose()}`. No movement, AI, or interaction *logic* of its own — the
  caller supplies the exact world position and ground height (already sampled once for the
  settlement it stands near), this module only loads, idles, and (run 33) exposes `displayName` so
  `gameplay/interaction.js` can address it by name. `spawnConfiguredNPCs({assetLoader, npcConfig,
  seatsById, sampleGroundY, groundCollider})` (run 29) resolves every `NPC_CONFIG.SPAWNS` entry
  against a kingdom-seat map and loads them all in parallel — `game3d.js` calls this instead of
  looping over `NPC_CONFIG.SPAWNS` itself.
- **`animals.js`** — wild animals, wolf (FAZ 6, run 26; patrol run 27; flee run 28; pack-alert run
  29). `createWolf({assetLoader, modelUrl, idleClipName, stripChildNames, worldX, worldZ, groundY,
  rotationYRadians, name, groundCollider, walkClipName, patrolWaypoints, speedMps, pauseSeconds,
  turnRateRadiansPerSecond, fleeClipName, fleeTriggerRadiusMeters, fleeSpeedMps,
  packAlertRadiusMeters})` loads the wolf glTF/GLB (`AssetLoader.loadModel`, no Mixamo-style scale
  correction needed — the source file is already real-world-meter scale), strips any bundled
  non-skinned decoration mesh named in `stripChildNames` (the wolf file ships a stray "Circle"
  shadow-catcher disc as a scene-root sibling of its own skinned meshes), plays the named idle clip
  on loop, and returns `{object3D, isFleeing, update(delta, playerPosition,
  packmateFleePositions), dispose()}` — the same shape `npc.js` does, plus the optional
  `playerPosition`/`packmateFleePositions` arguments (run 28/29) and an `isFleeing` getter other
  animals read to build their own `packmateFleePositions`. Each frame, in priority order: if
  `fleeTriggerRadiusMeters` is set and `playerPosition` is within it, OR a packmate within
  `packAlertRadiusMeters` is already fleeing (DECISIONS.md ADR-0029), the wolf runs straight away
  from the player at `fleeSpeedMps` (DECISIONS.md ADR-0027); otherwise, if `patrolWaypoints` is
  supplied, it walks a straight line between them (index wraps via modulo — 2 points ping-pong, 3+
  loop), pausing to idle at each one (DECISIONS.md ADR-0026); otherwise it just idles. Both moving
  branches share a local `turnToward` helper (shortest-path turn) but the movement logic itself is
  copied from `npc.js`'s `createNPC` rather than shared across files (see ADR-0026 for why: the two
  files' loaders/clip-lookup APIs differ enough that a shared helper would be an awkward partial
  abstraction, and `npc.js` is a stable, already-tested system not worth touching for a
  readability-only win at just 2 consumers). Omitting `patrolWaypoints`, `fleeTriggerRadiusMeters`,
  and `packAlertRadiusMeters` keeps the run-26 static-idle-only behavior. No real AI or name-tag
  yet. `spawnConfiguredAnimals({assetLoader, animalConfig, seatsById, sampleGroundY,
  groundCollider})` (run 29) mirrors `npc.js`'s `spawnConfiguredNPCs` — resolves
  `ANIMAL_CONFIG.SPAWNS` against kingdom seats and loads them all in parallel.
- **`interaction.js`** — proximity-prompt/dialogue-box state machine (FAZ 5, run 33; choice
  branching added run 44). `createInteractionController({interactionPrompt, dialogueBox,
  greetingTemplate, greetingsByNpcId, choicesByNpcId, radiusMeters})` returns `{update(npcs,
  playerPos), handleKeyDown(event)}`. `update()` finds the nearest in-range NPC each frame, shows
  `ui/interactionPrompt.js` when one exists and no dialogue is open, and auto-closes an open
  dialogue if its NPC is no longer the nearest one (whether the player or the NPC moved).
  `handleKeyDown()` toggles `ui/dialogueBox.js` open/closed on `KeyE` (ignoring `event.repeat`, so
  holding the key doesn't rapid-fire) and closes it on `Escape`. If the opened NPC has a
  `choicesByNpcId` entry (13 of 14 NPCs today — `jon-guard-1` is deliberately excluded, a tonal
  design choice, not a gap; see `dialogueChoices.js`'s `CHOICES_BY_NPC_ID` and DECISIONS.md
  ADR-0058/GOVERNANCE.md §17), the greeting is shown alongside its numbered choice labels; `Digit1`/
  `Digit2`/`Digit3` then picks one, replacing the shown text with that choice's own response and
  clearing the choice list (a second digit press or `E` afterward just closes, same as any other
  NPC) — still no further branching/quest hooks, one response per choice. Extracted from
  `game3d.js` to stay under the 600-line cap (DECISIONS.md ADR-0033) — the same reasoning
  `spawnConfiguredNPCs`/`spawnConfiguredAnimals` already used (ADR-0028).
- **`health.js`** — generic health/damage state (FAZ 7 dragon combat, run 90, DECISIONS.md
  ADR-0116) — this project's first health system of any kind, deliberately not "player health" by
  name. `createHealthState({eventsBus, maxHealth, damageEventName, healthChangedEventName,
  diedEventName})` listens for damage events on the `EventBus` and re-emits its own change/death
  events (same "systems talk only through the bus" architecture as `worldEvents.js`), returning
  `{current, maxHealth, isDead, heal(amount), reset(), dispose()}`. Edge-triggered death (never
  re-fires while already dead), synchronous initial paint at construction so `ui/healthBar.js`
  never boots showing stale state. `game3d.js` is the only current owner (one instance, for the
  player), but nothing here assumes that.
- **`dragons.js`** — flying dragons (FAZ 7), the subsystem's public entry point and the only path
  any other module/smoke check imports; re-exports `createDragon` (from `dragonController.js`) and
  `spawnConfiguredDragons` (from `dragonSpawns.js`). Runs 53-71 built the whole feature as one file
  until it hit the 600-line cap; run 71 (DECISIONS.md ADR-0092) split it by subsystem block with no
  behavior/API change. This file's own header carries the full run-by-run history of *why* the
  flight behavior is shaped the way it is (notice → reactive flight → dive → continuous chase →
  give-up cue → dive telegraph → attack lunge/bite, runs 53-90) — read it before touching any
  dragon behavior rather than re-deriving the reasoning from the code alone.
- **`dragonController.js`** — a single dragon's controller: model/rig loading, calling
  `dragonReactionState.js`'s per-frame stepping once per frame, and applying the result to the real
  `THREE.Object3D` (position/pose/events/`userData`). Split out of `dragons.js` in run 71
  (DECISIONS.md ADR-0092) at the 600-line cap; the reaction-state bookkeeping was itself split out
  to `dragonReactionState.js` in run 109 (DECISIONS.md ADR-0136) when this file approached the same
  cap a second time. `createDragon({...})` returns the project's usual `{object3D, update(delta,
  playerPosition), dispose()}` shape. Every reaction tier is off-by-default (omitting its defining
  option disables it entirely, e.g. no `alarmRadiusMeters` means diving never activates) — see the
  file's own extensive per-option doc comments for exact trigger/blend semantics.
- **`dragonReactionState.js`** — the notice/reactive/pursuit/give-up/dive/telegraph/attack blend
  *bookkeeping* `dragonController.js`'s loop steps every frame: `createDragonReactionState(...)`
  returns the mutable per-dragon record (blends, elapsed-time counters, the traveling circle
  center), `stepDragonReactionState(state, delta, distanceToPlayer, config)` advances it and returns
  this frame's derived values (circle radius/bank angle/dive pull-drop/agitation). Split out of
  `dragonController.js` in run 109 (DECISIONS.md ADR-0136) — a verbatim move, not a rewrite; it
  never touches a `THREE.Object3D` or emits an event, same pure-state/side-effect split
  `dragonFlightMath.js` already draws for its own pure position arithmetic.
- **`dragonFlightMath.js`** — pure, stateless circle/blend arithmetic `dragonReactionState.js`'s
  stepping (and `dragonController.js`'s own pose application) drives: `easeBlendToward` (linear
  0..1 blend easing), `blendScalar` (lerp), `applyCirclePose` (position+orientation on a circle),
  `stepCenterTowardTarget` (speed-limited circle-center travel, exact-landing not asymptotic),
  `applyDiveOffset` (dive position blend), and `clampAltitudeAboveGround` (terrain-safety floor).
  Split out alongside `dragonController.js` in run 71 (DECISIONS.md ADR-0092) — deliberately *not*
  rewritten/"cleaned up" on the way out, since the exact floating-point expression order is
  load-bearing (see the file's own header).
- **`dragonSpawns.js`** — config-driven dragon spawn wiring: `spawnConfiguredDragons({assetLoader,
  dragonConfig, seatsById, sampleGroundY, eventsBus, eventName, biteEventName})` resolves
  `DRAGON_CONFIG.SPAWNS` against the kingdom-seat lookup and loads them in parallel, same shape as
  `animals.js`'s `spawnConfiguredAnimals`/`npc.js`'s `spawnConfiguredNPCs`. Split out of `dragons.js`
  in run 71 (DECISIONS.md ADR-0092).
- **`creatureSpeciesConfig.js`** — `CREATURE_SPECIES` (FAZ 11 planning, run 72, DECISIONS.md
  ADR-0095): a data-only registry of every planned living-being archetype's characteristic
  movement/behavior spec (15 species today — cat, dog, king, dragon, soldier, bird, gazelle, deer,
  human archetypes, villager, plus proposed horse/raven/sheep/boar), written ahead of any real model
  so the *design decision* (how each species should move/read as distinct from every other one) is
  captured now rather than guessed later. Deliberately **not** a runtime behavior engine yet —
  nothing in `game3d.js` imports this file; each species gets its own real `create<Species>()` (and
  its own ADR/smoke check/visual proof) as a future sub-task once its model is uploaded, same as
  every FAZ 6/7 addition already shipped.
- **`worldEvents.js`** — periodic world-flavor events (FAZ 8 early piece, priority 9.5, run 42).
  `createWorldEventSystem({eventsBus, seed, eventName})` returns `{update(deltaSeconds),
  dispose()}`. `update()` counts down a seeded, randomized (45-90s) real-time interval and, once it
  elapses, emits a picked flavor event (`{id, icon, title, desc, color}`) through `eventsBus` -
  deliberately routed through the `EventBus` rather than a direct call, since the point of this
  system was to extend the bus to real gameplay events. No stat effects (unlike `script.js`'s 2D
  `RANDOM_EVENTS`) - the 3D world has no per-kingdom economy yet, so this ports the *pattern*
  (curated pool, periodic pick, themed card) not the *mechanic*. See DECISIONS.md ADR-0056.

## Conventions

- **Camera-agnostic:** gameplay code never reads `OrbitControls`/`camera` directly. `game3d.js`
  computes a world-space movement direction from the camera's facing and the raw keyboard axes
  (`input.js`) and passes that in — keeps this folder honestly reusable if the camera system is
  ever replaced (see `camera.js`'s doc comment on the FAZ 4 chase-camera decision).
- **Determinism:** the character's *position* is driven by real-time input, which is inherently
  non-deterministic session-to-session — that's expected and fine. Anything this folder reads from
  the *world* (ground height) must still come from the same seeded sampler every other system
  uses (`physics.js` → `world/terrain.js`'s `createHeightSampler`), so the character never stands
  above/below what the rendered terrain mesh actually shows.
- **Touch dialogue selection (run 99, ADR-0125):** the controller's bounds-checked `handleChoice(index)` is the shared mobile/PWA entry point used by `ui/dialogueBox.js`; it calls the same internal one-shot `selectChoice` state transition as Digit1–Digit3, so input devices cannot diverge in dialogue behavior.
- **World-event pool run 102 (ADR-0129):** `harvest_wagons` is a COMMON, explicitly day-gated flavor event; its mobile proof also established the ≤600px collision-free toast slot in `game3d.css`.
