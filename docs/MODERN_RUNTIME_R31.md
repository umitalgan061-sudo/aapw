# R31 Strict TypeScript Runtime Platform

R31 is the next incremental ownership boundary for AAPW. It does not replace the existing Three.js world in one destructive step. It introduces a strict, framework-neutral runtime host that can own browser input, simulation scheduling, world queries, gameplay commands, rendering, network traffic, persistence, telemetry and failure containment behind typed contracts.

## Why this layer exists

The repository already contains TypeScript production owners and compatibility shims for the major 3D surfaces. R31 turns that migration work into a stronger execution boundary:

- strict TypeScript only inside `src/3d/strict/r31`
- no `@ts-nocheck` or `@ts-ignore`
- deterministic fixed-step clock with catch-up protection
- bounded event and command queues
- typed world/gameplay/render/network/persistence ports
- payload sanitization and rate limiting
- dependency-ordered asset manifest validation
- bounded telemetry, metrics and health reporting
- plugin failure containment instead of unhandled runtime collapse
- versioned snapshots with canonical deterministic digests
- replay journal and checkpoint verification primitives
- adaptive quality and load-shedding policies
- a public barrel export from `src/3d/modern/index.ts`

## Runtime shape

`RuntimeHostR31` owns the application kernel. The kernel owns:

1. `EventBusR31` for bounded typed events.
2. `CommandRouterR31` for prioritized gameplay/runtime commands.
3. `DeterministicClockR31` for fixed-step simulation.
4. `SchedulerR31` for bounded per-frame task execution.
5. `DiagnosticsR31` and `PerformanceBudgetR31` for health and frame-budget enforcement.
6. `FailureContainmentR31` for repeated plugin failure isolation.
7. `TelemetryBufferR31` and `MetricsAggregatorR31` for low-overhead observability.

The host can attach typed ports for world access, gameplay execution, rendering, networking and persistence. These are adapters: production implementations can wrap the current application without forcing legacy systems to understand R31 internals.

## Determinism

Simulation time is owned by the fixed-step clock. R31 source files are guarded against `Math.random()`, `Date.now()`, dynamic `eval()` and `new Function()`. Snapshots and journals use canonical recursive key ordering before digesting.

The determinism boundary intentionally separates simulation time from wall-clock telemetry. This means a frame can be replayed with the same input history while diagnostics still record real frame timing.

## Security

All worker/network payloads cross a bounded sanitizer. Strings, arrays and object keys have explicit limits; non-finite numeric values are normalized; deeply nested input is rejected. Command traffic is rate-limited. Asset manifests validate URL shape, dependency existence, total size and dependency cycles before scheduling.

## Resource ownership

`ResourceScopeR31` gives runtime modules a single release authority. Release operations are idempotent, reverse-ordered during shutdown and tracked in diagnostics. This prevents GPU/network/storage wrappers from becoming accidental global singletons.

## Migration model

Legacy JavaScript remains compatibility-only where it still exists. `TypeScriptOwnershipBoundaryR31` records the migration state and prevents promotion or retirement without parity evidence. The intended flow is:

`legacy -> shadow -> typed -> retired`

A module can therefore be migrated independently while the rest of the game remains operational.

## Commands

`npm run verify:r31` validates structural policy.

`npm run typecheck:r31` type-checks the R31 source and tests with `allowJs: false`.

`npm run test:r31` executes the R31 regression corpus.

`npm run check:r31` runs all three checks.

## Operational intent

R31 is deliberately additive. It can be wired into the existing `game3d.ts` loop through ports and plugins, allowing gradual ownership transfer instead of a single high-risk rewrite. Future waves can move more concrete Three.js and gameplay implementations behind these interfaces while preserving the current browser contracts.
