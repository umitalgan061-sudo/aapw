# Living World Reaction Ledger Contract

Status: active
Date: 2026-09-08
Scope: Şafak Kartalı living-world AI / NPC / factions / fauna reaction lane

## Purpose

The reaction runtime produces bounded per-actor decisions. The reaction ledger converts those decisions into a short-lived, deterministic read model. The projection layer turns that model into queryable views for UI and event adapters.

The design is intentionally additive. It does not replace the existing actor registry, controller, perception provider, navigation owner, combat owner, faction service, law service, ecology system, world-event system, scene graph, asset loader, material pipeline, or persistence layer.

## Ownership graph

1. ActorRegistry remains authoritative for actor membership.
2. Existing perception services remain authoritative for sensed signals.
3. Existing faction/reputation/diplomacy/law services remain authoritative for relationships.
4. `livingWorldReactionRuntime` remains authoritative for reaction-state decisions and delegation requests.
5. `livingWorldReactionLedger` owns only bounded projection retention, dedupe and lifecycle state.
6. `livingWorldReactionProjection` owns only stateless selectors, summaries and comparison helpers.
7. UI, telemetry and downstream event adapters own delivery and presentation.

No layer below the ledger delegates upward into the ledger to regain ownership.

## Runtime boundary

The runtime may produce these phases:

- patrol
- detect
- investigate
- chase
- attack
- return
- flee

The ledger does not add phases. Unknown phases are normalized to `patrol` at its input boundary.

The runtime may produce these LOD values:

- near
- distant
- far
- culled

The ledger and projection layers do not invent additional LOD states.

## Queue contract

The ledger policy has the following hard ceilings:

| Field | Value | Meaning |
| --- | ---: | --- |
| `maxQueueEntries` | 96 | Maximum retained event entries |
| `maxEventsPerActor` | 6 | Maximum retained event pressure per actor |
| `dedupeTtlSeconds` | 2.5 | Suppression window for equivalent event keys |
| `maxAgeSeconds` | 30 | Maximum retained event age |
| `maxActors` | 128 | Maximum actor projection count |
| `maxHistoryPerActor` | 8 | Runtime-history entries retained per reaction |

These values are deliberately smaller than a theoretical world population. They are a presentation/adapter budget rather than a simulation population budget.

## Event contract

The ledger recognizes three event types:

### reaction

A non-patrol or reportable/hostile actor reaction. This is the normal read-model representation for investigation, pursuit, return, flee and detection states.

### combat-intent

An attack-phase reaction. It describes the existence of an owner-controlled combat intent but never contains combat damage or combat ownership state.

### transition

Causal phase movement observed from runtime history or, when no matching history is present, an explicitly marked projection-observed change.

## Identity contract

Every event uses a stable actor identity.

Actor identity is never derived from array position inside the projection layer. It is consumed from `actorId`.

Target identity is a string or empty string.

The sequence number is transport metadata. It can change with source insertion order and therefore is not part of the canonical projection digest.

## Digest contract

The digest is a compact, deterministic hexadecimal token.

The canonical projection digest intentionally ignores transport-only sequence values.

The digest includes semantically meaningful fields such as:

- actor identity
- current phase
- target identity
- LOD
- relation
- wanted pressure
- reportable state
- directive kind
- event clock
- event key

A presentation adapter may compare canonical digests without assuming identical queue insertion order.

## Normalization contract

Normalization is fail-closed.

Unknown or malformed values use explicit safe defaults.

### Clocks

- negative clocks become zero;
- non-finite clocks become zero at the normalization boundary;
- ledger-level clock movement is monotonic;
- a stale caller tick never moves the ledger clock backwards.

### Relationship fields

- reputation is constrained to `[-100, 100]`;
- wanted is constrained to `[0, 100]`;
- crime severity is constrained to `[0, 100]`;
- relation labels are limited to friendly, neutral and hostile.

### Positions

Only finite `x` and `z` values are accepted for projection destinations. Invalid coordinates become null.

### Private owner responses

Navigation, combat, law and world-event owner calls are compacted to acceptance/invocation facts. Private payloads are never projected by the ledger.

## Lifecycle contract

