# Terrain Groundwater Surface Detail

## 1. Scope

The surface-detail layer is a presentation layer.
It consumes the existing groundwater regime.
It does not become an alternate terrain authority.
It never edits canonical height samples.
It never edits hydrology topology.
It never creates persistent water geometry.
It never edits collider geometry.
It never edits navigation geometry.
It never changes vegetation placement.
It is deterministic for identical inputs.

## 2. Ownership

`terrainGroundwaterRegime.js` remains the groundwater signal authority.
`terrainGroundwaterSurfaceAdapter.js` remains the material-channel adapter.
`terrainGroundwaterMaterialStack.js` remains the groundwater stack facade.
`terrainGroundwaterSurfaceDetail.js` adds micro-surface presentation channels.
`terrainGroundwaterSurfaceDetailShader.js` adds fragment-only shader response.
`terrainGroundwaterSurfaceDetailStack.js` composes the detail stage.
Existing canonical terrain owners remain unchanged.
The detail layer is additive to the current stack.
No detail function owns world placement.
No detail function persists simulation state.

## 3. Canonical invariants

Height is unchanged.
Hydrology topology is unchanged.
Coastline geometry is unchanged.
Collider geometry is unchanged.
Vegetation placement is unchanged.
Navigation geometry is unchanged.
No new geography is introduced.
No mesh displacement is performed.
No vertex position is written.
No height-map buffer is written.

## 4. Channel inventory

`wetRim` represents an intermediate moisture boundary.
`capillaryDamp` represents persistent pore-fed dampness.
`seepageDarkening` represents a visible seepage band.
`puddleCore` represents the visual center of a persistent wet patch.
`puddleEdge` represents the transition at a wet patch boundary.
`evaporationFront` represents a drying boundary.
`mineralCrust` represents surface mineral residue.
`fineSedimentFilm` represents a thin mineral/soil film.
`recoveryHalo` represents retained wetness during recovery.
`freezeWetEdge` represents cold wet-edge emphasis.
`marshTransition` represents lowland wet transition.
`dryingContrast` represents visible drying demand.
`microRelief` represents small normal-map emphasis.
`surfaceConfidence` represents presentation confidence.

## 5. Bounded range

All channels are clamped into `[0,1]`.
The clamp is performed at the final signal boundary.
Intermediate state values are expected to be normalized first.
Material responses are clamped separately.
Shader roughness remains inside the existing roughness floor.
Shader normal strength remains inside the policy maximum.
Color changes remain intentionally small.
Wetness is a presentation quantity, not water volume.
Dryness is a presentation quantity, not soil moisture mass.
Confidence is not a physics accuracy score.

## 6. Wet rim

Wet rims should be stronger at moisture boundaries than at saturated centers.
The signal uses the existing surface-film state.
Puddle persistence contributes to boundary stability.
Water-table proximity contributes low-frequency coherence.
Local field texture prevents perfectly uniform rings.
The rim is deliberately non-binary.
The signal falls again as saturation becomes extreme.
This reduces flat opaque wet masks.
The rim is a material cue rather than a decal authority.
The rim never moves vertices.

## 7. Capillary dampness

Capillary dampness starts with capillary-rise state.
Drying resistance contributes retention.
Current surface moisture contributes temporal continuity.
Shallow slopes make the signal more visually persistent.
The signal remains bounded on exposed rock.
The signal remains bounded in deep wet soil.
No pore simulation is performed.
No capillary height is generated.
No new water surface is created.
The output is suitable for roughness and subtle color response.

## 8. Seepage

Seepage detail is distinct from general wetness.
It is strongest inside a slope band.
The source state supplies the groundwater proximity.
The detail field supplies deterministic texture.
The result is a visual seepage face.
It does not become a stream.
It does not reroute runoff.
It does not alter channel connectivity.
It does not edit terrain height.
It is safe to blend with existing runoff presentation.

## 9. Puddle core

Puddle core favors low slope.
Puddle core favors existing surface film.
Puddle persistence controls temporal plausibility.
The shader uses bounded local cues.
The CPU stage exposes the authoritative presentation signal.
The shader never creates a water mesh.
The core is softer than a binary mask.
The edge remains separately controllable.
The material response only reduces roughness modestly.
The material response is safe at zero intensity.

