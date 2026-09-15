# Settlement World Coverage — Geographic Continuity Contract

## 1. Purpose
The continuity layer joins the authored settlement campaign with the geographic world runtime.
It provides a deterministic boundary contract without creating a second game engine.
It is read-only with respect to terrain, roads, weather, materials and model attachment.
Its outputs are suitable for UI, instrumentation, tests and compact checkpoint evidence.
It does not instantiate scene objects.
It does not own authoritative player state.
The settlement runtime remains authoritative for actions.
The geographic runtime remains authoritative for world context.

## 2. Core principle
One world should be experienced as one continuous space.
The implementation therefore shares contracts instead of duplicating systems.
A boundary transition can change presentation density without changing world ownership.
A service recommendation can change UI priority without mutating service state.
A checkpoint can record presentation context without replacing the save game.
A road score can describe visibility without editing road geometry.
An atmosphere profile can describe readability without creating weather.
A signage profile can describe cues without spawning signs.

## 3. Ownership map
| Concern | Authority | Continuity role |
| Settlement services | settlement campaign | read canonical service IDs |
| Quest state | QuestSystem | expose context only |
| Dialogue | settlement content | expose action intent only |
| Economy/crafting | campaign runtime | call existing handlers |
| Save state | save runtime | compact resume hint |
| Terrain | terrain/world owner | consume surface evidence |
| Roads | road/world owner | consume distance/class evidence |
| Assets | geographic asset runtime | consume chunk/seed continuity |
| Materials/placement | shared placement pipeline | never replace |
| NPC/combat | existing systems | never duplicate |

## 4. Service vocabulary
There are exactly eight canonical services in this slice.
`gate` represents entry, exit and travel.
`market` represents trade and commerce.
`tavern` represents rest, dialogue and quest context.
`blacksmith` represents crafting and equipment.
`farm` represents survival-oriented interaction.
`barracks` represents training and readiness.
`stable` represents travel and mobility.
`house` represents persistence, rest and equipment context.

## 5. Transition stages
The bridge models seven semantic stages.
`far` means orientation at low presentation cost.
`approach` means settlement relationship is becoming legible.
`threshold` means entry can be offered.
`inside` means settlement context is active.
`service` means a service is the focal interaction.
`departure` means the route back to open world is the focal context.
`resume` means checkpoint restoration is the focal context.

## 6. Gateway states
Gateway state is one of `available`, `approach-only`, `blocked`, `inside`, `departure-only`.
`available` permits the continuity layer to advertise entry.
`approach-only` shows preparation cues but does not advertise entry.
`blocked` exposes no active boundary action.
`inside` confirms the player is already in settlement context.
`departure-only` is used for a fail-closed exit semantic such as defeated state.

## 7. Distance policy
Default approach radius is 150 meters.
Default threshold radius is 36 meters.
Default departure radius is 52 meters.
These values are policy defaults rather than terrain instructions.
Settlement-specific values are allowed when semantic ordering is preserved.
Distance calculations use X/Z space for boundary staging.
All derived distances are finite and deterministic.
A caller may provide authored coordinates instead of the defaults.

## 8. Geographic seam
The bridge consumes `buildAnchorRuntimeContext` from the geographic runtime.
It consumes `chunkKeyFor` for stable spatial identity.
It consumes `continuitySeedFor` for deterministic variation.
It consumes the continuity-window helpers for chunk-edge evidence.
It consumes deterministic jitter only for bounded candidate generation.
It never writes to terrain height.
It never writes to hydrology.
It never rewrites road geometry.
It never attaches a model to a scene.

## 9. Chunk ownership
Both settlement chunk and continuity owner chunk are recorded.
This prevents boundary evidence from silently changing owner during streaming.
A stable owner helps avoid duplicate or disappearing approach cues.
Ownership is derived from the same geographic contract used elsewhere.
The continuity layer treats owner identity as evidence, not as a mutation command.
Chunk transitions can therefore be inspected in test output.
The bridge remains independent of renderer lifecycle.
No chunk is pinned or forced resident by this layer.

## 10. Continuity window
A bounded window extends the canonical chunk envelope for approach evidence.
It helps a cue remain valid while the player crosses an edge.
The window does not authorize neighbouring terrain changes.
It is only a membership test for deterministic evidence.
Candidate points record whether they fall within this envelope.
Approach nodes record both chunk and owner identities.
Window radius is inherited from the shared geographic runtime.
No second geographic tiling scheme is introduced.

