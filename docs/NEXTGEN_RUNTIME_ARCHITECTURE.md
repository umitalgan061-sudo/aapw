# AAPW NextGen Runtime Architecture

## Purpose

The NextGen layer is the TypeScript-first ownership boundary for deterministic simulation, gameplay, networking, rendering, persistence, streaming, telemetry and legacy integration. It is intentionally additive: existing game authorities can migrate subsystem by subsystem without requiring a flag-day rewrite.

## Runtime flow

```text
input -> validation -> fixed-step clock -> command/event buses
                                  |
                                  v
                 ECS + gameplay + AI + world + navigation
                    |                 |             |
                    v                 v             v
                 snapshots       streaming      render plan
                    |
                    v
             prediction/reconcile
                    |
                    v
              save + telemetry
```

## Determinism

Simulation time advances through `DeterministicClock`. Replays use recorded commands and stable hashing rather than wall-clock values. Procedural world generation is seeded. Entity queries and network snapshots use deterministic ordering.

## Performance

Runtime budgets are device-tiered. `FrameScheduler` skips low-priority work when a lane is saturated, while `AdaptiveBudgetController` adjusts bounded targets from observed frame pressure. Streaming is predictive and bounded by concurrency and resident-memory budgets. Rendering is submitted through a pass-aware graph with culling, LOD and draw-call governance.

## Networking

Snapshots are sorted and checksummed. Deltas describe additions, removals and changed state. Remote entities are interpolated from a bounded buffer. Client prediction is isolated from authoritative reconciliation so transport decisions do not leak into gameplay state.

## Persistence

Save documents contain a versioned header and integrity checksum. Migrations are explicit one-step transformations. This makes schema upgrades observable and prevents silent downgrade behavior.

## Security

Untrusted payloads are bounded by depth, string, array, object and byte limits. Commands use token-bucket rate limiting. Identifiers are normalized and unsafe dynamic execution primitives are not required by the NextGen runtime.

## Legacy migration

`LegacyBridge` translates common legacy input/entity shapes into typed contracts. The bridge is intentionally narrow: it adapts data and does not duplicate gameplay logic. New features should target the NextGen contracts directly.

## Testing strategy

The regression suite focuses on deterministic outputs, lifecycle boundaries, memory limits, rate limits, navigation, AI budgets, save integrity, rendering budgets and compatibility behavior. Tests should prefer pure deterministic helpers for simulation rules and explicit seams for browser APIs.

## Ownership rule

When a legacy subsystem is migrated, the typed NextGen contract becomes the source of truth. Compatibility adapters remain at the boundary and must not become a second gameplay implementation.