## 10. Puddle edge

Puddle edge is derived from core and wet-rim state.
Local contrast can sharpen the boundary.
Contrast is clamped before use.
A zero contrast value still produces a coherent edge.
A high contrast value cannot exceed the channel limit.
The edge feeds a small normal response.
The edge does not alter collision.
The edge does not alter navigation.
The edge does not create a simulation boundary.
The edge is render-only.

## 11. Evaporation front

Evaporation front is high when drying demand is high.
It is suppressed by strong remaining surface film.
Temperature contributes a bounded demand term.
Mineral salt residue can extend the visible front.
The front is not a literal evaporation rate.
The front is not a climate solver.
The front can coexist with drought events.
The front can coexist with wind drying.
The front can coexist with thermal microclimate.
The final response remains subtle.

## 12. Mineral crust

Mineral crust uses salt-ring state from groundwater.
Seepage contributes a small supporting signal.
Drying demand contributes residue visibility.
Flat surfaces retain stronger visible crust.
Steep surfaces suppress broad mineral crust.
Crust does not change geology.
Crust does not spawn a texture asset.
Crust is represented through material bias.
Crust may increase roughness modestly.
Crust remains bounded at all extremes.

## 13. Fine sediment film

Fine sediment film uses the existing mineral mobilization state.
Surface film provides persistence.
Runoff contributes a transport cue.
The channel stays independent of terrain deformation.
The channel stays independent of collider placement.
The channel can be used by the detail shader.
The channel can be compared across frames.
The channel can be sampled in QA grids.
The channel is suitable for diagnostics.
The channel is not a sediment mass inventory.

## 14. Recovery halo

Recovery halo preserves visual continuity after drying.
It uses saturation memory.
Drying resistance moderates persistence.
Surface film provides a local anchor.
Recovery can remain visible after a dry interval.
Recovery does not store hidden mutable state.
Recovery is recomputed from the input sample.
Recovery is deterministic.
Recovery is bounded.
Recovery is suitable for temporal blending.

## 15. Freeze wet edge

Freeze wet edge uses the existing groundwater freeze stress.
Current surface saturation retains the wet context.
Low temperature raises the visual possibility.
The signal is intentionally modest.
It is not an ice-generation system.
It is not a deformation system.
It is not a material asset loader.
It may increase micro-normal response.
It may increase roughness through the event facade.
It remains a presentation-only cue.

## 16. Marsh transition

Marsh transition is distinct from biome assignment.
It uses existing marsh-edge state.
It uses surface saturation.
It uses lowland height.
It uses no vegetation placement logic.
It does not create marsh geometry.
It does not overwrite biome taxonomy.
It can soften the material boundary.
It can guide future decorative blending.
It remains deterministic.

## 17. Drying contrast

Drying contrast is the complement of resistance plus evaporation.
It increases when recovery memory falls.
It remains bounded after all combinations.
It feeds roughness lightly.
It feeds normal strength lightly.
It does not directly recolor the world by itself.
It can be inspected in telemetry.
It can be compared across scenario fixtures.
It supports drought event presentation.
It does not act as a global weather authority.

## 18. Micro relief

Micro relief combines deterministic field channels.
Capillary texture contributes a fine component.
Seepage texture contributes directional variation.
Fine sediment contributes material-scale detail.
Slope contributes only a small amount.
The final value is bounded.
The shader multiplies it by a fixed normal budget.
The CPU stage never edits geometry.
The shader never edits vertex position.
The effect remains below the normal-strength budget.

## 19. Confidence

Confidence is based on sample completeness and field strength.
Every required environmental field counts once.
All fields are normalized before confidence is calculated.
A complete sample produces a stable baseline.
A sparse sample does not invent missing certainty.
Confidence remains in `[0,1]`.
Confidence controls presentation tier.
Confidence does not alter canonical world state.
Confidence does not change the material budget.
Confidence is diagnostics only.

## 20. Material response

Detail material response combines a subset of channels.
Wet channels can reduce roughness slightly.
Mineral channels can increase roughness slightly.
Normal response is intentionally smaller than the core groundwater layer.
Color bias is kept below visible biome reassignment.
All outputs are clamped.
The response accepts a base color.
The response accepts a base roughness.
The response returns a stable object.
The response is safe to cache.