The ledger exposes only:

- `ingest`
- `drain`
- `snapshot`
- `audit`
- `reset`
- `dispose`
- `disposed`

There is no `publish`, `emit` or `dispatch` method.

This is deliberate. The ledger is a bounded state projection and not an EventBus.

## Ingest sequence

1. Reject the tick when the caller marks it unaccepted.
2. Normalize the tick wrapper and reaction records.
3. Purge stale dedupe keys.
4. Purge events older than the age budget.
5. Compare each normalized reaction with the existing actor projection.
6. Generate observable reaction events for non-patrol, hostile or reportable states.
7. Generate runtime-history transition evidence when available.
8. Apply event dedupe.
9. Apply the per-actor event budget.
10. Append accepted events to the queue.
11. Apply the global queue budget.
12. Record immutable actor projections.
13. Return an immutable ingestion result and snapshot.

## Dedupe contract

A dedupe key is scoped to the semantic identity of the reaction.

Different actors do not collide.

Different targets do not collide.

Different phases do not collide.

Different LOD states do not collide.

Different runtime evidence digests do not collide.

Equivalent events inside the TTL are suppressed rather than repeatedly queued.

After the TTL expires, equivalent events can become observable again.

## Retention contract

Queue retention is time-bounded and count-bounded.

The age purge uses the ledger's monotonic clock.

The global queue cap retains the newest bounded window.

The per-actor budget prevents a single noisy actor from occupying the entire queue.

Dropped entries are accounted for in the snapshot counters.

## Snapshot contract

A snapshot contains:

- policy id
- accepted tick count
- rejected tick count
- projected event count
- dropped event count
- duplicate event count
- queued event count
- tracked actor count
- monotonic clock
- actor projection list
- queue projection list
- deterministic snapshot digest

Snapshot arrays and entries are frozen.

Consumers must treat snapshots as read-only.

## Actor projection contract

An actor projection contains only adapter-safe information:

- actor id
- phase
- target id
- LOD
- normalized relation
- directive kind
- signal-present flag
- cached signal count
- phase elapsed time
- observation clock
- previous phase
- changed flag
- compact digest

It does not contain a scene object, controller reference, navigation handle, combat handle, mesh reference or mutable service instance.

## Event field matrix

| Field | reaction | combat-intent | transition | Owner payload? |
| --- | --- | --- | --- | --- |
| actorId | yes | yes | yes | no |
| targetId | yes | yes | yes | no |
| phase | yes | yes | yes | no |
| LOD | yes | yes | yes | no |
| relation | yes | yes | yes | no |
| wanted | yes | yes | yes | no |
| crimeSeverity | yes | yes | yes | no |
| reportable | yes | yes | yes | no |
| directive kind | compact | compact | compact | no |
| directive destination | bounded | bounded | bounded | no |
| sequence | yes | yes | yes | transport only |
| key | yes | yes | yes | no |
| private service result | no | no | no | prohibited |

## Projection query surface

The stateless projection module provides queries for:

- actor listing
- event listing
- actor lookup
- target event lookup
- active actors
- reportable events
- combat intents
- transitions
- phase-change actors
- actor cards
- target cards
- hotspots
- event priorities
- relation buckets
- LOD buckets
- phase buckets
- canonical digests
- snapshot comparison
- bounded UI selection
- projection audits

These queries never mutate the ledger snapshot.

## UI selection budget

UI selection is intentionally smaller than the ledger retention budget.

Default selection limits are bounded to the most actionable actors/events.

A UI adapter should not assume that a list contains every world actor. It is a prioritized projection, not authoritative population state.

## Priority guidance

Combat intents are considered more urgent than transition evidence.

Transition evidence is considered more urgent than generic reaction evidence.

Within equal semantic priority, stable actor and target identities are used for deterministic ordering.

This ordering is presentation-oriented and must not be interpreted as combat initiative.

## Failure policy

The system favors observable degradation over exceptions for optional owner services.

Malformed perception data becomes normalized safe data.

Malformed owner-response payloads are not propagated.

Rejected runtime ticks increment a rejected counter without creating actor state.

Disposed ledgers reject ingestion.

Reset clears queue, actor state, dedupe memory and counters.