## 11. Gateway candidates
Up to 16 gateway candidates are generated.
Candidates use a stable seed derived from settlement identity and location.
Jitter is bounded and deterministic.
The authored entrance Y value is preserved.
Candidates are ranked by distance and continuity-window membership.
Candidates are evidence for route/UX planning.
They are not colliders.
They are not terrain edits.
They are not model placements.

## 12. Approach nodes
Up to 24 approach nodes are generated.
Each node contains identity, point, stage and distance.
Each node records its chunk and continuity owner.
Each node contains an LOD/readability hint.
Each node contains a service hint for presentation use.
Node order is deterministic.
Node cardinality is bounded.
Node generation does not create meshes or splines.

## 13. LOD policy
Far-stage presentation factor is 0.35 on desktop.
Approach-stage factor is 0.65 on desktop.
Threshold-stage factor is 0.85 on desktop.
Inside-stage factor is 1.0 on desktop.
Mobile multiplies the factor by 0.62.
Actual renderer allocation remains outside this feature.
The factor is a planning hint, not a draw-call command.
The same semantic stages apply to both desktop and mobile.

## 14. Transition budget
Default desktop budgets are 8, 16, 24 and 28 for far, approach, threshold and inside.
Mobile uses the same ordering with a 0.62 reduction.
Budgets are intentionally small and bounded.
They are used to preserve responsiveness during scale transitions.
They do not allocate GPU resources directly.
They do not create or destroy assets.
They do not change terrain resolution.
They do not own streaming state.

## 15. Service recommendation
The planner ranks the eight services deterministically.
Profile priority comes from the service/stage/context catalogue.
Player state can add bounded UX preference signals.
Fatigue can increase rest-oriented services.
Outside settlement, gate receives a strong access preference.
Inside settlement, direct services become more competitive.
Trade resources can slightly increase market relevance.
The recommendation is not a permission check.
Action execution still belongs to the campaign runtime.

## 16. Quick actions
The planner exposes a bounded quick-action list.
Default consumers should render at most four actions.
The hard cap is eight.
Each action includes rank, service, intent and score.
Each action identifies its selected continuity profile.
Each action exposes a focus label.
Order is deterministic for identical input.
Quick actions are UI-ready but UI-owned by the caller.
No action mutates the settlement.

## 17. Profile catalogue
The catalogue is generated as service × stage × context.
There are 8 services.
There are 7 stages.
There are 10 geographic contexts.
The total is therefore 560 profiles.
Generated profiles have stable IDs.
Profiles carry focus, icon, audio, tags and density.
Profiles include a mobile-density reduction.
The matrix is generated rather than duplicated by hand.

## 18. Geographic contexts
The canonical contexts are north-cold, north-temperate, north-river and north-moor.
Mountain contexts are mountain-cold and mountain-pass.
Lowland context is river-lowland.
Forest contexts are forest-edge and woodland.
Shore context is shoreline.
Context selection consumes caller-provided biome/layer evidence.
It never creates the corresponding biome.
It never mutates geographic classification.

## 19. Profile density
Density is normalized to the 0–1 range.
Mobile density is never greater than desktop density.
Context multipliers tune presentation emphasis.
Stage multipliers reduce distant clutter.
Gate receives a threshold priority nudge.
All profile calculations are deterministic.
Profile IDs are unique.
Profile tags must be present.
Catalogue validation checks cardinality and ranges.

## 20. Environment presentation
Atmosphere is represented as an evidence packet.
Time is divided into eight phases from pre-dawn to night.
Weather vocabulary has eight bounded types.
Atmosphere reports readability, density and sound activity hints.
Visibility and weather reduce presentation confidence.
No lights are spawned.
No weather particles are spawned.
No audio nodes are created.
The world remains authoritative for actual atmosphere execution.

## 21. Time phases
The phases are pre-dawn, dawn, morning, midday, afternoon, dusk, evening and night.
Phase boundaries are deterministic hour intervals.
Phase progress is normalized.
Sky/readability factors are stable constants.
The same hour always maps to the same phase.
Hours outside 0–24 wrap safely.
Malformed hours resolve to a finite default.
Time phase affects presentation hints only.

## 22. Weather semantics
Supported weather types are clear, cloud, fog, rain, snow, storm, wind and sleet.
Unknown types fail to clear.
Visibility remains normalized.
Intensity remains normalized.
Precipitation remains normalized.
Wind remains normalized.
Wetness remains normalized.
Temperature is carried as finite evidence.
Weather never mutates the world.

