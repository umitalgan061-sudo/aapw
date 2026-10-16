# R45: TypeScript Runtime Operations and Migration Governance

## Purpose

R45 is an opt-in TypeScript operational layer alongside the current R43 engine and the R44 governance work. It adds a cohesive, bounded control surface for startup, frame progression, commands, saves, telemetry, quality decisions, and runtime health. It does not replace the existing Three.js scene, gameplay loop, or world-generation authorities in one risky cutover.

The public entry point is the namespace export R45RuntimeOperations from src/engine-ts/index.ts. The implementation remains under src/engine-ts/r45, has a dedicated strict TypeScript configuration, and is validated independently of unrelated legacy checks.

## Runtime shape

    RuntimeOperations
      ├─ DeterministicLogicalClock
      ├─ ServiceLifecycleGraph
      ├─ BoundedWorkScheduler
      ├─ CommandGateway
      ├─ PersistenceCoordinator
      ├─ BoundedTelemetrySpool
      ├─ AdaptiveQualityDirector
      ├─ RuntimeDiagnosticLedger
      └─ TypeScriptMigrationGovernance

The facade is intentionally small compared with the individual modules: it composes their public contracts and preserves their bounds. Domain systems can register lifecycle services, commands, and named persistence sections before startup. After startup, registration is frozen so a running session does not acquire unreviewed authorities.

## Determinism and time

DeterministicLogicalClock advances a fixed simulation step, clamps unexpected elapsed time, limits catch-up work, and records discarded time. Simulation timers are scheduled by logical ticks instead of wall-clock APIs. Callback failures are captured so one timer cannot suppress the rest of a due batch.

The scheduler pumps only at declared ticks, orders tasks using deterministic priority/age/deadline inputs, enforces a capacity and per-pump work budget, and tracks dependency outcomes. If an expensive task cannot fit in the remaining budget, the scheduler can still run other eligible tasks that do fit. Queue overload, expiry, and task failures are observable outcomes rather than silent growth.

## Lifecycle safety

Services declare dependencies. The lifecycle graph rejects missing dependencies and cycles before starting. Startup follows a deterministic dependency order; failure triggers reverse-order rollback. Shutdown also follows reverse dependency order and records failures for follow-up. Health probes can move a service between ready and degraded, and a subsequent healthy probe can recover it.

The graph serializes lifecycle mutations. Services receive a generation number and optional abort signal, so adapters can associate work with a startup/restart epoch and stop responding to stale startup attempts.

## Command boundary

Commands are registered with a version, an explicit type-guard validator, required scopes, and a per-command payload budget. Dispatch validates the caller/session identity, tick metadata, serialized payload size, authorization scopes, rate budget, and domain payload before invoking the handler.

Receipts are sequenced and bounded. Idempotency keys are scoped by principal, session, command, and key. Reusing an idempotency key with the same canonical payload replays the original result; reusing it with different content is rejected as a conflict. Handler exceptions become failure receipts. This reduces accidental duplicate actions without pretending that the gateway is a full remote authentication system.

## Persistence contract

A saved envelope carries its key, schema version, monotonically increasing revision, logical save tick, canonical payload, and fingerprint. Writes use compare-and-swap against the previous revision and retry within a configured budget. Adapters can implement durable storage without changing domain logic.

Migrations are registered as adjacent version steps. A load verifies the envelope before decoding, applies the complete migration path, and invokes a domain validator. Missing migration links, unsupported newer schemas, payload overflow, and integrity failures are returned as explicit faults. A bounded last-known-good cache can restore a previously validated value if a later envelope is corrupted; it is a recovery aid, not a substitute for durable backups.

Import supports a dry-run validation path and rejects target overwrite unless explicitly requested. The included in-memory adapter is for tests and deterministic local use. Production integrations should supply storage with durability, transaction semantics, and operational monitoring appropriate to the deployment.

## Telemetry and diagnostics

The telemetry spool has fixed capacity, canonical event fingerprints, sequence cursors, bounded pagination, and severity-aware pressure behavior. Field names must be allowlisted; keys that look like credentials or personal identifiers are rejected, and values resembling email addresses or IPv4 addresses are filtered. Error and critical events bypass low-severity sampling. The spool does not send data over the network by itself: delivery, retention and consent policies remain the host application's responsibility.

The diagnostic ledger separately retains incidents and numeric samples in bounded windows. It coalesces repeated incidents by component/code/fingerprint, tracks their occurrence count, and computes useful metric summaries including min, max, mean and p95. Both systems report dropped/filtered counters so consumers can identify when observability itself is under pressure.

## Adaptive quality policy

The quality director evaluates frame duration, input latency, memory, network RTT, queue depth and dropped-frame signals. It uses a bounded observation window and hysteresis: quality drops after sustained pressure and rises only after sustained headroom and a minimum time between transitions. Memory hard-limit pressure can force a faster downshift. Operators can apply an explicit time-bounded profile override.

The output is a policy profile, not a renderer mutation. The application bridge remains responsible for applying render scale, shadow, vegetation, particle, streaming and task-budget settings to the real scene. That boundary keeps tests deterministic and avoids coupling governance code to WebGL objects.

## TypeScript migration governance

TypeScriptMigrationGovernance records module ownership, migration stage, risk, runtime criticality, dependencies and test contracts. It detects missing dependencies, dependency cycles, strict-core paths reaching legacy JavaScript, untested strict modules, and duplicate source-of-truth claims. createProjectMigrationManifest() seeds a small explicit view of the main gameplay entrypoints and the R43/R44/R45 layers.

The manifest is intentionally an inventory rather than a claim that every JavaScript file has already been rewritten. Its warnings identify legacy critical paths that remain to migrate. The next language-migration step should be driven by dependency evidence and tested ownership transfers, not by renaming every .js file to .ts in bulk.

## Verification

Run the focused checks from the repository root:

    npm run verify:r45
    npm run typecheck:r45
    npm run test:r45
    npm run check:r45

The dedicated workflow installs the declared dependencies, runs the static architecture gate, typechecks only the R45 source/test surface under strict options, and runs the R45 Vitest suites. The new code remains opt-in until an existing gameplay authority is migrated through a reviewed adapter and acceptance tests.

## Operational invariants

- The logical clock never relies on ambient randomness or wall-clock time.
- Queues, histories, timer batches, registry sizes and payload bytes have explicit limits.
- Every lifecycle start path has a corresponding rollback/stop path.
- Command execution is behind scope, schema, rate, payload and idempotency checks.
- Persistence data is fingerprinted, revisioned, migrated and type-validated before restore.
- Telemetry uses bounded storage and allowlisted fields; event transmission is left to the host.
- Quality transitions use hysteresis and expose reasons/profile data.
- TypeScript ownership is evaluated through module and test contracts rather than filename extension alone.