## Audit policy

Both the ledger and projection layer expose audits.

The audit checks:

- actor count ceilings
- queue/event ceilings
- valid phase vocabulary
- valid LOD vocabulary
- valid relation vocabulary
- valid signal counts
- finite clocks
- duplicate actor identities in projection snapshots
- valid event types

Audits are read-only and deterministic.

## Deterministic replay

A replay harness may execute the same normalized input twice and compare:

1. event key lists
2. canonical projection digests
3. sorted actor identities
4. normalized relation values
5. queue content after stripping transport-only sequence metadata

Replay equality is semantic equality, not incidental array insertion equality.

## Long-frame behavior

A long frame must not expand the ledger indefinitely.

The following controls work together:

- runtime max delta
- runtime LOD tick throttling
- runtime signal/cache limits
- ledger actor cap
- ledger per-actor event cap
- ledger queue cap
- ledger max-age purge
- ledger dedupe TTL
- UI selection cap

The ledger therefore acts as a pressure boundary between simulation output and higher-frequency presentation consumers.

## Ownership prohibitions

The following are explicitly prohibited in these modules:

- importing THREE for scene work
- owning actor spawn/despawn
- creating an ActorRegistry
- changing controller state
- directly moving actors
- directly calculating navigation paths
- starting combat
- applying damage
- writing persistence records
- loading models
- editing materials
- attaching scene objects
- emitting global EventBus messages
- replacing faction/reputation/law authorities

## Integration checklist

Before integrating a new consumer:

1. Confirm the consumer reads snapshots or drained events.
2. Confirm no consumer mutates snapshot fields.
3. Confirm no consumer assumes sequence equality across separate replays.
4. Confirm no consumer treats projection counts as population truth.
5. Confirm combat consumers still call the existing combat owner.
6. Confirm navigation consumers still call the existing navigation owner.
7. Confirm law consumers still use the existing law authority.
8. Confirm UI consumers use bounded selection APIs.
9. Confirm audits are run in development/validation paths.
10. Confirm the runtime remains the decision authority.

## Validation matrix

| Validation | Expected result |
| --- | --- |
| null tick | rejected, no events |
| malformed actor | filtered |
| invalid phase | safe default |
| invalid LOD | safe default |
| invalid relation | neutral default |
| non-finite destination | null |
| oversized history | newest bounded window |
| oversized actor list | 128 ceiling |
| duplicate event inside TTL | suppressed |
| duplicate event after TTL | observable again |
| noisy actor | per-actor cap |
| many noisy actors | global cap |
| stale event | aged out |
| stale clock | monotonic ledger clock |
| disposed ledger | ingestion rejected |
| reset ledger | fresh state |
| private owner response | omitted |
| sequence reorder | canonical digest stable |
| projection reorder | semantic comparison stable |
| long-frame replay | bounded and auditable |

## Why a ledger instead of another event framework?

The existing runtime already knows when a reaction happens. Repeating that decision in another framework would create two authorities and produce divergent state.

The ledger solves a narrower problem: keeping a small, deterministic and auditable bridge between a simulation tick and consumers that need to inspect what happened.

The projection layer solves a similarly narrow problem: selecting what those consumers should see.

This preserves one decision authority and keeps adapter pressure bounded.

## Operational guidance

Treat the policy constants as explicit contracts.

Changes to caps should be accompanied by executable contract updates.

Changes to event identity should be accompanied by digest/replay tests.

Changes to ownership boundaries should be accompanied by source scans.

Changes to actor or target identity rules should be accompanied by deterministic ordering tests.

Changes to UI selection limits should not change runtime simulation limits.

## Versioning

Ledger policy id: `living-world-reaction-ledger-2026-09-08-v1`

Projection policy id: `living-world-reaction-projection-2026-09-08-v1`

A breaking change to normalized event shape, phase vocabulary, identity semantics or digest semantics should increment the policy version.

A purely internal refactor that preserves the public contract should not increment the version.

## Final invariant

The living-world reaction lane remains one-directional:

`existing world owners -> reaction runtime -> bounded ledger -> stateless projection -> consumer`

No downstream consumer becomes a competing authority.
