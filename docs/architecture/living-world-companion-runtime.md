# Living World Companion Runtime — bounded owner-facing follow/assist/regroup application layer

This slice sits strictly above the already merged Living World reaction/integration owners. The
production adapter never creates an ActorRegistry, never owns spawn/despawn, never decides combat
damage, and never imports DOM/editor material tooling. It consumes the existing integration snapshot,
turns companion links into deterministic runtime requests, and delegates movement/support/publication
to caller-provided owner services.

## Runtime coverage

`follow` and `escort` maintain a seeded formation slot behind the target and issue bounded navigation
requests. `assist` observes the target's existing reaction phase and issues a support request only
while the target is in the existing `attack` phase. `regroup` and `flee` observations become regroup
navigation. `hold` suppresses movement while retaining the link. Broken or stale links enter a
recovering state instead of inventing a teleport or mutating the target.

Every link has bounded history, stale-target hysteresis, target-position prediction from existing
velocity metadata, distance/LOD throttling, and deterministic ordering. Near companions tick every
frame; distant/far links are throttled; culled links perform no owner work. Navigation, combat and
world-event calls each have an explicit per-frame budget.

## Existing ownership retained

- Actor membership: existing caller / ActorRegistry.
- Reaction and perception: `livingWorldReactionIntegrationAdapter.js` and its composed owners.
- Navigation and ground-safe movement: injected navigation owner.
- Combat and damage: injected encounter/combat owner.
- World events: injected `worldEventsPublisher`.
- Materials and placement: merged `#590` `MaterialAssignmentCore.js` + `WorldAssetPlacementPipeline.js`.

This module does not load a model, create a material, create a placement pipeline, or import
`EditorMaterialStudio.js`. No source asset or LFS pointer is changed in this slice.

## Determinism / performance

Link normalization deduplicates by stable id and sorts by priority, actor id and link id. Formation
slots use a stable hash rather than insertion order. Output digests use canonical key ordering.
Long frames clamp to 0.25 seconds. A companion can issue at most eight navigation and eight combat
requests per tick, and world-event publication is capped at six. History is capped at eight entries
per link.

## Browser proof

`checkLivingWorldCompanionRuntimeBrowser.mjs` starts a local HTTP harness, imports the exact shipped
vendored Three.js module and the production adapter through its real relative-import graph, creates
real `THREE.Object3D` actor handles, executes the companion runtime twice, and requires navigation,
combat, event, telemetry and audit evidence. Page errors, console errors and failed requests are hard
failures.

## Merge gate

The dedicated workflow enforces exact-current-main ancestry, a 2,400–3,000 changed-line envelope,
syntax and executable contracts, the shipped browser proof, the merged Shared Material Placement
contract, seeded-random and world-event determinism guards, PWA installability, technical-debt guard,
and the repository's `checkRun283FinalHeadGovernance.js` contract. Repository-wide Run167/Run283
workflows remain authoritative and are not weakened by this PR.
