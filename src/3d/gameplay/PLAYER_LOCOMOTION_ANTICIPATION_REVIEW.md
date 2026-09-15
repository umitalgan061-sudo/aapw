# Locomotion Anticipation Review Contract

## 01 — Scope
This document is the reviewer checklist for the temporal locomotion presentation slice.
The slice consumes observations and emits bounded read-only presentation values.
Movement authority remains outside the slice.
Physics authority remains outside the slice.
Combat timing remains outside the slice.
Animation clip ownership remains outside the slice.
Mixer lifecycle remains outside the slice.
Renderer state remains outside the slice.
Camera state remains outside the slice.

## 02 — Input normalization
Planar speed is finite and bounded.
Slope is finite and bounded.
Turn rate is finite and bounded.
Delta time is finite and bounded.
Surface confidence is normalized to [0,1].
Surface slip is normalized to [0,1].
Previous phase is normalized to [0,1).
Malformed vectors fall back to a zero or safe unit vector.
Unknown attack kinds become none.
Negative elapsed values do not advance presentation state.
Infinity never becomes an output Infinity.
NaN never becomes an output NaN.

## 03 — Motion modes
Idle represents no meaningful planar movement.
Start represents the first committed movement interval.
Accelerate represents rising speed after start.
Cruise represents stable forward or directional travel.
Brake represents meaningful negative speed delta.
Stop represents the end of a movement burst.
Strafe represents a strong directional redirect.
Reverse represents rearward intent in a future consumer.
Pivot represents a large heading correction at non-zero speed.
Recover represents neutral recovery after a presentation event.
Turn-in-place represents heading motion while nearly stationary.
Combat-advance represents locomotion under attack presentation pressure.
Combat-retreat remains available to future caller classification.
Guard-walk represents guarded locomotion.
Dodge-recover represents recovery after an evasion signal.
Stagger-recover represents recovery after a stagger signal.

## 04 — Start behavior
Start weight is driven by low speed and positive acceleration.
Start weight stays bounded even with extreme acceleration input.
Start does not alter player velocity.
Start does not synthesize a new gameplay action.
Start can be consumed by an authored start clip.
Start can be ignored by consumers without breaking the policy.

## 05 — Brake behavior
Brake weight rises with negative speed delta.
Slip increases braking response.
Turn intensity can increase braking response.
Brake remains bounded at low speed.
Brake does not own a stop command.
Stop distance is a presentation estimate only.
Stop distance remains finite.
Stop distance is bounded for high speed input.

## 06 — Pivot behavior
Pivot requires meaningful direction change.
Pivot weight increases with heading difference.
Pivot weight remains bounded.
Pivot is stronger above the hard pivot threshold.
Pivot does not modify world facing.
Pivot does not lock player input.
Pivot can be mapped to a dedicated consumer channel.

## 07 — Look-ahead
Look-ahead is short by design.
Look-ahead has a hard maximum.
Turn rate can increase look-ahead modestly.
Acceleration can increase look-ahead modestly.
Low confidence reduces the amount of trusted look-ahead.
Look-ahead never becomes a long-range trajectory planner.

## 08 — Direction projection
Current direction is read from the existing directional policy.
Anticipated direction is computed from current heading and short turn intent.
Projection is deterministic.
Projection uses no wall clock.
Projection uses no random source.
Projection can cross the forward/back boundary safely.
Projection can cross the left/right boundary safely.
Projection returns a known direction token.

## 09 — Anticipated blend
Current directional weights remain available.
Anticipated blend preserves all eight direction keys.
Negative weights are not emitted.
Values above one are not emitted.
The blend remains approximately normalized.
The anticipated direction receives an early supporting weight.
The output is immutable.

## 10 — Surface response
Surface confidence lowers presentation confidence.
Surface slip increases contact correction.
Slope increases contact caution.
Ground risk is bounded.
Contact plant remains within [0,1].
Toe release remains within [0,1].
Heel release remains within [0,1].
Corrective step remains within [0,1].

## 11 — Temporal windows
Every transition resolves to a bounded duration.
Same-mode windows remain safe.
Pivot transitions are deliberately longer.
Stop transitions remain short but visible.
Recovery transitions tolerate noisy terrain evidence.
Transition easing is deterministic.
Transition progress clamps to [0,1].
Completed transitions report progress one.
Elapsed time beyond the window does not create overshoot.

## 12 — Temporal tuning matrix
Each mode has enter timing.
Each mode has exit timing.
Each mode has smoothing.
Each mode has inertia.
Each mode has bounded overshoot.
Environment modifiers affect duration only within known bounds.
Clear ground preserves baseline timing.
Soft ground slightly widens timing.
Slippery ground widens timing and preserves inertia.
Steep ground widens timing and reduces confidence.
Unstable ground is the most conservative modifier.

