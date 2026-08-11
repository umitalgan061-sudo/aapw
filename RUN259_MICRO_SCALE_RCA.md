# Run259 Micro-Scale RCA

## Symptom

The first focused Node integration run showed the historical Run216 scale controller could restore the three Inspector `min` / `step` values to `0.001` after the new 1e-6 micro-scale layer had already initialized. An idempotent `syncBounds()` call fixed the mocked installation order, but the subsequent real Chromium `editor.html` proof reproduced the same class of problem: `window.__WESTEROS_EDITOR_MICRO_SCALE__` was active with `minimumScale=0.000001`, while the live DOM metadata still read `0.001`.

## Root cause

`EditorScaleInputController.js` is a dependency of the dynamically imported transform/editor integration. The Run259 additive layer queues its boot during module evaluation, while the historical Run216 installer can synchronously assign its legacy HTML metadata later in the same dynamic-import lifecycle. A one-shot initialization therefore cannot guarantee which layer writes the final DOM `min` / `step` attributes.

A later real-browser diagnostic also showed that value editing must be owned during the `input` phase as well as `change`; otherwise an earlier Inspector path can rewrite a newly typed micro value before the final change event. This is an event/init-order ownership problem, not a Three.js scale limitation and not a serializer precision problem.

## Corrective action

Run259 keeps the historical Run216 code untouched and adds a narrowly-scoped `MutationObserver` guard for only the three scale input `min`, `step`, and `inputmode` attributes. If a later initializer raises the bounds, the guard schedules one microtask and restores `0.000001`. The micro-scale controller owns both `input` and `change` in capture phase so values reach the selected object before legacy rewrite paths. The observer does not watch values and does not mutate scene objects.

## Verification requirement

Do not accept mock-only verification for this feature. The final gate must open the real `editor.html` in Chromium and prove all of the following on the live editor surface:

- X/Y/Z `min` and `step` are exactly `0.000001` after all editor modules initialize;
- an actual object accepts and displays `0.000001` on all axes;
- `×0.1 Küçült` can reach the same floor;
- scene serialization retains `0.000001`;
- undo/redo and re-selection do not lose the micro-scale value;
- no browser console/page errors are introduced.

## Prevention

For future additive overrides that supersede legacy UI metadata or values, tests must include the final browser initialization/event order rather than assuming dependency evaluation order from isolated Node mocks.
