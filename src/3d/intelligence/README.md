# Next-generation World Intelligence

`worldIntelligence.ts` adds a deterministic, bounded simulation-intelligence layer to AAPW.

## Capabilities

- Utility-style goal scoring for survive, investigate, patrol, hunt, gather, protect, flee, assist, rest, travel and idle behavior.
- Confidence-weighted perception for visual, acoustic, damage, death, movement, interaction, resource, weather and faction stimuli.
- Per-actor blackboard state with stale-write rejection, expiry and immutable snapshots.
- Bounded memory ledger with deterministic ordering and confidence half-life decay.
- Event journal with identifier deduplication, retention pruning and bounded storage.
- Interest-point ranking with distance/importance scoring, stable ordering and hard candidate limits.
- Deterministic RNG access through the existing AAPW RNG implementation.
- Fixed-cost orchestration with explicit actor, stimulus, memory, goal, event and interest budgets.
- Snapshot and metrics output suitable for replay, telemetry and CI regression checking.
- Fail-closed disposal semantics.

## Integration contract

The layer consumes immutable snapshots and returns immutable intent/interest/memory receipts. It does not mutate the player state machine, combat state, animation mixer, physics bodies, renderer, scene graph, asset lifecycle or device APIs.

## Production guarantees

All hot-path collections are bounded. All ranking has deterministic tie-breakers. Numeric inputs are clamped or rejected at boundaries. Duplicate events do not accumulate. Old memories decay and are removed. Disposed instances stop producing work.

The module can therefore run in browser, mobile-PWA and headless validation environments while remaining independent from browser-only APIs.
