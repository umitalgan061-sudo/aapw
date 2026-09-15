# Temporal Locomotion Tuning Rationale

## 01 — Why a temporal layer exists
Directional blend answers where the player is moving.
Temporal anticipation answers where the player is about to move.
These are different presentation questions.
A character can already face forward while the next visible frame is a brake.
A character can already have rightward velocity while the next authored pose should prepare a pivot.
A character can already be moving while the surface evidence says foot contact is uncertain.
The anticipation layer makes those short-duration changes explicit.

## 02 — Why the horizon is short
A locomotion animation should not look like a path planner.
Long prediction creates visible false positives.
Short prediction allows the consumer to prepare the next directional channel.
The hard look-ahead limit is 0.35 seconds.
Typical look-ahead is much smaller than that limit.
Acceleration expands the horizon only modestly.
Turn rate expands the horizon only modestly.
Surface uncertainty reduces trust in the projection.

## 03 — Start timing
The start window is intentionally short.
The player expects immediate response after movement begins.
A long start clip would make controls feel sticky.
A very short start window would collapse into idle-to-cruise noise.
The selected range leaves room for an authored anticipation pose.
Positive acceleration contributes to start weight.
Low speed contributes to start weight.
Once speed is stable, cruise takes ownership.

## 04 — Brake timing
Brake needs more visual persistence than start.
Without persistence, a high-frequency speed change looks jittery.
Slip increases the need for visual braking.
Turn rate increases the need for corrective braking.
Brake remains presentation-only.
The physics system still decides whether the player actually stops.
The animation consumer can ignore brake weight without affecting gameplay.

## 05 — Stop timing
Stop is a terminal presentation state.
The stop window stays shorter than recovery windows.
The stop channel can host a planted endpoint pose.
Stop distance is an estimate for pose selection.
It is not a physics prediction.
It does not alter navigation.
It does not alter collision.
It does not alter input buffering.

## 06 — Pivot timing
Large direction changes deserve a pivot channel.
The pivot threshold is deliberately above ordinary strafing.
The hard pivot threshold protects the consumer from interpreting every redirect as a turn-around.
Pivot windows are longer than standard cruise transitions.
Pivot has higher presentation priority.
Pivot remains interruptible at the gameplay layer.
The bridge only communicates presentation priority.

## 07 — Surface confidence
A surface query can be uncertain near edges.
A low confidence score should reduce aggressive foot placement.
Confidence is therefore propagated through anticipation.
Confidence also affects animation bridge damping.
Confidence never becomes a gameplay health value.
Confidence never changes movement speed directly.

## 08 — Slip
Slip is a visual cue for contact uncertainty.
A slippery surface increases braking emphasis.
A slippery surface increases corrective step response.
A slippery surface reduces certainty of planted contact.
Slip is bounded to [0,1].
The consumer can use slip as an additive damping signal.

## 09 — Slope
Slope classes keep behavior understandable.
Flat is the baseline.
Rising introduces modest cadence response.
Steep introduces stronger cadence response.
Extreme is the strongest presentation correction.
Slope never creates a new animation asset by itself.
Slope never modifies terrain.

## 10 — Velocity history
A single frame is insufficient to infer acceleration reliably.
The history filter keeps a bounded sample window.
Recent samples receive more weight.
The derivative is calculated with normalized finite delta time.
The history is only a presentation aid.
The history can be reset without affecting player state.

## 11 — History limits
A bounded history avoids unbounded memory growth.
Twenty-four samples cover the short presentation horizon at common frame rates.
Older samples are discarded deterministically.
The history controller exposes a read-only state snapshot.

## 12 — Prediction
Prediction uses smoothed speed and smoothed turn rate.
Prediction is intentionally conservative.
Predicted speed is clamped to the existing directional speed ceiling.
Predicted distance is finite.
Predicted angle is normalized through the same angle conventions.
Prediction is not exposed as a movement target.

## 13 — Foot phase
Foot phase allows the consumer to avoid abrupt left/right swaps.
The phase is normalized to [0,1).
The phase wraps deterministically.
A wrap produces a single presentation edge.
Surface uncertainty dampens the contact weight.
Ungrounded observations eliminate planted contact.

