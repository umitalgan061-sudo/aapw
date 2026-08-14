# `src/3d/ui/`

Owns on-screen UI the player interacts with directly — the touch joystick, interaction prompt,
dialogue box, world-event toast, health/controls-help/settlement-compass/day-night-clock HUD
widgets today, and (future phases) inventory/quest panels. Only this folder and
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
  -1..1 here, since it's an analog stick) — `gameLoopHelpers.js`'s `combineAxes()` merges the two so
  keyboard and joystick input never fight each other. `dispose()` removes the DOM and listeners.
- **`interactionPrompt.js`** — proximity interaction affordance (FAZ 5 first pass, run 32).
  `new InteractionPrompt(container?)` appends a single `<div>` (styled via `game3d.css`), hidden by
  default. `setVisible(boolean)` toggles it, no-op if called with the value it's already showing
  (avoids a redundant DOM write every frame). `dispose()` removes the DOM. Deliberately dumb: always
  the same static text, no per-NPC identity, no key-press handling of its own —
  `gameplay/interaction.js` (run 33) owns the actual distance/keypress logic that calls this.
- **`dialogueBox.js`** — per-NPC dialogue box (FAZ 5, run 33; choice branching added run 44).
  `new DialogueBox(container?)` appends a `<div>` with a text `<p>`, a `<div>` for numbered choices,
  and a hint `<p>` (styled via `game3d.css`), hidden by default. `show(text, choiceLabels?)` sets the
  text, renders `choiceLabels` (if any) as `"1) ..."`/`"2) ..."` lines and switches the hint to
  "1/2 - Seç, Esc - Kapat", or clears the choices and reverts the hint to "E / Esc - Kapat" when
  `choiceLabels` is omitted/empty; `hide()` no-ops if already hidden. `isVisible` getter, `dispose()`
  removes the DOM. Same "dumb DOM only" split as `interactionPrompt.js` — `gameplay/interaction.js`
  decides what text/choices to show and when, and which numbered choice was picked.
- **`worldEventToast.js`** — toast card for `gameplay/worldEvents.js`'s periodic events (run 42).
  `new WorldEventToast({eventsBus, eventName, container?})` appends a hidden `<div>` and
  self-subscribes to `eventName` on `eventsBus` (the *one* exception to "own DOM only, caller
  decides when" below — the whole point of the world-event system was routing through the
  `EventBus`, so this widget listens for itself instead of `game3d.js` calling `show()`). Shows the
  emitted event's icon/title/description, auto-hides after 6s, and re-arms its own hide timer if a
  second event arrives before the first finishes. `dispose()` unsubscribes, clears any pending
  timer, and removes the DOM.
- **`healthBar.js`** — player health HUD (FAZ 7 dragon combat, run 90, ADR-0116). `new HealthBar(
  {eventsBus, healthChangedEventName, damageEventName, container?})` appends an always-visible
  label/track/fill/text `<div>` and self-subscribes to both events on `eventsBus` (same self-
  listening exception `worldEventToast.js` established above) — `healthChangedEventName` repaints
  the fill width/color/text from the current/max ratio (including `gameplay/health.js`'s own
  synchronous construction-time emit, so it never boots showing stale state), `damageEventName`
  triggers a brief flash class unrelated to the actual number. `dispose()` unsubscribes both,
  clears any pending flash timeout, and removes the DOM.
- **`controlsHelp.js`** — responsive FAZ 8 controls reference: a 44px bottom-right help button opens device-specific desktop or touch instructions, Escape closes it, and `dispose()` removes its button/window listeners and DOM.
- **`settlementCompass.js`** — FAZ 8 discoverability HUD: points toward the nearest real kingdom seat relative to player yaw, reports distance in meters/kilometers, throttles text writes to 10m buckets, and owns no listeners/timers.
- **`dayNightClock.js`** — FAZ 8 discoverability HUD (run 107): renders a 24-hour HH:MM readout plus
  a day/twilight/night icon from `lighting.js`'s own `updateDayNightLighting()` return value
  (`timeRatio`/`nightFactor`), throttling DOM writes to "the displayed game-minute changed" the same
  way `settlementCompass.js` throttles to a 10m distance bucket. Owns no listeners/timers; `dispose()`
  removes the DOM.

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
- **Dialogue touch path (run 99, ADR-0125):** `DialogueBox` can register delegated choice and close handlers; choices expose 44px focusable role-button targets for pointer/Enter/Space input, and `dispose()` removes all three listeners. Desktop Digit1–Digit3/E/Escape remains owned by `gameplay/interaction.js`.


- **Run 150 accessibility note:** `worldEventToast.js` keeps its existing visual/timer/EventBus behavior but now exposes each shown event as a polite atomic `status` live region; the decorative emoji is hidden from assistive technology so screen readers announce the Turkish title + description rather than redundant icon speech.
