# `src/3d/debug/`

Development/debug-only tooling that sits alongside the real game — never part of the normal
player experience (FAZ 4's chase camera), never touched by it. This was already planned as a
target folder (see `ARCHITECTURE.md`'s directory layout) for the F2/F3 debug/profiling panels;
`freeCamera.js` (F4) landed first since it's a small, self-contained feature with no dependency on
panel UI. Only this folder should need touching when working on a debug/editor tool — it does not
own or modify anything in `world/`, `gameplay/`, or `camera.js`.

## Files

- **`freeCamera.js`** — F4 toggles an unrestricted WASD-fly + drag-to-look camera, used to inspect
  the whole world (e.g. multiple kingdom seats at once) beyond what the chase camera's
  `PLAYER_CONFIG.CAMERA_MAX_DISTANCE_METERS`/`WORLD_DEFAULTS.FAR_PLANE` gameplay budget allows.
  `createFreeCameraController({sourceCamera, domElement})` returns `{camera, active, update(delta),
  dispose()}`. `game3d.js` calls `update(delta)` every frame (a no-op while inactive) and renders
  with `controller.camera` instead of the normal camera when `controller.active` is true — the
  normal camera/`OrbitControls`/player keep updating underneath, completely unaware this camera
  exists. See `DECISIONS.md` ADR-0049 for the full design (why a second camera object, not
  reusing/detaching the main one; why fog is overridden in `game3d.js`'s tick loop rather than
  here).

## Conventions

- Debug tools render *instead of* the normal camera, never *alongside* it in a way that could
  affect gameplay systems (physics, streaming, collision) — those keep running against the real
  player/chase camera regardless of what's on screen.
- No debug tool should require a change to `PLAYER_CONFIG` or `WORLD_DEFAULTS`' gameplay-perf
  constants (`CAMERA_MAX_DISTANCE_METERS`, `FAR_PLANE`, fog density) — give the tool its own
  values instead, exactly like `freeCamera.js`'s own `FAR_PLANE_METERS`.
- Every debug tool must be a no-op with zero added listeners/timers/allocations when inactive, and
  fully remove its own listeners in `dispose()` — same memory-leak checklist every other system
  here follows.
