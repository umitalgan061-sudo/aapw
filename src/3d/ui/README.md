# `src/3d/ui/`

Owns on-screen UI the player interacts with directly — the touch joystick today, and (future
phases) HUD/inventory/dialogue/debug panels. Only this folder and `src/3d/config.js` should be
touched when working on a system here (blast radius rule); UI modules render their own DOM, they
don't reach into `world/`, `gameplay/`, or Three.js scene internals.

## Files

- **`touchJoystick.js`** — on-screen virtual joystick for touch-primary devices (FAZ 4).
  `new TouchJoystick(container?)` appends a base+knob `<div>` pair (styled via `game3d.css`) and
  tracks one pointer via Pointer Events (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`,
  `setPointerCapture` so dragging past the base's bounds still tracks). `getAxes()` returns the
  same `{forward, strafe, running}` shape as `input.js`'s `KeyboardInput.getAxes()` (continuous
  -1..1 here, since it's an analog stick) — `game3d.js`'s `combineAxes()` merges the two so
  keyboard and joystick input never fight each other. `dispose()` removes the DOM and listeners.

## Conventions

- **Instantiate conditionally, not unconditionally.** `game3d.js` only creates a `TouchJoystick`
  when `isCoarsePointerDevice()` is true — desktop never gets an idle joystick DOM node sitting
  around. A module here should stay cheap/inert until actually constructed, not self-gate on
  device type internally.
- **No camera/gameplay imports.** Like `input.js`, modules here return input-local axes or emit UI
  events — they never read `OrbitControls`/`camera` or gameplay objects directly, so a future UI
  system (HUD, dialogue) can't accidentally couple to a specific camera or character implementation.
- **Own DOM, own disposal.** Any DOM a module here creates must be removable via its own
  `dispose()` — mirrors the memory-leak checklist every other system in this project follows.
