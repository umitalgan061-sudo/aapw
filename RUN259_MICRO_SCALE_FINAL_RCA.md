# Run259 Micro-Scale Final RCA

## Owner requirement

World Editor ordinary objects must be able to shrink safely to exactly `0.000001` on X/Y/Z, with the value remaining visible, serializable, undo/redo-safe, and reachable through the existing quick-shrink control.

## Findings

The historical editor has two older precision floors (`0.01` in the legacy Inspector path and `0.001` in later scale-controller paths). Those lines are retained for additive-only history. Real Chromium diagnostics showed Three.js itself and the scene serializer are not the limitation: a `0.000001` scale remains stable, and `EditorSceneSerializer` already preserves six decimal places.

The integration issue was event ownership. Numeric scale editing must be intercepted before the historical listeners, and transient typing must not rewrite the whole Inspector. The final controller therefore owns `input` and `change` in capture phase: live `input` updates only the active axis; `change` performs six-decimal normalization, hierarchy refresh, and history capture.

A narrow attribute observer keeps the three scale fields at `min=0.000001` and `step=0.000001` if a historical initializer later reapplies its older metadata. The existing `×0.1 Küçült` click is also captured and uses the same non-singular 1e-6 floor.

## Browser-test lesson

An early Playwright harness used `fill()` followed by a second manually synthesized `change`. That artificial duplicate commit sequence did not match user behavior and produced misleading cross-axis results. The authoritative proof uses the real interaction order: focus, Ctrl+A, type the number, and leave with Tab so the browser owns input/change/blur ordering. X→Y→Z reaches `0.000001` successfully with this user-equivalent sequence.

## Final safety contract

- minimum ordinary-object scale: `0.000001`;
- zero and smaller positive values clamp to `0.000001` rather than creating a singular zero transform;
- Inspector precision: six decimal places;
- quick-shrink floor: `0.000001`;
- scene JSON retains exact six-decimal micro scale;
- history rehydration must retain micro scale while undoing/redoing other scene transforms;
- instanced objects remain on their existing ownership path;
- no change to 2D gameplay, world simulation, deterministic state, or PWA asset graph.
