# Traversal Decision Matrix

## Matrix intent
This matrix records deterministic expectations for traversal planning.

### 001
Scenario: distant clear gateway.
Stage: far.
Lane: gateway.
Risk: normal.
Phase: orient.
Pacing: steady.
Signal: navigate.
Fallback: observe.

### 002
Scenario: distant market landmark.
Stage: far.
Lane: market.
Risk: normal.
Phase: orient.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 003
Scenario: distant tavern in rain.
Stage: far.
Lane: tavern.
Risk: warning.
Phase: orient.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 004
Scenario: distant craft route in wind.
Stage: far.
Lane: craft.
Risk: normal.
Phase: orient.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 005
Scenario: distant farm route.
Stage: far.
Lane: farm.
Risk: normal.
Phase: orient.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 006
Scenario: distant military route in fog.
Stage: far.
Lane: military.
Risk: warning.
Phase: orient.
Pacing: crawl.
Signal: slow.
Fallback: observe.

### 007
Scenario: distant stable route in snow.
Stage: far.
Lane: stable.
Risk: warning.
Phase: orient.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 008
Scenario: distant home route.
Stage: far.
Lane: home.
Risk: normal.
Phase: orient.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 009
Scenario: distant river route.
Stage: far.
Lane: river.
Risk: warning.
Phase: orient.
Pacing: crawl.
Signal: observe.
Fallback: ridge.

### 010
Scenario: distant ridge route.
Stage: far.
Lane: ridge.
Risk: normal.
Phase: orient.
Pacing: steady.
Signal: observe.
Fallback: gateway.

### 011
Scenario: approach gateway in clear weather.
Stage: approach.
Lane: gateway.
Risk: normal.
Phase: commit.
Pacing: steady.
Signal: navigate.
Fallback: observe.

### 012
Scenario: approach market in clear weather.
Stage: approach.
Lane: market.
Risk: normal.
Phase: commit.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 013
Scenario: approach tavern in rain.
Stage: approach.
Lane: tavern.
Risk: warning.
Phase: commit.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 014
Scenario: approach craft in wind.
Stage: approach.
Lane: craft.
Risk: normal.
Phase: commit.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 015
Scenario: approach farm in open terrain.
Stage: approach.
Lane: farm.
Risk: normal.
Phase: commit.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 016
Scenario: approach military in fog.
Stage: approach.
Lane: military.
Risk: warning.
Phase: commit.
Pacing: crawl.
Signal: slow.
Fallback: observe.

### 017
Scenario: approach stable in snow.
Stage: approach.
Lane: stable.
Risk: warning.
Phase: commit.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 018
Scenario: approach home at dusk.
Stage: approach.
Lane: home.
Risk: normal.
Phase: commit.
Pacing: steady.
Signal: navigate.
Fallback: gateway.

### 019
Scenario: approach river during rain.
Stage: approach.
Lane: river.
Risk: warning.
Phase: commit.
Pacing: crawl.
Signal: observe.
Fallback: ridge.

### 020
Scenario: approach ridge in wind.
Stage: approach.
Lane: ridge.
Risk: normal.
Phase: commit.
Pacing: steady.
Signal: observe.
Fallback: gateway.

### 021
Scenario: threshold gateway available.
Stage: threshold.
Lane: gateway.
Risk: normal.
Phase: arrive.
Pacing: walk.
Signal: enter.
Fallback: observe.

### 022
Scenario: threshold market priority.
Stage: threshold.
Lane: market.
Risk: normal.
Phase: arrive.
Pacing: walk.
Signal: service.
Fallback: gateway.

### 023
Scenario: threshold tavern in rain.
Stage: threshold.
Lane: tavern.
Risk: warning.
Phase: arrive.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 024
Scenario: threshold craft in wind.
Stage: threshold.
Lane: craft.
Risk: normal.
Phase: arrive.
Pacing: walk.
Signal: service.
Fallback: gateway.

### 025
Scenario: threshold farm.
Stage: threshold.
Lane: farm.
Risk: normal.
Phase: arrive.
Pacing: walk.
Signal: navigate.
Fallback: gateway.

### 026
Scenario: threshold military fog.
Stage: threshold.
Lane: military.
Risk: warning.
Phase: arrive.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 027
Scenario: threshold stable snow.
Stage: threshold.
Lane: stable.
Risk: warning.
Phase: arrive.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 028
Scenario: threshold home.
Stage: threshold.
Lane: home.
Risk: normal.
Phase: arrive.
Pacing: walk.
Signal: service.
Fallback: gateway.

