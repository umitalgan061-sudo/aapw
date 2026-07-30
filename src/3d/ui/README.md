# `src/3d/ui/`

Owns on-screen UI the player interacts with directly — the touch joystick, interaction prompt, and
dialogue box today, and (future phases) HUD/inventory/debug panels. Only this folder and
`src/3d/config.js` should be touched when working on a system here (blast radius rule); UI modules
render their own DOM, they don't reach into `world/`, `gameplay/`, or Three.js scene internals — the
one exception is that `gameplay/interaction.js` (not this folder) owns the distance math/keypress
logic that decides *when* to call these modules' methods, per the "no camera/gameplay imports"
convention below.

## Files

- **`touchJoystick.js`** — on-screen virtual joystick for touch-primary devices (FAZ 4).
  `new TouchJoystick(container?)` appends a base+knob `<div>` pair (styled via `game3d.css`) and
  tracks one pointer via Pointer Events (`pointerdown`/`pointermove`/`pointerup`/`pointercancel`,
  `setPointerCapture` so dragging past the base's bounds still tracks). `getAxes()` returns the
  same `{forward, strafe, running}` shape as `input.js`'s `KeyboardInput.getAxes()` (continuous
  -1..1 here, since it's an analog stick) — `game3d.js`'s `combineAxes()` merges the two so
  keyboard and joystick input never fight each other. `dispose()` removes the DOM and listeners.
- **`interactionPrompt.js`** — proximity interaction affordance (FAZ 5 first pass, run 32).
  `new InteractionPrompt(container?)` appends a single `<div>` (styled via `game3d.css`), hidden by
  default. `setVisible(boolean)` toggles it, no-op if called with the value it's already showing
  (avoids a redundant DOM write every frame). `dispose()` removes the DOM. Deliberately dumb: always
  the same static text, no per-NPC identity, no key-press handling of its own —
  `gameplay/interaction.js` (run 33) owns the actual distance/keypress logic that calls this.
- **`dialogueBox.js`** — generic-greeting dialogue box (FAZ 5, run 33). `new DialogueBox(container?)`
  appends a `<div>` with a text `<p>` and a static "E / Esc - Kapat" hint `<p>` (styled via
  `game3d.css`), hidden by default. `show(text)` sets the text and un-hides; `hide()` no-ops if
  already hidden. `isVisible` getter, `dispose()` removes the DOM. Same "dumb DOM only" split as
  `interactionPrompt.js` — `gameplay/interaction.js` decides what text to show and when.

## Conventions

- **Instantiate conditionally when the feature is device-specific, unconditionally otherwise.**
  `game3d.js` only creates a `TouchJoystick` when `isCoarsePointerDevice()` is true — desktop never
  gets an idle joystick DOM node sitting around. `InteractionPrompt` is the opposite case: relevant
  on every device class, so `game3d.js` always constructs it. Either way, a module here should stay
  cheap/inert until actually constructed, not self-gate on device type internally.
- **No camera/gameplay imports.** Like `input.js`, modules here return input-local axes or emit UI
  events — they never read `OrbitControls`/`camera` or gameplay objects directly, so a future UI
  system (HUD, dialogue) can't accidentally couple to a specific camera or character implementation.
- **Own DOM, own disposal.** Any DOM a module here creates must be removable via its own
  `dispose()` — mirrors the memory-leak checklist every other system in this project follows.
