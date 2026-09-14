# Geographic Asset Runtime Orchestration Playbook

This document records the expected runtime behaviour of the deterministic geographic asset system.
The entries are behavioural contracts, not hard-coded world coordinates.
A producer supplies canonical surface evidence and a region profile; the runtime selects families,
plans clusters, enforces chunk ownership, applies execution budgets, and audits the result.

## Contract 001 — North temperate forest / ambient
Input: region=north_temperate_forest, mode=ambient, moisture=.58-.88, elevation=100-1200.
Decision: prefer pine/birch/broadleaf and reject water surfaces unless the mode changes to shoreline.
Runtime: use deterministic continuity seed and bounded spacing; never sample a regular grid.
Quality: dense foliage is allowed only while chunk and mobile budgets remain respected.

## Contract 002 — North temperate forest / geology
Input: region=north_temperate_forest, mode=geology, moisture=.42-.88, elevation=100-1200.
Decision: favour wetboulder/weatheredstone/froststone according to canonical relief evidence.
Runtime: retain the same anchor seed across replay and neighbouring chunks.
Quality: geology must not create terrain, hydrology or collider mutations.

## Contract 003 — North temperate forest / roadside
Input: region=north_temperate_forest, mode=roadside, roadDistance finite and canonical.
Decision: lower density away from road influence and favour waystone-compatible families.
Runtime: keep the family decision separate from road geometry creation.
Quality: roadside assets must remain within the normal chunk lifecycle.

## Contract 004 — North temperate forest / settlementEdge
Input: region=north_temperate_forest, mode=settlementEdge, settlementDistance finite.
Decision: reduce wilderness density near settlement anchors and allow boundary props.
Runtime: settlement geometry remains authoritative; runtime only ranks asset families.
Quality: no settlement object may be created by the geographic layer.

## Contract 005 — North temperate forest / shoreline
Input: region=north_temperate_forest, mode=shoreline, shorelineDistance finite.
Decision: allow marshreed/wetboulder/driftwood where canonical water context supports them.
Runtime: water surfaces may be considered only through shoreline mode.
Quality: dock is permitted only where the producer confirms a viable waterside surface.

## Contract 006 — North windwood / ambient
Input: region=north_windwood, mode=ambient, moisture=.26-.62, elevation=0-1000.
Decision: prefer pine/birch/shrub and suppress tropical families.
Runtime: cold-wind seasonality may increase pine weighting without changing geometry.
Quality: density remains profile-driven and budget-capped.

## Contract 007 — North windwood / geology
Input: region=north_windwood, mode=geology, localRelief elevated.
Decision: use weatheredstone/wetboulder/froststone only when the context supports them.
Runtime: geological family choice remains deterministic by seed and context digest.
Quality: large rocks are placement candidates, not terrain edits.

## Contract 008 — North windwood / roadside
Input: region=north_windwood, mode=roadside, roadDistance finite.
Decision: use sparse waystones and weathered edge props.
Runtime: spacing is stricter than ambient foliage to preserve the road silhouette.
Quality: foreign-chunk candidates are rejected outside the ownership band.

## Contract 009 — North windwood / settlementEdge
Input: region=north_windwood, mode=settlementEdge, settlementDistance finite.
Decision: allow sparse timberfence and weatheredstone families.
Runtime: settlement anchors may supply multiple deterministic sub-anchors.
Quality: no asset placement can bypass the common world placement gate.

## Contract 010 — North windwood / shoreline
Input: region=north_windwood, mode=shoreline, water evidence canonical.
Decision: driftwood/wetboulder dominate; vegetation is secondary.
Runtime: shoreline mode receives the same exact-head deterministic checks.
Quality: deep-water ambient placement remains hard rejected.

## Contract 011 — North river vale / ambient
Input: region=north_river_vale, moisture=.55-1, low elevation.
Decision: favour meadowgrass, birch and wetboulder.
Runtime: river context changes family weights rather than modifying hydrology.
Quality: watermill remains optional and requires shoreline-compatible evidence.

## Contract 012 — North river vale / geology
Input: river-adjacent relief with geology mode.
Decision: wetboulder/weatheredstone receive higher scores.
Runtime: high local relief may widen candidate radial distribution.
Quality: the planner still enforces bounded candidate counts.