## 13 — Velocity history
History retains a fixed maximum number of samples.
History entries are normalized observations.
History derivative uses finite delta time.
Acceleration is bounded.
Turn rate is bounded.
Weighted history emphasizes recent evidence.
Prediction remains finite.
Prediction speed is bounded.
Prediction distance remains positive for positive speed.
Stability score remains in [0,1].

## 14 — Foot contact
Foot phase is normalized.
Left contact occupies the first quarter pattern.
Right contact occupies the second quarter pattern.
Release windows are separated from contact windows.
Slip dampens contact certainty.
Low confidence dampens plant weight.
Ungrounded state removes active contact weighting.
Foot event output is presentation evidence.
Foot event output does not own audio.
Foot event output does not own VFX.

## 15 — Profiles
Default profile is balanced.
Agile increases response.
Heavy increases braking and contact stability.
Scout favors anticipation.
Armored favors conservative pivoting.
Slippery favors corrective braking.
Cautious favors look-ahead.
Evasive favors pivot and redirect response.
Profile values are bounded.
Profile configuration is immutable.
Profile blending conserves to one.

## 16 — Animation bridge
Bridge output contains explicit direction channels.
Bridge output contains explicit gait channels.
Bridge output contains start and stop channels.
Bridge output contains pivot and recover channels.
Bridge output carries a damping envelope.
Ground risk influences damping.
Confidence influences damping.
The bridge does not import Three.js.
The bridge does not touch a mixer.
The bridge does not load clips.
The bridge does not mutate player state.

## 17 — Telemetry
Telemetry counts samples.
Telemetry counts mode changes.
Telemetry counts direction changes.
Telemetry counts pivot samples.
Telemetry counts start samples.
Telemetry counts brake samples.
Telemetry counts stop samples.
Telemetry records low confidence.
Telemetry records high slip.
Telemetry records high ground risk.
Telemetry history is bounded.
Telemetry event history is bounded.
Telemetry warnings are bounded.
Telemetry read model is immutable.

## 18 — Replay
Replay copies samples.
Replay has a version.
Replay has a maximum frame count.
Replay fingerprints are deterministic.
Replay can be compared against itself.
Replay can report changed frame indices.
Replay can diff important presentation fields.
Replay corpora are bounded.
Malformed tape versions are rejected.
Malformed sample counts are rejected.

## 19 — Determinism
Two identical sample arrays produce identical profiles.
Two identical sample arrays produce identical telemetry.
Two identical sample arrays produce identical replays.
Two identical sample arrays produce identical fingerprints.
No Date dependency exists.
No random dependency exists.
No DOM dependency exists.
No mutable singleton is required.

## 20 — Ownership
The player controller owns gameplay movement.
The combat system owns combat outcomes.
The asset catalog owns authored clips.
The renderer owns actual scene objects.
The animation consumer owns mixer configuration.
The anticipation policy owns presentation math only.
The bridge owns translation to consumer channels only.
The telemetry layer owns aggregation only.
The replay layer owns deterministic test playback only.

## 21 — Failure isolation
Malformed numeric inputs resolve safely.
Unknown profile keys resolve to default.
Unknown modes resolve to idle.
Invalid replay tapes are rejected.
Invalid profile configurations are reported.
Invalid presentation is represented as validation state.
No acceptance harness relies on console-only evidence.

## 22 — Review gates
Syntax must pass.
Focused acceptance must pass.
Adversarial suite must pass.
Invariant suite must pass.
Bridge suite must pass.
Profile suite must pass.
Transition suite must pass.
Temporal tuning suite must pass.
Foot contact suite must pass.
Facade suite must pass.
Replay contract must pass.
Deterministic double run must pass.
Runtime/editor boundary must pass.
Focused diff must remain inside the round budget.

## 23 — Integration checklist
Caller supplies velocity.
Caller supplies facing.
Caller supplies speed.
Caller supplies delta time.
Caller optionally supplies terrain evidence.
Caller optionally supplies combat presentation evidence.
Caller persists its own gameplay state.
Consumer reads the bridge request.
Consumer applies authored clips.
Consumer owns actual animation playback.

## 24 — Non-goals
No second movement controller.
No second combat state machine.
No procedural character mesh.
No automatic asset downloading.
No camera controller.
No navigation solver.
No path planner.
No terrain mutation.
No save-game persistence.
No world-event ownership.

## 25 — Version discipline
Policy changes update version when thresholds change.
Replay changes update version when fingerprints change.
Telemetry changes update version when read-model fields change.
Tuning changes update expectations when timing changes.
Bridge channel changes update the consumer contract.

## 26 — Final reviewer question
Does the player look more intentional during starts, brakes, pivots, redirects and recoveries without moving gameplay authority into presentation code?
The answer should be yes before this slice is considered complete.
