# Seasonal erosion reviewer notes

## Scope review

The feature is a surface-aging layer. It is not a terrain generator, a hydrology solver, a collision system, or a vegetation placement system.

The resolver consumes world-space coordinates and authored environmental context, then returns bounded visual signals. The adapter composes those signals with the existing sediment response.

The runtime wrapper is responsible for normalization, cache identity and orchestration. The shader hook is responsible for a second visual path that remains deterministic and geometry-neutral.

## Architectural observations

The profile module owns data calibration.

The cycle module owns deterministic temporal and environmental response.

The adapter owns composition with the existing terrain sediment stack.

The runtime module owns frame/day orchestration and public runtime keys.

The event module owns explainable dominant-event ranking.

The response book and biome atlas own reviewable human calibration.

The diagnostics, stress suite and edge-case suite own acceptance.

The integration manifest declares dependency order and canonical boundaries.

This separation intentionally makes tuning local. A change to a profile should not require changing the runtime key format. A shader change should not require changing climate data. A new event should be testable without changing terrain geometry.

## Deterministic design review

All coordinate variation originates from fixed integer-hash seeds and fixed noise transforms.

All temporal variation originates from normalized day-of-year and fixed trigonometric forcing.

No event score depends on process time.

No material response depends on object identity.

No cache identity depends on insertion order.

No shader loop count depends on terrain content.

The deterministic probe intentionally executes the same sample more than once and compares the material output.

The stress suite repeats samples at distant coordinates to catch accidental coordinate collapse.

## Temporal review

Spring is days 1 through 90.

Summer is days 91 through 180.

Autumn is days 181 through 270.

Winter is days 271 through 360.

The cycle closes at day 360 and day 1.

The forcing curve uses warmth as the main annual phase. Rain, drying, frost and snowmelt are separate derived signals rather than one shared multiplier. This allows a cold rainy day and a cold dry day to remain visually distinct.

The moisture memory prevents immediate snapping. The frost memory and drought memory are separate so repeated cold or dry periods accumulate differently.

## Spatial review

The broad signal is intentionally slower than the local rill signal. This creates the perception of regional material history while preserving fine variation.

A world coordinate is interpreted in canonical world space. Chunk-local coordinates should not be substituted into the resolver without converting them to the same world-space convention.

The long-grid fixture exists specifically to detect the failure mode where every chunk repeats the same local pattern after recentering.

## Material review

The base material remains the dominant visual identity. Seasonal adjustments are intentionally small.

Wetness tends to reduce roughness and slightly darken the material.

Frost tends to raise roughness and normal strength while adding only a restrained cold tint.

Erosion increases micro-normal contrast and slightly shifts the surface tone.

Crust raises roughness and shifts the surface toward a dry mineral tone.

Deposition changes the surface only modestly because transported fines should not repaint the entire biome.

## Climate review

Subarctic is cold with snowmelt and freeze-thaw potential.

Cold-oceanic is cold but persistently maritime and wet.

Temperate is the baseline mixed-season response.

Mild-oceanic stays humid through summer and winter.

Wet-temperate prioritizes saturation and moisture retention.

Dry-temperate prioritizes drought memory and crust formation.

Mediterranean has a strong summer dry phase and autumn/winter rainfall recovery.

Highland combines slope, wind and freeze-thaw.

Alpine emphasizes snowmelt, frost and coarse talus.

Volcanic differentiates porous fine ash from dense basalt.

## Substrate review

Brittle substrates amplify the frost crack cue.

Fine substrates amplify saturation and rill response.

Coarse substrates emphasize drainage and reduced mud film.

Porous volcanic materials preserve transported fines.

Dense volcanic and crystalline rocks preserve coherent material identity.

Organic substrates preserve water and deposition.

## Event ranking review

The event planner is diagnostic rather than authoritative simulation. Its purpose is to explain the strongest visual cause for a material state.

A reviewer should be able to select a cell and see snowmelt, frost, runoff, saturation, drying or deposition as a dominant event without inspecting raw scalar formulas.

The ranking is bounded and deterministic. Two identical states must produce the same ranking order.

## Cache review