## Contract 013 — North river vale / roadside
Input: roadDistance finite, lowland canonical sample.
Decision: waystone receives positive regional bias.
Runtime: roadside candidates use owner-chunk filtering.
Quality: no road spline or mesh mutation occurs.

## Contract 014 — North river vale / settlementEdge
Input: settlementDistance finite near river lowlands.
Decision: timberfence and weatheredstone become competitive with meadowgrass.
Runtime: settlement edges do not bypass surface safety rules.
Quality: every accepted record remains replayable from seed.

## Contract 015 — North river vale / shoreline
Input: waterBody river/lake and low shoreline distance.
Decision: marshreed/wetboulder/watermill are preferred.
Runtime: shoreline mode may place water-adjacent assets while preserving canonical water ownership.
Quality: no terrain deepening, filling or shoreline deformation is permitted.

## Contract 016 — North high moor / ambient
Input: elevated moist open terrain.
Decision: shrub/meadowgrass/pine compete with cairn-adjacent context.
Runtime: lower density preserves moorland openness.
Quality: sparse classifications remain valid and are not treated as failures.

## Contract 017 — North high moor / geology
Input: high-relief moor sample.
Decision: froststone/cairn/weatheredstone may dominate.
Runtime: geology mode tightens slope tolerance through the upstream canonical sample.
Quality: extreme slope becomes a warning or rejection according to the placement authority.

## Contract 018 — North high moor / roadside
Input: road corridor through open highland.
Decision: waystone receives elevated score.
Runtime: radial candidates avoid a visually uniform row.
Quality: no regular grid generation is allowed.

## Contract 019 — North high moor / settlementEdge
Input: sparse settlement in highland terrain.
Decision: timberfence/waystone appear only near valid settlement influence.
Runtime: settlement density remains profile driven.
Quality: ownership continues across chunk boundaries.

## Contract 020 — North high moor / shoreline
Input: small canonical pond/lake boundary.
Decision: wetboulder/marshreed increase with moisture.
Runtime: shoreline candidates remain bounded.
Quality: deep-water families remain blocked unless explicitly compatible.

## Contract 021 — North snowline / ambient
Input: elevation above local snowline with snowPersistence high.
Decision: snowpine/froststone displace broadleaf.
Runtime: seasonality scales vegetation suppression without altering terrain.
Quality: winter bias must still remain deterministic.

## Contract 022 — North snowline / geology
Input: alpine relief, cold climate.
Decision: froststone/snowpine/cairn bias rises.
Runtime: candidate radius follows profile continuity radius.
Quality: geological candidates remain ordinary placement records.

## Contract 023 — North snowline / roadside
Input: high mountain route.
Decision: waystone/cairn appear sparsely.
Runtime: spacing is tightened to avoid blocking the route silhouette.
Quality: road geometry remains external authority.

## Contract 024 — North snowline / settlementEdge
Input: high elevation settlement fringe.
Decision: settlement-edge props are sparse and weather-resistant.
Runtime: mobile budget is reduced without changing family identity rules.
Quality: desktop/mobile must reproduce the same family decision for the same context.

## Contract 025 — North snowline / shoreline
Input: frozen lake margin or meltwater edge.
Decision: froststone/wetboulder dominate; reeds depend on moisture.
Runtime: shoreline mode remains the only water-aware distribution mode.
Quality: asset placement must not fake ice geometry by terrain mutation.

## Contract 026 — Beyond Wall snowfield / ambient
Input: tundra/snowfield, low biological productivity.
Decision: froststone/snowpine dominate, broadleaf is suppressed.
Runtime: density is intentionally sparse.
Quality: low sample counts remain valid and do not trigger false organic failures.

## Contract 027 — Beyond Wall snowfield / geology
Input: high relief cold rock.
Decision: froststone/granite/cairn candidates are favoured.
Runtime: deterministic seeds ensure repeatable snowfield silhouettes.
Quality: no random-per-frame drift is permitted.

## Contract 028 — Beyond Wall snowfield / roadside
Input: remote pass road.
Decision: waystone/cairn remain rare landmarks.
Runtime: boundary ownership prevents duplicated landmarks.
Quality: remote chunks remain bounded by mobile budget.

