# R28 Browser Integration Operations

R28 is the browser-facing production layer above the deterministic R27 runtime.

## Boot sequence

1. Resolve browser capabilities and select a bounded quality profile.
2. Construct the deterministic R27 runtime.
3. Bind DOM input only at the browser host boundary.
4. Mount lifecycle-owned resources and browser listeners.
5. Start the fixed-step loop.
6. Convert runtime snapshots into renderer-neutral frame packets.
7. Feed performance and incident data into telemetry and adaptive quality.

## Failure behavior

A long browser frame is capped by the fixed-step accumulator. The runtime emits a spiral-guard incident rather than performing unbounded catch-up.

Input is sanitized before it reaches simulation. Payloads, command counts, event counts and strings are bounded.

Asset loading is cancellable and size-limited. Resource disposal is centralized by RuntimeResourceRegistry.

## Compatibility

R28 does not require an immediate rewrite of every JavaScript file. Existing JavaScript can remain as a compatibility shim, but new runtime ownership belongs to TypeScript.

LegacySurfaceAudit and the R28 verification script provide a mechanical boundary for the migration.

## CI

The modern TypeScript workflow now includes the R28 verification/test gate in addition to the existing modern runtime checks.

The local execution environment used for this change cannot resolve GitHub directly, so repository-hosted CI is the source of truth for dependency installation, full typecheck and browser build execution.
