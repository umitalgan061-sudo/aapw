# R44 Runtime Assurance Layer

## Purpose

R44 adds a typed control plane around the engine's existing R43 runtime. It does not replace the established renderer, simulation step, or game loop. The host owns the frame boundary and supplies logical ticks; R44 provides bounded services that can be called from that boundary.

The implementation is split into independently testable services and a small composition root in src/engine-ts/r44/runtimeAssurance.ts.

## Main services

- **Event ledger**: sequence-numbered, append-only events with a bounded retention window, stable content fingerprints, snapshot import validation, and chain verification. When the capacity is reached, the oldest entries are dropped and the drop count is observable.
- **Performance governor**: bounded metric windows, EWMA and p50/p90/p95 summaries, configurable budgets, escalation thresholds, recovery hysteresis, health grades, and concrete optimization suggestions. Samples use supplied tick values, not ambient time.
- **Fault containment**: per-subsystem circuit breakers, bounded retry tokens with deterministic backoff, incident coalescing, active incident limits, and a finite incident history.
- **Resource lifetime**: LIFO disposal scopes and a resource lease registry that accounts for estimated bytes, reference counts, long-lived leases, duplicate releases, and cleanup failures.
- **Work scheduling**: priority and lane-aware tasks, stable insertion-order tie-breaking, aging, deduplication, logical cost units, expiry ticks, cancellation, and bounded terminal history. Task callbacks are synchronous; async work should return to the runtime as a new event/task.
- **Asset pipeline**: identity and URI validation, dependency readiness checks, concurrent-load limits, content-type and byte limits, fingerprint verification, explicit cancellation, and eviction.
- **Network guard**: protocol/channel/kind allowlists, envelope size limits, logical-tick horizons, sliding sequence windows, and sender/channel token buckets. It is a validation boundary, not a substitute for transport encryption or authenticated identity.
- **Save coordinator**: canonical content fingerprints, schema revisions, explicit migration paths, atomic write adapters, optimistic revision checks, and an in-memory adapter for tests.
- **Feature gates**: stable rollout cohorts based on a subject, key and seed; prerequisite checks; deterministic conflict resolution; and explicit emergency overrides.
- **Composition root**: R44RuntimeAssurance connects lifecycle, performance, incidents, task scheduling, resources, gates, readiness checks, and the event ledger without coupling them to Three.js.

## Entry points

The public engine entry point exports src/engine-ts/r44/index.ts, so downstream code can import individual types or construct the complete assurance façade. Existing imports remain unchanged.

Example usage:

    import { R44RuntimeAssurance } from "./src/engine-ts/r44/index.js";

    const assurance = new R44RuntimeAssurance({ id: "session-01" });
    assurance.start(1);

    const health = assurance.observePerformance({
      tick: 2,
      frameMs: 12,
      simulationMs: 3,
      renderMs: 6,
      memoryMb: 640,
      networkRttMs: 35,
      activeEntities: 1200,
      queuedTasks: 14,
    });

    console.log(health.state, health.score);
    await assurance.shutdown(3);

The façade is opt-in. A migration can start by instrumenting the existing runtime at a single stable frame boundary, then add task routing, asset ownership, or feature gates incrementally.

## Determinism and trust boundaries

R44 avoids wall-clock timestamps and ambient randomness in the assurance core. Logical tick values must be provided by the caller. Fingerprints use a stable non-cryptographic digest for content equality, deduplication, and corruption detection; **they are not signatures or MACs**. Network peers still require TLS/transport security and authenticated identities where applicable.

Asset URLs, payload sizes, content types, sender IDs, message types, sequences, save revisions, metadata, and task queues are validated before they can consume unbounded resources. Resource estimates are accounting values supplied by the host, not a measurement of exact GPU allocation.

## Verification commands

Run the R44 structural contract and focused tests with:

    npm run verify:runtime-assurance-r44
    npm run typecheck:runtime-assurance-r44
    npm run test:runtime-assurance-r44

The dedicated workflow invokes these checks on changes to the R44 modules, tests, package scripts, entry barrel, or this documentation. Passing static checks is not proof of full browser, graphics-driver, or production-network correctness; integration acceptance still belongs to the deployment environment.