## Contract 029 — Beyond Wall snowfield / settlementEdge
Input: temporary encampment or settlement fringe.
Decision: weathered props are allowed only from producer-supplied anchors.
Runtime: no settlement structure generation occurs here.
Quality: all edge assets inherit common placement validation.

## Contract 030 — Beyond Wall snowfield / shoreline
Input: frozen water boundary.
Decision: froststone/wetboulder/driftwood remain valid where canonical water context says so.
Runtime: shoreline assets stay inside continuity windows.
Quality: ownership is resolved before execution.

## Contract 031 — Riverlands floodplain / ambient
Input: wet lowland, high moisture.
Decision: meadowgrass/marshreed dominate.
Runtime: dense but organic distribution is expected.
Quality: family share and nearest-neighbour telemetry are audited.

## Contract 032 — Riverlands floodplain / geology
Input: wet floodplain with exposed rocks.
Decision: wetboulder receives strong bias.
Runtime: rocks stay away from impossible water-depth samples.
Quality: geology never alters river flow.

## Contract 033 — Riverlands floodplain / roadside
Input: lowland road near water.
Decision: waystone/timberfence remain sparse.
Runtime: road mode uses stronger minimum spacing.
Quality: no road mutation is permitted.

## Contract 034 — Riverlands floodplain / settlementEdge
Input: farm settlement in floodplain.
Decision: timberfence/meadowgrass increase.
Runtime: water proximity still wins for shoreline-only assets.
Quality: no asset may be accepted from water unless family-compatible.

## Contract 035 — Riverlands floodplain / shoreline
Input: river channel/flood margin.
Decision: marshreed/wetboulder/watermill dominate.
Runtime: shoreline candidates may carry across chunk boundaries.
Quality: duplicate carry records are deduplicated before execution.

## Contract 036 — Riverlands meadow / ambient
Input: fertile open meadow.
Decision: meadowgrass dominates with broadleaf accents.
Runtime: balanced density is preferred over maximum density.
Quality: organic audit score should remain healthy at sufficient sample size.

## Contract 037 — Riverlands meadow / geology
Input: rolling meadow with exposed stone.
Decision: weatheredstone/wetboulder are secondary.
Runtime: radial clusters prevent evenly spaced rock rows.
Quality: spacing telemetry must not show a grid-like minimum pattern.

## Contract 038 — Riverlands meadow / roadside
Input: travelled road through meadow.
Decision: waystone/timberfence receive road bias.
Runtime: road mode remains renderer agnostic.
Quality: common placement authority owns all final transforms.

## Contract 039 — Riverlands meadow / settlementEdge
Input: farm or village edge.
Decision: timberfence dominates, meadowgrass remains background.
Runtime: settlement anchors may produce several small clusters.
Quality: chunk budget is global after anchor plans merge.

## Contract 040 — Riverlands meadow / shoreline
Input: pond/lake edge in fertile lowland.
Decision: reeds and wetboulders increase with moisture.
Runtime: dock remains rare and evidence dependent.
Quality: water-family mismatch is audited.

## Contract 041 — Riverlands wetwood / ambient
Input: humid wooded lowland.
Decision: broadleaf/fern/birch become dominant.
Runtime: high density is permitted within budget.
Quality: family entropy prevents one-tree-family takeover.

## Contract 042 — Riverlands wetwood / geology
Input: wet forest with rocky ground.
Decision: wetboulder/weatheredstone appear as breaks in vegetation.
Runtime: geology candidates use relief weighting.
Quality: no tree or rock changes terrain normals.

## Contract 043 — Riverlands wetwood / roadside
Input: road through wetwood.
Decision: sparse waystone plus vegetation fringe.
Runtime: road candidates keep larger spacing than ambient.
Quality: visibility culling can defer distant assets.

## Contract 044 — Riverlands wetwood / settlementEdge
Input: woodland near settlement.
Decision: timberfence and meadowgrass become transition families.
Runtime: settlement edge lowers forest density near anchor boundaries.
Quality: transition should be deterministic across chunk edges.

