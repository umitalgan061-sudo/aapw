# Unified player motion presentation integration

The player presentation integration is the final composition boundary built on top of the existing locomotion
animation bridge and the new traversal presentation policy. Its purpose is to make consumer behavior predictable:
normal locomotion, traversal anticipation, traversal execution, contact and recovery all arrive through a single
state packet with explicit precedence.

## Data flow

`caller cue -> locomotion request + traversal state -> composite motion state -> contract/blend -> consumer intents -> recorder/telemetry/health`

Every arrow is explicit. There is no hidden global state and no second gameplay authority.

## Locomotion reuse

The integration imports the existing `resolvePlayerLocomotionAnimationRequest()` bridge rather than duplicating
its directional channels, anticipation envelope, foot-plant information or deterministic fingerprint. This keeps
locomotion tuning in one place and makes traversal additive instead of a competing movement system.

## Traversal reuse

Traversal policy decides clear, approach, prepare, vault, climb, drop, land, blocked, recover and cancelled states.
The integration does not change those decisions. It only combines them with locomotion and exposes the combined
result through the consumer contract.

## Precedence

Execution and contact traversal states are visually dominant. Blocked and cancelled states suppress misleading
execution cues. Predictive traversal states can become dominant while locomotion remains the underlying gameplay
movement authority. The blend policy converts this decision into bounded normalized weights.

## Consumer packets

Animation receives locomotion mode and traversal technique plus anticipation, commitment, contact, impact and
confidence channels. Audio receives traversal event and intensity semantics. VFX receives traversal event/state and
contact/impact weights. Debug consumers receive labels rather than world objects.

## Recording and replay

The recorder keeps a bounded history of composite states. It is deliberately not a persistence system. Replay
operates on caller-provided inputs and explicit clocks. Two independent runs must serialize to equivalent outputs.
The same principle applies to the traversal-only replay and the composite motion replay.

## Telemetry

Composite telemetry counts domain usage, traversal states, confidence and domain switches. Traversal telemetry separately
tracks traversal-specific events and risks. Keeping these scopes distinct prevents a generic metrics aggregator from
assuming ownership of gameplay events.

## Health

The health report combines state validation, traversal contract validation, timeline monotonicity, presentation quality,
traversal guard safety and event-policy safety. It produces a score plus explicit errors/warnings. It is a diagnostics
surface rather than a hidden gameplay gate.

## Stress coverage

The traversal stress harness produces deterministic mixed sequences of approach, commitment, airborne cues and landing.
The batch processor feeds the same production state builder, telemetry, quality and diagnostics helpers. This means
offline regression checks exercise the same semantics as the live pipeline.

## Ownership constraints

No module in this presentation layer may read or write player transforms, velocity, physics state, navigation state,
renderer objects, mixer state, persistence or network state. These modules only consume plain snapshots and return plain
immutable data.

## Change policy

A new locomotion mode must first land in the existing locomotion policy. A new traversal technique must receive explicit
state/technique semantics and fixture coverage. A new consumer channel must be represented in the contract, bridge,
validation and CI. Any new temporal rule must accept an explicit clock or elapsed value.

## Review evidence

The workflow runs syntax validation, acceptance scripts, adversarial inputs, runtime determinism, schema validation,
selector validation, stress processing and composite integration checks. The workflow also enforces the 4,000 meaningful
addition threshold for this autonomous round and scans presentation production modules for accidental transform/physics
or nondeterministic time/random ownership.
