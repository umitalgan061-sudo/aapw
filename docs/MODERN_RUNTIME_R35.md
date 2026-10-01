# AAPW Modern Runtime R35

R35 consolidates the TypeScript-first application runtime above the existing V3 simulation services.

## New platform services

R35 adds versioned runtime contracts, immutable state revisions, device-neutral input normalization, budget-aware scheduling, dependency-aware asset streaming, bounded observability, recovery/circuit breaking, typed command dispatch, checksummed save envelopes, bounded worker execution, deterministic fixed-step timing, feature/capability evaluation, resource quotas, and TypeScript ownership governance.

The runtime flow is:

    input -> state -> schedule -> simulation -> stream -> network -> persistence -> render -> telemetry

Each phase is budgeted. Work can be deferred, retried, degraded, restored or faulted according to explicit policy.

## Language migration

Production source is TypeScript-first. JavaScript files that remain are compatibility boundaries, legacy archives, or vendor material. R35 makes this distinction testable with machine-readable ownership evidence.

## Integration

src/3d/nextgen/r35/runtimeApplication.ts is the application facade. It composes the existing V3 runtime with the R35 control plane without forcing an immediate rewrite of renderer and legacy browser entrypoints.

## Validation

    npm run check:r35

This runs the R35 structural guard, strict compiler boundary and regression suites.
