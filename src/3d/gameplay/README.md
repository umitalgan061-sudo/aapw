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
