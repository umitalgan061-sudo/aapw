# Modern Runtime Release Checklist

## Toolchain

- Node.js engine constraint is present and compatible with CI.
- TypeScript configuration uses only options supported by the installed compiler.
- Vite production build and Vitest test entry points are declared in `package.json`.
- No generated dependency lockfile is fabricated; dependency installation remains reproducible through the package manifest and CI.

## Runtime

- `RuntimeKernel` is started exactly once per lifecycle session.
- `RuntimeLifecycle` owns visibility/page lifecycle subscriptions and removes them on stop/dispose.
- `RuntimeBudgetController` receives pressure data before expensive optional work.
- `RuntimeProfiler` records phase costs only as diagnostics; gameplay logic never depends on wall-clock timing.

## Determinism

- Simulation-critical modules use explicit seed/counter inputs.
- Replay and snapshot ordering is stable by tick and identifier.
- Checksums are generated from canonical serialized structures.
- Ambient `Math.random()` and `Date.now()` are rejected in simulation-critical source surfaces.

## Rendering

- `RenderBridge` consumes immutable packets and does not own scene graph objects.
- WebGPU/WebGL2 selection is capability based.
- Device loss follows bounded recovery and fallback policy.
- Quality changes are hysteretic rather than frame-by-frame oscillations.

## Assets

- All manifest URLs pass origin/protocol policy.
- Asset byte limits are checked before residency is committed.
- Resource references are released when a subsystem no longer uses an asset.
- Zero-reference eviction is deterministic and budget driven.

## Networking

- Snapshot entity ordering is deterministic.
- Position and velocity precision is explicit.
- Pending replication messages have a hard upper bound.
- A missing baseline produces a retryable error instead of guessing state.

## Security and resilience

- Worker/network/save payloads cross the shared runtime boundary validator.
- Maximum nesting, collection size and serialized byte limits are enforced.
- Diagnostics are bounded to avoid unbounded memory growth.
- Recovery attempts have a finite budget and failure state.

## Acceptance

A release candidate is ready for wider integration when `verify:modern`, `typecheck`, tests and the production build all complete successfully on the same commit and the relevant render/gameplay acceptance checks have no unresolved failures.
