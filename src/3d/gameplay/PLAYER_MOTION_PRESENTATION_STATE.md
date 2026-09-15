# Composite player motion presentation state

The composite state is the final consumer boundary between player locomotion semantics and traversal semantics.
It exists because animation consumers should not have to choose between two independent state machines.

## Domain precedence

Traversal wins when it has an execution, contact, blocked or cancellation state. Locomotion remains the fallback
domain while the player is moving normally. Predictive approach/prepare traversal can still outrank locomotion
when its presentation weight is high enough to stage the upcoming technique.

## Why this is presentation-only

The composite does not authorize traversal and does not move the player. Its `domain` field only tells presentation
consumers which signal should receive the dominant visual/audio emphasis. Gameplay remains authoritative over whether
an action actually occurs.

## Existing locomotion bridge

The existing locomotion bridge already exposes directional channels, start/accelerate/cruise/brake/stop/strafe/
pivot/recover channels, a confidence envelope and a deterministic fingerprint. The composite reuses that request rather
than duplicating directional locomotion logic.

## Traversal contribution

Traversal contributes state, phase, technique, anticipation, commitment, contact, impact and confidence. The composite
keeps these channels bounded, immutable and deterministic so consumers can safely cache them per frame.

## Runtime controller

`createPlayerMotionPresentationController()` owns only previous presentation state and a local frame counter. It has
`update`, `reset`, and `snapshot`. A recorder can capture each returned state without granting persistence ownership to
this feature.

## Recording

The composite recorder is bounded. Older entries are dropped once the configured maximum is exceeded. Exported records
are plain serialized data. Two recorder streams can be compared deterministically for regression tests.

## Consumer rule

Animation should select `state.animation`, audio should select `state.audio`, and VFX should select `state.vfx` from the
projection. Consumers should not inspect raw traversal cues or reconstruct locomotion precedence themselves.

## Safety

Blocked traversal cannot advertise high commitment after the safety guard runs. Cancelled traversal is fully inactive in
traversal channels. All public confidence/weight values are bounded. Renderer objects and player transforms are absent from
this layer by design.

## Determinism

No wall-clock reads, random calls or mutable global accumulators are used in the composite pipeline. Input order and
explicit clock values fully determine output. This makes the same sequence suitable for CI replay and manual debugging.

## Test expectations

The composite test checks identical output across two independent controllers, validates the composite state shape,
ensures the projected animation domain matches the selected precedence and verifies recorder stream equivalence.
