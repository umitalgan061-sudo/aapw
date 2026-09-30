# AAPW Next-Generation Runtime V3

## Purpose

The `src/3d/nextgen` surface is the strongly typed simulation and orchestration layer for the AAPW world. It is deliberately independent from the Three.js scene graph so that gameplay correctness, network replication, persistence, and worker execution can be validated without a browser renderer.

## Language and runtime direction

The modern surface is TypeScript-first and targets current ECMAScript semantics. Strict compiler settings should remain enabled. New simulation code must prefer explicit types, deterministic primitives, bounded collections, immutable snapshots at API boundaries, and platform-neutral services.

Legacy JavaScript is not removed in one destructive cut. `legacyInteropV3.ts` provides a controlled boundary so the live world can transfer ownership module by module while preserving the current visual implementation.

## Runtime layers

### Kernel

`runtimeKernel.ts` owns the fixed-step clock, entity lifecycle, deterministic commands, transform/velocity integration, and runtime snapshots. Systems are ordered by explicit priority and stable identifier.

### Deterministic math

`deterministicMath.ts` contains vector, quaternion, quantization, hashing, collision, interpolation, and seeded random primitives. Simulation code should use these helpers instead of ambient randomness where reproducibility matters.

### Player prediction

`playerPrediction.ts` keeps a bounded input buffer and state history. Client movement can be simulated locally, reconciled against an authoritative state, and replayed from the acknowledged tick.

### Combat

`combatSimulation.ts` is data-driven. Attack definitions own startup/active/recovery windows, stamina cost, poise damage, armor interaction, blocking, critical damage, stagger, and death transitions.

### AI

`aiSimulation.ts` implements bounded perception memory and utility selection. A thinker budget prevents an NPC from evaluating unbounded action sets on the main simulation step.

### Navigation

`navigationRuntimeV3.ts` provides bounded A* and cached flow fields over a deterministic grid. Changing an obstacle invalidates affected cached fields.

### Streaming

`assetStreamingV3.ts` deduplicates loads, applies priority, limits concurrency, supports retries/cancellation, and enforces resident/per-asset memory budgets.

### Networking

`networkProtocolV3.ts` defines versioned snapshots and deltas, strictly ordered entity state, bounded payloads, and history. The protocol is intentionally transport-agnostic.

### Persistence

`saveSystemV3.ts` serializes stable JSON with checksums, schema versions, bounded payloads, and one-step migrations. Save validation can be moved to a worker without changing game logic.

### Workers

`workerProtocolV3.ts` provides typed task messages and chunked work utilities. This allows terrain generation, navigation, validation, and serialization to leave the render thread when the browser integration layer is ready.

### Telemetry and governance

`runtimeTelemetryV3.ts`, `runtimeContractsV3.ts`, and `performanceGovernorV3.ts` form the runtime safety net. Budgets are explicit, histories are bounded, and quality can move between presets based on sustained pressure rather than frame-to-frame noise.

### Unified facade

`runtimeFacadeV3.ts` composes the services into one runtime entry point. It is the recommended integration target for future browser adapters and gameplay systems.

## Migration strategy

1. Keep `src/3d/nextgen` independent and covered by deterministic tests.
2. Add a browser adapter that maps the existing player/world objects to `LegacyInteropV3`.
3. Route input into `PlayerPredictor` while continuing to render through the existing scene manager.
4. Move one gameplay authority at a time: combat, AI, navigation, then persistence and streaming.
5. Use the runtime contracts as release gates before deleting a legacy authority.
6. Only after parity is demonstrated should old JavaScript authorities be removed.

## Performance policy

Do not solve frame pressure by silently reducing correctness. The governor changes quality budgets, not simulation rules. Deterministic simulation remains fixed-step even when rendering quality changes.

Large arrays and histories must have explicit caps. Network snapshots reject oversized entity sets. Asset loads reject payloads that exceed the configured memory budget. Worker queues are bounded. These constraints keep worst-case behavior measurable.

## Testing policy

Every new runtime authority should have deterministic tests for normal behavior, malformed input, capacity boundaries, recovery paths, and repeated-seed reproducibility. A feature is not considered integrated merely because its module compiles; it must also be exposed through the public nextgen index and represented in a runtime contract or integration test.
