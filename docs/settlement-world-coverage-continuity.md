# Settlement World Coverage — Geographic Continuity Contract

## 1. Scope

This document defines the cross-scale seam between an authored settlement campaign and the deterministic geographic asset runtime. It exists to make the transition from open world to settlement and back feel continuous without creating a second terrain system, a second placement engine, a second quest engine, or a second save engine.

The continuity feature is deliberately additive. The settlement campaign runtime remains the authority for player-facing settlement actions. The geographic asset runtime remains the authority for world-scale asset orchestration. The continuity bridge translates evidence and state between them.

The bridge is suitable for deterministic tests, runtime instrumentation, UX planning and checkpoint inspection. It is not a scene loader and it does not instantiate meshes.

## 2. Authoritative ownership

| Concern | Authority | Continuity responsibility |
|---|---|---|
| Settlement services | settlement campaign content/runtime | expose canonical service vocabulary |
| Quest state | existing QuestSystem seam | show context only |
| Dialogue conditions | settlement content | resolve/read only |
| Trade/economy | settlement campaign runtime | request/read quote only |
| Crafting | settlement campaign runtime | request/read readiness only |
| Travel | settlement campaign runtime | request/read route quote only |
| Save/load | existing save system | serialize compact presentation checkpoint |
| Terrain | geographic/terrain owner | consume surface evidence only |
| Roads | world/road owner | read distance/context only |
| Asset distribution | geographic asset runtime | share chunk/seed continuity |
| Model/material placement | shared placement pipeline | never replace authority |
| NPC/combat | existing game systems | never duplicate |

A continuity module may call a public contract from an authority. It may not silently reimplement the authority.

## 3. Canonical services

The continuity vocabulary has exactly eight services. These IDs are shared with the settlement world coverage slice and the acceptance proof.

| Service | Primary loop | Secondary loops | Typical approach focus |
|---|---|---|---|
| gate | enter/exit | travel | route |
| market | trade | buy/sell/talk | commerce |
| tavern | rest | dialogue/quest | recovery |
| blacksmith | craft | equipment/trade | production |
| farm | interact | rest/travel/trade | survival |
| barracks | train | quest/equipment | readiness |
| stable | travel | rest/trade/talk | mobility |
| house | save | rest/equipment/talk | persistence |

## 4. Transition stages

The bridge models seven stages rather than a binary outside/inside flag.

| Stage | Intent | Player expectation | Runtime note |
|---|---|---|---|
| far | orient | recognize settlement region | low presentation budget |
| approach | prepare | see route and boundary cues | preserve chunk continuity |
| threshold | enter | gateway becomes usable | entry is deterministic |
| inside | settle | services become actionable | settlement runtime dominates |
| service | interact | selected service context | UX planning only |
| departure | leave | route and surrounding world visible | reverse transition |
| resume | restore | return to last settlement context | checkpoint validated |

The stages are semantic. They do not imply that the engine teleports the player or swaps scenes at a fixed distance.

## 5. Distance contract

Default authored radii are:

- approach radius: 150 meters;
- arrival/threshold radius: 36 meters;
- departure radius: 52 meters.

The threshold is where a settlement can be offered as an entry action. The approach band is where the world should prepare a readable relationship between settlement and surrounding geography.

The exact distance values remain data, not an excuse for hard-coded terrain changes. A caller may supply settlement-specific radii while preserving the same semantic order.

## 6. Geographic seam

The continuity bridge consumes the geographic runtime through deterministic helpers:

```text
settlement anchor
      |
      +--> chunkKeyFor
      +--> boundaryOwnerFor (inside buildAnchorRuntimeContext)
      +--> continuitySeedFor
      +--> continuityWindowForChunk
      +--> pointInWindow
      +--> deterministicJitter
```

This creates a common spatial vocabulary with the geographic asset runtime. It does not copy geographic asset logic into settlement code.

### 6.1 Why chunk ownership matters

A settlement gate or approach marker that changes owner chunks between replays can pop visually, duplicate, or disappear when neighbouring chunks stream. The bridge therefore records both the settlement world chunk and the world continuity owner.

The owner decision is stable for a fixed anchor and policy. The transition proof keeps the relevant identifiers so a failed replay is diagnosable without opening a scene editor.

### 6.2 Continuity windows

A continuity window extends the canonical chunk bounds by a bounded radius. This allows approach evidence to remain visible while a chunk edge is crossed.

No continuity window gives permission to mutate neighbouring terrain. It only affects whether a candidate or evidence row belongs to the continuity envelope.

## 7. Deterministic gateway candidates

The bridge creates a bounded candidate set around the authored entrance point.

Candidate generation rules:

1. use a stable seed derived from settlement anchor and policy;
2. derive bounded jitter from the shared deterministic jitter primitive;
3. preserve the authored entrance Y value;
4. rank by distance to the entrance and continuity-window membership;
5. cap the list at 16 candidates.

