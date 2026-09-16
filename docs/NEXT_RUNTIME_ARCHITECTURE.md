# AAPW Next Runtime Architecture

## Purpose

The `src/3d/modern/next` layer is the typed runtime boundary for the next stage of the AAPW migration.
It is intentionally independent from the older browser-oriented authorities.
The goal is deterministic simulation, bounded resource use, explicit data ownership, and safe incremental adoption.

## Design goals

- TypeScript-first contracts at every public runtime boundary.
- Native ESM-compatible imports with explicit local file extensions.
- Deterministic random, hashing, quantization, and replay primitives.
- Fixed-step simulation with a hard per-frame step ceiling.
- Data-oriented entity/component storage without requiring a heavyweight ECS dependency.
- Spatial queries that are predictable and sortable by entity id.
- Resource caching with byte, entry, pin, and concurrency budgets.
- Snapshot deltas with explicit base ticks and checksums.
- Versioned saves with one-step migrations.
- Typed input commands that can be replayed.
- Utility AI with deterministic tie-breaking.
- Combat, navigation, animation, camera, audio, and metrics models that remain engine-agnostic.
- Worker-compatible task boundaries.
- Validation and rate limiting at untrusted input boundaries.
- Observable performance budgets and structured telemetry.

## Module map

### `types.ts`

Owns shared branded identifiers and cross-system contracts.
Branded values prevent accidental mixing of entity ids, ticks, and simulation times.
Snapshot, save, resource, input, and telemetry contracts live here instead of being duplicated.

### `math.ts`

Provides bounded scalar helpers, interpolation, damping, vector operations, angle utilities, and AABB helpers.
All helpers are pure and safe to call from deterministic simulation code.
No browser or renderer dependency is allowed in this module.

### `determinism.ts`

Provides seeded random streams, string and integer hashing, quantization, stable checksums, and tick-derived seeds.
The module must never read wall-clock time, ambient randomness, or mutable external state.
Forked random streams are the preferred pattern for subsystem-local procedural decisions.

### `scheduler.ts`

`FixedStepScheduler` owns simulation time.
Frame time is accumulated separately from simulation time.
The scheduler limits the maximum number of simulation steps per rendered frame.
When the accumulator remains over budget, the scheduler marks the result as `spiralPrevented`.
This makes overload visible without allowing unbounded simulation work.

`BudgetedTaskScheduler` is intended for non-critical work such as background analysis, content inspection, or deferred gameplay maintenance.

### `ecs.ts`

`EntityManager` owns lifecycle and stable numeric ids.
`ComponentStore` owns sparse component values.
`EntityWorld` owns component registration, deterministic queries, and ordered system execution.
Systems are ordered by numeric phase and then stable name ordering.
Destroyed entities are removed from all component stores.

The initial transform and velocity components demonstrate how a game-specific component set can remain small and composable.

### `eventBus.ts`

Events are typed through an event map.
Listeners are copied before dispatch so one listener can unsubscribe without mutating the active iteration.
Nested emits are queued, avoiding recursive event cascades.
`once` subscriptions self-remove before invoking user code.

### `spatial.ts`

`SpatialGrid` is a deterministic broad-phase index.
Insert and update rebuild only the cell membership for an item.
Circle and AABB queries deduplicate entity ids before performing exact distance checks.
Returned items are sorted by id for stable downstream behavior.
The ray helper is deliberately conservative and is intended as a gameplay broad phase, not a renderer-grade intersection solver.

### `resourceCache.ts`

Resources transition through pending, ready, failed, and disposed states.
The cache tracks generations so stale handles cannot read replacement resources.
Pinned entries are protected from eviction.
The cache stops admitting new work when the concurrent load budget is exhausted.
Least-recently-used ready entries are evicted first when byte or entry limits are exceeded.

### `contentPipeline.ts`

Content requests are assigned to critical, near, normal, or background priority classes.
The queue remains sorted by priority, then by estimated bytes, then key.
Pumping a bounded batch provides a predictable bridge to browser workers or future server streaming.

