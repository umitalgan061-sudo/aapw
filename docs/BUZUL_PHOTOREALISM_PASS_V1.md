# Buzul Muhafızı — Photorealism Pass V1

This pass is a production decision layer for the shipped world. It does not replace canonical terrain, water, collider, vegetation, scene bootstrap, MaterialAssignmentCore, or WorldAssetPlacementPipeline.

## Why this exists

The shipped `createScene()` evidence showed six classes of visible debt: tile-like water blocks, shoreline steps and moire; smooth wall/plateau silhouettes; flat olive/white/gray ground response; sparse/primitive vegetation; sterile road ribbons; and black-sky or weak atmospheric falloff. The pass turns those observations into deterministic, inspectable instructions.

## Production path

1. Sample canonical world context at a deterministic coordinate.
2. Build `PhotorealismFrame` from `photorealismDirector.ts`.
3. Build `EnvironmentPassPlan` from `photorealismEnvironmentPass.ts`.
4. Feed the P2 material recipe through `MaterialAssignmentCore.js`.
5. Feed P3/P1 placement candidates through `WorldAssetPlacementPipeline.js`.
6. Use `photorealismAssetClusterPlanner.ts` to batch eligible asset instances by family, biome, surface recipe and LOD.
7. Apply the renderer-facing slice through `photorealismSceneBridge.ts`.
8. Record the deterministic key and provenance in the resulting manifest.

## P0 guarantees

- Rectangular water blocks are reported as a visible failure and can be suppressed by the pass plan.
- Grid/seam evidence is explicit; no GeoCell/Pindex term is introduced.
- Shoreline transition width and water normal repetition are bounded.

## P1/P2 guarantees

- Rendered/collider height parity is measured in metres.
- Smooth-wall and flat-ground evidence is visible in the plan, not hidden by a test-only flag.
- Snowline, wet-edge, macro/micro breakup, triplanar blend and anti-tiling phase are deterministic.

## P3/P4/P5 guarantees

- Vegetation candidates are filtered by water, slope, road and settlement context before the shared placement pipeline sees them.
- Asset clusters are instance/LOD aware; no procedural cone/tree/rock placeholder is introduced.
- Water moire suppression, foam width, depth blend, shoreline fade and black-sky guard are part of the production pass.

## Acceptance semantics

`acceptanceReady` is intentionally strict. It remains false when any visible P0–P5 failure is still observed, when rendered/collider parity exceeds 0.35 m, when the frame is invalid, or when sky luminance is below the black-sky threshold. Passing a focused unit test does not by itself claim visual acceptance.

## Asset contract

The planner only emits candidates and batch keys. The shared pipeline remains responsible for asset hydrate/load, surface analysis, multi-material recipe, validation, ground transform, manifest creation and scene attachment. `EditorMaterialStudio.js` is never imported by runtime code.