The candidates are presentation/planning evidence. They are not meshes, colliders or terrain operations.

## 8. Approach node contract

The approach planner produces at most 24 nodes. Every node contains:

```text
id
point
stage
chunkKey
ownerChunkKey
lod
readable
serviceHint
distanceMeters
```

The node list is deterministic for the same settlement, surface, seed and policy.

A readable node is not necessarily an interactable node. Readability is a presentation hint used to decide whether a distant cue is useful to the player.

## 9. LOD and budget behaviour

The bridge uses stage-aware LOD hints:

| Stage | Desktop factor | Mobile factor before additional runtime scaling |
|---|---:|---:|
| far | 0.35 | 0.217 |
| approach | 0.62 | 0.3844 |
| threshold | 0.84 | 0.5208 |
| inside | 1.00 | 0.6200 |

The actual geometry/material cost remains owned by the world runtime. The continuity layer merely exposes a bounded presentation budget.

Default transition budgets are intentionally small:

| Stage | Desktop budget | Mobile budget |
|---|---:|---:|
| far | 8 | 4 |
| approach | 16 | 9 |
| threshold | 24 | 14 |
| inside | 28 | 17 |

These are hints for presentation orchestration, not a direct renderer allocation command.

## 10. Service recommendation

When a player arrives at a threshold, the cross-scale planner ranks the eight services using three kinds of evidence:

1. the transition profile for the current stage and environment;
2. the player's current settlement state;
3. the canonical service domain.

The output is a deterministic recommendation list. It does not mutate service state.

### 10.1 Default recommendation philosophy

At a clean threshold with ordinary resources, the market is intentionally competitive because it offers a broadly useful first action and produces a familiar settlement-entry loop. High fatigue shifts value toward tavern/house; being outside the settlement elevates the gate; being inside increases the value of direct services.

The recommendation is a UX aid. The player may still choose another service.

## 11. Quick actions

The planner exposes a bounded quick-action list, normally four entries and never more than eight.

A quick action contains:

```text
rank
serviceId
intent
score
profileId
focus
```

A UI may render these entries as a radial menu, compact row, controller shortcuts or contextual cards. None of those UI choices belongs to the continuity module.

## 12. Context catalogue

Ten canonical geographic contexts are represented:

| Context | Typical evidence | Presentation tendency |
|---|---|---|
| north-cold | snow/wind | lower ambient density |
| north-temperate | road/field | balanced |
| north-river | water/road | stronger shoreline cues |
| north-moor | open/wind | sparse and readable |
| mountain-cold | snow/rock | sparse, high relief |
| mountain-pass | rock/road | route emphasis |
| river-lowland | water/field | field and market adjacency |
| forest-edge | forest/road | transition cues |
| woodland | forest/shade | sheltered approach |
| shoreline | water/shore | shoreline-safe emphasis |

The full service × stage × context matrix contains 8 × 7 × 10 = 560 deterministic profiles.

## 13. Profile schema

Every generated continuity profile exposes:

```text
id
serviceId
stage
context
focus
icon
audio
tags
density
readable
priority
mobileDensity
```

`density` remains normalized to the 0–1 range. `mobileDensity` is a deterministic reduction of the desktop hint.

The profile catalogue is generated rather than handwritten as 560 independent objects. That keeps the matrix auditable while avoiding repeated data that could drift.

## 14. Environmental modifiers

Environmental context affects presentation profile selection but never changes authoritative geography.

Examples:

- shoreline context raises the relevance of water-safe route cues;
- mountain-pass context raises route/rock tags;
- woodland context reduces the need for broad visual density;
- north-cold context lowers ambient density because readability matters more than clutter;
- river-lowland context can strengthen market/farm legibility without creating a river or field.

The geographic runtime remains the authority for actual surfaces.

## 15. Settlement gateway state

Gateway state is one of:

- `available` — an entry transition is currently offered;
- `approach-only` — the settlement is near enough to prepare but not yet enter;
- `blocked` — no active gateway action is offered;
- `inside` — the player is already within the settlement;
- `departure-only` — the player is inside but should only be allowed to exit, for example after defeat.

The state is fail-closed. A malformed or contradictory input must not silently become `available`.

## 16. Closed settlement behaviour

When settlementOpen is false:

- an outside player does not receive a live entry action;
- approach evidence may still exist;
- an inside player retains an inside context so the system can explain the state;
- the bridge does not open a replacement settlement or bypass campaign rules.

This preserves the distinction between visibility and authorization.

## 17. Defeated-player behaviour

A defeated player must not gain a new settlement activity because the continuity layer discovered a threshold. The bridge changes the gateway semantic to `departure-only` when already inside, allowing the player to leave through an existing route while preventing ordinary settlement actions from being advertised as available.