CPU material cache keys use a stable material identity and parameter dimensions that affect the seasonal layer.

Runtime keys include coordinate, day, hour, climate and substrate. This means a summer granite cell and winter granite cell cannot incorrectly share a seasonal runtime entry.

Coordinates are quantized only in runtime identity, not removed from the actual spatial resolver.

## Shader review

The shader uses fixed helper names and a small deterministic noise stack.

The shader hook is idempotent. Installing it twice does not stack duplicate hooks.

The shader hook updates customProgramCacheKey so the seasonal code is represented in shader identity.

The hook only modifies color, roughness and normal behavior. It does not write vertex position.

## Regression review

The focused suite covers profile count, climate coverage, substrate coverage, calendar normalization, season ordering, material bounds and deterministic output.

The stress suite covers 120 parameterized environmental scenarios, 160 long-grid world points, cache separation and a 512-sample performance guard.

The acceptance suite checks every climate through four seasonal samples and validates runtime boundary contracts.

The edge-case suite covers invalid extremes, default values, calendar wrap, world-space separation, shader idempotence and canonical boundaries.

## Common failure patterns to avoid

Do not replace world-space coordinates with chunk coordinates.

Do not seed noise from frame number.

Do not use a random generator for seasonal event choice.

Do not derive climate from local material color.

Do not use seasonal state to move terrain vertices.

Do not use seasonal state to regenerate hydrology.

Do not use seasonal state to relocate vegetation.

Do not let the shader install hook multiple times.

Do not drop climate or substrate from runtime cache identity.

Do not increase color shifts until the base material is no longer recognizable.

## Review order

Review the integration manifest first.

Review the profile count and family coverage second.

Review the cycle response and bounds third.

Review the adapter composition fourth.

Review runtime key identity fifth.

Review shader replacement points sixth.

Review diagnostic and stress fixtures seventh.

Review edge cases last.

## Performance observations

The CPU path contains deterministic scalar math and bounded loops. The largest deliberate loops are profile scans, daily forcing scans in diagnostics and fixed five-octave FBM.

The shader path contains one fixed five-iteration FBM loop. There is no loop whose iteration count depends on terrain size.

The runtime layer can be cached per world-space sample and seasonal context.

The event planner should remain a diagnostic tool rather than a per-fragment operation.

## Visual acceptance

At far range, climate and seasonal differences should be readable but restrained.

At mid range, runoff and drying differences should become legible.

At close range, frost, rills, pores and crust should influence roughness and normal detail.

No camera distance should reveal a new geometry seam caused by the feature.

## Data acceptance

Calibration values are normalized where normalized inputs are expected.

Rainfall, snowfall and freeze-cycle counts remain non-negative.

Every climate family has multiple substrates.

The response book contains several entries for each major climate family.

The biome atlas covers all four seasons for each major climate family.

The stress matrix includes both low and extreme slopes.

The edge-case catalog includes defaults and invalid extremes.

## Merge acceptance

The actual pull request diff, not an estimate, is the source of truth for the requested round size.

Focused feature tests should be reviewed separately from unrelated repository-wide checks.

A stale test expectation must be corrected rather than ignored.

A failed shader compile contract blocks acceptance when the change touches shader hooks.

A canonical-boundary failure blocks acceptance even when visual output appears correct.

## Maintenance

When the seasonal model changes, increment the policy or schema version when the output contract changes.

When a new event type is added, add an event score, material intent, scenario coverage and an acceptance assertion.

When a climate family is added, add profile entries, response-book entries, biome atlas rows and at least one stress case.

When a substrate family is added, add a profile, response-book entry and edge-case coverage.

When a runtime key dimension becomes material-relevant, add it to both the key and the deterministic regression.

When a shader include point changes upstream, update the shader contract test before enabling a release merge.

## Final reviewer conclusion

The seasonal erosion layer is accepted in concept when it remains a bounded visual-response system, preserves canonical world authority and keeps deterministic CPU/runtime/shader behavior.

The purpose of the large calibration and regression surface is to make future tuning measurable. A change should be explainable as a change in climate response, substrate response, seasonal forcing or material composition instead of an opaque visual tweak.
