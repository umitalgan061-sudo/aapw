# AAPW Modern Runtime R40

R40 is the next TypeScript-first engine boundary for the browser game. It is additive: existing scene owners can continue to run while the new kernel takes ownership of deterministic scheduling, security, state, streaming and cross-system contracts.

## Production goals

- Deterministic fixed-step simulation with stable sorting, seeded random streams, quantized input and explicit revisions.
- Hard budgets for tasks, world queries, asset queues, AI perception, telemetry and rollback history.
- Strict TypeScript ownership for the new engine surface.
- Versioned, digest-protected assets, save envelopes, snapshots and network packets.
- Adaptive rendering with GPU/CPU/memory pressure feedback.
- First-class metrics, trace spans, health signals and migration evidence.

## Architecture

The dependency direction is:

platform -> engine -> domain services -> presentation adapter

The engine owns the clock and phase lifecycle. Domain services own bounded state. The presentation layer consumes immutable results.

### Core modules

| Module | Responsibility |
| --- | --- |
| types.ts | Branded IDs and immutable cross-system contracts |
| deterministic.ts | Hashing, stable serialization, seeded RNG, fixed clock and math |
| scheduler.ts | Lane/phase work budgeting and deterministic execution |
| world.ts | Spatial index, LOD state, revisioned deltas and stimulus memory |
| render.ts | Frame graph, GPU lifecycle and adaptive quality |
| streaming.ts | Asset catalog, residency, retries and eviction |
| network.ts | Sequence windows, command validation and prediction |
| protocol.ts | Versioned wire representation and packet digest |
| ai.ts | Utility scoring, perception and decaying memory |
| audio.ts | Voice selection, distance/occlusion gain and accessibility |
| save.ts | Transaction journal and bounded replay |
| security.ts | Payload, URL and command validation |
| ecs.ts | Entity/component/system ownership |
| runtimeGraph.ts | Bounded state patches and source attribution |
| recovery.ts | Coordinated subsystem recovery |
| sceneBridge.ts | Presentation adapter boundary |
| snapshotReplication.ts | Authoritative snapshots and bounded delta frames |

## Fixed-step contract

Frame deltas are clamped before ticks are produced and catch-up work is capped. A rendering spike therefore cannot create an unbounded simulation burst.

The clock is the source of truth for Tick. Systems receive a deterministic tick and fixed delta; wall-clock values belong only to telemetry and save metadata.

## State ownership

Cross-system mutations should enter through RuntimeStateGraph or an owning domain service. Every patch records path, source, tick and a deterministic digest.

Snapshots are detached from internal mutable state and can be rolled back.

## Security boundary

R40 checks serialized payload size, nesting depth, key count, array length, string length, URL protocol/credential rules and command-type syntax.

This is a browser resilience boundary, not a replacement for server-side authorization.

## World scaling

The world index divides space into deterministic cells. Radius queries touch a bounded set of cells and then apply exact distance checks. LOD states are selected from distance and weighted interest.

Large populations therefore degrade toward lower simulation frequency rather than monopolizing a frame.

## Rendering

FrameGraph provides resource/pass contracts. Optional passes may be dropped when the GPU cap is exceeded; required passes remain selectable.

RenderQualityGovernor uses hysteresis. Sustained pressure lowers quality, sustained healthy frames permit recovery, and extreme pressure can trigger an emergency multi-tier reduction.

## Streaming

Every asset request passes through a catalog. Queue depth and concurrency are capped. Failures use deterministic backoff. Resident assets are evicted by last-use order only when they are no longer referenced.

## Network and replay

Input commands are sequence-numbered. Prediction history is bounded. Authoritative state can be blended back into local state or used to trigger rollback.

Snapshots and deltas carry digests; stale revisions are rejected.

## Audio

R40 is a deterministic audio planning layer for distance attenuation, occlusion, bus gain, priority selection and accessibility assistance. The Web Audio graph remains a presentation concern.

## AI

Utility scoring is deterministic for a given input snapshot. Perception is range-bounded and confidence-weighted. Memory values decay with a configured half-life.

## Recovery

Recovery progresses through:

diagnose -> quiesce -> reset -> replay -> resume -> complete

Attempts are rate-limited. Repeated failure enters blocked state rather than creating a recovery storm.

## Editor

RuntimeEditorBridge exposes typed transform, tag, delete, duplicate and undo/redo boundaries. The editor can validate against headless entities without constructing a Three.js scene.

## TypeScript migration

The repository still contains a large historical JavaScript surface, so a safe migration cannot honestly be represented by a blind rename of every file.

R40 establishes a clean typed owner for new engine behavior. The dedicated R40 tsconfig disables JavaScript inclusion so this boundary cannot silently depend on untyped JS through implicit inclusion.

Future conversion should proceed by ownership waves: entry/runtime, input/player, world/creatures/navigation, render/editor, audio/UI, offline tooling and finally remaining compatibility surfaces.

## Release gates

Run:

npm run verify:r40
npm run typecheck:r40
npm run test:r40

The CI workflow checks the exact event SHA. A green R40 gate therefore validates the code that the pull request actually proposes rather than a moving branch tip.

## Evidence model

Every major R40 service exposes a digest or deterministic snapshot path. CI can archive these digests with a build identifier later.

Performance should be evaluated with rolling averages and p95 telemetry across frame time, CPU, GPU, draw calls, triangles, memory and queue depth.

## Failure policy

Security boundaries fail closed. Optional presentation work fails soft. The runtime preserves the last known valid state instead of inventing replacement data.

## Ownership principle

R40 is a platform, not a second implementation of the game. A feature should have one canonical owner. Compatibility adapters bridge legacy modules only until typed parity evidence exists.

## Completion definition

Production readiness requires green strict typecheck, deterministic tests, adversarial bounds, integration tests, build verification, typed ownership at the runtime entrypoint and explicit migration status for remaining legacy surfaces.

This document records the boundary and evidence model; it does not claim that every historical JavaScript module has already been deleted.