## Contract 045 — Riverlands wetwood / shoreline
Input: wet forest adjacent to river.
Decision: marshreed/wetboulder mix increases at water edge.
Runtime: shoreline mode receives the strongest water semantics.
Quality: shoreline distance must come from canonical producer evidence.

## Contract 046 — Vale high valley / ambient
Input: elevated green valley.
Decision: meadowgrass/pine mix.
Runtime: density stays moderate.
Quality: mountain geometry is external to distribution.

## Contract 047 — Vale high valley / geology
Input: mountain valley with exposed granite.
Decision: granite/cairn dominate.
Runtime: slope and elevation are first-class context inputs.
Quality: large relief assets remain placement records.

## Contract 048 — Vale high valley / roadside
Input: steep but travelled mountain route.
Decision: waystone is preferred over vegetation.
Runtime: slope rejection belongs to upstream surface validation.
Quality: impossible slopes never reach execution.

## Contract 049 — Vale high valley / settlementEdge
Input: highland settlement edge.
Decision: weatheredstone/timberfence remain sparse.
Runtime: mobile execution uses smaller visibility caps.
Quality: desktop and mobile share plan digests.

## Contract 050 — Vale high valley / shoreline
Input: high valley lake edge.
Decision: wetboulder dominates with small reed clusters.
Runtime: shoreline mode remains bounded.
Quality: no lake mesh or shoreline terrain mutation occurs.

## Contract 051 — Vale mountain foothill / ambient
Input: high slope, moderate moisture.
Decision: pine/shrub dominate.
Runtime: density falls as elevation and slope rise.
Quality: sparse output is intentional.

## Contract 052 — Vale mountain foothill / geology
Input: rocky foothill.
Decision: granite receives strong regional bias.
Runtime: geological clusters are radially distributed.
Quality: no periodic grid signature should appear.

## Contract 053 — Vale mountain foothill / roadside
Input: mountain passage.
Decision: waystone/cairn are landmark candidates.
Runtime: chunk ownership resolves boundary cases.
Quality: repeated loads must preserve the same landmark identity.

## Contract 054 — Vale mountain foothill / settlementEdge
Input: hillfort or pass settlement edge.
Decision: weatheredstone and waystone increase.
Runtime: settlement props remain renderer neutral.
Quality: no settlement geometry is authored here.

## Contract 055 — Vale mountain foothill / shoreline
Input: steep stream/lake edge.
Decision: wetboulder dominates; reeds require moisture.
Runtime: shoreline candidate generation respects slope evidence.
Quality: assets are still routed through the shared placement layer.

## Contract 056 — Westerlands woodland / ambient
Input: temperate woodland and moderate moisture.
Decision: broadleaf/birch/fern dominate.
Runtime: dense but non-uniform clusters are expected.
Quality: organic audit uses family share and nearest-neighbour metrics.

## Contract 057 — Westerlands woodland / geology
Input: woodland with limestone or weathered stone.
Decision: limestone/weatheredstone become secondary accents.
Runtime: geology never edits the forest floor.
Quality: deterministic family ranking is preserved.

## Contract 058 — Westerlands woodland / roadside
Input: road through woodland.
Decision: waystone remains sparse.
Runtime: roadside mode uses independent budget.
Quality: budget exhaustion produces deferral, not silent overflow.

## Contract 059 — Westerlands woodland / settlementEdge
Input: castle or farm perimeter.
Decision: timberfence/waystone/ruinwall compete.
Runtime: settlement edge remains lower density than ambient woodland.
Quality: boundary carry is deduplicated.

## Contract 060 — Westerlands woodland / shoreline
Input: wooded coastal edge.
Decision: driftwood/wetboulder increase.
Runtime: shoreline mode dominates local water semantics.
Quality: deep-water placement is rejected.

## Contract 061 — Reach fertile plain / ambient
Input: fertile open grassland.
Decision: meadowgrass is the dominant family.
Runtime: high density is permitted until the chunk cap.
Quality: directional bias should remain low enough for organic classification.

## Contract 062 — Reach fertile plain / geology
Input: fertile plain with exposed stone.
Decision: weatheredstone remains a rare break.
Runtime: low density avoids turning fields into rock gardens.
Quality: geology budget is independent from ambient budget.