Combat remains outside the module.

## 18. Route continuity

The transition plan may include one canonical route projection, such as `north_gate` or another existing settlement route.

A route projection contains:

```text
id
label
destination
risk
```

The bridge does not create a route spline. It only references an existing route definition.

## 19. Service continuity

Service projections resolve through the settlement campaign content registry. The bridge recognizes the same eight service IDs used by World Coverage.

For each service, continuity profiles expose a primary intent hint. The settlement runtime remains responsible for validating the action itself.

Examples:

| Service | Primary intent hint |
|---|---|
| gate | enter |
| market | talk |
| tavern | talk |
| blacksmith | talk |
| farm | interact |
| barracks | talk |
| stable | talk |
| house | interact |

These are recommendations, not execution guarantees.

## 20. Checkpoints

The continuity checkpoint is intentionally compact. It records:

```text
version
settlementId
stage
gatewayState
activeService
worldChunkKey
sequence
timestamp
metadata
digest
```

The checkpoint does not contain an authoritative inventory, quest ledger, terrain state, model references or save-game replacement state.

## 21. Checkpoint validation

A checkpoint is accepted only when:

1. the settlement ID matches the current settlement;
2. the stage is one of the seven canonical stages;
3. the gateway state is one of the five canonical states;
4. sequence is finite;
5. the service and presentation state can be interpreted by the current runtime.

A mismatched settlement is rejected with `settlement-mismatch`. This prevents a malformed resume payload from silently switching the player into another settlement context.

## 22. Runtime session

The continuity session intentionally has a small surface:

```text
context()
transition()
move()
enter()
exit()
service()
checkpoint()
resume()
snapshot()
proof()
dispose()
```

All returned objects are deeply frozen. This prevents downstream UI code from modifying the session's evidence through shared object references.

## 23. Session history

History is bounded to 24 entries by default. A history record contains a sequence, timestamp and compact event payload.

The history is diagnostic evidence. It is not an event-sourcing replacement for the existing game state.

When the bound is reached, the oldest evidence is dropped. This is preferable to unbounded memory growth in long-running sessions.

## 24. Dispose semantics

A disposed continuity session fails closed:

- the first `dispose()` returns true;
- repeated `dispose()` calls return false;
- later `enter()` calls return `disposed`;
- no background task is implied by the module.

This supports clean scene/world lifecycle ownership without creating a hidden scheduler.

## 25. Audit contract

The continuity audit reports:

```text
policy
settlementId
stage
gateway
approach
services
geography
lod
score
ok
errors
fingerprint
```

The audit checks:

- deterministic validation result;
- gateway candidate availability;
- approach node availability;
- owner continuity drift;
- service uniqueness;
- normalized score.

An audit error does not mutate runtime state.

## 26. Desktop/mobile matrix

The audit matrix intentionally probes four positions in each of two modes:

```text
desktop × far
 desktop × approach
 desktop × threshold
 desktop × inside
mobile × far
 mobile × approach
 mobile × threshold
 mobile × inside
```

This gives eight rows and makes it possible to catch regressions where mobile and desktop diverge in stage semantics.

## 27. Deterministic replay

A replay test uses identical input twice and compares:

- plan fingerprint;
- gateway candidate list;
- service recommendation order;
- profile selection;
- audit digest.

A changed order with the same logical content is still considered a drift because deterministic UI and world transitions benefit from stable ordering.

## 28. Numeric safety

The bridge normalizes malformed numeric values. Inputs such as `NaN`, `Infinity` or missing coordinates must resolve to finite values in the public context.

This is particularly important for distance, LOD and budget calculations because an infinite distance or undefined position can otherwise cause a candidate list or state machine to become nondeterministic.

## 29. Catalog cardinality

The generated profile cardinality is a hard contract:

```text
8 services
× 7 stages
× 10 contexts
= 560 profiles
```

The validation script confirms:

- total cardinality;
- unique profile IDs;
- density range;
- mobile density range;
- tag presence;
- stable fingerprint.

## 30. Integration boundary

The integration test intentionally joins four layers:

```text
settlementCampaignContent
        |
        v
World Coverage runtime session
        |
        v
Continuity bridge
        |
        v
Geographic asset runtime context
```

The expected data flow is read-only across the world seam and action-oriented only through the settlement runtime handler seam.

## 31. What the bridge must never do

The continuity feature must never:

- instantiate Three.js geometry;
- call `scene.add` for a world asset;
- author a material system;
- replace the placement pipeline;
- modify terrain height;
- modify hydrology;
- rewrite road geometry;
- create NPC AI;
- implement combat;
- mint a second quest identifier space;
- own authoritative inventory/economy state;
- own the authoritative save file.

These prohibitions are also represented in the exact-head workflow as grep-level architectural guards.

## 32. Asset evidence relationship

