# Run259 Micro-Scale Browser Harness RCA

## Symptom

An early real-browser test used Playwright `locator.fill()` followed by a second manually-dispatched `change` event for each scale axis. X reached `0.000001`, but the synthetic X→Y sequence intermittently produced a Y value near `1.0000000000001` even though the V2 micro-scale surface was active and the live DOM minimum/step were already `0.000001`.

## Investigation

Independent browser diagnostics proved all relevant product paths were stable:

- V2 was the active surface (`version === 2`).
- A single Y edit reached and retained `0.000001`.
- Direct Three.js scale assignment to `0.000001` remained stable for at least one second.
- `refreshHierarchy()`, history capture, and both together did not destabilize the value.
- A real user-like sequence — click field, Ctrl+A, type `0.000001`, press Tab — succeeded sequentially for X, Y, and Z, retained all three values exactly, and created the expected history entries.

## Root cause

The failing sequence was a test-harness artifact. `fill()` already emits browser input behavior, and then manually dispatching an additional `change` created an event order that does not match normal user editing. The project has several historical additive scale listeners, so that artificial duplicate commit sequence exercised a non-user path and produced a misleading failure.

## Corrective action

Run259's authoritative browser proof now uses the same sequence a user performs in the Inspector: focus/click, select existing text, type the decimal value, and leave the field with Tab so the browser generates its native input/change/blur ordering. The proof still keeps strict assertions; no product threshold is relaxed.

## Prevention

For Inspector numeric fields, browser DoD tests must prefer real keyboard/focus transitions over `fill()` plus manually synthesized commit events whenever event ordering is itself part of the feature contract.