### 029
Scenario: threshold river crossing.
Stage: threshold.
Lane: river.
Risk: warning.
Phase: arrive.
Pacing: crawl.
Signal: observe.
Fallback: gateway.

### 030
Scenario: threshold ridge.
Stage: threshold.
Lane: ridge.
Risk: normal.
Phase: arrive.
Pacing: walk.
Signal: observe.
Fallback: gateway.

### 031
Scenario: inside gateway context.
Stage: inside.
Lane: gateway.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: return.

### 032
Scenario: inside market context.
Stage: inside.
Lane: market.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: gateway.

### 033
Scenario: inside tavern context.
Stage: inside.
Lane: tavern.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: home.

### 034
Scenario: inside craft context.
Stage: inside.
Lane: craft.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: gateway.

### 035
Scenario: inside farm context.
Stage: inside.
Lane: farm.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: market.

### 036
Scenario: inside military context.
Stage: inside.
Lane: military.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: gateway.

### 037
Scenario: inside stable context.
Stage: inside.
Lane: stable.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: gateway.

### 038
Scenario: inside home context.
Stage: inside.
Lane: home.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: tavern.

### 039
Scenario: inside river context.
Stage: inside.
Lane: river.
Risk: warning.
Phase: linger.
Pacing: crawl.
Signal: observe.
Fallback: home.

### 040
Scenario: inside ridge context.
Stage: inside.
Lane: ridge.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: observe.
Fallback: gateway.

### 041
Scenario: service gateway.
Stage: service.
Lane: gateway.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: return.

### 042
Scenario: service market.
Stage: service.
Lane: market.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: tavern.

### 043
Scenario: service tavern.
Stage: service.
Lane: tavern.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: house.

### 044
Scenario: service craft.
Stage: service.
Lane: craft.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: market.

### 045
Scenario: service farm.
Stage: service.
Lane: farm.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: market.

### 046
Scenario: service military.
Stage: service.
Lane: military.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: stable.

### 047
Scenario: service stable.
Stage: service.
Lane: stable.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: gateway.

### 048
Scenario: service home.
Stage: service.
Lane: home.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: service.
Fallback: tavern.

### 049
Scenario: service river.
Stage: service.
Lane: river.
Risk: warning.
Phase: linger.
Pacing: crawl.
Signal: observe.
Fallback: gateway.

### 050
Scenario: service ridge.
Stage: service.
Lane: ridge.
Risk: normal.
Phase: linger.
Pacing: steady.
Signal: observe.
Fallback: gateway.

### 051
Scenario: departure gateway clear.
Stage: departure.
Lane: gateway.
Risk: normal.
Phase: return.
Pacing: rush.
Signal: return.
Fallback: observe.

### 052
Scenario: departure market clear.
Stage: departure.
Lane: market.
Risk: normal.
Phase: return.
Pacing: steady.
Signal: return.
Fallback: gateway.

### 053
Scenario: departure tavern rain.
Stage: departure.
Lane: tavern.
Risk: warning.
Phase: return.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 054
Scenario: departure craft wind.
Stage: departure.
Lane: craft.
Risk: normal.
Phase: return.
Pacing: steady.
Signal: return.
Fallback: gateway.

### 055
Scenario: departure farm.
Stage: departure.
Lane: farm.
Risk: normal.
Phase: return.
Pacing: steady.
Signal: return.
Fallback: gateway.

### 056
Scenario: departure military fog.
Stage: departure.
Lane: military.
Risk: warning.
Phase: return.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 057
Scenario: departure stable snow.
Stage: departure.
Lane: stable.
Risk: warning.
Phase: return.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 058
Scenario: departure home.
Stage: departure.
Lane: home.
Risk: normal.
Phase: return.
Pacing: steady.
Signal: return.
Fallback: gateway.

### 059
Scenario: departure river rain.
Stage: departure.
Lane: river.
Risk: warning.
Phase: return.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 060
Scenario: departure ridge wind.
Stage: departure.
Lane: ridge.
Risk: normal.
Phase: return.
Pacing: steady.
Signal: return.
Fallback: gateway.

### 061
Scenario: resume gateway.
Stage: resume.
Lane: gateway.
Risk: normal.
Phase: traverse.
Pacing: steady.
Signal: resume.
Fallback: navigate.

### 062
Scenario: resume market.
Stage: resume.
Lane: market.
Risk: normal.
Phase: traverse.
Pacing: steady.
Signal: resume.
Fallback: gateway.

### 063
Scenario: resume tavern rain.
Stage: resume.
Lane: tavern.
Risk: warning.
Phase: traverse.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 064
Scenario: resume craft.
Stage: resume.
Lane: craft.
Risk: normal.
Phase: traverse.
Pacing: steady.
Signal: resume.
Fallback: gateway.

