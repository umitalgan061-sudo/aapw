# AAPW Modern Runtime R35

R35 is the first cohesive application-level runtime layer above the existing V3 simulation services.

## Architectural goals

R35 keeps the deterministic simulation primitives already present in the repository and adds an application control plane around them. The layer is intentionally renderer-neutral: browser/Three.js integration remains behind the existing V3 facade and legacy bridges.

The new surface contains:

- contracts.ts: versioned runtime state, events, budgets, commands and configuration contracts.
- stateStore.ts: immutable snapshots, revisions, transactions, selector subscriptions and bounded checkpoints.
- inputPipeline.ts: device-neutral keyboard/mouse/gamepad/touch normalization with action bitmasks.
- worldScheduler.ts: budget-aware work scheduling with deadlines, priorities and coalescing.
- assetOrchestrator.ts: dependency-aware streaming, bounded residency, retries and deterministic eviction.
- observability.ts: bounded spans, phase metrics, budget diagnostics, counters and health scoring.
- runtimeApplication.ts: a single application facade wiring input, scheduler, streaming, security and the next-generation runtime.

## TypeScript-first policy

The production runtime source of truth is TypeScript. Existing JavaScript compatibility shims are not promoted to implementation owners. New R35 code is covered by a dedicated strict allowJs=false compiler boundary and a CI workflow.

## Runtime flow

input -> state snapshot -> scheduler -> simulation -> streaming -> telemetry -> health -> snapshot

Every phase has an explicit budget. Work that cannot fit is deferred rather than silently over-running the frame. Asset dependencies are loaded before dependent consumers are marked ready. Runtime commands are sanitized and rate-limited at the application boundary.

## Determinism

Simulation-facing APIs receive an explicit tick. Runtime state transitions are versioned and checkpointable. R35 does not introduce Math.random(), dynamic code generation, or wall-clock dependence into simulation decisions.

## Validation

Run:

    npm run check:r35

The command performs a structural guard, a strict R35 typecheck and the R35 regression suite.

R35 is intended as a consolidation layer. It does not remove existing V3 services; it gives the project one typed application-level entry point so future migration work can retire duplicated orchestration surfaces safely.
