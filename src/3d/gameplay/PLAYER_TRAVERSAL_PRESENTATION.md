# Player traversal presentation state

## Purpose

This layer turns traversal cues into presentation intent for animation, audio, VFX, replay, telemetry and debugging.
It deliberately does not move the player, perform collision queries, own physics, pick navigation routes, mutate bones,
or manage animation mixers.

## State vocabulary

`clear` means there is no active traversal cue. `approach` is predictive awareness of an obstacle that is still far
from commitment distance. `prepare` means the cue is close enough to stage a transition. `vault` represents a horizontal
obstacle crossing. `climb` represents a positive-height traversal execution. `drop` represents negative-height traversal.
`land` is a contact event with meaningful impact. `blocked` means the caller has positively identified that traversal
cannot currently proceed. `recover` is a caller-visible recovery phase after an interrupted airborne traversal. `cancelled`
is terminal for the current traversal intent and returns to `clear` when the caller clears the request.

## Precedence

Cancellation wins over every other cue because it is an explicit gameplay decision. A positive blocked cue wins over a
predictive approach cue because presenting a committed traversal while a system has already declared it blocked creates
misleading animation and audio. Airborne height semantics are considered after cancellation and blocked state. Landing
impact is evaluated before regular grounded distance selection, so a landing beat is not swallowed by a coincidental
nearby obstacle cue.

## Input normalization

Distances are clamped to the maximum traversal envelope. Weight, surface confidence, contact confidence and traversal
confidence are normalized to `[0,1]`. Speeds are clamped to the player presentation range. Negative distances become zero.
Malformed strings and non-finite values resolve to documented fallbacks rather than propagating `NaN` into consumers.

## Timeline model

The timeline layer models presentation timing only. A caller may submit its own clock. This means deterministic replays
can re-feed exactly the same cue sequence without depending on wall-clock APIs. Timeline entries preserve the selected
state, phase, event, progress, confidence and relevant normalized metrics.

The phase vocabulary is intentionally compact:

- `idle`: no traversal presentation active.
- `anticipation`: the system is informing consumers that traversal is becoming relevant.
- `commit`: the traversal technique has been selected and should be visually staged.
- `execution`: the selected traversal is actively represented.
- `contact`: a landing/contact beat is active.
- `recovery`: the presentation is settling after interruption or contact.
- `terminal`: a blocked/cancelled state is not executing movement.

## Consumer contract

Animation receives state, phase, technique, anticipation, commitment, contact and impact channels. Audio receives the
transition cue and an intensity that combines impact and commitment. VFX receives event/state plus traversal/contact /
impact weights. Legacy adapters receive a boolean active signal plus blocked/airborne/landing flags.

No consumer should infer traversal intent from raw distance or height after this layer exists. Doing so would recreate
multiple competing state machines and make tuning unpredictable.

## Runtime

`createPlayerTraversalPresentationRuntime()` keeps the current state, explicit presentation clock, bounded history and
aggregate counters. It exposes `tick`, `consume`, `reset`, `hydrate`, `seek`, `current`, `metrics`, `snapshot`, and
`historyEntries`. The runtime never reads `Date.now()`, `performance.now()`, `Math.random()`, player transforms or
physics globals.

## Replay

Replay records capture the normalized cue plus presentation state, phase, event and confidence. Replaying the same
records twice must produce equivalent serialized outputs and an equivalent final state. Replay therefore acts as a
regression oracle for future refactors of thresholds or consumer bridges.

## Telemetry

Telemetry counts state/event occurrence and aggregates channel means. Risk flags cover low confidence, blocked-heavy,
hard-landing-heavy and cancellation-heavy sequences. Telemetry is passive; it does not transmit data or write a save.

## Quality

Quality combines confidence, continuity and progress. The score is intentionally advisory rather than a gameplay gate.
A low score is useful for development diagnostics and automated review of traversal fixture changes.

## Transition safety

The transition policy enumerates allowed semantic transitions. Invalid transitions can be rejected by an adapter without
silently inventing a new gameplay state. This is especially useful when a future animation consumer receives a packet from
a stale branch or when two asynchronous sources disagree about the current phase.

## Extension rules

New traversal techniques should add explicit states or techniques with fixture coverage. Do not overload `vault` merely
because a new technique looks visually similar. New channels should be added to the consumer contract and the validation
surface at the same time. Any new time-dependent behavior must accept an explicit elapsed/clock value so replay remains
stable.

## Ownership boundaries

Traversal detection belongs to a caller that understands world geometry. This layer consumes that result. Physics remains
the authority for movement and contact response. Input remains the authority for intent. Navigation remains the authority
for routes. Animation remains the authority for blending and mixer scheduling. This layer is the translation boundary
between those systems and presentation consumers.

## Test strategy

The fixture corpus covers clear/approach/prepare/vault/climb/drop/land/blocked/cancelled states, boundary thresholds,
malformed values, confidence extremes, impact extremes, airborne semantics, direction changes, labels and reset/recovery
sequences. Scenario tests additionally cover multi-tick sequences, and adversarial tests cover hostile numeric input.

## Determinism requirements

Every exported helper must produce the same result for the same arguments. Avoid non-deterministic collection iteration
where the result could affect serialized replay output. Sorting of risk rows and stable object key construction are part of
the contract. Use caller-provided clocks, not ambient time.

## Review checklist

Before changing thresholds, update fixture expectations when behavior is intentionally changed. Add at least one boundary
fixture around every threshold. Preserve immutability of returned objects. Keep production modules free of renderer imports.
Verify that a blocked cue cannot emit a commitment channel above the documented safe value. Verify cancellation wins over
blocked and landing cues. Verify the final state remains replay-stable after hydration.

## Example pipeline

`raw geometry cue -> normalize -> resolve state -> resolve phase/event -> build presentation -> contract -> consumer bridge`

A runtime can wrap the pipeline as:

`caller tick -> runtime.tick(cue) -> presentation state + consumer packet -> renderer/audio/VFX consumers`

A replay can wrap the same pipeline as:

`recorded cues -> replayTraversalRecords -> deterministic outputs -> regression comparison`

## Operational note

The presentation state is not itself permission to execute traversal. It is an observation-oriented intent packet. Gameplay
systems remain responsible for deciding whether the action actually occurs.