## Contract 063 — Reach fertile plain / roadside
Input: heavily used road.
Decision: waystone/timberfence dominate road-adjacent props.
Runtime: road mode remains sparse and readable.
Quality: common ownership prevents double-spawn on chunk borders.

## Contract 064 — Reach fertile plain / settlementEdge
Input: farm, orchard or village edge.
Decision: timberfence/marketstall/meadowgrass mix.
Runtime: settlement anchors may have multiple sub-clusters.
Quality: global budget applies after all sub-clusters merge.

## Contract 065 — Reach fertile plain / shoreline
Input: river or lake crossing the plain.
Decision: marshreed/wetboulder increase sharply near shoreline.
Runtime: watermill may appear only with canonical support.
Quality: no hydrology changes are allowed.

## Contract 066 — Crownlands lowland / ambient
Input: mixed lowland near dense travel routes.
Decision: meadowgrass/shrub/broadleaf mix.
Runtime: lower density reduces visual clutter.
Quality: road and settlement modes remain separate.

## Contract 067 — Crownlands lowland / geology
Input: lowland exposed stone.
Decision: weatheredstone is a secondary family.
Runtime: geology clusters stay bounded by low slope.
Quality: no terrain bake is performed by runtime distribution.

## Contract 068 — Crownlands lowland / roadside
Input: major road corridor.
Decision: waystone receives strong road bias.
Runtime: roadside assets are prioritised by distance and score.
Quality: owner-chunk sorting resolves boundary cases.

## Contract 069 — Crownlands lowland / settlementEdge
Input: city/town fringe.
Decision: marketstall/timberfence/waystone gain priority.
Runtime: dense props are execution-capped.
Quality: mobile visibility uses a lower cap without changing semantic selection.

## Contract 070 — Crownlands lowland / shoreline
Input: river mouth or harbor approach.
Decision: dock/marshreed/wetboulder become viable.
Runtime: shoreline mode is the only water-aware path.
Quality: dock suitability must come from canonical surface evidence.

## Contract 071 — Stormlands wet forest / ambient
Input: very wet forest.
Decision: broadleaf/fern dominate.
Runtime: higher moisture increases clustering density.
Quality: organic audit should reject only true pathological dominance.

## Contract 072 — Stormlands wet forest / geology
Input: wet forest with exposed basalt.
Decision: wetboulder/basalt increase.
Runtime: geology candidates use relief-aware radial placement.
Quality: no volcanic terrain mutation is implied by family selection.

## Contract 073 — Stormlands wet forest / roadside
Input: wet road through woodland.
Decision: waystone remains rare and visible.
Runtime: spacing is conservative.
Quality: distant assets may be deferred by the execution adapter.

## Contract 074 — Stormlands wet forest / settlementEdge
Input: wet settlement perimeter.
Decision: timberfence/waystone appear as transition props.
Runtime: settlement anchors share the same boundary ownership rules.
Quality: no settlement graph mutation occurs.

## Contract 075 — Stormlands wet forest / shoreline
Input: rain-fed river/coast.
Decision: wetboulder/driftwood dominate.
Runtime: shoreline mode suppresses non-water families.
Quality: water-family mismatch remains an audit error.

## Contract 076 — Dorne desert core / ambient
Input: dry desert, low moisture.
Decision: desertgrass/sandstone dominate.
Runtime: vegetation density is intentionally low.
Quality: broadleaf/birch/marshreed should not dominate the result.

## Contract 077 — Dorne desert core / geology
Input: arid open rock.
Decision: sandstone/ashrock are preferred.
Runtime: geology mode may remain sparse.
Quality: rock assets never fabricate dunes or terrain geometry.

## Contract 078 — Dorne desert core / roadside
Input: dust road across desert.
Decision: waystone/sandstone are preferred landmarks.
Runtime: long spacing preserves route readability.
Quality: budget caps must still be respected.

## Contract 079 — Dorne desert core / settlementEdge
Input: arid settlement fringe.
Decision: marketstall/timberfence compete only where settlement context exists.
Runtime: settlement edge remains sparse outside anchor radius.
Quality: no building placement is performed here.