## 23. Wayfinding signage
Signage is a deterministic projection of boundary state.
Sign types include gateway, service, route, warning, checkpoint and landmark.
A gateway sign reflects entry authorization semantics.
A service sign reflects an existing service ID.
A route sign reflects an existing route ID.
A warning sign can communicate low visibility.
A checkpoint sign reflects resume evidence.
No sign object is instantiated.
The caller owns final UI rendering.

## 24. Sign priority
Priority combines stage, visibility and time-of-day.
Threshold signage is intentionally more readable than far-stage signage.
The recommended service can receive a small priority bonus.
Mobile presentation can reduce sign density.
Every sign includes stable identity and copy.
A primary visible sign can be selected deterministically.
Priority is normalized.
Sign count and readable count are bounded.

## 25. Road visibility
Road scoring is read-only.
It accepts road class, distance, slope and surface evidence.
Supported classes include gateway, arterial, local, trail, crossing and unknown.
Distance decreases visibility with range.
Slope reduces confidence at high grades.
Water and difficult surfaces apply bounded penalties.
Weather affects visibility confidence.
Mobile receives a small additional reduction.
No road geometry is created or changed.

## 26. Road bands
The road planner exposes gate, near, approach and horizon bands.
Only the matching distance band is active.
Each band carries a deterministic priority.
Far-stage presentation can slightly lower the priority.
The bands are evidence for UI/streaming orchestration.
They do not create routes.
They do not alter road assets.
They remain deterministic at chunk boundaries.

## 27. Unified experience packet
The experience module composes transition, atmosphere, signage and road evidence.
It emits a single player-facing packet.
The packet records mode, stage and gateway state.
It includes route and service recommendation.
It includes a bounded cue list.
It includes a normalized readiness score.
It includes checkpoint availability.
It includes explicit ownership flags.
The packet is deeply frozen.

## 28. Experience modes
Experience modes are orient, approach, arrive, settle, service, depart and resume.
Mode is derived from stage and settlement membership.
The mode is semantic rather than a renderer scene name.
A player can therefore remain in one streamed world while mode changes.
The same world context can support different presentation cues.
Mobile and desktop preserve the same mode vocabulary.
A malformed stage fails toward a safe semantic.
Mode validation is part of the acceptance test.

## 29. Readiness score
Readiness is a normalized presentation measure.
Entry availability contributes strongly at threshold.
Readable signage contributes a secondary signal.
Road visibility contributes a route signal.
Atmosphere readability contributes a smaller signal.
Readiness does not grant permission.
Readiness does not modify player state.
It is appropriate for deciding how strongly to present a transition.

## 30. Checkpoint model
A continuity checkpoint contains version and settlement ID.
It records stage and gateway state.
It records active service and world chunk key.
It records sequence and timestamp.
It may carry bounded metadata.
It contains a deterministic digest.
It does not carry authoritative inventory.
It does not carry the quest ledger.
It does not replace the save file.

## 31. Checkpoint validation
Settlement ID must match the current settlement.
Stage must be one of the seven canonical stages.
Gateway state must be one of the five canonical states.
Sequence must be finite.
Invalid checkpoints are rejected.
A mismatched settlement returns `settlement-mismatch`.
An invalid stage returns `invalid-stage`.
No silent cross-settlement resume is allowed.

## 32. Session lifecycle
The continuity session exposes context and transition inspection.
It exposes move, enter and exit operations for deterministic test/session scaffolding.
It exposes service selection.
It exposes checkpoint and resume.
It exposes snapshot and proof.
It exposes dispose.
Returned objects are frozen.
History is bounded.
Dispose is fail-closed.

## 33. History contract
Default history size is 24.
Each event has a monotonic sequence.
Each event has a finite timestamp.
History stores compact payloads.
Oldest entries are discarded after the bound is reached.
History is diagnostic evidence, not event sourcing.
It is safe to serialize for tests.
It is not a replacement for authoritative runtime logs.

## 34. Disposal
First dispose returns true.
Repeated dispose returns false.
Operations after disposal fail with `disposed` where appropriate.
No background task is implied.
No hidden timer is created.
No resource loader is created.
This keeps lifecycle ownership in the caller.
The continuity packet can therefore be destroyed with the owning screen/session.