### 065
Scenario: resume farm.
Stage: resume.
Lane: farm.
Risk: normal.
Phase: traverse.
Pacing: steady.
Signal: resume.
Fallback: gateway.

### 066
Scenario: resume military fog.
Stage: resume.
Lane: military.
Risk: warning.
Phase: traverse.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 067
Scenario: resume stable snow.
Stage: resume.
Lane: stable.
Risk: warning.
Phase: traverse.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 068
Scenario: resume home.
Stage: resume.
Lane: home.
Risk: normal.
Phase: traverse.
Pacing: steady.
Signal: resume.
Fallback: gateway.

### 069
Scenario: resume river.
Stage: resume.
Lane: river.
Risk: warning.
Phase: traverse.
Pacing: crawl.
Signal: slow.
Fallback: gateway.

### 070
Scenario: resume ridge.
Stage: resume.
Lane: ridge.
Risk: normal.
Phase: traverse.
Pacing: steady.
Signal: resume.
Fallback: gateway.

## Risk override matrix

### R001
Factor: fog.
Threshold: visibility below .45.
Action: slow.
Reason: route readability.

### R002
Factor: storm.
Threshold: intensity above .75.
Action: pause.
Reason: exposure.

### R003
Factor: steep grade.
Threshold: slope above 25 degrees.
Action: slow.
Reason: traversal cost.

### R004
Factor: water.
Threshold: active water surface.
Action: observe.
Reason: route ambiguity.

### R005
Factor: fatigue.
Threshold: fatigue above .75.
Action: recover.
Reason: pacing safety.

### R006
Factor: cold.
Threshold: temperature below zero.
Action: recover.
Reason: exposure.

### R007
Factor: blocked gateway.
Threshold: blocked state.
Action: observe.
Reason: no entry authorization.

### R008
Factor: missing road evidence.
Threshold: road visibility below .35.
Action: observe.
Reason: route confidence.

### R009
Factor: critical composite.
Threshold: risk at or above .78.
Action: pause.
Reason: bounded fail-safe.

### R010
Factor: warning composite.
Threshold: risk at or above .58.
Action: slow.
Reason: bounded caution.

## Mobile matrix

### M001
Mobile keeps the same stage vocabulary.
Mobile keeps the same lane vocabulary.
Mobile reduces waypoint count.
Mobile reduces signal count.
Mobile preserves deterministic ordering.
Mobile does not create a second planner.

### M002
Desktop lane selection remains authoritative.
Mobile receives the same semantic lane.
Only density and presentation budgets change.

### M003
Mobile accessibility can choose compact mode.
Compact mode reduces visible signal count.
Compact mode does not remove ownership guards.

### M004
Low-motion mode suppresses animation hints.
Low-motion mode does not suppress state semantics.

## Failure matrix

### F001
Null settlement.
Expected: normalized fallback settlement.
Expected: finite distance.
Expected: valid fingerprint.
Expected: no exception from public planner.

### F002
Null player.
Expected: empty player context.
Expected: far or neutral stage.
Expected: finite scores.

### F003
NaN hour.
Expected: atmosphere fallback through downstream experience.
Expected: no NaN in traversal packet.

### F004
Infinity fatigue.
Expected: bounded fatigue evidence.
Expected: validator remains safe.

### F005
Unknown route mode.
Expected: safe route mode.
Expected: deterministic choice.

### F006
Unknown lane request.
Expected: best eligible lane.
Expected: deterministic fallback.

### F007
Over-cap replay.
Expected: newest sixteen frames retained.
Expected: fingerprint remains stable.

### F008
Over-cap signals.
Expected: newest twelve signals retained.
Expected: primary list remains at four.

## Ownership matrix

### O001
Traversal source must not call scene.add.

### O002
Traversal source must not create geometry.

### O003
Traversal source must not create materials.

### O004
Traversal source must not mutate terrain.

### O005
Traversal source must not mutate roads.

### O006
Traversal source must not mutate hydrology.

### O007
Traversal source must not spawn NPCs.

### O008
Traversal source must not implement combat.

### O009
Traversal source must not own save state.

### O010
Traversal source must not own quest state.

## Review matrix

### V001
Check deterministic serialization.

### V002
Check deep freeze behavior.

### V003
Check route fallback.

### V004
Check risk normalization.

### V005
Check milestone vocabulary.

### V006
Check signal vocabulary.

### V007
Check mobile bounds.

### V008
Check replay bounds.

### V009
Check scenario uniqueness.

### V010
Check exact-head CI scope.
