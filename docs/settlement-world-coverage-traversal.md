# Settlement World Coverage Traversal Contract

## Purpose
This document describes the read-only traversal layer added above Settlement World Coverage continuity.

The layer converts world-context evidence into traversal choices.

It never owns movement execution.

It never owns navigation meshes.

It never spawns actors.

It never edits roads.

It never edits terrain.

It never edits hydrology.

It never owns combat.

It never owns quest state.

It never replaces save state.

## Architectural boundary
The settlement campaign remains authoritative for services.
The geographic asset runtime remains authoritative for chunk and seed identity.
The continuity bridge remains authoritative only for its own derived packet.
Traversal is another derived packet.

A traversal lane is evidence.
A traversal route is a recommendation.
A risk score is a planning signal.
A milestone is a presentation marker.
A pacing state is a movement hint.
A player signal is a cue.
A replay frame is diagnostic evidence.

None of these packets grants permission to mutate the game state.

## Lane vocabulary
The traversal planner exposes ten bounded lanes.

gateway is the settlement entry and exit lane.

market is the commerce lane.

tavern is the rest and dialogue lane.

craft is the blacksmith and equipment lane.

farm is the survival-oriented lane.

military is the barracks and training lane.

stable is the travel and mobility lane.

home is the persistence and shelter lane.

river is the water-adjacent exploration lane.

ridge is the elevated observation lane.

Lane vocabulary is deliberately stable.

Callers may display their own labels.

The layer does not create route geometry.

## Traversal phases
A plan has one of six phases.

orient means the settlement is still a distant world landmark.

commit means the player is selecting an approach.

traverse means the player is following a selected lane.

arrive means the threshold or arrival relationship is becoming active.

linger means the settlement or service context is the current focus.

return means the player is moving back toward the world route.

The phase does not imply a scene transition.

The phase can change while the same world remains streamed.

## Risk model
Risk is normalized to zero through one.

Normal is below the warning boundary.
Warning begins at 0.58.
Critical begins at 0.78.

The model uses ten factors.

visibility measures atmospheric readability.

slope measures grade pressure.

water identifies water-adjacent movement exposure.

weather reflects current weather intensity.

distance represents long traversal exposure.

gateway represents entry-state friction.

road measures route visibility degradation.

fatigue reflects player fatigue evidence.

cold reflects low-temperature exposure.

navigation represents wayfinding confidence.

Each factor is bounded.

Each factor has a bounded contribution.

Risk never becomes NaN.

Risk never becomes Infinity.

## Pacing states
Pacing is not movement speed control.

pause means the presentation should encourage stopping.

crawl means a cautious traversal cue is appropriate.

walk means a moderate pace is appropriate.

steady means normal traversal is appropriate.

rush means a faster return cue can be presented.

recover means shelter or rest is more relevant.

Pacing uses risk, fatigue and weather evidence.

Pacing does not write the player velocity.

## Route modes
Safe prioritizes risk reduction.

Direct prioritizes a shorter conceptual route.

Service prioritizes the recommended settlement service.

Return prioritizes the gateway.

Explore allows non-service lanes to remain competitive.

The route resolver compares lanes after risk is calculated.

The result includes the selected lane and bounded alternatives.

## Route selection principles
Risk reduces a route score.

The current recommended service can receive a bounded service bonus.

The gateway receives a direct-route bias.

Departure receives a return bias.

The selected route remains deterministic.

Equivalent inputs produce equivalent fingerprints.

## Milestones
The milestone projection exposes ten markers.

world-seen records first stable orientation.

approach-start records the approach phase.

route-committed records traversal intent.

gateway-visible records visible boundary context.

threshold-reached records threshold semantics.

service-reached records service focus.

settlement-active records active settlement context.

departure-ready records return readiness.

gateway-crossed records the gateway crossing marker.

resume-ready records resume-focused context.

Milestones are not save points.

They are not quest events.

They are not gameplay triggers.

## Signal arbitration
Signals are derived from existing evidence.

navigate asks the caller to follow the clearest lane.

slow asks the caller to reduce visual traversal tempo.

stop asks the caller to pause.

enter represents available settlement entry.

service points at the selected service.

return prioritizes the gateway.

observe asks the caller to inspect boundary context.

resume references recoverable traversal context.

weather exposes environmental conditions.

Only a bounded primary list should be rendered.