## 21. Event response

`storm` increases wet emphasis.
`drought` increases crust and drying emphasis.
`freeze-thaw` increases wet-edge roughness and normal response.
`snowmelt` increases wetness and capillary emphasis.
`recovery` increases the persistent damp response.
Unknown event names behave as neutral.
Event intensity is clamped.
Event deltas remain small.
Event application clamps final material values.
No event writes persistent world state.

## 22. Temporal blending

Detail frames can be blended linearly.
Mix values are clamped.
Zero mix keeps the first frame.
One mix keeps the second frame.
Intermediate mixes preserve channel bounds.
Temporal blending is deterministic.
Temporal blending has no hidden state.
Temporal blending does not create new water.
Temporal blending does not mutate terrain.
Temporal blending is safe for tile transitions.

## 23. Neighborhood usage

The detail stack can consume a neighborhood of frames.
Neighborhood statistics are diagnostic and presentation-oriented.
Wetness means are bounded.
Dryness means are bounded.
Contrast is derived from min/max values.
An empty neighborhood returns a safe zero report.
A single frame remains valid.
Large neighborhoods do not alter canonical state.
Neighbor values are never written back to source frames.
Neighborhood aggregation is deterministic.

## 24. Shader hooks

The detail shader uses the existing fragment include points.
The common shader section receives helper functions.
Color receives the detail presentation.
Roughness receives the detail presentation.
Normal receives the detail presentation.
No vertex include is replaced.
No position assignment is emitted.
No height-map write is emitted.
The material cache key receives a detail-specific key.
Shader installation is idempotent.

## 25. Shader safety

Shader helpers use deterministic hash/value noise.
They do not call random functions.
World XZ coordinates are the local signal source.
Height is read only as an authored surface coordinate.
Normal direction is read only for slope estimation.
The shader response is clamped.
The normal perturbation is multiplied by a fixed budget.
The shader does not allocate buffers.
The shader does not add geometry.
The shader does not touch collision or navigation.

## 26. Stack order

The detail layer follows the groundwater material stage.
The detail layer precedes the final material budget.
Base terrain remains first.
Sediment remains before groundwater.
Soil structure remains before groundwater.
Seasonality remains before groundwater.
Climate exposure remains before groundwater.
Wind drying remains before groundwater.
Thermal microclimate remains before groundwater.
Final budget remains last.

## 27. Policy identity

Detail policy identity is explicit.
Shader policy identity is explicit.
Stack policy identity is explicit.
The detail source policy is the groundwater policy.
The shader source policy is the detail policy.
The stack source policy is the groundwater policy.
Material keys are deterministic strings.
Changing a policy key should invalidate the material cache identity.
Policy objects are frozen.
Policy flags are testable.

## 28. Lowland fixtures

Lowland fixtures model shallow groundwater.
Lowland fixtures model wet alluvium.
Lowland fixtures model silt and loam.
Lowland fixtures model peat.
Lowland fixtures model dry transitions.
Lowland fixtures span low slope values.
Lowland fixtures span moderate slope values.
Lowland fixtures vary drainage.
Lowland fixtures vary wind exposure.
Lowland fixtures vary seasonal days.

## 29. Upland fixtures

Upland fixtures model deeper groundwater.
Upland fixtures model schist.
Upland fixtures model granite.
Upland fixtures model basalt.
Upland fixtures model montane biomes.
Upland fixtures model alpine conditions.
Upland fixtures span high slope values.
Upland fixtures vary rainfall and runoff.
Upland fixtures vary soil depth.
Upland fixtures vary thermal conditions.

## 30. Transition fixtures

Transition fixtures model storm entry.
Transition fixtures model snowmelt entry.
Transition fixtures model freeze-thaw entry.
Transition fixtures model drought entry.
Transition fixtures model recovery.
Transition fixtures cross lowland and upland states.
Transition fixtures span water distances.
Transition fixtures span groundwater depths.
Transition fixtures cover multiple day-of-year windows.
Transition fixtures are deterministic inputs.

## 31. Regression principles

