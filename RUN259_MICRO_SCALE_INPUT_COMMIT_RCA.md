# Run259 Micro-Scale Input/Commit RCA

## Symptom

The synchronized real-Chromium editor proof reached the live UI with the correct `0.000001` `min` / `step` metadata and successfully changed X to `0.000001`, but changing Y left the object and Inspector at `1.000000`.

## Root cause

The first Run259 micro-scale override owned both `input` and `change`, but it called the full commit path (`api.writeInspector()` + six-decimal re-sync + hierarchy/history work) for every live `input` event. While the user or Playwright was actively editing Y/Z, that full Inspector rewrite replaced the active field with the object's previous value before editing completed. The failure was therefore caused by premature Inspector formatting, not by Three.js scale precision, the 1e-6 clamp, or scene serialization.

## Corrective action

A V2 controller supersedes the first Run259 listener set additively. It disposes the earlier micro-scale surface and separates live input from commit:

- `input` capture blocks the legacy clamp path and updates only the active object's targeted scale axis; it does not rewrite the Inspector, refresh hierarchy, or capture history.
- `change` capture commits the value, clamps to `0.000001`, normalizes all three Inspector fields to six decimals, refreshes hierarchy, and schedules history capture.
- quick-shrink, selection precision, TransformControls precision, and the existing 1e-6 bounds guard remain intact.

## Prevention

Future numeric Inspector overrides must distinguish transient typing from committed values. Browser proof must edit multiple axes sequentially, because single-axis tests do not expose active-field rewrite bugs.