## Replay envelope
Replay is diagnostic only.

A replay frame contains stage.

A replay frame contains phase.

A replay frame contains lane.

A replay frame contains risk.

A replay frame contains milestone.

A replay frame contains pacing.

A replay frame contains primary signals.

A replay frame contains readiness.

Frames are bounded to sixteen.

Input keys are normalized.

Object order is stabilized for the fingerprint.

## Mobile behavior
Mobile keeps the same semantic vocabulary.

Mobile reduces traversal-density hints.

Mobile reduces waypoint counts.

Mobile keeps the same maximum lane vocabulary.

Mobile keeps deterministic ordering.

Mobile does not create a separate gameplay system.

## Determinism
Stable serialization sorts object keys.

FNV-style digesting is used for compact fingerprints.

No random source is consulted.

No wall-clock source is consulted.

No renderer state is inspected.

No hidden timer is created.

No background job is created.

## Numeric safety
All public score values are clamped.

All public counts are bounded.

All distances are finite.

Malformed values fall back to defaults.

String numerics are parsed only when finite.

NaN is never returned as a public score.

Infinity is never returned as a public distance.

## Ownership flags
Traversal packets expose explicit ownership flags.

readOnly must remain true.

noNavMeshMutation must remain true.

noActorSpawn must remain true.

noRoadMutation must remain true.

noCombatMutation must remain true.

noSaveMutation must remain true.

noGameplayMutation must remain true.

These flags are checked by regression tests.

## Test strategy
Every public planner has a validator.

Every validator reports bounded error codes.

Replay is tested with cloned input.

Mobile and desktop are compared.

Risk thresholds are exercised.

Route modes are exercised.

Milestone vocabulary is exercised.

Signal vocabulary is exercised.

Malformed input is exercised.

Scenario coverage is maintained in the traversal scenario catalogue.

## Integration strategy
Traversal can consume the existing experience packet.

Experience can continue to consume continuity, atmosphere, signage and road evidence.

The campaign runtime remains the execution authority.

The geographic runtime remains the spatial authority.

This keeps the dependency direction one-way.

## Failure behavior
A malformed settlement falls back to the neutral settlement envelope.

A malformed player falls back to an empty player context.

An invalid route mode falls back to safe.

An unavailable lane falls back to the best eligible lane.

An over-cap signal list is truncated.

An over-cap replay list keeps the newest frames.

A risky route produces a risk warning rather than a mutation command.

## Acceptance criteria
Traversal plans are deterministic.

Traversal plans are bounded.

Traversal plans are read-only.

Risk is normalized.

Routes are stable.

Milestones are stable.

Signals are stable.

Replay fingerprints are stable.

Mobile behavior remains semantically equivalent.

No prohibited ownership calls appear in traversal source.

## Maintenance guidance
Add new lanes only when an authoritative gameplay concept exists.

Add new risk factors only when a measurable world signal exists.

Add new phases only when the semantic progression cannot be expressed by the existing phases.

Add new signals only when a caller needs a distinct presentation action.

Do not add geometry generation here.

Do not add AI here.

Do not add save serialization here.

Do not add quest state here.

## Review checklist
Check that imports are read-only.

Check that outputs are deeply frozen.

Check that fingerprints are stable.

Check that mobile limits are bounded.

Check that route alternatives remain bounded.

Check that risk factors remain bounded.

Check that malformed numeric inputs are safe.

Check that ownership flags remain explicit.

Check that scenario catalogue cardinality is stable.

Check that regression scripts cover new vocabulary.

## Example lifecycle
A distant player receives orient phase.

The gateway lane is visible.

A route resolver ranks safe and direct alternatives.

The risk layer notices fog.

Pacing changes to crawl.

A slow signal becomes primary.

The player approaches the threshold.

The milestone projection activates threshold-reached.

The gateway becomes available.

The signal arbitration exposes enter.

The player enters settlement context.

A service recommendation becomes active.

The milestone becomes service-reached.

On departure, the route resolver prioritizes the gateway.

Pacing can move to steady or rush depending on risk.

The replay envelope records the latest frame.

No subsystem above writes world state.

## Boundary guarantee
The traversal layer is a consumer of world evidence.

It is not a second world engine.

It is not a second road engine.

It is not a second save engine.

It is not a second quest engine.

It is not a second actor engine.

It is a deterministic presentation and planning layer.
