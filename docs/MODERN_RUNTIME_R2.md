# AAPW Modern Runtime R2

## Purpose

R2 is the typed runtime composition layer for deterministic simulation, gameplay, streaming, networking, persistence, spatial queries and operational telemetry.

The design goal is a safe incremental migration path rather than a flag-day rewrite. Existing JavaScript and Three.js systems can continue to own presentation while the R2 layer takes ownership of stateful simulation boundaries.

## Language and module policy

The R2 surface uses strict TypeScript and native ESM. Runtime modules use explicit `.ts` extension imports so the source graph is unambiguous under modern bundlers and TypeScript bundler resolution.

The runtime avoids ambient randomness and wall-clock state inside deterministic simulation code. Seeds, ticks, ordered system registration and explicit input streams define reproducible behavior.

## Simulation kernel

`simulationKernel.ts` provides a fixed-step clock, bounded catch-up, deterministic RNG, replay records, event timelines, scalar interpolation helpers and quantized vectors.

The kernel deliberately separates frame time from simulation time. A long browser frame cannot force unbounded simulation work. Excess work is measured as dropped simulation time instead of silently producing a spiral of death.

The RNG is stateful and serializable. Independent streams can be forked from a stable seed so procedural systems do not have to share a global random sequence.

## ECS runtime

`ecsRuntime.ts` supplies entity lifecycle, generation counters, component schemas, deterministic queries, phased systems, mutation batches and snapshot/restore.

Component schemas describe creation, cloning and validation. This keeps state changes typed and makes persistence and testing explicit rather than relying on ad-hoc object shapes.

Queries are data-oriented: the smallest required component set becomes the candidate set and final results are sorted by entity id for deterministic iteration.

## Streaming

`streamingOrchestrator.ts` separates requests, cache policy and loading execution.

Every asset request carries a priority, distance and byte estimate. The scheduler prefers urgent and nearby work while the cache stays within a hard byte ceiling. Non-critical work can yield when the per-frame byte budget is exhausted.

Failures use bounded retries with exponential backoff. Cancellation is explicit through `AbortController` and disposal releases cached resources through an optional loader disposer.

`ChunkStreamingPlanner` adds a world-aware layer that translates desired chunks into asset requests while preserving camera-relative priority.

## Networking

`networkReplicationV3.ts` defines a deterministic snapshot model with protocol version 3, entity generations, component payloads and replicated events.

The snapshot builder validates limits before publishing state. `diffSnapshots` creates spawn/update/despawn deltas, while `applySnapshotDelta` reconstructs the next authoritative state.

Reliable gameplay events are tracked separately from state snapshots so acknowledgement does not have to mutate the state stream.

`NetworkJitterBuffer` provides bounded interpolation samples to hide packet timing variance without inventing future state.

## Prediction and reconciliation

`predictionReconciliation.ts` keeps local commands and predicted checkpoints in bounded history. An authoritative snapshot can correct drift and replay only the input window that follows the confirmed tick.

There is an explicit rollback limit. Extremely stale authority does not cause unbounded replay; instead the controller snaps to authority and trims historical state.

## Persistence

`saveMigrationEngine.ts` provides a checksummed envelope with a format identifier, schema version, world seed, profile id, creation tick and payload.

Saves are rejected when their checksum, version fields, profile identity or serialized size are invalid. Forward migrations are registered in a directed graph and executed in deterministic order.

The persistence layer is intentionally storage-agnostic. Browser IndexedDB, localStorage adapters, filesystem-backed wrappers and remote profile stores can implement the same `SaveStore` interface.

## World queries

`worldQueryRuntime.ts` implements a deterministic spatial index with radius, box, ray and nearest queries.

Queries accept layer filters and result limits. Broad phase uses fixed-size cells while narrow phase handles circle intersection and ray/sphere tests.

Ground projection is a pure function over a typed height sampler, keeping terrain authority separate from gameplay policy.

## Gameplay bridge

`gameplayBridge.ts` is the integration point for actors. It defines gameplay tags, health, teams and actor state as versioned component schemas.

The bridge owns typed events for damage, healing, state changes, teleports and despawns. Nearby ally and enemy queries are resolved through the same spatial runtime, preventing multiple gameplay systems from implementing their own divergent search logic.

Grounding uses the injected height authority and updates both transform and spatial-index state after movement.

## Observability

`observabilityHub.ts` collects counters, gauges, histograms, events, alerts and bounded trace spans.

`BudgetMonitor` turns performance contracts into explicit checks for frame time, network RTT and heap size. Runtime code can therefore report degradations instead of hiding them in logs.

The telemetry model is intentionally low-overhead and bounded. There are no unbounded arrays for hot-path metrics.

## Composition root

`runtimeApplication.ts` wires the subsystems together without coupling them to Three.js. It owns the simulation kernel, ECS world, scheduler, save manager, stream orchestrator, replication history and observability pipeline.

The application can therefore be executed in a headless test process, a browser main thread or a future worker host.

## Migration strategy

The preferred migration sequence is:

1. Keep existing JavaScript presentation and authored world generation intact.
2. Move deterministic state ownership behind typed R2 interfaces.
3. Route input, gameplay events and save state through the R2 composition root.
4. Connect Three.js render synchronization to R2 snapshots rather than letting rendering mutate authoritative state.
5. Move long-running simulation work to workers once the message contracts are stable.
6. Retire duplicate legacy authorities only after their behavior is covered by deterministic regression tests.

## Performance invariants

R2 treats the following as hard engineering constraints:

- Fixed-step simulation must have a bounded catch-up budget.
- Entity ids and system execution order must be deterministic.
- Asset caches must obey explicit byte limits.
- Network snapshots must enforce entity/component/event/payload limits.
- Save payload size must be capped and checksummed.
- Spatial queries must have deterministic ordering and result limits.
- Telemetry buffers must be bounded.
- Rollback history must be bounded.

## Security boundaries

Inputs entering R2 should be validated before they become component state. URLs, profile identifiers, component names and save envelopes should remain constrained to known safe formats.

No dynamic code evaluation is required by the R2 runtime. The system should not introduce `eval`, `new Function`, ambient browser randomness or direct wall-clock reads into deterministic simulation surfaces.

## Testing

The primary regression suite lives in `tests/modern/runtimeR2.test.ts`.

The suite covers deterministic RNG, fixed-step budgets, replay digests, ECS lifecycle and snapshots, stream retries and eviction, replication deltas, interpolation, save integrity and migration, observability budgets, prediction correction, spatial queries, gameplay events and application composition.

The intended validation order is:

- TypeScript typecheck.
- Deterministic unit tests.
- Runtime build.
- Modern platform integration guards.
- Browser-level visual and performance checks owned by the existing project workflows.

## Definition of done for future slices

A feature is considered runtime-ready when its state model is typed, its mutation boundaries are explicit, its failure mode is bounded, its deterministic behavior is testable and its operational cost can be measured.

R2 is deliberately modular so individual systems can be replaced without changing the composition contract. This is the foundation for future worker execution, richer networking and progressively deeper TypeScript ownership of the game.
