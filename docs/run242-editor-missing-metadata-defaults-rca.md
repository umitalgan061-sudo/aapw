# Run242 — Editor missing-metadata defaults RCA

## Symptom

Two additive-only browser regression attempts expected a valid scene JSON with no `editor` metadata to leave the Grid checkbox enabled and checked after load. Both attempts failed while object identity, signed rotation, non-uniform scale (including `0.007`), Snap enabled state, Snap size `1`, cleared selection, successful load toast, and the World Event Determinism Guard remained correct.

## Root cause

The test oracle observed only the base `worldEditor.js` loader assignment (`data.editor?.gridVisible !== false`) and missed the later owner-usability layer in `editor.html`. That additive layer intentionally owns the resolved live-editor Grid behavior: `hideMovingGridBase()` forces `we-grid-toggle.checked = false`, disables the toggle, and sets `ownerApi.grid.visible = false`. A hierarchy `MutationObserver` reapplies that ownership when scene objects change. Therefore a valid scene load can execute the base loader's metadata fallback and still resolve to a hidden/disabled moving grid in the composed product.

## Prevention

Regression assertions for additive layered UI must validate the final composed product contract, not an intermediate module assignment in isolation. When multiple additive layers own the same visible control, tests must inspect all owners before defining the oracle.

## Correct regression contract

For a valid scene JSON with no `editor` metadata:

- object identity/name/asset and transforms load exactly;
- selection is cleared and the success toast is emitted;
- Snap defaults to enabled and Snap size `1`;
- the newer live-editor usability owner wins for Grid: checkbox unchecked, checkbox disabled, and Three.js grid invisible;
- browser console/page errors remain zero;
- no runtime/product source modification is required.

The V1/V2 failures are test-oracle failures, not evidence that runtime/product behavior should be changed.