### `network.ts`

Snapshots are represented by entity records and deltas.
A delta explicitly records its base tick.
Applying a delta to the wrong base throws immediately rather than silently corrupting state.
The packet window bounds pending reliable packets and provides cumulative acknowledgements.
`NetworkProtocolV2` rejects session mismatches, duplicate sequence numbers, and oversized envelopes.

### `snapshot.ts`

Packed snapshots quantize positional data before transport or replay.
A checksum is derived from canonical entity ordering and values.
Interpolation is performed only for compatible snapshot ordering.
The codec is intentionally data-only so it can run in a worker.

### `save.ts`

Save files have a stable format marker and explicit version.
Migrations must advance exactly one version so chains are obvious and testable.
Canonical serialization sorts object keys before hashing.
Slot storage is bounded so the client cannot grow an unbounded save index.

### `input.ts`

Raw input is normalized into deterministic commands.
Command sequences are monotonic and can be replayed or transmitted.
The input map separates physical codes from semantic actions.
`InputAggregator` centralizes button and axis state.

### `ai.ts`

Perception memory is bounded by entry count.
Threat observations have tick-based decay.
Utility actions declare a base score, cooldown, and minimum utility.
The planner sorts by score and id, making decisions reproducible.
Weighted alternatives use a dedicated deterministic random stream.

### `combat.ts`

Combat is an explicit phase machine: idle, windup, active, recovery, stunned, and dead.
Attacks declare their timing and resource costs.
Poise and health are clamped at every mutation boundary.
Hit resolution uses range and cone tests before damage is generated.
Critical behavior is derived from tick and target id instead of ambient randomness.

### `navigation.ts`

The navigation graph is explicit and bounded.
A* uses stable tie-breaking by node id.
Grid construction creates four-way and diagonal links where appropriate.
The planner reports exploration counts so budgets can be measured.

### `animation.ts`

The animation model separates base, upper-body, additive, and facial layers.
Each layer owns independent clip time and weight.
Cross-fading uses exponential damping instead of frame-rate-dependent linear steps.
Foot planting is represented as a lightweight deterministic signal that can later drive IK.

### `camera.ts`

The camera solver consumes a gameplay target rather than a render object.
Distance, pitch, obstruction, shoulder offset, and smoothing are controlled by explicit configuration.
This allows camera behavior to remain testable without a browser or Three.js scene.

### `render.ts`

The render budget planner turns device capability and frame pressure into stable quality tiers.
It observes rolling frame cost and changes tier only after sustained pressure or sustained headroom.
This hysteresis avoids quality oscillation.

### `audio.ts`

The audio router keeps audio state independent from a specific Web Audio implementation.
Emitters are prioritized and distant or low-gain voices can be virtualized.
Bus gains are centralized so mute, accessibility, and profile settings have one authority.

### `worker.ts`

The local worker pool models the same contract a true `Worker` implementation can later consume.
Handlers are registered by task kind.
Queue length and concurrency are bounded.
Failures become structured results so one task cannot take down the orchestration loop.

### `profiler.ts`

The hierarchical profiler records inclusive and self time.
Nodes are sorted deterministically when producing a report.
The profiler can be fully disabled without changing caller control flow.

### `metrics.ts`

`evaluateBudget` converts raw subsystem timings into one health state.
Recommendations are generated from explicit budget thresholds.
`RollingBudgetMetrics` makes performance regressions visible over a stable time window.

### `stateMachine.ts`

State definitions explicitly declare permitted transitions.
Lifecycle phases protect start, update, and stop sequencing.
This is useful for world streaming, UI flows, combat modes, and boot orchestration.

### `replay.ts`

Replay frames contain input commands and optional state checksums.
A replay log has a stable version and a deterministic checksum.
Verification stops at the first mismatching frame and reports the associated tick.

### `security.ts`

