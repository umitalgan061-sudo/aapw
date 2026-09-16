# Player presentation pipeline test matrix

This matrix covers the complete presentation path from caller-owned locomotion/traversal cues to consumer-ready output.

## State selection

| Input condition | Expected domain/state | Regression target |
|---|---|---|
| no traversal weight | locomotion/clear | no false traversal activation |
| far obstacle | locomotion/approach | predictive cue without stealing normal locomotion |
| near preparation cue | traversal/prepare | early staging |
| close horizontal obstacle | traversal/vault | vault commitment |
| positive-height airborne cue | traversal/climb | climb presentation |
| negative-height airborne cue | traversal/drop | drop presentation |
| landing impact | traversal/land | contact beat |
| explicit blocked cue | traversal/blocked | execution suppression |
| explicit cancel | traversal/cancelled | terminal cancellation |

## Precedence

Cancellation wins over blocked, impact and technique selection. Blocked wins over predicted execution. Landing wins over
ordinary grounded traversal selection when the impact window is active. Airborne height selects climb/drop after the explicit
terminal conditions have been evaluated.

## Composite domain

Normal locomotion should remain the dominant domain when traversal is only predictive and weak. A committed traversal,
landing or blocked/cancelled state should be the dominant domain for presentation consumers. Returning to normal movement
must restore locomotion dominance deterministically.

## Blend limits

All presentation channels are normalized to `[0,1]`. Traversal weight, locomotion weight, anticipation, commitment,
contact, impact and confidence must never exceed their contract ranges. A consumer adapter must not amplify an already
clamped packet past those bounds.

## Audio

Audio event policy maps semantic events to priority, one-shot/loop semantics and latency. Landing-hard, cancel and blocked
are high-priority one-shots. Approach and prepare can loop only while their states remain active. Confidence attenuation
may reduce intensity but never makes a missing event appear to exist.

## VFX

VFX policy maps semantic states to named intent effects without constructing renderer objects. Surface confidence attenuates
weights. Contact impact can produce a burst hint. Disabled VFX output must be represented by `null`, not by an invented
renderer-side object.

## Contact

Soft impact begins above the documented soft threshold. Hard impact begins at the hard threshold. Contact output provides
squash/recoil/foot-plant emphasis plus audio/VFX hints. It never changes movement or physics state.

## Recovery

Recovery timing is explicit and replayable. The recovery policy has named duration/settle/reentry values for vault, climb,
drop, land, blocked, cancelled and generic recover states. It never reads ambient time.

## Timeline

Traversal and composite timelines must remain monotonic. State durations are derived from consecutive explicit timestamps.
Gaps are observable rather than silently fabricated. Resampling retains source semantic state and changes only the timestamp
representation.

## Replay

Two independent evaluations of the same cue sequence must produce equal serialized output. Replay controllers may seek,
pause and resume using record index/timestamp values. They must not call wall-clock APIs.

## Recording

Recorders are bounded. Export/import preserves semantic order and validation. Buffer eviction is deterministic: entries are
retained from the tail up to the configured limit.

## Telemetry

Telemetry aggregates counts and bounded confidence/channel means. Merging independent telemetry reports must not mutate
either source report. Risk flags are descriptive and do not change gameplay.

## Diagnostics

Diagnostics report invalid enums, out-of-range values, contradictory blocked/commitment combinations, low confidence and
unannounced state transitions. Findings are structured and side-effect free.

## Calibration

Threshold corpus rows exercise exact boundary values around prepare distance, commit distance, climb height, drop height,
soft impact and hard impact. Boundary probes should remain deterministic after threshold tuning.

## Malformed input

`NaN`, infinities, numeric strings and negative values are normalized. Cancellation remains valid even when unrelated cue
fields are malformed. Unknown surface/obstacle labels are preserved for observability.

## Ownership

Presentation code must not import renderer classes, manipulate player transforms/velocity, invoke random number generation,
read wall-clock time, write save data or send network requests. Gameplay remains the owner of traversal execution and physics.

## Integration

The final integration path should be testable with a small sequence: idle -> approach -> prepare -> vault -> land -> clear.
A blocked path should be clear -> approach -> prepare -> blocked -> clear. A cancelled path should be clear -> approach ->
prepare -> cancelled -> clear. These sequences are the minimum smoke tests for future presentation refactors.

## Review gate

The dedicated workflow runs syntax checks, focused acceptance suites, adversarial tests, runtime/replay checks, schema,
selector, contact, recovery, quality, health, integration and deterministic repeat checks. The same workflow enforces the
4,000 meaningful-added-line threshold for this autonomous round.
