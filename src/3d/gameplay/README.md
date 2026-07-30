# `src/3d/gameplay/`

Owns the playable character and (future) NPCs/dragons/animals/combat/inventory/quests/dialogue —
anything that acts in the world rather than being part of it. Only this folder,
`src/3d/eventBus.js`, `src/3d/physics.js`, and `src/3d/input.js` should be touched when working on
a system here (blast radius rule).

## Files

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
  modelUrl, idleAnimationUrl, worldX, worldZ, groundY, rotationYRadians, name})` loads any of the
  6 shared-skeleton Mixamo character FBXes (`NPC_CONFIG.SPAWNS`), corrects its scale the same way
  `player.js` does (via `AssetLoader.correctMixamoFbxScale`, shared rather than duplicated), plays
  `peasant_girl`'s retargeted idle clip on loop, and returns `{object3D, update(delta), dispose()}`.
  No movement, AI, or interaction — the caller (`game3d.js`) supplies the exact world position and
  ground height (already sampled once for the settlement it stands near), this module only loads
  and idles.
- **`animals.js`** — wild animals, wolf (FAZ 6, run 26; patrol run 27; flee run 28).
  `createWolf({assetLoader, modelUrl, idleClipName, stripChildNames, worldX, worldZ, groundY,
  rotationYRadians, name, groundCollider, walkClipName, patrolWaypoints, speedMps, pauseSeconds,
  turnRateRadiansPerSecond, fleeClipName, fleeTriggerRadiusMeters, fleeSpeedMps})` loads the wolf
  glTF/GLB (`AssetLoader.loadModel`, no Mixamo-style scale correction needed — the source file is
  already real-world-meter scale), strips any bundled non-skinned decoration mesh named in
  `stripChildNames` (the wolf file ships a stray "Circle" shadow-catcher disc as a scene-root
  sibling of its own skinned meshes), plays the named idle clip on loop, and returns
  `{object3D, update(delta, playerPosition), dispose()}` — the same shape `npc.js` does, plus the
  optional `playerPosition` argument (run 28). Each frame, in priority order: if
  `fleeTriggerRadiusMeters` is set and `playerPosition` is within it, the wolf runs straight away
  from the player at `fleeSpeedMps` (see DECISIONS.md ADR-0027); otherwise, if `patrolWaypoints` is
  supplied, it walks a straight line between them (index wraps via modulo — 2 points ping-pong, 3+
  loop), pausing to idle at each one (DECISIONS.md ADR-0026); otherwise it just idles. Both moving
  branches share a local `turnToward` helper (shortest-path turn) but the movement logic itself is
  copied from `npc.js`'s `createNPC` rather than shared across files (see ADR-0026 for why: the two
  files' loaders/clip-lookup APIs differ enough that a shared helper would be an awkward partial
  abstraction, and `npc.js` is a stable, already-tested system not worth touching for a
  readability-only win at just 2 consumers). Omitting both `patrolWaypoints` and
  `fleeTriggerRadiusMeters` keeps the run-26 static-idle-only behavior. No real AI, herd behavior,
  or name-tag yet.

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