Untrusted payloads are bounded by depth, array size, string size, and serialized byte count.
Identifiers can be checked against a strict allowlist pattern.
Rate limiting is keyed by actor or session.
Snapshot age and future-tick limits prevent stale or speculative state from flowing into gameplay.

### `runtime.ts`

`NextRuntime` is the integration façade.
It owns the scheduler, entity world, input buffer, resource cache, spatial index, telemetry, rate limiter, and adaptive render budget.
It also provides a small set of integration operations without requiring callers to know the implementation details of each subsystem.

## Adoption strategy

The next runtime should be integrated from the outside in.

1. Boot the façade without changing the legacy renderer.
2. Feed normalized input into the command buffer.
3. Use the fixed-step scheduler for new deterministic gameplay systems.
4. Mirror selected entities into the spatial grid.
5. Use next-generation snapshot deltas for future network boundaries.
6. Move non-critical terrain and content work behind the worker protocol.
7. Introduce the camera and animation solvers behind adapter layers.
8. Replace legacy implementations only when the corresponding tests and telemetry are stable.

## Determinism rules

Do not use `Math.random()` in simulation code.
Do not use `Date.now()` for gameplay decisions.
Do not sort by object identity or insertion order when the result affects authoritative state.
Always quantize values crossing a network or replay boundary.
Use branded tick values at public interfaces.
Prefer integer sequence numbers for ordering.
Use stable checksums for replay and save verification.

## Performance rules

Every loop over dynamic entities must have an explicit ownership boundary.
Every cache must have a finite byte or entry budget.
Every worker queue must have a finite capacity.
Every network envelope must have a maximum size.
Every fixed-step loop must have a maximum step count.
Every expensive subsystem should expose enough telemetry to identify its budget contribution.

## Security rules

Validate data before inserting it into world state.
Treat network input as hostile until checked.
Never evaluate strings as code.
Keep text identifiers on a strict allowlist.
Do not allow unbounded recursive objects through serialization boundaries.
Reject stale and future snapshots.
Prefer fail-closed behavior for protocol mismatches.

## Testing rules

Determinism tests must compare entire generated sequences, not a single sample.
ECS tests must cover lifecycle and query behavior.
Network tests must cover duplicate, stale, and mismatched data.
Save tests must cover migration and checksum failure.
Worker tests must cover success, failure, and queue limits.
Render tests must cover sustained pressure and sustained headroom.
Gameplay tests must cover boundary values such as zero health, zero stamina, zero poise, and empty targets.

## Browser integration boundary

The next layer should not import Three.js directly.
Renderer adapters may read the pure state produced by the next runtime.
Browser-only APIs such as `window`, `document`, and WebGL contexts belong in thin edge adapters.
This keeps the new core runnable in Node-based tests and future worker contexts.

## Server compatibility

The deterministic math and serialization modules are designed to be portable to an authoritative server.
The server can reconstruct a world state from seed, input commands, and persisted state without recreating browser presentation objects.
The same snapshot and replay checksums can then be compared across environments.

## Failure handling

A failed optional content load must not invalidate the entire world state.
A worker task error must become an observable structured failure.
A malformed network envelope must be rejected without mutating world state.
A replay checksum mismatch must stop verification rather than silently continuing.
A save migration failure must leave the previous save slot untouched.

## Future integration points

- Three.js render adapter for `RenderBudgetState`.
- Web Worker implementation of `WorkerTask` and `WorkerResult`.
- IndexedDB adapter for `SaveSlotStore`.
- WebSocket or WebTransport adapter for `NetworkProtocolV2`.
- Animation mixer adapter for the layered animation model.
- Navigation mesh adapter that implements the same graph contract.
- Audio node adapter for the bus and virtualization model.
- Server-side authoritative runtime using the deterministic modules without browser dependencies.

## Completion criteria for this layer

The architecture is considered integrated when new gameplay systems use the next runtime contracts instead of introducing parallel state representations.
The legacy bridge should then become an adapter rather than the long-term source of truth.
The public modern index already exports the next layer so adoption can happen module by module.