## Contract 080 — Dorne desert core / shoreline
Input: oasis or coast.
Decision: marshreed/driftwood/sandstone depend on canonical water evidence.
Runtime: shoreline mode bypasses desert-only suppression where justified.
Quality: water depth remains an explicit safety signal.

## Contract 081 — Dorne red mesa / ambient
Input: dry elevated red-rock terrain.
Decision: desertgrass/shrub break the stone expanses.
Runtime: candidate radius follows dry-region profile continuity.
Quality: density remains low.

## Contract 082 — Dorne red mesa / geology
Input: exposed red sandstone.
Decision: sandstone receives strongest family bias.
Runtime: geology clusters should read as irregular outcrops.
Quality: no regular grid placement is permitted.

## Contract 083 — Dorne red mesa / roadside
Input: route across mesa.
Decision: waystone is sparse but visible.
Runtime: boundary ownership avoids duplicate route markers.
Quality: renderer-independent records are emitted.

## Contract 084 — Dorne red mesa / settlementEdge
Input: remote fort edge.
Decision: weatheredstone/timberfence may appear near anchor.
Runtime: mobile caps reduce visible count.
Quality: semantic family selection remains unchanged.

## Contract 085 — Dorne red mesa / shoreline
Input: canyon stream/lake pocket.
Decision: wetboulder and reeds can override arid bias locally.
Runtime: shoreline evidence wins over broad regional dryness.
Quality: local sample remains authoritative.

## Contract 086 — Iron Islands wind coast / ambient
Input: wet windy coast.
Decision: shrub/driftwood are sparse; stone is prominent.
Runtime: wind exposure keeps density low.
Quality: no coastal cliff geometry is generated.

## Contract 087 — Iron Islands wind coast / geology
Input: exposed basalt coast.
Decision: basalt/wetboulder dominate.
Runtime: radial geology clusters avoid linear rock rows.
Quality: ownership band handles cliff-boundary chunks.

## Contract 088 — Iron Islands wind coast / roadside
Input: coastal road.
Decision: weatheredstone/waystone remain minimal.
Runtime: road mode is budgeted separately.
Quality: route surfaces remain canonical inputs.

## Contract 089 — Iron Islands wind coast / settlementEdge
Input: harbor or village fringe.
Decision: timberfence/dock candidates increase.
Runtime: settlement-edge mode can merge with shoreline evidence.
Quality: duplicate boundary candidates are removed before execution.

## Contract 090 — Iron Islands wind coast / shoreline
Input: rocky harbor edge.
Decision: dock/driftwood/wetboulder dominate.
Runtime: water-aware selection remains deterministic.
Quality: dock records are accepted only with viable shoreline context.

## Contract 091 — Mountain granite ridge / ambient
Input: extreme elevation and low vegetation.
Decision: vegetation becomes sparse; granite is background geology.
Runtime: density scale follows profile.
Quality: low-sample audit remains valid.

## Contract 092 — Mountain granite ridge / geology
Input: granite ridge with high relief.
Decision: granite dominates strongly.
Runtime: geology mode is the primary distribution path.
Quality: slope evidence must come from the producer.

## Contract 093 — Mountain granite ridge / roadside
Input: mountain pass carved through ridge.
Decision: waystone/cairn landmarks are favoured.
Runtime: large separation avoids blocking navigation.
Quality: common placement authority remains final gate.

## Contract 094 — Mountain granite ridge / settlementEdge
Input: isolated mountain settlement edge.
Decision: weatheredstone/cairn dominate sparse edge props.
Runtime: mobile execution is heavily capped.
Quality: desktop and mobile share the same plan digest.

## Contract 095 — Mountain granite ridge / shoreline
Input: alpine lake or meltwater.
Decision: wetboulder/froststone become viable.
Runtime: shoreline candidates remain bounded and owner-resolved.
Quality: no ice/water mesh is created.

## Contract 096 — Volcanic basalt field / ambient
Input: dark volcanic ground with low-to-moderate moisture.
Decision: shrub/desertgrass appear sparsely between basalt outcrops.
Runtime: low biological density is expected.
Quality: asset distribution does not imply volcanic terrain generation.

