# Traversal presentation test matrix

| Area | Case | Expected | Failure meaning |
|---|---|---|---|
| normalization | zero weight | clear | stale traversal can leak |
| normalization | negative weight | clamped | unsafe numeric propagation |
| normalization | weight above one | clamped | channel contract broken |
| normalization | negative distance | zero | invalid geometry propagated |
| normalization | huge distance | max envelope | runaway anticipation |
| normalization | negative height | clamped | invalid vertical cue |
| normalization | huge height | max envelope | invalid vertical cue |
| normalization | NaN speed | fallback | nondeterministic consumer input |
| normalization | string weight | numeric parse | forgiving boundary |
| precedence | cancel + block | cancelled | cancellation must win |
| precedence | block + land | blocked | execution must not be advertised |
| precedence | airborne + positive height | climb | upward traversal presentation |
| precedence | airborne + negative height | drop | downward traversal presentation |
| state | weight below threshold | clear | no false activation |
| state | far obstacle | approach | predictive cue |
| state | prepare envelope | prepare | staged anticipation |
| state | close obstacle | vault | horizontal technique |
| state | positive ledge | climb | vertical technique |
| state | negative ledge | drop | downward technique |
| contact | soft impact | land | landing beat |
| contact | hard impact | land | impact channel elevated |
| terminal | blocked | blocked | hard stop presentation |
| terminal | cancelled | cancelled | caller cancellation |
| recovery | land to clear | recover-exit | clean release |
| transition | clear→approach | allowed | normal anticipation |
| transition | approach→prepare | allowed | staging progression |
| transition | prepare→vault | allowed | commitment progression |
| transition | vault→land | allowed | contact completion |
| transition | blocked→clear | allowed | obstacle release |
| transition | cancelled→vault | disallowed | stale intent guard |
| bridge | animation | state/phase/weights | consumer contract |
| bridge | audio | event/intensity | consumer contract |
| bridge | VFX | cue/weight | consumer contract |
| bridge | legacy | boolean + flags | backwards compatibility |
| runtime | tick | increments clock/index | facade correctness |
| runtime | reset | clears state/history | lifecycle correctness |
| runtime | hydrate | restores state | persistence-like handoff without ownership |
| runtime | seek | monotonic local clock | replay control |
| replay | same records twice | identical output | determinism |
| telemetry | observe | counts sample | instrumentation |
| telemetry | reset | zero counters | instrumentation lifecycle |
| quality | low confidence | lower score | tuning feedback |
| quality | continuity break | lower score | transition visibility |
| diagnostics | invalid event | finding | review surface |
| diagnostics | blocked+commitment | finding | consumer contradiction |
| integration | pipeline tick | all packets | single boundary |
| integration | pipeline reset | empty snapshot | lifecycle |
| schema | required keys | valid | contract completeness |
| schema | invalid enum | invalid | consumer safety |

## Boundary values

| Input | Lower boundary | Nominal | Upper boundary |
|---|---:|---:|---:|
| traversal weight | 0 | 0.5 | 1 |
| distance meters | 0 | 2.5 | 8 |
| height meters | -3 | 0 | 3 |
| width meters | 0 | 1 | 4 |
| planar speed | 0 | 3 | 12 |
| landing impact | 0 | 2 | 9 |
| confidence | 0 | 0.7 | 1 |
| delta seconds | 0.001 | 0.0167 | 0.2 |

## State transition coverage

The intended progression for a successful vault is `clear -> approach -> prepare -> vault -> land -> clear`.
The intended progression for a successful climb is `clear -> approach -> prepare -> climb -> land -> clear`.
The intended progression for a drop is `clear -> approach -> drop -> land -> clear` when the caller detects a negative
height before contact. An unavailable traversal is `clear -> approach -> prepare -> blocked -> clear`.
Cancellation is `clear -> approach -> prepare -> cancelled -> clear`.

## Consumer invariants

Animation must never see a traversal weight outside `[0,1]`. Audio intensity must remain bounded. VFX contact and impact
weights must remain bounded. Legacy output must report `active=false` for `clear` and `cancelled`. No production bridge
output may expose a mutable reference to a policy object.

## Replay invariants

Two independent runtime instances receiving the same cue sequence at the same clock values must serialize to equivalent
snapshots. Replaying an exported record set must preserve state, phase, event and rounded confidence. Hydrating a snapshot
and continuing from the same next cue must not introduce a different semantic transition.

## Error tolerance

Malformed numeric input is normalized, not thrown. Unknown surface and obstacle labels are preserved as strings for
observability. Unknown requested states are ignored by the resolver in favor of derived state. A caller cancellation is
accepted even if other traversal fields are malformed.

## Ownership regression checks

Traversal presentation modules may not import renderer classes, physics globals or navigation planners. They may not mutate
player positions or velocities. They may not invoke random number generators. They may not write persistence or network data.

## Review evidence

The acceptance script checks the explicit fixture corpus. The runtime script checks deterministic two-instance execution.
The adversarial script checks hostile numeric inputs and transition enumeration. The integration script verifies that policy,
contract, bridge, quality and telemetry compose without each layer owning the other's data.
