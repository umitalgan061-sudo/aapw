# AAPW R29 Unified Runtime

R29 is the integration surface that consolidates the mature TypeScript runtime layers into one bounded browser/runtime session.

## Core responsibilities

The runtime owns fixed-step time, lifecycle services, input validation, world streaming, asset retention, adaptive quality, render backend selection, network observation, replay persistence, telemetry and health reporting.

The design deliberately separates policy from engine work.

R29FixedStepClock controls deterministic time.
R29ServiceRegistry controls dependency ordering and teardown.
R29BudgetDirector turns observed pressure into quality decisions.
R29WorldRuntime owns zones and entity transforms.
R29AssetCache bounds resident asset memory.
R29RenderCoordinator selects WebGPU, WebGL2 or headless and compiles render passes.
R29NetworkCoordinator records transport quality and prediction history.
R29SaveLedger provides schema, checksum and size bounded persistence.
R29ReplayJournal records monotonic input history and checkpoints.
R29SecurityBoundary sanitizes inputs, text and payloads.
R29CompatibilityBridge runs the existing R28 public API in shadow mode during migration.

## Modern TypeScript policy

Production ownership remains TypeScript-first. JavaScript compatibility entrypoints may remain as small shims, while large legacy implementations are explicitly isolated.

The R29 verification boundary rejects dynamic code evaluation and ambient randomness in the new runtime surface. Simulation time must come from the fixed-step clock rather than the wall clock.

## Integration

Import the complete R29 surface from src/3d/modern/r29/index.ts.
The top-level modern barrel also re-exports R29 so consumers can adopt it without changing their module graph.
