# Typed Runtime Modernization R1

This release makes TypeScript the default language for new engine/runtime work and turns the legacy JavaScript surface into an explicit migration boundary rather than an accidental architecture.

## Language policy

- New engine code belongs in `src/engine-ts` or the TypeScript-first `src/3d/modern` surface.
- Legacy JavaScript remains executable only where existing gameplay/browser integrations still depend on it.
- New JavaScript inside the typed engine is forbidden by the typed-runtime gate.
- Vendor JavaScript is treated as an external boundary and is not considered migration debt.
- Migration promotion requires repeatable parity evidence before a surface is cut over.

## Runtime layers

`typedRuntimeComposition.ts` is the composition root for the modern typed runtime. It owns the lifecycle bridge, frame budgeting, telemetry, quality hysteresis and migration boundary evidence.

`workerRuntime.ts` provides a deterministic worker-compatible queue. Visibility and LOD planning are pure deterministic functions and can be moved off the main thread without changing simulation authority.

`assetPipeline.ts` defines a typed manifest, dependency graph, bounded request queue, residency accounting, prefetch planning and deterministic eviction policy.

`typedMigrationV5.ts` records which gameplay surfaces are typed, which remain legacy and which have enough parity evidence to be promoted.

## Browser strategy

The runtime keeps backend selection capability-driven. WebGPU remains preferred when the secure browser environment supports it; WebGL2 remains the compatibility path. The typed layer does not hard-code a browser-specific rendering backend.

## Determinism

The compatibility corpus enumerates 4,096 distinct combinations of backend, quality, input, storage, worker mode and frame-pressure state. Every row is reproducibly generated and the CI gate regenerates it twice to prove byte-stable output.

## Quality gates

1. `npm run typecheck`
2. `npm run verify:typed-runtime`
3. `npm run test:typed-runtime`
4. deterministic matrix repeat comparison
5. generated matrix materialization without manual edits

The generated matrix is intentionally source-controlled so regressions in the compatibility contract are visible in review.