## 35. Determinism
Stable serialization is used for fingerprints.
Object keys are sorted before hashing.
Seeds are inherited from the shared geographic contract.
Candidate ordering is deterministic.
Profile ordering is deterministic.
Service recommendation ordering is deterministic.
Replay tests compare complete fingerprints.
The same input must produce the same public packet.
Malformed numeric inputs must never leak NaN or Infinity.

## 36. Null and numeric safety
Null player objects are normalized to an empty player context.
Null settlement/surface inputs fall back to safe defaults.
String numerics are parsed only when finite.
Infinity and NaN resolve to bounded defaults.
Scores are clamped to 0–1.
Counts are bounded by explicit policy caps.
Distance remains finite.
LOD remains finite.
Budget remains finite.
This is part of the public boundary contract.

## 37. Acceptance proof
The acceptance proof combines asset, material, placement, camera and interaction evidence.
World Coverage continuity adds its own transition proof.
A green acceptance requires all core flags to pass.
Pointers remain a distinct asset status.
Placement validity remains shared-pipeline evidence.
Material quality remains shared-manifest evidence.
Cameras must be readable and safe.
Interaction sequences must be monotonic.
Fingerprints make the proof replayable.

## 38. Architectural prohibitions
Continuity modules must not import editor-only material tools.
They must not author primitive geometry.
They must not call `scene.add` for a world asset.
They must not mutate terrain.
They must not mutate hydrology.
They must not mutate road geometry.
They must not create NPC AI.
They must not implement combat.
They must not mint a parallel quest system.
They must not own authoritative save state.

## 39. Integration with campaign runtime
Action execution remains in `settlementCampaignRuntime`.
The continuity layer can invoke the runtime through injected handlers.
The integration test exercises trade, crafting and save paths.
Duplicate request behavior remains owned by the campaign runtime.
The continuity bridge merely records presentation context.
Export/import state remains campaign-owned.
Dispose semantics remain campaign-owned for the authoritative runtime.
The two systems can therefore evolve independently.

## 40. Integration with geographic runtime
The bridge uses existing anchor context construction.
Chunk keys come from the geographic runtime.
Continuity windows come from the geographic runtime.
Deterministic seed derivation comes from the geographic runtime.
No second world coordinate system is created.
No second terrain classification is created.
No second asset streaming system is created.
This keeps World Coverage additive rather than invasive.

## 41. Test matrix
The catalogue test checks all 560 generated profiles.
The planner test checks deterministic recommendations and mobile/desktop differences.
The integration test checks campaign-runtime seams and checkpoint continuity.
The boundary test checks chunk edges, threshold states and deterministic samples.
The acceptance test checks failure modes such as missing assets and floating placements.
The presentation test checks weather, time, signage, roads and experience packets.
The exact-head workflow runs all focused tests.
Syntax is checked separately before the focused tests.

## 42. Exact-head CI
The workflow checks out the exact trigger SHA.
For pull requests it verifies the PR base equals current `origin/main`.
The focused diff must remain between 2700 and 3000 changed lines.
All continuity runtime modules receive syntax checks.
All focused regression scripts receive syntax checks.
Architecture is checked with explicit grep guards.
Geographic and settlement seams are verified.
Only scoped World Coverage files are accepted.
A proof artifact records the exact head and contract counts.

## 43. Completion definition
World Coverage continuity is complete when far-to-approach transition is deterministic.
Threshold entry is explicitly represented.
Inside and departure states are explicitly represented.
Chunk/seed continuity is exposed.
Gateway and approach candidates are bounded.
Service recommendations and quick actions are available.
Atmosphere, signage and road visibility are available.
Checkpoint/resume evidence is validated.
Replay fingerprints are stable and ownership boundaries remain intact.

## 44. Future-turn rules
Future turns may add richer time/weather selection.
They may add service-specific signage hints.
They may add road visibility weighting.
They may add ambient family hints.
They may add checkpoint migration metadata.
They must preserve current service IDs.
They must preserve deterministic replay.
They must preserve read-only geographic ownership.
They must keep the focused diff reviewable.

## 45. Final design rule
The player should feel that a settlement is part of the world, not a separate subsystem.
The implementation should achieve that feeling through shared contracts.
The settlement campaign remains the authority for what the player may do.
The geographic runtime remains the authority for where that action occurs.
The continuity layer joins those truths at their boundary.
It does so with deterministic evidence.
It does so with bounded presentation cost.
It does so without duplicating world ownership.
That is the purpose of this contract.
