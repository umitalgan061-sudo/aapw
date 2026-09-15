# Groundwater Surface Detail Shader Contract

## Contract 01 — Fragment ownership
The shader is fragment-only.
The shader reads world-space presentation inputs.
The shader never changes vertex position.
The shader never changes displacement.
The shader never writes a height field.
The shader never writes hydrology topology.
The shader never writes collision data.
The shader never writes vegetation placement.

## Contract 02 — Determinism
The shader uses deterministic hash functions.
The shader uses fixed value-noise interpolation.
The shader uses fixed octave counts.
The shader uses no random function.
The shader uses no time-dependent random seed.
The shader uses world coordinates as stable spatial inputs.
The shader uses a fixed cache identity.
The shader helpers are pure calculations.
The shader does not read mutable simulation state.

## Contract 03 — Color
Color response is additive and subtle.
Wetness darkens the material slightly.
Wetness increases blue response slightly.
Crust adds a restrained warm mineral bias.
Evaporation adds a restrained dry bias.
Fine film remains subordinate.
Freeze response remains subordinate.
Marsh response remains subordinate.
Color is not a biome switch.
Color is not a terrain generator.

## Contract 04 — Roughness
Wet cues may reduce roughness.
Puddle cues may reduce roughness further.
Crust may increase roughness.
Freeze may increase roughness modestly.
Evaporation may increase roughness modestly.
All roughness is clamped.
The existing roughness floor remains protected.
No roughness path writes canonical terrain state.
No roughness path creates a new material instance per fragment.

## Contract 05 — Normal response
Normal response is intentionally small.
Micro-relief is derived from deterministic local fields.
Seepage adds a small gradient.
Puddle edges add a small gradient.
Freeze adds a small gradient.
Fine film can add a small gradient.
The policy normal maximum is enforced.
The shader does not write position.
The shader does not write geometry buffers.
The shader does not create parallax geometry.

## Contract 06 — World height usage
World height is read as a surface coordinate.
Height contributes to lowland/wetness classification.
Height contributes to evaporation context.
Height contributes to crust context.
Height contributes to freeze context.
Height is never assigned.
Height is never incremented.
Height is never multiplied into a new vertex position.
Height does not redefine the canonical height field.

## Contract 07 — Slope usage
Slope is derived from the current world normal.
Slope is used only for presentation cues.
Low slope can increase puddle response.
Moderate slope can expose seepage bands.
High slope can suppress broad puddle response.
High slope can support freeze-edge detail.
Slope does not change mesh geometry.
Slope does not change hydrology topology.
Slope does not change collider data.

## Contract 08 — Wet helper
Wet detail is a broad surface signal.
Wet detail has a basin component.
Wet detail has a lowland component.
Wet detail has a deterministic local texture component.
The helper clamps its output.
The helper remains stable across frames.
The helper does not introduce new water geometry.
The helper does not create a standing-water solver.

## Contract 09 — Capillary helper
Capillary detail uses local texture.
Capillary detail uses slope context.
The helper remains bounded.
The helper remains deterministic.
The helper is subordinate to CPU groundwater state.
The helper does not simulate pores.
The helper does not integrate a volume field.
The helper does not persist moisture memory.

## Contract 10 — Seepage helper
Seepage uses a slope band.
Seepage uses deterministic ridge texture.
Seepage is bounded.
Seepage is material presentation only.
Seepage must not become a stream.
Seepage must not alter channel connectivity.
Seepage must not add water geometry.
Seepage must not modify terrain height.

## Contract 11 — Puddle helper
Puddle uses flatness.
Puddle uses lowland context.
Puddle uses deterministic texture.
Puddle remains bounded.
Puddle is not a water-body generator.
Puddle does not write a water volume.
Puddle does not create a reflection probe.
Puddle does not create a decal atlas.
Puddle remains a material cue.

## Contract 12 — Evaporation helper
Evaporation uses deterministic dry texture.
Evaporation uses height context.
Evaporation uses slope context.
Evaporation is bounded.
Evaporation does not become a climate solver.
Evaporation does not change the authored weather state.
Evaporation does not persist state.
Evaporation is safe when rainfall is missing.

## Contract 13 — Crust helper
Crust uses deterministic edge noise.
Crust uses height context.
Crust uses flatness context.
Crust is bounded.
Crust is surface residue only.
Crust does not change geology.
Crust does not create geometry.
Crust does not create a texture resource.
Crust is safe when the salt signal is zero.

