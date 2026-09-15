# Player Directional Locomotion Policy

## Purpose

This slice adds a deterministic presentation policy for directional locomotion. It sits after caller-owned movement observations and before an animation consumer. It does not replace the player controller, physics, combat timing, asset catalog, scene ownership, or mixer lifecycle.

## Contract

The resolver accepts planar velocity, facing, speed, slope, turn rate, phase and surface evidence. It returns immutable presentation state.

The state contains:

- semantic state;
- dominant 8-way direction;
- blend weights;
- blend magnitude;
- turn class and turn weight;
- slope class and slope scale;
- surface confidence and slip response;
- cadence scale;
- bounded playback rate;
- normalized foot phase;
- footstep edge information;
- compact momentum presentation values.

## Direction model

The eight directions are forward, forward-right, right, back-right, back, back-left, left and forward-left. The blend resolver uses the local velocity angle relative to facing. At most two adjacent directions carry positive weight, and their weights sum to one within the deterministic tolerance.

The dominant direction is the highest-weight direction. Ties resolve by the stable direction ordering in the policy module.

## Sprint hysteresis

A sprint enters at 5.6 m/s or explicit run intent. Once already sprinting, the state remains sprinting down to the 5.1 m/s exit threshold unless a higher-priority semantic such as dodge, stagger or attack takes control.

This prevents noisy frame-to-frame speed samples from thrashing a locomotion action.

## Combat precedence

Presentation priority is:

1. hit-stagger;
2. dodge;
3. heavy attack;
4. light attack;
5. guard;
6. sprint/locomotion;
7. idle.

The directional policy only chooses a presentation semantic. Damage, target selection, attack windows and gameplay consequences remain outside this module.

## Surface response

Surface confidence reduces trust in foot planting. Surface slip increases braking and cadence compensation. Slope classes are flat, rising, steep and extreme. The slope scale is bounded and never produces non-finite playback values.

The policy intentionally clamps malformed input. `Infinity`, `NaN`, negative speeds and excessive slopes are normalized to safe finite values before presentation is resolved.

## Phase continuity

Foot phase is normalized to [0, 1). Idle and guard preserve the existing phase. Active locomotion advances phase using delta time, playback rate and cadence scale. Crossing one full cycle produces a single foot event.

The event output is presentation evidence only. A caller may use it to request an authored footstep sound or effect without granting this module ownership of audio or VFX.

## Telemetry

The telemetry module aggregates immutable read models. It tracks bounded sample history, bounded recent events, semantic and directional histograms, invalid-input rate, surface-confidence risk, transition rate and footstep frequency.

Telemetry has no dependency on Three.js, DOM, EventBus, ActorRegistry, material placement or editor UI.

## Replay

The replay module copies source samples into a bounded tape. A tape can be replayed into locomotion state and telemetry, producing a deterministic frame sequence and fingerprint.

Replay comparison reports frame indices that differ. Corpus comparison reports scenario indices that differ. This keeps debugging deterministic and local to the presentation policy.

## Limits

The policy clamps speed to 12 m/s, slope to 55 degrees and turn rate to 540 degrees/second. Delta time is bounded to one second at the normalization boundary. Telemetry retains at most 240 samples and 64 recent events. Replay accepts at most 600 frames per tape.

## Ownership

`player.js` remains authoritative for movement and combat state. The directional policy reads those observations; it does not write them. Existing animation asset catalogs remain authoritative for authored clips. Shared material-placement authorities remain untouched.

## Failure isolation

Malformed input does not throw during ordinary resolution. Invalid state is represented by finite fallback values and validation results. Replay rejects malformed tapes explicitly so an acceptance harness cannot silently execute a corrupt scenario.

## Determinism

The policy uses no time source, random source, DOM state or mutable global state. Fingerprints are computed from JSON-stable output. Identical samples produce identical presentation, telemetry and replay fingerprints.

## Acceptance matrix

The focused acceptance harness covers:

- idle, walk and sprint semantics;
- attack, guard, dodge and stagger precedence;
- forward, lateral and rear direction families;
- 65 angle probes across the signed half-turn range;
- speed, slope and turn-rate normalization;
- phase wrapping and footstep detection;
- bounded playback-rate and cadence outputs;
- 160-frame direction/terrain stress;
- deterministic telemetry replay;
- deterministic replay corpus comparison;
- perturbation-based mismatch detection;
- immutable-state shape and finite-value checks.

## Integration guidance

An existing animation consumer should pass its caller-owned velocity/facing/environment observations to the policy and use the returned presentation object as a read-only input to its action-selection or blend layer.

Consumers should not persist the policy object as gameplay state unless they use the provided controller. The controller itself stores only bounded presentation state: previous semantic, phase, frame count, transition count, footstep count, direction and fingerprint.

## Versioning

Policy version: `2026-09-15-v1`.

Telemetry version: `2026-09-15-v1`.

Replay version: `2026-09-15-v1`.

Changes that alter thresholds, direction ordering, normalization rules, phase stepping or fingerprint payloads should update the version and the acceptance expectations together.

## Non-goals

This module does not introduce:

- a second player controller;
- a second combat state machine;
- animation asset loading;
- procedural character geometry;
- model placement;
- material assignment;
- terrain deformation;
- navigation;
- camera ownership;
- save-game state;
- world event ownership.

## Review checklist

A reviewer can verify the slice by checking that output is immutable, all numeric values are finite, direction weights conserve to one, semantic precedence survives malformed telemetry, and identical input arrays replay identically.

The accompanying workflow performs exact-head checkout, syntax checks, focused executable regression, deterministic double-run, runtime ownership boundary scanning and a 2,400–3,000 line focused diff budget.
