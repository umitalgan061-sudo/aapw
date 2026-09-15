# Player Animation Temporal Policy

## Scope

`playerAnimationTemporalPolicy.js` is a presentation-only temporal layer for the existing player animation stack.

It does not own movement state, combat state, collision, equipment, actor registration, terrain, material assignment, model placement, scene lifecycle, or animation asset loading.

The semantic/action owner remains `playerAnimationDirector.js`.

The temporal policy adds five production concerns that were previously spread across callers or left implicit:

1. fixed-step presentation normalization with a bounded catch-up budget;
2. sprint hysteresis preservation across speed-noise frames;
3. footstep phase derivation and surface-aware signal gating;
4. bounded action-transition and surface-change signals;
5. deterministic read models and fingerprints for regression and observability.

## Ownership contract

The module consumes already-known player presentation inputs.

The caller remains responsible for deciding whether the player is moving, attacking, guarding, dodging, staggered, grounded, or changing equipment.

The temporal layer does not mutate those source systems.

The layer can emit presentation signals through an injected callback. No global event bus is imported or created.

The implementation intentionally avoids model or asset construction. Any action selection is delegated to the existing animation director.

## Fixed-step behavior

External callers can pass a variable frame delta.

The controller clamps the accumulated catch-up time to `0.24` seconds and processes at most four `0.1` second presentation steps per update.

This prevents a stalled tab or a long frame from producing an unbounded presentation loop.

The policy does not attempt to recover game simulation time. It only keeps presentation state bounded.

## Sprint hysteresis

Sprint entry uses `5.6 m/s`.

Once already sprinting, the presentation state remains sprint until speed falls below `5.1 m/s` unless a higher-priority combat state is active.

This produces a stable 0.5 m/s hysteresis band.

The policy does not decide whether sprint is mechanically allowed; `runIntent` is treated as input to the presentation resolver.

## Temporal phase

Locomotion phase is normalized to the closed-open interval `[0, 1)`.

Stride time is derived from canonical speed and an injected stride distance.

Sprint uses a bounded stride scale so faster movement does not collapse the phase into excessive stepping.

Phase is reset to zero for idle presentation.

A phase wrap is deterministic and independent of wall-clock time.

## Footstep signals

The default gait windows are:

- left foot at phase `0.08`;
- right foot at phase `0.58`.

Signals are gated when:

- semantic state is not locomotion or sprint;
- surface confidence is below `0.2`;
- the surface is explicitly muted.

The emitted payload includes the resolved surface material key, confidence, intensity, phase and presentation timestamp.

The signal is descriptive. It does not spawn an audio asset or decal by itself.

## Surface response

The normalized surface model carries:

- `materialKey`;
- `confidence`;
- `slip`;
- `muted`;
- optional source metadata.

Higher slip reduces footstep playback scale.

Lower confidence suppresses presentation effects rather than guessing a material.

This is intentionally fail-soft: missing surface information remains a valid generic presentation state.

## Combat transition signals

The policy recognizes the existing semantic combat states:

- light attack;
- heavy attack;
- dodge;
- hit stagger.

On semantic entry it emits `action-start`.

On exit it emits `action-end`.

Combat semantics have priority over locomotion semantics because the existing transition resolver remains authoritative.

The temporal layer does not invent additional combat states.

## Signal budget

Presentation signals are ordered by impact:

1. warnings;
2. semantic transitions;
3. action starts;
4. action ends;
5. footsteps;
6. surface changes.

The default per-update signal budget is eight.

Ordering is stable for equal priority. This matters for deterministic replay and snapshot comparison.

## Deterministic fingerprints

Snapshots are reduced to semantic state, previous state, phase, playback rate, footstep count, normalized surface and transition reason.

The fingerprint is a small FNV-1a-style deterministic digest over the canonical JSON representation.

The digest is not a security hash and must not be used as an identity key.

Its purpose is repeatability checking and low-cost observability.

## Read model

`createPlayerAnimationTemporalReadModel()` returns a presentation-only object for HUD/debug or validation callers.

The read model exposes no mutable internal ring buffers.

The history and signal arrays returned by the controller are copies.

This keeps debugging from accidentally mutating presentation state.

## Bounds

The policy clamps:

- frame delta;
- catch-up time;
- playback rate;
- phase scale;
- stride distance;
- sprint stride scale;
- surface confidence;
- surface slip;
- history size.

The validation function checks the state invariants after every controller update.

An invalid state fails loudly instead of silently continuing with corrupted presentation state.

## Caller integration sketch

```js
import { createPlayerAnimationTemporalController } from './playerAnimationTemporalPolicy.js';

const controller = createPlayerAnimationTemporalController({
  emitSignal: (signal) => presentationEffects.accept(signal),
});

const result = controller.update(deltaSeconds, {
  planarSpeedMps,
  runIntent,
  attackKind,
  guarding,
  dodgeRemaining,
  hitStaggerRemaining,
  surface: {
    materialKey,
    confidence,
    slip,
  },
});

presentationHud.update(result.snapshot);
```

The caller still owns the source values. The controller does not reach into player state.

## Failure behavior

Malformed numeric input is normalized to safe finite values.

Unknown semantic input falls back to `idle`.

Unknown surface material falls back to `generic`.

Low-confidence surfaces suppress optional footstep signals instead of inventing a confident result.

Large frame deltas are clamped instead of being replayed without limit.

## Regression expectations

The dedicated regression script validates:

- initial state invariants;
- malformed input normalization;
- sprint enter/hold/exit hysteresis;
- combat priority;
- transition reasons;
- rate and stride bounds;
- phase advancement;
- transition, action and surface signals;
- deterministic footstep output;
- muted and low-confidence surface gating;
- signal priority and stable ordering;
- catch-up budgets;
- bounded history;
- fingerprint sensitivity and repeatability;
- controller reset behavior;
- ownership-oriented contract checks.

The test is executable with plain Node and does not require a browser, renderer or model asset.

## CI contract

The dedicated workflow checks out the pull-request head explicitly.

It verifies that the checked-out commit exactly matches the PR head.

It verifies that the feature branch is based directly on current `main`.

It performs Node syntax checks for the production and regression files.

It executes the regression script twice and compares the output.

It performs a diff budget check for the temporal-policy slice.

It scans the new production file for forbidden runtime ownership imports.

## Performance posture

The controller performs bounded arithmetic, short object allocations and fixed-size history writes.

No asynchronous work is scheduled.

No timers are created.

No renderer traversal is performed.

No scene graph search is performed.

The temporal layer therefore remains suitable for per-frame invocation by an existing presentation caller.

## Extension rules

Future work in this layer should prefer pure functions and injected callbacks.

Do not add:

- a second player state machine;
- a second combat system;
- a global event bus;
- direct model placement;
- direct Three.js construction;
- asset downloading;
- terrain or collider queries;
- persistence of canonical game state.

New signals should remain descriptive and bounded.

New semantic states must first be defined by the existing action/animation authority rather than added here opportunistically.

## Acceptance checklist

A change is complete when:

- syntax passes;
- the focused regression passes;
- two identical runs produce byte-identical stdout;
- snapshot fingerprints remain deterministic;
- state validation remains green;
- the signal budget remains bounded;
- the history remains bounded;
- the exact PR head is the commit under test;
- current `main` is the direct ancestry base;
- no forbidden ownership import is introduced.

This document is intentionally implementation-facing. It records the contract that keeps the animation presentation layer additive rather than architectural duplication.