## Contract 097 — Volcanic basalt field / geology
Input: basalt-rich field.
Decision: basalt/ashrock dominate.
Runtime: large candidates remain placement-only records.
Quality: geometry must be supplied by the shared asset system.

## Contract 098 — Volcanic basalt field / roadside
Input: road crossing volcanic terrain.
Decision: basalt/waystone combinations are preferred.
Runtime: route readability is protected by spacing.
Quality: no road edits occur.

## Contract 099 — Volcanic basalt field / settlementEdge
Input: settlement near volcanic terrain.
Decision: weatheredstone/ashrock/timberfence appear according to anchor.
Runtime: settlement-edge budget remains capped.
Quality: no buildings or walls are spawned by the runtime orchestrator.

## Contract 100 — Volcanic basalt field / shoreline
Input: volcanic coast or crater water.
Decision: wetboulder/basalt/driftwood dominate.
Runtime: shoreline mode may override dry bias locally.
Quality: water evidence stays canonical.

## Contract 101 — Ruined lowland / ambient
Input: overgrown ruins on lowland.
Decision: broadleaf/fern/shrub mix with ruinwall accents.
Runtime: decay profile is layered over canonical biome context.
Quality: ruins remain ordinary asset families.

## Contract 102 — Ruined lowland / geology
Input: collapsed stone ground.
Decision: weatheredstone/ruinwall receive high priority.
Runtime: clusters are radial and irregular.
Quality: no ruin collision graph is authored by the distribution layer.

## Contract 103 — Ruined lowland / roadside
Input: old road near ruins.
Decision: waystone/ruinwall mix.
Runtime: route markers remain sparse.
Quality: owner-chunk logic prevents duplicate ruins.

## Contract 104 — Ruined lowland / settlementEdge
Input: former settlement perimeter.
Decision: ruinwall/weatheredstone dominate edge context.
Runtime: no settlement mutation is allowed.
Quality: shared placement validation remains mandatory.

## Contract 105 — Ruined lowland / shoreline
Input: ruined harbor/river edge.
Decision: ruinwall/wetboulder/driftwood mix.
Runtime: shoreline evidence controls water compatibility.
Quality: no hydrology modification is allowed.

## Contract 106 — Settlement market edge / ambient
Input: dense settlement surroundings.
Decision: meadowgrass is reduced in favour of subtle edge vegetation.
Runtime: ambient assets remain subordinate to settlement props.
Quality: execution cap protects frame budget.

## Contract 107 — Settlement market edge / geology
Input: stone market square perimeter.
Decision: weatheredstone/waystone are strong candidates.
Runtime: low slope is expected from canonical evidence.
Quality: building geometry remains external.

## Contract 108 — Settlement market edge / roadside
Input: busy road beside market.
Decision: waystone/timberfence remain visible but sparse.
Runtime: road mode gets its own budget bucket.
Quality: no road reconstruction occurs.

## Contract 109 — Settlement market edge / settlementEdge
Input: market or town boundary.
Decision: marketstall/timberfence are dominant.
Runtime: multi-anchor planning can organize districts without grids.
Quality: global chunk cap still wins over per-anchor preferences.

## Contract 110 — Settlement market edge / shoreline
Input: waterside market.
Decision: dock/marketstall/driftwood become viable.
Runtime: shoreline mode is combined with settlement context, not merged geometrically.
Quality: water placement stays canonical and auditable.

## Contract 111 — Settlement farm edge / ambient
Input: farmland transition to wilderness.
Decision: meadowgrass/broadleaf are common.
Runtime: ambient density softly falls toward the settlement anchor.
Quality: transition remains continuous between chunks.

## Contract 112 — Settlement farm edge / geology
Input: field edge with exposed stone.
Decision: weatheredstone remains secondary.
Runtime: radial clusters break up field edges.
Quality: no crop geometry mutation is performed.

## Contract 113 — Settlement farm edge / roadside
Input: farm lane.
Decision: timberfence/waystone are strong candidates.
Runtime: minimum spacing avoids fence duplication.
Quality: road ownership remains external.

