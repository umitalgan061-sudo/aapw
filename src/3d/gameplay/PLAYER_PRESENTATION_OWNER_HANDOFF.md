# Player presentation owner handoff

## What changed this round

The player presentation layer now has a traversal-specific state policy and a composite player-motion presentation
boundary. The traversal side converts caller-owned geometry/contact cues into immutable presentation intent. The composite
side combines that intent with the existing locomotion animation request.

## Traversal states

The traversal vocabulary is deliberately finite: `clear`, `approach`, `prepare`, `vault`, `climb`, `drop`, `land`,
`blocked`, `recover`, and `cancelled`. Technique selection is based on normalized distance and height cues. Cancellation
has explicit precedence over blocked and contact so consumer output cannot advertise an action the caller has explicitly
cancelled.

## Temporal behavior

Timeline and runtime helpers use explicit caller clocks. No ambient wall-clock source is needed. Replay controllers can
seek and step records and remain deterministic. The bounded recorders exist for development capture and regression
analysis, not as save-game storage.

## Consumer boundary

The bridge and contract are the supported path for animation/audio/VFX/debug consumers. Consumers should not rebuild
traversal semantics from raw distances, heights, or confidence measurements.

## Contact behavior

Contact emphasis is separate from traversal execution. Soft and hard impact bands produce bounded animation, audio and
VFX emphasis values. The contact policy never changes physics or player movement.

## Surface behavior

Known surface labels such as stone, wood, metal, ice, mud, grass and sand can adjust presentation emphasis. Unknown
surfaces use a generic profile. This is presentation tuning only; it is not a collision or traversal legality policy.

## Recovery behavior

Vault, climb, drop, land, blocked, cancelled and generic recovery states have explicit durations and settle/reentry
windows. The values are first-pass presentation defaults and should be tuned with real gameplay capture rather than by
changing the traversal state vocabulary.

## Quality and diagnostics

Quality combines confidence, continuity and progress. Diagnostics detect invalid state/event values, contradictory
blocked/commitment output, low confidence and unannounced transitions. Health aggregates these findings into a read-only
report suitable for CI and local tuning.

## Blend behavior

The composite blend policy keeps locomotion and traversal weights bounded and chooses a dominant domain. Predictive
traversal can become visually important without taking over movement authority. Execution/contact/terminal traversal states
receive stronger presentation priority.

## Determinism

All state, timeline, telemetry, recorder and replay helpers are deterministic for identical inputs. New temporal features
must accept explicit elapsed or clock values. New random sources are not permitted in the presentation layer.

## Ownership boundaries

Gameplay systems remain responsible for input, movement, physics, collision, navigation, action authorization and world
state. Renderer/mixer/audio/VFX adapters remain responsible for actually applying or spawning presentation. This layer is
the semantic translation boundary between those owners.

## CI gate

The dedicated workflow performs syntax checks, focused acceptance tests, adversarial cases, replay/determinism checks,
schema/selector checks, recovery/contact checks, composite integration checks, quality/health checks and an ownership scan.
It also enforces the autonomous-round completion rule: more than 4,000 meaningful added lines are required before the round
can be considered complete.

## Extension protocol

When adding a traversal technique, add the state/technique semantics, boundary fixtures, sequence fixture, transition rule,
consumer mapping, replay coverage and documentation together. When adding a new channel, update the contract, bridge,
schema and bounded validation in the same change.

## Tuning protocol

Thresholds should be changed through the policy and accompanied by boundary-pair fixtures. Do not copy threshold constants
into consumers. If a value is presentation-only, keep it in a presentation policy/profile instead of placing it in physics
or movement code.

## Expected smoke path

The minimum healthy traversal sequence is `clear -> approach -> prepare -> vault -> land -> clear` for a vault,
`clear -> approach -> prepare -> climb -> land -> clear` for a climb, and
`clear -> approach -> drop -> land -> clear` for a drop. Failure is expected to surface as `blocked` or `cancelled`, not
as an invented execution state.

## Merge readiness

The round should be considered ready only after the exact branch diff exceeds the 4,000 meaningful-addition requirement,
the branch is based on the intended main snapshot or its base drift is explicitly understood, and CI results have been
observed rather than inferred from a queued run.