A pointer file can still represent a real source asset. Therefore pointer status remains a distinct evidence state.

The continuity bridge may carry:

```text
ready
hydrated
loaded
pointer
missing
unknown
```

It must not convert a pointer into `missing` merely because the binary bytes are not available to the current test process.

## 33. Material evidence relationship

World Coverage acceptance may expose material quality through the existing material manifest contract. The continuity bridge itself does not assign materials.

The complete World Coverage proof expects evidence such as:

- PBR role coverage;
- texture presence;
- texture size;
- placeholder count;
- missing material count;
- single-surface risk.

This lets visual quality be measured independently of scene authoring.

## 34. Grounding relationship

The continuity feature records expected/actual settlement position indirectly through the upstream placement evidence contract. It does not snap a model to terrain.

The appropriate sequence remains:

```text
source asset
 -> shared material assignment
 -> material validation
 -> shared placement/grounding
 -> manifest evidence
 -> continuity proof
```

This ordering prevents continuity code from becoming a hidden placement system.

## 35. Readability strategy

Distant settlement cues should be sparse enough to preserve the silhouette of the world. The far-stage profile intentionally lowers density and marks only selected approach nodes as readable.

At the threshold, readability increases because the player needs to understand:

- where the gate is;
- which services are present;
- where the surrounding road continues;
- whether entry is currently authorized.

Inside the settlement, direct service readability can take priority over geographic density.

## 36. Visual continuity strategy

The player should not experience an abrupt visual grammar change simply because the settlement flag changed. The transition system therefore keeps a shared:

```text
seed
chunk ownership
LOD factor
budget vocabulary
service recommendations
checkpoint sequence
```

The actual world geometry remains under the corresponding world owners.

## 37. Mobile strategy

Mobile uses the same semantic stages and service vocabulary as desktop but receives a lower presentation factor and budget.

The design goal is not to remove the settlement. It is to keep the settlement legible while reducing background transition work.

A mobile plan should therefore preserve the gateway, approach readability and service recommendation even when distant contextual density is reduced.

## 38. Regression priorities

The highest-value regressions are:

1. far/approach/threshold state confusion;
2. entry available when the settlement is closed;
3. defeated player gaining ordinary service access;
4. chunk owner drift;
5. nondeterministic gateway candidates;
6. checkpoint accepting another settlement;
7. mobile budget becoming larger than desktop;
8. profile catalog cardinality drift;
9. unknown numeric values producing `NaN`/`Infinity`;
10. a continuity module taking placement ownership.

The current regression scripts exercise each of these categories.

## 39. Test matrix map

| Script | Primary responsibility |
|---|---|
| `checkSettlementWorldCoverageContinuity.mjs` | complete continuity matrix |
| `checkSettlementWorldCoverageContinuityCatalog.mjs` | profile catalog cardinality/ranges |
| `checkSettlementWorldCoverageContinuityPlanner.mjs` | recommendation/replay matrix |
| `checkSettlementWorldCoverageContinuityIntegration.mjs` | cross-layer integration |

The exact-head workflow also performs syntax checks, scope checks and architectural boundary checks.

## 40. Expected exact-head gate

The continuity workflow intentionally requires:

```text
exact trigger SHA
fresh origin/main
2700 <= diff <= 3000
syntax clean
continuity matrix PASS
catalog matrix PASS
planner matrix PASS
integration matrix PASS
ownership grep PASS
geographic seam PASS
settlement seam PASS
focused scope PASS
proof artifact emitted
```

The 3000-line ceiling is a focused implementation budget, not a production limit. It exists so one continuity slice cannot quietly expand into an unreviewable rewrite.

## 41. Feature completion definition

The cross-scale feature is considered complete when the system can provide all of the following deterministically:

- a far-to-approach transition;
- a threshold gateway state;
- an inside state;
- bounded gateway candidates;
- bounded approach nodes;
- shared chunk/seed continuity;
- service recommendations;
- mobile/desktop LOD hints;
- compact checkpoint/resume evidence;
- deep-frozen snapshots;
- profile catalog validation;
- deterministic replay proof;
- architectural ownership proof.

This definition is deliberately stronger than “the file exists.”

## 42. Future extension rules

Future World Coverage turns may add:

- richer weather-aware context selection;
- time-of-day profile selection;
- service-specific approach signage hints;
- road visibility scoring;
- settlement-edge ambient family hints;
- checkpoint migration metadata.

Such changes must preserve the current ownership boundaries and deterministic replay contract.

## 43. Final principle

The player should experience one coherent world rather than a collection of subsystems.

The implementation should achieve that coherence by sharing contracts, not by duplicating authorities.

The settlement tells the runtime what the player can do. The geographic system tells the runtime what world context exists. The continuity bridge makes those two truths meet at the boundary — deterministically, read-only on world ownership, bounded in cost, and explicit in evidence.
