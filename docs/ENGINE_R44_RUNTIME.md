# R44 — Runtime Governance and Reliability Layer

## Purpose

R44 adds a bounded production-governance layer on top of the R43 engine. It remains separate from gameplay authorities: callers opt into command admission, work scheduling, capability checks, audit history, asset orchestration, session sequencing, and diagnostics through the TypeScript API.

## Runtime boundaries

- **Frame work:** `FrameBudgetArbiter` admits bounded work per lane, applies stable task ordering, accounts for reserved lane budgets, tracks deadlines, and reports failures without stopping the frame.
- **Lifecycle:** `RuntimeLifecycle` orders services by dependency, detects missing dependencies and cycles, rolls back critical startup failures, and shuts down in reverse order.
- **Audit and replay:** `HashChainJournal` stores sequence-linked event records, checkpoints state, validates exports before import, and blocks replay when the journal is inconsistent. Its digest is a corruption-consistency check, not a cryptographic signature.
- **Security:** `BoundaryValidator` clones payloads into JSON-safe data, applies bounded schema rules, and rejects accessors, exotic prototypes, cycles, oversized strings/arrays/objects, and dangerous keys. Sliding windows, replay nonces, and object-identity capabilities control admission.
- **Asset orchestration:** `AssetPipeline` deduplicates concurrent requests, enforces byte budgets, bounds pending work and resident cache, evicts least-recently-used entries, and supports cancellation and invalidation.
- **Telemetry:** `TelemetryHub` uses a fixed-capacity ring, bounded metric cardinality, percentile summaries, gauges/counters, anomaly checks, and digest-protected export.
- **Session safety:** `SessionTimeline` checks session/epoch/sequence/tick/digest and keeps a bounded input history. `SnapshotSequenceGate` validates ordered snapshot packets.
- **Diagnostics:** `DiagnosticBuffer` bounds events and fault cardinality, deduplicates bursts, and exposes circuit breakers plus weighted health decisions.
- **Composition:** `R44Runtime` binds capability-checked command dispatch to the work arbiter, journal, health gate, telemetry, session timeline, and asset pipeline.

## Integration

1. Import `R44RuntimeGovernance` from `src/engine-ts/index.ts` for namespaced access, or import individual APIs directly from `src/engine-ts/r44/index.ts`.
2. Register service dependencies and command schemas during bootstrap.
3. Start the runtime before accepting external commands.
4. Issue a capability with a narrow scope and only the permissions required by the command.
5. Submit validated commands for a monotonically increasing frame and call `runFrame` once per engine frame.
6. Send expensive asynchronous work through asset/worker boundaries rather than returning promises from deterministic command handlers.
7. Treat journal digests as consistency checks. If adversarial authenticity is required, use a server-owned cryptographic signature or MAC outside deterministic simulation.

## Validation

Run `npm run check:r44` to execute the architecture gate, a dedicated strict TypeScript project, and Vitest suites. GitHub Actions runs the same check and verifies that R44 source does not rely on ambient randomness, wall-clock reads, or `@ts-nocheck`.

## Limits

No runtime should be described as perfect. R44 makes budgets, lifecycle, input trust, state capture, and failure reporting explicit. Browser, GPU, asset-host, worker, and network integrations still need end-to-end validation on target devices and deployments.