## 14 — Foot events
Foot events are evidence, not commands.
The policy does not play sounds.
The policy does not spawn particles.
The policy does not allocate scene nodes.
The consumer may translate a foot event into an authored sound request.
The consumer may reject the event.

## 15 — Profile philosophy
Profile tuning changes responsiveness without changing ownership.
Agile is more directional.
Heavy is more stable.
Scout sees farther.
Armored resists rapid pivoting.
Slippery reacts to loss of contact.
Cautious protects continuity.
Evasive protects redirect responsiveness.
Profiles remain bounded and blendable.

## 16 — Profile blending
Context can select more than one profile.
A normalized profile blend prevents order-dependent scaling.
The dominant profile is deterministic.
Unknown profiles fall back to default.
Blend weights are never negative.
The sum remains approximately one.

## 17 — Transition windows
Temporal tuning describes generic channel behavior.
Transition windows describe a concrete mode pair.
This separation keeps mode data reusable.
An idle-to-start transition can differ from cruise-to-brake.
A pivot-to-cruise transition can differ from brake-to-stop.
The window remains independent from the actual animation clip.

## 18 — Easing
Presentation progress is shaped for visual continuity.
The easing family remains deterministic.
Progress clamps at the start and end.
A large elapsed time cannot create values beyond one.
The consumer can sample the window repeatedly.

## 19 — Interruptibility
Pivot and stop receive higher lock intent.
Recovery can become less interruptible on unstable terrain.
This is not an input lock.
It is not a gameplay cooldown.
It is only consumer guidance for presentation blending.

## 20 — Combat presentation
Combat context has higher semantic priority than locomotion.
An attack can still carry directional locomotion information.
A dodge can transition into a locomotion recovery mode.
A stagger can transition into a safer recovery mode.
Guard walk uses a slower visual cadence.
The combat state machine remains authoritative.

## 21 — Animation bridge
The bridge has explicit direction channels.
The bridge has explicit gait channels.
The bridge has a damping envelope.
The bridge includes confidence.
The bridge includes ground risk.
The bridge includes contact weight.
The bridge never touches Three.js.

## 22 — Telemetry philosophy
Metrics should expose stability rather than noise.
Mode changes are counted.
Direction changes are counted.
Pivot events are counted.
Low confidence is counted.
High slip is counted.
Quality is a bounded score.

## 23 — Replay philosophy
The same input should make the same presentation.
Replay makes that statement executable.
A changed input should produce a visible diff.
Replay corpora make regressions reproducible.
Tapes are bounded.
Fingerprints are deterministic.

## 24 — Acceptance philosophy
Acceptance tests cover normal play.
Adversarial tests cover malformed inputs.
Invariant tests cover shape and bounds.
Soak tests cover long sequences.
Bridge tests cover channel contracts.
Profile tests cover authored tuning.
Temporal tests cover window math.
Foot tests cover contact phases.
Facade tests cover integrated composition.

## 25 — Performance philosophy
The layer uses bounded arrays.
The layer uses no network activity.
The layer uses no DOM reads.
The layer uses no random source.
The layer does not allocate large object graphs per sample beyond the required read model.
Consumers remain responsible for their own pooling strategy.

## 26 — Versioning philosophy
Threshold changes should be reviewed like behavior changes.
Changing the sprint threshold can alter semantic selection.
Changing look-ahead changes directional timing.
Changing contact thresholds changes foot events.
Changing fingerprint fields changes replay identity.
The version token documents those contract changes.

## 27 — Final tuning rule
Prefer a visible improvement over a new subsystem.
Prefer deterministic math over hidden state.
Prefer bounded data over open-ended history.
Prefer presentation evidence over gameplay authority.
Prefer explicit consumer channels over implicit side effects.

## 28 — Practical review result
The layer is successful when starts feel intentional.
The layer is successful when brakes feel planted.
The layer is successful when pivots feel anticipated.
The layer is successful when terrain uncertainty looks cautious.
The layer is successful when combat recovery feels coherent.
The layer is successful when the underlying player controller remains untouched.