## Contract 14 — Fine film helper
Fine film combines wet detail and deterministic texture.
Fine film remains bounded.
Fine film is visually subordinate to sediment.
Fine film does not become a sediment authority.
Fine film does not change soil depth.
Fine film does not change erosion mass.
Fine film does not change terrain height.
Fine film remains suitable for roughness and subtle color.

## Contract 15 — Freeze helper
Freeze uses deterministic cold texture.
Freeze uses elevation context.
Freeze uses slope context.
Freeze is bounded.
Freeze may support cold-edge presentation.
Freeze does not generate ice geometry.
Freeze does not modify colliders.
Freeze does not mutate the climate solver.

## Contract 16 — Include points
The common include receives helper functions.
The color fragment include receives color application.
The roughness-map include receives roughness application.
The normal fragment include receives normal application.
No vertex include is replaced.
No displacement include is replaced.
The order of operations remains explicit.
The cache key contains the detail material key.

## Contract 17 — Installation
Installation is idempotent.
The userData marker is explicit.
The material is marked for update.
The previous compile hook is preserved.
The previous cache key is preserved.
The new cache key appends the detail identity.
The shader does not overwrite unrelated material flags.
The installer throws a useful TypeError for missing material.

## Contract 18 — Regression requirements
Source guard checks helper presence.
Source guard checks color hook presence.
Source guard checks roughness hook presence.
Source guard checks normal hook presence.
Source guard checks absence of vertex displacement.
Source guard checks absence of height writes.
Ownership guard checks canonical flags.
Acceptance guard checks channel bounds.
Metamorphic guard checks deterministic signatures.
Integration guard checks stack composition.

## Contract 19 — Review thresholds
Normal strength must not exceed `.055`.
Roughness must stay in `[.42,1]` in the shader path.
CPU output channels must stay in `[0,1]`.
Event deltas must remain finite.
Material outputs must remain finite.
Policy objects must remain frozen.
Shader policy must remain frozen.
Stack policy must remain frozen.

## Contract 20 — Failure modes
A NaN channel is a numerical failure.
An out-of-range channel is a bounds failure.
A changed canonical flag is an ownership failure.
A vertex write is a shader failure.
A height write is a shader failure.
A non-repeatable signature is a determinism failure.
A missing include is a shader integration failure.
A missing cache key is a material identity failure.
A stale branch is an ancestry failure.
A failed focused workflow is a merge blocker.

## Contract 21 — Performance
The shader uses fixed five-octave Fbm.
The shader does not allocate memory.
The shader does not perform texture writes.
The shader does not use dynamic world-sized loops.
The shader does not create geometry.
The CPU detail grid caps each axis at forty.
The diagnostics layer stays out of the hot path.
The fixtures are test-only.
The documentation is not imported by production code.

## Contract 22 — Compatibility
The layer can be omitted without breaking groundwater state.
The groundwater layer can remain useful without detail.
Existing terrain materials remain valid.
Existing material cache identities remain valid apart from the explicit appended detail key.
Existing canonical terrain geometry remains unchanged.
Existing hydrology topology remains unchanged.
Existing coastline remains unchanged.
Existing colliders remain unchanged.
Existing vegetation placement remains unchanged.

## Contract 23 — Release safety
The detail policy is versioned.
The shader policy is versioned.
The stack policy is versioned.
Calibration policy is versioned.
Preset IDs are explicit.
Regression scripts are explicit.
The focused workflow is explicit.
The runbook records merge conditions.
The branch must be current with main before merge.
The 4,000 meaningful-change rule is enforced at the turn level.

## Contract 24 — Visual acceptance
The layer should produce subtle damp boundaries.
The layer should produce plausible puddle edges.
The layer should produce restrained seepage bands.
The layer should produce mineral crust only where appropriate.
The layer should produce fine sediment film.
The layer should preserve drying fronts.
The layer should preserve freeze-wet cues.
The layer should soften marsh boundaries without replacing biome logic.
The layer should remain visually consistent with the underlying terrain stack.

## Contract 25 — Final decision
The shader is approved only when all focused source guards pass.
The material is approved only when bounds pass.
The stack is approved only when composition passes.
The detail stage is approved only when canonical ownership passes.
The feature is approved only when deterministic repeatability passes.
The feature is approved only when the current main ancestry passes.
The feature is mergeable only after the autonomous turn reaches at least 4,000 meaningful additions/changes.