## Contract 114 — Settlement farm edge / settlementEdge
Input: farm perimeter.
Decision: timberfence dominates; marketstall is rare.
Runtime: anchor planning may use several micro-clusters.
Quality: chunk merge resolves overlapping candidates.

## Contract 115 — Settlement farm edge / shoreline
Input: waterside farm.
Decision: wetboulder/marshreed/timberfence blend according to distance.
Runtime: shoreline mode remains bounded.
Quality: no irrigation or hydrology changes occur.

## Contract 116 — Settlement harbor edge / ambient
Input: harbor fringe away from immediate water.
Decision: low vegetation and utility props.
Runtime: ambient assets remain subordinate to settlement context.
Quality: distant props can be billboarded or deferred.

## Contract 117 — Settlement harbor edge / geology
Input: rocky harbor embankment.
Decision: wetboulder/weatheredstone gain priority.
Runtime: geological assets use low-slope canonical samples.
Quality: embankment geometry is not modified.

## Contract 118 — Settlement harbor edge / roadside
Input: road to harbor.
Decision: waystone/timberfence are preferred.
Runtime: road candidates remain readable.
Quality: no route geometry mutation.

## Contract 119 — Settlement harbor edge / settlementEdge
Input: port perimeter.
Decision: dock/timberfence/marketstall dominate.
Runtime: multi-anchor shoreline and settlement plans may be merged deterministically.
Quality: duplicate candidates are deduplicated by canonical key.

## Contract 120 — Settlement harbor edge / shoreline
Input: direct harbor edge.
Decision: dock/driftwood/wetboulder are primary families.
Runtime: shoreline distance and water body evidence are mandatory.
Quality: any water-family mismatch becomes an audit failure.

## Runtime implementation rule A — deterministic seed
Every anchor plan must derive candidate jitter from a stable seed and canonical world position.
A frame counter must never be included in the family or position seed.
Replay of identical inputs must produce identical plan and execution digests.

## Runtime implementation rule B — boundary ownership
Any candidate inside the chunk boundary band gets a deterministic owner chunk.
The owner is resolved before final execution so adjacent chunks do not both instantiate the same asset.
Carry data may cross chunk boundaries only inside the configured continuity window.

## Runtime implementation rule C — global budget
Per-anchor candidate counts are advisory; the final chunk budget is global.
Merged anchor results are sorted by deterministic priority before the final cap is applied.
Budget overflow becomes a rejected/deferred record and must remain observable to telemetry.

## Runtime implementation rule D — mobile parity
Mobile changes visibility, creation rate and resident chunk budgets, not semantic family selection.
A mobile plan and a desktop plan created from identical canonical inputs must share the same family logic.
Only execution-level caps and LOD transitions may differ.

## Runtime implementation rule E — no grid sampling
Candidate generation uses jittered radial placement rather than a regular XY/XZ lattice.
Spacing rejection and deterministic angular offsets prevent obvious rows and columns.
Future planners must preserve this architectural constraint unless the placement strategy is explicitly replaced.

## Runtime implementation rule F — water safety
Water surfaces are hard rejected for ordinary ambient families.
Shoreline-compatible families may be considered only when canonical water evidence exists.
Dock, driftwood and wetboulder remain subject to the producer's final surface authority.

## Runtime implementation rule G — authority boundary
Terrain generation owns heights, normals and conforming geometry.
Hydrology owns water bodies and shoreline topology.
Road and settlement systems own their geometry and semantic anchors.
Geographic runtime owns only ranking, candidate planning, execution budgeting and diagnostics.

## Runtime implementation rule H — material boundary
The geographic layer never creates or mutates materials.
Final placement must still pass through the shared material/placement gate.
Any future direct renderer hook should be an execution adapter, not a replacement for shared authority.

## Runtime implementation rule I — audit thresholds
Organic distribution diagnostics use nearest-neighbour, family entropy and shape metrics.
Low-sample cases must not be falsely classified as pathological.
Boundary leak rate and family dominance are reported separately so tuning remains interpretable.

## Runtime implementation rule J — operational workflow
Exact-head CI must check the precise commit that triggered the workflow.
Syntax, test matrices, architecture markers and deterministic replay checks must run before merge.
Artifacts should retain the tested head SHA and policy identifiers for auditability.