Every channel must remain finite.
Every channel must remain bounded.
Every signature must be repeatable.
Every blend must remain bounded.
Every event response must remain finite.
Every material response must remain bounded.
Every canonical audit must pass.
Every shader replacement must be present.
Every shader invariant must pass.
Every stack audit must pass.

## 32. Extreme input matrix

Negative coordinates are valid.
Large positive coordinates are valid.
Large negative coordinates are valid.
Slope zero is valid.
Slope ninety is clamped.
Moisture zero is valid.
Moisture one is valid.
Rainfall zero is valid.
Rainfall one is valid.
Runoff zero is valid.

Soil depth zero is valid.
Soil depth maximum is bounded.
Permeability zero is valid.
Permeability one is valid.
Water distance zero is valid.
Water distance maximum is bounded.
Groundwater depth zero is valid.
Groundwater depth maximum is bounded.
Wet history zero is valid.
Dry history zero is valid.

Negative temperatures are valid.
High temperatures are clamped.
Drainage zero is valid.
Drainage one is valid.
Wind exposure zero is valid.
Wind exposure one is valid.
Day zero is valid.
Day three hundred fifty-nine is valid.
Day three hundred sixty wraps.
Negative days wrap deterministically.

## 33. Acceptance gates

The detail module must import cleanly.
The shader module must import cleanly.
The stack module must import cleanly.
The lowland fixture module must import cleanly.
The upland fixture module must import cleanly.
The transition fixture module must import cleanly.
The regression script must exit zero.
The shader report must be positive.
The canonical audit must be positive.
The detail envelope must be positive.

## 34. Failure classification

A policy failure is an identity failure.
A channel failure is a bounds failure.
A signature failure is a determinism failure.
A shader failure is an integration failure.
A canonical failure is an ownership violation.
A budget failure is a presentation regression.
A fixture failure is a coverage regression.
A stack failure is a composition regression.
A confidence failure is a diagnostics regression.
A classification failure is a presentation taxonomy regression.

## 35. Review checklist

Confirm no terrain height writes.
Confirm no hydrology writes.
Confirm no coastline writes.
Confirm no collider writes.
Confirm no navigation writes.
Confirm no vegetation writes.
Confirm no vertex displacement.
Confirm deterministic hashing.
Confirm fixed material keys.
Confirm bounded normal response.

## 36. Performance expectations

The detail layer should remain cheaper than geometry generation.
The CPU stage should be cache-friendly.
The shader should use a small fixed number of noise octaves.
No dynamic loops depend on world data.
No texture allocation occurs per fragment.
No material duplication is required by the API.
Shader installation should be idempotent.
Stack calls should remain pure.
Grid helpers should cap their requested dimensions.
Fixtures should be used in targeted tests rather than production rendering.

## 37. Visual intent

Wet rims should be readable but subtle.
Puddle centers should not look like new lakes.
Seepage should read as damp material, not a water channel.
Mineral crust should read as surface residue.
Drying fronts should not erase existing terrain materials.
Marsh transition should not become a biome switch.
Freeze wet edges should suggest cold stress.
Fine sediment should remain subordinate to authored sediment.
Micro relief should support lighting, not reshape the world.
Confidence should prevent weak signals from dominating.

## 38. Integration intent

The detail stage is additive.
The detail stage can be skipped safely.
The groundwater stage remains useful without detail.
The detail stage remains useful without new geometry.
The shader layer can be installed once.
The stack can be evaluated per sample.
Event responses can be composed without persistence.
Telemetry can be collected without mutation.
Fixtures can run in CI without the browser.
Browser smoke remains a separate gate.

## 39. Future-safe boundaries

Future water meshes must remain outside this module.
Future hydrology solvers must remain outside this module.
Future terrain deformation must remain outside this module.
Future navigation edits must remain outside this module.
Future vegetation placement must remain outside this module.
Future biome taxonomy must remain outside this module.
Future simulation memory must remain outside this module.
Future authoritative height changes require a separate owner.
Future coastline changes require a separate owner.
Future collider changes require a separate owner.

## 40. Final contract

This layer enriches the existing terrain surface.
It does not replace terrain generation.
It does not replace hydrology.
It does not replace material ownership.
It does not create water bodies.
It does not modify world topology.
It is deterministic.
It is bounded.
It is testable.
It is intentionally render-only.
